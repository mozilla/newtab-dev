/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils*/
/*exported NSGetFactory*/
"use strict";
const {interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function MozEngineChangeEvent() {}

MozEngineChangeEvent.prototype = {
  this._engine: null,
  __init(type, eventInitDict) {
    this._engine = eventInitDict.engine;
  },
  get engine(){
    return this._engine;
  },
  classDescription: "Implementation of MozEngineChangeEvent",
  classID: Components.ID("{797fa325-b133-4ade-bf65-f60fba409a36}"),
  contractID: "@mozilla.org/MozEngineChangeEvent;1",
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupports]),
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozEngineChangeEvent]);
