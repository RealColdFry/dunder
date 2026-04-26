// AST → IR build for ES C-style `for (init; cond; update) body`.
//
// Per-iteration `let` binding: ES creates a fresh binding for `let`-init
// names per iteration. Body-side closures over those names get a
// per-iteration shadow local so closures capture the right value. Closures
// created in the update expression itself still capture the outer binding;
// not addressed here.

import {
  isIdentifier,
  isVariableDeclarationList,
  NodeFlags,
  type ForStatement,
} from "@typescript/native-preview/ast";
import {
  ir,
  type BindingKind,
  type Expr,
  type Identifier as IRIdentifier,
  type Stmt,
} from "../../ir/types.ts";
import { buildExpr, buildExprAsStmt, buildScopedBranch } from "../index.ts";
import { flushPrecedingStmts, type BuildCtx } from "../anf.ts";

export function buildFor(node: ForStatement, ctx: BuildCtx): Stmt[] {
  const out: Stmt[] = [];

  if (node.initializer) {
    out.push(...buildForInit(node.initializer, ctx));
  }

  let body: Stmt[] = [];

  if (node.condition) {
    const condInner = buildExpr(node.condition, ctx);
    const condFlushed = flushPrecedingStmts(ctx);
    body.push(
      ...condFlushed,
      ir.createIf(ir.createEsLogicalNot(ir.createEsTruthy(condInner)), [
        ir.createBreak(),
      ]),
    );
  }

  body.push(...buildScopedBranch(node.statement, ctx));

  let update = node.incrementor ? buildExprAsStmt(node.incrementor, ctx) : undefined;

  const letNames = letInitNames(node.initializer);
  if (letNames.size > 0) {
    const captured = findCapturedNamesInClosures(body, letNames);
    if (captured.size > 0) {
      const renames = new Map<string, string>();
      for (const name of captured) {
        renames.set(name, ctx.freshName(`${name}_inner`));
      }
      const sync = [...captured].map((name) =>
        ir.createAssign(
          ir.createIdentifier(name),
          ir.createIdentifier(renames.get(name)!),
        ),
      );
      renameInPlace(body, renames);
      // Sync outer before any break so post-loop reads see body's last value.
      body = injectSyncBeforeBreaks(body, sync);
      // Lua's `local` inside a loop body creates a fresh upvalue per iteration.
      body = [
        ...[...captured].map((name) =>
          ir.createVarDecl({
            bindingKind: "let",
            name: renames.get(name)!,
            init: ir.createIdentifier(name),
          }),
        ),
        ...body,
      ];
      // Sync before update so update sees body's mutations.
      update = [...sync, ...(update ?? [])];
    }
  }

  out.push(ir.createLoop({ body, update }));
  return out;
}

function buildForInit(
  initNode: ForStatement["initializer"] & {},
  ctx: BuildCtx,
): Stmt[] {
  if (isVariableDeclarationList(initNode)) {
    const flags = initNode.flags;
    const bindingKind: BindingKind =
      (flags & NodeFlags.Const) !== 0
        ? "const"
        : (flags & NodeFlags.Let) !== 0
          ? "let"
          : "var";
    const out: Stmt[] = [];
    for (const decl of initNode.declarations) {
      if (!isIdentifier(decl.name)) {
        throw new Error("destructured for-init not supported yet");
      }
      const initExpr: Expr | undefined = decl.initializer
        ? buildExpr(decl.initializer, ctx)
        : undefined;
      const flushed = flushPrecedingStmts(ctx);
      out.push(
        ...flushed,
        ir.createVarDecl({ bindingKind, name: decl.name.text, init: initExpr }),
      );
    }
    return out;
  }
  return buildExprAsStmt(initNode, ctx);
}

function letInitNames(initNode: ForStatement["initializer"]): Set<string> {
  const out = new Set<string>();
  if (!initNode || !isVariableDeclarationList(initNode)) return out;
  const flags = initNode.flags;
  if ((flags & (NodeFlags.Let | NodeFlags.Const)) === 0) return out;
  for (const decl of initNode.declarations) {
    if (isIdentifier(decl.name)) out.add(decl.name.text);
  }
  return out;
}

// Names referenced from within any function literal in the subtree.
function findCapturedNamesInClosures(
  stmts: Stmt[],
  letNames: Set<string>,
): Set<string> {
  const captured = new Set<string>();
  for (const s of stmts) visitStmt(s, false);

  function visitStmt(s: Stmt, inFn: boolean): void {
    switch (s.kind) {
      case "VarDecl":
        if (s.init) visitExpr(s.init, inFn);
        return;
      case "Destructure":
        visitExpr(s.init, inFn);
        return;
      case "FunDecl":
        for (const x of s.body) visitStmt(x, true);
        return;
      case "If":
        visitExpr(s.cond, inFn);
        for (const x of s.consequent) visitStmt(x, inFn);
        if (s.alternate) for (const x of s.alternate) visitStmt(x, inFn);
        return;
      case "Loop":
        for (const x of s.body) visitStmt(x, inFn);
        if (s.update) for (const x of s.update) visitStmt(x, inFn);
        return;
      case "Break":
      case "Continue":
        return;
      case "Return":
        if (s.value) visitExpr(s.value, inFn);
        return;
      case "ExprStmt":
        visitExpr(s.expr, inFn);
        return;
      case "Assign":
        visitExpr(s.target, inFn);
        visitExpr(s.value, inFn);
        return;
    }
  }

  function visitExpr(e: Expr, inFn: boolean): void {
    switch (e.kind) {
      case "Identifier":
        if (inFn && letNames.has(e.name)) captured.add(e.name);
        return;
      case "NumericLiteral":
      case "StringLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
        return;
      case "ArrowFun":
        for (const x of e.body) visitStmt(x, true);
        return;
      case "es.NumericAdd":
      case "es.StringConcat":
      case "Arithmetic":
      case "Comparison":
      case "es.Equality":
      case "es.LogicalExpression":
        visitExpr(e.left, inFn);
        visitExpr(e.right, inFn);
        return;
      case "UnaryExpression":
      case "es.LogicalNot":
        visitExpr(e.operand, inFn);
        return;
      case "es.Truthy":
        visitExpr(e.expr, inFn);
        return;
      case "Call":
        visitExpr(e.callee, inFn);
        for (const a of e.args) visitExpr(a, inFn);
        return;
      case "ArrayLit":
        for (const el of e.elements) visitExpr(el, inFn);
        return;
      case "PropertyAccess":
        visitExpr(e.receiver, inFn);
        return;
      case "es.ArrayLength":
        visitExpr(e.array, inFn);
        return;
      case "es.Conditional":
        visitExpr(e.cond, inFn);
        visitExpr(e.whenTrue, inFn);
        visitExpr(e.whenFalse, inFn);
        return;
      case "es.Index":
        visitExpr(e.array, inFn);
        visitExpr(e.index, inFn);
        return;
      case "ElementAccess":
        visitExpr(e.receiver, inFn);
        visitExpr(e.index, inFn);
        return;
    }
  }

  return captured;
}

// Not scope-aware: a nested `for (let i = 0; ...)` re-declaring the same
// name would also be renamed. Not exercised by current tests.
function renameInPlace(stmts: Stmt[], renames: Map<string, string>): void {
  for (const s of stmts) visitStmt(s);

  function visitStmt(s: Stmt): void {
    switch (s.kind) {
      case "VarDecl":
        if (s.init) visitExpr(s.init);
        return;
      case "Destructure":
        visitExpr(s.init);
        return;
      case "FunDecl":
        for (const x of s.body) visitStmt(x);
        return;
      case "If":
        visitExpr(s.cond);
        for (const x of s.consequent) visitStmt(x);
        if (s.alternate) for (const x of s.alternate) visitStmt(x);
        return;
      case "Loop":
        for (const x of s.body) visitStmt(x);
        if (s.update) for (const x of s.update) visitStmt(x);
        return;
      case "Break":
      case "Continue":
        return;
      case "Return":
        if (s.value) visitExpr(s.value);
        return;
      case "ExprStmt":
        visitExpr(s.expr);
        return;
      case "Assign":
        visitExpr(s.target);
        visitExpr(s.value);
        return;
    }
  }

  function visitExpr(e: Expr): void {
    switch (e.kind) {
      case "Identifier": {
        const r = renames.get(e.name);
        if (r !== undefined) (e as IRIdentifier).name = r;
        return;
      }
      case "NumericLiteral":
      case "StringLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
        return;
      case "ArrowFun":
        for (const x of e.body) visitStmt(x);
        return;
      case "es.NumericAdd":
      case "es.StringConcat":
      case "Arithmetic":
      case "Comparison":
      case "es.Equality":
      case "es.LogicalExpression":
        visitExpr(e.left);
        visitExpr(e.right);
        return;
      case "UnaryExpression":
      case "es.LogicalNot":
        visitExpr(e.operand);
        return;
      case "es.Truthy":
        visitExpr(e.expr);
        return;
      case "Call":
        visitExpr(e.callee);
        for (const a of e.args) visitExpr(a);
        return;
      case "ArrayLit":
        for (const el of e.elements) visitExpr(el);
        return;
      case "PropertyAccess":
        visitExpr(e.receiver);
        return;
      case "es.ArrayLength":
        visitExpr(e.array);
        return;
      case "es.Conditional":
        visitExpr(e.cond);
        visitExpr(e.whenTrue);
        visitExpr(e.whenFalse);
        return;
      case "es.Index":
        visitExpr(e.array);
        visitExpr(e.index);
        return;
      case "ElementAccess":
        visitExpr(e.receiver);
        visitExpr(e.index);
        return;
    }
  }
}

// Recurses into If branches but stops at nested Loop / FunDecl bodies.
function injectSyncBeforeBreaks(stmts: Stmt[], sync: readonly Stmt[]): Stmt[] {
  const out: Stmt[] = [];
  for (const s of stmts) {
    if (s.kind === "Break") {
      out.push(...sync, s);
    } else if (s.kind === "If") {
      out.push(
        ir.createIf(
          s.cond,
          injectSyncBeforeBreaks(s.consequent, sync),
          s.alternate ? injectSyncBeforeBreaks(s.alternate, sync) : undefined,
        ),
      );
    } else {
      out.push(s);
    }
  }
  return out;
}
