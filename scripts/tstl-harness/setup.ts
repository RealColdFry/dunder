// Vitest setupFiles entry for the TSTL test hijack.
//
// Monkey-patches TSTL's `Transpiler.prototype.emit` so it routes through
// dunder when `DUNDER_TEST=1`. Without that env var, TSTL's tests run
// unmodified; useful when we want to confirm a divergence is real, not a
// dunder regression.
//
// The patch lives at the narrowest possible boundary: the `emit` method
// returns a `{ diagnostics, transpiledFiles }` shape that `TestBuilder`
// already knows how to consume. Everything downstream (Lua execution in
// WASM, assertions, snapshots) is TSTL's existing infrastructure.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type ts from "typescript";
import { afterEach } from "vitest";
import { lineDiff } from "./line-diff.ts";
import { dunderTranspile, type SourceInput } from "./transpile.ts";
import { translateDiagnostics } from "./translate-diagnostics.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Per-test capture: stash the most recent emit so a vitest `afterEach`
// hook can record it for the on-failure dump. Most TSTL tests trigger one
// emit; if a test triggers several (multi-program builders), we capture
// the last.
interface EmitCapture {
  source: string;
  ir: string;
  lua: string;
  // TSTL's reference emit for the same input, when available. Empty when
  // TSTL itself failed to emit (we record the error instead). The diff
  // is precomputed at capture time so the failure dump can render it
  // directly without re-running TSTL.
  tstlLua: string;
  tstlError?: string;
  diff: string;
}
let lastEmit: EmitCapture | undefined;

// Most recent JS / Lua execution results, stashed by the prototype
// patches further down. `present` distinguishes "we don't have a value"
// from "the value happens to be undefined." Cleared per-test by the
// afterEach hook so a passing test doesn't leak into the next failure.
interface ExecResult {
  value: unknown;
  present: boolean;
}
let lastLuaResult: ExecResult = { value: undefined, present: false };
let lastJsResult: ExecResult = { value: undefined, present: false };

if (process.env.DUNDER_TEST === "1") {
  // Point at TSTL's source entry directly. Resolving by directory would hit
  // the package's `main: dist/index.js`, which we don't build.
  const tstlEntry = path.resolve(__dirname, "../../extern/tstl/src/index.ts");
  const tstl = await import(pathToFileURL(tstlEntry).href);

  // TSTL's diagnostic factories live alongside its transformation utils.
  // We reach in directly because they are not re-exported from the public
  // entry; the harness intentionally couples to internal layout here.
  const tstlDiagnosticsEntry = path.resolve(
    __dirname,
    "../../extern/tstl/src/transformation/utils/diagnostics.ts",
  );
  const tstlDiagnostics = await import(pathToFileURL(tstlDiagnosticsEntry).href);

  // Patch TestBuilder's execution-result accessors to stash the most
  // recent JS and Lua values so the failure dump can include them.
  // We wrap the (already-memoized-by-decorator) prototype methods so
  // memoization keeps working; we just observe what they return.
  const tstlTestUtilEntry = path.resolve(__dirname, "../../extern/tstl/test/util.ts");
  const tstlTestUtil = await import(pathToFileURL(tstlTestUtilEntry).href);
  const TestBuilder = tstlTestUtil.TestBuilder;
  const origGetLua = TestBuilder.prototype.getLuaExecutionResult;
  const origGetJs = TestBuilder.prototype.getJsExecutionResult;
  TestBuilder.prototype.getLuaExecutionResult = function (this: any) {
    const r = origGetLua.call(this);
    lastLuaResult = { value: r, present: true };
    return r;
  };
  TestBuilder.prototype.getJsExecutionResult = function (this: any) {
    const r = origGetJs.call(this);
    lastJsResult = { value: r, present: true };
    return r;
  };

  // Capture TSTL's original `emit` BEFORE we patch it. Inside the
  // patched body we run dunder for the real test, then call this
  // captured emit on a parallel writeFile collector to gather TSTL's
  // reference Lua. The dunder-vs-TSTL diff lands in the failure dump.
  const originalEmit = tstl.Transpiler.prototype.emit;

  tstl.Transpiler.prototype.emit = function patchedEmit(
    this: any,
    args: {
      program: any;
      writeFile: any;
      customTransformers?: any;
    },
  ) {
    const { program, writeFile } = args;

    const sources: SourceInput[] = [];
    let mainFileName = "main.ts";
    const fileBySource = new Map<string, ts.SourceFile>();
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue;
      sources.push({
        fileName: sf.fileName,
        text: sf.getFullText(),
      });
      // Map by basename too, since dunder writes sources to a tmpdir and
      // its diagnostic locations carry the tmp path; the program's source
      // files use the original (test-builder-supplied) filenames. We
      // record both keys so the translator can find the SourceFile by
      // either form.
      fileBySource.set(sf.fileName, sf);
      fileBySource.set(path.basename(sf.fileName), sf);
      if (sf.fileName.endsWith("main.ts")) {
        mainFileName = sf.fileName;
      }
    }
    const result = dunderTranspile(sources, mainFileName, program.getCompilerOptions());

    if (result.error) {
      throw new Error(result.error);
    }

    for (const file of result.files) {
      const sourceFilesArg = [
        {
          fileName: file.sourceFileName,
        },
      ];
      writeFile(file.outPath, file.lua, false, undefined, sourceFilesArg);
      writeFile(`${file.outPath}.map`, "", false, undefined, sourceFilesArg);
    }

    // Capture for the on-failure dump. Only the main file is interesting
    // for TSTL's test shape; multi-file projects can be revisited later.
    const mainSourceText = sources.find((s) => s.fileName === mainFileName)?.text ?? "";
    const mainResult = result.files.find((f) => f.sourceFileName === mainFileName);
    const dunderLua = mainResult?.lua ?? "";

    // Run TSTL's original transpiler on the same program to get the
    // reference emit, then compute the diff against dunder's. Wrapped
    // in try/catch because TSTL itself can throw on unsupported
    // constructs; in that case we record the error string and skip the
    // diff (the dump shows TSTL's failure mode).
    let tstlLua = "";
    let tstlError: string | undefined;
    try {
      const tstlFiles = new Map<string, string>();
      const tstlOutPath = mainFileName.replace(/\.tsx?$/, ".lua");
      originalEmit.call(this, {
        ...args,
        writeFile: (filePath: string, content: string) => {
          tstlFiles.set(path.basename(filePath), content);
        },
      });
      tstlLua = tstlFiles.get(path.basename(tstlOutPath)) ?? "";
    } catch (e) {
      tstlError = (e as Error).message;
    }

    lastEmit = {
      source: mainSourceText,
      ir: mainResult?.ir ?? "",
      lua: dunderLua,
      tstlLua,
      tstlError,
      diff: tstlError ? "" : lineDiff(tstlLua, dunderLua, { colorize: shouldColorize() }),
    };

    // Translate dunder diagnostics to TSTL-shaped diagnostics so
    // `TestBuilder.getLuaDiagnostics()` and `expectToHaveDiagnostics(code)`
    // see codes in TSTL's 100xxx-block. Diagnostics whose dunder code has
    // no TSTL counterpart drop here; that's intentional, since TSTL tests
    // assert TSTL codes only.
    const translated = translateDiagnostics(result.diagnostics, tstlDiagnostics, fileBySource);

    return {
      diagnostics: translated,
      emitSkipped: false,
    };
  };

  // Print the hijack-active banner once per process, not once per spec
  // file. Vitest's `isolate: false` config shares module state across
  // files in a worker but setupFiles still re-execute per file.
  if (!(globalThis as any).__DUNDER_HIJACK_ACTIVE__) {
    (globalThis as any).__DUNDER_HIJACK_ACTIVE__ = true;
    // eslint-disable-next-line no-console
    console.log("[dunder-harness] Transpiler hijack active");
  }

  // On-failure dump: append [source] / [ir] / [lua] to the failing
  // test's error message. Vitest's reporter renders the error inline
  // with the failure block, so the dump appears with the test that
  // triggered it instead of leaking eagerly to stderr above the summary.
  // Set DUNDER_DEBUG_ON_FAIL=0 to disable.
  if (process.env.DUNDER_DEBUG_ON_FAIL !== "0") {
    afterEach((ctx) => {
      // Reset for next test regardless of outcome; we only need values
      // when the current test fails. Done at the start because vitest
      // runs afterEach hooks in registration order.
      const luaR = lastLuaResult;
      const jsR = lastJsResult;
      lastLuaResult = { value: undefined, present: false };
      lastJsResult = { value: undefined, present: false };

      if (ctx.task.result?.state !== "fail") return;
      const cap = lastEmit;
      if (!cap) return;
      const errors = ctx.task.result.errors;
      if (!errors || errors.length === 0) return;

      const sections: string[] = [
        `[source]\n${cap.source.trimEnd()}`,
        `[ir]\n${cap.ir.trimEnd()}`,
        `[lua]\n${cap.lua.trimEnd()}`,
      ];
      if (cap.tstlError !== undefined) {
        sections.push(`[tstl emit failed]\n${cap.tstlError}`);
      } else if (cap.diff !== "") {
        // Identical emits skip this section entirely; the diff is what
        // tells you whether dunder is emitting the same shape as TSTL.
        sections.push(`[dunder vs tstl]\n${cap.diff.trimEnd()}`);
      }
      // Execution-result diff: print both values when both are present
      // and they aren't equal. For ExecutionErrors we render `.message`
      // so the dump stays readable; everything else goes through a
      // JSON-style formatter.
      if (luaR.present || jsR.present) {
        const pieces: string[] = [];
        if (jsR.present) pieces.push(`[js]\n${formatExecValue(jsR.value)}`);
        if (luaR.present) pieces.push(`[lua run]\n${formatExecValue(luaR.value)}`);
        sections.push(pieces.join("\n\n"));
      }
      const dump = `\n──── dunder emit ────\n` + sections.join("\n\n") + `\n─────────────────────`;
      // Append to the first error's message; that's what vitest's
      // reporter prints prominently. Other errors stay untouched.
      const e = errors[0];
      if (typeof e.message === "string") e.message = `${e.message}\n${dump}`;
    });
  }
}

// Vitest workers have piped stderr (isTTY is false) regardless of whether
// the parent is a terminal, so the usual `isTTY` gate over-disables when
// run from a real terminal. Default to colors-on under vitest unless the
// caller explicitly opts out via NO_COLOR or FORCE_COLOR=0. The dump
// landing in vitest's reporter is what consumes the codes; if vitest
// itself decides not to render colors (e.g. piped to a file), it strips
// or ignores them.
function shouldColorize(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return true;
}

function formatExecValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  // ExecutionError instances render as their message rather than the
  // full object; the constructor name check avoids importing the type.
  if (
    typeof v === "object" &&
    v !== null &&
    (v as { constructor?: { name?: string } }).constructor?.name === "ExecutionError"
  ) {
    return `<ExecutionError: ${(v as { message: string }).message}>`;
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
