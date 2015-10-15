"use strict";

/* global XPCOMUtils */
/* global ok */

const Cu = Components.utils;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "NewTabPrefsProvider",
    "resource:///modules/NewTabPrefsProvider.jsm");

function run_test() {
  run_next_test();
}

add_task(function* test_observe() {
  Services.prefs.setBoolPref("browser.newtabpage.enabled", false);
  NewTabPrefsProvider.prefs.startTracking()
  let promise = new Promise(resolve => {
    NewTabPrefsProvider.prefs.on("browser.newtabpage.enabled", data => {
      resolve(data);
    });
  });
  Services.prefs.setBoolPref("browser.newtabpage.enabled", true);
  let data = yield promise;
  ok(data, "pref emitter triggers");
  NewTabPrefsProvider.prefs.stopTracking()
});
