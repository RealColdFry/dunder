const a = NaN;
const b = Infinity;
const c = globalThis;
const d = undefined;

const shorthand = { NaN, Infinity };

function shadow(NaN: number) {
  return NaN;
}
