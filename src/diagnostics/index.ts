export { DiagCode, codePrefix, diagHelp } from "./codes.ts";
export { fromTscDiagnostic, fromTsgoDiagnostic } from "./from-ts.ts";
export { render, renderAll } from "./render.ts";
export { dunderCodeForTstlFactory, tstlFactoryByDunderCode } from "./tstl-mapping.ts";
export { createSink } from "./types.ts";
export type { Diagnostic, DiagnosticSink, Location, Severity } from "./types.ts";
