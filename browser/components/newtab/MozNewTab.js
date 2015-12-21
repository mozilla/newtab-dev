/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils, BackgroundPageThumbs, PromiseMessage*/
/*exported NSGetFactory*/
"use strict";
const {
  interfaces: Ci,
  utils: Cu
} = Components;
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.importGlobalProperties(["URL"]);
XPCOMUtils.defineLazyModuleGetter(this, "PromiseMessage",
  "resource://gre/modules/PromiseMessage.jsm");
/**
 * @constructor
 */
function MozNewTab() {
}

function out(msg){
  dump(`
=============&&&&&&&&&&&&&============
${msg}

`);
}

function getMessageManager(contentWindow) {
  out("getting message manager form getMessageManager");
  return contentWindow
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIDocShell)
    .sameTypeRootTreeItem
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIContentFrameMessageManager);
}

MozNewTab.prototype = {
  _win: null,
  _mm: null,

  classDescription: "Implementation of MozNewTab.webidl",

  classID: Components.ID("{bdd78376-e211-409a-be04-1ad3c11cb469}"),

  contractID: "@mozilla.org/MozNewTab;1",

  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),

  get prefs() {
    return this._prefProvider;
  },

  get search() {
    return this._searchProvider;
  },

  __init() {},

  init(contentWindow) {
    this._win = contentWindow;
    this._mm = getMessageManager(this._win);
    this._prefProvider = new contentWindow.MozNewTabPrefProvider();
    this._searchProvider = new contentWindow.MozContentSearch();
  },

  capturePageThumb(potentialURL) {
    const data = {
      request: "CaptureIfMissing",
      url: "",
    };
    try{
      data.url = new URL(potentialURL).href;
    } catch(err){
      return this._win.Promise.reject(err.message);
    }
    return new this._win.Promise((resolve, reject) => {
      Task.spawn(function* () {
        const result = yield this._requestPageThumb(data);
        resolve(Cu.cloneInto(result, this._win));
      }.bind(this)).catch(
        ({message}) => reject(new this._win.Error(message))
      );
    });
  },
  _requestPageThumb(data) {
    return Task.spawn(function* () {
      const reply = yield PromiseMessage.send(this._mm, "PageThumbsProvider", data);
      return reply.data.data;
    }.bind(this));
  },
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozNewTab]);
