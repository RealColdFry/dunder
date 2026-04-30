// Single source of truth for IR tree traversal. `forEachChild` calls
// `visit(child)` for each immediate child of `node`. Walkers built on top
// pass their own state and decide whether to recurse.
//
// New node kinds only need their child slots listed here; every walker
// inherits the change.

import type { Expr, Module, Stmt, ArrPat, ArrPatElem } from "./types.ts";

export type IRNode = Module | Stmt | Expr | ArrPat | ArrPatElem;

export function forEachChild(node: IRNode, visit: (child: IRNode) => void): void {
  switch (node.kind) {
    case "Module":
      for (const s of node.body) visit(s);
      return;
    case "VarDecl":
      if (node.init) visit(node.init);
      return;
    case "Destructure":
      visit(node.pattern);
      visit(node.init);
      return;
    case "FunDecl":
      visit(node.fn);
      return;
    case "If":
      visit(node.cond);
      for (const s of node.consequent) visit(s);
      if (node.alternate) for (const s of node.alternate) visit(s);
      return;
    case "Loop":
      if (node.init) for (const s of node.init) visit(s);
      for (const s of node.body) visit(s);
      if (node.update) for (const s of node.update) visit(s);
      return;
    case "Break":
    case "Continue":
      return;
    case "Return":
      if (node.value) visit(node.value);
      return;
    case "ExprStmt":
      visit(node.expr);
      return;
    case "Assign":
      visit(node.target);
      visit(node.value);
      return;
    case "ArrPat":
      for (const el of node.elements) visit(el);
      return;
    case "ArrPatElem":
      return;
    case "NumericLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "Identifier":
      return;
    case "es.NumericAdd":
    case "es.StringConcat":
    case "Arithmetic":
    case "Comparison":
    case "es.Equality":
    case "es.LogicalExpression":
      visit(node.left);
      visit(node.right);
      return;
    case "UnaryExpression":
    case "LogicalNot":
      visit(node.operand);
      return;
    case "es.Truthy":
      visit(node.expr);
      return;
    case "Call":
      visit(node.callee);
      for (const a of node.args) visit(a);
      return;
    case "ArrayLit":
      for (const el of node.elements) visit(el);
      return;
    case "PropertyAccess":
      visit(node.receiver);
      return;
    case "es.ArrayLength":
      visit(node.array);
      return;
    case "es.Conditional":
      visit(node.cond);
      visit(node.whenTrue);
      visit(node.whenFalse);
      return;
    case "Function":
      for (const s of node.body) visit(s);
      return;
    case "es.Index":
      visit(node.array);
      visit(node.index);
      return;
    case "ElementAccess":
      visit(node.receiver);
      visit(node.index);
      return;
    case "es.Global":
      return;
    case "es.ObjectLiteral":
      for (const m of node.members) {
        if (m.kind === "kv" && m.key.kind === "computed") visit(m.key.expr);
        visit(m.value);
      }
      return;
  }
}
