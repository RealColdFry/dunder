// Arithmetic, comparison, and the type-resolved `+` split (numeric add
// vs string concat). The op-to-Lua-binop tables live here too so the
// kind cases stay small. Where target-gated `%` lowering will land
// when 5.0 (no `%` operator) gets its `math.fmod` fallback.

import type { Arithmetic, Comparison, EsNumericAdd, EsStringConcat } from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import type { LowerCtx } from "./context.ts";

export function lowerEsNumericAdd(expr: EsNumericAdd, ctx: LowerCtx): lua.Expression {
  return lua.createBinaryExpression(
    ctx.lowerExpr(expr.left),
    ctx.lowerExpr(expr.right),
    lua.SyntaxKind.AdditionOperator,
  );
}

export function lowerEsStringConcat(expr: EsStringConcat, ctx: LowerCtx): lua.Expression {
  return lua.createBinaryExpression(
    ctx.lowerExpr(expr.left),
    ctx.lowerExpr(expr.right),
    lua.SyntaxKind.ConcatOperator,
  );
}

// DIV-MOD-001: Lua's `%` is sign-of-divisor (vs ES sign-of-dividend).
// `math.fmod` / `math.mod` match ES (sign-of-dividend) but the default
// backend emits `%` on every target that has it, accepting the
// divergence to keep the emit compact.
//
// Lua 5.0 has no `%` operator at all; the `mod` capability picks the
// fn-form on those targets and emits `math.mod(a, b)` (renamed
// `math.fmod` in 5.1+). The fallback is incidentally ES-faithful.
// An ES-faithful backend on newer targets would also configure
// `mod: { kind: "fn", fn: "math.fmod" }` despite the operator being
// available.
export function lowerArithmetic(expr: Arithmetic, ctx: LowerCtx): lua.Expression {
  const left = ctx.lowerExpr(expr.left);
  const right = ctx.lowerExpr(expr.right);
  if (expr.op === "%" && ctx.target.mod.kind === "fn") {
    return lua.createCallExpression(luaMemberPath(ctx.target.mod.fn), [left, right]);
  }
  return lua.createBinaryExpression(left, right, arithmeticLuaOp(expr.op));
}

// Builds a Lua expression for a dotted reference like `math.fmod`.
// Single-segment names (no dots) become a bare identifier.
function luaMemberPath(name: string): lua.Expression {
  const parts = name.split(".");
  let head: lua.Expression = lua.createIdentifier(parts[0]!);
  for (let i = 1; i < parts.length; i++) {
    head = lua.createTableIndexExpression(head, lua.createStringLiteral(parts[i]!));
  }
  return head;
}

export function lowerComparison(expr: Comparison, ctx: LowerCtx): lua.Expression {
  const op = comparisonLuaOp(expr.op);
  return lua.createBinaryExpression(ctx.lowerExpr(expr.left), ctx.lowerExpr(expr.right), op);
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
