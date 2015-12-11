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

function MozPrefProvider() {
}

MozPrefProvider.prototype = {
  classDescription: "Defines MozPrefProvider objects",
  classID: Components.ID("{1ced49ae-2f02-49a4-914e-7da0a371e047}"),
  contractID: "@mozilla.org/MozPrefProvider;1",
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupports]),
  __init() {}
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozPrefProvider]);
