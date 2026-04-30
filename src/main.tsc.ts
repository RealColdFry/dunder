// Synchronous CLI driver that runs through the tsc-based pipeline.
// Mirrors `src/main.ts` but skips tsgo IPC, so it works while the tsgo
// SyntaxKind drift is unresolved. AST printing uses tsc's own API.

import { defineCommand, runMain } from "citty";
import { dirname } from "node:path";
import ts from "typescript";
import {
  commonArgs,
  printIrSection,
  printLuaSection,
  resolveBackendOrExit,
  resolveSource,
  sectionDisplay,
} from "./cli/shared.ts";
import { render } from "./diagnostics/render.ts";
import { processFileSync } from "./pipeline.tsc.ts";

const main = defineCommand({
  meta: {
    name: "dunderts",
    description: "TypeScript-native Lua transpiler (tsc pipeline)",
  },
  args: commonArgs,
  run({ args }) {
    const backend = resolveBackendOrExit(args.target);
    const source = resolveSource(args);
    const { showHeaders } = sectionDisplay(args);

    try {
      if (args.ast) {
        const configFile = ts.readConfigFile(source.tsconfigPath, (p) => ts.sys.readFile(p));
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          dirname(source.tsconfigPath),
        );
        const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
        const sourceFile = program.getSourceFile(source.filePath);
        if (!sourceFile) throw new Error(`source file not in program: ${source.filePath}`);
        if (showHeaders) console.log("[ast]");
        const dump = (node: ts.Node, depth: number): void => {
          console.log(
            `${"  ".repeat(depth)}- ${ts.SyntaxKind[node.kind]} (${node.pos}..${node.end})`,
          );
          node.forEachChild((child) => dump(child, depth + 1));
        };
        sourceFile.forEachChild((child) => dump(child, 1));
      }

      const { diagnostics, ir, lua } = processFileSync({
        tsconfigPath: source.tsconfigPath,
        filePath: source.filePath,
        backend,
      });
      for (const d of diagnostics) console.error(render(d));

      if (args.ir) printIrSection(ir, showHeaders);
      if (args.emit) printLuaSection(lua, showHeaders);
    } finally {
      source.cleanup();
    }
  },
});

void runMain(main);
