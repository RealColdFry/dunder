// Shared classification used by replay-sim and replay-bench.
//
// We classify by the trace's `mapsTo` string rather than `method`. mapsTo is
// the instrumentation's claim about which tsgo IPC method this call would
// route to; method is the TSTL-side name (which may be a property read like
// "Type.symbol" or a method call like "Type.getSymbol", both pointing at the
// same IPC primitive).
//
// Anything not in the set below is treated as unsupported — either tsgo's
// async client genuinely doesn't expose it (e.g. `isArrayType`,
// `getBaseConstraintOfType`), or the instrumentation itself wrote
// "UNSUPPORTED" / "UNKNOWN" / "(flags bit)" / a bundled-data marker.

const CALLABLE_MAPSTO = new Set([
  // Checker methods (no receiver; first-order)
  "getTypeAtLocation",
  "getSymbolAtLocation",
  "getTypeOfSymbol",
  "getTypeOfSymbolAtLocation",
  "getDeclaredTypeOfSymbol",
  "getSignaturesOfType",
  "getSignaturesOfType(Call)", // Type.getCallSignatures
  "getContextualType",
  "getPropertiesOfType",       // Type.getProperties
  "getBaseTypes",
  "Type.getBaseType",          // singular form used by Type.getBaseTypes
  "getReturnTypeOfSignature",
  "getRestTypeOfSignature",
  "getBaseTypeOfLiteralType",
  "getConstraintOfTypeParameter",
  "getIndexInfosOfType",
  "getTypeArguments",          // Type.typeArguments
  "resolveName",
  "getResolvedSymbol",
  "isContextSensitive",
  "getShorthandAssignmentValueSymbol",
  // Type instance methods
  "Type.getSymbol",
  "Type.getTypes",
  "Type.getConstraint",
  // Symbol instance methods
  "Symbol.getMembers",
  "Symbol.getExports",
  "Symbol.getParent",
  "Symbol.getExportSymbol",
  // Signature instance methods
  "Signature.getReturnType",
]);

export function isCallable(mapsTo: string): boolean {
  return CALLABLE_MAPSTO.has(mapsTo);
}
