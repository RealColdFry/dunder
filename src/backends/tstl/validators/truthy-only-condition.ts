// TSTL parity: warns when an if/while/do-while/conditional-expression's
// condition has a type that cannot be falsy under TS's flag-based
// truthiness. JS treats 0/""/NaN as falsy; Lua treats only `false` and
// `nil` as falsy. Without this warning, `if (someNumber)` silently means
// something different across the two runtimes.
//
// Mirrors `truthyOnlyConditionalValue` (TSTL code 100037, factory in
// `src/transformation/utils/diagnostics.ts`). Trigger sites and the
// `canBeFalsy` predicate match TSTL's `checkOnlyTruthyCondition` plus
// `canBeFalsy` in `utils/typescript/types.ts`.

import ts from "typescript";
import type { ValidateCtx, Validator } from "../../../backend/types.ts";
import { DiagCode } from "../../../diagnostics/codes.ts";
import { locationFromNode } from "../../../diagnostics/from-node.ts";
import { DIV } from "../../../divergences.ts";

interface Plan {
  conditionSites: ts.Expression[];
}

const FALSY_FLAGS =
  ts.TypeFlags.Boolean |
  ts.TypeFlags.BooleanLiteral |
  ts.TypeFlags.Never |
  ts.TypeFlags.Void |
  ts.TypeFlags.Unknown |
  ts.TypeFlags.Any |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Null;

const MESSAGE =
  "Only false and nil evaluate to 'false' in Lua, " +
  "everything else is considered 'true'. Explicitly compare the value with ===.";

export const truthyOnlyCondition: Validator = {
  name: "truthy-only-condition",
  divergences: [DIV.TRUTH_001],

  collect(sf): Plan {
    const conditionSites: ts.Expression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIfStatement(node)) conditionSites.push(node.expression);
      else if (ts.isConditionalExpression(node)) conditionSites.push(node.condition);
      else if (ts.isWhileStatement(node) || ts.isDoStatement(node))
        conditionSites.push(node.expression);
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf as ts.SourceFile, visit);
    return { conditionSites };
  },

  validate(ctx: ValidateCtx): void {
    // Explicit `strictNullChecks: false` opts the file out entirely:
    // anything could implicitly be `nil`, so the check would be noisy.
    // Mirrors TSTL's `checkOnlyTruthyCondition` early bail.
    if (ctx.compilerOptions.strictNullChecks === false) return;

    // Resolved (post-`strict`-inheritance) value: when strict is on and
    // strictNullChecks isn't explicitly turned off, treat as on.
    const resolvedStrictNullChecks =
      ctx.compilerOptions.strictNullChecks ?? ctx.compilerOptions.strict ?? false;

    const plan = ctx.plan as Plan;
    const sf = ctx.sourceFile as ts.SourceFile;

    for (const cond of plan.conditionSites) {
      // Element access could implicitly return `undefined`, so TSTL skips
      // these: `arr[i]` is allowed even when the element type itself
      // can't be falsy.
      if (ts.isElementAccessExpression(cond)) continue;

      const t = ctx.types.typeAt(cond) as ts.Type | undefined;
      if (!t) continue;
      if (canBeFalsy(t, resolvedStrictNullChecks)) continue;

      ctx.sink.push({
        severity: "warning",
        code: DiagCode.TstlTruthyOnlyConditionalValue,
        message: MESSAGE,
        origin: ctx.origin,
        location: locationFromNode(sf, cond),
      });
    }
  },
};

function canBeFalsy(type: ts.Type, strictNullChecks: boolean): boolean {
  // Without strictNullChecks, anything that isn't a known literal could
  // implicitly include nil — so we can't claim it's truthy-only.
  if (!strictNullChecks && !type.isLiteral()) return true;
  if ((type.flags & FALSY_FLAGS) !== 0) return true;
  if (type.isUnion()) {
    for (const t of type.types) {
      if (canBeFalsy(t, strictNullChecks)) return true;
    }
  }
  return false;
}
