// IR → Lua AST entry. The two dispatchers below own the kind switch;
// non-trivial cases delegate to sibling modules via `ctx.lowerStmt` /
// `ctx.lowerExpr`. Trivial leaves (literals, Identifier, Call, simple
// stmts) stay inline since extracting them to single-function files
// would be ceremony without payoff.

import type { Expr, Module, Stmt } from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import { LuaJIT, type LuaCapabilities } from "#/lua/capabilities.ts";
import {
  lowerArithmetic,
  lowerComparison,
  lowerEsNumericAdd,
  lowerEsStringConcat,
} from "./arithmetic.ts";
import {
  lowerArrayLit,
  lowerElementAccess,
  lowerEsArrayLength,
  lowerEsIndex,
} from "./array.ts";
import {
  lowerEsEquality,
  lowerEsLogicalExpression,
  lowerEsTruthy,
  lowerLogicalNot,
  lowerUnaryExpression,
} from "./bool-ops.ts";
import { lowerEsConditional, lowerIf } from "./conditional.ts";
import { exportsFieldAccess, type LowerCtx, luaIdent } from "./context.ts";
import { lowerDestructure } from "./destructure.ts";
import { lowerFunction } from "./function.ts";
import { lowerEsGlobal } from "./globals.ts";
import { lowerLoop } from "./loop.ts";
import { lowerEsObjectLiteral, lowerPropertyAccess } from "./object.ts";

// Module emit shape:
//   local ____exports = {}
//   <body>           -- exported decls become assignments to ____exports
//   return ____exports
export function lowerModule(mod: Module, target: LuaCapabilities = LuaJIT): lua.File {
  let counter = 0;
  // ctx.lowerStmt / ctx.lowerExpr are wired below; the placeholder
  // function bodies are replaced before any handler can call them.
  const ctx: LowerCtx = {
    target,
    freshName: (prefix) => `____${prefix}_${counter++}`,
    loopFrames: [],
    lowerStmt: () => {
      throw new Error("ctx.lowerStmt called before wiring");
    },
    lowerExpr: () => {
      throw new Error("ctx.lowerExpr called before wiring");
    },
  };
  ctx.lowerStmt = (stmt) => lowerStmt(stmt, ctx);
  ctx.lowerExpr = (expr) => lowerExpr(expr, ctx);

  const exportsId = lua.createIdentifier("____exports");
  const statements: lua.Statement[] = [
    lua.createVariableDeclarationStatement(exportsId, lua.createTableExpression()),
  ];
  for (const s of mod.body) statements.push(...ctx.lowerStmt(s));
  statements.push(lua.createReturnStatement([lua.createIdentifier("____exports")]));
  return lua.createFile(statements, new Set(), "");
}

function lowerStmt(stmt: Stmt, ctx: LowerCtx): lua.Statement[] {
  switch (stmt.kind) {
    case "VarDecl": {
      const init = stmt.init ? ctx.lowerExpr(stmt.init) : undefined;
      if (stmt.exported && init !== undefined) {
        return [lua.createAssignmentStatement(exportsFieldAccess(stmt.name), init)];
      }
      return [lua.createVariableDeclarationStatement(luaIdent(stmt.name), init)];
    }

    case "Destructure":
      return lowerDestructure(stmt, ctx);

    case "FunDecl": {
      // The Function literal's params/body are lowered here directly so
      // we can emit `local f = function(…) end` (or the exports-table
      // form). Going through `lowerFunction` would discard the
      // declaration-vs-expression distinction the printer uses.
      const params = stmt.fn.params.map((p) => luaIdent(p.name));
      const body = lua.createBlock(stmt.fn.body.flatMap((s) => ctx.lowerStmt(s)));
      const fn = lua.createFunctionExpression(body, params, undefined, lua.NodeFlags.Declaration);
      const declName = stmt.fn.name;
      if (declName === undefined) throw new Error("FunDecl without a name");
      if (stmt.exported) {
        return [lua.createAssignmentStatement(exportsFieldAccess(declName), fn)];
      }
      return [lua.createVariableDeclarationStatement(luaIdent(declName), fn)];
    }

    case "If":
      return lowerIf(stmt, ctx);

    case "Return":
      return [
        lua.createReturnStatement(stmt.value !== undefined ? [ctx.lowerExpr(stmt.value)] : []),
      ];

    case "ExprStmt":
      return [lua.createExpressionStatement(ctx.lowerExpr(stmt.expr))];

    case "Assign": {
      const target = ctx.lowerExpr(stmt.target) as lua.AssignmentLeftHandSideExpression;
      const value = ctx.lowerExpr(stmt.value);
      return [lua.createAssignmentStatement(target, value)];
    }

    case "Loop":
      return lowerLoop(stmt, ctx);

    case "Break": {
      const frame = ctx.loopFrames[ctx.loopFrames.length - 1];
      if (frame?.kind === "sentinel" && frame.breakSentinel !== undefined) {
        return [
          lua.createAssignmentStatement(
            lua.createIdentifier(frame.breakSentinel),
            lua.createBooleanLiteral(true),
          ),
          lua.createBreakStatement(),
        ];
      }
      return [lua.createBreakStatement()];
    }

    case "Continue": {
      const frame = ctx.loopFrames[ctx.loopFrames.length - 1];
      if (frame === undefined) throw new Error("Continue outside Loop");
      if (frame.kind === "goto") return [lua.createGotoStatement(frame.continueLabel)];
      // Sentinel frame: break out of the surrounding `repeat ... until true`
      // so control falls through to <update>.
      return [lua.createBreakStatement()];
    }
  }
}

function lowerExpr(expr: Expr, ctx: LowerCtx): lua.Expression {
  switch (expr.kind) {
    case "NumericLiteral":
      return lua.createNumericLiteral(expr.value);
    case "StringLiteral":
      return lua.createStringLiteral(expr.value);
    case "BooleanLiteral":
      return lua.createBooleanLiteral(expr.value);
    case "NullLiteral":
      return lua.createNilLiteral();
    case "Identifier":
      return luaIdent(expr.name);

    case "es.NumericAdd":
      return lowerEsNumericAdd(expr, ctx);
    case "es.StringConcat":
      return lowerEsStringConcat(expr, ctx);
    case "Arithmetic":
      return lowerArithmetic(expr, ctx);
    case "Comparison":
      return lowerComparison(expr, ctx);

    case "es.LogicalExpression":
      return lowerEsLogicalExpression(expr, ctx);
    case "UnaryExpression":
      return lowerUnaryExpression(expr, ctx);
    case "LogicalNot":
      return lowerLogicalNot(expr, ctx);
    case "es.Truthy":
      return lowerEsTruthy(expr, ctx);
    case "es.Equality":
      return lowerEsEquality(expr, ctx);

    case "Call":
      return lua.createCallExpression(
        ctx.lowerExpr(expr.callee),
        expr.args.map((a) => ctx.lowerExpr(a)),
      );

    case "ArrayLit":
      return lowerArrayLit(expr, ctx);
    case "PropertyAccess":
      return lowerPropertyAccess(expr, ctx);
    case "es.ArrayLength":
      return lowerEsArrayLength(expr, ctx);
    case "es.Conditional":
      return lowerEsConditional(expr, ctx);
    case "Function":
      return lowerFunction(expr, ctx);
    case "es.Index":
      return lowerEsIndex(expr, ctx);
    case "ElementAccess":
      return lowerElementAccess(expr, ctx);
    case "es.Global":
      return lowerEsGlobal(expr, ctx);
    case "es.ObjectLiteral":
      return lowerEsObjectLiteral(expr, ctx);
  }
}
