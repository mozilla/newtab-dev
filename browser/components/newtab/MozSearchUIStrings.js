/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils*/
/*exported NSGetFactory*/
"use strict";
const {interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function MozSearchUIStrings() {}

MozSearchUIStrings.prototype = {
  classDescription: "Defines MozSearchUIStrings objects",
  classID: Components.ID("{f5feac3f-82e2-4ed0-bf04-6e757b5a7dfc}"),
  contractID: "@mozilla.org/MozSearchUIStrings;1",
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupports]),
  __init() {},
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozSearchUIStrings]);
