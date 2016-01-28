/* globals XPCOMUtils, Cu, Preferences, NewTabWebChannel, is, registerCleanupFunction */

"use strict";

Cu.import("resource://gre/modules/Preferences.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "NewTabWebChannel",
                                  "resource:///modules/NewTabWebChannel.jsm");

const TEST_URL = "https://example.com/browser/browser/components/newtab/tests/browser/newtabwebchannel_basic.html";
const TEST_URL_2 = "http://mochi.test:8888/browser/browser/components/newtab/tests/browser/newtabwebchannel_basic.html";

registerCleanupFunction(function() {
  Preferences.set("browser.newtabpage.remote", false);
  Preferences.set("browser.newtabpage.remote.mode", "production");
  NewTabWebChannel.tearDown();
});

/*
 * Tests flow of messages from newtab to chrome and chrome to newtab
 */
add_task(function* open_webchannel_basic() {
  Preferences.set("browser.newtabpage.remote.mode", "test");
  Preferences.set("browser.newtabpage.remote", true);

  let tabOptions = {
    gBrowser,
    url: TEST_URL
  };

  let messagePromise = new Promise(resolve => {
    NewTabWebChannel.on("foo", function(name, msg) {
      is(name, "foo", "Correct message type sent: foo");
      is(msg.data, "bar", "Correct data sent: bar");
      resolve(msg.target);
    }.bind(this));
  });

  let replyPromise = new Promise(resolve => {
    NewTabWebChannel.on("reply", function(name, msg) {
      is(name, "reply", "Correct message type sent: reply");
      is(msg.data, "quuz", "Correct data sent: quuz");
      resolve(msg.target);
    }.bind(this));
  });

  let unloadPromise = new Promise(resolve => {
    NewTabWebChannel.on("targetUnload", function(name) {
      is(name, "targetUnload", "Correct message type sent: targetUnload");
      resolve();
    });
  });

  is(NewTabWebChannel.numTargets, 0, "Sanity check");
  yield BrowserTestUtils.withNewTab(tabOptions, function* (browser) {
    let target = yield messagePromise;
    is(NewTabWebChannel.numTargets, 1, "One target expected");
    is(target.browser, browser, "Same browser");
    NewTabWebChannel.send("respond", null, target);
    yield replyPromise;
  });
  yield unloadPromise;
  is(NewTabWebChannel.numTargets, 0, "Sanity check");
});

/*
 * Tests message broadcast reaches all open newtab pages
 */
add_task(function* open_webchannel_basic() {
  Preferences.set("browser.newtabpage.remote.mode", "test");
  Preferences.set("browser.newtabpage.remote", true);

  let countingMessagePromise = new Promise(resolve => {
    let count = 0;
    NewTabWebChannel.on("foo", function(name, msg) { // jshint unused:true
      count += 1;
      if (count === 2) {
        resolve(msg.target);
      }
    }.bind(this));
  });

  let countingReplyPromise = new Promise(resolve => {
    let count = 0;
    NewTabWebChannel.on("reply", function(name, msg) { // jshint unused:true
      count += 1;
      if (count === 2) {
        resolve(msg.target);
      }
    }.bind(this));
  });

  let countingUnloadPromise = new Promise(resolve => {
    let count = 0;
    NewTabWebChannel.on("targetAdd", function() {
      count += 1;
      if (count === 2) {
        resolve();
      }
    });
  });

  let tabs = [];
  is(NewTabWebChannel.numTargets, 0, "Sanity check");
  tabs.push(yield BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_URL));
  tabs.push(yield BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_URL));

  yield countingMessagePromise;
  is(NewTabWebChannel.numTargets, 2, "Two targets expected");

  NewTabWebChannel.broadcast("respond", null);
  yield countingReplyPromise;

  for (let tab of tabs) {
    yield BrowserTestUtils.removeTab(tab);
  }

  yield countingUnloadPromise;
  is(NewTabWebChannel.numTargets, 0, "Sanity check");
});

/*
 * Tests switching modes
 */
add_task(function* open_webchannel_basic() {
  Preferences.set("browser.newtabpage.remote.mode", "test");
  Preferences.set("browser.newtabpage.remote", true);

  function newMessagePromise() {
    return new Promise(resolve => {
      NewTabWebChannel.on("foo", function(name, msg) { // jshint unused:true
        resolve(msg.target);
      }.bind(this));
    });
  }

  let replyCount = 0;
  let replyPromise = new Promise(resolve => {
    NewTabWebChannel.on("reply", function(name, msg) { // jshint unused:true
      resolve(msg.target);
    }.bind(this));
  });

  let unloadCount = 0;
  let unloadPromise = new Promise(resolve => {
    NewTabWebChannel.on("targetUnload", function(target) {
      resolve(target);
    });
  });

  let tabs = [];
  let messagePromise;
  is(NewTabWebChannel.numTargets, 0, "Sanity check");

  messagePromise = newMessagePromise();
  tabs.push(yield BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_URL));
  yield messagePromise;
  is(NewTabWebChannel.numTargets, 1);

  Preferences.set("browser.newtabpage.remote.mode", "test2");
  messagePromise = newMessagePromise();
  tabs.push(yield BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_URL_2));
  yield messagePromise;
  is(NewTabWebChannel.numTargets, 1);

  NewTabWebChannel.broadcast("respond", null);
  yield replyPromise;
  is(replyCount, 1, "only current channel is listened to");

  for (let tab of tabs) {
    yield BrowserTestUtils.removeTab(tab);
  }
  yield unloadPromise;
  is(unloadCount, 1, "only current channel is listened to");
  is(NewTabWebChannel.numTargets, 0, "Sanity check");
});
