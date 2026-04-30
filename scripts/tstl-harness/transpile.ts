import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { tstlBackend } from "#/backends/tstl/index.ts";
import type { Diagnostic } from "#/diagnostics/types.ts";
import { presetByName } from "#/lua/capabilities.ts";
import { processFileSync } from "#/pipeline.tsc.ts";

const DUNDER_BIN = resolve(__dirname, "../../dunder");

export interface DunderEmitResult {
  outPath: string;
  lua: string;
  ir: string;
  sourceFileName: string;
}

export interface SourceInput {
  fileName: string;
  text: string;
}

type Mode = "inprocess" | "spawn";

function harnessMode(): Mode {
  return process.env.DUNDER_HARNESS_MODE === "spawn" ? "spawn" : "inprocess";
}

export function dunderTranspile(
  sources: SourceInput[],
  mainFileName: string,
  // Compiler options from the test's program. Without these, options
  // toggled via `setOptions` (strictNullChecks, noImplicitSelf, etc.) are
  // dropped before validators see them. We don't need every field; just
  // the ones a TSTL test could meaningfully toggle.
  compilerOptionsFromTest: Record<string, unknown> = {},
): {
  files: DunderEmitResult[];
  diagnostics: Diagnostic[];
  error?: string;
} {
  const userSources = sources.filter((s) => !s.fileName.endsWith(".d.ts"));
  if (userSources.length === 0) {
    return {
      files: [],
      diagnostics: [],
    };
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "dunder-jest-"));
  try {
    for (const sf of userSources) {
      const filePath = join(tmpDir, sf.fileName);
      mkdirSync(dirname(filePath), {
        recursive: true,
      });
      writeFileSync(filePath, sf.text);
    }

    const tsconfigPath = join(tmpDir, "tsconfig.json");
    // Test-supplied options override the defaults so per-spec toggles
    // (strict, strictNullChecks, noImplicitSelf, …) reach the validators.
    // Some tsc-internal-only fields (configFilePath, pathsBasePath) are
    // stripped because they refer to the original-program filesystem and
    // aren't valid as a serialized tsconfig.
    const sanitizedTestOptions = sanitizeCompilerOptions(compilerOptionsFromTest);
    const tsconfigJson = JSON.stringify({
      compilerOptions: {
        target: "esnext",
        module: "nodenext",
        moduleResolution: "nodenext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        ...sanitizedTestOptions,
      },
      include: userSources.map((s) => s.fileName),
    });
    writeFileSync(tsconfigPath, tsconfigJson);
    if (process.env.DUNDER_DEBUG_TSCONFIG === "1") {
      // eslint-disable-next-line no-console
      console.error(`[dunder-harness] tsconfig: ${tsconfigJson}`);
    }

    const targetPath = join(tmpDir, mainFileName);
    const outPath = mainFileName.replace(/\.tsx?$/, ".lua");

    if (harnessMode() === "spawn") {
      const res = spawnSync(DUNDER_BIN, ["--emit", targetPath], {
        encoding: "utf8",
        timeout: 15_000,
      });
      if (res.error) {
        return {
          files: [],
          diagnostics: [],
          error: `dunder spawn error: ${res.error.message}`,
        };
      }
      if (res.status !== 0) {
        return {
          files: [],
          diagnostics: [],
          error: `dunder exited ${res.status}: ${res.stderr.trim()}`,
        };
      }
      // Spawn mode loses structured diagnostics + IR today; the CLI
      // prints rendered text to stderr. Inprocess mode is the path that
      // surfaces dunder diagnostics into TSTL's test assertions.
      return {
        files: [
          {
            outPath,
            lua: res.stdout,
            ir: "",
            sourceFileName: mainFileName,
          },
        ],
        diagnostics: [],
      };
    }

    try {
      // TSTL test cases assert TSTL's diagnostics, so route through the
      // tstl backend so the validator slot fires (truthy-only-condition,
      // this-conversion, ...). Per-test `luaTarget` overrides the
      // backend's default LuaJIT capability so the emit reflects the
      // version the test specified; the corresponding Lua VM in the
      // TestBuilder is keyed off the same option.
      const luaTarget = compilerOptionsFromTest["luaTarget"];
      const target =
        typeof luaTarget === "string"
          ? (presetByName(luaTarget) ?? tstlBackend.target)
          : tstlBackend.target;
      const result = processFileSync({
        tsconfigPath,
        filePath: targetPath,
        backend: {
          ...tstlBackend,
          target,
        },
      });
      return {
        files: [
          {
            outPath,
            lua: result.lua,
            ir: result.ir,
            sourceFileName: mainFileName,
          },
        ],
        diagnostics: result.diagnostics,
      };
    } catch (err) {
      return {
        files: [],
        diagnostics: [],
        error: (err as Error).message,
      };
    }
  } finally {
    rmSync(tmpDir, {
      recursive: true,
      force: true,
    });
  }
}

// Strip fields that refer to the original program's filesystem (paths
// based on the test's cwd, internal lookup tables) plus enum-form values
// that don't round-trip through JSON tsconfig serialization.
const STRIPPED_OPTION_KEYS = new Set([
  "configFilePath",
  "pathsBasePath",
  "outDir",
  "outFile",
  "rootDir",
  "rootDirs",
  "baseUrl",
  "paths",
  "project",
]);

function sanitizeCompilerOptions(opts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (STRIPPED_OPTION_KEYS.has(k)) continue;
    // tsc resolves enum string options to numbers in-program; tsconfig
    // expects strings. Skip numeric forms; the test-relevant booleans
    // round-trip cleanly.
    if (typeof v === "number" && (k === "target" || k === "module" || k === "moduleResolution"))
      continue;
    if (k === "lib" && Array.isArray(v)) {
      // TSTL writes lib entries as `lib.X.d.ts` filenames; tsc's libMap
      // is keyed by the short names (`esnext`, `es2015`, `dom`, …) and
      // silently drops anything it doesn't match, leaving the program
      // without an `Array` global etc. Normalize to the short form.
      out[k] = v.map((entry) =>
        typeof entry === "string" ? entry.replace(/^lib\./, "").replace(/\.d\.ts$/, "") : entry,
      );
      continue;
    }
    out[k] = v;
  }
  return out;
}
