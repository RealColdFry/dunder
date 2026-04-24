# dunder

Prototype TypeScript-to-Lua transpiler driven by tsgo's IPC API. An experiment in expressing ECMAScript semantics through the IR, with target-shaped divergences pushed to the backend.

## Flow

Three layers, roughly:

1. Frontend walks the AST and gathers nodes that need type info.
2. Frontend issues a batched IPC query to tsgo (usually a few round trips).
3. IR build: a sync walk over the cached types.
4. Backend lowers the IR to a Lua AST.

The IR is the contract between frontend and backend, and nothing past the frontend talks to tsgo.

### IR shape

One tree, two kinds of nodes: Lua AST shapes for boring constructs, ES operation nodes that hold onto ES semantics so backends can choose to honor or discard them downstream. The boring set is smaller than it looks. When in doubt, lean ES.

## Working with the IPC API

dunder is an early downstream consumer of tsgo's IPC API. When dunder needs a checker capability that isn't exposed, the rough plan is to compose it from what's already there. A surprising amount falls out of `getSymbolAtLocation`, `getTypeOfSymbol`, `TypeFlags`, and friends. If composition can't get there, the method becomes a candidate to propose upstream.

Any local patches dunder carries while a proposal is in flight are tracked in a small table (method, PR, status), aiming for the delta against upstream to shrink to zero as things land.

## Deferred

A few things parked for later.

### Compiler flags that affect emit

tsgo hands back a resolved `compilerOptions` (tsconfig + defaults + target-implied bits already merged). dunder reads that and branches on specific emit-affecting flags, never on `target` directly: `useDefineForClassFields`, `experimentalDecorators`, `emitDecoratorMetadata`, `esModuleInterop`, `verbatimModuleSyntax`. The type-checking ones (`strict*`, `noImplicitAny`, etc.) are tsc's problem. None of this matters until classes, decorators, or multi-file emit are in scope.

### Type-safe capability overrides

Overrides today are raw strings (`fn: "Len"`). Typos and signature mismatches blow up at runtime, which isn't great. The eventual idea is typed references: a `.d.ts` for the host runtime, overrides that point at those symbols. Waiting on a real user to need it.

### Lazy-checker interface

A `@dunder/legacy-checker` could wrap the async frontend in a sync-looking `Checker` (sync-RPC fibers or generators) for consumers used to tsc's checker shape. Same IPC underneath. The tricky bit is cross-method dependencies (later calls depend on earlier results); easiest answer is to accept K batched rounds rather than try to predict ahead.
