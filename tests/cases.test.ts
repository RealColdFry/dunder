// Snapshot tests over tests/cases/<group>/. Update with `npm test -- -u`.

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { API } from "@typescript/native-preview/async";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { processFile } from "../src/pipeline.ts";
import { resolveTsgoBin } from "../src/tsgo-bin.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_ROOT = resolvePath(HERE, "cases");

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
    groups.push({ name: entry, dir, tsconfig, files });
  }
  return groups;
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(p));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

for (const group of loadGroups()) {
  describe(`cases/${group.name}`, () => {
    let api: API;

    beforeAll(async () => {
      api = new API({ tsserverPath: resolveTsgoBin(), cwd: group.dir });
    });

    afterAll(async () => {
      await api.close();
    });

    for (const file of group.files) {
      const rel = relative(CASES_ROOT, file);
      test(rel, async () => {
        const { diagnostics, ir, lua } = await processFile({
          api,
          projectPath: group.tsconfig,
          filePath: file,
        });
        expect(diagnostics).toMatchSnapshot("diagnostics");
        expect(ir).toMatchSnapshot("ir");
        expect(lua).toMatchSnapshot("lua");
      });
    }
  });
}
