[Constructor(DOMString type, PrefChangeEventInit eventInitDict)]
interface MozPrefChangeEvent : Event {
  readonly attribute DOMString name;
  readonly attribute DOMString value;
};

dictionary PrefChangeEventInit : EventInit {
  required DOMString name;
  required DOMString value;
};
