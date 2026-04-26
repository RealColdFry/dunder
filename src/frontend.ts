// Frontend layer: owns all tsgo IPC. Produces a `ResolvedAst` with batched
// type information. The IPC/no-IPC boundary; downstream IR construction is
// pure synchronous code over this struct.

import { type Checker, type Type } from "@typescript/native-preview/async";
import {
  isBinaryExpression,
  isElementAccessExpression,
  isPropertyAccessExpression,
  SyntaxKind,
  type Node,
  type SourceFile,
} from "@typescript/native-preview/ast";
import { computeIsArrayLike, computeIsStringy } from "./typeshape.ts";

export type { Type } from "@typescript/native-preview/async";

export interface ResolvedAst {
  sourceFile: SourceFile;
  // Populated for `+` operands and property/element-access receivers.
  typeByNode: Map<Node, Type | undefined>;
  isStringyByNode: Map<Node, boolean>;
  isArrayLikeByNode: Map<Node, boolean>;
}

export async function resolve(sourceFile: SourceFile, checker: Checker): Promise<ResolvedAst> {
  const plusOperands: Node[] = [];
  const accessReceivers: Node[] = [];
  const visit = (node: Node): void => {
    if (isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.PlusToken) {
      plusOperands.push(node.left, node.right);
    }
    if (isPropertyAccessExpression(node) || isElementAccessExpression(node)) {
      accessReceivers.push(node.expression);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);

  const allOperands = [...plusOperands, ...accessReceivers];
  const types =
    allOperands.length === 0 ? [] : await checker.getTypeAtLocation(allOperands);
  const typeByNode = new Map<Node, Type | undefined>();
  allOperands.forEach((n, i) => typeByNode.set(n, types[i]));

  // Each predicate may issue its own RPCs; Promise.all pipelines them.
  const plusTypes = plusOperands.map((n) => typeByNode.get(n));
  const accessTypes = accessReceivers.map((n) => typeByNode.get(n));
  const [stringyResults, arrayLikeResults] = await Promise.all([
    Promise.all(plusTypes.map((t) => computeIsStringy(t))),
    Promise.all(accessTypes.map((t) => computeIsArrayLike(t, checker))),
  ]);
  const isStringyByNode = new Map<Node, boolean>();
  plusOperands.forEach((n, i) => isStringyByNode.set(n, stringyResults[i] ?? false));
  const isArrayLikeByNode = new Map<Node, boolean>();
  accessReceivers.forEach((n, i) => isArrayLikeByNode.set(n, arrayLikeResults[i] ?? false));

  return { sourceFile, typeByNode, isStringyByNode, isArrayLikeByNode };
}
