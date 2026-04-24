// Oracle diff harness. Runs a TS file through both TSTL (reference) and
// dunder, prints both outputs, flags match/mismatch.
//
// Usage: npm run compare -- <file.ts>

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transpileProject } from "typescript-to-lua";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseDir = process.env.INIT_CWD ?? process.cwd();

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("usage: compare <file.ts>");
  process.exit(2);
}

const targetFile = resolve(baseDir, fileArg);
if (!existsSync(targetFile)) {
  console.error(`file not found: ${targetFile}`);
  process.exit(2);
}

function findTsconfig(fromFile: string): string {
  let dir = dirname(resolve(fromFile));
  while (true) {
    const candidate = resolve(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no tsconfig.json found above ${fromFile}`);
    dir = parent;
  }
}

// TSTL side: transpileProject with the same tsconfig dunder uses.
const tsconfigPath = findTsconfig(targetFile);
const captured: Record<string, string> = {};
const tstlEmit = transpileProject(
  tsconfigPath,
  { noHeader: true, noEmit: false, noImplicitSelf: true },
  (fileName, data) => {
    captured[fileName] = data;
  },
);
const tstlDiagnostics = tstlEmit.diagnostics.map((d) =>
  typeof d.messageText === "string" ? d.messageText : d.messageText.messageText,
);

// TSTL emits e.g. src/decl.ts → <outDir>/decl.lua. Find the one matching our target.
const targetBase = basename(targetFile, ".ts");
const tstlKey = Object.keys(captured).find((k) => basename(k, ".lua") === targetBase);
const tstlLua = tstlKey ? captured[tstlKey]! : "";

const dunder = spawnSync("npm", ["run", "driver", "--silent", "--", "--emit", targetFile], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (dunder.status !== 0) {
  console.error("dunder failed:", dunder.stderr);
  process.exit(dunder.status ?? 1);
}
const dunderLua = dunder.stdout;
const dunderDiagnostics = dunder.stderr.split("\n").filter((l) => l.length > 0);

const banner = (s: string) => `=== ${s} `.padEnd(60, "=");

console.log(banner("tstl"));
if (tstlDiagnostics.length) console.log(tstlDiagnostics.map((d) => "  ! " + d).join("\n"));
process.stdout.write(tstlLua);

console.log(banner("dunder"));
if (dunderDiagnostics.length) console.log(dunderDiagnostics.map((d) => "  ! " + d).join("\n"));
process.stdout.write(dunderLua);

console.log(banner("diff"));
if (tstlLua === dunderLua) {
  console.log("MATCH");
} else {
  console.log("MISMATCH");
  const tstlLines = tstlLua.split("\n");
  const dunderLines = dunderLua.split("\n");
  const n = Math.max(tstlLines.length, dunderLines.length);
  for (let i = 0; i < n; i++) {
    const a = tstlLines[i] ?? "";
    const b = dunderLines[i] ?? "";
    if (a === b) continue;
    console.log(`  L${i + 1}:`);
    console.log(`    tstl:   ${JSON.stringify(a)}`);
    console.log(`    dunder: ${JSON.stringify(b)}`);
  }
  process.exitCode = 1;
}
