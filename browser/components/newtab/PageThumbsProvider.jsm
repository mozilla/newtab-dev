/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils, dump, Task*/
//navigator.mozNewTab.capturePageThumb("http://google.com").then(c => console.log(c), c => console.log(c))

"use strict";
this.EXPORTED_SYMBOLS = ["PageThumbsProvider"];
const {
  interfaces: Ci,
  utils: Cu,
  classes: Cc
} = Components;

Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PageThumbs",
  "resource://gre/modules/PageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "BackgroundPageThumbs",
  "resource://gre/modules/BackgroundPageThumbs.jsm");

const gMsgMngr = Cc["@mozilla.org/globalmessagemanager;1"]
  .getService(Ci.nsIMessageListenerManager);

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function dumpObj(r) {
  dump(`\n ================ DUMPING object ${r} =========\n`);
  for (var i in r) {
    out(`${i} -> ${r[i]} (type: ${typeof r[i]})`);
  }
  return r;
}


function out(msg) {
  dump(`
=============&&&&&&&&&&&&&============
${msg}

`);
}


const PageThumbsProvider = {
  _convertToBlob(url) {
    out("Converting to blob");
    return new Promise((resolve, reject)=>{
      let imgSrc = PageThumbs.getThumbnailURL(url);
      let doc = Services.appShell.hiddenDOMWindow.document;
      let img = doc.createElementNS(XHTML_NAMESPACE, "img");
      let canvas = doc.createElementNS(XHTML_NAMESPACE, "canvas");
      img.onload = (e) => {
        out("Image loaded:" + imgSrc);
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(this, 0, 0, this.naturalWidth, this.naturalHeight);
        canvas.toBlob(resolve);
      };
      img.onerror = (e) => {
        out("FUCK!");
        dumpObj(e);
        reject(new Error("Falied to load PageThumb"));
      }
      out("Trying to load image now..." + imgSrc);
      img.src = imgSrc;
    });
  },
  init() {
    gMsgMngr.addMessageListener("PageThumbsProvider", this);
  },
  uninit() {
    gMsgMngr.removeMessageListener("PageThumbsProvider", this);
  },
  receiveMessage(msg) {
    dump(`
++++++++++++++++++++++++++++++++++++++++++++
    PageThumbsProvider GOT MESSAGE! ${msg.data.request}
    ${msg.data.url}
  `);
    switch (msg.data.request) {
    case "CaptureIfMissing":
      Task.spawn(function* () {
        const {url} = msg.data;
        yield BackgroundPageThumbs.captureIfMissing(url);
        const imgSrc = PageThumbs.getThumbnailURL(url);
        const blob = yield this._convertToBlob(imgSrc);
        this._reply(msg, blob);
      }.bind(this));
      break;
    }
  },
  _reply(msg, data) {
    dump(`
++++++++++++++++++++++++++++++++++++++++++++
    PageThumbsProvider TRYING TO REPLy
  `);
    if (!msg.target.messageManager) {
      return;
    }
    let id = null;
    if (msg && typeof msg.data === "object" && msg.data.hasOwnProperty("id")) {
      id = msg.data.id;
    }
    let reply = {
      response: data,
      id,
    };
    dump(`
    ++++++++++++++++++++++++++++++++++++++++++++
    PageThumbsProvider SENDING REPLY ${JSON.stringify(reply)}
  `);
    msg.target.messageManager.sendAsyncMessage("NewTabPrefs", reply);
    dump("\n ,PageThumbsProvider,....AND SENT!!!");
  }
};
