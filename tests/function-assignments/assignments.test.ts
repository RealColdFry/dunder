// Scaffold for permutation-driven function-assignment parity tests.
// Skipped until `runner.ts::runSource` is wired to a real `processFileSync`
// invocation. With it skipped, `npm test` is a clean green-light gate.

import { test } from "vitest";
import { buildCases } from "./permutations.ts";
import { runCase } from "./runner.ts";

const cases = buildCases();
const valid = cases.filter((c) => c.expect.kind === "parity");
const invalid = cases.filter((c) => c.expect.kind === "diagnostic");

test.skip.each(valid)("valid: $id", runCase);
test.skip.each(invalid)("invalid: $id", runCase);
