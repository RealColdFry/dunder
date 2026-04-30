import ts from "typescript";
import { defaultBackend } from "./backend/default.ts";
import type { Backend } from "./backend/types.ts";
import { runValidators } from "./backend/validator-runtime.ts";
import { fromTscDiagnostic } from "./diagnostics/from-ts.ts";
import type { Diagnostic } from "./diagnostics/types.ts";
import { resolve as resolveAst } from "./frontend/tsc.ts";
import { buildModule } from "./build/index.ts";
import { printModule } from "./ir/print.ts";
import { lowerModule } from "./lua/lower/index.ts";
import { print as printLua } from "./lua/printer.ts";
import { type ProcessFileResult } from "./pipeline.ts";

// Process-scoped cache for lib.*.d.ts SourceFiles. Parsing the ES lib chain
// dominates per-call cost when this pipeline is invoked many times in one
// process (e.g. the TSTL test harness). Mirrors TSTL's own libCache.
//
// Scope is restricted to files under the TS install's lib directory so we
// never cache user sources, which live in per-test tmpdirs and would bloat
// the cache without ever hitting again. Different lib selections (es5 vs
// esnext) and noLib: true work for free: distinct filenames key separate
// entries; noLib programs simply don't consult the host for libs.
const libSourceFileCache = new Map<string, ts.SourceFile>();

function makeCachingHost(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options);
  const libDir = host.getDefaultLibLocation?.();
  if (!libDir) return host;

  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const cacheable = fileName.startsWith(libDir);
    if (cacheable) {
      const versionKey =
        typeof languageVersion === "number" ? languageVersion : languageVersion.languageVersion;
      const key = `${fileName}::${versionKey}`;
      const cached = libSourceFileCache.get(key);
      if (cached) return cached;
      const sf = originalGetSourceFile(fileName, languageVersion, onError, shouldCreate);
      if (sf) libSourceFileCache.set(key, sf);
      return sf;
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  return host;
}

export function processFileSync(opts: {
  tsconfigPath: string;
  filePath: string;
  backend?: Backend;
}): ProcessFileResult {
  const { tsconfigPath, filePath, backend = defaultBackend } = opts;

  const configFile = ts.readConfigFile(tsconfigPath, (p) => ts.sys.readFile(p));
  if (configFile.error) {
    throw new Error(
      `tsconfig read error: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    tsconfigPath.replace(/\/[^/]+$/, ""),
  );

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    host: makeCachingHost(parsed.options),
  });

  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) throw new Error(`source file not in program: ${filePath}`);

  const checker = program.getTypeChecker();
  const syntactic = program.getSyntacticDiagnostics(sourceFile);
  const semantic = program.getSemanticDiagnostics(sourceFile);
  const diagnostics: Diagnostic[] = [
    ...syntactic.map((d) => fromTscDiagnostic(d, "syntactic", ts.flattenDiagnosticMessageText)),
    ...semantic.map((d) => fromTscDiagnostic(d, "semantic", ts.flattenDiagnosticMessageText)),
  ];

  if (backend.validators.length > 0) {
    diagnostics.push(
      ...runValidators({
        sourceFile,
        checker,
        compilerOptions: parsed.options,
        validators: backend.validators,
        backendName: backend.name,
      }),
    );
  }

  const resolved = resolveAst(sourceFile, checker);
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
