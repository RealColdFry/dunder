import { type ReturnStatement } from "#/ts.ts";
import { ir, type Stmt } from "#/ir/types.ts";
import { flushPrecedingStmts } from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";

export function buildReturn(node: ReturnStatement, ctx: BuildCtx): Stmt[] {
  const value = node.expression ? ctx.buildExpr(node.expression) : undefined;
  const flushed = flushPrecedingStmts(ctx);
  return [...flushed, ir.createReturn(value)];
}
