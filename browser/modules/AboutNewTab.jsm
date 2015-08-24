/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

this.EXPORTED_SYMBOLS = [ "AboutNewTab" ];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "RemotePages",
  "resource://gre/modules/RemotePageManager.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NewTabUtils",
  "resource://gre/modules/NewTabUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "BackgroundPageThumbs",
  "resource://gre/modules/BackgroundPageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbsStorage",
  "resource://gre/modules/PageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "DirectoryLinksProvider",
  "resource:///modules/DirectoryLinksProvider.jsm");


let AboutNewTab = {

  pageListener: null,

  /**
   * Initialize the RemotePageManager and add all message listeners for this page
   */
  init: function() {
    this.pageListener = new RemotePages("about:newtab");
    this.pageListener.addMessageListener("NewTab:Customize", this.customize.bind(this));
    this.pageListener.addMessageListener("NewTab:InitializeGrid", this.initializeGrid.bind(this));
    this.pageListener.addMessageListener("NewTab:UpdateGrid", this.updateGrid.bind(this));
    this.pageListener.addMessageListener("NewTab:PinLink", this.pinLink.bind(this));
    this.pageListener.addMessageListener("NewTab:UnpinLink", this.unpinLink.bind(this));
    this.pageListener.addMessageListener("NewTab:ReplacePinLink", this.replacePinLink.bind(this));
    this.pageListener.addMessageListener("NewTab:BlockLink", this.block.bind(this));
    this.pageListener.addMessageListener("NewTab:UnblockLink", this.unblock.bind(this));
    this.pageListener.addMessageListener("NewTab:UndoAll", this.undoAll.bind(this));
    this.pageListener.addMessageListener("NewTab:BackgroundPageThumbs", this.backgroundPageThumbs.bind(this));
    this.pageListener.addMessageListener("NewTab:PageThumbs", this.pageThumbs.bind(this));
    this.pageListener.addMessageListener("NewTab:IntroShown", this.showIntro.bind(this));
    this.pageListener.addMessageListener("NewTab:ReportSitesAction", this.reportSitesAction.bind(this));

    this._addObservers();
  },

  /**
   * Updates whether the New Tab Page feature is enabled/enhanced.
   *
   * @param message
   *        A RemotePageManager message with the following data:
   *
   *        enabled (Boolean):
   *          Sets the value which will enable or disable the 'New Tab Page'
   *          feature.
   *        enhanced (Boolean):
   *          Sets the value which will enable or disable the enhancement of
   *          history tiles feature.
   */
  customize: function(message) {
    NewTabUtils.allPages.enabled = message.data.enabled;
    NewTabUtils.allPages.enhanced = message.data.enhanced;
  },

  /**
   * Initializes the grid for the first time when the page loads.
   * Fetch all the links and send them down to the child to populate
   * the grid with.
   *
   * @param message
   *        A RemotePageManager message.
   */
  initializeGrid: function(message) {
    NewTabUtils.links.populateCache(() => {
      message.target.sendAsyncMessage("NewTab:InitializeLinks", {
        links: NewTabUtils.links.getLinks(),
        pinnedLinks: NewTabUtils.pinnedLinks.links,
        enhancedLinks: this.getEnhancedLinks(),
      });
    });
  },

  /**
   * Updates the grid by getting a new set of links.
   *
   * @param message
   *        A RemotePageManager message.
   */
  updateGrid: function(message) {
    message.target.sendAsyncMessage("NewTab:UpdateLinks", {
      links: NewTabUtils.links.getLinks(),
      pinnedLinks: NewTabUtils.pinnedLinks.links,
      enhancedLinks: this.getEnhancedLinks(),
    });
  },

  /**
   * Pins a site at a given index and updates all pages. If a site is being
   * dragged onto the grid, we will receive a message to both pin the dragged
   * site and to ensure that the dragged site is not blocked.
   *
   * @param message
   *        A RemotePageManager message with the following data:
   *
   *        index (Integer):
   *          The cell index to pin the site at.
   *        ensureUnblocked (Boolean):
   *          Tells us if we need to unblock the site as well. If true,
   *          unblock the site.
   *        link (Object):
   *          A link object that contains:
   *
   *          baseDomain (String)
   *          blockState (Boolean)
   *          frecency (Integer)
   *          lastVisiteDate (Integer)
   *          pinState (Boolean)
   *          title (String)
   *          type (String)
   *          url (String)
   */
  pinLink: function(message) {
    let link = message.data.link;
    let index = message.data.index;
    NewTabUtils.pinnedLinks.pin(link, index);
    message.target.sendAsyncMessage("NewTab:PinState", {
      pinState: NewTabUtils.pinnedLinks.links[index].pinState,
      link,
    });
    if (message.data.ensureUnblocked) {
      this.unblock(message);
    } else {
      this.updatePages(message);
    }
  },

  /**
   * Unpins a site and updates all pages.
   *
   * @param message
   *        A RemotePageManager message with the following data:
   *
   *        link (Object):
   *          A link object that contains:
   *
   *          baseDomain (String)
   *          blockState (Boolean)
   *          frecency (Integer)
   *          lastVisiteDate (Integer)
   *          pinState (Boolean)
   *          title (String)
   *          type (String)
   *          url (String)
   */
  unpinLink: function(message) {
    let link = message.data.link;
    NewTabUtils.pinnedLinks.unpin(link);
    message.target.sendAsyncMessage("NewTab:PinState", {
      pinState: link.pinState,
      links: NewTabUtils.links.getLinks(),
      link,
    });
    this.updatePages(message);
  },

  /**
   * Replaces the old pinned link if it has expired with a new link.
   *
   * @param message
   *        A RemotePageManager message with the following data:
   *
   *        oldURL (String):
   *          The old URL to be removed.
   *        link (Object):
   *          A link object that contains:
   *
   *          baseDomain (String)
   *          blockState (Boolean)
   *          frecency (Integer)
   *          lastVisiteDate (Integer)
   *          pinState (Boolean)
   *          title (String)
   *          type (String)
   *          url (String)
   */
  replacePinLink: function(message) {
    let oldUrl = message.data.oldUrl;
    let link = message.data.link;
    NewTabUtils.pinnedLinks.replace(oldUrl, link);
  },

  /**
   * Blocks the site (removes it from the grid) and updates all pages.
   *
   * @param message
   *        A RemotePageManager message with the following data:
   *
   *        link (Object):
   *          A link object that contains:
   *
   *          baseDomain (String)
   *          blockState (Boolean)
   *          frecency (Integer)
   *          lastVisiteDate (Integer)
   *          pinState (Boolean)
   *          title (String)
   *          type (String)
   *          url (String)
   */
  block: function(message) {
    let link = message.data.link;
    NewTabUtils.blockedLinks.block(link);
    message.target.sendAsyncMessage("NewTab:BlockState", {
      blockState: NewTabUtils.blockedLinks.isBlocked(message.data.link),
      links: NewTabUtils.links.getLinks(),
      link,
    });
    this.updatePages(message);
  },

  /**
   * Unblocks the site (returns it to the grid) and updates all pages.
   * If we receive a message that the site was previously pinned, also re-pin
   * the site.
   *
   * @param message
   *        A RemotePageManager message with the following data:
   *
   *        wasPinned (Boolean):
   *          The indicator to re-pin a blocked site. If true, we must
   *          re-pin the site and restore the pin state.
   *        link (Object):
   *          A link object that contains:
   *
   *          baseDomain (String)
   *          blockState (Boolean)
   *          frecency (Integer)
   *          lastVisiteDate (Integer)
   *          pinState (Boolean)
   *          title (String)
   *          type (String)
   *          url (String)
   */
  unblock: function(message) {
    let link = message.data.link;
    NewTabUtils.blockedLinks.unblock(link);
    message.target.sendAsyncMessage("NewTab:BlockState", {
      blockState: NewTabUtils.blockedLinks.isBlocked(message.data.link),
      link,
    });

    if (message.data.wasPinned) {
      this.pinLink(message);
    } else {
      this.updatePages(message);
    }
  },

  /**
   * Restores all blocked sites from the grid and updates all pages.
   *
   * @param message
   *        A RemotePageManager message.
   */
  undoAll: function(message) {
    NewTabUtils.undoAll(function() {
      message.target.sendAsyncMessage("NewTab:Restore");
      this.updatePages(message);
    }.bind(this));
  },

  /**
   * Captures the site's thumbnail in the background.
   *
   * @param message
   *        A RemotePageManager message with the following data:
   *
   *        url (String):
   *          The site's URL.
   */
  backgroundPageThumbs: function(message) {
    BackgroundPageThumbs.captureIfMissing(message.data.url);
  },

  /**
   * Creates the thumbnail to display for each site based on the unique URL
   * of the site. Once we have created a URI for the thumbnail, send that URI
   * down to the child which will render the thumbnail only if the New Tab Page
   * 'enhanced' feature is enabled.
   *
   * @param message
   *        A RemotePageManager message with the following data:
   *
   *        link (Object):
   *          A link object that contains:
   *
   *          baseDomain (String)
   *          blockState (Boolean)
   *          frecency (Integer)
   *          lastVisiteDate (Integer)
   *          pinState (Boolean)
   *          title (String)
   *          type (String)
   *          url (String)
   */
  pageThumbs: function(message) {
    let uri = PageThumbsStorage.getFilePathForURL(message.data.link.url);
    let enhanced = Services.prefs.getBoolPref("browser.newtabpage.enhanced");
    this.pageListener.sendAsyncMessage("NewTab:ThumbnailURI", {
      uri,
      enhanced,
      url: message.data.link.url,
    });
  },

  /**
   * Update all open about:newtab pages based on the new state of the page.
   *
   * @param message
   *        A RemotePageManager message. Since many places are calling this
   *        function, all of which are passing different messages in, this
   *        parameter may vary based on the caller. In all cases though, we
   *        retrieve the outer window ID of the message's selected browser.
   */
  updatePages: function(message) {
    let tabbrowser = message.target ? message.target.browser.getTabBrowser() : message;
    let outerWindowID = tabbrowser ? tabbrowser.selectedBrowser.outerWindowID : null;
    this.pageListener.sendAsyncMessage("NewTab:UpdatePages", {
      links: NewTabUtils.links.getLinks(),
      pinnedLinks: NewTabUtils.pinnedLinks.links,
      refreshPage: true,
      enhancedLinks: this.getEnhancedLinks(),
      reason: NewTabUtils.links._reason,
      outerWindowID,
    });
  },

  updateTest: function(gBrowser) {
    let browser = gBrowser;
    this.updatePages(browser);
  },

  /**
   * Update the preferences to indicate that the intro has been shown, and we
   * do not need to show the intro again.
   */
  showIntro: function() {
    Services.prefs.setBoolPref("browser.newtabpage.introShown", true);
    Services.prefs.setBoolPref("browser.newtabpage.updateIntroShown", true);
  },

  /**
   * Reports all actions performed on a site to the Directory Links Provider.
   *
   * @param message
   *        A RemotePageManager message with the following data:
   *
   *        length (Integer):
   *          The number of sites displayed on the grid.
   *        action (String):
   *          The action performed on the site (e.g. "click", "pin", etc...).
   *        index (Integer):
   *          The tile index from which the action came from.
   */
  reportSitesAction: function(message) {
    let sites = NewTabUtils.links.getLinks().slice(0, message.data.length);
    DirectoryLinksProvider.reportSitesAction(sites, message.data.action, message.data.index);
  },

  /**
   * Get the set of enhanced links (if any) from the Directory Links Provider.
   */
  getEnhancedLinks: function() {
    let enhancedLinks = [];
    for (let link of NewTabUtils.links.getLinks()) {
      if (link) {
        enhancedLinks.push(DirectoryLinksProvider.getEnhancedLink(link));
      }
    }
    return enhancedLinks;
  },

  /**
   * Listens for a preference change or session purge for all pages and sends
   * a message to update the pages that are open. If a session purge occured,
   * also clear the links cache and update the set of links to display, as they
   * may have changed, then proceed with the page update.
   */
  observe: function(aSubject, aTopic, aData) {
    let refreshPage = false;
    if (aTopic == "nsPref:changed") {
      switch (aData) {
        case "browser.newtabpage.enabled":
          NewTabUtils.allPages._enabled = null;
          refreshPage = true;
          break;
        case "browser.newtabpage.enhanced":
          NewTabUtils.allPages._enhanced = null;
          refreshPage = true;
          break;
        case "browser.newtabpage.pinned":
          NewTabUtils.pinnedLinks.resetCache();
          break;
        case "browser.newtabpage.blocked":
          NewTabUtils.blockedLinks.resetCache();
          break;
      }
    } else if (aTopic == "browser:purge-session-history") {
        NewTabUtils.links.resetCache();
        NewTabUtils.links.populateCache(() => {
          this.pageListener.sendAsyncMessage("NewTab:UpdateLinks", {
          links: NewTabUtils.links.getLinks(),
          pinnedLinks: NewTabUtils.pinnedLinks.links,
          enhancedLinks: this.getEnhancedLinks(),
        });
      });
    }

    this.pageListener.sendAsyncMessage("NewTab:Observe", {topic: aTopic, data: aData});
    this.pageListener.sendAsyncMessage("NewTab:UpdatePages", {
      links: NewTabUtils.links.getLinks(),
      pinnedLinks: NewTabUtils.pinnedLinks.links,
      enhancedLinks: this.getEnhancedLinks(),
      reason: NewTabUtils.links._reason,
      refreshPage,
    });
  },

  /**
   * Add all observers that about:newtab page must listen for.
   */
  _addObservers: function() {
    Services.prefs.addObserver("browser.newtabpage.enabled", this, true);
    Services.prefs.addObserver("browser.newtabpage.enhanced", this, true);
    Services.prefs.addObserver("browser.newtabpage.rows", this, true);
    Services.prefs.addObserver("browser.newtabpage.columns", this, true);
    Services.prefs.addObserver("browser.newtabpage.pinned", this, true);
    Services.prefs.addObserver("browser.newtabpage.blocked", this, true);
    Services.obs.addObserver(this, "page-thumbnail:create", true);
    Services.obs.addObserver(this, "browser:purge-session-history", true);
  },

  /**
   * Remove all observers on the page.
   */
  _removeObservers: function() {
    Services.prefs.removeObserver("browser.newtabpage.enabled", this);
    Services.prefs.removeObserver("browser.newtabpage.enhanced", this);
    Services.prefs.removeObserver("browser.newtabpage.rows", this);
    Services.prefs.removeObserver("browser.newtabpage.columns", this);
    Services.prefs.addObserver("browser.newtabpage.pinned", this, true);
    Services.prefs.addObserver("browser.newtabpage.blocked", this, true);
    Services.obs.removeObserver(this, "page-thumbnail:create");
    Services.obs.removeObserver(this, "browser:purge-session-history");
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
                                         Ci.nsISupportsWeakReference]),

  uninit: function() {
    this._removeObservers();
    this.pageListener.destroy();
    this.pageListener = null;
  },
};
