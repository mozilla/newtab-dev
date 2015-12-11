/*global XPCOMUtils*/
/*exported NSGetFactory*/
"use strict";
const {interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function MozPreferencesMap() {}

MozPreferencesMap.prototype = {
  classDescription: "Defines MozPreferencesMap objects",
  classID: Components.ID("{2d3ff5cd-6eae-44a3-bebf-ff49615fb684}"),
  contractID: "@mozilla.org/MozPreferencesMap;1",
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupports]),
  __init() {},
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozPreferencesMap]);
