// Resolved compiler-options surface shared by both pipelines.
//
// tsc's `parsed.options` and tsgo's `project.compilerOptions` produce
// structurally-identical blobs for the same tsconfig (same field set,
// same enum values). We confirmed this empirically; the only real
// difference is tsgo types its blob as `Record<string, unknown>` while
// tsc types its blob as `ts.CompilerOptions`. `fromTsgo` is the
// single justified cast site; `fromTsc` is a passthrough.
//
// Derived flags either come from internal `ts.*` helpers (typed via
// `src/typescript-internal.d.ts`) when those have the semantics we
// want, or are reimplemented inline when they don't. Strict-bundle
// flags are reimplemented because TS's `getStrictOptionValue` returns
// true when both `strict` and the sub-flag are absent, while dunder
// wants the opposite default.

/// <reference path="../typescript-internal.d.ts" />
import * as ts from "typescript";

export type ResolvedCompilerOptions = ts.CompilerOptions;

export function fromTsc(opts: ts.CompilerOptions): ResolvedCompilerOptions {
  return opts;
}

export function fromTsgo(raw: Record<string, unknown>): ResolvedCompilerOptions {
  return raw as ts.CompilerOptions;
}

// ── Accessors ─────────────────────────────────────────────────────────────
//
// Each entry below resolves a flag whose effective value depends on
// either a fallback (strict bundle) or a target-derived default
// (`useDefineForClassFields`). Reading the raw field directly would
// miss the case where the user omitted it but the resolved value still
// matters. Always go through these accessors.

export function strict(opts: ResolvedCompilerOptions): boolean {
  return opts.strict ?? false;
}

export function strictNullChecks(opts: ResolvedCompilerOptions): boolean {
  return opts.strictNullChecks ?? opts.strict ?? false;
}

export function noImplicitAny(opts: ResolvedCompilerOptions): boolean {
  return opts.noImplicitAny ?? opts.strict ?? false;
}

export function noImplicitThis(opts: ResolvedCompilerOptions): boolean {
  return opts.noImplicitThis ?? opts.strict ?? false;
}

export function useDefineForClassFields(opts: ResolvedCompilerOptions): boolean {
  return ts.getUseDefineForClassFields(opts);
}
