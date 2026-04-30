import {
  isBlock,
  isIdentifier,
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type ParameterDeclaration,
} from "#/ts.ts";
import { ir, type Expr, type Parameter, type Stmt } from "#/ir/types.ts";
import { withPrecedingScope } from "#/build/anf.ts";
import { type BuildCtx } from "#/build/context.ts";
import { hasExportModifier } from "#/build/modifiers.ts";

export function buildFunctionDeclaration(node: FunctionDeclaration, ctx: BuildCtx): Stmt[] {
  if (!node.name) throw new Error("anonymous function declarations not supported");
  if (!node.body || !isBlock(node.body)) throw new Error("function declaration missing body block");
  const params = buildParameters(node.parameters, "destructured parameters not supported");
  const body = ctx.buildScopedBranch(node.body);
  return [
    ir.createFunDecl({
      name: node.name.text,
      params,
      body,
      exported: hasExportModifier(node),
    }),
  ];
}

export function buildFunctionExpression(node: FunctionExpression, ctx: BuildCtx): Expr {
  if (!node.body || !isBlock(node.body)) throw new Error("function expression missing body block");
  const params = buildParameters(
    node.parameters,
    "destructured function-expr params not supported",
  );
  const body = ctx.buildScopedBranch(node.body);
  // Named function expression: the inner name's binding inside its own body
  // is sugar over `local f; f = function(){…}`. Desugar is deferred until a
  // body-reference scan lands; for now we preserve the name on the literal.
  return ir.createFunction({
    shape: "expr",
    name: node.name?.text,
    params,
    body,
  });
}

export function buildArrowFunction(node: ArrowFunction, ctx: BuildCtx): Expr {
  const params = buildParameters(node.parameters, "destructured arrow params not supported");
  let body: Stmt[];
  if (isBlock(node.body)) {
    body = ctx.buildScopedBranch(node.body);
  } else {
    // Concise body: preceding stmts from the body land inside the arrow.
    const { preceding, result } = withPrecedingScope(ctx, () => ctx.buildExpr(node.body));
    body = [...preceding, ir.createReturn(result)];
  }
  return ir.createFunction({
    shape: "arrow",
    params,
    body,
  });
}

function buildParameters(
  parameters: readonly ParameterDeclaration[],
  errorMsg: string,
): Parameter[] {
  const params: Parameter[] = [];
  for (const p of parameters) {
    if (!isIdentifier(p.name)) throw new Error(errorMsg);
    params.push({
      name: p.name.text,
    });
  }
  return params;
}
