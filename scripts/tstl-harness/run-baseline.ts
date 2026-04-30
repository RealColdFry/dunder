// Runs vitest against the curated baseline list. Each entry is a
// spec path (relative to extern/tstl); we pass them through as
// positional args so vitest's path filter picks them up.
//
// Exit code is vitest's: any failure here is a regression in dunder
// since the baseline by definition was passing when added.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(HERE, "baseline.txt");
const VITEST_CONFIG = resolve(HERE, "vitest.config.ts");

function readBaseline(): string[] {
  return readFileSync(BASELINE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

const specs = readBaseline();
if (specs.length === 0) {
  console.error("[tstl-baseline] baseline.txt is empty; nothing to run");
  process.exit(2);
}

console.log(`[tstl-baseline] running ${specs.length} spec(s):`);
for (const s of specs) console.log(`  - ${s}`);

// `dot` reporter: one char per test, summary at the end. Fits the
// regression-baseline use case where the only interesting info is
// "did anything turn red"; pass `--reporter=<other>` after the npm
// script name to override.
const child = spawn(
  "npx",
  ["vitest", "run", "--reporter=dot", "--config", VITEST_CONFIG, ...specs],
  {
    stdio: "inherit",
    env: { ...process.env, DUNDER_TEST: "1" },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
