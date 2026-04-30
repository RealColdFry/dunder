import ts from "typescript";

declare module "typescript" {
  interface TypeChecker {
    isArrayType(type: ts.Type): boolean;
    isTupleType(type: ts.Type): boolean;
  }
}

export function computeIsStringy(type: ts.Type | undefined): boolean {
  if (!type) return false;
  if ((type.flags & ts.TypeFlags.StringLike) !== 0) return true;
  if ((type.flags & ts.TypeFlags.Union) !== 0) {
    const members = (type as ts.UnionType).types;
    return members.length > 0 && members.every((m) => computeIsStringy(m));
  }
  return false;
}

export function computeIsArrayLike(type: ts.Type | undefined, checker: ts.TypeChecker): boolean {
  if (!type) return false;
  if ((type.flags & ts.TypeFlags.Object) === 0) return false;
  return checker.isArrayType(type) || checker.isTupleType(type);
}

// True when JS truthiness equals Lua truthiness for every value the type
// can hold. The only divergent JS values are `0`, `0n`, `""`, and `NaN`
// (JS-falsy, Lua-truthy); everything else agrees once `null`/`undefined`
// map to `nil`. So this returns true iff the type cannot include any of
// those four.
//
// Recursive over union/intersection. For type parameters, chases the
// resolved base constraint via `getBaseConstraintOfType`. Unconstrained
// generics, `any`, `unknown`, and the wide `number`/`string`/`bigint`
// types all bail to `false` (must wrap).
export function computeTruthyAgreesWithLua(
  type: ts.Type | undefined,
  checker: ts.TypeChecker,
): boolean {
  if (!type) return false;

  if (type.isUnion() || type.isIntersection()) {
    const members = type.types;
    return members.length > 0 && members.every((m) => computeTruthyAgreesWithLua(m, checker));
  }

  const flags = type.flags;

  // BooleanLike covers `boolean`, `true`, `false`. All agree.
  if ((flags & ts.TypeFlags.BooleanLike) !== 0) return true;
  // null/undefined/void → nil → falsy in both.
  if ((flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) return true;
  // never: vacuously safe.
  if ((flags & ts.TypeFlags.Never) !== 0) return true;
  // Object types (instances, plain objects, arrays, functions) are always
  // truthy in both runtimes. NonPrimitive is the bare `object` type.
  if ((flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive)) !== 0) return true;
  // Symbols are always truthy.
  if ((flags & ts.TypeFlags.ESSymbolLike) !== 0) return true;

  // Literal types: agree iff the specific value isn't one of the four
  // divergent ones.
  if ((flags & ts.TypeFlags.NumberLiteral) !== 0) {
    const v = (type as ts.NumberLiteralType).value;
    return v !== 0 && !Number.isNaN(v);
  }
  if ((flags & ts.TypeFlags.StringLiteral) !== 0) {
    return (type as ts.StringLiteralType).value !== "";
  }
  if ((flags & ts.TypeFlags.BigIntLiteral) !== 0) {
    // PseudoBigInt: { negative: boolean, base10Value: string }.
    return (type as ts.BigIntLiteralType).value.base10Value !== "0";
  }

  // Generic type parameter: chase the constraint. Unconstrained → wrap.
  if ((flags & ts.TypeFlags.TypeParameter) !== 0) {
    const base = checker.getBaseConstraintOfType(type);
    return computeTruthyAgreesWithLua(base, checker);
  }

  // Wide `number`, `string`, `bigint`, `any`, `unknown`: could be a
  // divergent value. Must wrap.
  return false;
}
