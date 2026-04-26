// ES creates a fresh `i` binding per iteration AND the update expression
// executes within that iteration's binding scope, so closures should
// capture per-iteration values: `fns[i]() == i`. dunder today returns the
// final post-loop value of `i` for all three.

declare function print(...args: unknown[]): void;

const fns: (() => number)[] = [];
for (let i = 0; i < 3; i = i + 1) {
  fns[fns.length] = () => i;
}
print(fns[0]());
print(fns[1]());
print(fns[2]());
