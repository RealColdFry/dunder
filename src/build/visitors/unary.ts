import { SyntaxKind, type PostfixUnaryExpression, type PrefixUnaryExpression } from "#/ts.ts";
import { ir, type Expr, type Stmt } from "#/ir/types.ts";
import { addPrecedingStmt, flushPrecedingStmts, updateAssign } from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";
import { asTruthy, notExpr } from "#/build/normalize.ts";

export function buildPrefixUnary(node: PrefixUnaryExpression, ctx: BuildCtx): Expr {
  if (node.operator === SyntaxKind.MinusToken) {
    return ir.createUnaryExpression("-", ctx.buildExpr(node.operand));
  }
  if (node.operator === SyntaxKind.ExclamationToken) {
    return notExpr(asTruthy(ctx, node.operand, ctx.buildExpr(node.operand)));
  }
  if (node.operator === SyntaxKind.PlusPlusToken || node.operator === SyntaxKind.MinusMinusToken) {
    const target = ctx.buildExpr(node.operand);
    const op = node.operator === SyntaxKind.PlusPlusToken ? "++" : "--";
    addPrecedingStmt(ctx, updateAssign(target, op));
    return target;
  }
  throw new Error(`unsupported prefix unary operator: ${SyntaxKind[node.operator]}`);
}

export function buildPostfixUnary(node: PostfixUnaryExpression, ctx: BuildCtx): Expr {
  if (node.operator === SyntaxKind.PlusPlusToken || node.operator === SyntaxKind.MinusMinusToken) {
    // Postfix: capture pre-update value into a temp, then hoist the assign.
    const target = ctx.buildExpr(node.operand);
    const op = node.operator === SyntaxKind.PlusPlusToken ? "++" : "--";
    const tmp = ctx.freshName("postfix");
    addPrecedingStmt(ctx, [
      ir.createVarDecl({
        bindingKind: "let",
        name: tmp,
        init: target,
      }),
      updateAssign(target, op),
    ]);
    return ir.createIdentifier(tmp);
  }
  throw new Error(`unsupported postfix unary operator: ${SyntaxKind[node.operator]}`);
}

// `i++;` / `++i;` as statements: value is discarded, so no temp.
export function buildUpdateAsStmt(
  node: PrefixUnaryExpression | PostfixUnaryExpression,
  ctx: BuildCtx,
): Stmt[] {
  const target = ctx.buildExpr(node.operand);
  const flushed = flushPrecedingStmts(ctx);
  const op = node.operator === SyntaxKind.PlusPlusToken ? "++" : "--";
  return [...flushed, updateAssign(target, op)];
}
