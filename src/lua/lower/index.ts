// IR → Lua AST. The IR is ANF, so this is a near-mechanical tree-by-tree
// translation; per-target shape choices dispatch on `LuaCapabilities`.

import type { Expr, Module, Stmt } from "../../ir/types.ts";
import * as lua from "../ast.ts";
import { LuaJIT, type LuaCapabilities } from "../capabilities.ts";

interface LowerCtx {
  target: LuaCapabilities;
  freshName: (prefix: string) => string;
  // Top-of-stack is the goto label the next Continue jumps to.
  continueLabelStack: string[];
}

// `%` (IR temp sigil) is illegal in Lua identifiers; translate to `____`.
function luaName(name: string): string {
  return name.startsWith("%") ? "____" + name.slice(1) : name;
}

function luaIdent(name: string): lua.Identifier {
  return lua.createIdentifier(luaName(name));
}

// Module emit shape:
//   local ____exports = {}
//   <body>           -- exported decls become assignments to ____exports
//   return ____exports
export function lowerModule(mod: Module, target: LuaCapabilities = LuaJIT): lua.File {
  let counter = 0;
  const ctx: LowerCtx = {
    target,
    freshName: (prefix) => `____${prefix}_${counter++}`,
    continueLabelStack: [],
  };

  const exportsId = lua.createIdentifier("____exports");
  const statements: lua.Statement[] = [
    lua.createVariableDeclarationStatement(exportsId, lua.createTableExpression()),
  ];
  for (const s of mod.body) statements.push(...lowerStmt(s, ctx));
  statements.push(lua.createReturnStatement([lua.createIdentifier("____exports")]));
  return lua.createFile(statements, new Set(), "");
}

function exportsFieldAccess(name: string): lua.TableIndexExpression {
  return lua.createTableIndexExpression(
    lua.createIdentifier("____exports"),
    lua.createStringLiteral(name),
  );
}

function lowerStmt(stmt: Stmt, ctx: LowerCtx): lua.Statement[] {
  switch (stmt.kind) {
    case "VarDecl": {
      const init = stmt.init ? lowerExpr(stmt.init, ctx) : undefined;
      if (stmt.exported && init !== undefined) {
        return [lua.createAssignmentStatement(exportsFieldAccess(stmt.name), init)];
      }
      return [lua.createVariableDeclarationStatement(luaIdent(stmt.name), init)];
    }

    case "Destructure":
      return lowerArrayDestructuring(stmt, ctx);

    case "FunDecl": {
      const params = stmt.params.map((p) => luaIdent(p.name));
      const body = lua.createBlock(stmt.body.flatMap((s) => lowerStmt(s, ctx)));
      const fn = lua.createFunctionExpression(body, params, undefined, lua.NodeFlags.Declaration);
      if (stmt.exported) {
        return [lua.createAssignmentStatement(exportsFieldAccess(stmt.name), fn)];
      }
      return [lua.createVariableDeclarationStatement(luaIdent(stmt.name), fn)];
    }

    case "If": {
      const cond = lowerExpr(stmt.cond, ctx);
      const thenBlock = lua.createBlock(stmt.consequent.flatMap((s) => lowerStmt(s, ctx)));
      const elseBlock = stmt.alternate !== undefined ? lowerElse(stmt.alternate, ctx) : undefined;
      return [lua.createIfStatement(cond, thenBlock, elseBlock)];
    }

    case "Return":
      return [
        lua.createReturnStatement(stmt.value !== undefined ? [lowerExpr(stmt.value, ctx)] : []),
      ];

    case "ExprStmt":
      return [lua.createExpressionStatement(lowerExpr(stmt.expr, ctx))];

    case "Assign": {
      const target = lowerExpr(stmt.target, ctx) as lua.AssignmentLeftHandSideExpression;
      const value = lowerExpr(stmt.value, ctx);
      return [lua.createAssignmentStatement(target, value)];
    }

    case "Loop":
      return lowerLoop(stmt, ctx);

    case "Break":
      return [lua.createBreakStatement()];

    case "Continue": {
      const label = ctx.continueLabelStack[ctx.continueLabelStack.length - 1];
      if (label === undefined) throw new Error("Continue outside Loop");
      return [lua.createGotoStatement(label)];
    }
  }
}

// Loop emit (hasGoto path):
//
//   while true do
//     <body>
//     ::__continue_N::
//     <update>
//   end
//
// Sentinel-form fallback for non-goto targets (Lua 5.0/5.1/Universal) is
// not implemented yet.
function lowerLoop(stmt: Stmt & { kind: "Loop" }, ctx: LowerCtx): lua.Statement[] {
  if (!ctx.target.hasGoto) {
    throw new Error(
      "Loop with goto-based continue requires `hasGoto` capability; sentinel fallback for Lua 5.0/5.1/Universal is not implemented yet",
    );
  }
  const label = ctx.freshName("continue");
  ctx.continueLabelStack.push(label);
  const bodyStmts: lua.Statement[] = [];
  for (const s of stmt.body) bodyStmts.push(...lowerStmt(s, ctx));
  bodyStmts.push(lua.createLabelStatement(label));
  if (stmt.update) {
    for (const s of stmt.update) bodyStmts.push(...lowerStmt(s, ctx));
  }
  ctx.continueLabelStack.pop();
  return [
    lua.createWhileStatement(lua.createBlock(bodyStmts), lua.createBooleanLiteral(true)),
  ];
}

function lowerArrayDestructuring(
  stmt: Stmt & { kind: "Destructure" },
  ctx: LowerCtx,
): lua.Statement[] {
  const lefts = stmt.pattern.elements.map((el) => luaIdent(el.name));
  const count = stmt.pattern.elements.length;

  // Literal source → inline multi-assign (works on every Lua version).
  if (stmt.init.kind === "ArrayLit") {
    const rights = stmt.init.elements.map((e) => lowerExpr(e, ctx));
    if (stmt.exported) {
      return [
        lua.createAssignmentStatement(
          stmt.pattern.elements.map((el) => exportsFieldAccess(el.name)),
          rights,
        ),
      ];
    }
    return [lua.createVariableDeclarationStatement(lefts, rights)];
  }

  const sourceExpr = lowerExpr(stmt.init, ctx);
  const unpackCall = unpackExpression(ctx.target, sourceExpr, count);

  if (stmt.exported) {
    return [
      lua.createAssignmentStatement(
        stmt.pattern.elements.map((el) => exportsFieldAccess(el.name)),
        [unpackCall],
      ),
    ];
  }
  return [lua.createVariableDeclarationStatement(lefts, [unpackCall])];
}

function unpackExpression(
  target: LuaCapabilities,
  arr: lua.Expression,
  count: number,
): lua.Expression {
  switch (target.unpack.kind) {
    case "global": {
      const args: lua.Expression[] = [arr];
      if (target.unpack.supportsBounds) {
        args.push(lua.createNumericLiteral(1), lua.createNumericLiteral(count));
      }
      return lua.createCallExpression(lua.createIdentifier("unpack"), args);
    }
    case "table":
      return lua.createCallExpression(
        lua.createTableIndexExpression(
          lua.createIdentifier("table"),
          lua.createStringLiteral("unpack"),
        ),
        [arr, lua.createNumericLiteral(1), lua.createNumericLiteral(count)],
      );
    case "lualib":
      return lua.createCallExpression(lua.createIdentifier("__TS__Unpack"), [arr]);
  }
}

// Else-of-one-If lowers to `elseif` by passing the nested IfStatement directly.
function lowerElse(stmts: Stmt[], ctx: LowerCtx): lua.Block | lua.IfStatement {
  if (stmts.length === 1 && stmts[0]!.kind === "If") {
    const lowered = lowerStmt(stmts[0]!, ctx);
    if (lowered.length === 1 && lua.isIfStatement(lowered[0]!)) {
      return lowered[0]!;
    }
    return lua.createBlock(lowered);
  }
  return lua.createBlock(stmts.flatMap((s) => lowerStmt(s, ctx)));
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
      return lua.createBinaryExpression(
        lowerExpr(expr.left, ctx),
        lowerExpr(expr.right, ctx),
        lua.SyntaxKind.AdditionOperator,
      );
    case "es.StringConcat":
      return lua.createBinaryExpression(
        lowerExpr(expr.left, ctx),
        lowerExpr(expr.right, ctx),
        lua.SyntaxKind.ConcatOperator,
      );

    case "Arithmetic": {
      // DIV-MOD-001: Lua's `%` is sign-of-divisor (vs ES sign-of-dividend).
      const op = arithmeticLuaOp(expr.op);
      return lua.createBinaryExpression(lowerExpr(expr.left, ctx), lowerExpr(expr.right, ctx), op);
    }

    case "Comparison": {
      const op = comparisonLuaOp(expr.op);
      return lua.createBinaryExpression(lowerExpr(expr.left, ctx), lowerExpr(expr.right, ctx), op);
    }

    case "es.LogicalExpression": {
      // DIV-TRUTH-001: short-circuit matches; truthiness rules differ.
      const op = expr.op === "&&" ? lua.SyntaxKind.AndOperator : lua.SyntaxKind.OrOperator;
      return lua.createBinaryExpression(lowerExpr(expr.left, ctx), lowerExpr(expr.right, ctx), op);
    }

    case "UnaryExpression":
      return lua.createUnaryExpression(
        lowerExpr(expr.operand, ctx),
        lua.SyntaxKind.NegationOperator,
      );

    case "es.LogicalNot":
      // DIV-TRUTH-001: Lua truthiness, not ES.
      return lua.createUnaryExpression(
        lowerExpr(expr.operand, ctx),
        lua.SyntaxKind.NotOperator,
      );

    case "es.Truthy":
      // DIV-TRUTH-001: passthrough; default backend accepts the divergence.
      return lowerExpr(expr.expr, ctx);

    case "es.Equality": {
      // DIV-EQ-001: both ==/=== → Lua `==` (strict ignored).
      const op = expr.negated
        ? lua.SyntaxKind.InequalityOperator
        : lua.SyntaxKind.EqualityOperator;
      return lua.createBinaryExpression(lowerExpr(expr.left, ctx), lowerExpr(expr.right, ctx), op);
    }

    case "Call":
      return lua.createCallExpression(
        lowerExpr(expr.callee, ctx),
        expr.args.map((a) => lowerExpr(a, ctx)),
      );

    case "ArrayLit": {
      const fields = expr.elements.map((el) => lua.createTableFieldExpression(lowerExpr(el, ctx)));
      return lua.createTableExpression(fields);
    }

    case "PropertyAccess":
      return lua.createTableIndexExpression(
        lowerExpr(expr.receiver, ctx),
        lua.createStringLiteral(expr.name),
      );

    case "es.ArrayLength":
      return lowerArrayLength(ctx.target, lowerExpr(expr.array, ctx));

    case "es.Conditional": {
      // IIFE: always correct. Skips the `cond and a or b` shortcut (broken
      // when `a` is falsy) and ignores hoisted-temp / native-ternary paths.
      const body = lua.createBlock([
        lua.createIfStatement(
          lowerExpr(expr.cond, ctx),
          lua.createBlock([lua.createReturnStatement([lowerExpr(expr.whenTrue, ctx)])]),
          lua.createBlock([lua.createReturnStatement([lowerExpr(expr.whenFalse, ctx)])]),
        ),
      ]);
      const fn = lua.createFunctionExpression(body, []);
      return lua.createCallExpression(fn, []);
    }

    case "ArrowFun": {
      const params = expr.params.map((p) => luaIdent(p.name));
      const body = lua.createBlock(expr.body.flatMap((s) => lowerStmt(s, ctx)));
      return lua.createFunctionExpression(body, params);
    }

    case "es.Index": {
      // DIV-ARR-INDEX-001: 0-based → 1-based. Constant-fold numeric literals.
      const array = lowerExpr(expr.array, ctx);
      const index = lowerExpr(expr.index, ctx);
      return lua.createTableIndexExpression(array, adjustIndex(index));
    }

    case "ElementAccess":
      return lua.createTableIndexExpression(
        lowerExpr(expr.receiver, ctx),
        lowerExpr(expr.index, ctx),
      );
  }
}

function lowerArrayLength(target: LuaCapabilities, arr: lua.Expression): lua.Expression {
  switch (target.arrayLength.kind) {
    case "native":
      return lua.createUnaryExpression(arr, lua.SyntaxKind.LengthOperator);
    case "tableGetn":
      return lua.createCallExpression(
        lua.createTableIndexExpression(
          lua.createIdentifier("table"),
          lua.createStringLiteral("getn"),
        ),
        [arr],
      );
    case "call":
      return lua.createCallExpression(lua.createIdentifier(target.arrayLength.fn), [arr]);
  }
}

function adjustIndex(index: lua.Expression): lua.Expression {
  if (lua.isNumericLiteral(index)) {
    return lua.createNumericLiteral(index.value + 1);
  }
  return lua.createBinaryExpression(
    index,
    lua.createNumericLiteral(1),
    lua.SyntaxKind.AdditionOperator,
  );
}

function arithmeticLuaOp(op: "-" | "*" | "/" | "%" | "**"): lua.BinaryOperator {
  switch (op) {
    case "-":
      return lua.SyntaxKind.SubtractionOperator;
    case "*":
      return lua.SyntaxKind.MultiplicationOperator;
    case "/":
      return lua.SyntaxKind.DivisionOperator;
    case "%":
      return lua.SyntaxKind.ModuloOperator;
    case "**":
      return lua.SyntaxKind.PowerOperator;
  }
}

function comparisonLuaOp(op: "<" | ">" | "<=" | ">="): lua.BinaryOperator {
  switch (op) {
    case "<":
      return lua.SyntaxKind.LessThanOperator;
    case ">":
      return lua.SyntaxKind.GreaterThanOperator;
    case "<=":
      return lua.SyntaxKind.LessEqualOperator;
    case ">=":
      return lua.SyntaxKind.GreaterEqualOperator;
  }
}
