// Conditional control flow. `If` is a statement; `EsConditional` is the
// `?:` expression form. The `lowerElse` helper turns an else-of-one-If
// into a Lua `elseif` instead of a nested block, keeping the emit
// shallow when chained `else if` is used.

import type { EsConditional, If, Stmt } from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import type { LowerCtx } from "./context.ts";

export function lowerIf(stmt: If, ctx: LowerCtx): lua.Statement[] {
  const cond = ctx.lowerExpr(stmt.cond);
  const thenBlock = lua.createBlock(stmt.consequent.flatMap((s) => ctx.lowerStmt(s)));
  const elseBlock = stmt.alternate !== undefined ? lowerElse(stmt.alternate, ctx) : undefined;
  return [lua.createIfStatement(cond, thenBlock, elseBlock)];
}

export function lowerEsConditional(expr: EsConditional, ctx: LowerCtx): lua.Expression {
  // IIFE: always correct. Skips the `cond and a or b` shortcut (broken
  // when `a` is falsy) and ignores hoisted-temp / native-ternary paths.
  const body = lua.createBlock([
    lua.createIfStatement(
      ctx.lowerExpr(expr.cond),
      lua.createBlock([lua.createReturnStatement([ctx.lowerExpr(expr.whenTrue)])]),
      lua.createBlock([lua.createReturnStatement([ctx.lowerExpr(expr.whenFalse)])]),
    ),
  ]);
  const fn = lua.createFunctionExpression(body, []);
  return lua.createCallExpression(fn, []);
}

// Else-of-one-If lowers to `elseif` by passing the nested IfStatement
// directly, which the Lua printer recognizes as the chained form.
export function lowerElse(stmts: Stmt[], ctx: LowerCtx): lua.Block | lua.IfStatement {
  if (stmts.length === 1 && stmts[0]!.kind === "If") {
    const lowered = ctx.lowerStmt(stmts[0]!);
    if (lowered.length === 1 && lua.isIfStatement(lowered[0]!)) {
      return lowered[0]!;
    }
    return lua.createBlock(lowered);
  }
  return lua.createBlock(stmts.flatMap((s) => ctx.lowerStmt(s)));
}
