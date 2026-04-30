// Array-pattern destructuring. Inline multi-assign for literal sources
// (works on every Lua version); otherwise an unpack call whose form
// depends on the target's `unpack` capability (global `unpack`, the
// `table.unpack` introduced in 5.2, or a lualib helper for Universal).

import type { Destructure } from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import type { LuaCapabilities } from "#/lua/capabilities.ts";
import { exportsFieldAccess, type LowerCtx, luaIdent } from "./context.ts";

export function lowerDestructure(stmt: Destructure, ctx: LowerCtx): lua.Statement[] {
  const lefts = stmt.pattern.elements.map((el) => luaIdent(el.name));
  const count = stmt.pattern.elements.length;

  // Literal source → inline multi-assign (works on every Lua version).
  if (stmt.init.kind === "ArrayLit") {
    const rights = stmt.init.elements.map((e) => ctx.lowerExpr(e));
    if (stmt.exported) {
      return [
        lua.createAssignmentStatement(
          stmt.pattern.elements.map((el) => exportsFieldAccess(el.name)),
          rights,
        ),
      ];
    }
    return [lua.createVariableDeclarationStatement(lefts, rights)];
  }

  const sourceExpr = ctx.lowerExpr(stmt.init);
  const unpackCall = unpackExpression(ctx.target, sourceExpr, count);

  if (stmt.exported) {
    return [
      lua.createAssignmentStatement(
        stmt.pattern.elements.map((el) => exportsFieldAccess(el.name)),
        [unpackCall],
      ),
    ];
  }
  return [lua.createVariableDeclarationStatement(lefts, [unpackCall])];
}

function unpackExpression(
  target: LuaCapabilities,
  arr: lua.Expression,
  count: number,
): lua.Expression {
  switch (target.unpack.kind) {
    case "global": {
      const args: lua.Expression[] = [arr];
      if (target.unpack.supportsBounds) {
        args.push(lua.createNumericLiteral(1), lua.createNumericLiteral(count));
      }
      return lua.createCallExpression(lua.createIdentifier("unpack"), args);
    }
    case "table":
      return lua.createCallExpression(
        lua.createTableIndexExpression(
          lua.createIdentifier("table"),
          lua.createStringLiteral("unpack"),
        ),
        [arr, lua.createNumericLiteral(1), lua.createNumericLiteral(count)],
      );
    case "lualib":
      return lua.createCallExpression(lua.createIdentifier("__TS__Unpack"), [arr]);
  }
}
