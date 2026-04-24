// IR build pass: pure synchronous transformation from `ResolvedAst` to IR.
// No checker calls, no IPC. Reads cached type info via the helpers exposed
// by `frontend.ts`.
//
// Naming follows TS/ESTree tree-IR convention: PascalCase `kind`
// discriminators. Divergences from ECMAScript carry `DIV-*` IDs and are
// documented inline at the IR node that introduces them (see src/ir.ts).

import {
  isArrayBindingPattern,
  isArrayLiteralExpression,
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isConditionalExpression,
  isElementAccessExpression,
  isExpressionStatement,
  isFunctionDeclaration,
  isIdentifier,
  isIfStatement,
  isNumericLiteral,
  isParenthesizedExpression,
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
import { type ResolvedAst, type Type } from "./frontend.ts";
import { isArrayType, isStringyType } from "./typeshape.ts";
import type { ArrayPatternElement, BindingKind, Expr, Module, Parameter, Stmt } from "./ir.ts";

export function buildModule(resolved: ResolvedAst): Module {
  const body: Stmt[] = [];
  resolved.sourceFile.forEachChild((child) => {
    body.push(...buildStmt(child, resolved));
  });
  return { kind: "Module", body };
}

// Returns `Stmt[]` because some TS AST nodes produce multiple IR statements
// (multi-declarator `const a = 1, b = 2`). `[]` means "no IR emit" (e.g.
// `declare` statements). Caller flattens.
function buildStmt(node: Node, resolved: ResolvedAst): Stmt[] {
  // `declare` statements are type-only; no runtime emit.
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
      out.push(buildVariableDeclaration(decl, bindingKind, exported, resolved));
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
    const body = node.body.statements.flatMap((s) => buildStmt(s, resolved));
    return [
      {
        kind: "FunctionDeclaration",
        exported: hasExportModifier(node),
        name: node.name.text,
        params,
        body,
      },
    ];
  }

  if (isIfStatement(node)) return [buildIf(node, resolved)];

  if (isReturnStatement(node)) {
    return [
      {
        kind: "ReturnStatement",
        value: node.expression ? buildExpr(node.expression, resolved) : undefined,
      },
    ];
  }

  if (isExpressionStatement(node)) {
    return [{ kind: "ExpressionStatement", expr: buildExpr(node.expression, resolved) }];
  }

  return [];
}

// Build IR for a single `ts.VariableDeclaration` (one binding inside a
// VariableStatement's declarationList). A multi-declarator statement produces
// one of these per entry.
function buildVariableDeclaration(
  decl: { name: Node; initializer?: Node },
  bindingKind: BindingKind,
  exported: boolean,
  resolved: ResolvedAst,
): Stmt {
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
      elements.push({ kind: "Binding", name: el.name.text });
    }
    return {
      kind: "VariableDestructuring",
      bindingKind,
      exported,
      pattern: { kind: "ArrayPattern", elements },
      init: buildExpr(decl.initializer, resolved),
    };
  }

  if (!isIdentifier(decl.name)) {
    throw new Error("object destructuring not supported yet");
  }
  return {
    kind: "VariableDeclaration",
    bindingKind,
    exported,
    name: decl.name.text,
    init: decl.initializer ? buildExpr(decl.initializer, resolved) : undefined,
  };
}

function buildIf(
  node: Node & { expression: Node; thenStatement: Node; elseStatement?: Node },
  resolved: ResolvedAst,
): Stmt {
  const cond = buildExpr(node.expression, resolved);
  const consequent = flattenBlock(node.thenStatement, resolved);
  const alternate = node.elseStatement ? flattenBlock(node.elseStatement, resolved) : undefined;
  return { kind: "IfStatement", cond, consequent, alternate };
}

function flattenBlock(node: Node, resolved: ResolvedAst): Stmt[] {
  if (isBlock(node)) {
    return node.statements.flatMap((s) => buildStmt(s, resolved));
  }
  return buildStmt(node, resolved);
}

function buildExpr(node: Node, resolved: ResolvedAst): Expr {
  if (isNumericLiteral(node)) return { kind: "NumericLiteral", value: Number(node.text) };
  if (isStringLiteral(node)) return { kind: "StringLiteral", value: node.text };
  if (node.kind === SyntaxKind.TrueKeyword) return { kind: "BooleanLiteral", value: true };
  if (node.kind === SyntaxKind.FalseKeyword) return { kind: "BooleanLiteral", value: false };
  if (node.kind === SyntaxKind.NullKeyword) return { kind: "NullLiteral" };
  if (isIdentifier(node)) return { kind: "Identifier", name: node.text };

  if (isParenthesizedExpression(node)) {
    // Parens affect parsing, not semantics. Unwrap; the Lua printer will
    // add parens based on precedence when it emits.
    return buildExpr(node.expression, resolved);
  }

  if (isPrefixUnaryExpression(node)) {
    if (node.operator === SyntaxKind.MinusToken) {
      return { kind: "UnaryExpression", op: "-", operand: buildExpr(node.operand, resolved) };
    }
    // PlusToken, ExclamationToken, TildeToken, PlusPlusToken, MinusMinusToken
    // are out of scope for this unit (truthiness / bitwise / update expressions).
    throw new Error(`unsupported prefix unary operator: ${SyntaxKind[node.operator]}`);
  }

  if (isArrayLiteralExpression(node)) {
    const elements: Expr[] = [];
    for (const el of node.elements) elements.push(buildExpr(el, resolved));
    return { kind: "ArrayLiteralExpression", elements };
  }

  if (isPropertyAccessExpression(node)) return buildPropertyAccess(node, resolved);
  if (isElementAccessExpression(node)) return buildElementAccess(node, resolved);

  if (isCallExpression(node)) {
    const callee = buildExpr(node.expression, resolved);
    const args: Expr[] = [];
    for (const a of node.arguments) args.push(buildExpr(a, resolved));
    return { kind: "CallExpression", callee, args };
  }

  if (isArrowFunction(node)) {
    const params: Parameter[] = [];
    for (const p of node.parameters) {
      if (!isIdentifier(p.name)) throw new Error("destructured arrow params not supported");
      params.push({ name: p.name.text });
    }
    const body: Stmt[] = isBlock(node.body)
      ? node.body.statements.flatMap((s) => buildStmt(s, resolved))
      : // Concise body: implicit return of the expression.
        [{ kind: "ReturnStatement", value: buildExpr(node.body, resolved) }];
    return { kind: "ArrowFunction", params, body };
  }

  if (isConditionalExpression(node)) {
    return {
      kind: "ConditionalExpression",
      cond: buildExpr(node.condition, resolved),
      whenTrue: buildExpr(node.whenTrue, resolved),
      whenFalse: buildExpr(node.whenFalse, resolved),
    };
  }

  if (isBinaryExpression(node)) {
    const opKind = node.operatorToken.kind;

    if (opKind === SyntaxKind.PlusToken) {
      const tL = resolved.typeByNode.get(node.left);
      const tR = resolved.typeByNode.get(node.right);
      const stringy = isStringyType(tL) || isStringyType(tR);
      return {
        kind: "Addition",
        mode: stringy ? "concat" : "numeric",
        left: buildExpr(node.left, resolved),
        right: buildExpr(node.right, resolved),
      };
    }

    const arith = arithmeticOpFromToken(opKind);
    if (arith !== undefined) {
      return {
        kind: "Arithmetic",
        op: arith,
        left: buildExpr(node.left, resolved),
        right: buildExpr(node.right, resolved),
      };
    }

    const cmp = comparisonOpFromToken(opKind);
    if (cmp !== undefined) {
      return {
        kind: "Comparison",
        op: cmp,
        left: buildExpr(node.left, resolved),
        right: buildExpr(node.right, resolved),
      };
    }

    if (opKind === SyntaxKind.AmpersandAmpersandToken || opKind === SyntaxKind.BarBarToken) {
      return {
        kind: "LogicalExpression",
        op: opKind === SyntaxKind.AmpersandAmpersandToken ? "&&" : "||",
        left: buildExpr(node.left, resolved),
        right: buildExpr(node.right, resolved),
      };
    }

    if (opKind === SyntaxKind.EqualsEqualsToken) return equality(false, false, node, resolved);
    if (opKind === SyntaxKind.EqualsEqualsEqualsToken) return equality(true, false, node, resolved);
    if (opKind === SyntaxKind.ExclamationEqualsToken) return equality(false, true, node, resolved);
    if (opKind === SyntaxKind.ExclamationEqualsEqualsToken)
      return equality(true, true, node, resolved);
  }

  throw new Error(`unsupported expression kind: ${SyntaxKind[node.kind]}`);
}

function buildPropertyAccess(node: PropertyAccessExpression, resolved: ResolvedAst): Expr {
  const receiver = buildExpr(node.expression, resolved);
  const name = node.name.text;
  const receiverType: Type | undefined = resolved.typeByNode.get(node.expression);

  // Specialization: arr.length on an Array reference → ArrayLength IR node.
  if (name === "length" && isArrayType(receiverType, resolved)) {
    return { kind: "ArrayLength", array: receiver };
  }
  return { kind: "PropertyAccessExpression", receiver, name };
}

function buildElementAccess(node: ElementAccessExpression, resolved: ResolvedAst): Expr {
  const receiver = buildExpr(node.expression, resolved);
  const index = buildExpr(node.argumentExpression, resolved);
  const receiverType: Type | undefined = resolved.typeByNode.get(node.expression);
  if (isArrayType(receiverType, resolved)) {
    return { kind: "ArrayIndex", array: receiver, index };
  }
  return { kind: "ElementAccessExpression", receiver, index };
}

function equality(
  strict: boolean,
  negated: boolean,
  node: Node & { left: Node; right: Node },
  resolved: ResolvedAst,
): Expr {
  return {
    kind: "Equality",
    strict,
    negated,
    left: buildExpr(node.left, resolved),
    right: buildExpr(node.right, resolved),
  };
}

function hasExportModifier(node: Node): boolean {
  // ModifiersBase.modifierFlags is the bit-set of resolved modifiers; tsgo
  // keeps it in sync with the syntactic modifiers list. Using flags avoids
  // walking the modifiers array.
  const flags = (node as unknown as { modifierFlags?: number }).modifierFlags ?? 0;
  return (flags & ModifierFlags.Export) !== 0;
}

function isAmbient(node: Node): boolean {
  // `declare` modifier marks the node as type-only / ambient. Skipped in emit.
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
