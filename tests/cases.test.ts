// Snapshot + parity tests over tests/cases/<group>/. Update snapshots
// with `npm test -- -u`.
//
// Each `.ts` file is always snapshot-checked (diagnostics, IR, Lua).
// When the source exports a `__main` function, the file is also
// behavior-checked: the TS is compiled and run in node to produce a
// JS oracle, the Lua is run on a Lua VM, and the two return values
// must match. No hand-coded expected values; the JS execution is the
// source of truth. Files without a `__main` export skip the parity
// check (snapshot-only).
//
// Group conventions:
//   - tests/cases/<group>/ runs under the backend whose registry name
//     matches `<group>`. Capability-preset names ("5.0".."5.5",
//     "universal") work directly via lookupBackend's preset fallback;
//     real backends like "tstl" override.
//   - tests/cases/general/ is special: snapshot uses the canonical
//     target (Lua 5.4), but parity ALSO fans out across every
//     standard Lua. Use it for fundamentals where the same source
//     should produce the same value on any standard Lua VM.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { defaultBackend } from "#/backend/default.ts";
import { lookupBackend } from "#/backend/registry.ts";
import type { Backend } from "#/backend/types.ts";
import { render } from "#/diagnostics/render.ts";
import {
  Lua50,
  Lua51,
  Lua52,
  Lua53,
  Lua54,
  Lua55,
  Universal,
  type LuaCapabilities,
} from "#/lua/capabilities.ts";
import { processFileSync } from "#/pipeline.tsc.ts";
import { execJs } from "./js-exec.ts";
import { canParity, execLua } from "./lua-exec.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_ROOT = resolvePath(HERE, "cases");

// Fan-out target list for the "general" group. Each name pairs with a
// `LuaCapabilities` preset so the test label and the runtime stay in
// lockstep. Listed in version order, with `universal` last since it's
// a synthesis of all of them rather than a real Lua.
const STANDARD_TARGETS: ReadonlyArray<{ name: string; target: LuaCapabilities }> = [
  { name: "5.0", target: Lua50 },
  { name: "5.1", target: Lua51 },
  { name: "5.2", target: Lua52 },
  { name: "5.3", target: Lua53 },
  { name: "5.4", target: Lua54 },
  { name: "5.5", target: Lua55 },
  { name: "universal", target: Universal },
];

// Snapshot canonical for the "general" group: the most-featureful
// modern Lua we run against. Lua emit shape on older targets differs
// (sentinel continue vs goto, `table.getn` vs `#arr`, etc.); we don't
// snapshot those, the parity assertion covers them.
const GENERAL_CANONICAL: Backend = lookupBackend("5.4")!;

interface Group {
  name: string;
  dir: string;
  tsconfig: string;
  files: string[];
}

function loadGroups(): Group[] {
  const groups: Group[] = [];
  for (const entry of readdirSync(CASES_ROOT)) {
    const dir = join(CASES_ROOT, entry);
    if (!statSync(dir).isDirectory()) continue;
    const tsconfig = join(dir, "tsconfig.json");
    if (!existsSync(tsconfig)) {
      throw new Error(`group "${entry}" missing tsconfig.json`);
    }
    const files = collectTsFiles(dir);
    groups.push({
      name: entry,
      dir,
      tsconfig,
      files,
    });
  }
  return groups;
}

// Cheap textual detection: a real export that defines `__main` as a
// function or value. Pulls in `function __main`, `const __main =`, etc.
// Avoids parsing for now; if false positives ever bite, switch to a
// real AST query.
function hasMainExport(source: string): boolean {
  return (
    /export\s+function\s+__main\b/.test(source) ||
    /export\s+(?:const|let|var)\s+__main\b/.test(source)
  );
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, {
    withFileTypes: true,
  })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(p));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

// Run dunder + JS, assert their `__main` returns match. Used by both
// the in-snapshot parity check (single-target groups) and the fan-out
// parity tests (general group). Caller supplies the source, the
// already-emitted dunder Lua, and the target the Lua was emitted for.
function assertParity(source: string, lua: string, target: LuaCapabilities): void {
  const js = execJs(source);
  if (!js.ok) throw new Error(`[js-exec] ${js.error}`);
  const luaResult = execLua(lua, target);
  if (!luaResult.ok) throw new Error(`[lua-exec] ${luaResult.error}`);
  expect(luaResult.value).toEqual(js.value);
}

for (const group of loadGroups()) {
  const isGeneral = group.name === "general";
  // The backend used for the snapshot-bearing test. For general it's
  // the canonical 5.4; for everything else it's whatever the group
  // resolves to, falling back to the default. Group name doubles as
  // backend selector via lookupBackend (capability-preset names work
  // directly thanks to its preset fallback).
  const groupBackend = lookupBackend(group.name);
  const snapshotBackend = isGeneral ? GENERAL_CANONICAL : (groupBackend ?? defaultBackend);

  describe(`cases/${group.name}`, () => {
    for (const file of group.files) {
      const rel = relative(CASES_ROOT, file);

      // Snapshot test: always runs. For non-general groups also runs
      // parity if the file qualifies. For general, parity is left to
      // the fan-out tests below to avoid double-counting the canonical.
      test(rel, async () => {
        const { diagnostics, ir, lua } = processFileSync({
          tsconfigPath: group.tsconfig,
          filePath: file,
          backend: snapshotBackend,
        });
        // Strip the absolute path so snapshots are stable across machines.
        const rendered = diagnostics.map((d) => render(d).replaceAll(file, rel));

        // Per-artifact snapshot files, colocated with the source case so
        // a cd into the group reveals each case's source + expected
        // outputs together. `.lua` and `.ir` get their real extensions
        // for editor highlighting; diagnostics serializes to JSON.
        const snapDir = join(dirname(file), "__snapshots__");
        const base = basename(file, ".ts");
        await expect(`${JSON.stringify(rendered, null, 2)}\n`).toMatchFileSnapshot(
          join(snapDir, `${base}.diagnostics.json`),
        );
        await expect(ir).toMatchFileSnapshot(join(snapDir, `${base}.ir`));
        await expect(lua).toMatchFileSnapshot(join(snapDir, `${base}.lua`));

        if (isGeneral) return;

        // Parity check for non-general groups. Three gates:
        //   1. Source declares a `__main` hook (the oracle entry point).
        //   2. No checker errors (a JS-side compile failure would fail
        //      the parity check for the wrong reason).
        //   3. The active target has a faithful Lua VM. LuaJIT and Luau
        //      currently skip; their parity awaits a real binary
        //      shell-out (luajit, lune) rather than an approximation.
        const source = readFileSync(file, "utf8");
        if (
          hasMainExport(source) &&
          !rendered.some((d) => d.includes("error TS")) &&
          canParity(snapshotBackend.target)
        ) {
          assertParity(source, lua, snapshotBackend.target);
        }
      });

      // Fan-out parity tests for the general group. One test per
      // standard target, each running the pipeline freshly with that
      // target so the lowering reflects the target's capabilities
      // (e.g. sentinel continue on 5.0/5.1, native `#` on 5.1+).
      // No snapshots here; the canonical snapshot is enough to detect
      // shape regressions, and target-specific shapes don't add signal
      // worth N× the snapshot bytes.
      if (isGeneral) {
        const source = readFileSync(file, "utf8");
        if (!hasMainExport(source)) continue;
        for (const t of STANDARD_TARGETS) {
          test(`${rel} [${t.name}]`, () => {
            const { diagnostics, lua } = processFileSync({
              tsconfigPath: group.tsconfig,
              filePath: file,
              backend: { ...GENERAL_CANONICAL, target: t.target },
            });
            const rendered = diagnostics.map((d) => render(d).replaceAll(file, rel));
            if (rendered.some((d) => d.includes("error TS"))) {
              throw new Error(`checker errors:\n${rendered.join("\n")}`);
            }
            assertParity(source, lua, t.target);
          });
        }
      }
    }
  });
}
