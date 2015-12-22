/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils*/
/*exported NSGetFactory*/

"use strict";

const {interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function MozHistorySite() {}

MozHistorySite.prototype = {
  classDescription: "Defines MozHistorySite objects",
  classID: Components.ID("{e5f9cd86-862a-4dc0-9007-5937e16df73b}"),
  contractID: "@mozilla.org/MozHistorySite;1",
  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),

  _frecency: null,
  _url: null,
  _title: null,
  _type: null,
  _lastVisitDate: null,

  get frecency() {
    return this._frecency;
  },
  get url() {
    return this._url;
  },
  get title() {
    return this._title;
  },
  get type() {
    return this._type;
  },
  get lastVisitDate() {
    return this._lastVisitDate;
  },

  init(contentWindow) {
    this._win = contentWindow;
  },

  __init(site) {
    const {frecency, url, title, type, lastVisitDate} = site || {};
    this._frecency = frecency;
    this._url = url;
    this._title = title;
    this._type = type;
    this._lastVisitDate = lastVisitDate;
  },

  toJSON() {
    return JSON.stringify({
      frecency: this._frecency,
      title: this._title,
      url: this._url,
      type: this._type,
      lastVisitDate: this._lastVisitDate
    });
  }
};

var components = [MozHistorySite];
var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
