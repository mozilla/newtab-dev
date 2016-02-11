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

XPCOMUtils.defineLazyModuleGetter(this, "NewTabPrefsProvider",
                                  "resource:///modules/NewTabPrefsProvider.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NewTabSearchProvider",
                                  "resource:///modules/NewTabSearchProvider.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NewTabWebChannel",
                                  "resource:///modules/NewTabWebChannel.jsm");

this.EXPORTED_SYMBOLS = ["NewTabMessages"];

const PREF_ENABLED = "browser.newtabpage.remote";

// Action names are from the content's perspective. in from chrome == out from content
// Maybe replace the ACTION objects by a bi-directional Map a bit later?
const ACTIONS = {
  prefs: {
    inPrefs: "REQUEST_PREFS",
    outPrefs: "RECEIVE_PREFS",
    action_types: new Set(["REQUEST_PREFS", "RECEIVE_PREFS"]),
  },
  search: {
    inSearch: {
        UIStrings: "REQUEST_UISTRINGS",
        suggestions: "REQUEST_SEARCH_SUGGESTIONS",
        manageEngines: "REQUEST_MANAGE_ENGINES",
        state:"REQUEST_SEARCH_STATE"
    },
    outSearch: {
      UIStrings: "RECEIVE_UISTRINGS",
      suggestions: "RECEIVE_SEARCH_SUGGESTIONS",
      state: "RECEIVE_SEARCH_STATE"
    },
    action_types: new Set(["REQUEST_UISTRINGS",
                          "REQUEST_SEARCH_SUGGESTIONS",
                          "REQUEST_MANAGE_ENGINES",
                          "REQUEST_SEARCH_STATE"]),
  }
};

let NewTabMessages = {

  _prefs: {},

  /** NEWTAB EVENT HANDLERS **/

  /*
   * Return to the originator all newtabpage prefs. A point-to-point request.
   */
  handlePrefRequest(actionName, browser) {  // jshint unused:false
    if (ACTIONS.prefs.action_types.has(actionName)) {
      let results = NewTabPrefsProvider.prefs.newtabPagePrefs;
      NewTabWebChannel.send(ACTIONS.prefs.outPrefs, results, browser.target);
    }
  },

  handleSearchStringsRequest(actionName, browser) {  // jshint unused:false
    if (ACTIONS.search.action_types.has(actionName)) {
      let strings = NewTabSearchProvider.searchSuggestionUIStrings;
      NewTabWebChannel.broadcast(ACTIONS.search.outSearch.UIStrings, strings, browser.target);
    }
  },

  handleSuggestionsRequest: Task.async(function* (actionName, value) {  // jshint unused:false
    let browser = value.target;
    let {engineName, searchString} = value.data;
    if (ACTIONS.search.action_types.has(actionName)) {
      let suggestions = yield NewTabSearchProvider.getSuggestions(engineName, searchString, browser);
      NewTabWebChannel.broadcast(ACTIONS.search.outSearch.suggestions, suggestions, browser);
    }
  }),

  handleManageEnginesRequest(actionName, browser) { // jshint unused:false
    if (ACTIONS.search.action_types.has(actionName)) {
      let browserWin = browser.target.browser.ownerDocument.defaultView;
      browserWin.openPreferences("paneSearch");
    }
  },

  handleSearchStateRequest: Task.async(function* (actionName, browser) {
    if (ACTIONS.search.action_types.has(actionName)) {
      let state = yield NewTabSearchProvider.state;
      NewTabWebChannel.broadcast(ACTIONS.search.outSearch.state, state, browser.target);
    }
  }),

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
    this._prefs.enabled = Preferences.get(PREF_ENABLED, false);

    if (this._prefs.enabled) {
      NewTabWebChannel.on(ACTIONS.prefs.inPrefs, this.handlePrefRequest.bind(this));
      NewTabPrefsProvider.prefs.on(PREF_ENABLED, this._handleEnabledChange.bind(this));
      NewTabWebChannel.on(ACTIONS.search.inSearch.UIStrings, this.handleSearchStringsRequest.bind(this));
      NewTabWebChannel.on(ACTIONS.search.inSearch.suggestions, this.handleSuggestionsRequest.bind(this));
      NewTabWebChannel.on(ACTIONS.search.inSearch.manageEngines, this.handleManageEnginesRequest.bind(this));
      NewTabWebChannel.on(ACTIONS.search.inSearch.state, this.handleSearchStateRequest.bind(this));

      for (let pref of NewTabPrefsProvider.newtabPagePrefSet) {
        NewTabPrefsProvider.prefs.on(pref, this.handlePrefChange.bind(this));
      }
    }
  },

  uninit() {
    this._prefs.enabled = Preferences.get(PREF_ENABLED, false);

    if (this._prefs.enabled) {
      NewTabPrefsProvider.prefs.off(PREF_ENABLED, this._handleEnabledChange);

      NewTabWebChannel.off(ACTIONS.prefs.inPrefs, this.handlePrefRequest);
      for (let pref of NewTabPrefsProvider.newtabPagePrefSet) {
        NewTabPrefsProvider.prefs.off(pref, this.handlePrefChange);
      }
    }
  }
};
