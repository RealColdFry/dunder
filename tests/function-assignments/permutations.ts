// Tiny slice of the permutation matrix, just enough to show the shape.
// Real port would expand defs/types/shapes; structure stays the same.

export interface Def {
  id: string;
  src: string;
  kind: "self" | "noSelf";
}

export const defs: Def[] = [
  {
    id: "selfFunc",
    kind: "self",
    src: "let selfFunc: { (this: any, s: string): string } = function (s) { return s; };",
  },
  {
    id: "voidFunc",
    kind: "noSelf",
    src: "let voidFunc: { (this: void, s: string): string } = function (s) { return s; };",
  },
  {
    id: "anonLambda",
    kind: "self",
    src: "let anonLambda: (s: string) => string = s => s;",
  },
];

export const types = {
  anon: "(s: string) => string",
  self: "(this: any, s: string) => string",
  noSelf: "(this: void, s: string) => string",
} as const;

export type TypeId = keyof typeof types;

export interface Shape {
  id: string;
  build(parts: { def: string; type: string; value: string }): {
    source: string;
    // Where the assignment-site sits, for diagnostic-location asserts later.
    siteHole: "value" | "type";
  };
}

export const shapes: Shape[] = [
  {
    id: "varDecl",
    build: ({ def, type, value }) => ({
      source: `${def}\nconst fn: ${type} = ${value};\nfn("foobar");`,
      siteHole: "value",
    }),
  },
  {
    id: "assign",
    build: ({ def, type, value }) => ({
      source: `${def}\nlet fn: ${type};\nfn = ${value};\nfn("foobar");`,
      siteHole: "value",
    }),
  },
  {
    id: "argument",
    build: ({ def, type, value }) => ({
      source: `${def}\nfunction takes(fn: ${type}) { return fn("foobar"); }\ntakes(${value});`,
      siteHole: "value",
    }),
  },
];

// Backend-policy table: which (defKind, type) pairs are valid vs which
// diagnostic they fire. Lives next to the backend that owns the rule;
// the matrix below is illustrative.
export type Expect = { kind: "parity" } | { kind: "diagnostic"; code: string };

const VALID: Expect = { kind: "parity" };
const NO_SELF_CONV: Expect = { kind: "diagnostic", code: "unsupportedNoSelfFunctionConversion" };
const SELF_CONV: Expect = { kind: "diagnostic", code: "unsupportedSelfFunctionConversion" };

const policy: Record<Def["kind"], Record<TypeId, Expect>> = {
  self: { anon: VALID, self: VALID, noSelf: NO_SELF_CONV },
  noSelf: { anon: SELF_CONV, self: SELF_CONV, noSelf: VALID },
};

export interface Case {
  id: string;
  source: string;
  expect: Expect;
}

export function buildCases(): Case[] {
  const out: Case[] = [];
  for (const def of defs) {
    for (const typeId of Object.keys(types) as TypeId[]) {
      for (const shape of shapes) {
        const { source } = shape.build({
          def: def.src,
          type: types[typeId],
          value: def.id.split(".")[0], // value reference; same as def name here
        });
        out.push({
          id: `${def.id}->${typeId}@${shape.id}`,
          source,
          expect: policy[def.kind][typeId],
        });
      }
    }
  }
  return out;
}
