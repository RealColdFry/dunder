// Dispatchers for buildExpr / buildStmt / buildScopedBranch. Trivial leaves
// (literals, identifier, parens) are inlined here; non-trivial node kinds
// each live in a sibling file and are invoked by the switch.

import {
  isArrayLiteralExpression,
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isBreakStatement,
  isCallExpression,
  isConditionalExpression,
  isContinueStatement,
  isDoStatement,
  isElementAccessExpression,
  isExpressionStatement,
  isForStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isReturnStatement,
  isStringLiteral,
  isVariableStatement,
  isWhileStatement,
  NodeFlags,
  SyntaxKind,
  type Node,
} from "#/ts.ts";
import { ir, type BindingKind, type Expr, type Stmt } from "#/ir/types.ts";
import { hasPendingPreceding, popPrecedingScope, pushPrecedingScope } from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";
import { hasExportModifier, isAmbient } from "#/build/modifiers.ts";
import { buildElementAccess, buildPropertyAccess } from "./access.ts";
import { buildBinaryExpression } from "./binary/index.ts";
import { buildBreak, buildContinue } from "./break-continue.ts";
import { buildCall } from "./call.ts";
import { buildConditional, buildIf } from "./conditional.ts";
import {
  buildArrowFunction,
  buildFunctionDeclaration,
  buildFunctionExpression,
} from "./function.ts";
import { buildArrayLiteral, buildObjectLiteral } from "./literal.ts";
import { buildFor } from "./loops/for.ts";
import { buildDoWhile, buildWhile } from "./loops/while.ts";
import { buildReturn } from "./return.ts";
import { buildPostfixUnary, buildPrefixUnary } from "./unary.ts";
import { buildVariableDeclaration } from "./variable-declaration.ts";

export function buildScopedBranch(node: Node, ctx: BuildCtx): Stmt[] {
  if (isBlock(node)) {
    return buildScope(node.statements as unknown as readonly Node[], ctx);
  }
  return buildScope([node], ctx);
}

function buildScope(stmtNodes: readonly Node[], ctx: BuildCtx): Stmt[] {
  pushPrecedingScope(ctx);
  const out: Stmt[] = [];
  for (const s of stmtNodes) out.push(...ctx.buildStmt(s));
  if (hasPendingPreceding(ctx)) {
    throw new Error("dangling preceding statements at end of block scope");
  }
  popPrecedingScope(ctx);
  return out;
}

export function buildStmt(node: Node, ctx: BuildCtx): Stmt[] {
  if (isAmbient(node)) return [];

  if (isVariableStatement(node)) {
    const listFlags = node.declarationList.flags;
    const bindingKind: BindingKind =
      (listFlags & NodeFlags.Const) !== 0
        ? "const"
        : (listFlags & NodeFlags.Let) !== 0
          ? "let"
          : "var";
    const exported = hasExportModifier(node);
    const out: Stmt[] = [];
    for (const decl of node.declarationList.declarations) {
      out.push(...buildVariableDeclaration(decl, bindingKind, exported, ctx));
    }
    return out;
  }

  if (isFunctionDeclaration(node)) return buildFunctionDeclaration(node, ctx);
  if (isIfStatement(node)) return buildIf(node, ctx);
  if (isForStatement(node)) return buildFor(node, ctx);
  if (isWhileStatement(node)) return buildWhile(node, ctx);
  if (isDoStatement(node)) return buildDoWhile(node, ctx);
  if (isReturnStatement(node)) return buildReturn(node, ctx);
  if (isBreakStatement(node)) return buildBreak(node);
  if (isContinueStatement(node)) return buildContinue(node);
  if (isExpressionStatement(node)) return ctx.buildExprAsStmt(node.expression);

  return [];
}

export function buildExpr(node: Node, ctx: BuildCtx): Expr {
  if (isNumericLiteral(node)) return ir.createNumericLiteral(Number(node.text));
  if (isStringLiteral(node)) return ir.createStringLiteral(node.text);
  if (node.kind === SyntaxKind.TrueKeyword) return ir.createBooleanLiteral(true);
  if (node.kind === SyntaxKind.FalseKeyword) return ir.createBooleanLiteral(false);
  if (node.kind === SyntaxKind.NullKeyword) return ir.createNullLiteral();
  if (isIdentifier(node)) {
    const globalName = ctx.resolved.globalNameByNode.get(node);
    if (globalName !== undefined) return ir.createEsGlobal(globalName);
    return ir.createIdentifier(node.text);
  }
  if (isParenthesizedExpression(node)) return ctx.buildExpr(node.expression);

  if (isPrefixUnaryExpression(node)) return buildPrefixUnary(node, ctx);
  if (isPostfixUnaryExpression(node)) return buildPostfixUnary(node, ctx);
  if (isArrayLiteralExpression(node)) return buildArrayLiteral(node, ctx);
  if (isObjectLiteralExpression(node)) return buildObjectLiteral(node, ctx);
  if (isPropertyAccessExpression(node)) return buildPropertyAccess(node, ctx);
  if (isElementAccessExpression(node)) return buildElementAccess(node, ctx);
  if (isCallExpression(node)) return buildCall(node, ctx);
  if (isArrowFunction(node)) return buildArrowFunction(node, ctx);
  if (isFunctionExpression(node)) return buildFunctionExpression(node, ctx);
  if (isConditionalExpression(node)) return buildConditional(node, ctx);
  if (isBinaryExpression(node)) return buildBinaryExpression(node, ctx);

  throw new Error(`unsupported expression kind: ${SyntaxKind[node.kind]}`);
}
