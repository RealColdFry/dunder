import { ModifierFlags, SyntaxKind, type Node } from "#/ts.ts";

// tsgo precomputes `modifierFlags`; tsc does not, so fall back to walking
// `node.modifiers` and matching by SyntaxKind. Numeric SyntaxKind values are
// stable across packages.
function hasModifier(node: Node, flag: ModifierFlags, kind: SyntaxKind): boolean {
  const cached = (
    node as unknown as {
      modifierFlags?: number;
    }
  ).modifierFlags;
  if (cached !== undefined) return (cached & flag) !== 0;
  const modifiers = (
    node as unknown as {
      modifiers?: readonly {
        kind: SyntaxKind;
      }[];
    }
  ).modifiers;
  return modifiers?.some((m) => m.kind === kind) ?? false;
}

export function hasExportModifier(node: Node): boolean {
  return hasModifier(node, ModifierFlags.Export, SyntaxKind.ExportKeyword);
}

export function isAmbient(node: Node): boolean {
  return hasModifier(node, ModifierFlags.Ambient, SyntaxKind.DeclareKeyword);
}
