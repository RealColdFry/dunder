import { type CallExpression, type Node } from "#/ts.ts";
import { ir, type Expr } from "#/ir/types.ts";
import { addPrecedingStmt, anyHasSideEffect, astIsLiteral } from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";

export function buildCall(node: CallExpression, ctx: BuildCtx): Expr {
  const all = [node.expression, ...node.arguments];
  const lowered = buildOrderedExprs(all, ctx, "call_arg");
  return ir.createCall(lowered[0]!, lowered.slice(1));
}

// If any later sibling has an observable side effect, hoist this element to a
// synthetic temp so source-order evaluation is preserved. Pure literals are
// not hoisted (no value to race against).
export function buildOrderedExprs(
  astNodes: readonly Node[],
  ctx: BuildCtx,
  tempPrefix: string,
): Expr[] {
  const out: Expr[] = [];
  for (let i = 0; i < astNodes.length; i++) {
    const el = astNodes[i]!;
    const laterHasEffect = anyHasSideEffect(astNodes.slice(i + 1));
    const value = ctx.buildExpr(el);
    if (laterHasEffect && !astIsLiteral(el)) {
      const t = ctx.freshName(tempPrefix);
      addPrecedingStmt(
        ctx,
        ir.createVarDecl({
          bindingKind: "let",
          name: t,
          init: value,
        }),
      );
      out.push(ir.createIdentifier(t));
    } else {
      out.push(value);
    }
  }
  return out;
}
