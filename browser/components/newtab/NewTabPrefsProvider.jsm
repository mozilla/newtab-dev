/* global Services, Preferences, EventEmitter, XPCOMUtils */
/* exported NewTabPrefsProvider */

"use strict";

this.EXPORTED_SYMBOLS = ["NewTabPrefsProvider"];

const {interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
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
  ["browser.newtabpage.pinned", "bool"],
  ["browser.newtabpage.remote", "bool"],
  ["intl.locale.matchOS", "bool"],
  ["general.useragent.locale", "localized"],
]);

function PrefsProvider() {
  EventEmitter.decorate(this);
}

PrefsProvider.prototype = {

  observe(subject, topic, data) { // jshint ignore:line
    if (topic !== "nsPref:changed" || !prefsMap.has(data)) {
      let msg = `Observing unknown topic or preference: ${topic} / {data}`;
      let error = new Error(msg);
      return Cu.reportError(error);
    }
    let type = prefsMap.get(data);
    let prefName = data;
    let value;
    switch (type) {
    case "bool":
      value = Preferences.get(prefName, false);
      break;
    case "str":
      value = Preferences.get(prefName, "");
      break;
    case "int":
      value = Preferences.get(prefName, 0);
      break;
    case "localized":
      try {
        value = Preferences.get(prefName, "", Ci.nsIPrefLocalizedString);
      } catch (e) {
        value = Preferences.get(prefName, "");
      }
      break;
    }
    this.emit(data, value);
  },

  currentPrefs(){
    return Array
      .from(prefsMap.keys())
      .map(key => [key, Preferences.get(key)])
      .reduce((map, [key, value]) => map.set(key, value), new Map());
  },

  init() {
    for (let pref of prefsMap.keys()) {
      Services.prefs.addObserver(pref, this, false);
    }
  },

  uninit() {
    for (let pref of prefsMap.keys()) {
      Services.prefs.removeObserver(pref, this, false);
    }
  }
};

/**
 * Singleton that serves as the default new tab pref provider for the grid.
 */
this.NewTabPrefsProvider = {
  prefs: new PrefsProvider(),
};
