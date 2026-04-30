// AST → IR build for ES C-style `for (init; cond; update) body`.
//
// Per-iteration `let` binding: ES creates a fresh binding for `let`-init
// names per iteration. Body-side closures over those names get a
// per-iteration shadow local so closures capture the right value. Closures
// created in the update expression itself still capture the outer binding;
// not addressed here.

import { isIdentifier, isVariableDeclarationList, NodeFlags, type ForStatement } from "#/ts.ts";
import { ir, type BindingKind, type Expr, type Stmt } from "#/ir/types.ts";
import { forEachChild, type IRNode } from "#/ir/visit.ts";
import { flushPrecedingStmts } from "#/build/anf.ts";
import type { BuildCtx } from "#/build/context.ts";
import { asTruthy, notExpr } from "#/build/normalize.ts";

export function buildFor(node: ForStatement, ctx: BuildCtx): Stmt[] {
  const init: Stmt[] = node.initializer ? buildForInit(node.initializer, ctx) : [];

  let body: Stmt[] = [];

  if (node.condition) {
    const condInner = ctx.buildExpr(node.condition);
    const condFlushed = flushPrecedingStmts(ctx);
    body.push(
      ...condFlushed,
      ir.createIf(notExpr(asTruthy(ctx, node.condition, condInner)), [ir.createBreak()]),
    );
  }

  body.push(...ctx.buildScopedBranch(node.statement));

  let update = node.incrementor ? ctx.buildExprAsStmt(node.incrementor) : undefined;

  const letNames = letInitNames(node.initializer);
  if (letNames.size > 0) {
    const captured = findCapturedNamesInClosures(body, letNames);
    if (captured.size > 0) {
      const renames = new Map<string, string>();
      for (const name of captured) {
        renames.set(name, ctx.freshName(`${name}_inner`));
      }
      const sync = [...captured].map((name) =>
        ir.createAssign(ir.createIdentifier(name), ir.createIdentifier(renames.get(name)!)),
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

  return [
    ir.createLoop({
      init: init.length > 0 ? init : undefined,
      body,
      update,
    }),
  ];
}

function buildForInit(initNode: ForStatement["initializer"] & {}, ctx: BuildCtx): Stmt[] {
  if (isVariableDeclarationList(initNode)) {
    const flags = initNode.flags;
    const bindingKind: BindingKind =
      (flags & NodeFlags.Const) !== 0 ? "const" : (flags & NodeFlags.Let) !== 0 ? "let" : "var";
    const out: Stmt[] = [];
    for (const decl of initNode.declarations) {
      if (!isIdentifier(decl.name)) {
        throw new Error("destructured for-init not supported yet");
      }
      const initExpr: Expr | undefined = decl.initializer
        ? ctx.buildExpr(decl.initializer)
        : undefined;
      const flushed = flushPrecedingStmts(ctx);
      out.push(
        ...flushed,
        ir.createVarDecl({
          bindingKind,
          name: decl.name.text,
          init: initExpr,
        }),
      );
    }
    return out;
  }
  return ctx.buildExprAsStmt(initNode);
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
function findCapturedNamesInClosures(stmts: Stmt[], letNames: Set<string>): Set<string> {
  const captured = new Set<string>();
  for (const s of stmts) visit(s, false);

  function visit(node: IRNode, inFn: boolean): void {
    if (node.kind === "Identifier") {
      if (inFn && letNames.has(node.name)) captured.add(node.name);
      return;
    }
    const childInFn = inFn || node.kind === "Function" || node.kind === "FunDecl";
    forEachChild(node, (c) => visit(c, childInFn));
  }

  return captured;
}

// Not scope-aware: a nested `for (let i = 0; ...)` re-declaring the same
// name would also be renamed. Not exercised by current tests.
function renameInPlace(stmts: Stmt[], renames: Map<string, string>): void {
  for (const s of stmts) visit(s);

  function visit(node: IRNode): void {
    if (node.kind === "Identifier") {
      const r = renames.get(node.name);
      if (r !== undefined) node.name = r;
      return;
    }
    forEachChild(node, visit);
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
