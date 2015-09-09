/* globals Assert, RemoteNewTabLocation, Services */
"use strict";

Components.utils.import("resource:///modules/RemoteNewTabLocation.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.importGlobalProperties(["URL"]);

add_task(function* () {
  let defaultHref = RemoteNewTabLocation.href;

  Assert.ok(RemoteNewTabLocation.href, "Default location has an href");
  Assert.ok(RemoteNewTabLocation.origin, "Default location has an origin");
  Assert.ok(!RemoteNewTabLocation.overridden, "Default location is not overridden");

  let testURL = new URL("https://example.com/");
  let notificationPromise;

  notificationPromise = changeNotificationPromise(testURL.href);
  RemoteNewTabLocation.override(testURL.href);
  yield notificationPromise;
  Assert.ok(RemoteNewTabLocation.overridden, "Remote location should be overridden");
  Assert.equal(RemoteNewTabLocation.href, testURL.href, "Remote href should be the custom URL");
  Assert.equal(RemoteNewTabLocation.origin, testURL.origin, "Remote origin should be the custom URL");

  notificationPromise = changeNotificationPromise(defaultHref);
  RemoteNewTabLocation.reset();
  yield notificationPromise;
  Assert.ok(!RemoteNewTabLocation.overridden, "Newtab URL should not be overridden");
});

function changeNotificationPromise(aNewURL) {
  return new Promise(resolve => {
    Services.obs.addObserver(function observer(aSubject, aTopic, aData) { // jshint ignore:line
      Services.obs.removeObserver(observer, aTopic);
      Assert.equal(aData, aNewURL, "remote-new-tab-location-changed data should be new URL.");
      resolve();
    }, "remote-new-tab-location-changed", false);
  });
}
