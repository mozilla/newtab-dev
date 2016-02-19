/* global XPCOMUtils, ContentSearch, Task, Services, EventEmitter */
/* exported NewTabSearchProvider */

"use strict";

this.EXPORTED_SYMBOLS = ["NewTabSearchProvider"];

const {utils: Cu, interfaces: Ci} = Components;
const CURRENT_ENGINE = "browser-search-engine-modified";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "ContentSearch",
                                  "resource:///modules/ContentSearch.jsm");

XPCOMUtils.defineLazyGetter(this, "EventEmitter", function() {
  const {EventEmitter} = Cu.import("resource://devtools/shared/event-emitter.js", {});
  return EventEmitter;
});

let SearchProvider = function SearchProvider() {
  EventEmitter.decorate(this);
};

SearchProvider.prototype = {

  observe(subject, topic, data) { // jshint unused:false
    if (topic === CURRENT_ENGINE && data === "engine-current") {
      Task.spawn(function* () {
        let state = yield ContentSearch.currentStateObj(true);
        let engine = state.currentEngine;
        this.emit(CURRENT_ENGINE, engine);
      }.bind(this));
    } else if (data === "engine-default") {
      // engine-default is always sent with engine-current and isn't
      // relevant to content searches.
      return;
    }
    else {
      Cu.reportError(new Error("NewTabSearchProvider observing unknown topic"));
    }
  },

  init() {
    Services.obs.addObserver(this, CURRENT_ENGINE, true);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
    Ci.nsISupportsWeakReference
  ]),

  uninit() {
    Services.obs.removeObserver(this, CURRENT_ENGINE, true);
  },

  get state() {
    return Task.spawn(function* () {
      let state = yield ContentSearch.currentStateObj(true);
      return state;
    }.bind(this));
  },

  get searchSuggestionUIStrings() {
    return ContentSearch.searchSuggestionUIStrings;
  },

  removeFormHistory(event, suggestion) {
    ContentSearch.removeFormHistoryEntry({target: event.target.browser}, suggestion);
  },

  performSearch(event, searchData) {
    return Task.spawn(function* () {
      ContentSearch.performSearch({target: event.target.browser}, searchData);
      yield ContentSearch.addFormHistoryEntry({target: event.target.browser}, searchData.searchString);
    }.bind(this));
  },

  manageEngines(browser) {
    let browserWin = browser.target.browser.ownerDocument.defaultView;
    browserWin.openPreferences("paneSearch");
  },

  cycleEngine(engineName) {
    return Task.spawn(function* () {
      Services.search.currentEngine = Services.search.getEngineByName(engineName);
      let state = yield ContentSearch.currentStateObj(true);
      let newEngine = state.currentEngine;
      this.emit(CURRENT_ENGINE, newEngine);
    }.bind(this));
  },

  getSuggestions(engineName, searchString, event) {
    return Task.spawn(function* () {
      let suggestions = ContentSearch.getSuggestions(engineName, searchString, event.target.browser);
      return suggestions;
    }.bind(this));
  },
};

const gSearch = new SearchProvider();

let NewTabSearchProvider = {
  search: gSearch,
};
