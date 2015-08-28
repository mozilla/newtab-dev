/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global XPCOMUtils, Services, BinarySearch, PlacesUtils, gPrincipal, EventEmitter */
/* exported PlacesProvider */

"use strict";

this.EXPORTED_SYMBOLS = ["PlacesProvider"];

const {interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "BinarySearch",
  "resource://gre/modules/BinarySearch.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PlacesUtils",
  "resource://gre/modules/PlacesUtils.jsm");

XPCOMUtils.defineLazyGetter(this, "EventEmitter", function() {
  const {EventEmitter} = Cu.import("resource://gre/modules/devtools/event-emitter.js", {});
  return EventEmitter;
});

XPCOMUtils.defineLazyGetter(this, "gPrincipal", function() {
  let uri = Services.io.newURI("about:newtab", null, null);
  return Services.scriptSecurityManager.getNoAppCodebasePrincipal(uri);
});

// The maximum number of results PlacesProvider retrieves from history.
const HISTORY_RESULTS_LIMIT = 100;

/**
 * Singleton that checks if a given link should be displayed on about:newtab
 * or if we should rather not do it for security reasons. URIs that inherit
 * their caller's principal will be filtered.
 */
let LinkChecker = {
  _cache: {},

  get flags() {
    return Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL |
           Ci.nsIScriptSecurityManager.DONT_REPORT_ERRORS;
  },

  checkLoadURI: function LinkChecker_checkLoadURI(aURI) {
    if (!(aURI in this._cache)) {
      this._cache[aURI] = this._doCheckLoadURI(aURI);
    }

    return this._cache[aURI];
  },

  _doCheckLoadURI: function LinkChecker_doCheckLoadURI(aURI) {
    try {
      Services.scriptSecurityManager.
        checkLoadURIStrWithPrincipal(gPrincipal, aURI, this.flags);
      return true;
    } catch (e) {
      // We got a weird URI or one that would inherit the caller's principal.
      return false;
    }
  }
};

/**
 * Singleton that provides utility functions for links.
 * A link is a plain object that looks like this:
 *
 * {
 *   url: "http://www.mozilla.org/",
 *   title: "Mozilla",
 *   frecency: 1337,
 *   lastVisitDate: 1394678824766431,
 * }
 */
let LinkUtils = {
  _sortProperties: [
    "frecency",
    "lastVisitDate",
    "url",
  ],

  /**
   * Compares two links.
   *
   * @param {String} aLink1 The first link.
   * @param {String} aLink2 The second link.
   * @return {Number} A negative number if aLink1 is ordered before aLink2, zero if
   *         aLink1 and aLink2 have the same ordering, or a positive number if
   *         aLink1 is ordered after aLink2.
   *         Order is ascending.
   */
  compareLinks: function LinkUtils_compareLinks(aLink1, aLink2) {
    for (let prop of this._sortProperties) {
      if (!(prop in aLink1) || !(prop in aLink2)) {
        throw new Error("Comparable link missing required property: " + prop);
      }
    }
    return aLink2.frecency - aLink1.frecency ||
           aLink2.lastVisitDate - aLink1.lastVisitDate ||
           aLink1.url.localeCompare(aLink2.url);
  },
};

/**
 * Singleton that serves as the default link provider for the grid. It queries
 * the history to retrieve the most frequently visited sites.
 */
let Links = {
  /**
   * EventEmitter interface
   */
  eventEmitter: new EventEmitter(),
  on: (...params) => this.eventEmitter.on(...params),
  once: (...params) => this.eventEmitter.once(...params),
  off: (...params) => this.eventEmitter.off(...params),

  /**
   * Set this to change the maximum number of links the provider will provide.
   */
  maxNumLinks: HISTORY_RESULTS_LIMIT,

  /**
   * A set of functions called by @mozilla.org/browser/nav-historyservice
   * All history events are emitted from this object.
   */
  historyObserver: {
    onDeleteURI: function PlacesProvider_onDeleteURI(aURI) {
      // let observers remove sensetive data associated with deleted visit
      Links.eventEmitter.emit("deleteURI", {
        url: aURI.spec,
      });
    },

    onClearHistory: function() {
      Links.eventEmitter.emit("clearHistory");
    },

    onFrecencyChanged: function PlacesProvider_onFrecencyChanged(aURI,
                           aNewFrecency, aGUID, aHidden, aLastVisitDate) { // jshint ignore:line
      // The implementation of the query in getLinks excludes hidden and
      // unvisited pages, so it's important to exclude them here, too.
      if (!aHidden && aLastVisitDate) {
        Links.eventEmitter.emit("linkChanged", {
          url: aURI.spec,
          frecency: aNewFrecency,
          lastVisitDate: aLastVisitDate,
          type: "history",
        });
      }
    },

    onManyFrecenciesChanged: function PlacesProvider_onManyFrecenciesChanged() {
      Links.eventEmitter.emit("manyLinksChanged");
    },

    onTitleChanged: function PlacesProvider_onTitleChanged(aURI, aNewTitle) {
      Links.eventEmitter.emit("linkChanged", {
        url: aURI.spec,
        title: aNewTitle
      });
    },

    QueryInterface: XPCOMUtils.generateQI([Ci.nsINavHistoryObserver,
                        Ci.nsISupportsWeakReference])
  },

  /**
   * Must be called before the provider is used.
   */
  init: function PlacesProvider_init() {
    PlacesUtils.history.addObserver(this.historyObserver, true);
  },

  /**
   * Gets the current set of links delivered by this provider.
   *
   * @returns {Promise} Returns a promise with the array of links as payload.
   */
  getLinks: function PlacesProvider_getLinks() {
    let getLinksPromise = new Promise((resolve, reject) => {
      let options = PlacesUtils.history.getNewQueryOptions();
      options.maxResults = this.maxNumLinks;

      // Sort by frecency, descending.
      options.sortingMode = Ci.nsINavHistoryQueryOptions
        .SORT_BY_FRECENCY_DESCENDING;

      let links = [];

      let callback = {
        handleResult: function(aResultSet) {
          let row;

          while ((row = aResultSet.getNextRow())) {
            let url = row.getResultByIndex(1);
            if (LinkChecker.checkLoadURI(url)) {
              let title = row.getResultByIndex(2);
              let frecency = row.getResultByIndex(12);
              let lastVisitDate = row.getResultByIndex(5);
              links.push({
                url: url,
                title: title,
                frecency: frecency,
                lastVisitDate: lastVisitDate,
                type: "history",
              });
            }
          }
        },

        handleError: function(aError) {
          reject(aError);
        },

        handleCompletion: function(aReason) { // jshint ignore:line
          // The Places query breaks ties in frecency by place ID descending, but
          // that's different from how Links.compareLinks breaks ties, because
          // compareLinks doesn't have access to place IDs.  It's very important
          // that the initial list of links is sorted in the same order imposed by
          // compareLinks, because Links uses compareLinks to perform binary
          // searches on the list.  So, ensure the list is so ordered.
          let i = 1;
          let outOfOrder = [];
          while (i < links.length) {
            if (LinkUtils.compareLinks(links[i - 1], links[i]) > 0) {
              outOfOrder.push(links.splice(i, 1)[0]);
            } else {
              i++;
            }
          }
          for (let link of outOfOrder) {
            i = BinarySearch.insertionIndexOf(LinkUtils.compareLinks, links, link);
            links.splice(i, 0, link);
          }

          resolve(links);
        }
      };

      // Execute the query.
      let query = PlacesUtils.history.getNewQuery();
      let db = PlacesUtils.history.QueryInterface(Ci.nsPIPlacesDatabase);
      db.asyncExecuteLegacyQueries([query], 1, options, callback);
    });

    return getLinksPromise;
  }
};

let PlacesProvider = {
  LinkChecker: LinkChecker,
  LinkUtils: LinkUtils,
  Links: Links,
};
