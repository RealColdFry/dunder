import { API } from "@typescript/native-preview/async";
import { defaultBackend } from "./backend/default.ts";
import type { Backend } from "./backend/types.ts";
import { fromTsgoDiagnostic } from "./diagnostics/from-ts.ts";
import type { Diagnostic } from "./diagnostics/types.ts";
import { resolve as resolveAst } from "./frontend/tsgo.ts";
import { buildModule } from "./build/index.ts";
import { printModule } from "./ir/print.ts";
import type { Module } from "./ir/types.ts";
import { lowerModule } from "./lua/lower/index.ts";
import { print as printLua } from "./lua/printer.ts";

export interface ProcessFileResult {
  diagnostics: Diagnostic[];
  ir: string;
  lua: string;
  // Raw IR Module. Tests use this for the IR interpreter; the CLI ignores it.
  module: Module;
}

export async function processFile(opts: {
  api: API;
  projectPath: string;
  filePath: string;
  backend?: Backend;
}): Promise<ProcessFileResult> {
  const { api, projectPath, filePath, backend = defaultBackend } = opts;
  const snapshot = await api.updateSnapshot({
    openProject: projectPath,
  });
  const project = snapshot.getProject(projectPath);
  if (!project) throw new Error(`project not loaded: ${projectPath}`);

  const sourceFile = await project.program.getSourceFile(filePath);
  if (!sourceFile) throw new Error(`source file not in project: ${filePath}`);

  const syntactic = await project.program.getSyntacticDiagnostics(filePath);
  const semantic = await project.program.getSemanticDiagnostics(filePath);
  const diagnostics: Diagnostic[] = [
    ...syntactic.map((d) => fromTsgoDiagnostic(d, "syntactic")),
    ...semantic.map((d) => fromTsgoDiagnostic(d, "semantic")),
  ];

  const resolved = await resolveAst(sourceFile, project.checker);
  const mod = buildModule(resolved);
  const ir = printModule(mod);
  const lua = printLua(lowerModule(mod, backend.target));
  return {
    diagnostics,
    ir,
    lua,
    module: mod,
  };
}
