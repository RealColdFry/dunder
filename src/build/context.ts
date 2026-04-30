import { type Node } from "#/ts.ts";
import { type ResolvedAst } from "#/frontend/index.ts";
import { type Expr, type Stmt } from "#/ir/types.ts";

export interface BuildCtx {
  resolved: ResolvedAst;
  // Stack of side-effect accumulators. Each frame is a fresh scope:
  // sub-expressions push hoisted statements onto the top frame while
  // building. Statement-emit boundaries flush the top. Block / function-body
  // / branch boundaries push a new frame so preceding statements can't leak
  // across the boundary.
  precedingStmtsStack: Stmt[][];
  // The `%` sigil marks IR-level temporaries.
  freshName: (prefix: string) => string;
  // Recursive dispatchers, wired up at module init by buildModule. Visitors
  // call these to recurse without import cycles between sibling files.
  buildExpr: (node: Node) => Expr;
  buildStmt: (node: Node) => Stmt[];
  buildExprAsStmt: (node: Node) => Stmt[];
  buildScopedBranch: (node: Node) => Stmt[];
}
