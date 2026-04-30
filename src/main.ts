import { API } from "@typescript/native-preview/async";
import { SyntaxKind, type Node } from "@typescript/native-preview/ast";
import { defineCommand, runMain } from "citty";
import { dirname } from "node:path";
import { buildModule } from "./build/index.ts";
import {
  commonArgs,
  printIrSection,
  printLuaSection,
  resolveBackendOrExit,
  resolveSource,
  sectionDisplay,
} from "./cli/shared.ts";
import { fromTsgoDiagnostic } from "./diagnostics/from-ts.ts";
import { render } from "./diagnostics/render.ts";
import { resolve } from "./frontend/tsgo.ts";
import { resolveTsgoBin } from "./frontend/tsgo-bin.ts";
import { printModule } from "./ir/print.ts";
import { lowerModule } from "./lua/lower/index.ts";
import { print as printLua } from "./lua/printer.ts";

const main = defineCommand({
  meta: {
    name: "dunder",
    description: "TypeScript-native Lua transpiler",
  },
  args: commonArgs,
  async run({ args }) {
    const backend = resolveBackendOrExit(args.target);
    const source = resolveSource(args);
    const projectDir = dirname(source.tsconfigPath);
    const { showHeaders } = sectionDisplay(args);

    const api = new API({
      tsserverPath: resolveTsgoBin(),
      cwd: projectDir,
    });

    try {
      const snapshot = await api.updateSnapshot({
        openProject: source.tsconfigPath,
      });
      const project = snapshot.getProject(source.tsconfigPath);
      if (!project) throw new Error(`project not loaded: ${source.tsconfigPath}`);

      const sourceFile = await project.program.getSourceFile(source.filePath);
      if (!sourceFile) throw new Error(`source file not in project: ${source.filePath}`);

      const syntactic = await project.program.getSyntacticDiagnostics(source.filePath);
      const semantic = await project.program.getSemanticDiagnostics(source.filePath);
      for (const d of syntactic) console.error(render(fromTsgoDiagnostic(d, "syntactic")));
      for (const d of semantic) console.error(render(fromTsgoDiagnostic(d, "semantic")));

      if (args.ast) {
        if (showHeaders) console.log("[ast]");
        const dump = (node: Node, depth: number): void => {
          console.log(`${"  ".repeat(depth)}- ${SyntaxKind[node.kind]} (${node.pos}..${node.end})`);
          node.forEachChild((child) => dump(child, depth + 1));
        };
        sourceFile.forEachChild((child) => dump(child, 1));
      }

      if (args.ir || args.emit) {
        const resolved = await resolve(sourceFile, project.checker);
        const mod = buildModule(resolved);
        if (args.ir) printIrSection(printModule(mod), showHeaders);
        if (args.emit) printLuaSection(printLua(lowerModule(mod, backend.target)), showHeaders);
      }
    } finally {
      await api.close();
      source.cleanup();
    }
  },
});

void runMain(main);
