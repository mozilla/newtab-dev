[Constructor(DOMString type, SearchEnginesChangeEventInit eventInitDict)]
interface MozSearchEnginesChangeEvent : Event {
  [Pure, Cached]
  readonly attribute sequence<MozSearchEngineDetails> engines;
};

dictionary SearchEnginesChangeEventInit : EventInit {
  required sequence<MozSearchEngineDetails> engines;
};

