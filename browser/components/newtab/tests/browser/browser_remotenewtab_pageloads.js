/* globals XPCOMUtils, aboutNewTabService, Services, ContentTask, content, is */
"use strict";

let Cu = Components.utils;
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "aboutNewTabService",
                                   "@mozilla.org/browser/aboutnewtab-service;1",
                                   "nsIAboutNewTabService");

const TEST_URL = "https://example.com/browser/browser/components/newtab/tests/browser/dummy_page.html";

add_task(function* open_newtab() {
  let notificationPromise = nextChangeNotificationPromise(TEST_URL, "newtab page now points to test url");
  aboutNewTabService.newTabURL = TEST_URL;

  yield notificationPromise;
  Assert.ok(aboutNewTabService.overridden, "url has been overridden");

  // simulate a newtab open as a user would
  BrowserOpenTab();  // jshint ignore:line

  let browser = gBrowser.selectedBrowser;
  yield BrowserTestUtils.browserLoaded(browser);

  let result = yield ContentTask.spawn(browser, {url: TEST_URL}, function*() {
    return content.location.href;
  });
  is(result, TEST_URL, "Got remote URL");
  gBrowser.removeTab(gBrowser.selectedTab);
});

function nextChangeNotificationPromise(aNewURL, testMessage) {
  return new Promise(resolve => {
    Services.obs.addObserver(function observer(aSubject, aTopic, aData) {  // jshint unused:false
      Services.obs.removeObserver(observer, aTopic);
      Assert.equal(aData, aNewURL, testMessage);
      resolve();
    }, "newtab-url-changed", false);
  });
}
