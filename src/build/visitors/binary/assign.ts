import { SyntaxKind, type BinaryExpression } from "#/ts.ts";
import { ir, type Expr } from "#/ir/types.ts";
import { addPrecedingStmt } from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";

export type CompoundOp = "+" | "-" | "*" | "/" | "%" | "**";

export function buildAssignment(node: BinaryExpression, ctx: BuildCtx): Expr {
  const target = ctx.buildExpr(node.left);
  const value = ctx.buildExpr(node.right);
  addPrecedingStmt(ctx, ir.createAssign(target, value));
  return target;
}

export function buildCompoundAssignment(
  op: CompoundOp,
  node: BinaryExpression,
  ctx: BuildCtx,
): Expr {
  const target = ctx.buildExpr(node.left);
  const rhs = ctx.buildExpr(node.right);
  const value = compoundAssignValue(op, target, rhs, node, ctx);
  addPrecedingStmt(ctx, ir.createAssign(target, value));
  return target;
}

export function compoundAssignOpFromToken(kind: SyntaxKind): CompoundOp | undefined {
  switch (kind) {
    case SyntaxKind.PlusEqualsToken:
      return "+";
    case SyntaxKind.MinusEqualsToken:
      return "-";
    case SyntaxKind.AsteriskEqualsToken:
      return "*";
    case SyntaxKind.SlashEqualsToken:
      return "/";
    case SyntaxKind.PercentEqualsToken:
      return "%";
    case SyntaxKind.AsteriskAsteriskEqualsToken:
      return "**";
    default:
      return undefined;
  }
}

// `op` is the binary operator embedded in a compound assignment (e.g. "+" for "+=").
// `target` is the IR expr for the assignment LHS, reused on both sides so
// hoisted side effects in the LHS evaluate exactly once.
export function compoundAssignValue(
  op: CompoundOp,
  target: Expr,
  rhs: Expr,
  node: BinaryExpression,
  ctx: BuildCtx,
): Expr {
  if (op === "+") {
    const stringy =
      (ctx.resolved.isStringyByNode.get(node.left) ?? false) ||
      (ctx.resolved.isStringyByNode.get(node.right) ?? false);
    return stringy ? ir.createEsStringConcat(target, rhs) : ir.createEsNumericAdd(target, rhs);
  }
  return ir.createArithmetic(op, target, rhs);
}
