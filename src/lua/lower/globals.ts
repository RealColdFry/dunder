// Lowering of well-known global identifiers (`NaN`, `Infinity`,
// `globalThis`, `undefined`). Each maps to its closest Lua equivalent;
// some (notably `Infinity` on 5.0 where `math.huge` is absent) will
// gain capability-conditional emission later.

import type { EsGlobal } from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import type { LowerCtx } from "./context.ts";

export function lowerEsGlobal(expr: EsGlobal, _ctx: LowerCtx): lua.Expression {
  switch (expr.name) {
    case "NaN":
      // 0/0 is the canonical Lua NaN expression (TSTL's createNaN). math.huge
      // is finite-Inf, not NaN, so we use the division form unconditionally.
      return lua.createBinaryExpression(
        lua.createNumericLiteral(0),
        lua.createNumericLiteral(0),
        lua.SyntaxKind.DivisionOperator,
      );
    case "Infinity":
      // 5.0 has no `math.huge`; capability-conditional emission can branch
      // here later. For LuaJIT/5.1+/Luau the table-index form is fine.
      return lua.createTableIndexExpression(
        lua.createIdentifier("math"),
        lua.createStringLiteral("huge"),
      );
    case "globalThis":
      return lua.createIdentifier("_G");
    case "undefined":
      return lua.createNilLiteral();
    default:
      throw new Error(`unknown EsGlobal name: ${expr.name}`);
  }
}
