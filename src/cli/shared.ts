// Shared CLI scaffolding for the two driver entry points (`main.ts` for
// tsgo, `main.tsc.ts` for tsc). These can't live in one program because
// importing both checkers' AST modules in a single tsconfig causes
// SyntaxKind drift; this file is the slice that's pipeline-agnostic.
//
// What lives here: argv parsing surface, file/tsconfig resolution,
// backend selection, section-flag math, and the IR/Lua output blocks.
// What stays in each main.ts: AST dumping (pipeline-specific Node/AST
// types) and the actual call into the pipeline.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { resolveBackend } from "../backend/registry.ts";
import type { Backend } from "../backend/types.ts";

// ── Args ───────────────────────────────────────────────────────────────────

// Citty arg definitions shared by both entries. Each main.ts spreads
// these into its own `defineCommand({ args: { ...commonArgs, ... } })`.
export const commonArgs = {
  file: {
    type: "positional",
    description: "TypeScript source file (or '-' for stdin)",
    required: false,
  },
  eval: {
    type: "string",
    alias: "e",
    description: "TypeScript source to transpile inline",
  },
  ast: {
    type: "boolean",
    description: "print the TS AST",
    default: false,
  },
  ir: {
    type: "boolean",
    description: "print the dunder IR",
    default: false,
  },
  emit: {
    type: "boolean",
    description: "emit Lua",
    default: true,
  },
  target: {
    type: "string",
    description: "Lua target preset: 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, JIT, Luau, universal",
    default: "JIT",
  },
} as const;

// ── Setup ──────────────────────────────────────────────────────────────────

export function findTsconfig(fromFile: string): string {
  let dir = dirname(resolvePath(fromFile));
  while (true) {
    const candidate = resolvePath(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no tsconfig.json found above ${fromFile}`);
    dir = parent;
  }
}

// Resolve the file argument against INIT_CWD (npm-run-scripts override
// process.cwd to the package dir). Exits with code 2 on a missing file
// after writing a message to stderr.
export function resolveTargetFile(file: string): string {
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const targetFile = resolvePath(baseDir, file);
  if (!existsSync(targetFile)) {
    console.error(`file not found: ${targetFile}`);
    process.exit(2);
  }
  return targetFile;
}

// Pick a source for the pipeline based on argv shape. Precedence:
//   1. `--eval <ts>` (or `-e <ts>`)        → tmpdir + synth tsconfig
//   2. `file === "-"` or stdin is piped    → read stdin → tmpdir
//   3. `file` is a path                    → existing real-file flow
// On (1) and (2) the returned `cleanup()` removes the tmpdir; callers
// must invoke it (preferably in a `finally`) so we don't leak tmp.
export interface ResolvedSource {
  tsconfigPath: string;
  filePath: string;
  cleanup(): void;
}

export function resolveSource(args: { file?: string; eval?: string }): ResolvedSource {
  if (args.eval !== undefined) return writeEvalSource(args.eval);

  // `-` is the conventional stdin sentinel; also fall back to stdin when
  // no `file` was given and the input is being piped (interactive TTY
  // would block forever, so we don't auto-read in that case).
  const stdinPiped = (args.file === undefined && !process.stdin.isTTY) || args.file === "-";
  if (stdinPiped) return writeEvalSource(readStdin());

  if (args.file === undefined) {
    console.error("no source: pass a file, '-e <ts>', or pipe via stdin");
    process.exit(2);
  }

  const targetFile = resolveTargetFile(args.file);
  return {
    tsconfigPath: findTsconfig(targetFile),
    filePath: targetFile,
    cleanup: () => {},
  };
}

function readStdin(): string {
  // Synchronous stdin read via fd 0. Pre-piped input is fully buffered,
  // so the read returns immediately; no async event loop needed.
  return readFileSync(0, "utf8");
}

// Synth a minimal project around an inline source. Mirrors the harness's
// approach in `scripts/tstl-harness/transpile.ts` but kept inline here
// rather than shared, since the harness has additional needs (option
// merging from the test program) the CLI doesn't.
function writeEvalSource(source: string): ResolvedSource {
  const tmpDir = mkdtempSync(join(tmpdir(), "dunder-eval-"));
  const filePath = join(tmpDir, "main.ts");
  writeFileSync(filePath, source);

  const tsconfigPath = join(tmpDir, "tsconfig.json");
  writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: "esnext",
        module: "nodenext",
        moduleResolution: "nodenext",
        lib: ["esnext"],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      files: ["main.ts"],
    }),
  );

  return {
    tsconfigPath,
    filePath,
    cleanup: () =>
      rmSync(tmpDir, {
        recursive: true,
        force: true,
      }),
  };
}

// Resolve a backend by name (or capability-preset shim) and exit cleanly
// on unknown values rather than throwing.
export function resolveBackendOrExit(name: string | undefined): Backend {
  try {
    return resolveBackend(name);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}

// ── Output ─────────────────────────────────────────────────────────────────

export interface SectionFlags {
  ast: boolean;
  ir: boolean;
  emit: boolean;
}

// `showHeaders` switches on `[ast]` / `[ir]` / `[lua]` markers when more
// than one section is enabled. With a single section, output stays clean
// for piping into other tools.
export function sectionDisplay(flags: SectionFlags): { showHeaders: boolean } {
  const count = (flags.ast ? 1 : 0) + (flags.ir ? 1 : 0) + (flags.emit ? 1 : 0);
  return { showHeaders: count > 1 };
}

export function printIrSection(ir: string, showHeaders: boolean): void {
  if (showHeaders) console.log("[ir]");
  console.log(ir);
}

export function printLuaSection(lua: string, showHeaders: boolean): void {
  if (showHeaders) console.log("[lua]");
  process.stdout.write(lua);
}
