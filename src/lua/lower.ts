// IR → Lua AST.
//
// The lowering dispatches on the target's `LuaCapabilities` for any
// per-target decision. No preset names appear in this file; capabilities
// are the contract. Adding a new target is one entry in capabilities.ts;
// adding a new per-target decision is a switch on a capability shape here.

import type { Expr, Module, Stmt } from "../ir.ts";
import * as lua from "./ast.ts";
import { LuaJIT, type LuaCapabilities } from "./capabilities.ts";

interface LowerCtx {
  target: LuaCapabilities;
  freshName: (prefix: string) => string;
}

// Module emit shape (matches TSTL's CommonJS-style module wrap):
//   local ____exports = {}
//   <body>           -- exported decls become assignments to ____exports
//   return ____exports
export function lowerModule(mod: Module, target: LuaCapabilities = LuaJIT): lua.File {
  let counter = 0;
  const ctx: LowerCtx = {
    target,
    freshName: (prefix) => `____${prefix}_${counter++}`,
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

// Returns `Statement[]` because some IR statements lower to multiple Lua
// statements (currently destructuring; later: hoisted temps, some control
// flow synthesis). Caller flattens.
function lowerStmt(stmt: Stmt, ctx: LowerCtx): lua.Statement[] {
  switch (stmt.kind) {
    case "VariableDeclaration": {
      // bindingKind is carried in IR for future backends that need per-iteration
      // binding (let in for-loops) or for closure-capture analysis. The default
      // Lua backend maps all three (let/const/var) to `local`.
      const init = stmt.init ? lowerExpr(stmt.init, ctx) : undefined;
      if (stmt.exported && init !== undefined) {
        // `export const x = init;` → `____exports.x = init` (no local binding).
        return [lua.createAssignmentStatement(exportsFieldAccess(stmt.name), init)];
      }
      // `let x;` / `var x;` (no init) → `local x` (Lua initializes to nil).
      return [lua.createVariableDeclarationStatement(lua.createIdentifier(stmt.name), init)];
    }

    case "VariableDestructuring":
      return lowerArrayDestructuring(stmt, ctx);

    case "FunctionDeclaration": {
      const params = stmt.params.map((p) => lua.createIdentifier(p.name));
      const body = lua.createBlock(stmt.body.flatMap((s) => lowerStmt(s, ctx)));
      const fn = lua.createFunctionExpression(body, params, undefined, lua.NodeFlags.Declaration);
      if (stmt.exported) {
        // `export function X(...) {...}` → `function ____exports.X(...) ... end`.
        // The Lua printer detects FunctionDefinition + Declaration flag and
        // emits the function-decl syntax instead of the assignment form.
        return [lua.createAssignmentStatement(exportsFieldAccess(stmt.name), fn)];
      }
      return [lua.createVariableDeclarationStatement(lua.createIdentifier(stmt.name), fn)];
    }

    case "IfStatement": {
      const thenBlock = lua.createBlock(stmt.consequent.flatMap((s) => lowerStmt(s, ctx)));
      const elseBlock = stmt.alternate !== undefined ? lowerElse(stmt.alternate, ctx) : undefined;
      return [lua.createIfStatement(lowerExpr(stmt.cond, ctx), thenBlock, elseBlock)];
    }

    case "ReturnStatement":
      return [lua.createReturnStatement(stmt.value ? [lowerExpr(stmt.value, ctx)] : [])];

    case "ExpressionStatement":
      return [lua.createExpressionStatement(lowerExpr(stmt.expr, ctx))];
  }
}

function lowerArrayDestructuring(
  stmt: Stmt & { kind: "VariableDestructuring" },
  ctx: LowerCtx,
): lua.Statement[] {
  const lefts = stmt.pattern.elements.map((el) => lua.createIdentifier(el.name));
  const count = stmt.pattern.elements.length;

  // Optimization: literal source → inline multi-assign. Target-independent
  // because Lua's `local a, b = e1, e2` works on every version.
  if (stmt.init.kind === "ArrayLiteralExpression") {
    const rights = stmt.init.elements.map((e) => lowerExpr(e, ctx));
    if (stmt.exported) {
      // `export const [a, b] = [1, 2]` → `____exports.a, ____exports.b = 1, 2`
      return [
        lua.createAssignmentStatement(
          stmt.pattern.elements.map((el) => exportsFieldAccess(el.name)),
          rights,
        ),
      ];
    }
    return [lua.createVariableDeclarationStatement(lefts, rights)];
  }

  // Non-literal source: dispatch on target's unpack capability.
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

// Lua's IfStatement recursively nests elseif: `elseBlock?: Block | IfStatement`.
// If our else is exactly one `if` statement AND it lowers to exactly one Lua
// IfStatement, emit as `elseif` by passing the nested IfStatement directly.
// Otherwise emit as `else` block.
function lowerElse(stmts: Stmt[], ctx: LowerCtx): lua.Block | lua.IfStatement {
  if (stmts.length === 1 && stmts[0]!.kind === "IfStatement") {
    const lowered = lowerStmt(stmts[0]!, ctx);
    if (lowered.length === 1 && lua.isIfStatement(lowered[0]!)) {
      return lowered[0]!;
    }
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
      return lua.createIdentifier(expr.name);
    case "Addition": {
      const op =
        expr.mode === "concat" ? lua.SyntaxKind.ConcatOperator : lua.SyntaxKind.AdditionOperator;
      return lua.createBinaryExpression(lowerExpr(expr.left, ctx), lowerExpr(expr.right, ctx), op);
    }
    case "Arithmetic": {
      // DIV-MOD-001: `%` emits Lua's `%`, which has sign-of-divisor semantics
      // (vs ES's sign-of-dividend). Faithful emit would require a runtime
      // helper (__TS__Mod in TSTL). TSTL default accepts the divergence.
      const op = arithmeticLuaOp(expr.op);
      return lua.createBinaryExpression(lowerExpr(expr.left, ctx), lowerExpr(expr.right, ctx), op);
    }
    case "Comparison": {
      const op = comparisonLuaOp(expr.op);
      return lua.createBinaryExpression(lowerExpr(expr.left, ctx), lowerExpr(expr.right, ctx), op);
    }
    case "LogicalExpression": {
      // Lua `and`/`or` short-circuit identically to ES. Truthiness rules
      // differ (DIV-TRUTH-001 pending). Default backend lowers directly.
      const op = expr.op === "&&" ? lua.SyntaxKind.AndOperator : lua.SyntaxKind.OrOperator;
      return lua.createBinaryExpression(lowerExpr(expr.left, ctx), lowerExpr(expr.right, ctx), op);
    }
    case "UnaryExpression":
      return lua.createUnaryExpression(
        lowerExpr(expr.operand, ctx),
        lua.SyntaxKind.NegationOperator,
      );
    case "Equality": {
      // DIV-EQ-001: `strict` is ignored in tstl-compat; both ==/=== → Lua `==`.
      const op = expr.negated ? lua.SyntaxKind.InequalityOperator : lua.SyntaxKind.EqualityOperator;
      return lua.createBinaryExpression(lowerExpr(expr.left, ctx), lowerExpr(expr.right, ctx), op);
    }
    case "CallExpression":
      return lua.createCallExpression(
        lowerExpr(expr.callee, ctx),
        expr.args.map((a) => lowerExpr(a, ctx)),
      );

    case "ArrayLiteralExpression": {
      const fields = expr.elements.map((el) => lua.createTableFieldExpression(lowerExpr(el, ctx)));
      return lua.createTableExpression(fields);
    }

    case "PropertyAccessExpression":
      return lua.createTableIndexExpression(
        lowerExpr(expr.receiver, ctx),
        lua.createStringLiteral(expr.name),
      );

    case "ArrayLength":
      return lowerArrayLength(ctx.target, lowerExpr(expr.array, ctx));

    case "ConditionalExpression": {
      // Default Lua backend emits an IIFE: always correct, ignores both the
      // `cond and a or b` optimization (broken when `a` is falsy) and the
      // hoisted-temp optimization (requires preceding-statements machinery).
      // A Luau backend would emit `if cond then a else b` natively (capability
      // not yet modeled).
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

    case "ArrowFunction": {
      // Arrow functions in Lua are anonymous function expressions. `this`
      // binding semantics differ from `function` declarations in ES, but
      // Lua doesn't have lexical `this`/`self` capture either way; it's a
      // future divergence to address when classes / methods land.
      const params = expr.params.map((p) => lua.createIdentifier(p.name));
      const body = lua.createBlock(expr.body.flatMap((s) => lowerStmt(s, ctx)));
      return lua.createFunctionExpression(body, params);
    }

    case "ArrayIndex": {
      // DIV-ARR-INDEX-001: ES arrays are 0-based, Lua tables are 1-based.
      // Adjust by +1. Constant-fold when the index is a numeric literal so
      // output matches TSTL byte-for-byte.
      const array = lowerExpr(expr.array, ctx);
      const index = lowerExpr(expr.index, ctx);
      return lua.createTableIndexExpression(array, adjustIndex(index));
    }

    case "ElementAccessExpression":
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
