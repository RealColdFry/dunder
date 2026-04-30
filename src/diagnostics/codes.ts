// Dunder diagnostic codes are stable, fixed integers. New codes are
// allocated by appending; numbers do not shift across versions even when
// rules are removed (deprecated codes stay reserved). This is the opposite
// of TSTL's monotonic-factory approach, which assigns codes by source-load
// order and shifts them when the factory list changes.
//
// Numbering layout (200000-block = dunder; 100000-block reserved for TSTL
// parity if we ever import their codes verbatim, which we don't intend):
//
//   200000-200999   build pass (unsupported syntax, unimplemented kinds)
//   201000-201999   validator slot, by backend
//     201000-201099   tstl/*
//     201100-201199   roblox-ts/*
//     201200-201299   reserved
//   202000-202999   lowering refusals, by backend
//   203000+         reserved for future producers
//
// Add codes as the rules land; the empty initial list reflects "no
// dunder-side rules yet" rather than a missing design.

export const DiagCode = {
  // ── build (200000-block) ─────────────────────────────────────────────
  // (none yet; today's build pass throws Error without a code)

  // ── validators (201000-block) ────────────────────────────────────────
  // tstl/*
  TstlNoSelfFunctionConversion: 201000,
  TstlSelfFunctionConversion: 201001,
  TstlOverloadAssignment: 201002,
  TstlTruthyOnlyConditionalValue: 201003,
  // roblox-ts/*
  RobloxNoFunctionExpressionName: 201100,
  RobloxNoArguments: 201101,
  RobloxNoPrecedingSpreadElement: 201102,

  // ── lowering refusals (202000-block) ─────────────────────────────────
  // (none yet)
} as const;

export type DiagCode = (typeof DiagCode)[keyof typeof DiagCode];

// Optional supplemental help text rendered as `  help: ...` after the
// diagnostic. Mirrors tslua's `diagHelp` map. Kept separate from the
// message factory so help can be edited without rewriting the message,
// and so localization can be layered in without touching producers.
export const diagHelp: Partial<Record<DiagCode, string>> = {
  [DiagCode.TstlNoSelfFunctionConversion]:
    "Wrap in an arrow function, or annotate the target with 'this: void'.",
  [DiagCode.TstlSelfFunctionConversion]:
    "Wrap in an arrow function, or annotate the target with 'this: any'.",
};

// Display prefix for a code. Anything <100000 is treated as a passthrough
// TS code; dunder codes use "D".
export function codePrefix(code: number): "TS" | "D" {
  return code < 100000 ? "TS" : "D";
}
