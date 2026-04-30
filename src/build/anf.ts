import {
  isBinaryExpression,
  isCallExpression,
  isNumericLiteral,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isStringLiteral,
  SyntaxKind,
  type Node,
} from "#/ts.ts";
import { ir, type Expr, type Stmt } from "#/ir/types.ts";
import { type BuildCtx } from "./context.ts";

function topFrame(ctx: BuildCtx): Stmt[] {
  const frame = ctx.precedingStmtsStack[ctx.precedingStmtsStack.length - 1];
  if (!frame) throw new Error("preceding-stmts stack is empty");
  return frame;
}

export function addPrecedingStmt(ctx: BuildCtx, stmt: Stmt | Stmt[]): void {
  const frame = topFrame(ctx);
  if (Array.isArray(stmt)) frame.push(...stmt);
  else frame.push(stmt);
}

export function hasPendingPreceding(ctx: BuildCtx): boolean {
  return topFrame(ctx).length > 0;
}

export function flushPrecedingStmts(ctx: BuildCtx): Stmt[] {
  const i = ctx.precedingStmtsStack.length - 1;
  const frame = ctx.precedingStmtsStack[i];
  if (!frame) throw new Error("preceding-stmts stack is empty");
  ctx.precedingStmtsStack[i] = [];
  return frame;
}

export function pushPrecedingScope(ctx: BuildCtx): void {
  ctx.precedingStmtsStack.push([]);
}

export function popPrecedingScope(ctx: BuildCtx): Stmt[] {
  const popped = ctx.precedingStmtsStack.pop();
  if (!popped) throw new Error("popPrecedingScope on empty stack");
  return popped;
}

export function withPrecedingScope<T>(
  ctx: BuildCtx,
  fn: () => T,
): {
  preceding: Stmt[];
  result: T;
} {
  pushPrecedingScope(ctx);
  const result = fn();
  const preceding = popPrecedingScope(ctx);
  return {
    preceding,
    result,
  };
}

export function updateAssign(target: Expr, op: "++" | "--"): Stmt {
  const one = ir.createNumericLiteral(1);
  const value: Expr =
    op === "++" ? ir.createEsNumericAdd(target, one) : ir.createArithmetic("-", target, one);
  return ir.createAssign(target, value);
}

// Conservative-correct: prefer false positives (over-hoist) to false negatives
// (lose evaluation order).
export function astHasSideEffect(node: Node): boolean {
  if (isCallExpression(node)) return true;
  if (isPrefixUnaryExpression(node) || isPostfixUnaryExpression(node)) {
    if (
      node.operator === SyntaxKind.PlusPlusToken ||
      node.operator === SyntaxKind.MinusMinusToken
    ) {
      return true;
    }
  }
  if (isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.EqualsToken) {
    return true;
  }
  let found = false;
  node.forEachChild((child) => {
    if (!found && astHasSideEffect(child)) found = true;
  });
  return found;
}

export function anyHasSideEffect(nodes: readonly Node[]): boolean {
  return nodes.some(astHasSideEffect);
}

export function astIsLiteral(node: Node): boolean {
  return (
    isNumericLiteral(node) ||
    isStringLiteral(node) ||
    node.kind === SyntaxKind.TrueKeyword ||
    node.kind === SyntaxKind.FalseKeyword ||
    node.kind === SyntaxKind.NullKeyword
  );
}
