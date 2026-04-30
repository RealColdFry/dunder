// What the target Lua runtime provides. Lowering dispatches on capability
// shape, never on preset/version identity. Presets are convenience
// constructors; user overrides spread a preset and override fields.

export interface LuaCapabilities {
  /**
   * How `arr.length` emits.
   * - `native`: `#arr` (Lua 5.1+, LuaJIT, Luau).
   * - `tableGetn`: `table.getn(arr)` (Lua 5.0).
   * - `call`: `<fn>(arr)` host adapter.
   */
  arrayLength:
    | {
        kind: "native";
      }
    | {
        kind: "tableGetn";
      }
    | {
        kind: "call";
        fn: string;
      };

  /**
   * Array → multi-return spread.
   * - `global`: `unpack(arr, 1, n)` (Lua 5.0/5.1/JIT). 5.0 ignores bounds.
   * - `table`: `table.unpack(arr, 1, n)` (Lua 5.2+/Luau).
   * - `lualib`: `__TS__Unpack(arr)`, requires lualib.
   */
  unpack:
    | {
        kind: "global";
        supportsBounds: boolean;
      }
    | {
        kind: "table";
      }
    | {
        kind: "lualib";
      };

  /**
   * `goto`/`::label::`. Lua 5.2+, Luau, modern LuaJIT.
   */
  hasGoto: boolean;

  /**
   * Native `continue` (Luau). Currently unused: it skips the loop tail,
   * which would skip ES-required update statements.
   */
  hasNativeContinue: boolean;

  /**
   * How modulo emits.
   * - `operator`: `a % b` (Lua 5.1+, Luau, LuaJIT). Sign-of-divisor;
   *   diverges from ES (DIV-MOD-001) but cheap.
   * - `fn`: `<name>(a, b)`, where `name` is `math.fmod` on 5.1+ and
   *   `math.mod` on 5.0 (renamed in 5.1). Both round toward zero,
   *   matching ES. An ES-faithful backend on any target may opt into
   *   this form; for 5.0 there is no other option since the operator
   *   doesn't exist.
   */
  mod:
    | {
        kind: "operator";
      }
    | {
        kind: "fn";
        fn: string;
      };
}

// ── Presets ────────────────────────────────────────────────────────────────

export const Lua50: LuaCapabilities = {
  arrayLength: {
    kind: "tableGetn",
  },
  unpack: {
    kind: "global",
    supportsBounds: false,
  },
  hasGoto: false,
  hasNativeContinue: false,
  // 5.0 has no `%` operator; `math.mod` (renamed `math.fmod` in 5.1)
  // is the only option.
  mod: {
    kind: "fn",
    fn: "math.mod",
  },
};

export const Lua51: LuaCapabilities = {
  arrayLength: {
    kind: "native",
  },
  unpack: {
    kind: "global",
    supportsBounds: true,
  },
  hasGoto: false,
  hasNativeContinue: false,
  mod: {
    kind: "operator",
  },
};

export const Lua52: LuaCapabilities = {
  arrayLength: {
    kind: "native",
  },
  unpack: {
    kind: "table",
  },
  hasGoto: true,
  hasNativeContinue: false,
  mod: {
    kind: "operator",
  },
};

export const Lua53: LuaCapabilities = {
  arrayLength: {
    kind: "native",
  },
  unpack: {
    kind: "table",
  },
  hasGoto: true,
  hasNativeContinue: false,
  mod: {
    kind: "operator",
  },
};

export const Lua54: LuaCapabilities = {
  arrayLength: {
    kind: "native",
  },
  unpack: {
    kind: "table",
  },
  hasGoto: true,
  hasNativeContinue: false,
  mod: {
    kind: "operator",
  },
};

export const Lua55: LuaCapabilities = {
  arrayLength: {
    kind: "native",
  },
  unpack: {
    kind: "table",
  },
  hasGoto: true,
  hasNativeContinue: false,
  mod: {
    kind: "operator",
  },
};

export const LuaJIT: LuaCapabilities = {
  arrayLength: {
    kind: "native",
  },
  unpack: {
    kind: "global",
    supportsBounds: true,
  },
  hasGoto: true,
  hasNativeContinue: false,
  mod: {
    kind: "operator",
  },
};

export const Luau: LuaCapabilities = {
  arrayLength: {
    kind: "native",
  },
  unpack: {
    kind: "table",
  },
  hasGoto: true,
  hasNativeContinue: true,
  mod: {
    kind: "operator",
  },
};

// TSTL's "universal" target: 5.1 and up. 5.0 is excluded, so the `%`
// operator and native `#` are available; goto is not (5.1 lacks it).
// `unpack` goes through the lualib helper to abstract over the
// 5.1-global-`unpack` vs 5.2-`table.unpack` split.
export const Universal: LuaCapabilities = {
  arrayLength: {
    kind: "native",
  },
  unpack: {
    kind: "lualib",
  },
  hasGoto: false,
  hasNativeContinue: false,
  mod: {
    kind: "operator",
  },
};

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
