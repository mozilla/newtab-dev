/*global XPCOMUtils*/
/*exported NSGetFactory*/
"use strict";
const {
  interfaces: Ci,
  utils: Cu
} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.importGlobalProperties(["URL"]);

function MozSearchIcon() {}

MozSearchIcon.prototype = {
  _width: 0,
  _height: 0,
  _url: "",
  get width(){
    return this._width;
  },
  get height(){
    return this._height;
  },
  get url(){
    return this._url;
  },
  classDescription: "Implementation of MozSearchIcon",
  classID: Components.ID("{d6c87e53-270e-4285-b407-542b3b46824e}"),
  contractID: "@mozilla.org/MozSearchIcon;1",
  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),
  init(contentWindow) {
    this._win = contentWindow;
  },
  __init(width, height, url) {
    this._width = width;
    this._height = height;
    this._url = new URL(url, this._win.location).href;
  }
};

var components = [MozSearchIcon];
var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
