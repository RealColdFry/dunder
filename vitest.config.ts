import { defineConfig } from "vitest/config";

// Mirrors tsconfig.json's customConditions; SSR variant for vitest's resolver.
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
  test: {
    include: ["tests/**/*.test.ts"],
    // lua-wasm-bindings ships an emscripten glue bundle that uses CJS-only
    // globals (__filename, document.currentScript checks) and inline
    // binary payloads. Vite's transformer chokes on it. Force Node to
    // load it as plain CJS via its native loader.
    server: {
      deps: {
        external: [/lua-wasm-bindings/],
      },
    },
  },
});
