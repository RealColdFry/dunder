// Bridge between TSTL's test infrastructure and dunder's transpile pipeline.
//
// Each test calls into dunder by writing its in-memory source files to a tmp
// dir + minimal tsconfig, spawning the `./dunder --emit` CLI, and returning
// the captured Lua. Slower than in-process call (spawn cost per test) but
// simple, synchronous, and self-contained; fits TSTL's sync test API.
//
// Optimization later: persistent dunder daemon, or in-process transpile via
// `@typescript/api`'s virtual fs hook.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DUNDER_BIN = resolve(__dirname, "../../dunder");

export interface DunderEmitResult {
  outPath: string;
  lua: string;
  sourceFileName: string;
}

export interface SourceInput {
  fileName: string;
  text: string;
}

export function dunderTranspile(
  sources: SourceInput[],
  mainFileName: string,
): { files: DunderEmitResult[]; error?: string } {
  const userSources = sources.filter((s) => !s.fileName.endsWith(".d.ts"));
  if (userSources.length === 0) {
    return { files: [] };
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "dunder-jest-"));
  try {
    // Write each source under tmpDir. Preserve directory structure relative
    // to a synthetic root so includes resolve.
    for (const sf of userSources) {
      const filePath = join(tmpDir, sf.fileName);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, sf.text);
    }

    writeFileSync(
      join(tmpDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "nodenext",
          moduleResolution: "nodenext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: userSources.map((s) => s.fileName),
      }),
    );

    const targetPath = join(tmpDir, mainFileName);
    const res = spawnSync(DUNDER_BIN, ["--emit", targetPath], {
      encoding: "utf8",
      timeout: 15_000,
    });

    if (res.error) {
      return { files: [], error: `dunder spawn error: ${res.error.message}` };
    }
    if (res.status !== 0) {
      return {
        files: [],
        error: `dunder exited ${res.status}: ${res.stderr.trim()}`,
      };
    }

    const outPath = mainFileName.replace(/\.tsx?$/, ".lua");
    return {
      files: [
        {
          outPath,
          lua: res.stdout,
          sourceFileName: mainFileName,
        },
      ],
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
