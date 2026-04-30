// Adapter that lets TSTL's test code (written for jest) run under vitest.
// TSTL is a submodule (extern/tstl/) we don't fork, so the shim is the only
// place the jest API surface lives in our world.
//
// Coverage today: jest.spyOn, jest.fn, jest.setTimeout. Add entries when a
// TSTL submodule bump pulls in a new jest.* callsite.

import { vi } from "vitest";

const jestShim = {
  spyOn: vi.spyOn.bind(vi),
  fn: vi.fn.bind(vi),
  // testTimeout is set globally in vitest.config.ts; per-spec overrides via
  // jest.setTimeout become no-ops, which is the conservative choice.
  setTimeout: (_ms: number) => {},
};

(globalThis as Record<string, unknown>).jest = jestShim;
