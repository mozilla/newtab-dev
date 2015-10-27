/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* globals Services, XPCOMUtils, RemotePages, SearchProvider, RemoteNewTabLocation, RemoteNewTabUtils, Task  */
/* globals BackgroundPageThumbs, PageThumbs, DirectoryLinksProvider, PlacesProvider */

/* exported RemoteAboutNewTab */

"use strict";

let Ci = Components.interfaces;
let Cu = Components.utils;
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

this.EXPORTED_SYMBOLS = ["RemoteAboutNewTab"];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.importGlobalProperties(["URL"]);

XPCOMUtils.defineLazyModuleGetter(this, "RemotePages",
  "resource://gre/modules/RemotePageManager.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "RemoteNewTabUtils",
  "resource:///modules/RemoteNewTabUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "BackgroundPageThumbs",
  "resource://gre/modules/BackgroundPageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbs",
  "resource://gre/modules/PageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "DirectoryLinksProvider",
  "resource:///modules/DirectoryLinksProvider.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "RemoteNewTabLocation",
  "resource:///modules/RemoteNewTabLocation.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "SearchProvider",
  "resource:///modules/SearchProvider.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PlacesProvider",
  "resource:///modules/PlacesProvider.jsm");

let RemoteAboutNewTab = {

  pageListener: null,

  /**
   * Initialize the RemotePageManager and add all message listeners for this page
   */
  init: function() {
    this.pageListener = new RemotePages("about:remote-newtab");
    this.pageListener.addMessageListener("NewTab:InitializeGrid", this.initializeGrid.bind(this));
    this.pageListener.addMessageListener("NewTab:UpdateGrid", this.updateGrid.bind(this));
    this.pageListener.addMessageListener("NewTab:CaptureBackgroundPageThumbs",
      this.captureBackgroundPageThumb.bind(this));
    this.pageListener.addMessageListener("NewTab:PageThumbs", this.createPageThumb.bind(this));
    this.pageListener.addMessageListener("NewTab:Search", this.search.bind(this));
    this.pageListener.addMessageListener("NewTab:GetState", this.getState.bind(this));
    this.pageListener.addMessageListener("NewTab:GetStrings", this.getStrings.bind(this));
    this.pageListener.addMessageListener("NewTab:GetSuggestions", this.getSuggestions.bind(this));
    this.pageListener.addMessageListener("NewTab:RemoveFormHistoryEntry", this.removeFormHistoryEntry.bind(this));
    this.pageListener.addMessageListener("NewTab:ManageEngines", this.manageEngines.bind(this));
    this.pageListener.addMessageListener("NewTab:SetCurrentEngine", this.setCurrentEngine.bind(this));
    this.pageListener.addMessageListener("NewTabFrame:GetInit", this.initContentFrame.bind(this));

    this._addObservers();
  },

  search: function(message) {
    SearchProvider.performSearch(message.target.browser, message.data);
  },

  getState: Task.async(function* (message) {
    let state = yield SearchProvider.state;
    message.target.sendAsyncMessage("NewTab:ContentSearchService", {
      state,
      name: "State",
    });
  }),

  getStrings: function(message) {
    let strings = SearchProvider.searchSuggestionUIStrings;
    message.target.sendAsyncMessage("NewTab:ContentSearchService", {
      strings,
      name: "Strings",
    });
  },

  getSuggestions: Task.async(function* (message) {
    let suggestion = yield SearchProvider.getSuggestions(message.target.browser, message.data);
    message.target.sendAsyncMessage("NewTab:ContentSearchService", {
      suggestion,
      name: "Suggestions",
    });
  }),

  removeFormHistoryEntry: function(message) {
    SearchProvider.removeFormHistoryEntry(message.target.browser, message.data.suggestionStr);
  },

  manageEngines: function(message) {
    let browserWin = message.target.browser.ownerDocument.defaultView;
    browserWin.openPreferences("paneSearch");
  },

  setCurrentEngine: function(message) {
    Services.search.currentEngine = Services.search.getEngineByName(message.data.engineName);
  },

  /**
   * Notifies when history is cleared
   */
  placesClearHistory: function() {
    this.pageListener.sendAsyncMessage("NewTab:PlacesClearHistory");
  },

  /**
   * Notifies when a link has changed
   */
  placesLinkChanged: function(link) {
    this.pageListener.sendAsyncMessage("NewTab:PlacesLinkChanged", link);
  },

  /**
   * Notifies when many links have changed
   */
  placesManyLinksChanged: function() {
    this.pageListener.sendAsyncMessage("NewTab:PlacesManyLinksChanged");
  },

  /**
   * Notifies when one URL has been deleted
   */
  placesDeleteURI: function(data) {
    this.pageListener.sendAsyncMessage("NewTab:PlacesDeleteURI", data);
  },

  /**
   * Initializes the grid for the first time when the page loads.
   * Fetch all the links and send them down to the child to populate
   * the grid with.
   *
   * @param {Object} message
   *        A RemotePageManager message.
   */
  initializeGrid: Task.async(function*(message) {
    let placesLinks = yield PlacesProvider.links.getLinks();

    RemoteNewTabUtils.links.populateCache(() => {
      message.target.sendAsyncMessage("NewTab:InitializeLinks", {
        links: RemoteNewTabUtils.links.getLinks(),
        enhancedLinks: this.getEnhancedLinks(),
        placesLinks
      });
    });
  }),

  /**
   * Inits the content iframe with the newtab location
   */
  initContentFrame: function(message) {
    message.target.sendAsyncMessage("NewTabFrame:Init", {
      href: RemoteNewTabLocation.href,
      origin: RemoteNewTabLocation.origin
    });
  },

  /**
   * Updates the grid by getting a new set of links.
   *
   * @param {Object} message
   *        A RemotePageManager message.
   */
  updateGrid: function(message) {
    message.target.sendAsyncMessage("NewTab:UpdateLinks", {
      links: RemoteNewTabUtils.links.getLinks(),
      enhancedLinks: this.getEnhancedLinks(),
    });
  },

  /**
   * Captures the site's thumbnail in the background, then attemps to show the thumbnail.
   *
   * @param {Object} message
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
      Cu.reportError("error: " + err);
    }
  }),

  /**
   * Creates the thumbnail to display for each site based on the unique URL
   * of the site and it's type (regular or enhanced). If the thumbnail is of
   * type "regular", we create a blob and send that down to the child. If the
   * thumbnail is of type "enhanced", get the file path for the URL and create
   * and enhanced URI that will be sent down to the child.
   *
   * @param {Object} message
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
  createPageThumb: function(message) {
    let imgSrc = PageThumbs.getThumbnailURL(message.data.link.url);
    let doc = Services.appShell.hiddenDOMWindow.document;
    let img = doc.createElementNS(XHTML_NAMESPACE, "img");
    let canvas = doc.createElementNS(XHTML_NAMESPACE, "canvas");
    let enhanced = Services.prefs.getBoolPref("browser.newtabpage.enhanced");

    img.onload = function() {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(this, 0, 0, this.naturalWidth, this.naturalHeight);
      canvas.toBlob(function(blob) {
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
   * Get the set of enhanced links (if any) from the Directory Links Provider.
   */
  getEnhancedLinks: function() {
    let enhancedLinks = [];
    for (let link of RemoteNewTabUtils.links.getLinks()) {
      if (link) {
        enhancedLinks.push(DirectoryLinksProvider.getEnhancedLink(link));
      }
    }
    return enhancedLinks;
  },

  /**
   * Listens for a preference change, a session purge for all pages, or if the
   * current search engine is modified, and sends a message to update the pages
   * that are open. If a session purge occured, also clear the links cache and
   * update the set of links to display, as they may have changed, then proceed
   * with the page update.
   */
  observe: function(aSubject, aTopic, aData) { // jshint ignore:line
    let extraData;
    if (aTopic === "browser:purge-session-history") {
      RemoteNewTabUtils.links.resetCache();
      RemoteNewTabUtils.links.populateCache(() => {
        this.pageListener.sendAsyncMessage("NewTab:UpdateLinks", {
          links: RemoteNewTabUtils.links.getLinks(),
          enhancedLinks: this.getEnhancedLinks(),
        });
      });
    } else if (aTopic === "browser-search-engine-modified" && aData === "engine-current") {
      Task.spawn(function* () {
        try {
          let engine = yield SearchProvider.currentEngine;
          this.pageListener.sendAsyncMessage("NewTab:ContentSearchService", {
            engine, name: "CurrentEngine"
          });
        } catch (e) {
          Cu.reportError(e);
        }
      }.bind(this));
    } else if (aTopic === "nsPref:changed" && aData === "browser.search.hiddenOneOffs") {
      Task.spawn(function* () {
        try {
          let state = yield SearchProvider.state;
          this.pageListener.sendAsyncMessage("NewTab:ContentSearchService", {
            state, name: "CurrentState"
          });
        } catch (e) {
          Cu.reportError(e);
        }
      }.bind(this));
    }

    if (extraData !== undefined || aTopic === "page-thumbnail:create") {
      if (aTopic !== "page-thumbnail:create") {
        // Change the topic for enhanced and enabled observers.
        aTopic = aData;
      }
      this.pageListener.sendAsyncMessage("NewTab:Observe", {
        topic: aTopic,
        data: extraData
      });
    }
  },

  /**
   * Add all observers that about:newtab page must listen for.
   */
  _addObservers: function() {
    Services.obs.addObserver(this, "page-thumbnail:create", true);
    Services.obs.addObserver(this, "browser:purge-session-history", true);
    Services.prefs.addObserver("browser.search.hiddenOneOffs", this, false);
    Services.obs.addObserver(this, "browser-search-engine-modified", true);
    PlacesProvider.links.on("deleteURI", this.placesDeleteURI.bind(this));
    PlacesProvider.links.on("clearHistory", this.placesClearHistory.bind(this));
    PlacesProvider.links.on("linkChanged", this.placesLinkChanged.bind(this));
    PlacesProvider.links.on("manyLinksChanged", this.placesManyLinksChanged.bind(this));
  },

  /**
   * Remove all observers on the page.
   */
  _removeObservers: function() {
    Services.obs.removeObserver(this, "page-thumbnail:create");
    Services.obs.removeObserver(this, "browser:purge-session-history");
    Services.prefs.removeObserver("browser.search.hiddenOneOffs", this);
    Services.obs.removeObserver(this, "browser-search-engine-modified");
    PlacesProvider.links.off("deleteURI", this.placesDeleteURI);
    PlacesProvider.links.off("clearHistory", this.placesClearHistory);
    PlacesProvider.links.off("linkChanged", this.placesLinkChanged);
    PlacesProvider.links.off("manyLinksChanged", this.placesManyLinksChanged);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
    Ci.nsISupportsWeakReference
  ]),

  uninit: function() {
    this._removeObservers();
    this.pageListener.destroy();
    this.pageListener = null;
  },
};
