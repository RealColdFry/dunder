// Type-shape predicates run from the resolve pass; build pass consumes the
// cached booleans via ResolvedAst.
//
// Known IPC limitations to upstream:
//   - `isArrayType` / `isTupleType` aren't batched (one RPC per receiver).
//   - `getBaseConstraintOfType` isn't exposed, so generic constraints,
//     indexed-access, and substitution types resolve as false.

import {
  TypeFlags,
  type Checker,
  type Type,
  type UnionType,
} from "@typescript/native-preview/async";

// As `+` operand, forces concat semantics.
export async function computeIsStringy(type: Type | undefined): Promise<boolean> {
  if (!type) return false;
  if ((type.flags & TypeFlags.StringLike) !== 0) return true;
  if ((type.flags & TypeFlags.Union) !== 0) {
    const members = await (type as UnionType).getTypes();
    const flags = await Promise.all(members.map((m) => computeIsStringy(m)));
    return flags.length > 0 && flags.every(Boolean);
  }
  return false;
}

// Bails sync on non-Object types so primitives don't pay an RPC.
export async function computeIsArrayLike(
  type: Type | undefined,
  checker: Checker,
): Promise<boolean> {
  if (!type) return false;
  if ((type.flags & TypeFlags.Object) === 0) return false;
  const [arr, tup] = await Promise.all([checker.isArrayType(type), checker.isTupleType(type)]);
  return arr || tup;
}
