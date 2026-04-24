// Jest setupFilesAfterEnv for the TSTL test hijack.
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

import { resolve } from "node:path";
import { dunderTranspile, type SourceInput } from "./transpile.ts";

if (process.env.DUNDER_TEST === "1") {
  // tstl's source lives at extern/tstl/src; that's what util.ts imports
  // as `import * as tstl from "../src"`. Resolve from that absolute path.
  const tstlSrc = resolve(__dirname, "../../extern/tstl/src");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tstl = require(tstlSrc);

  tstl.Transpiler.prototype.emit = function patchedEmit(
    this: any,
    args: { program: any; writeFile: any; customTransformers?: any },
  ) {
    const { program, writeFile } = args;

    // Extract user source files from the program. Skip lib.d.ts and other
    // declaration files.
    const sources: SourceInput[] = [];
    let mainFileName = "main.ts";
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue;
      sources.push({ fileName: sf.fileName, text: sf.getFullText() });
      // TSTL's testFunction defaults mainFileName to "main.ts"; first user
      // source is a reasonable fallback if none matches.
      if (sf.fileName.endsWith("main.ts")) {
        mainFileName = sf.fileName;
      }
    }

    const result = dunderTranspile(sources, mainFileName);

    if (result.error) {
      // Surface as a thrown error so jest reports the test as failing with
      // a useful message rather than a misleading "no Lua produced."
      throw new Error(result.error);
    }

    for (const file of result.files) {
      const sourceFilesArg = [{ fileName: file.sourceFileName }];
      writeFile(file.outPath, file.lua, false, undefined, sourceFilesArg);
      // TSTL's TranspiledFile shape expects both `lua` and `luaSourceMap`.
      // The collector writes the sourcemap into the TranspiledFile when it
      // sees a `.lua.map` write. Empty content is fine until we wire real
      // sourcemaps.
      writeFile(`${file.outPath}.map`, "", false, undefined, sourceFilesArg);
    }

    return { diagnostics: [], emitSkipped: false };
  };

  // Mark global so tests / debug logs know we're in dunder mode.
  (globalThis as any).__DUNDER_HIJACK_ACTIVE__ = true;

  // Surface the activation so the harness output is honest about what's
  // running.
  // eslint-disable-next-line no-console
  console.log("[dunder-harness] Transpiler hijack active");
}
