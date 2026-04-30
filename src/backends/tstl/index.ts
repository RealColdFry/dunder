// TSTL-compat backend. Currently surfaces a subset of TSTL's diagnostics
// (this-conversion, truthy-only-condition); ambient lib and lowering
// overrides are placeholders. As more validators land, they bundle here.

import type { Backend } from "../../backend/types.ts";
import { LuaJIT } from "../../lua/capabilities.ts";
import { thisConversion } from "./validators/this-conversion.ts";
import { truthyOnlyCondition } from "./validators/truthy-only-condition.ts";

export const tstlBackend: Backend = {
  name: "tstl",
  target: LuaJIT,
  ambient: { files: [] },
  validators: [thisConversion, truthyOnlyCondition],
  lowerings: {},
};
