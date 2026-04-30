// The shared diagnostic shape across all dunder producers (TS checker
// passthrough, build pass, validators, lowering refusals). Designed as a
// normalization of tsgo's and tsc's Diagnostic structs so dunder is not
// tied to either pipeline's exact shape.
//
// Location is resolved at construction time (file + line + column +
// length) rather than carrying a Node reference: keeps Diagnostic
// pipeline-agnostic and serializable, and lets validators on tsgo and
// tsc producers emit identical-shaped output.

export type Severity = "error" | "warning";

export interface Location {
  file: string;
  line: number; // 1-based
  column: number; // 1-based
  length: number;
}

export interface Diagnostic {
  severity: Severity;
  // Numeric code. TS checker passthrough carries the TS code as-is (e.g.
  // 2322); dunder-side rules carry codes from `./codes.ts` (200000+). The
  // ranges do not overlap, so the renderer infers prefix from `origin`.
  code: number;
  message: string;
  // Producer identity. Suggested forms:
  //   "checker:syntactic" / "checker:semantic"  TS-side passthrough
  //   "build"                                   IR build refusal
  //   "validator:<backend>/<rule>"              backend validator
  //   "lower:<backend>"                         lowering refusal
  origin: string;
  location: Location | null;
}

export interface DiagnosticSink {
  push(d: Diagnostic): void;
  readonly all: readonly Diagnostic[];
}

export function createSink(): DiagnosticSink {
  const all: Diagnostic[] = [];
  return {
    push(d) {
      all.push(d);
    },
    get all() {
      return all;
    },
  };
}
