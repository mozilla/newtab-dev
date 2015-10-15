/* global Services, EventEmitter, XPCOMUtils */
/* exported NewTabPrefsProvider */

"use strict";

this.EXPORTED_SYMBOLS = ["NewTabPrefsProvider"];

const Cu = Components.utils;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyGetter(this, "EventEmitter", function() {
  const {EventEmitter} = Cu.import("resource://gre/modules/devtools/event-emitter.js", {});
  return EventEmitter;
});

const prefsSet = new Set([
    "browser.newtabpage.enabled",
    "browser.newtabpage.enhanced",
    "browser.newtabpage.pinned",
    "intl.locale.matchOS",
    "general.useragent.locale",
]);

let PrefsProvider = function PrefsProvider() {
  EventEmitter.decorate(this);
};

PrefsProvider.prototype = {

  observe(subject, topic, data) { // jshint ignore:line
    if (topic === "nsPref:changed") {
      if (prefsSet.has(data)) {
        this.emit(data);
      }
    } else {
      Cu.reportError(new Error("NewTabPrefsProvider observing unknown topic"));
    }
  },

  get prefs() {
    return Array.from(prefsSet);
  },

  startTracking() {
    for (let pref of prefsSet) {
      Services.prefs.addObserver(pref, this, false);
    }
  },

  stopTracking() {
    for (let pref of prefsSet) {
      Services.prefs.removeObserver(pref, this, false);
    }
  }
};

/**
 * Singleton that serves as the default new tab pref provider for the grid.
 */
const gPrefs = new PrefsProvider();

let NewTabPrefsProvider = {
  prefs: gPrefs,
};
