/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils*/
/*exported NSGetFactory*/
"use strict";

const {interfaces: Ci, utils: Cu} = Components;

// The maximum number of results PlacesProvider retrieves from history.
const HISTORY_RESULTS_LIMIT = 100;
const PLACES_EVENT = "PlacesProvider";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PromiseMessage",
  "resource://gre/modules/PromiseMessage.jsm");

function out(msg) {
  if (msg === null || msg === undefined) {
    dump(`\n## MozPlacesProvider ## : Tried to log something, but it was undefined or null.\n`);
  } else if (typeof msg === 'string') {
    dump(`\n## MozPlacesProvider ## : ${msg}\n`);
  } else if (typeof msg === 'object') {
    dump('\n## MozPlacesProvider ## : {\n');
    for (let key in msg) {
      const val = msg[key];
      dump(`  ${key}: ${msg}\n`);
    }
    dump('}\n');
  }
}

function getMessageManager(contentWindow) {
  out("Getting messageManager");
  return contentWindow
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIDocShell)
    .sameTypeRootTreeItem
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIContentFrameMessageManager);
}

function MozPlacesProvider() {}

MozPlacesProvider.prototype = {
  classDescription: "Defines MozPlacesProvider objects",
  classID: Components.ID("{0e72906a-f6c1-4e20-8775-c26ce45193f8}"),
  contractID: "@mozilla.org/MozPlacesProvider;1",
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]),

  init(contentWindow) {
    this._mm = getMessageManager(contentWindow);
    this._mm.addMessageListener(PLACES_EVENT, this._receiveEvent.bind(this));
    this._win = contentWindow;
  },

  getFrecentSites() {
    return new this._win.Promise((resolve, reject) => {
      this._send({type: 'GetFrecentSites'})
      .then(data => {
        out('ALL GOOD');
        const results = new this._win.Array();
        data.forEach(site => {
          const safeSite = new this._win.Object(site);
          results.push(safeSite);
        });
        out(results);
        resolve({data: results});
      })
      .catch(err => {
        out(err);
        reject(err);
      });
    });
  },

  _send(data) {
    return Task.spawn(function* () {
      const reply = yield PromiseMessage.send(this._mm, PLACES_EVENT, data);
      return reply.data.data;
    }.bind(this));
  },

  _receiveEvent(msg) {
    const {data} = msg;
    const {type} = data;

    switch (type) {
    case 'GetFrecentSites':
      out(data);
      break;
    default:
      out(`Message ${type} not recognized`);
      break;
    }
  },

  __init() {}
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozPlacesProvider]);
