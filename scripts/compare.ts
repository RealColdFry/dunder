// Oracle diff: runs a TS file through `typescript-to-lua` and dunder, prints
// both outputs, flags match/mismatch.
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

const tsconfigPath = findTsconfig(targetFile);
const captured: Record<string, string> = {};
const oracleEmit = transpileProject(
  tsconfigPath,
  {
    noHeader: true,
    noEmit: false,
    noImplicitSelf: true,
  },
  (fileName, data) => {
    captured[fileName] = data;
  },
);
const oracleDiagnostics = oracleEmit.diagnostics.map((d) =>
  typeof d.messageText === "string" ? d.messageText : d.messageText.messageText,
);

const targetBase = basename(targetFile, ".ts");
const oracleKey = Object.keys(captured).find((k) => basename(k, ".lua") === targetBase);
const oracleLua = oracleKey ? captured[oracleKey]! : "";

const dunder = spawnSync("npm", ["run", "dunder", "--silent", "--", "--emit", targetFile], {
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

console.log(banner("oracle"));
if (oracleDiagnostics.length) console.log(oracleDiagnostics.map((d) => "  ! " + d).join("\n"));
process.stdout.write(oracleLua);

console.log(banner("dunder"));
if (dunderDiagnostics.length) console.log(dunderDiagnostics.map((d) => "  ! " + d).join("\n"));
process.stdout.write(dunderLua);

console.log(banner("diff"));
if (oracleLua === dunderLua) {
  console.log("MATCH");
} else {
  console.log("MISMATCH");
  const oracleLines = oracleLua.split("\n");
  const dunderLines = dunderLua.split("\n");
  const n = Math.max(oracleLines.length, dunderLines.length);
  for (let i = 0; i < n; i++) {
    const a = oracleLines[i] ?? "";
    const b = dunderLines[i] ?? "";
    if (a === b) continue;
    console.log(`  L${i + 1}:`);
    console.log(`    oracle: ${JSON.stringify(a)}`);
    console.log(`    dunder: ${JSON.stringify(b)}`);
  }
  process.exitCode = 1;
}
