import {
  isBinaryExpression,
  isConditionalExpression,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  SyntaxKind,
  type Node,
} from "#/ts.ts";
import { ir, type Stmt } from "#/ir/types.ts";
import { flushPrecedingStmts } from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";
import { compoundAssignOpFromToken, compoundAssignValue } from "./binary/assign.ts";
import { buildConditionalAsStmt } from "./conditional.ts";
import { buildUpdateAsStmt } from "./unary.ts";

export function buildExprAsStmt(node: Node, ctx: BuildCtx): Stmt[] {
  if (isConditionalExpression(node)) return buildConditionalAsStmt(node, ctx);
  if (isPrefixUnaryExpression(node) || isPostfixUnaryExpression(node)) {
    if (
      node.operator === SyntaxKind.PlusPlusToken ||
      node.operator === SyntaxKind.MinusMinusToken
    ) {
      return buildUpdateAsStmt(node, ctx);
    }
  }
  if (isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.EqualsToken) {
    const target = ctx.buildExpr(node.left);
    const value = ctx.buildExpr(node.right);
    const flushed = flushPrecedingStmts(ctx);
    return [...flushed, ir.createAssign(target, value)];
  }
  if (isBinaryExpression(node)) {
    const compound = compoundAssignOpFromToken(node.operatorToken.kind);
    if (compound !== undefined) {
      const target = ctx.buildExpr(node.left);
      const rhs = ctx.buildExpr(node.right);
      const value = compoundAssignValue(compound, target, rhs, node, ctx);
      const flushed = flushPrecedingStmts(ctx);
      return [...flushed, ir.createAssign(target, value)];
    }
  }
  const expr = ctx.buildExpr(node);
  const flushed = flushPrecedingStmts(ctx);
  return [...flushed, ir.createExprStmt(expr)];
}
