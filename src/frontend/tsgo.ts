import { SymbolFlags, type Checker } from "@typescript/native-preview/async";
import {
  isBinaryExpression,
  isElementAccessExpression,
  isIdentifier,
  isPropertyAccessExpression,
  isShorthandPropertyAssignment,
  SyntaxKind,
  type Identifier,
  type Node,
  type SourceFile,
} from "@typescript/native-preview/ast";
import { GLOBAL_NAMES, type ResolvedAst } from "./index.ts";
import { computeIsArrayLike, computeIsStringy } from "./typeshape-tsgo.ts";

export async function resolve(sourceFile: SourceFile, checker: Checker): Promise<ResolvedAst> {
  const plusOperands: Node[] = [];
  const accessReceivers: Node[] = [];
  const candidateGlobalIds: Identifier[] = [];
  const globalNameSet = new Set<string>(GLOBAL_NAMES);
  const visit = (node: Node): void => {
    if (
      isBinaryExpression(node) &&
      (node.operatorToken.kind === SyntaxKind.PlusToken ||
        node.operatorToken.kind === SyntaxKind.PlusEqualsToken)
    ) {
      plusOperands.push(node.left, node.right);
    }
    if (isPropertyAccessExpression(node) || isElementAccessExpression(node)) {
      accessReceivers.push(node.expression);
    }
    if (isIdentifier(node) && globalNameSet.has(node.text)) {
      candidateGlobalIds.push(node);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);

  const allOperands = [...plusOperands, ...accessReceivers];
  const types = allOperands.length === 0 ? [] : await checker.getTypeAtLocation(allOperands);
  const plusTypes = types.slice(0, plusOperands.length);
  const accessTypes = types.slice(plusOperands.length);

  const [stringyResults, arrayLikeResults] = await Promise.all([
    Promise.all(plusTypes.map((t) => computeIsStringy(t))),
    Promise.all(accessTypes.map((t) => computeIsArrayLike(t, checker))),
  ]);
  const isStringyByNode = new Map<Node, boolean>();
  plusOperands.forEach((n, i) => isStringyByNode.set(n, stringyResults[i] ?? false));
  const isArrayLikeByNode = new Map<Node, boolean>();
  accessReceivers.forEach((n, i) => isArrayLikeByNode.set(n, arrayLikeResults[i] ?? false));

  // truthyAgreesWithLuaByNode: not yet populated on the tsgo path. The
  // precise predicate needs `getBaseConstraintOfType` for generics, which
  // isn't exposed over IPC today (see issue-3610, top of the gap list).
  // Until the fork patch lands, leave the map empty so callers fall
  // through to the conservative `es.Truthy` wrap.
  const truthyAgreesWithLuaByNode = new Map<Node, boolean>();

  // Globals: resolve each ambient lib symbol once, then per-candidate compare
  // the local symbol. Shorthand property identifiers need the value-side
  // symbol via a dedicated API; everything else batches through
  // getSymbolAtLocation.
  const regularCandidates: Identifier[] = [];
  const shorthandCandidates: Identifier[] = [];
  for (const id of candidateGlobalIds) {
    if (id.parent && isShorthandPropertyAssignment(id.parent) && id.parent.name === id) {
      shorthandCandidates.push(id);
    } else {
      regularCandidates.push(id);
    }
  }
  const [globalSymsArr, regularSymsArr, shorthandSymsArr] = await Promise.all([
    Promise.all(
      GLOBAL_NAMES.map((name) => checker.resolveName(name, SymbolFlags.Value, undefined, false)),
    ),
    regularCandidates.length === 0
      ? Promise.resolve([])
      : checker.getSymbolAtLocation(regularCandidates),
    Promise.all(
      shorthandCandidates.map((id) => checker.getShorthandAssignmentValueSymbol(id.parent)),
    ),
  ]);
  const globalSymbols = new Map<string, unknown>();
  GLOBAL_NAMES.forEach((name, i) => {
    const sym = globalSymsArr[i];
    if (sym) globalSymbols.set(name, sym);
  });
  const globalNameByNode = new Map<Node, string>();
  regularCandidates.forEach((id, i) => {
    const target = globalSymbols.get(id.text);
    if (target && regularSymsArr[i] === target) globalNameByNode.set(id, id.text);
  });
  shorthandCandidates.forEach((id, i) => {
    const target = globalSymbols.get(id.text);
    if (target && shorthandSymsArr[i] === target) globalNameByNode.set(id, id.text);
  });

  return {
    sourceFile,
    isStringyByNode,
    isArrayLikeByNode,
    truthyAgreesWithLuaByNode,
    globalNameByNode,
  } as unknown as ResolvedAst;
}
