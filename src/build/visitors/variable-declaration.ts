import {
  isArrayBindingPattern,
  isIdentifier,
  isOmittedExpression,
  type VariableDeclaration,
} from "#/ts.ts";
import { ir, type ArrayPatternElement, type BindingKind, type Stmt } from "#/ir/types.ts";
import { flushPrecedingStmts } from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";

export function buildVariableDeclaration(
  decl: VariableDeclaration,
  bindingKind: BindingKind,
  exported: boolean,
  ctx: BuildCtx,
): Stmt[] {
  if (isArrayBindingPattern(decl.name)) {
    if (!decl.initializer) {
      throw new Error("array destructuring without initializer is not legal TS");
    }
    const elements: ArrayPatternElement[] = [];
    for (const el of decl.name.elements) {
      if (isOmittedExpression(el)) throw new Error("sparse destructuring not supported yet");
      if (el.dotDotDotToken) throw new Error("rest element in destructuring not supported yet");
      if (el.initializer) throw new Error("default value in destructuring not supported yet");
      if (!el.name || !isIdentifier(el.name)) {
        throw new Error("nested or computed-name destructuring not supported yet");
      }
      elements.push(ir.createArrPatElem(el.name.text));
    }
    const init = ctx.buildExpr(decl.initializer);
    const flushed = flushPrecedingStmts(ctx);
    return [
      ...flushed,
      ir.createDestructure({
        bindingKind,
        pattern: ir.createArrPat(elements),
        init,
        exported,
      }),
    ];
  }

  if (!isIdentifier(decl.name)) throw new Error("object destructuring not supported yet");

  const init = decl.initializer ? ctx.buildExpr(decl.initializer) : undefined;
  const flushed = flushPrecedingStmts(ctx);
  return [
    ...flushed,
    ir.createVarDecl({
      bindingKind,
      name: decl.name.text,
      init,
      exported,
    }),
  ];
}
