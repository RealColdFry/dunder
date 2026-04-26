import { API } from "@typescript/native-preview/async";
import { SyntaxKind, type Node } from "@typescript/native-preview/ast";
import { defineCommand, runMain } from "citty";
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { buildModule } from "./build/index.ts";
import { resolve } from "./frontend.ts";
import { printModule } from "./ir/print.ts";
import { presetByName, type LuaCapabilities } from "./lua/capabilities.ts";
import { lowerModule } from "./lua/lower/index.ts";
import { print as printLua } from "./lua/printer.ts";
import { resolveTsgoBin } from "./tsgo-bin.ts";

function findTsconfig(fromFile: string): string {
  let dir = dirname(resolvePath(fromFile));
  while (true) {
    const candidate = resolvePath(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no tsconfig.json found above ${fromFile}`);
    dir = parent;
  }
}

const main = defineCommand({
  meta: {
    name: "dunder",
    description: "TypeScript-native Lua transpiler",
  },
  args: {
    file: {
      type: "positional",
      description: "TypeScript source file",
      required: true,
    },
    ast: {
      type: "boolean",
      description: "print the TS AST",
      default: false,
    },
    ir: {
      type: "boolean",
      description: "print the dunder IR",
      default: false,
    },
    emit: {
      type: "boolean",
      description: "emit Lua",
      default: true,
    },
    target: {
      type: "string",
      description: "Lua target preset: 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, JIT, Luau, universal",
      default: "JIT",
    },
  },
  async run({ args }) {
    const target: LuaCapabilities | undefined = presetByName(args.target);
    if (!target) {
      console.error(`unknown target preset: ${args.target}`);
      process.exit(2);
    }

    const baseDir = process.env.INIT_CWD ?? process.cwd();
    const targetFile = resolvePath(baseDir, args.file);
    if (!existsSync(targetFile)) {
      console.error(`file not found: ${targetFile}`);
      process.exit(2);
    }

    const tsconfigPath = findTsconfig(targetFile);
    const projectDir = dirname(tsconfigPath);

    const sectionCount = (args.ast ? 1 : 0) + (args.ir ? 1 : 0) + (args.emit ? 1 : 0);
    const showHeaders = sectionCount > 1;

    const api = new API({
      tsserverPath: resolveTsgoBin(),
      cwd: projectDir,
    });

    try {
      const snapshot = await api.updateSnapshot({ openProject: tsconfigPath });
      const project = snapshot.getProject(tsconfigPath);
      if (!project) throw new Error(`project not loaded: ${tsconfigPath}`);

      const sourceFile = await project.program.getSourceFile(targetFile);
      if (!sourceFile) throw new Error(`source file not in project: ${targetFile}`);

      const syntactic = await project.program.getSyntacticDiagnostics(targetFile);
      const semantic = await project.program.getSemanticDiagnostics(targetFile);
      for (const d of [...syntactic, ...semantic]) {
        console.error(d.text);
      }

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
        if (args.ir) {
          if (showHeaders) console.log("[ir]");
          console.log(printModule(mod));
        }
        if (args.emit) {
          if (showHeaders) console.log("[lua]");
          process.stdout.write(printLua(lowerModule(mod, target)));
        }
      }
    } finally {
      await api.close();
    }
  },
});

runMain(main);
