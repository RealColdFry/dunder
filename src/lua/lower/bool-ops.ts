// Boolean-flavored unaries and binaries: truthy marker, equality,
// short-circuit, logical/numeric not. Most carry the DIV-TRUTH-001
// caveat that Lua's truthiness only excludes `false` and `nil`.

import type {
  EsEquality,
  EsLogicalExpression,
  EsTruthy,
  LogicalNot,
  UnaryExpression,
} from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import type { LowerCtx } from "./context.ts";

export function lowerEsTruthy(expr: EsTruthy, ctx: LowerCtx): lua.Expression {
  // DIV-TRUTH-001: passthrough; default backend accepts the divergence.
  return ctx.lowerExpr(expr.expr);
}

export function lowerEsEquality(expr: EsEquality, ctx: LowerCtx): lua.Expression {
  // DIV-EQ-001: both ==/=== → Lua `==` (strict ignored).
  const op = expr.negated ? lua.SyntaxKind.InequalityOperator : lua.SyntaxKind.EqualityOperator;
  return lua.createBinaryExpression(ctx.lowerExpr(expr.left), ctx.lowerExpr(expr.right), op);
}

export function lowerEsLogicalExpression(
  expr: EsLogicalExpression,
  ctx: LowerCtx,
): lua.Expression {
  // DIV-TRUTH-001: short-circuit matches; truthiness rules differ.
  const op = expr.op === "&&" ? lua.SyntaxKind.AndOperator : lua.SyntaxKind.OrOperator;
  return lua.createBinaryExpression(ctx.lowerExpr(expr.left), ctx.lowerExpr(expr.right), op);
}

export function lowerLogicalNot(expr: LogicalNot, ctx: LowerCtx): lua.Expression {
  // DIV-TRUTH-001: Lua truthiness, not ES.
  return lua.createUnaryExpression(ctx.lowerExpr(expr.operand), lua.SyntaxKind.NotOperator);
}

export function lowerUnaryExpression(expr: UnaryExpression, ctx: LowerCtx): lua.Expression {
  return lua.createUnaryExpression(ctx.lowerExpr(expr.operand), lua.SyntaxKind.NegationOperator);
}
