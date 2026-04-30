import { SyntaxKind, type BinaryExpression } from "#/ts.ts";
import { ir, type Expr } from "#/ir/types.ts";
import { type BuildCtx } from "#/build/context.ts";

export function comparisonOpFromToken(kind: SyntaxKind): "<" | ">" | "<=" | ">=" | undefined {
  switch (kind) {
    case SyntaxKind.LessThanToken:
      return "<";
    case SyntaxKind.GreaterThanToken:
      return ">";
    case SyntaxKind.LessThanEqualsToken:
      return "<=";
    case SyntaxKind.GreaterThanEqualsToken:
      return ">=";
    default:
      return undefined;
  }
}

export function buildEquality(
  strict: boolean,
  negated: boolean,
  node: BinaryExpression,
  ctx: BuildCtx,
): Expr {
  return ir.createEsEquality({
    strict,
    negated,
    left: ctx.buildExpr(node.left),
    right: ctx.buildExpr(node.right),
  });
}
