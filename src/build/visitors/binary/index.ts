import { SyntaxKind, type BinaryExpression } from "#/ts.ts";
import { ir, type Expr } from "#/ir/types.ts";
import { type BuildCtx } from "#/build/context.ts";
import { arithmeticOpFromToken, buildPlus } from "./arithmetic.ts";
import { buildAssignment, buildCompoundAssignment, compoundAssignOpFromToken } from "./assign.ts";
import { buildEquality, comparisonOpFromToken } from "./comparison.ts";
import { buildShortCircuit } from "./short-circuit.ts";

export function buildBinaryExpression(node: BinaryExpression, ctx: BuildCtx): Expr {
  const opKind = node.operatorToken.kind;

  if (opKind === SyntaxKind.EqualsToken) return buildAssignment(node, ctx);

  const compound = compoundAssignOpFromToken(opKind);
  if (compound !== undefined) return buildCompoundAssignment(compound, node, ctx);

  if (opKind === SyntaxKind.PlusToken) return buildPlus(node, ctx);

  const arith = arithmeticOpFromToken(opKind);
  if (arith !== undefined) {
    return ir.createArithmetic(arith, ctx.buildExpr(node.left), ctx.buildExpr(node.right));
  }

  const cmp = comparisonOpFromToken(opKind);
  if (cmp !== undefined) {
    return ir.createComparison(cmp, ctx.buildExpr(node.left), ctx.buildExpr(node.right));
  }

  if (opKind === SyntaxKind.AmpersandAmpersandToken || opKind === SyntaxKind.BarBarToken) {
    return buildShortCircuit(node, ctx);
  }

  if (opKind === SyntaxKind.EqualsEqualsToken) return buildEquality(false, false, node, ctx);
  if (opKind === SyntaxKind.EqualsEqualsEqualsToken) return buildEquality(true, false, node, ctx);
  if (opKind === SyntaxKind.ExclamationEqualsToken) return buildEquality(false, true, node, ctx);
  if (opKind === SyntaxKind.ExclamationEqualsEqualsToken)
    return buildEquality(true, true, node, ctx);

  throw new Error(`unsupported binary operator: ${SyntaxKind[opKind]}`);
}
