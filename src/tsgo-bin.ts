import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

// Resolution order: DUNDER_TSGO_BIN > extern/typescript-go/built/local/tsgo.
// No npm-preview fallback; binary must match the submodule fork's bindings.
const TSGO_EXE = process.platform === "win32" ? "tsgo.exe" : "tsgo";

export function resolveTsgoBin(): string {
  const override = process.env.DUNDER_TSGO_BIN;
  if (override) {
    const abs = resolvePath(override);
    if (!existsSync(abs)) {
      throw new Error(`DUNDER_TSGO_BIN points to missing file: ${abs}`);
    }
    return abs;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const submoduleBin = resolvePath(here, "..", "extern", "typescript-go", "built", "local", TSGO_EXE);
  if (existsSync(submoduleBin)) return submoduleBin;

  throw new Error(
    `tsgo binary not found at ${submoduleBin}. Run \`npm run tsgo:build\` ` +
      `(or set DUNDER_TSGO_BIN to a built tsgo elsewhere).`,
  );
}
