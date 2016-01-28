/* global NewTabPrefsProvider, Services, EventEmitter, Preferences, XPCOMUtils, WebChannel */
/* exported NewTabWebChannel */

"use strict";

this.EXPORTED_SYMBOLS = ["NewTabWebChannel"];

const {utils: Cu} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "NewTabPrefsProvider",
                                  "resource:///modules/NewTabPrefsProvider.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "WebChannel",
                                  "resource://gre/modules/WebChannel.jsm");
XPCOMUtils.defineLazyGetter(this, "EventEmitter", function() {
  const {EventEmitter} = Cu.import("resource://gre/modules/devtools/event-emitter.js", {});
  return EventEmitter;
});

const CHAN_ID = "newtab";
const PREF_ENABLED = "browser.newtabpage.remote";
const PREF_MODE = "browser.newtabpage.remote.mode";
const MODE_CHANNEL_MAP = {
  "production": {origin: "https://newtab.cdn.mozilla.net"},
  "staging": {origin: "https://content-cdn.stage.mozaws.net"},
  "chrome": {origin: "chrome://browser/content/newtab/newTab.xhtml"},
  "test": {origin: "https://example.com"},
  "test2": {origin: "http://mochi.test:8888"},
  "dev": {origin: "http://localhost"}
};

/**
 * NewTabWebChannel is the conduit for all communication with unprivileged newtab instances.
 *
 * It allows for the ability to broadcast to all newtab browsers.
 * If the browser.newtab.remote pref is false, the object will be in an uninitialized state.
 *
 * Mode choices:
 * 'production': pages from our production CDN
 * 'staging': pages from our staging CDN
 * 'chrome': local about:newtab pages
 * 'test': intended for tests
 * 'test2': intended for tests
 * 'dev': intended for development
 *
 *  An unknown mode will result in 'production' mode, which is the default
 *
 *  Incoming messages are expected to be JSON-serialized and in the format:
 *
 *  {
 *    type: "REQUEST_SCREENSHOT",
 *    data: {
 *      url: "https://example.com"
 *    }
 *  }
 *
 *  Or:
 *
 *  {
 *    type: "REQUEST_SCREENSHOT",
 *  }
 *
 *  Outgoing messages are expected to be objects serializable by structured cloning, in a similar format:
 *  {
 *    type: "RECEIVE_SCREENSHOT",
 *    data: {
 *      "url": "https://example.com",
 *      "image": "dataURi:....."
 *    }
 *  }
 */

let NewTabWebChannelImpl = function NewTabWebChannelImpl() {
  EventEmitter.decorate(this);
};

NewTabWebChannelImpl.prototype = {
  _prefs: {
    mode: "production",
    enabled: false
  },
  _channel: null,
  _targets: null,
  _browsers: null,

  /*
   * Returns current channel's ID
   */
  get chanId() {
    return CHAN_ID;
  },

  /*
   * Returns the number of targets currently tracking
   */
  get numTargets() {
    return this._targets.size;
  },

  /*
   * Returns current channel's origin
   */
  get origin() {
    return MODE_CHANNEL_MAP[this._prefs.mode].origin;
  },

  /*
   * Gets called when a known browser is unloaded
   */
  _unloadTarget(msg) {
    if (this._browsers.has(msg.target.browser)) {
      this._browsers.delete(msg.target.browser);
      this._targets.delete(msg.target);
      this.emit("targetUnload", msg.target);
    }
  },

  /*
   * Receives a message from content.
   *
   * Keeps track of browsers for broadcast, relays messages to listeners.
   */
  _incomingMessage(id, message, target) {
    if (this.chanId !== id) {
      Cu.reportError(new Error("NewTabWebChannel unexpected message destination"));
    }

    /*
     * need to differentiate by browser, because event targets are created every
     * time a message is sent.
     */
    if (!this._browsers.has(target.browser)) {
      this._browsers.add(target.browser);
      this._targets.add(target);
      this.emit("targetAdd", target);
    }

    try {
      let msg = JSON.parse(message);
      this.emit(msg.type, {data: msg.data, target: target});
    } catch (err) {
      Cu.reportError(err);
    }
  },

  /*
   * Sends a message to all known browsers
   */
  broadcast(actionType, message) {
    for (let target of this._targets) {
      this._channel.send({type: actionType, data: message}, target);
    }
  },

  /*
   * Sends a message to a specific browser
   */
  send(actionType, message, target) {
    this._channel.send({type: actionType, data: message}, target);
  },

  /*
   * Pref change observer callback
   */
  _handlePrefChange(prefName, newState, forceState) { //jshint unused:false
    switch (prefName) {
      case PREF_ENABLED:
        if (!this._prefs.enabled && newState) {
          // changing state from disabled to enabled
          this.setup();
        } else if (this._prefs.enabled && !newState) {
          // changing state from enabled to disabled
          this.tearDown();
        }
        break;
      case PREF_MODE:
        if (this._prefs.mode !== newState) {
          // changing modes
          this.tearDown();
          this.setup();
        }
        break;
    }
  },

  /*
   * Sets up the internal stats
   *
   * @param {Boolean} resetAll        when true, forces states to be reset
   */
  setup() {
    this._prefs.enabled = Preferences.get(PREF_ENABLED, false);
    this._prefs.mode = Preferences.get(PREF_MODE, "production");
    this._targets = new Set();
    this._browsers = new Set();

    if (this._prefs.enabled) {
      this._channel = new WebChannel(this.chanId, Services.io.newURI(this.origin, null, null));
      this._channel.listen(this._incomingMessage.bind(this));
      this.on("pagehide", this._unloadTarget.bind(this));
      this.on("unload", this._unloadTarget.bind(this));
      this.on("beforeunload", this._unloadTarget.bind(this));
    }
  },

  tearDown() {
    if (this._channel) {
      this._channel.stopListening();
    }
    this._prefs = {};
    this._channel = null;
    this._targets = null;
    this._browsers = null;
  },

  init() {
    this.setup();
    NewTabPrefsProvider.prefs.on(PREF_ENABLED, this._handlePrefChange.bind(this));
    NewTabPrefsProvider.prefs.on(PREF_MODE, this._handlePrefChange.bind(this));
  },

  uninit() {
    this.tearDown();
    NewTabPrefsProvider.prefs.off(PREF_ENABLED, this._handlePrefChange);
    NewTabPrefsProvider.prefs.off(PREF_MODE, this._handlePrefChange.bind(this));
  }
};

let NewTabWebChannel = new NewTabWebChannelImpl();
