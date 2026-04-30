import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import ts from "typescript";
import {
  fromTsc,
  fromTsgo,
  noImplicitAny,
  strict,
  strictNullChecks,
  useDefineForClassFields,
  type ResolvedCompilerOptions,
} from "../../src/options/resolved.ts";

const dirsToClean: string[] = [];
afterEach(() => {
  while (dirsToClean.length) {
    const d = dirsToClean.pop()!;
    rmSync(d, {
      recursive: true,
      force: true,
    });
  }
});

function tscParse(config: object): ts.CompilerOptions {
  const dir = mkdtempSync(path.join(tmpdir(), "dunder-options-"));
  dirsToClean.push(dir);
  const file = path.join(dir, "tsconfig.json");
  writeFileSync(file, JSON.stringify(config));
  const read = ts.readConfigFile(file, (p) => ts.sys.readFile(p));
  if (read.error) throw new Error(`tsconfig read failed`);
  return ts.parseJsonConfigFileContent(read.config, ts.sys, dir).options;
}

describe("options/resolved", () => {
  describe("fromTsc / fromTsgo equivalence", () => {
    it("produces structurally equal results for the same tsconfig", () => {
      const tsc = tscParse({
        compilerOptions: {
          target: "es2022",
          module: "esnext",
          strict: true,
        },
      });
      // Mimics tsgo's `project.compilerOptions` Record<string, unknown>;
      // values match what tsgo actually returns (verified by the
      // pre-flight spike).
      const tsgoBlob: Record<string, unknown> = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        strict: true,
      };
      const a = fromTsc(tsc);
      const b = fromTsgo(tsgoBlob);
      expect(useDefineForClassFields(a)).toBe(useDefineForClassFields(b));
      expect(strictNullChecks(a)).toBe(strictNullChecks(b));
      expect(noImplicitAny(a)).toBe(noImplicitAny(b));
    });
  });

  describe("strict bundle", () => {
    it("inherits from strict when sub-flag omitted", () => {
      const opts = fromTsc(tscParse({ compilerOptions: { strict: true } }));
      expect(strict(opts)).toBe(true);
      expect(strictNullChecks(opts)).toBe(true);
      expect(noImplicitAny(opts)).toBe(true);
    });

    it("explicit sub-flag overrides strict", () => {
      const opts = fromTsc(
        tscParse({
          compilerOptions: {
            strict: true,
            strictNullChecks: false,
          },
        }),
      );
      expect(strict(opts)).toBe(true);
      expect(strictNullChecks(opts)).toBe(false);
      expect(noImplicitAny(opts)).toBe(true);
    });

    it("defaults to false when neither strict nor sub-flag is set", () => {
      const opts = fromTsc(tscParse({ compilerOptions: {} }));
      expect(strict(opts)).toBe(false);
      expect(strictNullChecks(opts)).toBe(false);
      expect(noImplicitAny(opts)).toBe(false);
    });
  });

  describe("useDefineForClassFields", () => {
    it("defaults to true when target >= ES2022 and flag omitted", () => {
      const opts = fromTsc(tscParse({ compilerOptions: { target: "es2022" } }));
      expect(useDefineForClassFields(opts)).toBe(true);
    });

    it("defaults to false when target < ES2022 and flag omitted", () => {
      const opts = fromTsc(tscParse({ compilerOptions: { target: "es2020" } }));
      expect(useDefineForClassFields(opts)).toBe(false);
    });

    it("explicit false wins over the ES2022 target default", () => {
      const opts = fromTsc(
        tscParse({
          compilerOptions: {
            target: "es2022",
            useDefineForClassFields: false,
          },
        }),
      );
      expect(useDefineForClassFields(opts)).toBe(false);
    });
  });

  // Cheap insurance against TS enum drift. The
  // `useDefineForClassFields` helper compares the resolved target
  // against the literal value 9; if a TS upgrade ever shifts that, this
  // test fails before the helper silently miscomputes.
  it("ts.ScriptTarget.ES2022 sentinel value is stable", () => {
    expect(ts.ScriptTarget.ES2022).toBe(9);
  });
});

// Touch ResolvedCompilerOptions so the type re-export stays exercised.
const _typeOnly: ResolvedCompilerOptions | undefined = undefined;
void _typeOnly;
