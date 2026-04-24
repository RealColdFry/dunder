// Dunder's IR types and pretty-printer. Pure data: no dependency on tsgo,
// no dependency on the Lua AST. The IR is the stable contract between
// frontend (ResolvedAst → IR, in src/build.ts) and backends (IR → target
// AST, in src/lua/lower.ts).
//
// Naming follows TS/ESTree tree-IR convention: PascalCase `kind`
// discriminators. Divergences from ECMAScript carry `DIV-*` IDs and are
// documented inline at the node that introduces them.

export type Module = { kind: "Module"; body: Stmt[] };

export type BindingKind = "let" | "const" | "var";

export type Stmt =
  | {
      kind: "VariableDeclaration";
      bindingKind: BindingKind;
      exported: boolean;
      name: string;
      init?: Expr;
    }
  // ES `const [a, b, ...] = source` (array destructuring). First-class IR
  // node; backend decides emit shape (temp + per-element binding, or
  // inline-on-literal-source optimization). Object destructuring will be a
  // sibling kind when added.
  | {
      kind: "VariableDestructuring";
      bindingKind: BindingKind;
      exported: boolean;
      pattern: ArrayPattern;
      init: Expr;
    }
  | {
      kind: "FunctionDeclaration";
      exported: boolean;
      name: string;
      params: Parameter[];
      body: Stmt[];
    }
  | { kind: "IfStatement"; cond: Expr; consequent: Stmt[]; alternate?: Stmt[] }
  | { kind: "ReturnStatement"; value?: Expr }
  | { kind: "ExpressionStatement"; expr: Expr };

export type ArrayPattern = {
  kind: "ArrayPattern";
  elements: ArrayPatternElement[];
};

// First slice: simple named bindings only. Holes (`[a, , b]`), defaults
// (`[a = 1]`), rest (`[...rest]`), and nested patterns get added when needed.
export type ArrayPatternElement = { kind: "Binding"; name: string };

export type Parameter = { name: string };

export type Expr =
  | { kind: "NumericLiteral"; value: number }
  | { kind: "StringLiteral"; value: string }
  | { kind: "BooleanLiteral"; value: boolean }
  | { kind: "NullLiteral" }
  | { kind: "Identifier"; name: string }
  // ES `+`. `mode` carries the type-resolved dispatch: "numeric" = numeric
  // addition; "concat" = string concatenation. If we ever need runtime dispatch
  // (e.g. `any + any`), a third mode ("dynamic") can be added without breaking
  // existing backends.
  | { kind: "Addition"; mode: "numeric" | "concat"; left: Expr; right: Expr }
  // ES strictly-numeric binary arithmetic. Operands are coerced to Number
  // in ES; we rely on type-checking (tsc/tsgo) to reject non-numeric operands
  // in strict mode and accept the coercion elsewhere.
  // DIV-MOD-001: `%` follows Lua's sign-of-divisor, not ES's sign-of-dividend.
  | { kind: "Arithmetic"; op: "-" | "*" | "/" | "%" | "**"; left: Expr; right: Expr }
  | { kind: "Comparison"; op: "<" | ">" | "<=" | ">="; left: Expr; right: Expr }
  | { kind: "UnaryExpression"; op: "-"; operand: Expr }
  | { kind: "Equality"; strict: boolean; negated: boolean; left: Expr; right: Expr }
  // ES short-circuit logical operators. Lua's `and`/`or` map directly, but
  // truthiness differs (DIV-TRUTH-001, pending): `0 || 1` is `1` in ES (0 is
  // falsy) and also `1` in Lua coincidentally; `"" || "x"` is `"x"` in ES but
  // `""` in Lua (`""` is truthy). Default backend accepts the divergence.
  | { kind: "LogicalExpression"; op: "&&" | "||"; left: Expr; right: Expr }
  | { kind: "CallExpression"; callee: Expr; args: Expr[] }
  | { kind: "ArrayLiteralExpression"; elements: Expr[] }
  | { kind: "PropertyAccessExpression"; receiver: Expr; name: string }
  | { kind: "ArrayLength"; array: Expr }
  // ES ternary `cond ? whenTrue : whenFalse`. Backend decides emit shape:
  // Luau has a native conditional expression; other Lua targets need
  // synthesis (IIFE wrap, `and/or` trick when whenTrue can't be falsy, or
  // a hoisted temp via preceding statements).
  | { kind: "ConditionalExpression"; cond: Expr; whenTrue: Expr; whenFalse: Expr }
  // ES `(a, b) => body`. `body` is normalized to a statement list; a concise
  // body (`(x) => x + 1`) becomes a single ReturnStatement at IR build time,
  // so the backend doesn't see two body shapes.
  | { kind: "ArrowFunction"; params: Parameter[]; body: Stmt[] }
  // ES `arr[i]` where receiver is statically known to be an Array. IR carries
  // the "array-indexed" semantic explicitly (0-based in ES) so the backend
  // handles the 0→1 index adjustment and any host-specific routing.
  // DIV-ARR-INDEX-001.
  | { kind: "ArrayIndex"; array: Expr; index: Expr }
  // Generic bracket access for non-array receivers (objects, maps, etc.).
  | { kind: "ElementAccessExpression"; receiver: Expr; index: Expr };

// ── IR pretty-printer ──────────────────────────────────────────────────────
// Human-readable tree dump. One line per node, children indented. Named child
// slots (consequent/alternate, callee/args) get labels; positional children don't.

export function printModule(mod: Module): string {
  const lines = ["Module"];
  for (const stmt of mod.body) lines.push(...indent(printStmt(stmt)));
  return lines.join("\n");
}

function printStmt(stmt: Stmt): string[] {
  switch (stmt.kind) {
    case "VariableDeclaration":
      return [
        `VariableDeclaration${stmt.exported ? " [exported]" : ""} ${stmt.bindingKind} ${stmt.name}`,
        ...indent(stmt.init ? printExpr(stmt.init) : ["(uninitialized)"]),
      ];

    case "VariableDestructuring": {
      const names = stmt.pattern.elements.map((e) => e.name).join(", ");
      return [
        `VariableDestructuring${stmt.exported ? " [exported]" : ""} ${stmt.bindingKind} [${names}]`,
        ...indent(printExpr(stmt.init)),
      ];
    }

    case "FunctionDeclaration": {
      const params = stmt.params.map((p) => p.name).join(", ");
      const out = [
        `FunctionDeclaration${stmt.exported ? " [exported]" : ""} ${stmt.name}(${params})`,
      ];
      for (const s of stmt.body) out.push(...indent(printStmt(s)));
      return out;
    }

    case "IfStatement": {
      const out = ["IfStatement"];
      out.push(...indent(["cond:", ...indent(printExpr(stmt.cond))]));
      out.push(...indent(["consequent:", ...indent(stmt.consequent.flatMap(printStmt))]));
      if (stmt.alternate !== undefined) {
        out.push(...indent(["alternate:", ...indent(stmt.alternate.flatMap(printStmt))]));
      }
      return out;
    }

    case "ReturnStatement":
      if (stmt.value === undefined) return ["ReturnStatement"];
      return ["ReturnStatement", ...indent(printExpr(stmt.value))];

    case "ExpressionStatement":
      return ["ExpressionStatement", ...indent(printExpr(stmt.expr))];
  }
}

function printExpr(expr: Expr): string[] {
  switch (expr.kind) {
    case "NumericLiteral":
      return [`NumericLiteral ${expr.value}`];
    case "StringLiteral":
      return [`StringLiteral ${JSON.stringify(expr.value)}`];
    case "BooleanLiteral":
      return [`BooleanLiteral ${expr.value}`];
    case "NullLiteral":
      return [`NullLiteral`];
    case "Identifier":
      return [`Identifier ${expr.name}`];
    case "Addition":
      return [
        `Addition [${expr.mode}]`,
        ...indent(printExpr(expr.left)),
        ...indent(printExpr(expr.right)),
      ];
    case "Arithmetic":
      return [
        `Arithmetic ${expr.op}`,
        ...indent(printExpr(expr.left)),
        ...indent(printExpr(expr.right)),
      ];
    case "Comparison":
      return [
        `Comparison ${expr.op}`,
        ...indent(printExpr(expr.left)),
        ...indent(printExpr(expr.right)),
      ];
    case "LogicalExpression":
      return [
        `LogicalExpression ${expr.op}`,
        ...indent(printExpr(expr.left)),
        ...indent(printExpr(expr.right)),
      ];
    case "UnaryExpression":
      return [`UnaryExpression ${expr.op}`, ...indent(printExpr(expr.operand))];
    case "Equality": {
      const tags: string[] = [];
      if (expr.strict) tags.push("strict");
      if (expr.negated) tags.push("negated");
      const suffix = tags.length ? ` [${tags.join(", ")}]` : "";
      return [
        `Equality${suffix}`,
        ...indent(printExpr(expr.left)),
        ...indent(printExpr(expr.right)),
      ];
    }
    case "CallExpression": {
      const out = ["CallExpression"];
      out.push(...indent(["callee:", ...indent(printExpr(expr.callee))]));
      if (expr.args.length > 0) {
        out.push(...indent(["args:", ...indent(expr.args.flatMap(printExpr))]));
      }
      return out;
    }
    case "ArrayLiteralExpression": {
      if (expr.elements.length === 0) return ["ArrayLiteralExpression []"];
      const out = ["ArrayLiteralExpression"];
      for (const el of expr.elements) out.push(...indent(printExpr(el)));
      return out;
    }
    case "PropertyAccessExpression":
      return [`PropertyAccessExpression .${expr.name}`, ...indent(printExpr(expr.receiver))];
    case "ArrayLength":
      return [`ArrayLength`, ...indent(printExpr(expr.array))];
    case "ConditionalExpression":
      return [
        `ConditionalExpression`,
        ...indent(["cond:", ...indent(printExpr(expr.cond))]),
        ...indent(["whenTrue:", ...indent(printExpr(expr.whenTrue))]),
        ...indent(["whenFalse:", ...indent(printExpr(expr.whenFalse))]),
      ];
    case "ArrowFunction": {
      const params = expr.params.map((p) => p.name).join(", ");
      const out = [`ArrowFunction(${params})`];
      for (const s of expr.body) out.push(...indent(printStmt(s)));
      return out;
    }
    case "ArrayIndex":
      return [
        `ArrayIndex`,
        ...indent(["array:", ...indent(printExpr(expr.array))]),
        ...indent(["index:", ...indent(printExpr(expr.index))]),
      ];
    case "ElementAccessExpression":
      return [
        `ElementAccessExpression`,
        ...indent(["receiver:", ...indent(printExpr(expr.receiver))]),
        ...indent(["index:", ...indent(printExpr(expr.index))]),
      ];
  }
}

function indent(lines: string[]): string[] {
  return lines.map((l) => "  " + l);
}
