// Generic Loop lowering with two emit shapes:
//
// hasGoto path:
//
//   while true do
//     do                  -- scope barrier: any locals declared in body
//       <body>            --   go out of scope before the label, so a
//     end                 --   `goto continue_N` doesn't jump into
//     ::__continue_N::    --   their scope (Lua forbids that).
//     <update>
//   end
//
// The inner `do ... end` matters: without it, a `local j` in the body
// would still be in scope at the label position, and any forward
// `goto __continue_N` from before the `local j` (e.g. an early-out
// continue) hits the "goto jumps into the scope of a local" error.
// TSTL emits the same barrier shape for the same reason.
//
// Sentinel-form fallback for non-goto targets (Lua 5.0/5.1/Universal):
//
//   while true do
//     local ____broke_N = false  -- only when body has a Break
//     repeat
//       <body>                   -- Continue → break (exits repeat)
//                                -- Break    → ____broke_N = true; break
//     until true
//     if ____broke_N then break end  -- only when body has a Break
//     <update>
//   end
//
// `repeat ... until true` runs at most once, so a `break` inside it is a
// "skip the rest of this iteration" jump that lands just before <update>.
// A real Break sets the sentinel, exits the repeat, and the post-check
// translates that into a `break` of the outer while. The sentinel decl
// and post-check are elided when the body has no top-level Break.

import type { Loop, Stmt } from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import type { LowerCtx } from "./context.ts";

export function lowerLoop(stmt: Loop, ctx: LowerCtx): lua.Statement[] {
  let whileStmt: lua.Statement;
  if (ctx.target.hasGoto) {
    const label = ctx.freshName("continue");
    ctx.loopFrames.push({
      kind: "goto",
      continueLabel: label,
    });
    const innerStmts: lua.Statement[] = [];
    for (const s of stmt.body) innerStmts.push(...ctx.lowerStmt(s));
    ctx.loopFrames.pop();
    const bodyStmts: lua.Statement[] = [lua.createDoStatement(innerStmts)];
    bodyStmts.push(lua.createLabelStatement(label));
    if (stmt.update) {
      for (const s of stmt.update) bodyStmts.push(...ctx.lowerStmt(s));
    }
    whileStmt = lua.createWhileStatement(
      lua.createBlock(bodyStmts),
      lua.createBooleanLiteral(true),
    );
  } else {
    const breakSentinel = bodyHasOwnBreak(stmt.body) ? ctx.freshName("broke") : undefined;
    ctx.loopFrames.push({
      kind: "sentinel",
      breakSentinel,
    });
    const repeatStmts: lua.Statement[] = [];
    for (const s of stmt.body) repeatStmts.push(...ctx.lowerStmt(s));
    ctx.loopFrames.pop();

    const whileBody: lua.Statement[] = [];
    if (breakSentinel !== undefined) {
      whileBody.push(
        lua.createVariableDeclarationStatement(
          lua.createIdentifier(breakSentinel),
          lua.createBooleanLiteral(false),
        ),
      );
    }
    whileBody.push(
      lua.createRepeatStatement(lua.createBlock(repeatStmts), lua.createBooleanLiteral(true)),
    );
    if (breakSentinel !== undefined) {
      whileBody.push(
        lua.createIfStatement(
          lua.createIdentifier(breakSentinel),
          lua.createBlock([lua.createBreakStatement()]),
        ),
      );
    }
    if (stmt.update) {
      for (const s of stmt.update) whileBody.push(...ctx.lowerStmt(s));
    }
    whileStmt = lua.createWhileStatement(lua.createBlock(whileBody), lua.createBooleanLiteral(true));
  }

  // `for`-init scoping: wrap (init; while ...) in `do ... end` so any
  // `let`/`const` introduced by init doesn't leak into the surrounding
  // block. `while` and `do-while` come through with no init and skip the
  // wrap to keep their emission flat.
  if (stmt.init !== undefined && stmt.init.length > 0) {
    const inner: lua.Statement[] = [];
    for (const s of stmt.init) inner.push(...ctx.lowerStmt(s));
    inner.push(whileStmt);
    return [lua.createDoStatement(inner)];
  }
  return [whileStmt];
}

// Walks `stmts` looking for a Break that targets the current loop. Stops
// at nested Loop and Function/FunDecl boundaries since those introduce
// their own break/continue scopes.
function bodyHasOwnBreak(stmts: Stmt[]): boolean {
  for (const s of stmts) {
    switch (s.kind) {
      case "Break":
        return true;
      case "If":
        if (bodyHasOwnBreak(s.consequent)) return true;
        if (s.alternate !== undefined && bodyHasOwnBreak(s.alternate)) return true;
        break;
      case "Loop":
      case "FunDecl":
        break;
      default:
        break;
    }
  }
  return false;
}
