/*global XPCOMUtils*/
/*exported NSGetFactory*/
"use strict";
const {interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PromiseMessage",
  "resource://gre/modules/PromiseMessage.jsm");

function MozPreferencesMap() {}

function getMessageManager(contentWindow) {
  return contentWindow
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIDocShell)
    .sameTypeRootTreeItem
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIContentFrameMessageManager);
}

MozPreferencesMap.prototype = {
  classDescription: "Defines MozPreferencesMap objects",
  classID: Components.ID("{2d3ff5cd-6eae-44a3-bebf-ff49615fb684}"),
  contractID: "@mozilla.org/MozPreferencesMap;1",
  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),
  _mm: null,
  _win: null,
  init(contentWindow) {
    this._win = contentWindow;
    this._mm = getMessageManager(contentWindow);
  },
  __init() {},
  update(name, value){
    return new this._win.Promise((resolve, reject)=>{
      if(!this.__DOM_IMPL__.has(name)){
        resolve(false);
      }
      const data = {
        action: "update",
        pref: name,
        value: value,
      };
      PromiseMessage.send(this._mm, "NewTabPrefs", data).then(
        msg => dump(`&&&&&&&&&&&&&&&&&&&\nGOT A RESPONSE\n`)
      ).then(
        () =>  this.__DOM_IMPL__.set(name, value)
      ).then(resolve);
    });
  },
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozPreferencesMap]);
