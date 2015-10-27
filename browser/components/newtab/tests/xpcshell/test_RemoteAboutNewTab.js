"use strict";

/* global XPCOMUtils, RemoteAboutNewTab, PlacesProvider */
/* global do_get_profile, run_next_test, add_task */
/* global equal, ok */
/* exported run_test */

const {
  utils: Cu,
  interfaces: Ci,
} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PlacesProvider",
    "resource:///modules/PlacesProvider.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "RemoteAboutNewTab",
    "resource:///modules/RemoteAboutNewTab.jsm");

// ensure a profile exists
do_get_profile();

function run_test() {
  run_next_test();
}

add_task(function* test_PlacesEventListener() {
  RemoteAboutNewTab.init();
  let oldPageListener = RemoteAboutNewTab.pageListener;
  RemoteAboutNewTab.pageListener = {};
  let promise = new Promise(resolve => {
    RemoteAboutNewTab.pageListener.sendAsyncMessage = function(name, data) {
      if (name == "NewTab:PlacesClearHistory") {
        resolve();
      }
    };
    PlacesProvider.links.emit("clearHistory");
  });
  yield promise;
  RemoteAboutNewTab.pageListener = oldPageListener;
  RemoteAboutNewTab.uninit();
});
