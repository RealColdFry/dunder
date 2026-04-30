// AST → IR build for conditional control flow: `if`/`else` and the ternary
// `cond ? a : b` expression.
//
// The ternary is dispatched into one of three shapes:
//   - statement position (value discarded): bare `If` with branches as stmts.
//   - pure expression: `EsConditional` (backend picks idiom: IIFE, native
//     ternary, `cond and a or b`).
//   - effectful expression (a branch produces preceding stmts): lift to
//     `local %tmp; <condPre>; if cond then <truePre>; %tmp = a else <falsePre>;
//     %tmp = b end` as preceding, and return the temp ident as the value.
//
// The "could be falsy" check that TSTL/tslua use is intentionally absent. It
// belongs to the unsafe `cond and a or b` Lua idiom and is a backend-emit
// concern, not an IR-shape concern.

import { type ConditionalExpression, type IfStatement, type Node } from "#/ts.ts";
import { ir, type Expr, type Stmt } from "#/ir/types.ts";
import {
  addPrecedingStmt,
  hasPendingPreceding,
  popPrecedingScope,
  pushPrecedingScope,
  withPrecedingScope,
} from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";
import { asTruthy } from "#/build/normalize.ts";

export function buildIf(node: IfStatement, ctx: BuildCtx): Stmt[] {
  const { preceding, result: cond } = withPrecedingScope(ctx, () =>
    asTruthy(ctx, node.expression, ctx.buildExpr(node.expression)),
  );
  const consequent = ctx.buildScopedBranch(node.thenStatement);
  const alternate = node.elseStatement ? ctx.buildScopedBranch(node.elseStatement) : undefined;
  return [...preceding, ir.createIf(cond, consequent, alternate)];
}

export function buildConditional(node: ConditionalExpression, ctx: BuildCtx): Expr {
  const condW = withPrecedingScope(ctx, () =>
    asTruthy(ctx, node.condition, ctx.buildExpr(node.condition)),
  );
  const trueW = withPrecedingScope(ctx, () => ctx.buildExpr(node.whenTrue));
  const falseW = withPrecedingScope(ctx, () => ctx.buildExpr(node.whenFalse));

  if (trueW.preceding.length === 0 && falseW.preceding.length === 0) {
    for (const s of condW.preceding) addPrecedingStmt(ctx, s);
    return ir.createEsConditional(condW.result, trueW.result, falseW.result);
  }

  const tmp = ctx.freshName("ternary");
  addPrecedingStmt(
    ctx,
    ir.createVarDecl({
      bindingKind: "let",
      name: tmp,
    }),
  );
  for (const s of condW.preceding) addPrecedingStmt(ctx, s);
  addPrecedingStmt(
    ctx,
    ir.createIf(
      condW.result,
      [...trueW.preceding, ir.createAssign(ir.createIdentifier(tmp), trueW.result)],
      [...falseW.preceding, ir.createAssign(ir.createIdentifier(tmp), falseW.result)],
    ),
  );
  return ir.createIdentifier(tmp);
}

// Statement position: the ternary's value is discarded, so each branch is
// emitted as ordinary statements with no temp.
export function buildConditionalAsStmt(node: ConditionalExpression, ctx: BuildCtx): Stmt[] {
  const condW = withPrecedingScope(ctx, () =>
    asTruthy(ctx, node.condition, ctx.buildExpr(node.condition)),
  );
  const trueStmts = buildBranchAsStmts(node.whenTrue, ctx);
  const falseStmts = buildBranchAsStmts(node.whenFalse, ctx);
  return [...condW.preceding, ir.createIf(condW.result, trueStmts, falseStmts)];
}

function buildBranchAsStmts(branch: Node, ctx: BuildCtx): Stmt[] {
  pushPrecedingScope(ctx);
  const out = ctx.buildExprAsStmt(branch);
  if (hasPendingPreceding(ctx)) {
    throw new Error("conditional branch left dangling preceding statements");
  }
  popPrecedingScope(ctx);
  return out;
}
