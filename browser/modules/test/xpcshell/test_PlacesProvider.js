"use strict";

/* global XPCOMUtils, PlacesUtils, PlacesProvider */
/* global do_get_profile, do_register_cleanup, run_next_test, add_task */
/* global ok, equal */
/* exported run_test */

const {
  utils: Cu,
} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/PlacesUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PlacesProvider",
    "resource:///modules/PlacesProvider.jsm");

// ensure a profile exists
do_get_profile();

function run_test() {
  run_next_test();
  do_register_cleanup(function() {
    // clear history
  });
}

/** Test LinkChecker **/

add_task(function test_LinkCheckerSecurityCheck() {
  let urls = [
    {url: "file://home/file/image.png", expected: false},
    {url: "resource:///modules/PlacesProvider.jsm", expected: false},
    {url: "javascript:alert('hello')", expected: false}, // jshint ignore:line
    {url: "data:image/png;base64,XXX", expected: false},
    {url: "about:newtab", expected: true},
    {url: "https://example.com", expected: true},
    {url: "ftp://example.com", expected: true},
  ];
  for (let {url, expected} of urls) {
    let observed = PlacesProvider.LinkChecker.checkLoadURI(url);
    equal(observed , expected, `can load "${url}?"`);
  }
  ok(true);
});
