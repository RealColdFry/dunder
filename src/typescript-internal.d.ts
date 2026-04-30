// Type augmentation for the npm `typescript` package, exposing internal
// helpers that aren't in the public `.d.ts`. Same pattern TSTL uses in
// `extern/tstl/src/typescript-internal.d.ts`.
//
// Scope is intentionally minimal: only the option-resolution helpers
// dunder consumes via `src/options/resolved.ts`. Adding a new derived
// flag means adding a one-line declaration here next to the matching
// accessor in `resolved.ts`.
//
// Note: `getStrictOptionValue` is intentionally NOT augmented in here.
// Its runtime semantics are `compilerOptions[flag] === undefined ?
// compilerOptions.strict !== false : !!compilerOptions[flag]` — the
// `!== false` (not `!== undefined`) means an absent `strict` is treated
// as enabled, which is the opposite of what dunder wants. We
// reimplement the strict-bundle accessors directly in `resolved.ts`.

export {};

declare module "typescript" {
  // Target-derived: defaults to true when `target >= ES2022`, else false.
  function getUseDefineForClassFields(opts: CompilerOptions): boolean;
}
