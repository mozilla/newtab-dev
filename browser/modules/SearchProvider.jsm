/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*globals Services, XPCOMUtils, Task, SearchSuggestionController, PrivateBrowsingUtils, FormHistory*/

"use strict";

this.EXPORTED_SYMBOLS = [
  "SearchProvider",
];

const {
  classes: Cc,
  interfaces: Ci,
  utils: Cu,
} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Promise.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.importGlobalProperties(["URL"]);

XPCOMUtils.defineLazyModuleGetter(this, "FormHistory",
  "resource://gre/modules/FormHistory.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PrivateBrowsingUtils",
  "resource://gre/modules/PrivateBrowsingUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "SearchSuggestionController",
  "resource://gre/modules/SearchSuggestionController.jsm");

const stringBundle = Services.strings.createBundle("chrome://global/locale/autocomplete.properties");
const MAX_LOCAL_SUGGESTIONS = 3;
const MAX_SUGGESTIONS = 6;

this.SearchProvider = {
  // This is used to handle search suggestions.  It maps xul:browsers to objects
  // { controller, previousFormHistoryResult }.  See getSuggestions().
  _suggestionMap: new Map(),

  get searchSuggestionUIStrings() {
    if (this._searchSuggestionUIStrings) {
      return this._searchSuggestionUIStrings;
    }
    this._searchSuggestionUIStrings = {};
    let searchBundle = Services.strings.createBundle("chrome://browser/locale/search.properties");
    ["searchHeader", "searchPlaceholder", "searchForKeywordsWith", "searchWithHeader", "searchSettings"]
      .forEach(name => this._searchSuggestionUIStrings.set(name, searchBundle.GetStringFromName(name)));

    return this._searchSuggestionUIStrings;
  },

  get state() {
    var t = Task.spawn(function* () {
      let state = {
        engines: [],
        currentEngine: yield this.getCurrentEngine(),
      };
      let pref = Services.prefs.getCharPref("browser.search.hiddenOneOffs");
      let hiddenList = pref ? pref.split(",") : [];
      for (let engine of Services.search.getVisibleEngines()) {
        if (hiddenList.indexOf(engine.name) !== -1) {
          continue;
        }
        let uri = engine.getIconURLBySize(16, 16);
        state.engines.push({
          name: engine.name,
          iconBuffer: yield this._arrayBufferFromDataURI(uri),
        });
      }
      return state;
    }.bind(this));

    return t;
  },

  performSearch: function(browser, data) {
    this._ensureDataHasProperties(data, [
      "engineName",
      "searchString",
      "healthReportKey",
      "searchPurpose",
    ]);
    let engine = Services.search.getEngineByName(data.engineName);
    let submission = engine.getSubmission(data.searchString, "", data.searchPurpose);
    let win;
    try {
      win = browser.ownerDocument.defaultView;
    } catch (err) {
      // The browser may have been closed between the time its content sent the
      // message and the time we handle it.  In that case, trying to call any
      // method on it will throw.
      return;
    }

    let where = win.whereToOpenLink(data.originalEvent);

    // There is a chance that by the time we receive the search message, the user
    // has switched away from the tab that triggered the search. If, based on the
    // event, we need to load the search in the same tab that triggered it (i.e.
    // where == "current"), openUILinkIn will not work because that tab is no
    // longer the current one. For this case we manually load the URI.
    if (where === "current") {
      browser.loadURIWithFlags(submission.uri.spec,
        Ci.nsIWebNavigation.LOAD_FLAGS_NONE, null, null,
        submission.postData);
    } else {
      let params = {
        postData: submission.postData,
        inBackground: Services.prefs.getBoolPref("browser.tabs.loadInBackground"),
      };
      win.openUILinkIn(submission.uri.spec, where, params);
    }
    win.BrowserSearch.recordSearchInHealthReport(engine, data.healthReportKey,
      data.selection || null);
  },

  getCurrentEngine: Task.async(function* () {
    let engine = Services.search.currentEngine;
    let favicon = engine.getIconURLBySize(16, 16);
    let uri1x = engine.getIconURLBySize(65, 26);
    let uri2x = engine.getIconURLBySize(130, 52);
    let placeholder = stringBundle.formatStringFromName(
      "searchWithEngine", [engine.name], 1);
    let obj = {
      name: engine.name,
      placeholder: placeholder,
      iconBuffer: yield this._arrayBufferFromDataURI(favicon),
      logoBuffer: yield this._arrayBufferFromDataURI(uri1x),
      logo2xBuffer: yield this._arrayBufferFromDataURI(uri2x),
      preconnectOrigin: new URL(engine.searchForm).origin,
    };
    return obj;
  }),

  getSuggestions: Task.async(function* (browser, data) {
    this._ensureDataHasProperties(data, [
      "engineName",
      "searchString",
    ]);

    let engine = Services.search.getEngineByName(data.engineName);
    if (!engine) {
      throw new Error("Unknown engine name: " + data.engineName);
    }

    let browserData = this._suggestionDataForBrowser(browser, true);
    let {
      controller
    } = browserData;
    let ok = SearchSuggestionController.engineOffersSuggestions(engine);
    controller.maxLocalResults = ok ? MAX_LOCAL_SUGGESTIONS : MAX_SUGGESTIONS;
    controller.maxRemoteResults = ok ? MAX_SUGGESTIONS : 0;
    controller.remoteTimeout = data.remoteTimeout || undefined;
    let priv = PrivateBrowsingUtils.isBrowserPrivate(browser);
    // fetch() rejects its promise if there's a pending request, but since we
    // process our event queue serially, there's never a pending request.
    let suggestions = yield controller.fetch(data.searchString, priv, engine);

    if (!suggestions) {
      throw new Error("Suggestions is null");
    }

    // Keep the form history result so RemoveFormHistoryEntry can remove entries
    // from it.  Keeping only one result isn't foolproof because the client may
    // try to remove an entry from one set of suggestions after it has requested
    // more but before it's received them.  In that case, the entry may not
    // appear in the new suggestions.  But that should happen rarely.
    browserData.previousFormHistoryResult = suggestions.formHistoryResult;

    let suggestion = {
      engineName: data.engineName,
      searchString: suggestions.term,
      formHistory: suggestions.local,
      remote: suggestions.remote,
    };

    return suggestion;
  }),

  addFormHistoryEntry: function(browser, entry) {
    let isPrivate = true;
    try {
      // isBrowserPrivate assumes that the passed-in browser has all the normal
      // properties, which won't be true if the browser has been destroyed.
      // That may be the case here due to the asynchronous nature of messaging.
      isPrivate = PrivateBrowsingUtils.isBrowserPrivate(browser);
    } catch (err) {}
    if (isPrivate || entry === "") {
      return Promise.resolve();
    }
    let browserData = this._suggestionDataForBrowser(browser, true);
    FormHistory.update({
      op: "bump",
      fieldname: browserData.controller.formHistoryParam,
      value: entry,
    }, {
      handleCompletion: () => {},
      handleError: err => {
        Cu.reportError("Error adding form history entry: " + err);
      },
    });
  },

  removeFormHistoryEntry: function(browser, suggestionStr) {
    let browserData = this._suggestionDataForBrowser(browser);
    if (!browserData && !browserData.previousFormHistoryResult) {
      return;
    }
    let {
      previousFormHistoryResult
    } = browserData;
    for (let i = 0; i < previousFormHistoryResult.matchCount; i++) {
      if (previousFormHistoryResult.getValueAt(i) === suggestionStr) {
        previousFormHistoryResult.removeValueAt(i, true);
        break;
      }
    }
  },

  _suggestionDataForBrowser: function(browser, create = false) {
    let data = this._suggestionMap.get(browser);
    if (!data && create) {
      // Since one SearchSuggestionController instance is meant to be used per
      // autocomplete widget, this means that we assume each xul:browser has at
      // most one such widget.
      data = {
        controller: new SearchSuggestionController(),
      };
      this._suggestionMap.set(browser, data);
    }
    return data;
  },

  _arrayBufferFromDataURI: function(uri) {
    if (!uri) {
      return Promise.resolve(null);
    }
    let deferred = Promise.defer();
    let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
    createInstance(Ci.nsIXMLHttpRequest);
    xhr.open("GET", uri, true);
    xhr.responseType = "arraybuffer";
    xhr.onloadend = () => {
      deferred.resolve(xhr.response);
    };
    try {
      // This throws if the URI is erroneously encoded.
      xhr.send();
    } catch (err) {
      return Promise.resolve(null);
    }
    return deferred.promise;
  },

  _ensureDataHasProperties: function(data, requiredProperties) {
    for (let prop of requiredProperties) {
      if (!(prop in data)) {
        throw new Error("Message data missing required property: " + prop);
      }
    }
  },
};
