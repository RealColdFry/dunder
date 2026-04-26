// Programmatic pipeline. Callers own the `API` lifecycle.

import { API } from "@typescript/native-preview/async";
import { resolve as resolveAst } from "./frontend.ts";
import { buildModule } from "./build/index.ts";
import { printModule } from "./ir/print.ts";
import { LuaJIT, type LuaCapabilities } from "./lua/capabilities.ts";
import { lowerModule } from "./lua/lower/index.ts";
import { print as printLua } from "./lua/printer.ts";

export interface ProcessFileResult {
  diagnostics: string[];
  ir: string;
  lua: string;
}

export async function processFile(opts: {
  api: API;
  projectPath: string;
  filePath: string;
  target?: LuaCapabilities;
}): Promise<ProcessFileResult> {
  const { api, projectPath, filePath, target = LuaJIT } = opts;
  const snapshot = await api.updateSnapshot({ openProject: projectPath });
  const project = snapshot.getProject(projectPath);
  if (!project) throw new Error(`project not loaded: ${projectPath}`);

  const sourceFile = await project.program.getSourceFile(filePath);
  if (!sourceFile) throw new Error(`source file not in project: ${filePath}`);

  const syntactic = await project.program.getSyntacticDiagnostics(filePath);
  const semantic = await project.program.getSemanticDiagnostics(filePath);
  const diagnostics = [...syntactic, ...semantic].map((d) => d.text);

  const resolved = await resolveAst(sourceFile, project.checker);
  const mod = buildModule(resolved);
  const ir = printModule(mod);
  const lua = printLua(lowerModule(mod, target));
  return { diagnostics, ir, lua };
}
