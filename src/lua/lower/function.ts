// Function literal lowering. The IR's unified `Function` node carries a
// `shape` field ("arrow" | "expr" | "decl") that drives `this`-binding
// in plugin backends. The default backend lowers all three shapes
// uniformly to a Lua function expression; per-shape divergence is a
// per-target concern, not a default-lowering concern.

// `Function` shadows the global `Function` type when imported plain;
// alias to `IRFunction` so the parameter type is unambiguous.
import type { Function as IRFunction } from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import { type LowerCtx, luaIdent } from "./context.ts";

export function lowerFunction(expr: IRFunction, ctx: LowerCtx): lua.Expression {
  const params = expr.params.map((p) => luaIdent(p.name));
  const body = lua.createBlock(expr.body.flatMap((s) => ctx.lowerStmt(s)));
  return lua.createFunctionExpression(body, params);
}
