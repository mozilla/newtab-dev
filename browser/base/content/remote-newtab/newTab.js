/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*globals XPCOMUtils, Components, sendAsyncMessage, addMessageListener, removeMessageListener,
          Services, PrivateBrowsingUtils*/
"use strict";

const {utils: Cu, interfaces: Ci} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PrivateBrowsingUtils",
  "resource://gre/modules/PrivateBrowsingUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Services",
  "resource://gre/modules/Services.jsm");

(function() {
  let remoteNewTabLocation;
  let remoteIFrame;

  function handleCommand(command, data) {
    let commandHandled = true;
    switch (command) {
    case "NewTab:UpdateTelemetryProbe":
      Services.telemetry.getHistogramById(data.probe).add(data.value);
      break;
    case "NewTab:Register":
      registerEvent(data.type);
      break;
    case "NewTab:GetInitialState":
      getInitialState();
      break;
    default:
      commandHandled = false;
    }
    return commandHandled;
  }

  function initRemotePage(initData) {
    // Messages that the iframe sends the browser will be passed onto
    // the privileged parent process
    remoteNewTabLocation = initData;
    remoteIFrame = document.querySelector("#remotedoc");

    let loadHandler = () => {
      if (remoteIFrame.src !== remoteNewTabLocation.href) {
        return;
      }

      remoteIFrame.removeEventListener("load", loadHandler);
      remoteIFrame.contentDocument.addEventListener("NewTabCommand", (e) => {
        let handled = handleCommand(e.detail.command, e.detail.data);
        if (!handled) {
          sendAsyncMessage(e.detail.command, e.detail.data);
        }
      });
      registerEvent("NewTab:Observe");
      let ev = new CustomEvent("NewTabCommandReady");
      remoteIFrame.contentDocument.dispatchEvent(ev);
    };

    remoteIFrame.src = remoteNewTabLocation.href;
    remoteIFrame.addEventListener("load", loadHandler);
  }

  function registerEvent(event) {
    // Messages that the privileged parent process sends will be passed
    // onto the iframe
    addMessageListener(event, (message) => {
      remoteIFrame.contentWindow.postMessage(message, remoteNewTabLocation.origin);
    });
  }

  function getInitialState() {
    let prefs = Services.prefs;
    let isPrivate = PrivateBrowsingUtils.isContentWindowPrivate(window);
    let state = {
      enabled: prefs.getBoolPref("browser.newtabpage.enabled"),
      enhanced: prefs.getBoolPref("browser.newtabpage.enhanced"),
      rows: prefs.getIntPref("browser.newtabpage.rows"),
      columns: prefs.getIntPref("browser.newtabpage.columns"),
      introShown: prefs.getBoolPref("browser.newtabpage.introShown"),
      windowID: window.QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIDOMWindowUtils).outerWindowID,
      privateBrowsingMode: isPrivate
    };
    remoteIFrame.contentWindow.postMessage({
      name: "NewTab:State",
      data: state
    }, remoteNewTabLocation.origin);
  }

  addMessageListener("NewTabFrame:Init", function loadHandler(message) {
    // Everything is loaded. Initialize the New Tab Page.
    removeMessageListener("NewTabFrame:Init", loadHandler);
    initRemotePage(message.data);
  });
  sendAsyncMessage("NewTabFrame:GetInit");
}());
