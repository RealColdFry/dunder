// Tree-walking interpreter for dunder IR. Implements the IR's reference
// semantics in JS so tests can run programs end-to-end without a backend.
//
// The interpreter is the spec: a backend's lowering is correct iff its
// emitted Lua is observationally equivalent to running the same IR through
// here. Means tests can assert behavior (`expect(result).toEqual([0,1,2])`)
// without a Lua runtime, and "what does this IR node mean" is answered by
// the corresponding case below.
//
// Scope is deliberately narrow: single-module, sync, no try/catch, no
// classes (until they're in the IR), no proper iterator protocol. Enough
// to cover loops, closures, arrays, basic arithmetic/strings, control
// flow. Grow case-by-case as IR nodes earn it.

import type {
  Expr,
  Function as IrFunction,
  Module,
  ObjectKey,
  Parameter,
  Stmt,
} from "#/ir/types.ts";

// ── Values ─────────────────────────────────────────────────────────────────

export type Value =
  | undefined
  | null
  | boolean
  | number
  | string
  | unknown[]
  | Record<string, unknown>
  | Closure
  | HostFn;

interface Closure {
  __closure: true;
  params: Parameter[];
  body: Stmt[];
  env: Env;
  shape: IrFunction["shape"];
}

type HostFn = (...args: Value[]) => Value;

function isClosure(v: unknown): v is Closure {
  return typeof v === "object" && v !== null && (v as { __closure?: boolean }).__closure === true;
}

// ── Environment ────────────────────────────────────────────────────────────

class Env {
  private bindings = new Map<string, Value>();
  constructor(private parent: Env | null = null) {}

  child(): Env {
    return new Env(this);
  }

  bind(name: string, value: Value): void {
    this.bindings.set(name, value);
  }

  get(name: string): Value {
    if (this.bindings.has(name)) return this.bindings.get(name)!;
    if (this.parent) return this.parent.get(name);
    throw new InterpreterError(`unbound identifier: ${name}`);
  }

  set(name: string, value: Value): void {
    if (this.bindings.has(name)) {
      this.bindings.set(name, value);
      return;
    }
    if (this.parent) {
      this.parent.set(name, value);
      return;
    }
    throw new InterpreterError(`assignment to unbound identifier: ${name}`);
  }
}

// ── Control flow ───────────────────────────────────────────────────────────

type Signal =
  | { kind: "next" }
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "return"; value: Value };

const NEXT: Signal = { kind: "next" };

// ── Host ───────────────────────────────────────────────────────────────────

export interface Host {
  print: (...args: unknown[]) => void;
}

export interface InterpretResult {
  // Module-level exports keyed by name. `__main` is the test convention.
  exports: Record<string, Value>;
  stdout: string;
}

interface Ctx {
  host: Host;
  stdoutChunks: string[];
}

function defaultHost(stdoutChunks: string[]): Host {
  return {
    print: (...args) => {
      stdoutChunks.push(args.map((a) => formatPrintArg(a)).join("\t") + "\n");
    },
  };
}

function formatPrintArg(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

// ── Entry point ────────────────────────────────────────────────────────────

export class InterpreterError extends Error {}

// Invoke a closure produced by a previous `interpret` call. Used by tests
// to drive an exported `__main()` and read its return value. The closure
// already carries its lexical env, so it runs in its original scope.
export function callClosureForTest(fn: Value, args: Value[]): Value {
  const stdoutChunks: string[] = [];
  const ctx: Ctx = {
    host: defaultHost(stdoutChunks),
    stdoutChunks,
  };
  return callFunction(fn, args, ctx);
}

export function interpret(mod: Module, hostOverride?: Partial<Host>): InterpretResult {
  const stdoutChunks: string[] = [];
  const host: Host = { ...defaultHost(stdoutChunks), ...hostOverride };
  const ctx: Ctx = { host, stdoutChunks };

  const moduleEnv = makeRootEnv(host);
  const exports: Record<string, Value> = {};

  for (const s of mod.body) {
    const sig = execStmt(s, moduleEnv, ctx, exports);
    if (sig.kind === "return") {
      throw new InterpreterError("return at module top-level");
    }
    if (sig.kind === "break" || sig.kind === "continue") {
      throw new InterpreterError(`${sig.kind} at module top-level`);
    }
  }

  return { exports, stdout: stdoutChunks.join("") };
}

function makeRootEnv(host: Host): Env {
  const env = new Env(null);
  // Minimal host bindings. Add more as the test corpus needs them.
  const print: HostFn = (...args) => {
    host.print(...(args as unknown[]));
    return undefined;
  };
  env.bind("print", print);
  env.bind("console", { log: print });
  return env;
}

// ── Statements ─────────────────────────────────────────────────────────────

function execBlock(stmts: Stmt[], env: Env, ctx: Ctx): Signal {
  for (const s of stmts) {
    const sig = execStmt(s, env, ctx);
    if (sig.kind !== "next") return sig;
  }
  return NEXT;
}

function execStmt(s: Stmt, env: Env, ctx: Ctx, exports?: Record<string, Value>): Signal {
  switch (s.kind) {
    case "VarDecl": {
      const value = s.init ? evalExpr(s.init, env, ctx) : undefined;
      env.bind(s.name, value);
      if (s.exported && exports) exports[s.name] = value;
      return NEXT;
    }

    case "FunDecl": {
      const closure: Closure = {
        __closure: true,
        params: s.fn.params,
        body: s.fn.body,
        env,
        shape: s.fn.shape,
      };
      const name = s.fn.name;
      if (name === undefined) throw new InterpreterError("FunDecl without a name");
      env.bind(name, closure);
      if (s.exported && exports) exports[name] = closure;
      return NEXT;
    }

    case "Destructure": {
      const init = evalExpr(s.init, env, ctx);
      if (!Array.isArray(init)) {
        throw new InterpreterError("array destructuring on non-array");
      }
      s.pattern.elements.forEach((el, i) => {
        env.bind(el.name, init[i] as Value);
        if (s.exported && exports) exports[el.name] = init[i] as Value;
      });
      return NEXT;
    }

    case "If": {
      const cond = evalExpr(s.cond, env, ctx);
      const branch = toBoolean(cond) ? s.consequent : (s.alternate ?? []);
      return execBlock(branch, env.child(), ctx);
    }

    case "Loop": {
      const loopEnv = s.init && s.init.length > 0 ? env.child() : env;
      for (const i of s.init ?? []) {
        const sig = execStmt(i, loopEnv, ctx);
        if (sig.kind === "return") return sig;
      }
      while (true) {
        // Fresh per-iteration scope. Critical: this is what gives
        // `for (let i ...)` correct closure-capture semantics.
        const iterEnv = loopEnv.child();
        const sig = execBlock(s.body, iterEnv, ctx);
        if (sig.kind === "break") return NEXT;
        if (sig.kind === "return") return sig;
        // Update runs in the iter scope, not the loop scope: the build
        // pass's re-shadow encoding emits sync-back statements like
        // `i = %i_inner_0` into update, where the inner rename is only
        // bound in the iter scope. iterEnv is still discarded after
        // update runs, so the freshness invariant for the next
        // iteration holds.
        for (const u of s.update ?? []) {
          const usig = execStmt(u, iterEnv, ctx);
          if (usig.kind === "return") return usig;
        }
      }
    }

    case "Break":
      return { kind: "break" };
    case "Continue":
      return { kind: "continue" };

    case "Return":
      return {
        kind: "return",
        value: s.value !== undefined ? evalExpr(s.value, env, ctx) : undefined,
      };

    case "ExprStmt":
      evalExpr(s.expr, env, ctx);
      return NEXT;

    case "Assign": {
      const value = evalExpr(s.value, env, ctx);
      assignTo(s.target, value, env, ctx);
      return NEXT;
    }
  }
}

function assignTo(target: Expr, value: Value, env: Env, ctx: Ctx): void {
  switch (target.kind) {
    case "Identifier":
      env.set(target.name, value);
      return;
    case "PropertyAccess": {
      const recv = evalExpr(target.receiver, env, ctx) as Record<string, unknown>;
      recv[target.name] = value;
      return;
    }
    case "ElementAccess": {
      const recv = evalExpr(target.receiver, env, ctx) as Record<string, unknown> | unknown[];
      const idx = evalExpr(target.index, env, ctx) as string | number;
      (recv as Record<string, unknown>)[idx as string] = value;
      return;
    }
    case "es.Index": {
      // ES 0-based array index. Interpreter uses JS arrays which are 0-based,
      // so no adjustment.
      const arr = evalExpr(target.array, env, ctx) as unknown[];
      const idx = evalExpr(target.index, env, ctx) as number;
      arr[idx] = value;
      return;
    }
  }
  throw new InterpreterError(`unsupported assignment target: ${target.kind}`);
}

// ── Expressions ────────────────────────────────────────────────────────────

function evalExpr(e: Expr, env: Env, ctx: Ctx): Value {
  switch (e.kind) {
    case "NumericLiteral":
      return e.value;
    case "StringLiteral":
      return e.value;
    case "BooleanLiteral":
      return e.value;
    case "NullLiteral":
      return null;

    case "Identifier":
      return env.get(e.name);

    case "es.Global":
      return resolveEsGlobal(e.name);

    case "es.NumericAdd":
      return (evalExpr(e.left, env, ctx) as number) + (evalExpr(e.right, env, ctx) as number);

    case "es.StringConcat":
      // Build pass only emits this when both operands are statically
      // stringy; `esToString` codifies the ES ToString contract for the
      // Value union and gives the lint a `string`-typed handle.
      return esToString(evalExpr(e.left, env, ctx)) + esToString(evalExpr(e.right, env, ctx));

    case "Arithmetic": {
      const l = evalExpr(e.left, env, ctx) as number;
      const r = evalExpr(e.right, env, ctx) as number;
      switch (e.op) {
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
        case "%":
          return l % r;
        case "**":
          return l ** r;
      }
    }

    case "Comparison": {
      const l = evalExpr(e.left, env, ctx) as number | string;
      const r = evalExpr(e.right, env, ctx) as number | string;
      switch (e.op) {
        case "<":
          return l < r;
        case ">":
          return l > r;
        case "<=":
          return l <= r;
        case ">=":
          return l >= r;
      }
    }

    case "UnaryExpression":
      return -(evalExpr(e.operand, env, ctx) as number);

    case "LogicalNot":
      return !toBoolean(evalExpr(e.operand, env, ctx));

    case "es.Truthy":
      // ES truthiness. The leak-node punchline: this is the spec.
      return toBoolean(evalExpr(e.expr, env, ctx));

    case "es.Equality": {
      const l = evalExpr(e.left, env, ctx);
      const r = evalExpr(e.right, env, ctx);
      // strict ⇒ ===; non-strict ⇒ ==. JS operators give us both directly.
      const eq = e.strict ? (l as unknown) === (r as unknown) : (l as unknown) == (r as unknown);
      return e.negated ? !eq : eq;
    }

    case "es.LogicalExpression": {
      const l = evalExpr(e.left, env, ctx);
      if (e.op === "&&") return toBoolean(l) ? evalExpr(e.right, env, ctx) : l;
      return toBoolean(l) ? l : evalExpr(e.right, env, ctx);
    }

    case "es.Conditional":
      return toBoolean(evalExpr(e.cond, env, ctx))
        ? evalExpr(e.whenTrue, env, ctx)
        : evalExpr(e.whenFalse, env, ctx);

    case "Call": {
      const callee = evalExpr(e.callee, env, ctx);
      const args = e.args.map((a) => evalExpr(a, env, ctx));
      return callFunction(callee, args, ctx);
    }

    case "ArrayLit":
      return e.elements.map((el) => evalExpr(el, env, ctx)) as unknown[];

    case "PropertyAccess": {
      const recv = evalExpr(e.receiver, env, ctx);
      return readMember(recv, e.name);
    }

    case "ElementAccess": {
      const recv = evalExpr(e.receiver, env, ctx) as Record<string, unknown> | unknown[];
      const idx = evalExpr(e.index, env, ctx) as string | number;
      return (recv as Record<string, unknown>)[idx as string] as Value;
    }

    case "es.ArrayLength":
      return (evalExpr(e.array, env, ctx) as unknown[]).length;

    case "es.Index": {
      const arr = evalExpr(e.array, env, ctx) as unknown[];
      const idx = evalExpr(e.index, env, ctx) as number;
      return arr[idx] as Value;
    }

    case "Function":
      return {
        __closure: true,
        params: e.params,
        body: e.body,
        env,
        shape: e.shape,
      };

    case "es.ObjectLiteral": {
      const obj: Record<string, unknown> = {};
      for (const m of e.members) {
        if (m.kind === "spread") {
          const src = evalExpr(m.value, env, ctx);
          if (src && typeof src === "object") Object.assign(obj, src);
          continue;
        }
        const key = objectKeyToString(m.key, env, ctx);
        obj[key] = evalExpr(m.value, env, ctx);
      }
      return obj;
    }
  }
  throw new InterpreterError(`unsupported expression: ${(e as { kind: string }).kind}`);
}

function callFunction(callee: Value, args: Value[], ctx: Ctx): Value {
  if (typeof callee === "function") {
    return (callee as HostFn)(...args);
  }
  if (!isClosure(callee)) {
    throw new InterpreterError(`call to non-function (${typeof callee})`);
  }
  const callEnv = callee.env.child();
  for (let i = 0; i < callee.params.length; i++) {
    const p = callee.params[i]!;
    callEnv.bind(p.name, args[i]);
  }
  const sig = execBlock(callee.body, callEnv, ctx);
  return sig.kind === "return" ? sig.value : undefined;
}

function readMember(recv: Value, name: string): Value {
  if (recv === null || recv === undefined) {
    throw new InterpreterError(`property access on ${recv}`);
  }
  if (Array.isArray(recv)) {
    if (name === "length") return recv.length;
    if (name === "push") {
      const arr = recv;
      return ((...items: Value[]) => {
        arr.push(...items);
        return arr.length;
      }) as HostFn;
    }
    if (name === "map") {
      const arr = recv;
      return ((fn: Value) =>
        arr.map((el) =>
          callFunction(fn, [el as Value], { host: { print: () => undefined }, stdoutChunks: [] }),
        )) as HostFn;
    }
  }
  return (recv as Record<string, unknown>)[name] as Value;
}

function objectKeyToString(key: ObjectKey, env: Env, ctx: Ctx): string {
  if (key.kind === "static") return key.name;
  return esToString(evalExpr(key.expr, env, ctx));
}

// ES ToString over the Value union. Pragmatic, not spec-perfect: no
// Symbol.toPrimitive or custom valueOf chains. Sufficient for the IR
// sites that need string coercion (es.StringConcat, computed object
// keys), which the build pass already restricts to stringy operands.
function esToString(v: Value): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((el) => esToString(el as Value)).join(",");
  if (isClosure(v) || typeof v === "function") return "function";
  return "[object Object]";
}

function resolveEsGlobal(name: string): Value {
  switch (name) {
    case "undefined":
      return undefined;
    case "NaN":
      return NaN;
    case "Infinity":
      return Infinity;
    case "globalThis":
      // Empty stand-in. Tests that rely on globalThis would need to extend
      // the host with specific bindings.
      return {};
  }
  throw new InterpreterError(`unknown es.Global: ${name}`);
}

function toBoolean(v: Value): boolean {
  // ES truthiness exactly: 0/-0/NaN/""/null/undefined/false → false.
  return Boolean(v);
}
