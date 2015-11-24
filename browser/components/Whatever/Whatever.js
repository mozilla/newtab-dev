Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function Whatever() {
  this.value = 111;
  this.invisibleValue = 12345;
}

Whatever.prototype = {
  classDescription: "Defines Whatever objects",
  // Generate your own UUID using `uuidgen`
  classID: Components.ID("{f312cb96-21b5-478c-904a-a6da0c2136a1}"),
  contractID: "@mozilla.org/Whatever;1",
  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsISupports]),
  doWhatever() {},
  get otherValue() { return this.invisibleValue - 4; },
  __init() {}
}

var components = [Whatever];
var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
