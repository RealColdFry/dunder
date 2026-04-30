// `f` has implicit `this: any`; assigning to a `(this: void) => void`
// slot should fire `unsupportedNoSelfFunctionConversion`.
const f = function () {
  return 1;
};
const g: (this: void) => number = f;

// Reverse: arrow has implicit `this: void`; assigning to a `(this: any)`
// slot should fire `unsupportedSelfFunctionConversion`.
const h = () => 1;
const i: (this: object) => number = h;
