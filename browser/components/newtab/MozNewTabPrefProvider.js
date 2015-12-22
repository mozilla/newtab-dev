/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils, PromiseMessage, Task*/
/*exported NSGetFactory*/
"use strict";
const {interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PromiseMessage",
  "resource://gre/modules/PromiseMessage.jsm");

function MozNewTabPrefProvider() {}

function getMessageManager(contentWindow) {
  return contentWindow
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIDocShell)
    .sameTypeRootTreeItem
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIContentFrameMessageManager);
}


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


MozNewTabPrefProvider.prototype = {
  classDescription: "Implementation of MozNewTabPrefProvider WebIDL interface.",

  classID: Components.ID("{fec80b68-e7a0-4db5-9ebc-9b5e5756c9ca}"),

  contractID: "@mozilla.org/MozNewTabPrefProvider;1",

  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),

  init(contentWindow) {
    this._win = contentWindow;
    this._mm = getMessageManager(contentWindow);
    this._mm.addMessageListener("NewTabPrefs:Changed",
      this._fireEvent.bind(this)
    );
  },

  __init() {},

  _send(data) {
    return Task.spawn(function* () {
      const reponse = yield PromiseMessage.send(this._mm, "NewTabPrefs", data);
      return reponse.data.response;
    }.bind(this));
  },

  getCurrent(){
    const data = {
      "request": "GetCurrent",
    };
    return new this._win.Promise((resolve, reject) => {
      Task.spawn(function*(){
        const prefs = new this._win.MozPreferencesMap();
        const reply = yield this._send(data);
        Array.from(reply)
          .map(([name, value]) => [String(name), String(value)])
          .reduce(
            (maplike, [name, value]) => maplike.__set(name,value), prefs
          );
        resolve(prefs);
      }.bind(this)).catch(
        ({message}) => reject(new this._win.Error(message))
      );
    });
  },

  get onprefchange() {
    return this.__DOM_IMPL__.getEventHandler("onprefchange");
  },

  set onprefchange(handler) {
    this.__DOM_IMPL__.setEventHandler("onprefchange", handler);
  },

  _fireEvent(msg) {
    const {name, value} = msg.data;
    this._win.console.log("Trying to dispatchEvent", name, value);
    const initDict = {name, value};
    const event = new this._win.MozPrefChangeEvent("prefchange", initDict);
    this.__DOM_IMPL__.dispatchEvent(event);
  }
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozNewTabPrefProvider]);
