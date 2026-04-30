// Orchestrates validator execution against the tsc checker. Iterates each
// validator's collect → validate. The collect phase's `q` is a no-op
// because tsc has no batching cost; tsgo support will replace this runtime
// with a batching variant.

import type ts from "typescript";
import type { Diagnostic, DiagnosticSink } from "../diagnostics/types.ts";
import type { TypeCache, Validator, ValidatorQueries } from "./types.ts";

// No-op queue: collect-phase queries are recorded but unused. tsgo's
// batching runtime will replace this with a real implementation.
const noopQueries: ValidatorQueries = {
  typeAtLocation() {},
  symbolAtLocation() {},
  typeOfSymbol() {},
};

function tscTypeCache(checker: ts.TypeChecker): TypeCache {
  return {
    typeAt: (node) => checker.getTypeAtLocation(node as ts.Node),
    symbolAt: (node) => checker.getSymbolAtLocation(node as ts.Node),
    typeOfSymbolAt: (sym, atNode) =>
      checker.getTypeOfSymbolAtLocation(sym as ts.Symbol, atNode as ts.Node),
  };
}

export function runValidators(opts: {
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  compilerOptions: ts.CompilerOptions;
  validators: readonly Validator[];
  backendName: string;
}): Diagnostic[] {
  const { sourceFile, checker, compilerOptions, validators, backendName } = opts;
  const all: Diagnostic[] = [];
  const sink: DiagnosticSink = {
    push(d) {
      all.push(d);
    },
    get all() {
      return all;
    },
  };
  const types = tscTypeCache(checker);
  for (const v of validators) {
    const plan = v.collect(sourceFile, noopQueries);
    v.validate({
      plan,
      sourceFile,
      checker,
      types,
      sink,
      compilerOptions,
      origin: `validator:${backendName}/${v.name}`,
    });
  }
  return all;
}
