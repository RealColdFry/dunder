import {
  ir,
  isBooleanLiteral,
  isComparison,
  isEsEquality,
  isEsTruthy,
  isLogicalNot,
  type Expr,
} from "#/ir/types.ts";
import { type Node } from "#/ts.ts";
import { type BuildCtx } from "#/build/context.ts";

function isKnownBoolean(e: Expr): boolean {
  return (
    isEsTruthy(e) || isLogicalNot(e) || isEsEquality(e) || isComparison(e) || isBooleanLiteral(e)
  );
}

// Wraps `expr` in `es.Truthy` unless we can prove the wrap is a no-op:
// either the IR shape already returns a Lua-truthy-equivalent boolean
// (`isKnownBoolean`), or the source TS type says JS truthiness agrees
// with Lua's for every value the type can hold (cached during resolve as
// `truthyAgreesWithLuaByNode`).
//
// `srcNode` is the TS expression whose truthiness is being tested. Pass
// `undefined` when there is no single source node to consult. e.g. an
// IR-synthesized temp; the type-based check is skipped in that case.
export function asTruthy(ctx: BuildCtx, srcNode: Node | undefined, expr: Expr): Expr {
  if (isKnownBoolean(expr)) return expr;
  if (srcNode && ctx.resolved.truthyAgreesWithLuaByNode.get(srcNode) === true) return expr;
  return ir.createEsTruthy(expr);
}

export function notExpr(operand: Expr): Expr {
  if (isEsEquality(operand)) {
    return {
      ...operand,
      negated: !operand.negated,
    };
  }
  return ir.createLogicalNot(operand);
}
