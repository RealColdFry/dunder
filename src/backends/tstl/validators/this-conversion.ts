// TSTL parity: at function-typed assignment sites, refuse to convert
// between functions whose `this` shape differs (Void vs NonVoid). Mirrors
// `validateAssignment` + `validateFunctionAssignment` in TSTL's
// `transformation/utils/assignment-validation.ts`, with a simplified
// `getFunctionContextType` that handles the common cases (explicit
// `this:` parameter; method/constructor signatures default to NonVoid).
// Annotations (`@noSelf`, `@noSelfInFile`) and `noImplicitSelf` are not
// modeled here; those are TSTL conventions dunder may revisit.
//
// Trigger sites in this initial pass: variable declarations with both a
// type annotation and an initializer. Binary `=`, call args, and return
// statements are obvious extensions.

import ts from "typescript";
import type { ValidateCtx, Validator } from "../../../backend/types.ts";
import { DiagCode } from "../../../diagnostics/codes.ts";
import { locationFromNode } from "../../../diagnostics/from-node.ts";

type ContextType = "void" | "nonvoid" | "none";

interface Site {
  node: ts.Node; // location for the diagnostic
  fromNode: ts.Node; // initializer
  toNode: ts.Node; // type annotation
}

interface Plan {
  sites: Site[];
}

export const thisConversion: Validator = {
  name: "this-conversion",

  collect(sf): Plan {
    const sites: Site[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        node.type !== undefined &&
        node.initializer !== undefined
      ) {
        sites.push({ node: node.initializer, fromNode: node.initializer, toNode: node.type });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf as ts.SourceFile, visit);
    return { sites };
  },

  validate(ctx: ValidateCtx): void {
    const checker = ctx.checker as ts.TypeChecker;
    const sf = ctx.sourceFile as ts.SourceFile;
    const plan = ctx.plan as Plan;

    for (const site of plan.sites) {
      const fromType = ctx.types.typeAt(site.fromNode) as ts.Type | undefined;
      const toType = ctx.types.typeAt(site.toNode) as ts.Type | undefined;
      if (!fromType || !toType) continue;

      const fromCtx = getFunctionContextType(checker, fromType);
      const toCtx = getFunctionContextType(checker, toType);

      if (fromCtx === "none" || toCtx === "none") continue;
      if (fromCtx === toCtx) continue;

      const code =
        toCtx === "void"
          ? DiagCode.TstlNoSelfFunctionConversion
          : DiagCode.TstlSelfFunctionConversion;
      const message =
        toCtx === "void"
          ? "Unable to convert function with a 'this' parameter to function with no 'this'."
          : "Unable to convert function with no 'this' parameter to function with 'this'.";

      ctx.sink.push({
        severity: "error",
        code,
        message,
        origin: ctx.origin,
        location: locationFromNode(sf, site.node),
      });
    }
  },
};

// Simplified version of TSTL's `getFunctionContextType`. Handles:
//   - explicit `this:` parameter (Void if `void`, else NonVoid)
//   - method/constructor declarations default NonVoid
//   - other callable types default NonVoid
// Skips: @noSelf annotations, noImplicitSelf compiler option, type
// parameter constraints, signature reduction for unions.
function getFunctionContextType(checker: ts.TypeChecker, type: ts.Type): ContextType {
  const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
  if (signatures.length === 0) return "none";

  // If signatures disagree, TSTL would surface ContextType.Mixed and emit
  // `unsupportedOverloadAssignment`. For this initial pass we collapse to
  // the first signature; refine when we hit a real overload case.
  const decl = signatures[0]!.getDeclaration();
  if (!decl) return "nonvoid";

  const explicitThis = getExplicitThisParameter(decl);
  if (explicitThis) {
    return explicitThis.type?.kind === ts.SyntaxKind.VoidKeyword ? "void" : "nonvoid";
  }

  // Arrow functions never have their own `this`; treat as Void. TSTL gets
  // the same classification via `inferAssignedType` walking the assignment
  // context. For our purposes the direct check suffices.
  if (ts.isArrowFunction(decl)) return "void";

  if (
    ts.isMethodSignature(decl) ||
    ts.isMethodDeclaration(decl) ||
    ts.isConstructSignatureDeclaration(decl) ||
    ts.isConstructorDeclaration(decl)
  ) {
    return "nonvoid";
  }

  return "nonvoid";
}

function getExplicitThisParameter(
  decl: ts.SignatureDeclaration,
): ts.ParameterDeclaration | undefined {
  const param = decl.parameters[0];
  if (
    param &&
    ts.isIdentifier(param.name) &&
    ts.identifierToKeywordKind(param.name) === ts.SyntaxKind.ThisKeyword
  ) {
    return param;
  }
  return undefined;
}
