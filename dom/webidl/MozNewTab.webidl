[NavigatorProperty="mozNewTab", JSImplementation="@mozilla.org/MozNewTab;1"]
interface MozNewTab {
  readonly attribute MozNewTabPrefProvider prefs;
  readonly attribute MozContentSearch search;
  readonly attribute MozPlacesProvider places;
  Promise<Blob> capturePageThumb(DOMString url);
};

[JSImplementation="@mozilla.org/MozNewTabPrefProvider;1", ChromeConstructor]
interface MozNewTabPrefProvider : EventTarget {
  attribute EventHandler onprefchange;
  Promise<MozPreferencesMap> getCurrent();
};

[JSImplementation="@mozilla.org/MozPreferencesMap;1", ChromeConstructor]
interface MozPreferencesMap {
  readonly maplike<DOMString, DOMString>;
  Promise<boolean> update(DOMString name, DOMString value);
};

[JSImplementation="@mozilla.org/MozSearchUIStrings;1", ChromeConstructor]
interface MozSearchUIStrings {
  readonly maplike<DOMString, DOMString>;
};

[JSImplementation="@mozilla.org/MozContentSearch;1", ChromeConstructor]
interface MozContentSearch : EventTarget {
  void manageEngines();
  readonly attribute Promise<MozSearchUIStrings> UIStrings;
  Promise<MozSearchEngineDetails> getCurrentEngine();
  void performSearch(SearchEngineQuery query);
  Promise<sequence<MozSearchSuggestion>> getSuggestions(SearchSuggestionQuery query);
  Promise<boolean> addFormHistoryEntry(DOMString entry);
  Promise<boolean> removeFormHistoryEntry(DOMString entry);
  attribute EventHandler onenginechange;
  attribute EventHandler onvisibleenginechange;
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
  stringifier DOMString toJSON();
};

dictionary SearchEngineDetails {
  DOMString name;
  DOMString placeholder;
  sequence<SearchIcon> icons;
};

dictionary SearchIcon {
  unsigned long height = 0;
  unsigned long width = 0;
  required USVString url;
};

[JSImplementation="@mozilla.org/MozSearchSuggestion;1",
ChromeConstructor(SearchSuggestionQuery initDict)]
interface MozSearchSuggestion {
  readonly attribute DOMString engineName;
  readonly attribute DOMString searchString;
  [Pure, Cached]
  readonly attribute sequence<DOMString> formHistory;
  [Pure, Cached]
  readonly attribute sequence<DOMString> remote;
};

dictionary SearchEngineQuery : SearchSuggestionQuery {
  required DOMString searchPurpose;
  required DOMString healthReportKey;
};

dictionary SearchSuggestionQuery {
  required DOMString engineName;
  required DOMString searchString;
  DOMString name;
  SearchEventDescription originalEvent;
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

[JSImplementation="@mozilla.org/MozPlacesProvider;1", ChromeConstructor]
interface MozPlacesProvider : EventTarget {
  Promise<sequence<MozHistorySite>> getFrecentSites();
};

[JSImplementation="@mozilla.org/MozHistorySite;1",
ChromeConstructor(HistorySite site)]
interface MozHistorySite {
  readonly attribute unsigned long frecency;
  readonly attribute unsigned long lastVisitDate;
  readonly attribute DOMString title;
  readonly attribute DOMString type;
  readonly attribute USVString url;
  stringifier DOMString toJSON();
};

dictionary HistorySite {
  unsigned long frecency;
  unsigned long lastVisitDate;
  DOMString title = "";
  DOMString type;
  USVString url;
};
