// `for (let i ...)` introduces a fresh `i` scoped to the loop. The outer
// `i` must be unaffected after the loop exits.

export function __main(): number {
  let i = 42;
  for (let i = 0; i < 10; i = i + 1) {
    // intentionally empty
  }
  return i;
}
