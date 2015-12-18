/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils, NewTabPrefsProvider*/
/*exported NSGetFactory*/
"use strict";
const {interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NewTabPrefsProvider",
  "resource:///modules/NewTabPrefsProvider.jsm");

function MozNewTabPrefProvider() {}

MozNewTabPrefProvider.prototype = {
  classDescription: "Implementation of MozNewTabPrefProvider WebIDL interface.",

  classID: Components.ID("{fec80b68-e7a0-4db5-9ebc-9b5e5756c9ca}"),

  contractID: "@mozilla.org/MozNewTabPrefProvider;1",

  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),

  init(contentWindow) {
    this._win = contentWindow;
    this._setUpPrefChangeListeners();
  },

  __init() {},

  _setUpPrefChangeListeners(){
    function observePref(name){
      return (handler) => {
          const pref = `browser.newtabpage.${name}`;
          NewTabPrefsProvider.prefs.on(pref,
            (pref, change) => handler(pref, change)
          );
          return handler;
      };
    }
    const prefNames = ["enabled", "enhanced", "pinned"];
    const dispatcher = this._fireEvent.bind(this);
    prefNames
      .map(observePref)
      .reduce(
        (handler, observer) => observer(handler), dispatcher
      );
  },

  getCurrent(){
    const prefs = new this._win.MozPreferencesMap();
    Array.from(NewTabPrefsProvider.prefs.currentPrefs().entries())
      .map(([name, value]) => [String(name), String(value)])
      .reduce(
        (maplike, [name, value]) => maplike.__set(name,value), prefs
      );
    return prefs;
  },

  get onprefchange() {
    return this.__DOM_IMPL__.getEventHandler("onprefchange");
  },

  set onprefchange(handler) {
    this.__DOM_IMPL__.setEventHandler("onprefchange", handler);
  },

  _fireEvent(pref, change) {
    this._win.console.log("Trying to dispatchEvent", pref, change);
    const eventDetail = Cu.cloneInto({detail: {pref, change}}, this._win);
    const event = new this._win.CustomEvent("prefchange", eventDetail);
    this.__DOM_IMPL__.dispatchEvent(event);
  }
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozNewTabPrefProvider]);
