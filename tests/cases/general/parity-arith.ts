// Parity demo: basic arithmetic. Source has a `__main` export, so the
// test runner additionally executes the JS (via tsc + node) and the
// Lua (via lua-wasm-bindings), comparing return values.

export function __main() {
  const a = 3 + 4;
  const b = a * 2;
  const c = b - 5;
  return c;
}
