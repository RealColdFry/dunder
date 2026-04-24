// Jest config for running TSTL's test suite against dunder.
//
// rootDir points at extern/tstl so TSTL's specs can resolve their relative
// imports unmodified. Setup file lives in dunder's scripts/ dir; loaded by
// absolute path.

const path = require("path");
const tstlRoot = path.resolve(__dirname, "../../extern/tstl");

/** @type {import('jest').Config} */
module.exports = {
  rootDir: tstlRoot,
  watchman: false,
  // Default: all spec files. Filter with --testPathPattern=<substring> on
  // the CLI, e.g. `npm run tstl-tests -- --testPathPattern=conditionals`.
  testMatch: ["<rootDir>/test/unit/**/*.spec.ts"],
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts", path.resolve(__dirname, "setup.ts")],
  testEnvironment: "node",
  testRunner: "jest-circus/runner",
  preset: "ts-jest",
  transform: {
    "^.+\\.ts?$": [
      "ts-jest",
      {
        tsconfig: path.resolve(__dirname, "tsconfig.json"),
        diagnostics: { warnOnly: true },
      },
    ],
  },
};
