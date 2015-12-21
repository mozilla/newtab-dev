/* global Services, Preferences, EventEmitter, XPCOMUtils */
/* exported NewTabPrefsProvider */

"use strict";

this.EXPORTED_SYMBOLS = ["NewTabPrefsProvider"];

const {interfaces: Ci, utils: Cu, classes: Cc} = Components;
const gMsgMngr = Cc["@mozilla.org/globalmessagemanager;1"]
  .getService(Ci.nsIMessageListenerManager);

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PromiseMessage",
  "resource://gre/modules/PromiseMessage.jsm");
XPCOMUtils.defineLazyGetter(this, "EventEmitter", function() {
  const {EventEmitter} = Cu.import("resource://gre/modules/devtools/event-emitter.js", {});
  return EventEmitter;
});

// Supported prefs and data type
const prefsMap = new Map([
  ["browser.newtabpage.rows", "int"],
  ["browser.newtabpage.columns", "int"],
  ["browser.newtabpage.enabled", "bool"],
  ["browser.newtabpage.enhanced", "bool"],
  ["browser.newtabpage.pinned", "str"],
  ["browser.newtabpage.remote", "bool"],
  ["intl.locale.matchOS", "bool"],
  ["general.useragent.locale", "localized"],
]);

function PrefsProvider() {
  EventEmitter.decorate(this);
}

PrefsProvider.prototype = {
  updatePref(name, value){
    if(!prefsMap.has(name)){
      return false
    }
    Preferences.set(name, value);
    return true;
  },

  receiveMessage(msg) {
    dump(`
++++++++++++++++++++++++++++++++++++++++++++
      NewTabPrefsProvider GOT MESSAGE! ${msg.data.request}
    `);
    switch(msg.data.request){
    case "GetCurrent":
      let prefs = this.currentPrefs();
      this._reply(msg, prefs);
      break;
    case "updatePref":
      let result = this.updatePref(msg.data);
      this._reply(msg, result);
      break;
    }
  },

  _reply(msg, data) {
    dump(`
++++++++++++++++++++++++++++++++++++++++++++
      NewTabPrefsProvider TRYING TO REPLy
    `);
    // We reply asynchronously to messages, and by the time we reply the browser
    // we're responding to may have been destroyed.  messageManager is null then.
    if (!msg.target.messageManager) {
      return;
    }
    let id = null;
    if(msg && typeof msg.data === "object" && msg.data.hasOwnProperty("id")){
      id =  msg.data.id;
    }
    let reply = {
      response: data,
      id,
    };
    dump(`
      ++++++++++++++++++++++++++++++++++++++++++++
      NewTabPrefsProvider SENDING REPLY ${JSON.stringify(reply)}
    `);
    msg.target.messageManager.sendAsyncMessage("NewTabPrefs", reply);
    dump("\n ,,....AND SENT!!!");
  },

  observe(subject, topic, name) { // jshint ignore:line
    if (topic !== "nsPref:changed" || !prefsMap.has(name)) {
      let msg = `Observing unknown topic or preference: ${topic} / {name}`;
      let error = new Error(msg);
      return Cu.reportError(error);
    }
    let type = prefsMap.get(name);
    let value;
    switch (type) {
    case "bool":
      value = Preferences.get(name, false);
      break;
    case "str":
      value = Preferences.get(name, "");
      break;
    case "int":
      value = Preferences.get(name, 0);
      break;
    case "localized":
      try {
        value = Preferences.get(name, "", Ci.nsIPrefLocalizedString);
      } catch (e) {
        value = Preferences.get(name, "");
      }
      break;
    }
    this.emit(name, value);
    dump(`
!!!!!!!!!!!!!!!!!!!!!!
broadcastAsyncMessage ${name} and ${value}!!!!!
    `);
    gMsgMngr.broadcastAsyncMessage("NewTabPrefs:Changed", {name, value});
  },

  currentPrefs(){
    return Array
      .from(prefsMap.keys())
      .map(key => [key, Preferences.get(key)])
      .reduce((map, [key, value]) => map.set(key, value), new Map());
  },

  init() {
    gMsgMngr.addMessageListener("NewTabPrefs", this);
    Array.from(prefsMap.keys()).forEach(
      pref => Services.prefs.addObserver(pref, this, false)
    );
  },

  uninit() {
    Array.from(prefsMap.keys()).forEach(
      pref => Services.prefs.removeObserver(pref, this, false)
    );
    gMsgMngr.removeMessageListener("NewTabPrefs", this);
  }
};

/**
 * Singleton that serves as the default new tab pref provider for the grid.
 */
this.NewTabPrefsProvider = {
  prefs: new PrefsProvider(),
};
