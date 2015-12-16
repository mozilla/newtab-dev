/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global XPCOMUtils, PromiseMessage, dump*/
/*exported NSGetFactory*/
"use strict";
const {
  interfaces: Ci,
  utils: Cu
} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PromiseMessage",
  "resource://gre/modules/PromiseMessage.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "ContentSearch",
  "resource:///modules/ContentSearch.jsm");

function out(msg) {
  dump(`
=============&&&&&&&&&&&&&============
${msg}

`);
}

function dumpResult(r){
  dump(`\n ================ DUMPING RESULT ${r} =========\n`);
  for(var i in r){
    out(`${i} -> ${r[i]}`);
  }
  return r;
}

function MozContentSearch() {
  out("Created MozContentSearch....");
}

function getMessageManager(contentWindow) {
  out("getting message manager form getMessageManager");
  return contentWindow
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIDocShell)
    .sameTypeRootTreeItem
    .QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIContentFrameMessageManager);
}

MozContentSearch.prototype = {
  classDescription: "Provides a WebIDL wrapper for ContentSearch",
  classID: Components.ID("{4f33efd5-f87d-4420-bec9-a411ce297973}"),
  contractID: "@mozilla.org/MozContentSearch;1",
  QueryInterface: XPCOMUtils.generateQI(
    [Ci.nsISupports, Ci.nsIDOMGlobalPropertyInitializer]
  ),
  _UIStrings: null,
  _contentWindow: null,
  _mm: null,
  _engineCache: new Map(),
  init(contentWindow) {
    this._mm = getMessageManager(contentWindow);
    this._mm.addMessageListener("ContentSearch", this.handleContentSearch.bind(this));
    this._win = contentWindow;
    out("Finished initializing MozContentSearch");
  },
  _processUIStrings(uiStringsObj){
    const uiStrings = new this._win.MozSearchUIStrings();
    Object.getOwnPropertyNames(uiStringsObj)
      .map(
        (name) => [String(name), String(uiStringsObj[name])]
      )
      .reduce(
        (maplike, [name, value]) => maplike.__set(name,value), uiStrings
      );
    return uiStrings;
  },
  _modifyFormHistory(type, data) {
    return new this._win.Promise((resolve, reject) => {
      PromiseMessage.send(this._mm, "ContentSearch", {type, data})
        .then(
          // Destructure out the result
          ({data: {data: result}}) => resolve(result)
        )
        .catch(
          ({message}) => reject(new this._win._Error(message))
        );
    });
  },
  getVisibleEngines(){
    const data ={
      type: "GetVisibleEngines",
      data: null,
    };

    function convertToSafeArray(engines){
      let safeArray = Cu.cloneInto([], this._win);
      engines.map(
        engineDetails => new this._win.MozSearchEngineDetails(engineDetails)
      ).reduce(
        (collector, next) => {collector.push(next); return collector}, safeArray
      );
      return safeArray;
    }

    out("SENDING MESSAGE: GetVisibleEngines");
    return new this._win.Promise((resolve, reject)=>{
      out("...in promise... sending....");
      PromiseMessage.send(this._mm, "ContentSearch", data)
        .then(({data: {data: engines}}) => engines)
        .then(convertToSafeArray.bind(this))
        .then(resolve)
        .catch(
          ({message}) => reject(new this._win.Error(message))
        );

    });
  },
  get UIStrings(){
    if(this._UIStrings){
      return this._win.Promise.resolve(this._UIStrings);
    }
    const data ={
      type: "GetStrings",
      data: null,
    };
    return new this._win.Promise((resolve, reject)=>{
      PromiseMessage.send(this._mm, "ContentSearch", data)
        .then(
          ({data: {data: UIStrings}}) => UIStrings
        )
        .then(
          this._processUIStrings.bind(this)
        )
        .then(
          uiStrings => this._UIStrings = uiStrings
        )
        .then(
          uiStrings => resolve(uiStrings)
        )
        .catch(
          ({message}) => reject(new this._win.Error(message))
        );

    });
  },
  addFormHistoryEntry(entry) {
    return this._modifyFormHistory("AddFormHistoryEntry", entry);
  },
  removeFormHistoryEntry(entry) {
    return this._modifyFormHistory("RemoveFormHistoryEntry", entry);
  },
  performSearch() {
    // const data ={
    //   type: "GetCurrentEngine",
    //   data: null,
    // };
  },
  get currentEngine() {
    const data = {
      type: "GetCurrentEngineDetails",
      data: null,
    };
    return new this._win.Promise((resolve, reject)=>{
      PromiseMessage.send(this._mm, "ContentSearch", data)
        //extract result
        .then(
          ({data: {data: rawEngineDetails}}) => rawEngineDetails
        )
        .then(dumpResult)
        .then(
          this._storeEngine.bind(this)
        )
        .then(
          mozEngine => resolve(mozEngine)
        )
        .catch(
          ({message}) => reject(new this._win.Error(message))
        );
    });
  },
  _storeEngine(engineDetails){
    if(!this._engineCache.has(engineDetails.name)){
      let engine = new this._win.MozSearchEngineDetails(engineDetails);
      this._engineCache.set(engine.name, engine);
    }
    return this._engineCache.get(engineDetails.name);
  },
  handleContentSearch({data: {data}, data: {type}}) {
    out(`GOT A MESSAGE: ${type}, ${data.name} `);
    // for (var i in msg.data) {
    //   out(`msg.data: ${i} ===> ${msg.data[i]}`);
    // }
    // for (var i in msg.data.data) {
    //   out(`msg.data.data: ${i} ===> ${msg.data.data[i]}`);
    // }
    switch(type){
      // Default search engine has changed!
      case "CurrentEngine":
        this._fireEngineChangeEvent(data.name);
        break;
      case "Strings":
        this._UIStrings = this._processUIStrings(data);
        break;
    }
  },
  get onenginechange() {
    return this.__DOM_IMPL__.getEventHandler("onenginechange");
  },
  set onenginechange(handler) {
    this.__DOM_IMPL__.setEventHandler("onenginechange", handler);
  },
  _fireEngineChangeEvent(name) {
    out("Trying fire engine change dispatchEvent", name);
    const data = {
      type: "GetEngineDetails",
      data: name,
    };
    PromiseMessage.send(this._mm, "ContentSearch", data)
      .then(x => {out("got to here here:" + x); return x;})
      .then(
        dumpResult
      )
      .then(
        ({data: {data: rawEngineDetails}}) => rawEngineDetails
      )
      .then((rawEngineDetails)=>{
        out("got back... content search" + rawEngineDetails);
        if(!rawEngineDetails){
          out("but it was empty?" + rawEngineDetails);
          return;
        }
        const engine = this._storeEngine(rawEngineDetails);
        const eventDetail = Cu.cloneInto({detail: {}}, this._win);
        eventDetail.detail.engine = engine;
        const event = new this._win.CustomEvent("enginechange", eventDetail);
        out("=>>>>>>>>>>>>> fire the event!!!!!!!");
        this.__DOM_IMPL__.dispatchEvent(event);
      }).catch(err => out(err));
  },

  __init() {}
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([MozContentSearch]);
