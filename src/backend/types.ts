// The Backend interface: identity + three slots that plug into the dunder
// pipeline at distinct phases.
//
//   ambient    — .d.ts files merged into the tsgo project before checking.
//                Diagnostics fire from the TS checker for free.
//   validators — typed-AST hooks that run during the resolve phase. They
//                queue checker queries during collect and read cached types
//                during validate. Diagnostic-only; do not affect emit.
//   lowerings  — per-IR-kind overrides consulted by the shared lowering
//                pass. Default lowerings live in `src/lua/lower/`; backends
//                replace entries for ES leak nodes that need divergent emit.
//
// Step 1 of the slot framework: types only. The pipeline does not yet
// consume Backend; the default backend (`./default.ts`) wraps current
// behavior so call sites can migrate incrementally.

import type { Diagnostic, DiagnosticSink } from "../diagnostics/index.ts";
import type { Divergence } from "../divergences.ts";
import type * as lua from "../lua/ast.ts";
import type { LuaCapabilities } from "../lua/capabilities.ts";
import type { IRNode } from "../ir/visit.ts";
import type { Node, SourceFile, Symbol, Type } from "../ts.ts";

// Re-exported so plugin authors can import everything from `backend/types`.
// The canonical home is `src/diagnostics/`.
export type { Diagnostic, DiagnosticSink };

export interface Backend {
  name: string;
  target: LuaCapabilities;
  ambient: AmbientSpec;
  validators: Validator[];
  lowerings: LoweringOverrides;
}

// ── Ambient ────────────────────────────────────────────────────────────────

// `replaceLib` triggers `noLib: true` plus full lib replacement; default
// (false) merges these files on top of dunder's baseline ES lib.
export interface AmbientSpec {
  files: AmbientFile[];
  replaceLib?: boolean;
}

export type AmbientFile = { path: string } | { name: string; contents: string };

// ── Validators ─────────────────────────────────────────────────────────────

// Two-phase: collect queues queries during AST walk (no checker calls),
// validate reads results post-resolve (no checker calls under tsgo, since
// the resolve phase batched them already; on tsc the cache calls through
// directly because tsc has no batching cost). The `ValidatorPlan` is each
// validator's private payload that flows from collect to validate; the
// framework does not inspect it.
//
// The current tsc smoke-test path makes `q` a no-op (all queries fan out
// lazily via the cache). The tsgo path will collect into a real batch.
export interface Validator {
  name: string;
  // Documented divergences this validator is the user-facing detector for.
  // Optional but encouraged: declaring the linkage means we can later
  // build a coverage matrix ("every documented divergence has at least one
  // backend that surfaces it") and explain `--explain DIV-X` in terms of
  // the validators that detect it.
  divergences?: readonly Divergence[];
  collect(sf: SourceFile, q: ValidatorQueries): ValidatorPlan;
  validate(ctx: ValidateCtx): void;
}

export type ValidatorPlan = unknown;

// Queue interface mirrors the per-method batch overloads in the frontend's
// resolve pass. One RPC per checker method, regardless of how many
// validators or how many call sites.
export interface ValidatorQueries {
  typeAtLocation(node: Node): void;
  symbolAtLocation(node: Node): void;
  typeOfSymbol(sym: Symbol): void;
}

export interface TypeCache {
  typeAt(node: Node): Type | undefined;
  symbolAt(node: Node): Symbol | undefined;
  // Symbol's type at a location. Located rather than free-floating because
  // tsc's only entry point is `getTypeOfSymbolAtLocation`; the location
  // disambiguates when generics are involved.
  typeOfSymbolAt(sym: Symbol, atNode: Node): Type | undefined;
}

// What `validate` receives. The plan + type cache are the framework
// abstractions; `sourceFile` and the underlying `checker` are escape
// hatches for rules that need richer access (e.g. structural recursion
// over interface members) than the cache surface provides.
export interface ValidateCtx {
  plan: ValidatorPlan;
  sourceFile: SourceFile;
  // The raw TS checker. Validators should prefer `types` for routine
  // queries; the checker is for cases where the cache abstraction would
  // lose fidelity (e.g. tsc's `isArrayType`, signature walking).
  // Typed as `unknown` here to keep `backend/types.ts` checker-agnostic;
  // each validator casts to the concrete checker shape it expects.
  checker: unknown;
  types: TypeCache;
  sink: DiagnosticSink;
  // Resolved compiler options. Some rules behave differently under
  // `strictNullChecks` etc.; they read from here rather than walking back
  // to a program reference.
  compilerOptions: { strict?: boolean; strictNullChecks?: boolean };
  // Pre-built origin string ("validator:<backend>/<rule>") for the
  // diagnostics this validator pushes. Saves each validator from
  // hand-formatting the same prefix.
  origin: string;
}

// ── Lowerings ──────────────────────────────────────────────────────────────

// Sparse override map keyed by IR node kind. Default lowerings live
// elsewhere; a backend supplies entries only for the nodes it wants to
// handle differently. Return type is intentionally permissive: most nodes
// lower to a `lua.Expression`, but some lower to a list of statements.
export type LoweringOverrides = Partial<{
  [K in IRNode["kind"]]: LowerFn<Extract<IRNode, { kind: K }>>;
}>;

export type LowerFn<N> = (node: N, ctx: LowerCtx) => lua.Expression | lua.Statement[];

// Concrete shape of LowerCtx is owned by `src/lua/lower/`; declared here as
// an opaque marker so plugin signatures resolve. Step 3 of the framework
// (lowering dispatch refactor) replaces this with the real shape.
export interface LowerCtx {
  readonly target: LuaCapabilities;
  readonly freshName: (prefix: string) => string;
}
