import { type BreakStatement, type ContinueStatement } from "#/ts.ts";
import { ir, type Stmt } from "#/ir/types.ts";

export function buildBreak(node: BreakStatement): Stmt[] {
  if (node.label) throw new Error("labeled break not supported yet");
  return [ir.createBreak()];
}

export function buildContinue(node: ContinueStatement): Stmt[] {
  if (node.label) throw new Error("labeled continue not supported yet");
  return [ir.createContinue()];
}
