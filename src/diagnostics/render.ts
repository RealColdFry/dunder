// Plain-text diagnostic rendering. Format mirrors tsc's plain output so
// editors and CI consumers can parse it without dunder-specific awareness.
//
//   <file>(<line>,<col>): error D201000: <message>
//     help: <optional help text>
//
// Colorized output and source-context squiggles are deferred until needed.

import { codePrefix, diagHelp, type DiagCode } from "./codes.ts";
import type { Diagnostic } from "./types.ts";

export function render(d: Diagnostic): string {
  const lines: string[] = [];
  const head: string[] = [];
  if (d.location) {
    head.push(`${d.location.file}(${d.location.line},${d.location.column}): `);
  }
  head.push(`${d.severity} ${codePrefix(d.code)}${d.code}: ${d.message}`);
  lines.push(head.join(""));

  const help = diagHelp[d.code as DiagCode];
  if (help !== undefined) {
    for (const helpLine of help.split("\n")) {
      lines.push(`  help: ${helpLine}`);
    }
  }

  return lines.join("\n");
}

export function renderAll(diags: readonly Diagnostic[]): string {
  return diags.map(render).join("\n");
}
