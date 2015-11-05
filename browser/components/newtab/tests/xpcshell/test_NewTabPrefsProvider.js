"use strict";

/* global XPCOMUtils, ok, equal, Services, NewTabPrefsProvider */

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
  NewTabPrefsProvider.prefs.startTracking();
  let promise = new Promise(resolve => {
    NewTabPrefsProvider.prefs.once("browser.newtabpage.enabled", function(name, data) {
      equal(data, Services.prefs.getBoolPref(data), "emitter collected correct pref data");
    });
    resolve(true);
  });
  Services.prefs.setBoolPref("browser.newtabpage.enabled", true);
  let result = yield promise;
  ok(result, "pref emitter triggers");
  NewTabPrefsProvider.prefs.stopTracking();
});
