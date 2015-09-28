/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*globals Components, sendAsyncMessage, addMessageListener, removeMessageListener*/

"use strict";
(function() {
  const {
    utils: Cu,
    interfaces: Ci
  } = Components;
  const {
    XPCOMUtils
  } = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});
  const imports = {};
  XPCOMUtils.defineLazyModuleGetter(imports, "PrivateBrowsingUtils",
    "resource://gre/modules/PrivateBrowsingUtils.jsm");
  XPCOMUtils.defineLazyModuleGetter(imports, "Services",
    "resource://gre/modules/Services.jsm");

  let remoteNewTabLocation;

  function handleCommand(command, data) {
    let commandHandled = true;
    switch (command) {
    case "NewTab:UpdateTelemetryProbe":
      imports.Services.telemetry.getHistogramById(data.probe).add(data.value);
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
    let remoteIFrame = document.querySelector("#remotedoc");

    let loadHandler = () => {
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
      let remoteIFrame = document.querySelector("#remotedoc");
      remoteIFrame.contentWindow.postMessage(message, remoteNewTabLocation.origin);
    });
  }

  function getInitialState() {
    let prefs = imports.Services.prefs;
    let isPrivate = imports.PrivateBrowsingUtils.isContentWindowPrivate(window);
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
    let remoteIFrame = document.querySelector("#remotedoc");
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
