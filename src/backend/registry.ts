// Backend lookup. CLI `--target=<name>` resolves through here.
//
// Step 1 surface: only the default backend exists, plus thin wrappers around
// the existing capability presets so `--target=5.4` etc. keep working
// without a real backend definition. Each preset becomes a synthetic
// "default-on-<flavor>" backend with the named LuaCapabilities and otherwise
// empty slots. Real backends register themselves once they exist.

import { tstlBackend } from "../backends/tstl/index.ts";
import { presetByName } from "../lua/capabilities.ts";
import { defaultBackend } from "./default.ts";
import type { Backend } from "./types.ts";

const registered = new Map<string, Backend>([
  [defaultBackend.name, defaultBackend],
  [tstlBackend.name, tstlBackend],
]);

export function registerBackend(backend: Backend): void {
  if (registered.has(backend.name)) {
    throw new Error(`backend already registered: ${backend.name}`);
  }
  registered.set(backend.name, backend);
}

// Non-throwing lookup. Tries registered backends first, then capability
// presets (so a name like "5.4" resolves to a synthetic
// `default-on-5.4` backend with that target). Returns undefined when
// neither matches. Used by the test harness to pick a backend by group
// name without forcing every preset to be pre-registered.
export function lookupBackend(name: string): Backend | undefined {
  const direct = registered.get(name);
  if (direct) return direct;
  const preset = presetByName(name);
  if (preset) {
    return {
      ...defaultBackend,
      name: `default-on-${name}`,
      target: preset,
    };
  }
  return undefined;
}

// Resolve a backend by name. Falls back to the capability-preset shim for
// legacy `--target=5.4`-style targets so the CLI behaves as before until
// the slot framework is fully wired through the pipeline.
export function resolveBackend(name?: string): Backend {
  if (!name) return defaultBackend;
  const direct = registered.get(name);
  if (direct) return direct;
  const preset = presetByName(name);
  if (preset) {
    return {
      ...defaultBackend,
      name: `default-on-${name}`,
      target: preset,
    };
  }
  throw new Error(`unknown backend or target preset: ${name}`);
}
