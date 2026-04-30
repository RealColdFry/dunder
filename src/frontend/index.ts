import { type Node, type SourceFile } from "#/ts.ts";

export interface ResolvedAst {
  sourceFile: SourceFile;
  isStringyByNode: Map<Node, boolean>;
  isArrayLikeByNode: Map<Node, boolean>;
  // True when the expression's type can only hold values whose JS truthiness
  // matches Lua's. The four divergent values are `0`, `0n`, `""`, `NaN`
  // (JS-falsy, Lua-truthy); everything else agrees once `null`/`undefined`
  // map to `nil`. Populated only for nodes in truthy-coercion position
  // (if/while/do-while/for/ternary conditions, `!`, `&&`/`||` operands), so
  // callers must check membership, not just `.get(node)`.
  truthyAgreesWithLuaByNode: Map<Node, boolean>;
  // Identifier nodes whose symbol resolves to an ambient lib global (NaN,
  // Infinity, globalThis, undefined). Build emits `EsGlobal` for these and a
  // regular `Identifier` for everything else, so user shadowing (a local
  // `NaN`) survives intact.
  globalNameByNode: Map<Node, string>;
}

export const GLOBAL_NAMES = ["NaN", "Infinity", "globalThis", "undefined"] as const;
