import { SyntaxKind, type BinaryExpression } from "#/ts.ts";
import { ir, type Expr } from "#/ir/types.ts";
import { type BuildCtx } from "#/build/context.ts";

export function buildPlus(node: BinaryExpression, ctx: BuildCtx): Expr {
  const stringy =
    (ctx.resolved.isStringyByNode.get(node.left) ?? false) ||
    (ctx.resolved.isStringyByNode.get(node.right) ?? false);
  const left = ctx.buildExpr(node.left);
  const right = ctx.buildExpr(node.right);
  return stringy ? ir.createEsStringConcat(left, right) : ir.createEsNumericAdd(left, right);
}

export function arithmeticOpFromToken(kind: SyntaxKind): "-" | "*" | "/" | "%" | "**" | undefined {
  switch (kind) {
    case SyntaxKind.MinusToken:
      return "-";
    case SyntaxKind.AsteriskToken:
      return "*";
    case SyntaxKind.SlashToken:
      return "/";
    case SyntaxKind.PercentToken:
      return "%";
    case SyntaxKind.AsteriskAsteriskToken:
      return "**";
    default:
      return undefined;
  }
}
