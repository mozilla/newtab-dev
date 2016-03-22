/*global
  NewTabWebChannel,
  NewTabPrefsProvider,
  NewTabSearchProvider,
  Preferences,
  XPCOMUtils,
  Task
*/

/* exported NewTabMessages */

"use strict";

const {utils: Cu} = Components;
Cu.import("resource://gre/modules/Preferences.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Task.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PreviewProvider",
                                  "resource:///modules/PreviewProvider.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NewTabPrefsProvider",
                                  "resource:///modules/NewTabPrefsProvider.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NewTabSearchProvider",
                                  "resource:///modules/NewTabSearchProvider.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NewTabWebChannel",
                                  "resource:///modules/NewTabWebChannel.jsm");

this.EXPORTED_SYMBOLS = ["NewTabMessages"];

const PREF_ENABLED = "browser.newtabpage.remote";
const CURRENT_ENGINE = "browser-search-engine-modified";

// Action names are from the content's perspective. in from chrome == out from content
// Maybe replace the ACTION objects by a bi-directional Map a bit later?
const ACTIONS = {
  prefs: {
    inPrefs: "REQUEST_PREFS",
    outPrefs: "RECEIVE_PREFS",
    action_types: new Set(["REQUEST_PREFS"]),
  },
  preview: {
    inThumb: "REQUEST_THUMB",
    outThumb: "RECEIVE_THUMB",
    action_types: new Set(["REQUEST_THUMB"]),
  },
  search: {
    inSearch: {
        UIStrings: "REQUEST_UISTRINGS",
        suggestions: "REQUEST_SEARCH_SUGGESTIONS",
        manageEngines: "REQUEST_MANAGE_ENGINES",
        state:"REQUEST_SEARCH_STATE",
        removeFormHistory: "REQUEST_REMOVE_FORM_HISTORY",
        performSearch: "REQUEST_PERFORM_SEARCH",
        cycleEngine: "REQUEST_CYCLE_ENGINE"
    },
    outSearch: {
      UIStrings: "RECEIVE_UISTRINGS",
      suggestions: "RECEIVE_SEARCH_SUGGESTIONS",
      state: "RECEIVE_SEARCH_STATE",
      currentEngine: "RECEIVE_CURRENT_ENGINE"
    },
    action_types: new Set(["REQUEST_UISTRINGS",
                          "REQUEST_SEARCH_SUGGESTIONS",
                          "REQUEST_MANAGE_ENGINES",
                          "REQUEST_SEARCH_STATE",
                          "REQUEST_REMOVE_FORM_HISTORY",
                          "REQUEST_PERFORM_SEARCH",
                          "REQUEST_CYCLE_ENGINE"]),
  }
};

let NewTabMessages = {

  _prefs: {},

  /** NEWTAB EVENT HANDLERS **/

  /*
   * Return to the originator all newtabpage prefs. A point-to-point request.
   */
  handlePrefRequest(actionName, {target}) {
    if (ACTIONS.prefs.inPrefs === actionName) {
      let results = NewTabPrefsProvider.prefs.newtabPagePrefs;
      NewTabWebChannel.send(ACTIONS.prefs.outPrefs, results, target);
    }
  },

  handlePreviewRequest(actionName, {data, target}) {
    if (ACTIONS.preview.inThumb === actionName) {
      PreviewProvider.getThumbnail(data).then(imgData => {
        NewTabWebChannel.send(ACTIONS.preview.outThumb, {url: data, imgData}, target);
      });
    }
  },

  /*
   * Return to the originator all search strings to display. A point-to-point request.
   */
  handleSearchStringsRequest(actionName, browser) {
    if (ACTIONS.search.action_types.has(actionName)) {
      let strings = NewTabSearchProvider.search.searchSuggestionUIStrings;
      NewTabWebChannel.send(ACTIONS.search.outSearch.UIStrings, strings, browser.target);
    }
  },

  /*
   * Return to the originator all search suggestions. A point-to-point request.
   */
  handleSuggestionsRequest: Task.async(function* (actionName, value) {
    let browser = value;
    let {engineName, searchString} = value.data;
    if (ACTIONS.search.action_types.has(actionName)) {
      let suggestions = yield NewTabSearchProvider.search.getSuggestions(engineName, searchString, browser);
      NewTabWebChannel.send(ACTIONS.search.outSearch.suggestions, suggestions, browser.target);
    }
  }),

  /*
   * Return the state of the search component (i.e current engine and visible engine details)
   */
  handleSearchStateRequest: Task.async(function* (actionName, browser) { // jshint unused:false
    if (ACTIONS.search.action_types.has(actionName)) {
      let state = yield NewTabSearchProvider.search.state;
      NewTabWebChannel.broadcast(ACTIONS.search.outSearch.state, state);
    }
  }),

  /*
   * Open about:preferences to manage search state
   */
  handleManageEnginesRequest(actionName, browser) {
    if (ACTIONS.search.action_types.has(actionName)) {
      NewTabSearchProvider.search.manageEngines(browser);
    }
  },

  /*
   * Remove a form history entry from the search component
   */
  handleRemoveFormHistoryRequest(actionName, value) {
    let browser = value;
    let suggestion = value.data;
    if (ACTIONS.search.action_types.has(actionName)) {
      NewTabSearchProvider.search.removeFormHistory(browser, suggestion);
    }
  },

  /*
   * Perform a search
   */
  handlePerformSearchRequest: Task.async(function* (actionName, value) {
    let browser = value;
    if (ACTIONS.search.action_types.has(actionName)) {
      yield NewTabSearchProvider.search.performSearch(browser, value.data);
    }
  }),

  /*
   * Set the new current engine
   */
  handleCycleEngineRequest(actionName, value) {
    if (ACTIONS.search.action_types.has(actionName)) {
      NewTabSearchProvider.search.cycleEngine(value.data);
    }
  },

  /*
   * Broadcast current engine has changed to all open newtab pages
   */
  _handleCurrentEngineChange(name, value) {
    if (name === CURRENT_ENGINE) {
      let engine = value;
      NewTabWebChannel.broadcast(ACTIONS.search.outSearch.currentEngine, engine);
    }
  },

  /*
   * Broadcast preference changes to all open newtab pages
   */
  handlePrefChange(actionName, value) {
    let prefChange = {};
    prefChange[actionName] = value;
    NewTabWebChannel.broadcast(ACTIONS.prefs.outPrefs, prefChange);
  },

  _handleEnabledChange(prefName, value) {
    if (prefName === PREF_ENABLED) {
      if (this._prefs.enabled && !value) {
        this.uninit();
      } else if (!this._prefs.enabled && value) {
        this.init();
      }
    }
  },

  init() {
    this.handlePrefRequest = this.handlePrefRequest.bind(this);
    this.handlePreviewRequest = this.handlePreviewRequest.bind(this);
    this.handlePrefChange = this.handlePrefChange.bind(this);
    this._handleEnabledChange = this._handleEnabledChange.bind(this);
    this._handleSearchStringsRequest = this._handleSearchStringsRequest.bind(this);
    this._handleSuggestionsRequest = this._handleSuggestionsRequest.bind(this);
    this._handleManageEnginesRequest = this._handleManageEnginesRequest.bind(this);
    this._handleSearchStateRequest = this._handleSearchStateRequest.bind(this);
    this._handleRemoveFormHistoryRequest = this._handleRemoveFormHistoryRequest.bind(this);
    this._handlePerformSearchRequest = this._handlePerformSearchRequest.bind(this);
    this._handleCycleEngineRequest = this._handleCycleEngineRequest.bind(this);

    NewTabPrefsProvider.prefs.init();
    NewTabSearchProvider.search.init();
    NewTabWebChannel.init();

    this._prefs.enabled = Preferences.get(PREF_ENABLED, false);

    if (this._prefs.enabled) {
      NewTabWebChannel.on(ACTIONS.prefs.inPrefs, this.handlePrefRequest);
      NewTabWebChannel.on(ACTIONS.preview.inThumb, this.handlePreviewRequest);
      NewTabWebChannel.on(ACTIONS.search.inSearch.UIStrings, this._handleSearchStringsRequest);
      NewTabWebChannel.on(ACTIONS.search.inSearch.suggestions, this._handleSuggestionsRequest);
      NewTabWebChannel.on(ACTIONS.search.inSearch.manageEngines, this._handleManageEnginesRequest);
      NewTabWebChannel.on(ACTIONS.search.inSearch.state, this._handleSearchStateRequest;
      NewTabWebChannel.on(ACTIONS.search.inSearch.removeFormHistory, this._handleRemoveFormHistoryRequest);
      NewTabWebChannel.on(ACTIONS.search.inSearch.performSearch, this._handlePerformSearchRequest);
      NewTabWebChannel.on(ACTIONS.search.inSearch.cycleEngine, this._handleCycleEngineRequest);

      NewTabPrefsProvider.prefs.on(PREF_ENABLED, this._handleEnabledChange);
      NewTabSearchProvider.search.on(CURRENT_ENGINE, this._handleCurrentEngineChange.bind(this));

      for (let pref of NewTabPrefsProvider.newtabPagePrefSet) {
        NewTabPrefsProvider.prefs.on(pref, this.handlePrefChange);
      }
    }
  },

  uninit() {
    this._prefs.enabled = Preferences.get(PREF_ENABLED, false);

    if (this._prefs.enabled) {
      NewTabPrefsProvider.prefs.off(PREF_ENABLED, this._handleEnabledChange);

      NewTabWebChannel.off(ACTIONS.prefs.inPrefs, this.handlePrefRequest);
      NewTabWebChannel.off(ACTIONS.prefs.inThumb, this.handlePreviewRequest);
      for (let pref of NewTabPrefsProvider.newtabPagePrefSet) {
        NewTabPrefsProvider.prefs.off(pref, this.handlePrefChange);
      }
    }

    NewTabPrefsProvider.prefs.uninit();
    NewTabSearchProvider.search.uninit();
    NewTabWebChannel.uninit();
  }
};
