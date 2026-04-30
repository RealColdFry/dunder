import * as ts from "typescript";
import { GLOBAL_NAMES, type ResolvedAst } from "./index.ts";
import {
  computeIsArrayLike,
  computeIsStringy,
  computeTruthyAgreesWithLua,
} from "./typeshape-tsc.ts";

export function resolve(sourceFile: ts.SourceFile, checker: ts.TypeChecker): ResolvedAst {
  const plusOperands: ts.Node[] = [];
  const accessReceivers: ts.Node[] = [];
  const truthyContexts: ts.Node[] = [];
  const candidateGlobalIds: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
        node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)
    ) {
      plusOperands.push(node.left, node.right);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      accessReceivers.push(node.expression);
    }
    if (ts.isIdentifier(node) && (GLOBAL_NAMES as readonly string[]).includes(node.text)) {
      candidateGlobalIds.push(node);
    }
    collectTruthyContexts(node, truthyContexts);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  const isStringyByNode = new Map<ts.Node, boolean>();
  for (const n of plusOperands) {
    isStringyByNode.set(n, computeIsStringy(checker.getTypeAtLocation(n)));
  }
  const isArrayLikeByNode = new Map<ts.Node, boolean>();
  for (const n of accessReceivers) {
    isArrayLikeByNode.set(n, computeIsArrayLike(checker.getTypeAtLocation(n), checker));
  }
  const truthyAgreesWithLuaByNode = new Map<ts.Node, boolean>();
  for (const n of truthyContexts) {
    truthyAgreesWithLuaByNode.set(
      n,
      computeTruthyAgreesWithLua(checker.getTypeAtLocation(n), checker),
    );
  }

  // Resolve each candidate identifier's symbol and compare against the
  // ambient lib's global symbol of the same name. This makes the check
  // shadow-safe: a user `const NaN = 1` resolves to a different symbol and
  // is not tagged.
  const globalNameByNode = new Map<ts.Node, string>();
  // `resolveName` is internal but stable; TSTL and roblox-ts both rely on it.
  const checkerInternal = checker as unknown as {
    resolveName: (
      name: string,
      location: ts.Node | undefined,
      meaning: ts.SymbolFlags,
      excludeGlobals: boolean,
    ) => ts.Symbol | undefined;
  };
  const globalSymbols = new Map<string, ts.Symbol>();
  for (const name of GLOBAL_NAMES) {
    const sym = checkerInternal.resolveName(name, undefined, ts.SymbolFlags.Value, false);
    if (sym) globalSymbols.set(name, sym);
  }
  for (const id of candidateGlobalIds) {
    const target = globalSymbols.get(id.text);
    if (!target) continue;
    // Shorthand property identifiers (`{NaN}`) act as both key and value;
    // getSymbolAtLocation returns the property-side symbol, so we have to
    // ask for the value-side one explicitly.
    const local =
      ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
        ? checker.getShorthandAssignmentValueSymbol(id.parent)
        : checker.getSymbolAtLocation(id);
    if (local === target) globalNameByNode.set(id, id.text);
  }

  return {
    sourceFile,
    isStringyByNode,
    isArrayLikeByNode,
    truthyAgreesWithLuaByNode,
    globalNameByNode,
  } as unknown as ResolvedAst;
}

// Syntactic positions where dunder coerces to ES truthy. Mirrors the
// trigger sites in `truthy-only-condition.ts` plus the operator positions
// (`!`, `&&`, `||`).
function collectTruthyContexts(node: ts.Node, out: ts.Node[]): void {
  if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    out.push(node.expression);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    out.push(node.condition);
    return;
  }
  if (ts.isForStatement(node) && node.condition) {
    out.push(node.condition);
    return;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    out.push(node.operand);
    return;
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    out.push(node.left, node.right);
  }
}
