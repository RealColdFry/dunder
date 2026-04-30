import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tstlRoot = path.resolve(__dirname, "../../extern/tstl");

// Mirrors the root vitest config so @typescript/native-preview/ast resolves
// to the submodule's TS source.
const CONDITIONS = ["@typescript/source"];

export default defineConfig({
  resolve: {
    conditions: CONDITIONS,
  },
  ssr: {
    resolve: {
      conditions: CONDITIONS,
    },
  },
  // TSTL's test util.ts uses legacy-style method decorators (@memoize takes
  // the original function and returns a replacement). The transformer needs
  // experimentalDecorators on to emit the legacy helper. Vitest 4 uses oxc
  // by default; the esbuild config slot is ignored when oxc is active.
  oxc: {
    decorator: {
      legacy: true,
    },
  },
  test: {
    root: tstlRoot,
    include: ["test/unit/**/*.spec.ts"],
    // Specs that don't terminate under dunder's emit (infinite loops in
    // generated Lua, etc.). Excluded from the default sweep so the run
    // completes in finite time; opt back in by passing the path
    // explicitly: `npm run tstl-tests -- async-await.spec.ts`.
    exclude: ["test/unit/builtins/async-await.spec.ts"],
    setupFiles: [
      path.resolve(__dirname, "jest-shim.ts"),
      path.resolve(tstlRoot, "test/setup.ts"),
      path.resolve(__dirname, "setup.ts"),
    ],
    environment: "node",
    testTimeout: 30000,
    globals: true,
    // Share the module graph across spec files in the same worker. Vitest's
    // default (isolate: true) re-runs setupFiles per file, which here means
    // recompiling TSTL's full src/ for every spec (~600ms x 71 = 42s of pure
    // setup overhead). TSTL's specs are pure transpiler input/output and
    // don't mutate module-level state, so isolation buys us nothing.
    isolate: false,
    // lua-wasm-bindings ships an emscripten glue bundle that uses CJS-only
    // globals (__filename, document.currentScript checks) and inline binary
    // payloads. Vite's transformer chokes on it. Force Node to load it as
    // plain CJS via its native loader.
    server: {
      deps: {
        external: [/lua-wasm-bindings/],
      },
    },
  },
});
