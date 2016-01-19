/*globals
  XPCOMUtils,
  aboutNewTabService,
  Services,
  ContentTask,
  BrowserOpenTab,
  registerCleanupFunction,
  is,
  content
*/

"use strict";

let Cu = Components.utils;
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "aboutNewTabService",
                                   "@mozilla.org/browser/aboutnewtab-service;1",
                                   "nsIAboutNewTabService");

registerCleanupFunction(function() {
  Services.prefs.setBoolPref("browser.newtabpage.remote", false);
  aboutNewTabService.resetNewTabURL();
});

add_task(function* redirector_ignores_override() {
  let overrides = [
    "chrome://browser/content/downloads/contentAreaDownloadsView.xul",
    "about:home",
  ];

  for (let overrideURL of overrides) {
    let notificationPromise = nextChangeNotificationPromise(overrideURL, `newtab page now points to ${overrideURL}`);
    aboutNewTabService.newTabURL = overrideURL;

    yield notificationPromise;
    Assert.ok(aboutNewTabService.overridden, "url has been overridden");

    let tabOptions = {
      gBrowser,
      url: "about:newtab",
    };

    // simulate typing "about:newtab" in the url bar
    yield BrowserTestUtils.withNewTab(tabOptions, function*(browser) {
      yield ContentTask.spawn(browser, {}, function*() {
        is(content.location.href, "about:newtab", "Got right URL");
        is(content.document.location.href, "about:newtab", "Got right URL");
      });
    });  // jshint ignore:line
  }
});

add_task(function* override_loads_in_browser() {
  let overrides = [
    "chrome://browser/content/downloads/contentAreaDownloadsView.xul",
    "about:home",
  ];

  for (let overrideURL of overrides) {
    let notificationPromise = nextChangeNotificationPromise(overrideURL, `newtab page now points to ${overrideURL}`);
    aboutNewTabService.newTabURL = overrideURL;

    yield notificationPromise;
    Assert.ok(aboutNewTabService.overridden, "url has been overridden");

    // simulate a newtab open as a user would
    BrowserOpenTab();  // jshint ignore:line

    let browser = gBrowser.selectedBrowser;
    yield BrowserTestUtils.browserLoaded(browser);

    yield ContentTask.spawn(browser, {url: overrideURL}, function*(args) {
      is(content.location.href, args.url, "Got right URL");
      is(content.document.location.href, args.url, "Got right URL");
    });  // jshint ignore:line
    gBrowser.removeTab(gBrowser.selectedTab);
  }
});

add_task(function* override_blank_loads_in_browser() {
  let overrides = [
    "",
    " ",
    "\n\t",
  ];

  for (let overrideURL of overrides) {
    let notificationPromise = nextChangeNotificationPromise("about:blank", "newtab page now points to about:blank");
    aboutNewTabService.newTabURL = overrideURL;

    yield notificationPromise;
    Assert.ok(aboutNewTabService.overridden, "url has been overridden");

    // simulate a newtab open as a user would
    BrowserOpenTab();  // jshint ignore:line

    let browser = gBrowser.selectedBrowser;
    yield BrowserTestUtils.browserLoaded(browser);

    yield ContentTask.spawn(browser, {}, function*() {
      is(content.location.href, "about:blank", "Got right URL");
      is(content.document.location.href, "about:blank", "Got right URL");
    });  // jshint ignore:line
    gBrowser.removeTab(gBrowser.selectedTab);
  }
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
