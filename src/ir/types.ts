// Dunder's IR: types + type guards + constructor functions.
//
// Each node kind has an exported interface, `isFoo` type guard, and
// `createFoo` constructor (reachable via the `ir.*` namespace at the bottom).
//
// The IR is in A-normal form (ANF) for side effects: assignment, `++`/`--`,
// etc. are hoisted into explicit statements with `%`-prefixed temporaries
// at build time, so backends never see them as sub-expressions.
//
// `es.*`-prefixed kinds mark operations whose ES semantics force a
// non-trivial backend decision (mode, divergent runtime semantics, target-
// specific shape choice). Bare names map near-1:1 across reasonable backends.

// ── Module + shared shapes ──────────────────────────────────────────────────

export interface Module {
  kind: "Module";
  body: Stmt[];
}

export function isModule(node: { kind: string }): node is Module {
  return node.kind === "Module";
}

function createModule(body: Stmt[]): Module {
  return {
    kind: "Module",
    body,
  };
}

export type BindingKind = "let" | "const" | "var";

// `default` and `rest` are preserved on the parameter rather than desugared at
// build time. Default expressions can read sibling params, capture outer scope,
// and have side effects per call: the per-target lowering owns the prologue
// shape (e.g. `if x == nil then x = <default> end`) and may skip the check
// when a backend's type info proves the param is always provided. `rest` is a
// marker only; whether it materializes a Lua table eagerly, lazily, or stays
// as bare `...` is also a per-target call.
export interface Parameter {
  name: string;
  default?: Expr;
  rest?: true;
}

// ── Statements ──────────────────────────────────────────────────────────────

export type Stmt =
  | VarDecl
  | Destructure
  | FunDecl
  | If
  | Loop
  | Break
  | Continue
  | Return
  | ExprStmt
  | Assign;

export interface VarDecl {
  kind: "VarDecl";
  bindingKind: BindingKind;
  exported: boolean;
  name: string;
  init?: Expr;
}

export function isVarDecl(s: Stmt): s is VarDecl {
  return s.kind === "VarDecl";
}

function createVarDecl(opts: {
  bindingKind: BindingKind;
  name: string;
  init?: Expr;
  exported?: boolean;
}): VarDecl {
  return {
    kind: "VarDecl",
    bindingKind: opts.bindingKind,
    name: opts.name,
    init: opts.init,
    exported: opts.exported ?? false,
  };
}

export interface Destructure {
  kind: "Destructure";
  bindingKind: BindingKind;
  exported: boolean;
  pattern: ArrPat;
  init: Expr;
}

export function isDestructure(s: Stmt): s is Destructure {
  return s.kind === "Destructure";
}

function createDestructure(opts: {
  bindingKind: BindingKind;
  pattern: ArrPat;
  init: Expr;
  exported?: boolean;
}): Destructure {
  return {
    kind: "Destructure",
    bindingKind: opts.bindingKind,
    pattern: opts.pattern,
    init: opts.init,
    exported: opts.exported ?? false,
  };
}

// Hoisted function declaration. Wraps a `Function` value (with shape "decl")
// so the function-literal traversal is uniform across decl/expr/arrow; the
// statement form adds `exported` and is what the build pass emits at scope
// top so backends can hoist independently of the literal.
export interface FunDecl {
  kind: "FunDecl";
  exported: boolean;
  fn: Function;
}

export function isFunDecl(s: Stmt): s is FunDecl {
  return s.kind === "FunDecl";
}

function createFunDecl(opts: {
  name: string;
  params: Parameter[];
  body: Stmt[];
  exported?: boolean;
}): FunDecl {
  return {
    kind: "FunDecl",
    exported: opts.exported ?? false,
    fn: createFunction({
      shape: "decl",
      name: opts.name,
      params: opts.params,
      body: opts.body,
    }),
  };
}

export interface If {
  kind: "If";
  cond: Expr;
  consequent: Stmt[];
  alternate?: Stmt[];
}

export function isIf(s: Stmt): s is If {
  return s.kind === "If";
}

function createIf(cond: Expr, consequent: Stmt[], alternate?: Stmt[]): If {
  return {
    kind: "If",
    cond,
    consequent,
    alternate,
  };
}

// Generic ES loop. `body` runs each iteration; `update` runs after body and
// after Continue, before re-testing the cond-break at body's head. The split
// is what lets Continue still trigger update.
export interface Loop {
  kind: "Loop";
  // Init statements run once before the loop. Lowered inside the loop's
  // own scope (Lua `do ... end`) so `let`-init bindings don't leak into
  // the surrounding block. Empty/undefined for `while` and `do-while`.
  init?: Stmt[];
  body: Stmt[];
  update?: Stmt[];
}

export function isLoop(s: Stmt): s is Loop {
  return s.kind === "Loop";
}

function createLoop(opts: { init?: Stmt[]; body: Stmt[]; update?: Stmt[] }): Loop {
  return {
    kind: "Loop",
    init: opts.init,
    body: opts.body,
    update: opts.update,
  };
}

export interface Break {
  kind: "Break";
}

export function isBreak(s: Stmt): s is Break {
  return s.kind === "Break";
}

function createBreak(): Break {
  return {
    kind: "Break",
  };
}

export interface Continue {
  kind: "Continue";
}

export function isContinue(s: Stmt): s is Continue {
  return s.kind === "Continue";
}

function createContinue(): Continue {
  return {
    kind: "Continue",
  };
}

export interface Return {
  kind: "Return";
  value?: Expr;
}

export function isReturn(s: Stmt): s is Return {
  return s.kind === "Return";
}

function createReturn(value?: Expr): Return {
  return {
    kind: "Return",
    value,
  };
}

export interface ExprStmt {
  kind: "ExprStmt";
  expr: Expr;
}

export function isExprStmt(s: Stmt): s is ExprStmt {
  return s.kind === "ExprStmt";
}

function createExprStmt(expr: Expr): ExprStmt {
  return {
    kind: "ExprStmt",
    expr,
  };
}

export interface Assign {
  kind: "Assign";
  target: Expr;
  value: Expr;
}

export function isAssign(s: Stmt): s is Assign {
  return s.kind === "Assign";
}

function createAssign(target: Expr, value: Expr): Assign {
  return {
    kind: "Assign",
    target,
    value,
  };
}

// ── Patterns ────────────────────────────────────────────────────────────────

export interface ArrPat {
  kind: "ArrPat";
  elements: ArrPatElem[];
}

export function isArrPat(node: { kind: string }): node is ArrPat {
  return node.kind === "ArrPat";
}

function createArrPat(elements: ArrPatElem[]): ArrPat {
  return {
    kind: "ArrPat",
    elements,
  };
}

export interface ArrPatElem {
  kind: "ArrPatElem";
  name: string;
}

export function isArrPatElem(node: { kind: string }): node is ArrPatElem {
  return node.kind === "ArrPatElem";
}

function createArrPatElem(name: string): ArrPatElem {
  return {
    kind: "ArrPatElem",
    name,
  };
}

export type ArrayPattern = ArrPat;
export type ArrayPatternElement = ArrPatElem;

// ── Expressions ─────────────────────────────────────────────────────────────

export type Expr =
  | NumericLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral
  | Identifier
  | EsNumericAdd
  | EsStringConcat
  | Arithmetic
  | Comparison
  | UnaryExpression
  | LogicalNot
  | EsTruthy
  | EsEquality
  | EsLogicalExpression
  | Call
  | ArrayLit
  | PropertyAccess
  | EsArrayLength
  | EsConditional
  | Function
  | EsIndex
  | ElementAccess
  | EsObjectLiteral
  | EsGlobal;

export interface NumericLiteral {
  kind: "NumericLiteral";
  value: number;
}

export function isNumericLiteral(e: Expr): e is NumericLiteral {
  return e.kind === "NumericLiteral";
}

function createNumericLiteral(value: number): NumericLiteral {
  return {
    kind: "NumericLiteral",
    value,
  };
}

export interface StringLiteral {
  kind: "StringLiteral";
  value: string;
}

export function isStringLiteral(e: Expr): e is StringLiteral {
  return e.kind === "StringLiteral";
}

function createStringLiteral(value: string): StringLiteral {
  return {
    kind: "StringLiteral",
    value,
  };
}

export interface BooleanLiteral {
  kind: "BooleanLiteral";
  value: boolean;
}

export function isBooleanLiteral(e: Expr): e is BooleanLiteral {
  return e.kind === "BooleanLiteral";
}

function createBooleanLiteral(value: boolean): BooleanLiteral {
  return {
    kind: "BooleanLiteral",
    value,
  };
}

export interface NullLiteral {
  kind: "NullLiteral";
}

export function isNullLiteral(e: Expr): e is NullLiteral {
  return e.kind === "NullLiteral";
}

function createNullLiteral(): NullLiteral {
  return {
    kind: "NullLiteral",
  };
}

export interface Identifier {
  kind: "Identifier";
  name: string;
}

export function isIdentifier(e: Expr): e is Identifier {
  return e.kind === "Identifier";
}

function createIdentifier(name: string): Identifier {
  return {
    kind: "Identifier",
    name,
  };
}

// `+` split by type-resolved dispatch: build pass picks NumericAdd vs
// StringConcat using `isStringy` predicates from the resolve pass.
export interface EsNumericAdd {
  kind: "es.NumericAdd";
  left: Expr;
  right: Expr;
}

export function isEsNumericAdd(e: Expr): e is EsNumericAdd {
  return e.kind === "es.NumericAdd";
}

function createEsNumericAdd(left: Expr, right: Expr): EsNumericAdd {
  return {
    kind: "es.NumericAdd",
    left,
    right,
  };
}

export interface EsStringConcat {
  kind: "es.StringConcat";
  left: Expr;
  right: Expr;
}

export function isEsStringConcat(e: Expr): e is EsStringConcat {
  return e.kind === "es.StringConcat";
}

function createEsStringConcat(left: Expr, right: Expr): EsStringConcat {
  return {
    kind: "es.StringConcat",
    left,
    right,
  };
}

// DIV-MOD-001: `%` follows Lua's sign-of-divisor, not ES's sign-of-dividend.
export interface Arithmetic {
  kind: "Arithmetic";
  op: "-" | "*" | "/" | "%" | "**";
  left: Expr;
  right: Expr;
}

export function isArithmetic(e: Expr): e is Arithmetic {
  return e.kind === "Arithmetic";
}

function createArithmetic(op: Arithmetic["op"], left: Expr, right: Expr): Arithmetic {
  return {
    kind: "Arithmetic",
    op,
    left,
    right,
  };
}

export interface Comparison {
  kind: "Comparison";
  op: "<" | ">" | "<=" | ">=";
  left: Expr;
  right: Expr;
}

export function isComparison(e: Expr): e is Comparison {
  return e.kind === "Comparison";
}

function createComparison(op: Comparison["op"], left: Expr, right: Expr): Comparison {
  return {
    kind: "Comparison",
    op,
    left,
    right,
  };
}

export interface UnaryExpression {
  kind: "UnaryExpression";
  op: "-";
  operand: Expr;
}

export function isUnaryExpression(e: Expr): e is UnaryExpression {
  return e.kind === "UnaryExpression";
}

function createUnaryExpression(op: "-", operand: Expr): UnaryExpression {
  return {
    kind: "UnaryExpression",
    op,
    operand,
  };
}

export interface LogicalNot {
  kind: "LogicalNot";
  operand: Expr;
}

export function isLogicalNot(e: Expr): e is LogicalNot {
  return e.kind === "LogicalNot";
}

function createLogicalNot(operand: Expr): LogicalNot {
  return {
    kind: "LogicalNot",
    operand,
  };
}

// DIV-TRUTH-001: marks "consumed for truthiness." ES truthiness is wider
// than Lua's; default backend lowers as passthrough and accepts the divergence.
export interface EsTruthy {
  kind: "es.Truthy";
  expr: Expr;
}

export function isEsTruthy(e: Expr): e is EsTruthy {
  return e.kind === "es.Truthy";
}

function createEsTruthy(expr: Expr): EsTruthy {
  return {
    kind: "es.Truthy",
    expr,
  };
}

export interface EsEquality {
  kind: "es.Equality";
  strict: boolean;
  negated: boolean;
  left: Expr;
  right: Expr;
}

export function isEsEquality(e: Expr): e is EsEquality {
  return e.kind === "es.Equality";
}

function createEsEquality(opts: {
  strict: boolean;
  negated: boolean;
  left: Expr;
  right: Expr;
}): EsEquality {
  return {
    kind: "es.Equality",
    strict: opts.strict,
    negated: opts.negated,
    left: opts.left,
    right: opts.right,
  };
}

// DIV-TRUTH-001: Lua's `and`/`or` short-circuit identically but truthiness
// differs.
export interface EsLogicalExpression {
  kind: "es.LogicalExpression";
  op: "&&" | "||";
  left: Expr;
  right: Expr;
}

export function isEsLogicalExpression(e: Expr): e is EsLogicalExpression {
  return e.kind === "es.LogicalExpression";
}

function createEsLogicalExpression(
  op: EsLogicalExpression["op"],
  left: Expr,
  right: Expr,
): EsLogicalExpression {
  return {
    kind: "es.LogicalExpression",
    op,
    left,
    right,
  };
}

// Call-argument spread (`f(...arr)`). Lowering is per-target: `table.unpack`
// on Lua 5.0, bare `...` on 5.1+ when forwarding function varargs directly,
// lualib helpers for mid-list spread, or refusal (roblox-ts forbids non-final
// position). Not yet wired into `Call.args`; lives alongside until the build
// pass migrates.
export interface Spread {
  kind: "Spread";
  expr: Expr;
}

export function isSpread(node: { kind: string }): node is Spread {
  return node.kind === "Spread";
}

function createSpread(expr: Expr): Spread {
  return {
    kind: "Spread",
    expr,
  };
}

// `this` reference inside a function body. Resolution depends on the
// containing `Function.shape`: arrow → captured outer `this`; expr/decl →
// dynamic receiver (Lua `self`, host-specific binding, or a refusal).
export interface EsThis {
  kind: "es.This";
}

export function isEsThis(e: { kind: string }): e is EsThis {
  return e.kind === "es.This";
}

function createEsThis(): EsThis {
  return {
    kind: "es.This",
  };
}

// `arguments` pseudo-variable. Most backends refuse (roblox-ts does); a
// faithful one would polyfill from rest-params. Kept as a node so the
// refusal fires at the lowering layer, not at build.
export interface EsArguments {
  kind: "es.Arguments";
}

export function isEsArguments(e: { kind: string }): e is EsArguments {
  return e.kind === "es.Arguments";
}

function createEsArguments(): EsArguments {
  return {
    kind: "es.Arguments",
  };
}

export interface Call {
  kind: "Call";
  callee: Expr;
  args: Expr[];
}

export function isCall(e: Expr): e is Call {
  return e.kind === "Call";
}

function createCall(callee: Expr, args: Expr[]): Call {
  return {
    kind: "Call",
    callee,
    args,
  };
}

export interface ArrayLit {
  kind: "ArrayLit";
  elements: Expr[];
}

export function isArrayLit(e: Expr): e is ArrayLit {
  return e.kind === "ArrayLit";
}

function createArrayLit(elements: Expr[]): ArrayLit {
  return {
    kind: "ArrayLit",
    elements,
  };
}

export interface PropertyAccess {
  kind: "PropertyAccess";
  receiver: Expr;
  name: string;
}

export function isPropertyAccess(e: Expr): e is PropertyAccess {
  return e.kind === "PropertyAccess";
}

function createPropertyAccess(receiver: Expr, name: string): PropertyAccess {
  return {
    kind: "PropertyAccess",
    receiver,
    name,
  };
}

export interface EsArrayLength {
  kind: "es.ArrayLength";
  array: Expr;
}

export function isEsArrayLength(e: Expr): e is EsArrayLength {
  return e.kind === "es.ArrayLength";
}

function createEsArrayLength(array: Expr): EsArrayLength {
  return {
    kind: "es.ArrayLength",
    array,
  };
}

export interface EsConditional {
  kind: "es.Conditional";
  cond: Expr;
  whenTrue: Expr;
  whenFalse: Expr;
}

export function isEsConditional(e: Expr): e is EsConditional {
  return e.kind === "es.Conditional";
}

function createEsConditional(cond: Expr, whenTrue: Expr, whenFalse: Expr): EsConditional {
  return {
    kind: "es.Conditional",
    cond,
    whenTrue,
    whenFalse,
  };
}

// Unified function literal. `shape` distinguishes the three ES surface forms
// because they differ in two ways the backend cares about:
//   - `this` binding: arrow captures lexically; expr/decl bind dynamically.
//   - hoisting + name-in-scope: only `decl` hoists to the enclosing function;
//     `expr` may have a name that's in scope only inside its own body.
// Body is normalized to a statement list at build time (concise arrow bodies
// become a single Return) so backends see one shape.
//
// Not yet wired into the Expr / Stmt unions: `ArrowFun` and `FunDecl` remain
// the live shapes until the build/lower pass migrates.
export interface Function {
  kind: "Function";
  shape: "decl" | "expr" | "arrow";
  name?: string;
  params: Parameter[];
  body: Stmt[];
}

export function isFunction(node: { kind: string }): node is Function {
  return node.kind === "Function";
}

function createFunction(opts: {
  shape: Function["shape"];
  name?: string;
  params: Parameter[];
  body: Stmt[];
}): Function {
  return {
    kind: "Function",
    shape: opts.shape,
    name: opts.name,
    params: opts.params,
    body: opts.body,
  };
}

// DIV-ARR-INDEX-001: 0-based ES index; backend handles the 0→1 adjustment.
export interface EsIndex {
  kind: "es.Index";
  array: Expr;
  index: Expr;
}

export function isEsIndex(e: Expr): e is EsIndex {
  return e.kind === "es.Index";
}

function createEsIndex(array: Expr, index: Expr): EsIndex {
  return {
    kind: "es.Index",
    array,
    index,
  };
}

export interface ElementAccess {
  kind: "ElementAccess";
  receiver: Expr;
  index: Expr;
}

export function isElementAccess(e: Expr): e is ElementAccess {
  return e.kind === "ElementAccess";
}

function createElementAccess(receiver: Expr, index: Expr): ElementAccess {
  return {
    kind: "ElementAccess",
    receiver,
    index,
  };
}

// Identifier resolved (via the type checker's symbol table) to a binding in
// the ambient lib, not to user code. Carries the binding name; the per-target
// lowering pattern-matches on it. Generic on purpose: adding a new ambient
// global is a lib + lowering change, not an IR change. Build attaches this
// node only when the symbol lookup confirms the lib binding (so user-shadowed
// `const NaN = 1` keeps the user binding as a regular Identifier).
export interface EsGlobal {
  kind: "es.Global";
  name: string;
}

export function isEsGlobal(e: Expr): e is EsGlobal {
  return e.kind === "es.Global";
}

function createEsGlobal(name: string): EsGlobal {
  return {
    kind: "es.Global",
    name,
  };
}

// Object literal. ES leak: spread enumerates own-enumerable string keys at
// runtime, computed keys evaluate left-to-right interleaved with values, and
// numeric/string-literal keys ES-coerce to strings (Lua keeps them distinct).
// Shorthand and method-shorthand are desugared at build into kv members
// (shorthand → kv with Identifier value; method → kv with Function value).
// Getters/setters are refused at build; not in the IR vocabulary.
export type ObjectKey = { kind: "static"; name: string } | { kind: "computed"; expr: Expr };

export type ObjectMember =
  | { kind: "kv"; key: ObjectKey; value: Expr }
  | { kind: "spread"; value: Expr };

export interface EsObjectLiteral {
  kind: "es.ObjectLiteral";
  members: ObjectMember[];
}

export function isEsObjectLiteral(e: Expr): e is EsObjectLiteral {
  return e.kind === "es.ObjectLiteral";
}

function createEsObjectLiteral(members: ObjectMember[]): EsObjectLiteral {
  return {
    kind: "es.ObjectLiteral",
    members,
  };
}

// All `createXxx` functions are reachable only through this namespace so
// that IR construction call sites visually announce themselves via `ir.`.

export const ir = {
  createModule,
  createVarDecl,
  createDestructure,
  createFunDecl,
  createIf,
  createLoop,
  createBreak,
  createContinue,
  createReturn,
  createExprStmt,
  createAssign,
  createArrPat,
  createArrPatElem,
  createNumericLiteral,
  createStringLiteral,
  createBooleanLiteral,
  createNullLiteral,
  createIdentifier,
  createEsNumericAdd,
  createEsStringConcat,
  createArithmetic,
  createComparison,
  createUnaryExpression,
  createLogicalNot,
  createEsTruthy,
  createEsEquality,
  createEsLogicalExpression,
  createCall,
  createArrayLit,
  createPropertyAccess,
  createEsArrayLength,
  createEsConditional,
  createEsIndex,
  createElementAccess,
  createFunction,
  createSpread,
  createEsThis,
  createEsArguments,
  createEsObjectLiteral,
  createEsGlobal,
} as const;
