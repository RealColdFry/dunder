// IR-layer eval tests with JS as the oracle. Each .ts case in this
// directory is built to IR and run through the IR interpreter; the same
// file is also imported as JS and its `__main()` invoked. The two return
// values must deepEqual.
//
// No backend, no Lua, no eval driver, no hand-coded expectations: the
// language itself is the spec, the interpreter is dunder's claim about
// the IR, and equality between the two is the conformance bar.

import { readdirSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { callClosureForTest, interpret } from "#/ir/interpret.ts";
import { processFileSync } from "#/pipeline.tsc.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "cases");
const TSCONFIG = join(CASES_DIR, "tsconfig.json");

const cases = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith(".ts"))
  .sort();

describe("ir/eval", () => {
  for (const file of cases) {
    test(file, async () => {
      const filePath = resolvePath(CASES_DIR, file);

      // JS oracle: import the file and call __main().
      const jsMod = (await import(pathToFileURL(filePath).href)) as {
        __main?: () => unknown;
      };
      if (typeof jsMod.__main !== "function") {
        throw new Error(`${file}: missing exported __main()`);
      }
      const jsResult = jsMod.__main();

      // dunder pipeline → interpreter.
      const { diagnostics, module } = processFileSync({
        tsconfigPath: TSCONFIG,
        filePath,
      });
      const errors = diagnostics.filter((d) => d.severity === "error");
      expect(errors).toEqual([]);

      const interp = interpret(module);
      const main = interp.exports["__main"];
      expect(main, "__main not exported").toBeDefined();
      const irResult = callClosureForTest(main, []);

      expect(irResult).toEqual(jsResult);
    });
  }
});
