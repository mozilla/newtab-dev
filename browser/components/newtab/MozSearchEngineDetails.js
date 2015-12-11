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

function MozSearchEngineDetails() {}

MozSearchEngineDetails.prototype = {
  contentWindow: undefined,
  _win: null,
  _name: null,
  _placeholder: null,
  _icons: null,
  get name() {
    return this._name;
  },
  get placeholder() {
    return this._placeholder;
  },
  get preconnectOrigin() {
    return this._preconnectOrigin;
  },
  get icons() {
    return this._icons;
  },
  init(contentWindow) {
    this._win = contentWindow;
  },
  classDescription: "Defines MozSearchEngineDetails objects",
  classID: Components.ID("{d664953c-1733-45df-aceb-ec4436fe9c49}"),
  contractID: "@mozilla.org/MozSearchEngineDetails;1",
  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),
  __init({name, placeholder, icons}) {
    this._name = name;
    this._placeholder = placeholder;
    this._icons = icons.map(this._toMozSearchIcon, this);
  },
  _toMozSearchIcon({width, height, url}){
    return new this._win.MozSearchIcon(width, height, url);
  },
};

var components = [MozSearchEngineDetails];
var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
