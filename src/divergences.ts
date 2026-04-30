// Documented divergences from ECMAScript semantics. Each entry has:
//
//   id      stable string identifier ("DIV-TRUTH-001")
//   title   short label
//   summary one-paragraph explanation of the divergence
//
// Linked to IR via `divergencesByKind`: a kind-keyed table of which
// divergences each IR node embodies. Validators import `DIV.X` to declare
// which divergences they detect at user-facing surface.
//
// Granularity is per IR kind, not per IR instance. `Arithmetic` flags
// `DIV-MOD-001` even though only `op === "%"` actually diverges; the
// over-marking is fine for documentation. Per-instance refinement (a
// `predicate` field) is reserved for if/when real ambiguity arises.

import type { IRNode } from "./ir/visit.ts";

export interface Divergence {
  id: string;
  title: string;
  summary: string;
}

export const DIV = {
  TRUTH_001: {
    id: "DIV-TRUTH-001",
    title: "JS truthiness vs Lua truthiness",
    summary:
      "JS treats 0, '', and NaN as falsy; Lua only treats false and nil as falsy. " +
      "`if (someNumber)` reads as 'non-zero' in JS but is always true in Lua.",
  },
  MOD_001: {
    id: "DIV-MOD-001",
    title: "Modulo operator sign convention",
    summary:
      "ES `%` follows sign-of-dividend (`-1 % 2 === -1`); Lua `%` follows sign-of-divisor " +
      "(`-1 % 2 == 1`). Default backend accepts the divergence; a faithful backend would " +
      "lower via a helper.",
  },
  EQ_001: {
    id: "DIV-EQ-001",
    title: "Strict vs loose equality",
    summary:
      "ES distinguishes `==` from `===` via type coercion rules; Lua has only one `==`. " +
      "Default backend lowers both to Lua `==`, accepting that ES's loose equality is lost.",
  },
  ARR_INDEX_001: {
    id: "DIV-ARR-INDEX-001",
    title: "0-based vs 1-based array indexing",
    summary:
      "ES arrays are 0-based; Lua tables conventionally use 1-based indices. Default " +
      "backend adjusts at the lowering site (constant-folds literal indices, otherwise " +
      "emits `i + 1`).",
  },
} as const;

export type DivergenceId = (typeof DIV)[keyof typeof DIV]["id"];

// Linkage from IR kind to the divergences that kind embodies. New
// `es.*`-prefixed kinds should appear here; the table is the inventory.
export const divergencesByKind: Partial<Record<IRNode["kind"], readonly Divergence[]>> = {
  "es.Truthy": [DIV.TRUTH_001],
  "es.LogicalExpression": [DIV.TRUTH_001],
  LogicalNot: [DIV.TRUTH_001],
  "es.Equality": [DIV.EQ_001],
  "es.Index": [DIV.ARR_INDEX_001],
  Arithmetic: [DIV.MOD_001],
};

// Reverse lookup: given a divergence, which IR kinds embody it. Useful
// for documentation generation and for tests asserting that each
// divergence has at least one detector validator (when we add that).
export function kindsForDivergence(div: Divergence): IRNode["kind"][] {
  const out: IRNode["kind"][] = [];
  for (const [kind, divs] of Object.entries(divergencesByKind)) {
    if (divs && divs.includes(div)) out.push(kind as IRNode["kind"]);
  }
  return out;
}
