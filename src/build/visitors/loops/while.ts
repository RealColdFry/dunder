// AST → IR build for `while (cond) body` and `do body while (cond)`.
//
// Both lower to the generic `Loop` IR node, with the cond-driven Break
// placed where ES semantics require it relative to the continue label:
//
//   while:    body = [If(!truthy(cond), [Break]), <userBody>]
//   do-while: body = [<userBody>], update = [If(!truthy(cond), [Break])]
//
// The do-while cond-check goes in `update` (the slot that runs *after*
// the continue label) so a `continue` reaches the cond check before
// reiterating; otherwise `continue` would skip the cond entirely and
// produce an extra trailing iteration's worth of side effects. The
// while-loop cond check stays at the head of `body` because there's no
// continue-label ambiguity: `continue` falls through the bottom of the
// body, the loop reiterates, and the head is re-tested next pass.

import { type DoStatement, type Node, type WhileStatement } from "#/ts.ts";
import { ir, type Stmt } from "#/ir/types.ts";
import { flushPrecedingStmts } from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";
import { asTruthy, notExpr } from "#/build/normalize.ts";

export function buildWhile(node: WhileStatement, ctx: BuildCtx): Stmt[] {
  const body = condBreak(node.expression, ctx);
  body.push(...ctx.buildScopedBranch(node.statement));
  return [
    ir.createLoop({
      body,
    }),
  ];
}

export function buildDoWhile(node: DoStatement, ctx: BuildCtx): Stmt[] {
  const body = ctx.buildScopedBranch(node.statement);
  const update = condBreak(node.expression, ctx);
  return [
    ir.createLoop({
      body,
      update,
    }),
  ];
}

function condBreak(condNode: Node, ctx: BuildCtx): Stmt[] {
  const cond = asTruthy(ctx, condNode, ctx.buildExpr(condNode));
  const flushed = flushPrecedingStmts(ctx);
  return [...flushed, ir.createIf(notExpr(cond), [ir.createBreak()])];
}
