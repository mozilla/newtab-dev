/* global XPCOMUtils, ContentSearch, Task, dump*/
/* exported NewTabSearchProvider */

"use strict";

this.EXPORTED_SYMBOLS = ["NewTabSearchProvider"];

const {utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Task.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "ContentSearch",
                                  "resource:///modules/ContentSearch.jsm");
let NewTabSearchProvider = {

  get state() {
    return Task.spawn(function* () {
      let state = yield ContentSearch.currentStateObj();
      return state;
    }.bind(this));
  },

  removeFormHistory() {
    dump("remove form history");
  },

  setCurrentEngine() {
    dump("set current engine");
  },

  get searchSuggestionUIStrings() {
    return ContentSearch.searchSuggestionUIStrings;
  },

  getSuggestions(engineName, searchString, browser) {
    return Task.spawn(function* () {
      let suggestions = ContentSearch.getSuggestions(engineName, searchString, browser);
      return suggestions;
    }.bind(this));
  },
};
