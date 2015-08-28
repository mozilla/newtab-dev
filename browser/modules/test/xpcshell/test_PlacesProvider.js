"use strict";

/* global XPCOMUtils, PlacesTestUtils, PlacesProvider, NetUtil */
/* global do_get_profile, do_register_cleanup, run_next_test, add_task */
/* global equal */
/* exported run_test */

const {
  utils: Cu,
} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/PlacesUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PlacesProvider",
    "resource:///modules/PlacesProvider.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PlacesTestUtils",
    "resource://testing-common/PlacesTestUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "NetUtil",
    "resource://gre/modules/NetUtil.jsm");

// ensure a profile exists
do_get_profile();

function run_test() {
  run_next_test();
  do_register_cleanup(function() {
    // clear history
  });
}

/** Test LinkChecker **/

add_task(function test_LinkChecker_securityCheck() {

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
});

/** Test LinkUtils **/

add_task(function test_LinkUtils_compareLinks() {

  let fixtures = {
    aOlder: {
      url: "http://www.mozilla.org/aolder",
      title: "Mozilla",
      frecency: 1337,
      lastVisitDate: 1394678824766431,
    },
    older: {
      url: "http://www.mozilla.org/older",
      title: "Mozilla",
      frecency: 1337,
      lastVisitDate: 1394678824766431,
    },
    newer: {
      url: "http://www.mozilla.org/newer",
      title: "Mozilla",
      frecency: 1337,
      lastVisitDate: 1494678824766431,
    },
    moreFrecent: {
      url: "http://www.mozilla.org/moreFrecent",
      title: "Mozilla",
      frecency: 1337357,
      lastVisitDate: 1394678824766431,
    }
  };

  let links = [
    // tests string ordering, a is before o
    {link1: fixtures.aOlder, link2: fixtures.older, expected: false},

    // test identity
    {link1: fixtures.older, link2: fixtures.older, expected: false},

    // test ordering
    {link1: fixtures.older, link2: fixtures.newer, expected: true},
    {link1: fixtures.newer, link2: fixtures.older, expected: false},

    // test frecency
    {link1: fixtures.moreFrecent, link2: fixtures.older, expected: false},
  ];

  for (let {link1, link2, expected} of links) {
    let observed = PlacesProvider.LinkUtils.compareLinks(link1, link2) > 0;
    equal(observed , expected, `comparing ${link1.url} and ${link2.url}`);
  }
});

/** Test Provider **/

add_task(function* test_Links_getLinks() {
  let provider = PlacesProvider.Links;

  let links = yield provider.getLinks();
  equal(links.length, 0, "empty history yields empty links");

  // add a visit
  var testURI = NetUtil.newURI("http://mozilla.com");
  yield PlacesTestUtils.addVisits(testURI);

  links = yield provider.getLinks();
  equal(links.length, 1, "adding a visit yields a link");
  equal(links[0].url, testURI.spec, "added visit corresponds to added url");
});
