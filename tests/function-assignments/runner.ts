import type { Case } from "./permutations.ts";

export interface RunResult {
  diagnostics: { code: string; line: number; character: number }[];
  ir: unknown;
  lua: string;
}

// TODO: wire to processFileSync once an in-memory entry exists. Today's
// processFileSync takes a tsconfigPath + filePath, so a real impl writes
// the source to a tmp file under a shared tsconfig and invokes it.
declare function runSource(source: string): RunResult;

// TODO: stand up a Lua VM for parity. Until then, `parity` cases assert
// "no diagnostics" only.
declare function runOnVm(lua: string): unknown;
declare function runOnNode(source: string): unknown;

export function runCase(c: Case): void {
  const result = runSource(c.source);

  if (c.expect.kind === "diagnostic") {
    const codes = result.diagnostics.map((d) => d.code);
    if (!codes.includes(c.expect.code)) {
      throw new Error(
        `[${c.id}] expected diagnostic ${c.expect.code}, got [${codes.join(", ")}]\n--- source ---\n${c.source}`,
      );
    }
    return;
  }

  if (result.diagnostics.length > 0) {
    throw new Error(
      `[${c.id}] expected clean compile, got diagnostics: ${JSON.stringify(result.diagnostics)}\n--- source ---\n${c.source}`,
    );
  }
  // const node = runOnNode(c.source);
  // const vm = runOnVm(result.lua);
  // expect(vm).toEqual(node);
}
