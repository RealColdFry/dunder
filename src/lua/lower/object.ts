// Object-literal and property-access lowerings. The default backend
// emits objects as plain Lua tables; spread is currently unsupported
// at this layer because it requires a per-target merge strategy
// (helper call vs inline loop) which the slot framework will eventually
// own. PropertyAccess always emits a table-index expression keyed by
// string literal — works for both real "objects" and table-shaped
// records since dunder doesn't yet distinguish them.

import type { EsObjectLiteral, PropertyAccess } from "#/ir/types.ts";
import * as lua from "#/lua/ast.ts";
import type { LowerCtx } from "./context.ts";

export function lowerPropertyAccess(expr: PropertyAccess, ctx: LowerCtx): lua.Expression {
  return lua.createTableIndexExpression(
    ctx.lowerExpr(expr.receiver),
    lua.createStringLiteral(expr.name),
  );
}

export function lowerEsObjectLiteral(expr: EsObjectLiteral, ctx: LowerCtx): lua.Expression {
  // Default backend, no-spread path: single TableExpression. Static keys
  // become string-keyed fields (matches ES key-coercion). Spread requires
  // a per-target merge strategy (helper call vs inline loop) and is not
  // wired in the default lowering yet.
  const fields: lua.TableFieldExpression[] = [];
  for (const m of expr.members) {
    if (m.kind === "spread") {
      throw new Error("spread in object literal not supported by default lowering yet");
    }
    const value = ctx.lowerExpr(m.value);
    const key =
      m.key.kind === "static"
        ? lua.createStringLiteral(m.key.name)
        : ctx.lowerExpr(m.key.expr);
    fields.push(lua.createTableFieldExpression(value, key));
  }
  return lua.createTableExpression(fields);
}
