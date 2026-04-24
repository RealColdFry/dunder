// Frontend layer: owns all tsgo IPC. Produces a `ResolvedAst` that captures
// the source file + batched type information needed downstream. All checker
// calls happen here; downstream IR construction is pure synchronous code.
//
// This is the IPC/no-IPC boundary. Anyone who wants a different IR shape
// (e.g., TSTL-style visitors over typed AST) can consume `ResolvedAst`
// without re-implementing the IPC layer.

import {
  SymbolFlags,
  type Checker,
  type Type,
} from "@typescript/native-preview/async";
import {
  isBinaryExpression,
  isElementAccessExpression,
  isPropertyAccessExpression,
  SyntaxKind,
  type Node,
  type SourceFile,
} from "@typescript/native-preview/ast";

// Re-export so consumers can stay type-only relative to tsgo IPC.
export type { Type } from "@typescript/native-preview/async";

export interface ResolvedAst {
  sourceFile: SourceFile;
  // Type for a select set of nodes that downstream consumers need (operands
  // of `+`, receivers of property/element access). Frontend collects these
  // by walking the AST once before issuing the batched RPC.
  typeByNode: Map<Node, Type | undefined>;
  // Global Array / ReadonlyArray target-type ids; cached to recognize
  // references without a per-check RPC. `undefined` if not resolvable.
  arrayTargetId: string | undefined;
  readonlyArrayTargetId: string | undefined;
}

export async function resolve(sourceFile: SourceFile, checker: Checker): Promise<ResolvedAst> {
  const [arraySymbol, readonlyArraySymbol] = await Promise.all([
    checker.resolveName("Array", SymbolFlags.Type),
    checker.resolveName("ReadonlyArray", SymbolFlags.Type),
  ]);
  const [arrayType, readonlyArrayType] = await Promise.all([
    arraySymbol ? checker.getDeclaredTypeOfSymbol(arraySymbol) : undefined,
    readonlyArraySymbol ? checker.getDeclaredTypeOfSymbol(readonlyArraySymbol) : undefined,
  ]);
  const arrayTargetId = arrayType?.id;
  const readonlyArrayTargetId = readonlyArrayType?.id;

  // Walk the AST collecting every node whose type a downstream consumer is
  // likely to need. Slightly over-collects (cheap when batched).
  const operands: Node[] = [];
  const visit = (node: Node): void => {
    if (isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.PlusToken) {
      operands.push(node.left, node.right);
    }
    if (isPropertyAccessExpression(node) || isElementAccessExpression(node)) {
      operands.push(node.expression);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);

  const types = operands.length === 0 ? [] : await checker.getTypeAtLocation(operands);
  const typeByNode = new Map<Node, Type | undefined>();
  operands.forEach((n, i) => typeByNode.set(n, types[i]));

  return { sourceFile, typeByNode, arrayTargetId, readonlyArrayTargetId };
}
