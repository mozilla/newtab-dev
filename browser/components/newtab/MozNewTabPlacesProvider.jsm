/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils, PlacesProvider*/
/*exported NSGetFactory*/
"use strict";
const {interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
// XPCOMUtils.defineLazyModuleGetter(this, "PlacesProvider",
//   "resource:///modules/PlacesProvider.jsm");

function MozNewTabPlacesProvider() {}

MozNewTabPrefProvider.prototype = {
  classDescription: "Implementation of MozNewTabPlacesProvider WebIDL interface.",

  classID: Components.ID("{f85c1ae8-8e5e-446a-a2d8-ea54a5173e85}"),

  contractID: "@mozilla.org/MozNewTabPlacesProvider;1",

  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),

  __init() {},

  getFrecentSites(){
    return ({title: 'Github', frecency: 2000, url: 'https://github.com', type: 'history'})
  }

};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozNewTabPlacesProvider]);
