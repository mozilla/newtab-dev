/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let Cu = Components.utils;
let Ci = Components.interfaces;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Rect",
  "resource://gre/modules/Geometry.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PrivateBrowsingUtils",
  "resource://gre/modules/PrivateBrowsingUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "UpdateChannel",
  "resource://gre/modules/UpdateChannel.jsm");


XPCOMUtils.defineLazyGetter(this, "gStringBundle", function() {
  return Services.strings.
    createBundle("chrome://browser/locale/newTab.properties");
});

function newTabString(name, args) {
  let stringName = "newtab." + name;
  if (!args) {
    return gStringBundle.GetStringFromName(stringName);
  }
  return gStringBundle.formatStringFromName(stringName, args, args.length);
}

function inPrivateBrowsingMode() {
  return PrivateBrowsingUtils.isContentWindowPrivate(window);
}

function handleCommand(command, data) {
  let commandHandled = true;
  switch(command) {
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

function initRemotePage() {
  // Messages that the iframe sends the browser will be passed onto
  // the privileged parent process
  let iframe = document.getElementById("meep");
  iframe.addEventListener("load", (e) => {
    iframe.contentDocument.addEventListener("NewTabCommand", (e) => {
      let handled = handleCommand(e.detail.command, e.detail.data);
      if (!handled) {
        sendAsyncMessage(e.detail.command, e.detail.data);
      }
    }, false);
    registerEvent("NewTab:Observe");
    iframe.contentDocument.dispatchEvent(new CustomEvent("NewTabCommandReady"));
  });
}

function registerEvent(event) {
  // Messages that the privileged parent process sends will be passed
  // onto the iframe
  addMessageListener(event, (message) => {
    let iframe = document.getElementById("meep").contentWindow;
    iframe.postMessage(message, "*");
  });
}

function getInitialState() {
  let state = {
    enabled: Services.prefs.getBoolPref(PREF_NEWTAB_ENABLED),
    enhanced: Services.prefs.getBoolPref(PREF_NEWTAB_ENHANCED),
    rows: Services.prefs.getIntPref(PREF_NEWTAB_ROWS),
    columns: Services.prefs.getIntPref(PREF_NEWTAB_COLUMNS),
    introShown: Services.prefs.getBoolPref(PREF_INTRO_SHOWN),
    privateBrowsingMode: PrivateBrowsingUtils.isContentWindowPrivate(window)
  }
  let iframe = document.getElementById("meep").contentWindow;
  iframe.postMessage({name: "NewTab:State", data: state}, "*");
}

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const XUL_NAMESPACE = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

const TILES_EXPLAIN_LINK = "https://support.mozilla.org/kb/how-do-tiles-work-firefox";
const TILES_INTRO_LINK = "https://www.mozilla.org/firefox/tiles/";
const TILES_PRIVACY_LINK = "https://www.mozilla.org/privacy/";

// Everything is loaded. Initialize the New Tab Page.
initRemotePage();
