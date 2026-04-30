// The default backend: dunder's baseline ES → Lua story with no divergence.
// Empty ambient (relies on dunder's baseline ES lib), no validators, no
// lowering overrides. Running dunder with no `--target` flag selects this.
//
// Deliberately trivial. Real backends declare their divergence by populating
// one or more of the slots; this one populates none, so it doubles as the
// reference for "what does the default lowering do." Behavioral changes here
// are changes to dunder itself, not to a plugin.

import { LuaJIT } from "../lua/capabilities.ts";
import type { Backend } from "./types.ts";

export const defaultBackend: Backend = {
  name: "default",
  target: LuaJIT,
  ambient: {
    files: [],
  },
  validators: [],
  lowerings: {},
};
