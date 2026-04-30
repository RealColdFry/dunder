// Lua execution for parity tests. Wraps `lua-wasm-bindings` so a piece
// of dunder-emitted Lua can run, call its `__main`, and return the
// result back to JS as a JSON-decoded value. The same source is also
// run through `js-exec.ts` to produce the JS oracle for comparison.
//
// Per-version bindings: dunder's Lua target maps to a matching WASM
// build (5.0-5.5; Universal uses 5.1). LuaJIT and Luau intentionally
// have no fallback. They are semantically distinct from any standard
// Lua version (different number model, FFI, JIT-only behavior for JIT;
// fully different runtime for Luau), so conflating with 5.4 would
// silently green-light tests that misbehave on the real runtime.
// Parity for those targets waits for a real `luajit` / `lune` binary
// shell-out; until then `canParity()` reports false and the test
// runner skips the parity assertion (snapshot still runs).

import { createRequire } from "node:module";
import type { LauxLib, Lua, LuaLib } from "lua-wasm-bindings/dist/lua.js";
import { LUA_OK } from "lua-wasm-bindings/dist/lua.js";
import type { LuaCapabilities } from "#/lua/capabilities.ts";
import { Lua50, Lua51, Lua52, Lua53, Lua54, Lua55, Universal } from "#/lua/capabilities.ts";

// `require` shim: the bindings ship as CJS modules with `wasm` payloads
// alongside; the binding-factory uses Node's native `require` which
// vitest's import path doesn't expose to ESM modules. Recreate the CJS
// require relative to this file.
const requireCjs = createRequire(import.meta.url);

interface VersionBinding {
  lauxlib: LauxLib;
  lua: Lua;
  lualib: LuaLib;
}

// Lazily load each version: vitest exec time is dominated by startup,
// and most test suites only touch one or two versions.
const cache = new Map<string, VersionBinding>();
function loadBindings(slug: string): VersionBinding {
  const cached = cache.get(slug);
  if (cached) return cached;
  const m = requireCjs(`lua-wasm-bindings/dist/lua.${slug}`) as VersionBinding;
  cache.set(slug, m);
  return m;
}

// Whether this target has a real VM in `lua-wasm-bindings`. Test
// runners gate the parity assertion on this; LuaJIT/Luau intentionally
// return false (no semantically-faithful WASM available).
export function canParity(target: LuaCapabilities): boolean {
  return (
    target === Lua50 ||
    target === Lua51 ||
    target === Lua52 ||
    target === Lua53 ||
    target === Lua54 ||
    target === Lua55 ||
    target === Universal
  );
}

function bindingsFor(target: LuaCapabilities): VersionBinding {
  if (target === Lua50) return loadBindings("50");
  if (target === Lua51) return loadBindings("51");
  if (target === Lua52) return loadBindings("52");
  if (target === Lua53) return loadBindings("53");
  if (target === Lua54) return loadBindings("54");
  if (target === Lua55) return loadBindings("55");
  // Universal targets the lowest-common-denominator semantics; closest
  // real VM is 5.1.
  if (target === Universal) return loadBindings("51");
  // canParity should have gated us before reaching this; throw rather
  // than silently substitute, so a missed gate is loud.
  throw new Error(
    "lua-wasm-bindings has no VM for this target; gate the parity check with canParity()",
  );
}

// Tiny Lua-side JSON encoder. Inlined into the chunk we run so the
// final value of `__main()` can travel back to JS as a string. Handles
// nil / booleans / numbers / strings / arrays (1-indexed contiguous) /
// plain-keyed objects. Functions and userdata become null.
//
// JSON cannot represent NaN/Infinity; encode them as null so the JS
// oracle's `JSON.stringify(NaN)` (also `null`) matches.
//
// Compatible with Lua 5.0+: avoids the `#` length operator (5.1+) and
// uses `table.insert` instead. The encoder runs against the parity
// VM, which can be 5.0, so we can't assume modern syntax even though
// dunder's *output* may be modern.
const LUA_JSON_ENCODER = `
local function __dunder_json_string(s)
  return '"' .. string.gsub(s, '[%c\\\\"]', function(c)
    if c == '\\\\' then return '\\\\\\\\' end
    if c == '"' then return '\\\\"' end
    if c == '\\n' then return '\\\\n' end
    if c == '\\r' then return '\\\\r' end
    if c == '\\t' then return '\\\\t' end
    return string.format('\\\\u%04x', string.byte(c))
  end) .. '"'
end

local __dunder_inf = 1/0
local __dunder_ninf = -1/0
local function __dunder_json(v)
  local t = type(v)
  if t == "nil" then return "null" end
  if t == "boolean" then return v and "true" or "false" end
  if t == "number" then
    if v ~= v or v == __dunder_inf or v == __dunder_ninf then return "null" end
    return tostring(v)
  end
  if t == "string" then return __dunder_json_string(v) end
  if t == "table" then
    local n = 0
    for _ in pairs(v) do n = n + 1 end
    if n == 0 then return "[]" end
    local isArray = true
    for i = 1, n do if v[i] == nil then isArray = false; break end end
    local parts = {}
    if isArray then
      for i = 1, n do parts[i] = __dunder_json(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    for k, vv in pairs(v) do
      table.insert(parts, __dunder_json_string(tostring(k)) .. ":" .. __dunder_json(vv))
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
`;

export interface LuaExecResult {
  ok: true;
  value: unknown;
}

export interface LuaExecError {
  ok: false;
  error: string;
}

// Run dunder-emitted Lua, call its `__main`, return the result decoded.
// The emit is expected to look like
//   local ____exports = {}
//   function ____exports.__main() ... end
//   return ____exports
// which we wrap in an IIFE so we can grab the exports table without
// polluting the chunk's environment.
export function execLua(emittedLua: string, target: LuaCapabilities): LuaExecResult | LuaExecError {
  const { lauxlib, lua, lualib } = bindingsFor(target);
  const L = lauxlib.luaL_newstate();
  try {
    lualib.luaL_openlibs(L);

    const wrapped =
      LUA_JSON_ENCODER +
      `\nlocal __dunder_module = (function()\n${emittedLua}\nend)()\n` +
      `return __dunder_json(__dunder_module.__main())\n`;

    const status = lauxlib.luaL_dostring(L, wrapped);
    if (status !== LUA_OK) {
      const message = lua.lua_tostring(L, -1);
      if (process.env.DUNDER_DEBUG_LUA_EXEC === "1") {
        const numbered = wrapped
          .split("\n")
          .map((l, i) => `${(i + 1).toString().padStart(3)}| ${l}`)
          .join("\n");
        console.error(`[lua-exec] wrapped chunk:\n${numbered}`);
      }
      return { ok: false, error: `lua error: ${message}` };
    }
    if (!lua.lua_isstring(L, -1)) {
      return { ok: false, error: `lua chunk did not return a string` };
    }
    const json = lua.lua_tostring(L, -1);
    return { ok: true, value: JSON.parse(json) };
  } finally {
    lua.lua_close(L);
  }
}
