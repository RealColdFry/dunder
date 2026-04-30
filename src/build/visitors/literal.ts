import {
  isComputedPropertyName,
  isGetAccessor,
  isIdentifier,
  isMethodDeclaration,
  isNumericLiteral,
  isPropertyAssignment,
  isSetAccessor,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isStringLiteral,
  SyntaxKind,
  type ArrayLiteralExpression,
  type Node,
  type ObjectLiteralExpression,
} from "#/ts.ts";
import { ir, type Expr, type ObjectKey, type ObjectMember } from "#/ir/types.ts";
import { type BuildCtx } from "#/build/context.ts";
import { buildOrderedExprs } from "./call.ts";

export function buildArrayLiteral(node: ArrayLiteralExpression, ctx: BuildCtx): Expr {
  // Spread to a real array; raw slice/index on the RemoteNodeList trips IPC.
  const elements = buildOrderedExprs([...node.elements] as Node[], ctx, "arr_index");
  return ir.createArrayLit(elements);
}

// Plan (per-member): collect AST nodes that contribute IR exprs in source
// order (computed-key expr, then value expr, or just spread expr), run them
// through buildOrderedExprs so any side-effecting earlier expression gets
// hoisted to a temp, then re-thread results into ObjectMembers using a
// parallel slot map. Static keys are pure metadata, never hoisted.
export function buildObjectLiteral(node: ObjectLiteralExpression, ctx: BuildCtx): Expr {
  type Slot = { kind: "kv-static"; name: string } | { kind: "kv-computed" } | { kind: "spread" };

  const slots: Slot[] = [];
  const exprNodes: Node[] = [];

  for (const prop of node.properties) {
    if (isPropertyAssignment(prop)) {
      const name = prop.name;
      if (isComputedPropertyName(name)) {
        slots.push({ kind: "kv-computed" });
        exprNodes.push(name.expression as Node);
        exprNodes.push(prop.initializer as Node);
      } else {
        slots.push({ kind: "kv-static", name: staticKeyName(name) });
        exprNodes.push(prop.initializer as Node);
      }
    } else if (isShorthandPropertyAssignment(prop)) {
      if (prop.objectAssignmentInitializer) {
        // `{x = 1}` only valid as a destructuring target, not a value-position
        // object literal. Refuse rather than silently drop the default.
        throw new Error("shorthand-with-default in object literal is destructuring-only");
      }
      slots.push({ kind: "kv-static", name: prop.name.text });
      exprNodes.push(prop.name as Node);
    } else if (isSpreadAssignment(prop)) {
      slots.push({ kind: "spread" });
      exprNodes.push(prop.expression as Node);
    } else if (isMethodDeclaration(prop)) {
      throw new Error("method shorthand in object literal not supported yet");
    } else if (isGetAccessor(prop) || isSetAccessor(prop)) {
      throw new Error("getters/setters in object literals not supported");
    }
  }

  const exprs = buildOrderedExprs(exprNodes, ctx, "obj_member");

  const members: ObjectMember[] = [];
  let i = 0;
  for (const slot of slots) {
    if (slot.kind === "kv-static") {
      members.push({
        kind: "kv",
        key: { kind: "static", name: slot.name },
        value: exprs[i++]!,
      });
    } else if (slot.kind === "kv-computed") {
      const keyExpr = exprs[i++]!;
      const valueExpr = exprs[i++]!;
      const key: ObjectKey = { kind: "computed", expr: keyExpr };
      members.push({ kind: "kv", key, value: valueExpr });
    } else {
      members.push({ kind: "spread", value: exprs[i++]! });
    }
  }
  return ir.createEsObjectLiteral(members);
}

// Identifier / StringLiteral / NumericLiteral property names all coerce to
// string keys in ES (`{1: x}` and `{"1": x}` are the same property).
function staticKeyName(name: Node): string {
  if (isIdentifier(name)) return name.text;
  if (isStringLiteral(name)) return name.text;
  if (isNumericLiteral(name)) return name.text;
  throw new Error(`unsupported property name kind: ${SyntaxKind[name.kind]}`);
}
