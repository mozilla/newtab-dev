/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils*/
/*exported NSGetFactory*/
"use strict";
const {
  interfaces: Ci,
  utils: Cu
} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.importGlobalProperties(["URL"]);

function MozSearchSuggestion() {}


/*
interface MozSearchSuggestion {
  readonly attribute DOMString engineName;
  readonly attribute searchString;
  readonly sequence<DOMString> formHistory;
  readonly sequence<DOMString> remote;
};
 */
function out(msg) {
  dump(`
=============&&&&&&&&&&&&&============
${msg}

`);
}

function dumpObj(r) {
  dump(`\n ================ DUMPING object ${r} =========\n`);
  for (var i in r) {
    out(`${i} -> ${r[i]} (type: ${typeof r[i]})`);
  }
  return r;
}

MozSearchSuggestion.prototype = {
  classDescription: "Implementation of MozSearchSuggestion",
  classID: Components.ID("{7754952b-50d3-4734-a4e5-934e41b1f435}"),
  contractID: "@mozilla.org/MozSearchSuggestion;1",
  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),
  _engineName: "",
  _searchString: "",
  _formHistory: null,
  _remote: null,
  get engineName() {
    return this._engineName;
  },
  get searchString() {
    return this._searchString;
  },
  get formHistory() {
    return this._formHistory;
  },
  get remote() {
    return this._remote;
  },
  init(contentWindow) {
    this._win = contentWindow;
  },
  __init(suggestions) {
    dumpObj(suggestions);
    dump(suggestions.formHistory);
    dump(suggestions);
    this._engineName = suggestions.engineName;
    this._searchString = suggestions.searchString;
    this._formHistory = this._fillSafeArray(suggestions.formHistory.split(","));
    this._remote = this._fillSafeArray(suggestions.remote.split(","));
  },

  _fillSafeArray(iterable){
    let safeArray = new this._win.Array();
    safeArray.push(...iterable);
    return safeArray;
  }

};

var components = [MozSearchSuggestion];
var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
