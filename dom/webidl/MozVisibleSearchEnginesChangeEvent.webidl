[Constructor(DOMString type, VisibleSearchEnginesChangeEventInit eventInitDict)]
interface MozVisibleSearchEnginesChangeEvent : Event {
  [Pure, Cached]
  readonly attribute sequence<MozSearchEngineDetails> engines;
};

dictionary VisibleSearchEnginesChangeEventInit : EventInit {
  required sequence<MozSearchEngineDetails> engines;
};

