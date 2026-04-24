// Sync predicates over `Type`. Some helpers reach through to fields the public
// `Type` interface hides; safe because the wire payload eagerly populates them
// for the relevant kinds (`proto.d.ts` TypeResponse).

import { ObjectFlags, TypeFlags, type Type } from "@typescript/native-preview/async";
import type { ResolvedAst } from "./frontend.ts";

export function isArrayType(type: Type | undefined, resolved: ResolvedAst): boolean {
  if (!type) return false;
  if ((type.flags & TypeFlags.Object) === 0) return false;
  // The public `Type` interface exposes `objectFlags` only via `ObjectType`
  // and `target` only via async `TypeReference.getTarget()`. Both are sync
  // fields on the underlying `TypeObject`; widen to avoid an RPC per check.
  const raw = type as unknown as { objectFlags?: number; target?: string };
  if (((raw.objectFlags ?? 0) & ObjectFlags.Reference) === 0) return false;
  return (
    (resolved.arrayTargetId !== undefined && raw.target === resolved.arrayTargetId) ||
    (resolved.readonlyArrayTargetId !== undefined && raw.target === resolved.readonlyArrayTargetId)
  );
}

export function isStringyType(type: Type | undefined): boolean {
  return ((type?.flags ?? 0) & TypeFlags.StringLike) !== 0;
}
