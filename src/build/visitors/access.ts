import { type ElementAccessExpression, type PropertyAccessExpression } from "#/ts.ts";
import { ir, type Expr } from "#/ir/types.ts";
import { type BuildCtx } from "#/build/context.ts";

export function buildPropertyAccess(node: PropertyAccessExpression, ctx: BuildCtx): Expr {
  const receiver = ctx.buildExpr(node.expression);
  const name = node.name.text;
  if (name === "length" && (ctx.resolved.isArrayLikeByNode.get(node.expression) ?? false)) {
    return ir.createEsArrayLength(receiver);
  }
  return ir.createPropertyAccess(receiver, name);
}

export function buildElementAccess(node: ElementAccessExpression, ctx: BuildCtx): Expr {
  const receiver = ctx.buildExpr(node.expression);
  const index = ctx.buildExpr(node.argumentExpression);
  if (ctx.resolved.isArrayLikeByNode.get(node.expression) ?? false) {
    return ir.createEsIndex(receiver, index);
  }
  return ir.createElementAccess(receiver, index);
}
