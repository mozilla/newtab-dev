/* globals Services */

"use strict";

this.EXPORTED_SYMBOLS = ["RemoteNewTabLocation"];

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.importGlobalProperties(["URL"]);

// TODO: will get dynamically set in bug 1210478
const DEFAULT_PAGE_LOCATION = "https://newtab.cdn.mozilla.net/v2/nightly/en-US/index.html";

// remote page location pref name
const REMOTE_LOCATION_PREF = "browser.newtabpage.remotelocation";

this.RemoteNewTabLocation = {
  _url: new URL((Services.prefs.getPrefType(REMOTE_LOCATION_PREF) &&
                 Services.prefs.getCharPref(REMOTE_LOCATION_PREF)) || DEFAULT_PAGE_LOCATION),
  _overridden: false,

  get href() {
    return this._url.href;
  },

  get origin() {
    return this._url.origin;
  },

  get overridden() {
    return this._overridden;
  },

  override: function(newURL) {
    this._url = new URL(newURL || DEFAULT_PAGE_LOCATION);
    this._overridden = true;
    Services.obs.notifyObservers(null, "remote-new-tab-location-changed",
      this._url.href);
  },

  reset: function() {
    this._url = new URL(DEFAULT_PAGE_LOCATION);
    this._overridden = false;
    Services.obs.notifyObservers(null, "remote-new-tab-location-changed",
      this._url.href);
  }
};
