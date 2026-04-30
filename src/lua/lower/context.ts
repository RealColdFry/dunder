// Shared lowering state and identifier helpers. Recursion-via-ctx
// follows the build pass's pattern: handler modules don't import the
// dispatcher, they call `ctx.lowerStmt` / `ctx.lowerExpr`. That avoids
// circular imports and lets the dispatcher stay the only place that
// owns the kind switch.

import type { Expr, Stmt } from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import type { LuaCapabilities } from "#/lua/capabilities.ts";

// One frame per surrounding Loop. Top-of-stack is consumed by the next
// Continue/Break. `goto` is used when the target has labels; `sentinel`
// is the Lua 5.0/5.1/Universal fallback (repeat ... until true).
export type LoopFrame =
  | {
      kind: "goto";
      continueLabel: string;
    }
  | {
      kind: "sentinel";
      // Set when the loop body contains a top-level Break; rewriting Break
      // to `<sentinel> = true; break` lets the post-repeat check propagate
      // it to a real `break` of the outer while. Undefined when no Break
      // appears, so the sentinel decl + check are elided.
      breakSentinel: string | undefined;
    };

export interface LowerCtx {
  target: LuaCapabilities;
  freshName: (prefix: string) => string;
  loopFrames: LoopFrame[];
  // Recursion: handlers call these instead of importing from index.ts.
  // Wired in lowerModule before any handler runs.
  lowerStmt: (stmt: Stmt) => lua.Statement[];
  lowerExpr: (expr: Expr) => lua.Expression;
}

// `%` (IR temp sigil) is illegal in Lua identifiers; translate to `____`.
export function luaName(name: string): string {
  return name.startsWith("%") ? "____" + name.slice(1) : name;
}

export function luaIdent(name: string): lua.Identifier {
  return lua.createIdentifier(luaName(name));
}

// Module-level export accessor. Used by `VarDecl`, `FunDecl`, and
// `Destructure` whenever a binding is exported from the source module.
export function exportsFieldAccess(name: string): lua.TableIndexExpression {
  return lua.createTableIndexExpression(
    lua.createIdentifier("____exports"),
    lua.createStringLiteral(name),
  );
}
