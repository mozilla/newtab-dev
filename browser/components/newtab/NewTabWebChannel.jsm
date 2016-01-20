/* global NewTabPrefsProvider, Preferences, XPCOMUtils, WebChannel */
/* exported NewTabWebChannel */

"use strict";

this.EXPORTED_SYMBOLS = ["NewTabWebChannel"];

const {utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "NewTabPrefsProvider",
                                  "resource:///modules/NewTabPrefsProvider.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "WebChannel",
                                  "resource://gre/modules/WebChannel.jsm");

const PREF_ENABLED = "browser.newtabpage.remote";
const PREF_MODE = "browser.newtabpage.remote.mode";
const MODE_CHANNEL_MAP = {
  "remote": {origin: "https://newtab.cdn.mozilla.net", chan_id: ""},
  "chrome": {origin:"", chan_id: ""},
  "debug": {origin:"http://localhost", chan_id: ""}
};

/**
 * NewTabWebChannel marshalls all communication with unprivileged newtab instances.
 *
 * It allows for the ability to broadcast to all newtab browsers.
 * If the browser.newtab.remote pref is false, the object will be in an uninitialized state.
 *
 * Mode choices:
 * 'debug': pages with a localhost origin receive messages
 * 'chrome': local about:newtab pages receive messages
 * 'remote': pages from the newtab CDN's origin receive messages
 *
 *  An unknown mode will result in 'remote' mode, which is the default
 *
 *  Incoming messages are expected to be JSON-serialized and in the format:
 *
 *  {
 *    type: "requestScreenshot",
 *    data: {
 *      url: "https://example.com"
 *    }
 *  }
 *
 *  {
 *    type: "requestInitialPrefs",
 *  }
 *
 *  Outgoing messages are expected to be objects serializable by structured cloning, in a similar format:
 *  {
 *    type: "responseScreenshot",
 *    data: {
 *      "url": "https://example.com",
 *      "image": "dataURi:....."
 *    }
 *  }
 *
 *  {
 *    type: "responseInitialPrefs",
 *    data: {
 *    }
 */
let NewTabWebChannel = {
  _prefs: {
    mode: "remote",
    enabled: false
  },
  _channel: null,
  _browsers: null,

  get chanId() {
    return MODE_CHANNEL_MAP[this._prefs.mode].chanId;
  },

  get origin() {
    return MODE_CHANNEL_MAP[this._prefs.mode].origin;
  },

  _unloadBrowser(browser) {
    if (this._browsers.has(browser)) {
      this._browsers.delete(browser);
      browser.removeEventListener("pageHide", this._unloadBrowser);
    }
  },

  _incomingMessage(id, message, browser) {
    if (this.chanId !== id) {
      Cu.reportError(new Error("NewTabWebChannel unexpected message destination"));
    }

    if (!this._browsers.has(browser)) {
      this._browsers.add(browser);
      // TODO: right message?
      //browser.addEventListener("pageHide", this._unloadBrowser.bind(this));
    }

    try {
      let data = JSON.parse(message);
      switch (data.type) {
        case "requestInitialPrefs":
          this.send("responseInitialPrefs", NewTabPrefsProvider.prefs.newtabPagePrefs, browser);
          break;
      }
    } catch (err) {
      Cu.reportError(err);
    }
  },

  broadcast(action, message) {
    for (let browser of this._browsers) {
      this._channel.send({action: action, data: message}, browser);
    }
  },

  send(action, message, browser) {
    this._channel.send({action: action, data: message}, browser);
  },

  _handlePrefChange(prefName, stateEnabled, forceState) { //jshint unused:false
    this._prefChange(stateEnabled, forceState);
  },

  _prefChange(stateEnabled, forceState) {
    // TODO: change webChannel based on pref
  },

  init() {
    this._prefs.enabled = Preferences.get(PREF_ENABLED, false);
    this._prefs.mode = Preferences.get(PREF_MODE, "remote");
    this._browsers = new Set();

    if (this._prefs.enabled) {
      this._channel = new WebChannel(this.chanId, Services.io.newURI(this.origin));
      this._channel.listen(this._incomingMessage.bind(this));

      NewTabPrefsProvider.prefs.on(PREF_ENABLED, this._handlePrefChange.bind(this));
      NewTabPrefsProvider.prefs.on(PREF_MODE, this._handlePrefChange.bind(this));
    }
  },

  uninit() {
    if (this._prefs.enabled) {
      this._channel.stopListening();
      this._channel = null;
      this._browsers = null;

      NewTabPrefsProvider.prefs.off(PREF_ENABLED, this._handlePrefChange);
      NewTabPrefsProvider.prefs.off(PREF_MODE, this._handlePrefChange);
    }
  }
};
