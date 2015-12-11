/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils, PageThumbs, BackgroundPageThumbs*/
/*exported NSGetFactory*/
"use strict";
const {
  interfaces: Ci,
  utils: Cu
} = Components;
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.importGlobalProperties(["URL"]);
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbs",
  "resource://gre/modules/PageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "BackgroundPageThumbs",
  "resource://gre/modules/BackgroundPageThumbs.jsm");
/**
 * @constructor
 */
function MozNewTab() {
}
/**
 * Helper function creates contextualized objects
 * that can be used to quickly construct things
 * that can be returned to the ContentWindow.
 * @param  {Any} Constructor A Constructor.
 * @return {Function} A function that when called returns
 *                      an contextualized instance.
 */
function contextualObject(Constructor){
  return (...args) => new Constructor(...args);
}

function out(msg){
  dump(`
=============&&&&&&&&&&&&&============
${msg}

`);
}


MozNewTab.prototype = {
  _contentWindow: null,

  classDescription: "Implementation of MozNewTab.webidl",

  classID: Components.ID("{bdd78376-e211-409a-be04-1ad3c11cb469}"),

  contractID: "@mozilla.org/MozNewTab;1",

  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),

  get prefs() {
    return this._prefProvider;
  },

  get search() {
    return this._searchProvider;
  },

  __init() {},

  init(contentWindow) {
    this._contentWindow = contentWindow;
    this._prefProvider = new contentWindow.MozNewTabPrefProvider();
    this._searchProvider = new contentWindow.MozContentSearch();
  },

  _log(msg){
    this._contentWindow.console.log(msg);
  },

  _converToBlob(requestUrl){
    return new Promise((resolve,reject)=>{
      const imgSrc = PageThumbs.getThumbnailURL(requestUrl);
      this._log("creating image src", imgSrc);
        const doc = this._contentWindow.document;
        const img = doc.createElement("img");
        img.onload = () => {
          const canvas = doc.createElement("canvas");
          const ctx = canvas.getContext("2d");
          const { naturalWidth: width, naturalHeight: height } = img;
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          this._log("TO BLOB!");
          canvas.toBlob(resolve);
        };
     img.src = imgSrc;
     img.onerror = () => reject(new Error("Error loading ${requestUrl.href}"));
    });
  },

  capturePageThumb(url) {
    const error = contextualObject(this._contentWindow.Error);
    const promise = contextualObject(this._contentWindow.Promise);
    return promise((resolve, reject)=>{
      this._log("here we go!", url);
      let requestUrl;
      try{
        requestUrl = new URL(url);
      }catch(err){
        reject(error(err.message));
      }
      const rejectClient = (err) => reject(error(err.message));
      BackgroundPageThumbs.captureIfMissing(requestUrl.href)
        .then(this._converToBlob)
        .then(blob => resolve(blob))
        .catch(rejectClient);
    });
  },
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozNewTab]);
