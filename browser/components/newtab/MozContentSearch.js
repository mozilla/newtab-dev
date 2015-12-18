/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils, PromiseMessage, dump, Task*/
/*exported NSGetFactory*/
/*
GetSuggestions
SetCurrentEngine
SpeculativeConnect
 */
"use strict";
const {
  interfaces: Ci,
  utils: Cu
} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PromiseMessage",
  "resource://gre/modules/PromiseMessage.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "ContentSearch",
  "resource:///modules/ContentSearch.jsm");
Cu.import("resource://gre/modules/Task.jsm");

function out(msg) {
  dump(`
=============&&&&&&&&&&&&&============
${msg}

`);
}

function dumpResult(r) {
  dump(`\n ================ DUMPING RESULT ${r} =========\n`);
  for (var i in r) {
    out(`${i} -> ${r[i]}`);
  }
  return r;
}

function MozContentSearch() {
  out("Created MozContentSearch....");
}

function getMessageManager(contentWindow) {
  out("getting message manager form getMessageManager");
  return contentWindow
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIDocShell)
    .sameTypeRootTreeItem
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIContentFrameMessageManager);
}

MozContentSearch.prototype = {
  classDescription: "Provides a WebIDL wrapper for ContentSearch",
  classID: Components.ID("{4f33efd5-f87d-4420-bec9-a411ce297973}"),
  contractID: "@mozilla.org/MozContentSearch;1",
  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),
  _UIStrings: null,
  _contentWindow: null,
  _mm: null,
  _engineCache: new Map(),
  init(contentWindow) {
    this._mm = getMessageManager(contentWindow);
    this._mm.addMessageListener("ContentSearch", this.handleContentSearch.bind(this));
    this._win = contentWindow;
    out("Finished initializing MozContentSearch");
  },

  _processUIStrings(uiStringsObj) {
    const uiStrings = new this._win.MozSearchUIStrings();
    Object.getOwnPropertyNames(uiStringsObj)
      .map(
        (name) => [String(name), String(uiStringsObj[name])]
      )
      .reduce(
        (maplike, [name, value]) => maplike.__set(name, value), uiStrings
      );
    return uiStrings;
  },

  _modifyFormHistory(type, entry) {
    const data = {
      type,
      data: entry,
    };
    return new this._win.Promise((resolve, reject) => {
      Task.spawn(function* () {
        const result = yield this._send(data);
        resolve(result);
      }.bind(this)).catch(
        ({message}) => reject(new this._win._Error(message))
      );
    });
  },

  getVisibleEngines() {
    const data = {
      type: "GetVisibleEngines",
      data: null,
    };
    return new this._win.Promise((resolve, reject) => {
      Task.spawn(function* () {
        const response = yield this._send(data);
        const engines = response.map(
          engineDetails => new this._win.MozSearchEngineDetails(engineDetails)
        )
        const safeArray = new this._win.Array();
        safeArray.push(...engines);
        resolve(safeArray);
      }.bind(this)).catch(
        ({message}) => reject(new this._win.Error(message))
      );
    });
  },

  get UIStrings() {
    if (this._UIStrings) {
      return this._win.Promise.resolve(this._UIStrings);
    }
    const data = {
      type: "GetStrings",
      data: null,
    };
    return new this._win.Promise((resolve, reject) => {
      Task.spawn(function* () {
        const strings = yield this._send(data);
        this._UIStrings = this._processUIStrings(strings);
        resolve(this._UIStrings);
      }.bind(this)).catch(
        ({message}) => reject(new this._win.Error(message))
      );
    });
  },

  addFormHistoryEntry(entry) {
    return this._modifyFormHistory("AddFormHistoryEntry", entry);
  },

  removeFormHistoryEntry(entry) {
    return this._modifyFormHistory("RemoveFormHistoryEntry", entry);
  },

  performSearch(searchEngineQuery) {
    const data = {
      type: "Search",
      data: searchEngineQuery,
    };
    this._mm.sendAsyncMessage("ContentSearch", data);
  },

  getSuggestions(searchSuggestionQuery) {
    const data = {
      type: "GetSuggestions",
      data: searchSuggestionQuery,
    };
    return new this._win.Promise((resolve, reject) => {
      Task.spawn(function* () {
        out("here we go!")
        const response = yield this._send(data);
        out("got responose" + JSON.stringify(response, null, 2));
        const suggestion = new this._win.MozSearchSuggestion(response);
        out("constructed suggestion");
        resolve(suggestion);
        out("resolved");
      }.bind(this)).catch(
        ({message}) => reject(new this._win.Error(message))
      );
    });
  },

  manageEngines() {
    const data = {
      type: "ManageEngines",
      data: null,
    };
    this._mm.sendAsyncMessage("ContentSearch", data);
  },

  getCurrentEngine() {
    const data = {
      type: "GetCurrentEngineDetails",
      data: null,
    };
    return new this._win.Promise((resolve, reject) => {
      Task.spawn(function* () {
        const rawEngineDetails = yield this._send(data);
        const mozEngine = new this._win.MozSearchEngineDetails(rawEngineDetails);
        resolve(mozEngine);
      }.bind(this)).catch(
        ({message}) => reject(new this._win.Error(message))
      );
    });
  },

  _storeEngine(engineDetails) {
    if (!this._engineCache.has(engineDetails.name)) {
      let engine = new this._win.MozSearchEngineDetails(engineDetails);
      this._engineCache.set(engine.name, engine);
    }
    return this._engineCache.get(engineDetails.name);
  },

  handleContentSearch({data: {data}, data: {type}}) {
    switch (type) {
      // Default search engine has changed!
    case "CurrentEngine":
      this._fireEngineChangeEvent(data.name);
      break;
    case "Strings":
      this._UIStrings = this._processUIStrings(data);
      break;
    }
  },

  get onenginechange() {
    return this.__DOM_IMPL__.getEventHandler("onenginechange");
  },

  set onenginechange(handler) {
    this.__DOM_IMPL__.setEventHandler("onenginechange", handler);
  },

  _fireEngineChangeEvent(name) {
    const data = {
      type: "GetEngineDetails",
      data: name,
    };
    Task.spawn(function* () {
      const rawEngineDetails = yield this._send(data);
      const engine = this._storeEngine(rawEngineDetails);
      const eventInit = {
        engine
      };
      const event = new this._win.MozSearchEngineChangeEvent("enginechange", eventInit);
      this.__DOM_IMPL__.dispatchEvent(event);
    }.bind(this));
  },

  _send(data) {
    return Task.spawn(function* () {
      const reply = yield PromiseMessage.send(this._mm, "ContentSearch", data);
      return reply.data.data;
    }.bind(this));
  },

  __init() {}
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozContentSearch]);
