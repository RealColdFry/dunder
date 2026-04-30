// Translate dunder Diagnostics into the TSTL-shaped `ts.Diagnostic` that
// TSTL's `TestBuilder.getLuaResult()` expects to find in
// `Transpiler.emit().diagnostics`. The harness routes dunder through the
// `Transpiler.prototype.emit` hijack in `setup.ts`; this module is the
// boundary that maps dunder diagnostic codes (D2010xx) to the live TSTL
// codes that test files assert against (100xxx).
//
// Resilient to TSTL renumbering: we look up the factory by name (stable),
// then read its `.code` field at translation time. If TSTL adds/removes
// factories the numbers shift, but our mapping by name still resolves.

import ts from "typescript";
import type { DiagCode } from "#/diagnostics/codes.ts";
import { tstlFactoryByDunderCode } from "#/diagnostics/tstl-mapping.ts";
import type { Diagnostic as DunderDiagnostic, Location } from "#/diagnostics/types.ts";

interface TstlFactoryFn {
  (...args: unknown[]): ts.Diagnostic;
  // `createSerialDiagnosticFactory` attaches `.code` to the returned
  // function; that's the live TSTL auto-code we want to surface.
  code: number;
}

export interface TstlDiagnosticsModule {
  [factoryName: string]: TstlFactoryFn | unknown;
}

export function translateDiagnostics(
  diags: readonly DunderDiagnostic[],
  tstlDiagnosticsModule: TstlDiagnosticsModule,
  fileBySource: Map<string, ts.SourceFile>,
): ts.Diagnostic[] {
  const out: ts.Diagnostic[] = [];
  for (const d of diags) {
    const factoryName = tstlFactoryByDunderCode[d.code as DiagCode];
    if (!factoryName) continue;
    const factory = tstlDiagnosticsModule[factoryName] as TstlFactoryFn | undefined;
    if (!factory || typeof factory.code !== "number") continue;

    const sf = d.location ? fileBySource.get(d.location.file) : undefined;
    out.push({
      file: sf,
      start: sf && d.location ? offsetFromLocation(sf, d.location) : undefined,
      length: d.location?.length,
      messageText: d.message,
      category:
        d.severity === "error" ? ts.DiagnosticCategory.Error : ts.DiagnosticCategory.Warning,
      code: factory.code,
      source: "typescript-to-lua",
    });
  }
  return out;
}

function offsetFromLocation(sf: ts.SourceFile, loc: Location): number {
  // TSTL diagnostic factories use absolute offsets; we have 1-based
  // line/column. Convert via the SourceFile's line table.
  return sf.getPositionOfLineAndCharacter(loc.line - 1, loc.column - 1);
}
