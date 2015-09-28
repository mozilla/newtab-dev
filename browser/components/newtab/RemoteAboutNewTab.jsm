/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

this.EXPORTED_SYMBOLS = [ "RemoteAboutNewTab" ];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.importGlobalProperties(['URL']);

XPCOMUtils.defineLazyModuleGetter(this, "RemotePages",
  "resource://gre/modules/RemotePageManager.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "RemoteNewTabUtils",
  "resource:///modules/RemoteNewTabUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "BackgroundPageThumbs",
  "resource://gre/modules/BackgroundPageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbs",
  "resource://gre/modules/PageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "RemoteDirectoryLinksProvider",
  "resource:///modules/RemoteDirectoryLinksProvider.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "RemoteNewTabLocation",
  "resource:///modules/RemoteNewTabLocation.jsm");


let RemoteAboutNewTab = {

  pageListener: null,

  /**
   * Initialize the RemotePageManager and add all message listeners for this page
   */
  init: function() {
    this.pageListener = new RemotePages("about:remote-newtab");
    this.pageListener.addMessageListener("NewTab:Customize", this.customize.bind(this));
    this.pageListener.addMessageListener("NewTab:InitializeGrid", this.initializeGrid.bind(this));
    this.pageListener.addMessageListener("NewTab:UpdateGrid", this.updateGrid.bind(this));
    this.pageListener.addMessageListener("NewTab:PinLink", this.pinLink.bind(this));
    this.pageListener.addMessageListener("NewTab:UnpinLink", this.unpinLink.bind(this));
    this.pageListener.addMessageListener("NewTab:ReplacePinLink", this.replacePinLink.bind(this));
    this.pageListener.addMessageListener("NewTab:BlockLink", this.block.bind(this));
    this.pageListener.addMessageListener("NewTab:UnblockLink", this.unblock.bind(this));
    this.pageListener.addMessageListener("NewTab:UndoAll", this.undoAll.bind(this));
    this.pageListener.addMessageListener("NewTab:CaptureBackgroundPageThumbs", this.captureBackgroundPageThumb.bind(this));
    this.pageListener.addMessageListener("NewTab:PageThumbs", this.createPageThumb.bind(this));
    this.pageListener.addMessageListener("NewTab:IntroShown", this.showIntro.bind(this));
    this.pageListener.addMessageListener("NewTab:ReportSitesAction", this.reportSitesAction.bind(this));
    this.pageListener.addMessageListener("NewTab:SpeculativeConnect", this.speculativeConnect.bind(this));
    this.pageListener.addMessageListener("NewTab:RecordSiteClicked", this.recordSiteClicked.bind(this));
    this.pageListener.addMessageListener("NewTabFrame:GetInit", () => {
      this.pageListener.sendAsyncMessage("NewTabFrame:Init", {
        href: RemoteNewTabLocation.href,
        origin: RemoteNewTabLocation.origin
      });
    });

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
    if (message.data.enabled !== undefined) {
      RemoteNewTabUtils.allPages.enabled = message.data.enabled;
    }
    if (message.data.enhanced !== undefined) {
      RemoteNewTabUtils.allPages.enhanced = message.data.enhanced;
    }
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
    RemoteNewTabUtils.links.populateCache(() => {
      message.target.sendAsyncMessage("NewTab:InitializeLinks", {
        links: RemoteNewTabUtils.links.getLinks(),
        pinnedLinks: RemoteNewTabUtils.pinnedLinks.links,
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
      links: RemoteNewTabUtils.links.getLinks(),
      pinnedLinks: RemoteNewTabUtils.pinnedLinks.links,
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
    RemoteNewTabUtils.pinnedLinks.pin(link, index);
    message.target.sendAsyncMessage("NewTab:PinState", {
      pinState: RemoteNewTabUtils.pinnedLinks.links[index].pinState,
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
    RemoteNewTabUtils.pinnedLinks.unpin(link);
    message.target.sendAsyncMessage("NewTab:PinState", {
      pinState: link.pinState,
      links: RemoteNewTabUtils.links.getLinks(),
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
    RemoteNewTabUtils.pinnedLinks.replace(oldUrl, link);
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
    RemoteNewTabUtils.blockedLinks.block(link);
    message.target.sendAsyncMessage("NewTab:BlockState", {
      blockState: RemoteNewTabUtils.blockedLinks.isBlocked(message.data.link),
      links: RemoteNewTabUtils.links.getLinks(),
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
    RemoteNewTabUtils.blockedLinks.unblock(link);
    message.target.sendAsyncMessage("NewTab:BlockState", {
      blockState: RemoteNewTabUtils.blockedLinks.isBlocked(message.data.link),
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
    RemoteNewTabUtils.undoAll(function() {
      message.target.sendAsyncMessage("NewTab:Restore");
      this.updatePages(message);
    }.bind(this));
  },

    /**
   * Captures the site's thumbnail in the background, then attemps to show the thumbnail.
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
  captureBackgroundPageThumb: Task.async(function* (message) {
    try {
      yield BackgroundPageThumbs.captureIfMissing(message.data.link.url);
      this.createPageThumb(message);
    } catch (err) {
      var msg = `Cannot capture background page thumbs. `;
      dump("error: " + err);
    }
  }),

  /**
   * Creates the thumbnail to display for each site based on the unique URL
   * of the site and it's type (regular or enhanced). If the thumbnail is of
   * type "regular", we create a blob and send that down to the child. If the
   * thumbnail is of type "enhanced", get the file path for the URL and create
   * and enhanced URI that will be sent down to the child.
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
  createPageThumb: function (message) {
    let imgSrc = PageThumbs.getThumbnailURL(message.data.link.url);
    let doc = Services.appShell.hiddenDOMWindow.document;
    let img = doc.createElementNS(XHTML_NAMESPACE, "img");
    let canvas = doc.createElementNS(XHTML_NAMESPACE, "canvas");
    let enhanced = Services.prefs.getBoolPref("browser.newtabpage.enhanced");

    img.onload = function (e) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(this, 0, 0, this.naturalWidth, this.naturalHeight);
      canvas.toBlob(function (blob) {
        let host = new URL(message.data.link.url).host;
        RemoteAboutNewTab.pageListener.sendAsyncMessage("NewTab:RegularThumbnailURI", {
          thumbPath: "/pagethumbs/" + host,
          enhanced,
          url: message.data.link.url,
          blob,
        });
      });
    };
    img.src = imgSrc;
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
      links: RemoteNewTabUtils.links.getLinks(),
      pinnedLinks: RemoteNewTabUtils.pinnedLinks.links,
      refreshPage: true,
      enhancedLinks: this.getEnhancedLinks(),
      reason: RemoteNewTabUtils.links._reason,
      outerWindowID,
    });
  },

  updateTest: function(gBrowser) {
    let browser = gBrowser;
    this.updatePages(browser);
  },

  /**
    * Speculatively opens a connection to the given site.
    */
  speculativeConnect: function (message) {
    let sc = Services.io.QueryInterface(Ci.nsISpeculativeConnect);
    let uri = Services.io.newURI(message.data.url, null, null);
    sc.speculativeConnect(uri, null);
  },

  /**
   * Record interaction with site using telemetry.
   */
  recordSiteClicked: function(message) {
    let index = Number.parseInt(message.data.index);
    if (Services.prefs.prefHasUserValue("browser.newtabpage.rows") ||
        Services.prefs.prefHasUserValue("browser.newtabpage.columns") ||
        index > 8) {
      // We only want to get indices for the default configuration, everything
      // else goes in the same bucket.
      index = 9;
    }
    Services.telemetry.getHistogramById("NEWTAB_PAGE_SITE_CLICKED").add(message.data.index);
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
    // Convert sites to objects.
    let parsedSites = message.data.sites.map(site => JSON.parse(site));
    RemoteDirectoryLinksProvider.reportSitesAction(parsedSites, message.data.action, message.data.index);
  },

  /**
   * Get the set of enhanced links (if any) from the Directory Links Provider.
   */
  getEnhancedLinks: function() {
    let enhancedLinks = [];
    for (let link of RemoteNewTabUtils.links.getLinks()) {
      if (link) {
        enhancedLinks.push(RemoteDirectoryLinksProvider.getEnhancedLink(link));
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
    let extraData;
    let refreshPage = false;
    if (aTopic == "nsPref:changed") {
      switch (aData) {
        case "browser.newtabpage.enabled":
          RemoteNewTabUtils.allPages._enabled = null;
          refreshPage = true;
          extraData = Services.prefs.getBoolPref("browser.newtabpage.enabled");
          break;
        case "browser.newtabpage.enhanced":
          RemoteNewTabUtils.allPages._enhanced = null;
          refreshPage = true;
          extraData = Services.prefs.getBoolPref("browser.newtabpage.enhanced");
          break;
        case "browser.newtabpage.pinned":
          RemoteNewTabUtils.pinnedLinks.resetCache();
          break;
        case "browser.newtabpage.blocked":
          RemoteNewTabUtils.blockedLinks.resetCache();
          break;
      }
    } else if (aTopic == "browser:purge-session-history") {
        RemoteNewTabUtils.links.resetCache();
        RemoteNewTabUtils.links.populateCache(() => {
          this.pageListener.sendAsyncMessage("NewTab:UpdateLinks", {
          links: RemoteNewTabUtils.links.getLinks(),
          pinnedLinks: RemoteNewTabUtils.pinnedLinks.links,
          enhancedLinks: this.getEnhancedLinks(),
        });
      });
    }

    if (extraData !== undefined || aTopic === "page-thumbnail:create") {
      if (aTopic !== "page-thumbnail:create") {
        // Change the topic for enhanced and enabled observers.
        aTopic = aData;
      }
      this.pageListener.sendAsyncMessage("NewTab:Observe", {topic: aTopic, data: extraData});
    }

    this.pageListener.sendAsyncMessage("NewTab:UpdatePages", {
      links: RemoteNewTabUtils.links.getLinks(),
      pinnedLinks: RemoteNewTabUtils.pinnedLinks.links,
      enhancedLinks: this.getEnhancedLinks(),
      reason: RemoteNewTabUtils.links._reason,
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
