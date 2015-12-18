[Constructor(DOMString type, SearchEngineChangeEventInit eventInitDict)]
interface MozSearchEngineChangeEvent : Event {
  readonly attribute MozSearchEngineDetails engine;
};

dictionary SearchEngineChangeEventInit : EventInit {
  required MozSearchEngineDetails engine;
};
