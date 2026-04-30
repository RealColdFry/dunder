// AST → IR build for the short-circuit binary operators `&&` and `||`.
//
// When the right operand has no preceding stmts, emit `EsLogicalExpression`
// directly. When it does, lift to:
//
//   local %tmp = leftVal
//   if <cond on tmp> then
//     <rightPre>
//     %tmp = rightVal
//   end
//   -- expression value: %tmp
//
// where `cond` is `%tmp` for `&&` and `not %tmp` for `||`. This preserves
// short-circuit semantics: rhs's preceding stmts only run when the operator
// actually evaluates rhs.
//
// `??` (nullish coalescing) needs a separate IR node and is not handled here.

import { SyntaxKind, type BinaryExpression } from "#/ts.ts";
import { ir, type Expr } from "#/ir/types.ts";
import { addPrecedingStmt, withPrecedingScope } from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";
import { asTruthy, notExpr } from "#/build/normalize.ts";

export function buildShortCircuit(node: BinaryExpression, ctx: BuildCtx): Expr {
  const op = node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken ? "&&" : "||";

  const leftW = withPrecedingScope(ctx, () => ctx.buildExpr(node.left));
  const rightW = withPrecedingScope(ctx, () => ctx.buildExpr(node.right));

  if (rightW.preceding.length === 0) {
    for (const s of leftW.preceding) addPrecedingStmt(ctx, s);
    return ir.createEsLogicalExpression(op, leftW.result, rightW.result);
  }

  const tmp = ctx.freshName(op === "&&" ? "and" : "or");
  for (const s of leftW.preceding) addPrecedingStmt(ctx, s);
  addPrecedingStmt(
    ctx,
    ir.createVarDecl({
      bindingKind: "let",
      name: tmp,
      init: leftW.result,
    }),
  );
  const tmpId = ir.createIdentifier(tmp);
  // The temp holds `node.left`'s value; query truthy-agreement against the
  // source operand, not the synthetic ident.
  const condTruthy = asTruthy(ctx, node.left, tmpId);
  const cond = op === "&&" ? condTruthy : notExpr(condTruthy);
  addPrecedingStmt(
    ctx,
    ir.createIf(cond, [
      ...rightW.preceding,
      ir.createAssign(ir.createIdentifier(tmp), rightW.result),
    ]),
  );
  return ir.createIdentifier(tmp);
}
