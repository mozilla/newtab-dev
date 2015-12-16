[NavigatorProperty="mozNewTab", JSImplementation="@mozilla.org/MozNewTab;1"]
interface MozNewTab {
  readonly attribute MozNewTabPrefProvider prefs;
  readonly attribute MozContentSearch search;
  Promise<Blob> capturePageThumb(DOMString url);
};

[JSImplementation="@mozilla.org/MozNewTabPrefProvider;1", ChromeConstructor]
interface MozNewTabPrefProvider : EventTarget {
  attribute EventHandler onprefchange;
  MozPreferencesMap getCurrent();
  //promise set(DOMString name, DOMString value);
};

[JSImplementation="@mozilla.org/MozPreferencesMap;1", ChromeConstructor]
interface MozPreferencesMap {
  readonly maplike<DOMString, DOMString>;
};

[JSImplementation="@mozilla.org/MozSearchUIStrings;1", ChromeConstructor]
interface MozSearchUIStrings {
  readonly maplike<DOMString, DOMString>;
};

[JSImplementation="@mozilla.org/MozContentSearch;1", ChromeConstructor]
interface MozContentSearch : EventTarget {
  readonly attribute Promise<MozSearchUIStrings> UIStrings;
  Promise<MozSearchEngineDetails> getCurrentEngine();
  Promise<boolean> performSearch(optional SearchEngineQuery query);
  // Promise<sequence<MozSearchSuggestion>> getSuggestions(SearchEngineQuery query);
  Promise<boolean> addFormHistoryEntry(DOMString entry);
  Promise<boolean> removeFormHistoryEntry(DOMString entry);
  attribute EventHandler onenginechange;
  Promise<sequence<MozSearchEngineDetails>> getVisibleEngines();
};

[JSImplementation="@mozilla.org/MozSearchEngineDetails;1",
ChromeConstructor(SearchEngineDetails details)]
interface MozSearchEngineDetails {
  readonly attribute DOMString name;
  readonly attribute DOMString placeholder;
  [Pure, Cached]
  readonly attribute sequence<MozSearchIcon> icons;
};

[JSImplementation="@mozilla.org/MozSearchIcon;1",
ChromeConstructor(unsigned long width, unsigned long height, USVString url)]
interface MozSearchIcon {
  readonly attribute unsigned long height;
  readonly attribute unsigned long width;
  readonly attribute USVString url;
};

// [JSImplementation="@mozilla.org/MozEngineChangeEvent;1",
// Constructor(DOMString type, optional EngineChangeEventInit eventInitDict)]
// interface MozEngineChangeEvent : Event {
//   readonly attribute MozSearchEngineDetails engine;
// };

// dictionary EngineChangeEventInit : EventInit {
//   MozSearchEngineDetails engine;
// };

dictionary SearchEngineDetails {
  DOMString name;
  DOMString placeholder;
  sequence<SearchIcon> icons;
};

dictionary SearchIcon {
  unsigned long height;
  unsigned long width;
  USVString url;
};

// [NoInterfaceObject]
// [JSImplementation="@mozilla.org/MozSearchSuggestion;1", ChromeConstructor]
// interface MozSearchSuggestion {
//   readonly attribute DOMString engineName;
//   readonly attribute searchString
//   formHistory
//   remote
// };

dictionary SearchEngineQuery {
  DOMString name;
  DOMString searchString;
  DOMString searchPurpose;
  SearchEventDescription eventData;
  DOMString healthReportKey;
  DOMString engineName;
  DOMString formHistory;
  DOMString remote;
  unsigned long remoteTimeout;
};

dictionary SearchEventDescription {
  DOMString shiftKey;
  DOMString ctrlKey;
  DOMString metaKey;
  DOMString altKey;
  DOMString button;
  SelectionDescription selection;
};

dictionary SelectionDescription {
  long index;
  SearchSelectionKind kind;
};

enum SearchSelectionKind {
  "mouse", "key"
};
