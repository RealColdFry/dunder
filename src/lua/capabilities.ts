// Lua target capabilities.
//
// A `LuaCapabilities` value describes what the target Lua runtime provides:
// which length operator works, where `unpack` lives, whether bitwise is
// native, etc. The lowering pass dispatches on capability shape, never on
// preset/version identity. This is a generalization of tslua's
// methods-on-enum pattern: capabilities are first-class data; presets
// (Lua54, LuaJIT, etc.) are convenience constructors.
//
// Adding a new capability: extend the interface, add a default to every
// preset, dispatch in lower.ts. Adding a new preset: write the struct.
// User overrides: spread the preset and override individual fields.

export interface LuaCapabilities {
  /**
   * How `arr.length` (and similar array-length operations) emit.
   * - `native`: `#arr` (Lua 5.1+, LuaJIT, Luau).
   * - `tableGetn`: `table.getn(arr)` (Lua 5.0).
   * - `call`: `<fn>(arr)`, a host adapter (e.g. pilaoda's `Len`).
   */
  arrayLength: { kind: "native" } | { kind: "tableGetn" } | { kind: "call"; fn: string };

  /**
   * How to spread an array into multi-return values.
   * - `global`: `unpack(arr, 1, n)` (Lua 5.0/5.1/JIT). 5.0 ignores bounds.
   * - `table`: `table.unpack(arr, 1, n)` (Lua 5.2+/Luau).
   * - `lualib`: `__TS__Unpack(arr)`, universal fallback, requires lualib.
   */
  unpack: { kind: "global"; supportsBounds: boolean } | { kind: "table" } | { kind: "lualib" };
}

// ── Presets ────────────────────────────────────────────────────────────────
// One per supported Lua version + LuaJIT + Luau + Universal. Presets only
// declare capabilities that exist today in `LuaCapabilities`; new
// capabilities get defaults added across all presets in a single edit.

export const Lua50: LuaCapabilities = {
  arrayLength: { kind: "tableGetn" },
  unpack: { kind: "global", supportsBounds: false },
};

export const Lua51: LuaCapabilities = {
  arrayLength: { kind: "native" },
  unpack: { kind: "global", supportsBounds: true },
};

export const Lua52: LuaCapabilities = {
  arrayLength: { kind: "native" },
  unpack: { kind: "table" },
};

export const Lua53: LuaCapabilities = {
  arrayLength: { kind: "native" },
  unpack: { kind: "table" },
};

export const Lua54: LuaCapabilities = {
  arrayLength: { kind: "native" },
  unpack: { kind: "table" },
};

export const Lua55: LuaCapabilities = {
  arrayLength: { kind: "native" },
  unpack: { kind: "table" },
};

export const LuaJIT: LuaCapabilities = {
  arrayLength: { kind: "native" },
  unpack: { kind: "global", supportsBounds: true },
};

export const Luau: LuaCapabilities = {
  arrayLength: { kind: "native" },
  unpack: { kind: "table" },
};

export const Universal: LuaCapabilities = {
  arrayLength: { kind: "native" }, // 5.1-compatible baseline
  unpack: { kind: "lualib" },
};

// ── Preset lookup ──────────────────────────────────────────────────────────

export const presets: Record<string, LuaCapabilities> = {
  "5.0": Lua50,
  "5.1": Lua51,
  "5.2": Lua52,
  "5.3": Lua53,
  "5.4": Lua54,
  "5.5": Lua55,
  JIT: LuaJIT,
  Luau,
  universal: Universal,
};

export function presetByName(name: string): LuaCapabilities | undefined {
  return presets[name];
}
