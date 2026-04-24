// Lua AST.
//
// Lifted from TypeScriptToLua/src/LuaAST.ts at commit ef946a3 (1.36.0).
// Adaptations:
//   - Stripped `import * as ts from "typescript"`. Replaced `ts.Node` params
//     (previously used for source-map position tracking) with `unknown`;
//     positions are always undefined until we wire sourcemaps back.
//   - Replaced `Set<LuaLibFeature>` with `Set<string>` in `File`; typed
//     lualib enum can come back when we implement lualib.
//   - Inlined `castArray` from TSTL's utils.
//
// The structure and names are otherwise preserved from TSTL to keep the lift
// legibly diffable against upstream.

function castArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

export enum SyntaxKind {
  File,
  Block,

  // Statements
  DoStatement,
  VariableDeclarationStatement,
  AssignmentStatement,
  IfStatement,
  WhileStatement,
  RepeatStatement,
  ForStatement,
  ForInStatement,
  GotoStatement,
  LabelStatement,
  ReturnStatement,
  BreakStatement,
  ContinueStatement, // Luau only.
  ExpressionStatement,

  // Expression
  StringLiteral,
  NumericLiteral,
  NilKeyword,
  DotsKeyword,
  ArgKeyword,
  TrueKeyword,
  FalseKeyword,
  FunctionExpression,
  TableFieldExpression,
  TableExpression,
  UnaryExpression,
  BinaryExpression,
  CallExpression,
  MethodCallExpression,
  Identifier,
  TableIndexExpression,
  ParenthesizedExpression,
  ConditionalExpression, // Luau only

  // Operators

  // Arithmetic
  AdditionOperator,
  SubtractionOperator,
  MultiplicationOperator,
  DivisionOperator,
  FloorDivisionOperator,
  ModuloOperator,
  PowerOperator,
  NegationOperator, // Unary minus

  // Concat
  ConcatOperator,

  // Length
  LengthOperator, // Unary

  // Relational
  EqualityOperator,
  InequalityOperator,
  LessThanOperator,
  LessEqualOperator,
  GreaterThanOperator,
  GreaterEqualOperator,

  // Logical
  AndOperator,
  OrOperator,
  NotOperator, // Unary

  // Bitwise
  BitwiseAndOperator,
  BitwiseOrOperator,
  BitwiseExclusiveOrOperator,
  BitwiseRightShiftOperator,
  BitwiseLeftShiftOperator,
  BitwiseNotOperator, // Unary
}

export type UnaryBitwiseOperator = SyntaxKind.BitwiseNotOperator;

export type UnaryOperator =
  | SyntaxKind.NegationOperator
  | SyntaxKind.LengthOperator
  | SyntaxKind.NotOperator
  | UnaryBitwiseOperator;

export type BinaryBitwiseOperator =
  | SyntaxKind.BitwiseAndOperator
  | SyntaxKind.BitwiseOrOperator
  | SyntaxKind.BitwiseExclusiveOrOperator
  | SyntaxKind.BitwiseRightShiftOperator
  | SyntaxKind.BitwiseLeftShiftOperator;

export type BinaryOperator =
  | SyntaxKind.AdditionOperator
  | SyntaxKind.SubtractionOperator
  | SyntaxKind.MultiplicationOperator
  | SyntaxKind.DivisionOperator
  | SyntaxKind.FloorDivisionOperator
  | SyntaxKind.ModuloOperator
  | SyntaxKind.PowerOperator
  | SyntaxKind.ConcatOperator
  | SyntaxKind.EqualityOperator
  | SyntaxKind.InequalityOperator
  | SyntaxKind.LessThanOperator
  | SyntaxKind.LessEqualOperator
  | SyntaxKind.GreaterThanOperator
  | SyntaxKind.GreaterEqualOperator
  | SyntaxKind.AndOperator
  | SyntaxKind.OrOperator
  | BinaryBitwiseOperator;

export type Operator = UnaryOperator | BinaryOperator;

export type SymbolId = number & { _symbolIdBrand: any };

export enum NodeFlags {
  None = 0,
  Inline = 1 << 0,
  Declaration = 1 << 1,
  TableUnpackCall = 1 << 2,
}

export interface TextRange {
  line?: number;
  column?: number;
}

export interface Node extends TextRange {
  kind: SyntaxKind;
  flags: NodeFlags;
}

export function createNode(kind: SyntaxKind, _tsOriginal?: unknown): Node {
  return { kind, flags: NodeFlags.None };
}

export function cloneNode<T extends Node>(node: T): T {
  return { ...node };
}

export function setNodePosition<T extends Node>(node: T, position: TextRange): T {
  node.line = position.line;
  node.column = position.column;
  return node;
}

export function getOriginalPos(node: Node): TextRange {
  return { line: node.line, column: node.column };
}

export function setNodeFlags<T extends Node>(node: T, flags: NodeFlags): T {
  node.flags = flags;
  return node;
}

export interface File extends Node {
  kind: SyntaxKind.File;
  statements: Statement[];
  luaLibFeatures: Set<string>;
  trivia: string;
}

export function isFile(node: Node): node is File {
  return node.kind === SyntaxKind.File;
}

export function createFile(
  statements: Statement[],
  luaLibFeatures: Set<string>,
  trivia: string,
  tsOriginal?: unknown,
): File {
  const file = createNode(SyntaxKind.File, tsOriginal) as File;
  file.statements = statements;
  file.luaLibFeatures = luaLibFeatures;
  file.trivia = trivia;
  return file;
}

export interface Block extends Node {
  kind: SyntaxKind.Block;
  statements: Statement[];
}

export function isBlock(node: Node): node is Block {
  return node.kind === SyntaxKind.Block;
}

export function createBlock(statements: Statement[], tsOriginal?: unknown): Block {
  const block = createNode(SyntaxKind.Block, tsOriginal) as Block;
  block.statements = statements;
  return block;
}

export interface Statement extends Node {
  _statementBrand: any;
  leadingComments?: Array<string | string[]>;
  trailingComments?: Array<string | string[]>;
}

export interface DoStatement extends Statement {
  kind: SyntaxKind.DoStatement;
  statements: Statement[];
}

export function isDoStatement(node: Node): node is DoStatement {
  return node.kind === SyntaxKind.DoStatement;
}

export function createDoStatement(statements: Statement[], tsOriginal?: unknown): DoStatement {
  const statement = createNode(SyntaxKind.DoStatement, tsOriginal) as DoStatement;
  statement.statements = statements;
  return statement;
}

export interface VariableDeclarationStatement extends Statement {
  kind: SyntaxKind.VariableDeclarationStatement;
  left: Identifier[];
  right?: Expression[];
}

export function isVariableDeclarationStatement(node: Node): node is VariableDeclarationStatement {
  return node.kind === SyntaxKind.VariableDeclarationStatement;
}

export function createVariableDeclarationStatement(
  left: Identifier | Identifier[],
  right?: Expression | Expression[],
  tsOriginal?: unknown,
): VariableDeclarationStatement {
  const statement = createNode(
    SyntaxKind.VariableDeclarationStatement,
    tsOriginal,
  ) as VariableDeclarationStatement;
  statement.left = castArray(left);
  if (right) statement.right = castArray(right);
  return statement;
}

export interface AssignmentStatement extends Statement {
  kind: SyntaxKind.AssignmentStatement;
  left: AssignmentLeftHandSideExpression[];
  right: Expression[];
}

export function isAssignmentStatement(node: Node): node is AssignmentStatement {
  return node.kind === SyntaxKind.AssignmentStatement;
}

export function createAssignmentStatement(
  left: AssignmentLeftHandSideExpression | AssignmentLeftHandSideExpression[],
  right?: Expression | Expression[],
  tsOriginal?: unknown,
): AssignmentStatement {
  const statement = createNode(SyntaxKind.AssignmentStatement, tsOriginal) as AssignmentStatement;
  statement.left = castArray(left);
  statement.right = right ? castArray(right) : [];
  return statement;
}

export interface IfStatement extends Statement {
  kind: SyntaxKind.IfStatement;
  condition: Expression;
  ifBlock: Block;
  elseBlock?: Block | IfStatement;
}

export function isIfStatement(node: Node): node is IfStatement {
  return node.kind === SyntaxKind.IfStatement;
}

export function createIfStatement(
  condition: Expression,
  ifBlock: Block,
  elseBlock?: Block | IfStatement,
  tsOriginal?: unknown,
): IfStatement {
  const statement = createNode(SyntaxKind.IfStatement, tsOriginal) as IfStatement;
  statement.condition = condition;
  statement.ifBlock = ifBlock;
  statement.elseBlock = elseBlock;
  return statement;
}

export interface IterationStatement extends Statement {
  body: Block;
}

export function isIterationStatement(node: Node): node is IterationStatement {
  return (
    node.kind === SyntaxKind.WhileStatement ||
    node.kind === SyntaxKind.RepeatStatement ||
    node.kind === SyntaxKind.ForStatement ||
    node.kind === SyntaxKind.ForInStatement
  );
}

export interface WhileStatement extends IterationStatement {
  kind: SyntaxKind.WhileStatement;
  condition: Expression;
}

export function isWhileStatement(node: Node): node is WhileStatement {
  return node.kind === SyntaxKind.WhileStatement;
}

export function createWhileStatement(
  body: Block,
  condition: Expression,
  tsOriginal?: unknown,
): WhileStatement {
  const statement = createNode(SyntaxKind.WhileStatement, tsOriginal) as WhileStatement;
  statement.body = body;
  statement.condition = condition;
  return statement;
}

export interface RepeatStatement extends IterationStatement {
  kind: SyntaxKind.RepeatStatement;
  condition: Expression;
}

export function isRepeatStatement(node: Node): node is RepeatStatement {
  return node.kind === SyntaxKind.RepeatStatement;
}

export function createRepeatStatement(
  body: Block,
  condition: Expression,
  tsOriginal?: unknown,
): RepeatStatement {
  const statement = createNode(SyntaxKind.RepeatStatement, tsOriginal) as RepeatStatement;
  statement.body = body;
  statement.condition = condition;
  return statement;
}

export interface ForStatement extends IterationStatement {
  kind: SyntaxKind.ForStatement;
  controlVariable: Identifier;
  controlVariableInitializer: Expression;
  limitExpression: Expression;
  stepExpression?: Expression;
}

export function isForStatement(node: Node): node is ForStatement {
  return node.kind === SyntaxKind.ForStatement;
}

export function createForStatement(
  body: Block,
  controlVariable: Identifier,
  controlVariableInitializer: Expression,
  limitExpression: Expression,
  stepExpression?: Expression,
  tsOriginal?: unknown,
): ForStatement {
  const statement = createNode(SyntaxKind.ForStatement, tsOriginal) as ForStatement;
  statement.body = body;
  statement.controlVariable = controlVariable;
  statement.controlVariableInitializer = controlVariableInitializer;
  statement.limitExpression = limitExpression;
  statement.stepExpression = stepExpression;
  return statement;
}

export interface ForInStatement extends IterationStatement {
  kind: SyntaxKind.ForInStatement;
  names: Identifier[];
  expressions: Expression[];
}

export function isForInStatement(node: Node): node is ForInStatement {
  return node.kind === SyntaxKind.ForInStatement;
}

export function createForInStatement(
  body: Block,
  names: Identifier[],
  expressions: Expression[],
  tsOriginal?: unknown,
): ForInStatement {
  const statement = createNode(SyntaxKind.ForInStatement, tsOriginal) as ForInStatement;
  statement.body = body;
  statement.names = names;
  statement.expressions = expressions;
  return statement;
}

export interface GotoStatement extends Statement {
  kind: SyntaxKind.GotoStatement;
  label: string;
}

export function isGotoStatement(node: Node): node is GotoStatement {
  return node.kind === SyntaxKind.GotoStatement;
}

export function createGotoStatement(label: string, tsOriginal?: unknown): GotoStatement {
  const statement = createNode(SyntaxKind.GotoStatement, tsOriginal) as GotoStatement;
  statement.label = label;
  return statement;
}

export interface LabelStatement extends Statement {
  kind: SyntaxKind.LabelStatement;
  name: string;
}

export function isLabelStatement(node: Node): node is LabelStatement {
  return node.kind === SyntaxKind.LabelStatement;
}

export function createLabelStatement(name: string, tsOriginal?: unknown): LabelStatement {
  const statement = createNode(SyntaxKind.LabelStatement, tsOriginal) as LabelStatement;
  statement.name = name;
  return statement;
}

export interface ReturnStatement extends Statement {
  kind: SyntaxKind.ReturnStatement;
  expressions: Expression[];
}

export function isReturnStatement(node: Node): node is ReturnStatement {
  return node.kind === SyntaxKind.ReturnStatement;
}

export function createReturnStatement(
  expressions: Expression[],
  tsOriginal?: unknown,
): ReturnStatement {
  const statement = createNode(SyntaxKind.ReturnStatement, tsOriginal) as ReturnStatement;
  statement.expressions = expressions;
  return statement;
}

export interface BreakStatement extends Statement {
  kind: SyntaxKind.BreakStatement;
}

export function isBreakStatement(node: Node): node is BreakStatement {
  return node.kind === SyntaxKind.BreakStatement;
}

export function createBreakStatement(tsOriginal?: unknown): BreakStatement {
  return createNode(SyntaxKind.BreakStatement, tsOriginal) as BreakStatement;
}

export interface ContinueStatement extends Statement {
  kind: SyntaxKind.ContinueStatement;
}

export function isContinueStatement(node: Node): node is ContinueStatement {
  return node.kind === SyntaxKind.ContinueStatement;
}

export function createContinueStatement(tsOriginal?: unknown): ContinueStatement {
  return createNode(SyntaxKind.ContinueStatement, tsOriginal) as ContinueStatement;
}

export interface ExpressionStatement extends Statement {
  kind: SyntaxKind.ExpressionStatement;
  expression: Expression;
}

export function isExpressionStatement(node: Node): node is ExpressionStatement {
  return node.kind === SyntaxKind.ExpressionStatement;
}

export function createExpressionStatement(
  expression: Expression,
  tsOriginal?: unknown,
): ExpressionStatement {
  const statement = createNode(SyntaxKind.ExpressionStatement, tsOriginal) as ExpressionStatement;
  statement.expression = expression;
  return statement;
}

export interface Expression extends Node {
  _expressionBrand: any;
}

export interface NilLiteral extends Expression {
  kind: SyntaxKind.NilKeyword;
}

export function isNilLiteral(node: Node): node is NilLiteral {
  return node.kind === SyntaxKind.NilKeyword;
}

export function createNilLiteral(tsOriginal?: unknown): NilLiteral {
  return createNode(SyntaxKind.NilKeyword, tsOriginal) as NilLiteral;
}

export interface BooleanLiteral extends Expression {
  kind: SyntaxKind.TrueKeyword | SyntaxKind.FalseKeyword;
}

export function isBooleanLiteral(node: Node): node is BooleanLiteral {
  return node.kind === SyntaxKind.TrueKeyword || node.kind === SyntaxKind.FalseKeyword;
}

export function createBooleanLiteral(value: boolean, tsOriginal?: unknown): BooleanLiteral {
  return createNode(
    value ? SyntaxKind.TrueKeyword : SyntaxKind.FalseKeyword,
    tsOriginal,
  ) as BooleanLiteral;
}

export interface DotsLiteral extends Expression {
  kind: SyntaxKind.DotsKeyword;
}

export function isDotsLiteral(node: Node): node is DotsLiteral {
  return node.kind === SyntaxKind.DotsKeyword;
}

export function createDotsLiteral(tsOriginal?: unknown): DotsLiteral {
  return createNode(SyntaxKind.DotsKeyword, tsOriginal) as DotsLiteral;
}

export interface ArgLiteral extends Expression {
  kind: SyntaxKind.ArgKeyword;
}

export function isArgLiteral(node: Node): node is ArgLiteral {
  return node.kind === SyntaxKind.ArgKeyword;
}

export function createArgLiteral(tsOriginal?: unknown): ArgLiteral {
  return createNode(SyntaxKind.ArgKeyword, tsOriginal) as ArgLiteral;
}

export interface NumericLiteral extends Expression {
  kind: SyntaxKind.NumericLiteral;
  value: number;
}

export function isNumericLiteral(node: Node): node is NumericLiteral {
  return node.kind === SyntaxKind.NumericLiteral;
}

export function createNumericLiteral(value: number, tsOriginal?: unknown): NumericLiteral {
  const expression = createNode(SyntaxKind.NumericLiteral, tsOriginal) as NumericLiteral;
  expression.value = value;
  return expression;
}

export interface StringLiteral extends Expression {
  kind: SyntaxKind.StringLiteral;
  value: string;
}

export function isStringLiteral(node: Node): node is StringLiteral {
  return node.kind === SyntaxKind.StringLiteral;
}

export function createStringLiteral(value: string, tsOriginal?: unknown): StringLiteral {
  const expression = createNode(SyntaxKind.StringLiteral, tsOriginal) as StringLiteral;
  expression.value = value;
  return expression;
}

export function isLiteral(
  node: Node,
): node is NilLiteral | DotsLiteral | ArgLiteral | BooleanLiteral | NumericLiteral | StringLiteral {
  return (
    isNilLiteral(node) ||
    isDotsLiteral(node) ||
    isArgLiteral(node) ||
    isBooleanLiteral(node) ||
    isNumericLiteral(node) ||
    isStringLiteral(node)
  );
}

export interface FunctionExpression extends Expression {
  kind: SyntaxKind.FunctionExpression;
  params?: Identifier[];
  dots?: DotsLiteral;
  body: Block;
}

export function isFunctionExpression(node: Node): node is FunctionExpression {
  return node.kind === SyntaxKind.FunctionExpression;
}

export function createFunctionExpression(
  body: Block,
  params?: Identifier[],
  dots?: DotsLiteral,
  flags = NodeFlags.None,
  tsOriginal?: unknown,
): FunctionExpression {
  const expression = createNode(SyntaxKind.FunctionExpression, tsOriginal) as FunctionExpression;
  expression.body = body;
  expression.params = params;
  expression.dots = dots;
  expression.flags = flags;
  return expression;
}

export interface TableFieldExpression extends Expression {
  kind: SyntaxKind.TableFieldExpression;
  value: Expression;
  key?: Expression;
}

export function isTableFieldExpression(node: Node): node is TableFieldExpression {
  return node.kind === SyntaxKind.TableFieldExpression;
}

export function createTableFieldExpression(
  value: Expression,
  key?: Expression,
  tsOriginal?: unknown,
): TableFieldExpression {
  const expression = createNode(
    SyntaxKind.TableFieldExpression,
    tsOriginal,
  ) as TableFieldExpression;
  expression.value = value;
  expression.key = key;
  return expression;
}

export interface TableExpression extends Expression {
  kind: SyntaxKind.TableExpression;
  fields: TableFieldExpression[];
}

export function isTableExpression(node: Node): node is TableExpression {
  return node.kind === SyntaxKind.TableExpression;
}

export function createTableExpression(
  fields: TableFieldExpression[] = [],
  tsOriginal?: unknown,
): TableExpression {
  const expression = createNode(SyntaxKind.TableExpression, tsOriginal) as TableExpression;
  expression.fields = fields;
  return expression;
}

export interface UnaryExpression extends Expression {
  kind: SyntaxKind.UnaryExpression;
  operand: Expression;
  operator: UnaryOperator;
}

export function isUnaryExpression(node: Node): node is UnaryExpression {
  return node.kind === SyntaxKind.UnaryExpression;
}

export function createUnaryExpression(
  operand: Expression,
  operator: UnaryOperator,
  tsOriginal?: unknown,
): UnaryExpression {
  const expression = createNode(SyntaxKind.UnaryExpression, tsOriginal) as UnaryExpression;
  expression.operand = operand;
  expression.operator = operator;
  return expression;
}

export interface BinaryExpression extends Expression {
  kind: SyntaxKind.BinaryExpression;
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
}

export function isBinaryExpression(node: Node): node is BinaryExpression {
  return node.kind === SyntaxKind.BinaryExpression;
}

export function createBinaryExpression(
  left: Expression,
  right: Expression,
  operator: BinaryOperator,
  tsOriginal?: unknown,
): BinaryExpression {
  const expression = createNode(SyntaxKind.BinaryExpression, tsOriginal) as BinaryExpression;
  expression.left = left;
  expression.right = right;
  expression.operator = operator;
  return expression;
}

export interface CallExpression extends Expression {
  kind: SyntaxKind.CallExpression;
  expression: Expression;
  params: Expression[];
}

export function isCallExpression(node: Node): node is CallExpression {
  return node.kind === SyntaxKind.CallExpression;
}

export function createCallExpression(
  expression: Expression,
  params: Expression[],
  tsOriginal?: unknown,
): CallExpression {
  const callExpression = createNode(SyntaxKind.CallExpression, tsOriginal) as CallExpression;
  callExpression.expression = expression;
  callExpression.params = params;
  return callExpression;
}

export interface MethodCallExpression extends Expression {
  kind: SyntaxKind.MethodCallExpression;
  prefixExpression: Expression;
  name: Identifier;
  params: Expression[];
}

export function isMethodCallExpression(node: Node): node is MethodCallExpression {
  return node.kind === SyntaxKind.MethodCallExpression;
}

export function createMethodCallExpression(
  prefixExpression: Expression,
  name: Identifier,
  params: Expression[],
  tsOriginal?: unknown,
): MethodCallExpression {
  const callExpression = createNode(
    SyntaxKind.MethodCallExpression,
    tsOriginal,
  ) as MethodCallExpression;
  callExpression.prefixExpression = prefixExpression;
  callExpression.name = name;
  callExpression.params = params;
  return callExpression;
}

export interface Identifier extends Expression {
  kind: SyntaxKind.Identifier;
  exportable: boolean;
  text: string;
  originalName?: string;
  symbolId?: SymbolId;
}

export function isIdentifier(node: Node): node is Identifier {
  return node.kind === SyntaxKind.Identifier;
}

export function createIdentifier(
  text: string,
  tsOriginal?: unknown,
  symbolId?: SymbolId,
  originalName?: string,
): Identifier {
  const expression = createNode(SyntaxKind.Identifier, tsOriginal) as Identifier;
  expression.exportable = true;
  expression.text = text;
  expression.symbolId = symbolId;
  expression.originalName = originalName;
  return expression;
}

export function cloneIdentifier(identifier: Identifier, tsOriginal?: unknown): Identifier {
  return createIdentifier(
    identifier.text,
    tsOriginal,
    identifier.symbolId,
    identifier.originalName,
  );
}

export function createAnonymousIdentifier(tsOriginal?: unknown): Identifier {
  const expression = createNode(SyntaxKind.Identifier, tsOriginal) as Identifier;
  expression.exportable = false;
  expression.text = "____";
  return expression;
}

export interface TableIndexExpression extends Expression {
  kind: SyntaxKind.TableIndexExpression;
  table: Expression;
  index: Expression;
}

export function isTableIndexExpression(node: Node): node is TableIndexExpression {
  return node.kind === SyntaxKind.TableIndexExpression;
}

export function createTableIndexExpression(
  table: Expression,
  index: Expression,
  tsOriginal?: unknown,
): TableIndexExpression {
  const expression = createNode(
    SyntaxKind.TableIndexExpression,
    tsOriginal,
  ) as TableIndexExpression;
  expression.table = table;
  expression.index = index;
  return expression;
}

export type AssignmentLeftHandSideExpression = Identifier | TableIndexExpression;

export function isAssignmentLeftHandSideExpression(
  node: Node,
): node is AssignmentLeftHandSideExpression {
  return isIdentifier(node) || isTableIndexExpression(node);
}

export type FunctionDefinition = (VariableDeclarationStatement | AssignmentStatement) & {
  right: [FunctionExpression];
};

export function isFunctionDefinition(
  statement: VariableDeclarationStatement | AssignmentStatement,
): statement is FunctionDefinition {
  return (
    statement.left.length === 1 &&
    statement.right?.length === 1 &&
    isFunctionExpression(statement.right[0])
  );
}

export type InlineFunctionExpression = FunctionExpression & {
  body: { statements: [ReturnStatement & { expressions: Expression[] }] };
};

export function isInlineFunctionExpression(
  expression: FunctionExpression,
): expression is InlineFunctionExpression {
  return (
    expression.body.statements?.length === 1 &&
    isReturnStatement(expression.body.statements[0]) &&
    expression.body.statements[0].expressions !== undefined &&
    (expression.flags & NodeFlags.Inline) !== 0
  );
}

export type ParenthesizedExpression = Expression & {
  expression: Expression;
};

export function isParenthesizedExpression(node: Node): node is ParenthesizedExpression {
  return node.kind === SyntaxKind.ParenthesizedExpression;
}

export function createParenthesizedExpression(
  expression: Expression,
  tsOriginal?: unknown,
): ParenthesizedExpression {
  const parenthesizedExpression = createNode(
    SyntaxKind.ParenthesizedExpression,
    tsOriginal,
  ) as ParenthesizedExpression;
  parenthesizedExpression.expression = expression;
  return parenthesizedExpression;
}

export type ConditionalExpression = Expression & {
  condition: Expression;
  whenTrue: Expression;
  whenFalse: Expression;
};

export function isConditionalExpression(node: Node): node is ConditionalExpression {
  return node.kind === SyntaxKind.ConditionalExpression;
}

export function createConditionalExpression(
  condition: Expression,
  whenTrue: Expression,
  whenFalse: Expression,
  tsOriginal?: unknown,
): ConditionalExpression {
  const conditionalExpression = createNode(
    SyntaxKind.ConditionalExpression,
    tsOriginal,
  ) as ConditionalExpression;
  conditionalExpression.condition = condition;
  conditionalExpression.whenTrue = whenTrue;
  conditionalExpression.whenFalse = whenFalse;
  return conditionalExpression;
}
