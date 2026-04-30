// IR build pass: ResolvedAst → ANF-shaped IR. Pure synchronous transformation;
// no checker calls, no IPC. Reads cached type info from the resolve pass.
// Side-effecting expressions are hoisted into explicit IR statements with
// synthetic temporaries (`%`-prefixed names) so backends only see a flat IR.

import { type Node } from "#/ts.ts";
import { type ResolvedAst } from "#/frontend/index.ts";
import { ir, type Expr, type Module, type Stmt } from "#/ir/types.ts";
import { hasPendingPreceding, popPrecedingScope } from "./anf.ts";
import { type BuildCtx } from "./context.ts";
import { buildExpr, buildScopedBranch, buildStmt } from "./visitors/index.ts";
import { buildExprAsStmt } from "./visitors/expression-statement.ts";

export function buildModule(resolved: ResolvedAst): Module {
  let counter = 0;
  const ctx = {
    resolved,
    precedingStmtsStack: [[]] as Stmt[][],
    freshName: (p: string) => `%${p}_${counter++}`,
  } as BuildCtx;
  ctx.buildExpr = (node: Node): Expr => buildExpr(node, ctx);
  ctx.buildStmt = (node: Node): Stmt[] => buildStmt(node, ctx);
  ctx.buildExprAsStmt = (node: Node): Stmt[] => buildExprAsStmt(node, ctx);
  ctx.buildScopedBranch = (node: Node): Stmt[] => buildScopedBranch(node, ctx);

  const body: Stmt[] = [];
  resolved.sourceFile.forEachChild((child) => {
    body.push(...ctx.buildStmt(child));
  });
  if (hasPendingPreceding(ctx)) {
    throw new Error("dangling preceding statements at module top level");
  }
  popPrecedingScope(ctx);
  if (ctx.precedingStmtsStack.length !== 0) {
    throw new Error("preceding-stmts stack not drained at module exit");
  }
  return ir.createModule(body);
}
