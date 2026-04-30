// JS execution for parity tests. Compiles a TS source via `ts.transpileModule`,
// loads it as a CJS module in this Node process, and calls its
// `__main` export. The JS-stringified return is the oracle that
// `lua-exec.ts` is compared against.
//
// We compile to CJS instead of ESM so the result can be `require`'d
// without a separate file extension dance, and so synchronous
// behavior dominates. Tests that need top-level async should use a
// different harness once we grow async support.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const requireCjs = createRequire(import.meta.url);

export interface JsExecResult {
  ok: true;
  value: unknown;
}

export interface JsExecError {
  ok: false;
  error: string;
}

export function execJs(source: string): JsExecResult | JsExecError {
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      // Keep generated code close to the input so runtime semantics
      // match the original TS rather than getting reshaped through
      // helpers we wouldn't see at the Lua side.
      downlevelIteration: false,
      importHelpers: false,
    },
  });

  const tmpDir = mkdtempSync(join(tmpdir(), "dunder-js-"));
  try {
    const file = join(tmpDir, "main.cjs");
    writeFileSync(file, out.outputText);
    // `__main` is the conventional oracle hook (mirrors TSTL's
    // FunctionTestBuilder); JSON-roundtripping aligns the result
    // with what the Lua side produces through its own JSON encoder.
    let mod: Record<string, unknown>;
    try {
      mod = requireCjs(file) as Record<string, unknown>;
    } catch (e) {
      return { ok: false, error: `js load error: ${(e as Error).message}` };
    }
    const main = mod.__main;
    if (typeof main !== "function") {
      return { ok: false, error: "source has no __main export" };
    }
    let result: unknown;
    try {
      result = (main as () => unknown)();
    } catch (e) {
      return { ok: false, error: `js runtime error: ${(e as Error).message}` };
    }
    // Normalize through JSON so undefined/NaN/Infinity coerce the same
    // way the Lua-side encoder does (all become null/dropped).
    const json = JSON.stringify(result);
    return { ok: true, value: json === undefined ? null : JSON.parse(json) };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
