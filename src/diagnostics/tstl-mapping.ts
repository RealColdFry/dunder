// TSTL diagnostic correspondence. Maps dunder DiagCode constants to the
// TSTL diagnostic factory *name* (not number). TSTL assigns codes via a
// monotonic factory that shifts numbers across versions; the factory name
// is the stable identity. This map is the bridge for parity testing: when
// asserting that dunder fires "the same diagnostic TSTL would here," we
// compare against the factory by name and let TSTL produce a fresh
// instance to read its current code at compare time.
//
// Empty until validators land; populated as each rule is implemented.

import { DiagCode } from "./codes.ts";

export const tstlFactoryByDunderCode: Partial<Record<DiagCode, string>> = {
  [DiagCode.TstlNoSelfFunctionConversion]: "unsupportedNoSelfFunctionConversion",
  [DiagCode.TstlSelfFunctionConversion]: "unsupportedSelfFunctionConversion",
  [DiagCode.TstlOverloadAssignment]: "unsupportedOverloadAssignment",
  [DiagCode.TstlTruthyOnlyConditionalValue]: "truthyOnlyConditionalValue",
};

// Reverse direction: TSTL factory name → dunder code. Useful for
// conformance harnesses that read TSTL's expected diagnostic and need to
// find the dunder counterpart.
export function dunderCodeForTstlFactory(name: string): DiagCode | undefined {
  for (const [code, factory] of Object.entries(tstlFactoryByDunderCode)) {
    if (factory === name) return Number(code) as DiagCode;
  }
  return undefined;
}
