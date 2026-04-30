// Direct lowerer tests for the non-goto continue fallback. The
// snapshot-based cases tests run on LuaJIT (hasGoto), so the sentinel
// path needs its own coverage at the IR-to-Lua boundary.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { ir } from "#/ir/types.ts";
import { Lua51 } from "#/lua/capabilities.ts";
import { lowerModule } from "#/lua/lower/index.ts";
import { print } from "#/lua/printer.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(HERE, "__snapshots__", "lower-sentinel");

function loop(body: ReturnType<typeof ir.createModule>["body"]) {
  return ir.createModule([
    ir.createVarDecl({
      bindingKind: "let",
      name: "i",
      init: ir.createNumericLiteral(0),
    }),
    ir.createLoop({
      body,
      update: [
        ir.createAssign(
          ir.createIdentifier("i"),
          ir.createEsNumericAdd(ir.createIdentifier("i"), ir.createNumericLiteral(1)),
        ),
      ],
    }),
  ]);
}

describe("sentinel fallback (Lua 5.1)", () => {
  test("continue-only body emits repeat ... until true with break", async () => {
    const mod = loop([
      ir.createIf(
        ir.createComparison(">=", ir.createIdentifier("i"), ir.createNumericLiteral(10)),
        [ir.createBreak()],
      ),
      ir.createIf(
        ir.createEsEquality({
          strict: true,
          negated: false,
          left: ir.createIdentifier("i"),
          right: ir.createNumericLiteral(5),
        }),
        [ir.createContinue()],
      ),
    ]);
    const out = print(lowerModule(mod, Lua51));
    await expect(out).toMatchFileSnapshot(join(SNAP_DIR, "with-break.lua"));
  });

  test("continue without break elides the sentinel", async () => {
    const mod = loop([
      ir.createIf(
        ir.createEsEquality({
          strict: true,
          negated: false,
          left: ir.createIdentifier("i"),
          right: ir.createNumericLiteral(5),
        }),
        [ir.createContinue()],
      ),
    ]);
    const out = print(lowerModule(mod, Lua51));
    await expect(out).toMatchFileSnapshot(join(SNAP_DIR, "no-break.lua"));
    // Post-repeat outer break and sentinel decl only appear when the
    // body has a top-level Break.
    expect(out).not.toContain("____broke");
  });
});
