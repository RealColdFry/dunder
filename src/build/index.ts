// IR build pass: ResolvedAst → ANF-shaped IR. Pure synchronous transformation;
// no checker calls, no IPC. Reads cached type info from the resolve pass.
// Side-effecting expressions are hoisted into explicit IR statements with
// synthetic temporaries (`%`-prefixed names) so backends only see a flat IR.

import {
  isArrayBindingPattern,
  isArrayLiteralExpression,
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isBreakStatement,
  isCallExpression,
  isConditionalExpression,
  isContinueStatement,
  isElementAccessExpression,
  isExpressionStatement,
  isForStatement,
  isFunctionDeclaration,
  isIdentifier,
  isIfStatement,
  isNumericLiteral,
  isParenthesizedExpression,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isReturnStatement,
  isStringLiteral,
  isVariableStatement,
  ModifierFlags,
  NodeFlags,
  SyntaxKind,
  type ElementAccessExpression,
  type Node,
  type PropertyAccessExpression,
} from "@typescript/native-preview/ast";
import { type ResolvedAst } from "../frontend.ts";
import {
  ir,
  type ArrayPatternElement,
  type BindingKind,
  type Expr,
  type Module,
  type Parameter,
  type Stmt,
} from "../ir/types.ts";
import {
  addPrecedingStmt,
  anyHasSideEffect,
  astIsLiteral,
  flushPrecedingStmts,
  hasPendingPreceding,
  popPrecedingScope,
  pushPrecedingScope,
  updateAssign,
  withPrecedingScope,
  type BuildCtx,
} from "./anf.ts";
import { buildFor } from "./loops/for.ts";

export function buildModule(resolved: ResolvedAst): Module {
  let counter = 0;
  const ctx: BuildCtx = {
    resolved,
    precedingStmtsStack: [[]],
    freshName: (p) => `%${p}_${counter++}`,
  };
  const body: Stmt[] = [];
  resolved.sourceFile.forEachChild((child) => {
    body.push(...buildStmt(child, ctx));
  });
  if (hasPendingPreceding(ctx)) {
    throw new Error("dangling preceding statements at module top level");
  }
  popPrecedingScope(ctx);
  if (ctx.precedingStmtsStack.length !== 0) {
    throw new Error("preceding-stmts stack not drained at module exit");
  }
  return ir.createModule(body);
}

function buildScope(stmtNodes: readonly Node[], ctx: BuildCtx): Stmt[] {
  pushPrecedingScope(ctx);
  const out: Stmt[] = [];
  for (const s of stmtNodes) out.push(...buildStmt(s, ctx));
  if (hasPendingPreceding(ctx)) {
    throw new Error("dangling preceding statements at end of block scope");
  }
  popPrecedingScope(ctx);
  return out;
}

export function buildScopedBranch(node: Node, ctx: BuildCtx): Stmt[] {
  if (isBlock(node)) {
    return buildScope(node.statements as unknown as readonly Node[], ctx);
  }
  return buildScope([node], ctx);
}

function buildStmt(node: Node, ctx: BuildCtx): Stmt[] {
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

  if (isFunctionDeclaration(node)) {
    if (!node.name) throw new Error("anonymous function declarations not supported");
    if (!node.body || !isBlock(node.body))
      throw new Error("function declaration missing body block");
    const params: Parameter[] = [];
    for (const p of node.parameters) {
      if (!isIdentifier(p.name)) throw new Error("destructured parameters not supported");
      params.push({ name: p.name.text });
    }
    const body = buildScope(node.body.statements as unknown as readonly Node[], ctx);
    return [
      ir.createFunDecl({
        name: node.name.text,
        params,
        body,
        exported: hasExportModifier(node),
      }),
    ];
  }

  if (isIfStatement(node)) return buildIf(node, ctx);

  if (isForStatement(node)) return buildFor(node, ctx);

  if (isReturnStatement(node)) {
    const value = node.expression ? buildExpr(node.expression, ctx) : undefined;
    const flushed = flushPrecedingStmts(ctx);
    return [...flushed, ir.createReturn(value)];
  }

  if (isBreakStatement(node)) {
    if (node.label) throw new Error("labeled break not supported yet");
    return [ir.createBreak()];
  }

  if (isContinueStatement(node)) {
    if (node.label) throw new Error("labeled continue not supported yet");
    return [ir.createContinue()];
  }

  if (isExpressionStatement(node)) return buildExprAsStmt(node.expression, ctx);

  return [];
}

export function buildExprAsStmt(node: Node, ctx: BuildCtx): Stmt[] {
  if (isPrefixUnaryExpression(node) || isPostfixUnaryExpression(node)) {
    if (
      node.operator === SyntaxKind.PlusPlusToken ||
      node.operator === SyntaxKind.MinusMinusToken
    ) {
      const target = buildExpr(node.operand, ctx);
      const flushed = flushPrecedingStmts(ctx);
      const op = node.operator === SyntaxKind.PlusPlusToken ? "++" : "--";
      return [...flushed, updateAssign(target, op)];
    }
  }
  if (isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.EqualsToken) {
    const target = buildExpr(node.left, ctx);
    const value = buildExpr(node.right, ctx);
    const flushed = flushPrecedingStmts(ctx);
    return [...flushed, ir.createAssign(target, value)];
  }
  const expr = buildExpr(node, ctx);
  const flushed = flushPrecedingStmts(ctx);
  return [...flushed, ir.createExprStmt(expr)];
}

function buildVariableDeclaration(
  decl: { name: Node; initializer?: Node },
  bindingKind: BindingKind,
  exported: boolean,
  ctx: BuildCtx,
): Stmt[] {
  if (isArrayBindingPattern(decl.name)) {
    if (!decl.initializer) {
      throw new Error("array destructuring without initializer is not legal TS");
    }
    const elements: ArrayPatternElement[] = [];
    for (const el of decl.name.elements) {
      if (el.dotDotDotToken) throw new Error("rest element in destructuring not supported yet");
      if (el.initializer) throw new Error("default value in destructuring not supported yet");
      if (!el.name || !isIdentifier(el.name)) {
        throw new Error("nested or computed-name destructuring not supported yet");
      }
      elements.push(ir.createArrPatElem(el.name.text));
    }
    const init = buildExpr(decl.initializer, ctx);
    const flushed = flushPrecedingStmts(ctx);
    return [
      ...flushed,
      ir.createDestructure({
        bindingKind,
        pattern: ir.createArrPat(elements),
        init,
        exported,
      }),
    ];
  }

  if (!isIdentifier(decl.name)) throw new Error("object destructuring not supported yet");

  const init = decl.initializer ? buildExpr(decl.initializer, ctx) : undefined;
  const flushed = flushPrecedingStmts(ctx);
  return [
    ...flushed,
    ir.createVarDecl({ bindingKind, name: decl.name.text, init, exported }),
  ];
}

function buildIf(
  node: Node & { expression: Node; thenStatement: Node; elseStatement?: Node },
  ctx: BuildCtx,
): Stmt[] {
  const cond = ir.createEsTruthy(buildExpr(node.expression, ctx));
  const flushed = flushPrecedingStmts(ctx);
  const consequent = buildScopedBranch(node.thenStatement, ctx);
  const alternate = node.elseStatement ? buildScopedBranch(node.elseStatement, ctx) : undefined;
  return [...flushed, ir.createIf(cond, consequent, alternate)];
}

export function buildExpr(node: Node, ctx: BuildCtx): Expr {
  if (isNumericLiteral(node)) return ir.createNumericLiteral(Number(node.text));
  if (isStringLiteral(node)) return ir.createStringLiteral(node.text);
  if (node.kind === SyntaxKind.TrueKeyword) return ir.createBooleanLiteral(true);
  if (node.kind === SyntaxKind.FalseKeyword) return ir.createBooleanLiteral(false);
  if (node.kind === SyntaxKind.NullKeyword) return ir.createNullLiteral();
  if (isIdentifier(node)) return ir.createIdentifier(node.text);

  if (isParenthesizedExpression(node)) return buildExpr(node.expression, ctx);

  if (isPrefixUnaryExpression(node)) {
    if (node.operator === SyntaxKind.MinusToken) {
      return ir.createUnaryExpression("-", buildExpr(node.operand, ctx));
    }
    if (node.operator === SyntaxKind.ExclamationToken) {
      return ir.createEsLogicalNot(ir.createEsTruthy(buildExpr(node.operand, ctx)));
    }
    if (
      node.operator === SyntaxKind.PlusPlusToken ||
      node.operator === SyntaxKind.MinusMinusToken
    ) {
      const target = buildExpr(node.operand, ctx);
      const op = node.operator === SyntaxKind.PlusPlusToken ? "++" : "--";
      addPrecedingStmt(ctx, updateAssign(target, op));
      return target;
    }
    throw new Error(`unsupported prefix unary operator: ${SyntaxKind[node.operator]}`);
  }

  if (isPostfixUnaryExpression(node)) {
    if (
      node.operator === SyntaxKind.PlusPlusToken ||
      node.operator === SyntaxKind.MinusMinusToken
    ) {
      // Postfix: capture pre-update value into a temp, then hoist the assign.
      const target = buildExpr(node.operand, ctx);
      const op = node.operator === SyntaxKind.PlusPlusToken ? "++" : "--";
      const tmp = ctx.freshName("postfix");
      addPrecedingStmt(ctx, [
        ir.createVarDecl({ bindingKind: "let", name: tmp, init: target }),
        updateAssign(target, op),
      ]);
      return ir.createIdentifier(tmp);
    }
    throw new Error(`unsupported postfix unary operator: ${SyntaxKind[node.operator]}`);
  }

  if (isArrayLiteralExpression(node)) {
    // Spread to a real array; raw slice/index on the RemoteNodeList trips IPC.
    const elements = buildOrderedExprs([...node.elements] as Node[], ctx, "arr_index");
    return ir.createArrayLit(elements);
  }

  if (isPropertyAccessExpression(node)) return buildPropertyAccess(node, ctx);
  if (isElementAccessExpression(node)) return buildElementAccess(node, ctx);

  if (isCallExpression(node)) {
    const all = [node.expression, ...node.arguments];
    const lowered = buildOrderedExprs(all, ctx, "call_arg");
    return ir.createCall(lowered[0]!, lowered.slice(1));
  }

  if (isArrowFunction(node)) {
    const params: Parameter[] = [];
    for (const p of node.parameters) {
      if (!isIdentifier(p.name)) throw new Error("destructured arrow params not supported");
      params.push({ name: p.name.text });
    }
    let body: Stmt[];
    if (isBlock(node.body)) {
      body = buildScope(node.body.statements as unknown as readonly Node[], ctx);
    } else {
      // Concise body: preceding stmts from the body land inside the arrow.
      const { preceding, result } = withPrecedingScope(ctx, () =>
        buildExpr(node.body, ctx),
      );
      body = [...preceding, ir.createReturn(result)];
    }
    return ir.createArrowFun(params, body);
  }

  if (isConditionalExpression(node)) {
    const cond = ir.createEsTruthy(buildExpr(node.condition, ctx));
    if (hasPendingPreceding(ctx)) {
      throw new Error("conditional cond with side-effecting subexpression is not lowered yet");
    }
    const whenTrue = buildExpr(node.whenTrue, ctx);
    if (hasPendingPreceding(ctx)) {
      throw new Error("conditional whenTrue with side-effecting subexpression is not lowered yet");
    }
    const whenFalse = buildExpr(node.whenFalse, ctx);
    if (hasPendingPreceding(ctx)) {
      throw new Error("conditional whenFalse with side-effecting subexpression is not lowered yet");
    }
    return ir.createEsConditional(cond, whenTrue, whenFalse);
  }

  if (isBinaryExpression(node)) {
    const opKind = node.operatorToken.kind;

    if (opKind === SyntaxKind.EqualsToken) {
      const target = buildExpr(node.left, ctx);
      const value = buildExpr(node.right, ctx);
      addPrecedingStmt(ctx, ir.createAssign(target, value));
      return target;
    }

    if (opKind === SyntaxKind.PlusToken) {
      const stringy =
        (ctx.resolved.isStringyByNode.get(node.left) ?? false) ||
        (ctx.resolved.isStringyByNode.get(node.right) ?? false);
      const left = buildExpr(node.left, ctx);
      const right = buildExpr(node.right, ctx);
      return stringy ? ir.createEsStringConcat(left, right) : ir.createEsNumericAdd(left, right);
    }

    const arith = arithmeticOpFromToken(opKind);
    if (arith !== undefined) {
      return ir.createArithmetic(arith, buildExpr(node.left, ctx), buildExpr(node.right, ctx));
    }

    const cmp = comparisonOpFromToken(opKind);
    if (cmp !== undefined) {
      return ir.createComparison(cmp, buildExpr(node.left, ctx), buildExpr(node.right, ctx));
    }

    if (
      opKind === SyntaxKind.AmpersandAmpersandToken ||
      opKind === SyntaxKind.BarBarToken
    ) {
      const left = buildExpr(node.left, ctx);
      const right = buildExpr(node.right, ctx);
      if (hasPendingPreceding(ctx)) {
        // Hoisting right's side effects would break short-circuit; deferred.
        throw new Error("short-circuit operand with side effects is not lowered yet");
      }
      const op = opKind === SyntaxKind.AmpersandAmpersandToken ? "&&" : "||";
      return ir.createEsLogicalExpression(op, left, right);
    }

    if (opKind === SyntaxKind.EqualsEqualsToken) return equality(false, false, node, ctx);
    if (opKind === SyntaxKind.EqualsEqualsEqualsToken) return equality(true, false, node, ctx);
    if (opKind === SyntaxKind.ExclamationEqualsToken) return equality(false, true, node, ctx);
    if (opKind === SyntaxKind.ExclamationEqualsEqualsToken) return equality(true, true, node, ctx);
  }

  throw new Error(`unsupported expression kind: ${SyntaxKind[node.kind]}`);
}

// If any later sibling has an observable side effect, hoist this element to a
// synthetic temp so source-order evaluation is preserved. Pure literals are
// not hoisted (no value to race against).
function buildOrderedExprs(
  astNodes: readonly Node[],
  ctx: BuildCtx,
  tempPrefix: string,
): Expr[] {
  const out: Expr[] = [];
  for (let i = 0; i < astNodes.length; i++) {
    const el = astNodes[i]!;
    const laterHasEffect = anyHasSideEffect(astNodes.slice(i + 1));
    const value = buildExpr(el, ctx);
    if (laterHasEffect && !astIsLiteral(el)) {
      const t = ctx.freshName(tempPrefix);
      addPrecedingStmt(ctx, ir.createVarDecl({ bindingKind: "let", name: t, init: value }));
      out.push(ir.createIdentifier(t));
    } else {
      out.push(value);
    }
  }
  return out;
}

function buildPropertyAccess(node: PropertyAccessExpression, ctx: BuildCtx): Expr {
  const receiver = buildExpr(node.expression, ctx);
  const name = node.name.text;
  if (name === "length" && (ctx.resolved.isArrayLikeByNode.get(node.expression) ?? false)) {
    return ir.createEsArrayLength(receiver);
  }
  return ir.createPropertyAccess(receiver, name);
}

function buildElementAccess(node: ElementAccessExpression, ctx: BuildCtx): Expr {
  const receiver = buildExpr(node.expression, ctx);
  const index = buildExpr(node.argumentExpression, ctx);
  if (ctx.resolved.isArrayLikeByNode.get(node.expression) ?? false) {
    return ir.createEsIndex(receiver, index);
  }
  return ir.createElementAccess(receiver, index);
}

function equality(
  strict: boolean,
  negated: boolean,
  node: Node & { left: Node; right: Node },
  ctx: BuildCtx,
): Expr {
  return ir.createEsEquality({
    strict,
    negated,
    left: buildExpr(node.left, ctx),
    right: buildExpr(node.right, ctx),
  });
}

function hasExportModifier(node: Node): boolean {
  const flags = (node as unknown as { modifierFlags?: number }).modifierFlags ?? 0;
  return (flags & ModifierFlags.Export) !== 0;
}

function isAmbient(node: Node): boolean {
  const flags = (node as unknown as { modifierFlags?: number }).modifierFlags ?? 0;
  return (flags & ModifierFlags.Ambient) !== 0;
}

function arithmeticOpFromToken(kind: SyntaxKind): "-" | "*" | "/" | "%" | "**" | undefined {
  switch (kind) {
    case SyntaxKind.MinusToken:
      return "-";
    case SyntaxKind.AsteriskToken:
      return "*";
    case SyntaxKind.SlashToken:
      return "/";
    case SyntaxKind.PercentToken:
      return "%";
    case SyntaxKind.AsteriskAsteriskToken:
      return "**";
    default:
      return undefined;
  }
}

function comparisonOpFromToken(kind: SyntaxKind): "<" | ">" | "<=" | ">=" | undefined {
  switch (kind) {
    case SyntaxKind.LessThanToken:
      return "<";
    case SyntaxKind.GreaterThanToken:
      return ">";
    case SyntaxKind.LessThanEqualsToken:
      return "<=";
    case SyntaxKind.GreaterThanEqualsToken:
      return ">=";
    default:
      return undefined;
  }
}
