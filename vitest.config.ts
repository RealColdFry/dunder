import { defineConfig } from "vitest/config";

// Mirrors tsconfig.json's customConditions; SSR variant for vitest's resolver.
const CONDITIONS = ["@typescript/source"];

export default defineConfig({
  resolve: { conditions: CONDITIONS },
  ssr: { resolve: { conditions: CONDITIONS } },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
