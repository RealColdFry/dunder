// Each iteration of `for (let i ...)` creates a fresh binding for `i`.
// Closures created in the body capture that iteration's binding, so
// invoking them later returns the per-iteration value, not the final one.

export function __main(): number[] {
  const fns: (() => number)[] = [];
  for (let i = 0; i < 3; i = i + 1) {
    fns.push(() => i);
  }
  const out: number[] = [];
  for (let j = 0; j < 3; j = j + 1) {
    out.push(fns[j]());
  }
  return out;
}
