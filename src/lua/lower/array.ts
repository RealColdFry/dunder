// Array-shaped lowerings: literal construction, length, indexed read.
// `EsArrayLength` and `EsIndex` carry the documented divergences
// (DIV-ARR-LEN-001 implicit via capability dispatch; DIV-ARR-INDEX-001
// for 0-vs-1 base). `ElementAccess` is the type-checker-doesn't-know-
// it's-an-array fallback that emits a literal table index.

import type { ArrayLit, ElementAccess, EsArrayLength, EsIndex } from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import type { LuaCapabilities } from "#/lua/capabilities.ts";
import type { LowerCtx } from "./context.ts";

export function lowerArrayLit(expr: ArrayLit, ctx: LowerCtx): lua.Expression {
  const fields = expr.elements.map((el) => lua.createTableFieldExpression(ctx.lowerExpr(el)));
  return lua.createTableExpression(fields);
}

export function lowerEsArrayLength(expr: EsArrayLength, ctx: LowerCtx): lua.Expression {
  return arrayLengthExpr(ctx.target, ctx.lowerExpr(expr.array));
}

// DIV-ARR-INDEX-001: 0-based ES → 1-based Lua. Constant-folds numeric
// literals; otherwise emits the runtime `+ 1`.
export function lowerEsIndex(expr: EsIndex, ctx: LowerCtx): lua.Expression {
  const array = ctx.lowerExpr(expr.array);
  const index = ctx.lowerExpr(expr.index);
  return lua.createTableIndexExpression(array, adjustIndex(index));
}

export function lowerElementAccess(expr: ElementAccess, ctx: LowerCtx): lua.Expression {
  return lua.createTableIndexExpression(ctx.lowerExpr(expr.receiver), ctx.lowerExpr(expr.index));
}

function arrayLengthExpr(target: LuaCapabilities, arr: lua.Expression): lua.Expression {
  switch (target.arrayLength.kind) {
    case "native":
      return lua.createUnaryExpression(arr, lua.SyntaxKind.LengthOperator);
    case "tableGetn":
      return lua.createCallExpression(
        lua.createTableIndexExpression(
          lua.createIdentifier("table"),
          lua.createStringLiteral("getn"),
        ),
        [arr],
      );
    case "call":
      return lua.createCallExpression(lua.createIdentifier(target.arrayLength.fn), [arr]);
  }
}

function adjustIndex(index: lua.Expression): lua.Expression {
  if (lua.isNumericLiteral(index)) {
    return lua.createNumericLiteral(index.value + 1);
  }
  return lua.createBinaryExpression(
    index,
    lua.createNumericLiteral(1),
    lua.SyntaxKind.AdditionOperator,
  );
}
