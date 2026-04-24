import { API } from "@typescript/native-preview/async";
import { SyntaxKind, type Node } from "@typescript/native-preview/ast";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { buildModule } from "./build.ts";
import { resolve } from "./frontend.ts";
import { printModule } from "./ir.ts";
import { LuaJIT, presetByName, type LuaCapabilities } from "./lua/capabilities.ts";
import { lowerModule } from "./lua/lower.ts";
import { print as printLua } from "./lua/printer.ts";

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

function resolveTsgoBin(): string {
  const require_ = createRequire(import.meta.url);
  const platformPkg = `@typescript/native-preview-${process.platform}-${process.arch}`;
  const pkgJson = require_.resolve(`${platformPkg}/package.json`);
  return resolvePath(dirname(pkgJson), "lib", process.platform === "win32" ? "tsgo.exe" : "tsgo");
}

const args = process.argv.slice(2);
const tree = args.includes("--tree");
const emitOnly = args.includes("--emit");
const targetArg = args.find((a) => a.startsWith("--target="));
const targetName = targetArg ? targetArg.slice("--target=".length) : "JIT";
const target: LuaCapabilities = presetByName(targetName) ?? LuaJIT;
if (targetArg && !presetByName(targetName)) {
  console.error(`unknown target preset: ${targetName}`);
  process.exit(2);
}
const fileArg = args.find((a) => !a.startsWith("--"));
if (!fileArg) {
  console.error("usage: driver [--tree|--emit] [--target=<preset>] <file.ts>");
  console.error("  presets: 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, JIT, Luau, universal");
  process.exit(2);
}

const baseDir = process.env.INIT_CWD ?? process.cwd();
const targetFile = resolvePath(baseDir, fileArg);
if (!existsSync(targetFile)) {
  console.error(`file not found: ${targetFile}`);
  process.exit(2);
}

const tsconfigPath = findTsconfig(targetFile);
const projectDir = dirname(tsconfigPath);

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
  if (!emitOnly) {
    console.log("[diagnostics] syntactic:", syntactic.length, "semantic:", semantic.length);
    for (const d of [...syntactic, ...semantic]) {
      console.log("  !", d.text);
    }
  } else {
    for (const d of [...syntactic, ...semantic]) {
      console.error(d.text);
    }
  }

  if (emitOnly) {
    const resolved = await resolve(sourceFile, project.checker);
    const mod = buildModule(resolved);
    process.stdout.write(printLua(lowerModule(mod, target)));
  } else if (tree) {
    console.log("[ast]");
    const dump = (node: Node, depth: number): void => {
      console.log(`${"  ".repeat(depth)}- ${SyntaxKind[node.kind]} (${node.pos}..${node.end})`);
      node.forEachChild((child) => dump(child, depth + 1));
    };
    sourceFile.forEachChild((child) => dump(child, 1));
  } else {
    const resolved = await resolve(sourceFile, project.checker);
    const mod = buildModule(resolved);
    console.log("[ir]");
    console.log(printModule(mod));
    console.log("[lua]");
    const luaFile = lowerModule(mod, target);
    process.stdout.write(printLua(luaFile));
  }
} finally {
  await api.close();
}
