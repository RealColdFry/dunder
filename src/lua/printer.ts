// Lua AST printer.
//
// Lifted from TypeScriptToLua/src/LuaPrinter.ts at commit ef946a3 (1.36.0).
// Adaptations:
//   - Replaced `SourceNode` / `SourceChunk` with plain strings throughout.
//     All sourcemap machinery stripped (to be restored when sourcemaps land).
//   - Replaced `EmitHost`, `ts.Program`, `CompilerOptions` constructor params.
//     Printer takes only a `lua.File`.
//   - Stripped lualib feature injection, sourcemap traceback placeholder, and
//     `tstlHeader` injection. Output is the statements, nothing else.
//   - Replaced `shouldAllowUnicode`-aware identifier regex with a plain
//     ASCII-only regex. Unicode identifiers are a per-target concern; we'll
//     re-parameterize when targets arrive.
//
// Operator map, precedence table, right-associativity set, and per-node
// print logic are preserved from TSTL verbatim where possible.
//
// Public entry point: `print(file: lua.File): string`.

import * as lua from "./ast.ts";

// oxlint-disable-next-line no-control-regex -- NUL escape is required for Lua strings
const escapeStringRegExp = /[\b\f\n\r\t\v\\"\u0000]/g;
const escapeStringMap: Record<string, string> = {
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\v": "\\v",
  "\\": "\\\\",
  '"': '\\"',
  "\u0000": "\\0",
};

export const escapeString = (value: string) =>
  `"${value.replace(escapeStringRegExp, (char) => escapeStringMap[char])}"`;

const validIdentifierRe = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const validFunctionDeclarationNameRe = /^[a-zA-Z0-9_.]+$/;
const luaReservedWords = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "goto",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
]);

function isValidLuaIdentifier(s: string): boolean {
  return validIdentifierRe.test(s) && !luaReservedWords.has(s);
}

const operatorMap: Record<lua.Operator, string> = {
  [lua.SyntaxKind.AdditionOperator]: "+",
  [lua.SyntaxKind.SubtractionOperator]: "-",
  [lua.SyntaxKind.MultiplicationOperator]: "*",
  [lua.SyntaxKind.DivisionOperator]: "/",
  [lua.SyntaxKind.FloorDivisionOperator]: "//",
  [lua.SyntaxKind.ModuloOperator]: "%",
  [lua.SyntaxKind.PowerOperator]: "^",
  [lua.SyntaxKind.NegationOperator]: "-",
  [lua.SyntaxKind.ConcatOperator]: "..",
  [lua.SyntaxKind.LengthOperator]: "#",
  [lua.SyntaxKind.EqualityOperator]: "==",
  [lua.SyntaxKind.InequalityOperator]: "~=",
  [lua.SyntaxKind.LessThanOperator]: "<",
  [lua.SyntaxKind.LessEqualOperator]: "<=",
  [lua.SyntaxKind.GreaterThanOperator]: ">",
  [lua.SyntaxKind.GreaterEqualOperator]: ">=",
  [lua.SyntaxKind.AndOperator]: "and",
  [lua.SyntaxKind.OrOperator]: "or",
  [lua.SyntaxKind.NotOperator]: "not ",
  [lua.SyntaxKind.BitwiseAndOperator]: "&",
  [lua.SyntaxKind.BitwiseOrOperator]: "|",
  [lua.SyntaxKind.BitwiseExclusiveOrOperator]: "~",
  [lua.SyntaxKind.BitwiseRightShiftOperator]: ">>",
  [lua.SyntaxKind.BitwiseLeftShiftOperator]: "<<",
  [lua.SyntaxKind.BitwiseNotOperator]: "~",
};

const operatorPrecedence: Record<lua.Operator, number> = {
  [lua.SyntaxKind.OrOperator]: 1,
  [lua.SyntaxKind.AndOperator]: 2,
  [lua.SyntaxKind.EqualityOperator]: 3,
  [lua.SyntaxKind.InequalityOperator]: 3,
  [lua.SyntaxKind.LessThanOperator]: 3,
  [lua.SyntaxKind.LessEqualOperator]: 3,
  [lua.SyntaxKind.GreaterThanOperator]: 3,
  [lua.SyntaxKind.GreaterEqualOperator]: 3,
  [lua.SyntaxKind.BitwiseOrOperator]: 4,
  [lua.SyntaxKind.BitwiseExclusiveOrOperator]: 5,
  [lua.SyntaxKind.BitwiseAndOperator]: 6,
  [lua.SyntaxKind.BitwiseLeftShiftOperator]: 7,
  [lua.SyntaxKind.BitwiseRightShiftOperator]: 7,
  [lua.SyntaxKind.ConcatOperator]: 8,
  [lua.SyntaxKind.AdditionOperator]: 9,
  [lua.SyntaxKind.SubtractionOperator]: 9,
  [lua.SyntaxKind.MultiplicationOperator]: 10,
  [lua.SyntaxKind.DivisionOperator]: 10,
  [lua.SyntaxKind.FloorDivisionOperator]: 10,
  [lua.SyntaxKind.ModuloOperator]: 10,
  [lua.SyntaxKind.NotOperator]: 11,
  [lua.SyntaxKind.LengthOperator]: 11,
  [lua.SyntaxKind.NegationOperator]: 11,
  [lua.SyntaxKind.BitwiseNotOperator]: 11,
  [lua.SyntaxKind.PowerOperator]: 12,
};

const rightAssociativeOperators = new Set<lua.Operator>([
  lua.SyntaxKind.ConcatOperator,
  lua.SyntaxKind.PowerOperator,
]);

class Printer {
  private indentLevel = 0;

  private pushIndent(): void {
    this.indentLevel++;
  }
  private popIndent(): void {
    this.indentLevel--;
  }
  private ind(text = ""): string {
    return "    ".repeat(this.indentLevel) + text;
  }

  print(file: lua.File): string {
    return file.trivia + this.printStatementArray(file.statements);
  }

  private statementMayRequireSemiColon(statement: lua.Statement): boolean {
    return (
      lua.isVariableDeclarationStatement(statement) ||
      lua.isAssignmentStatement(statement) ||
      lua.isExpressionStatement(statement)
    );
  }

  private printStatementArray(statements: lua.Statement[]): string {
    const parts: string[] = [];
    for (const [index, statement] of statements.entries()) {
      let text = this.printStatement(statement);

      if (
        index > 0 &&
        this.statementMayRequireSemiColon(statements[index - 1]!) &&
        text.trimStart().startsWith("(")
      ) {
        parts[index - 1] += ";";
      }

      parts.push(text);

      if (lua.isReturnStatement(statement) || lua.isBreakStatement(statement)) break;
    }
    return parts.length > 0 ? parts.join("\n") + "\n" : "";
  }

  private printStatement(statement: lua.Statement): string {
    let body = this.printStatementExcludingComments(statement);
    if (statement.leadingComments) {
      body = statement.leadingComments.map((c) => this.printComment(c)).join("\n") + "\n" + body;
    }
    if (statement.trailingComments) {
      body = body + "\n" + statement.trailingComments.map((c) => this.printComment(c)).join("\n");
    }
    return body;
  }

  private printComment(comment: string | string[]): string {
    if (Array.isArray(comment)) {
      if (comment.length === 0) return this.ind("--[[]]");
      const [first, ...rest] = comment;
      const tail = rest.map((c) => "\n" + this.ind(c)).join("");
      return this.ind("--[[") + first + tail + "]]";
    }
    return this.ind("--" + comment);
  }

  private printStatementExcludingComments(statement: lua.Statement): string {
    switch (statement.kind) {
      case lua.SyntaxKind.DoStatement:
        return this.printDoStatement(statement as lua.DoStatement);
      case lua.SyntaxKind.VariableDeclarationStatement:
        return this.printVariableDeclarationStatement(
          statement as lua.VariableDeclarationStatement,
        );
      case lua.SyntaxKind.AssignmentStatement:
        return this.printVariableAssignmentStatement(statement as lua.AssignmentStatement);
      case lua.SyntaxKind.IfStatement:
        return this.printIfStatement(statement as lua.IfStatement);
      case lua.SyntaxKind.WhileStatement:
        return this.printWhileStatement(statement as lua.WhileStatement);
      case lua.SyntaxKind.RepeatStatement:
        return this.printRepeatStatement(statement as lua.RepeatStatement);
      case lua.SyntaxKind.ForStatement:
        return this.printForStatement(statement as lua.ForStatement);
      case lua.SyntaxKind.ForInStatement:
        return this.printForInStatement(statement as lua.ForInStatement);
      case lua.SyntaxKind.GotoStatement:
        return this.printGotoStatement(statement as lua.GotoStatement);
      case lua.SyntaxKind.LabelStatement:
        return this.printLabelStatement(statement as lua.LabelStatement);
      case lua.SyntaxKind.ReturnStatement:
        return this.printReturnStatement(statement as lua.ReturnStatement);
      case lua.SyntaxKind.BreakStatement:
        return this.printBreakStatement();
      case lua.SyntaxKind.ContinueStatement:
        return this.printContinueStatement();
      case lua.SyntaxKind.ExpressionStatement:
        return this.printExpressionStatement(statement as lua.ExpressionStatement);
      default:
        throw new Error(`Tried to print unknown statement kind: ${lua.SyntaxKind[statement.kind]}`);
    }
  }

  private printBlock(block: lua.Block): string {
    return this.printStatementArray(block.statements);
  }

  private printDoStatement(statement: lua.DoStatement): string {
    let out = this.ind("do\n");
    this.pushIndent();
    out += this.printStatementArray(statement.statements);
    this.popIndent();
    return out + this.ind("end");
  }

  private printVariableDeclarationStatement(statement: lua.VariableDeclarationStatement): string {
    let out = this.ind("local ");

    if (lua.isFunctionDefinition(statement)) {
      out += this.printFunctionDefinition(statement);
      return out;
    }

    out += statement.left.map((e) => this.printExpression(e)).join(", ");
    if (statement.right) {
      out += " = " + statement.right.map((e) => this.printExpression(e)).join(", ");
    }
    return out;
  }

  private printVariableAssignmentStatement(statement: lua.AssignmentStatement): string {
    if (
      lua.isFunctionDefinition(statement) &&
      (statement.right[0].flags & lua.NodeFlags.Declaration) !== 0
    ) {
      const name = this.printExpression(statement.left[0]);
      if (validFunctionDeclarationNameRe.test(name)) {
        return this.ind(this.printFunctionDefinition(statement));
      }
    }

    const left = statement.left.map((e) => this.printExpression(e)).join(", ");
    const right = statement.right.map((e) => this.printExpression(e)).join(", ");
    return this.ind(left) + " = " + right;
  }

  private printIfStatement(statement: lua.IfStatement, isElseIf = false): string {
    const prefix = isElseIf ? "elseif " : "if ";
    let out = this.ind(prefix) + this.printExpression(statement.condition) + " then\n";

    this.pushIndent();
    out += this.printBlock(statement.ifBlock);
    this.popIndent();

    if (statement.elseBlock) {
      if (lua.isIfStatement(statement.elseBlock)) {
        out += this.printIfStatement(statement.elseBlock, true);
      } else {
        out += this.ind("else\n");
        this.pushIndent();
        out += this.printBlock(statement.elseBlock);
        this.popIndent();
        out += this.ind("end");
      }
    } else {
      out += this.ind("end");
    }

    return out;
  }

  private printWhileStatement(statement: lua.WhileStatement): string {
    let out = this.ind("while ") + this.printExpression(statement.condition) + " do\n";
    this.pushIndent();
    out += this.printBlock(statement.body);
    this.popIndent();
    return out + this.ind("end");
  }

  private printRepeatStatement(statement: lua.RepeatStatement): string {
    let out = this.ind("repeat\n");
    this.pushIndent();
    out += this.printBlock(statement.body);
    this.popIndent();
    return out + this.ind("until ") + this.printExpression(statement.condition);
  }

  private printForStatement(statement: lua.ForStatement): string {
    let out =
      this.ind("for ") +
      this.printExpression(statement.controlVariable) +
      " = " +
      this.printExpression(statement.controlVariableInitializer) +
      ", " +
      this.printExpression(statement.limitExpression);

    if (statement.stepExpression) {
      out += ", " + this.printExpression(statement.stepExpression);
    }
    out += " do\n";

    this.pushIndent();
    out += this.printBlock(statement.body);
    this.popIndent();
    return out + this.ind("end");
  }

  private printForInStatement(statement: lua.ForInStatement): string {
    const names = statement.names.map((i) => this.printIdentifier(i)).join(", ");
    const expressions = statement.expressions.map((e) => this.printExpression(e)).join(", ");
    let out = this.ind("for ") + names + " in " + expressions + " do\n";
    this.pushIndent();
    out += this.printBlock(statement.body);
    this.popIndent();
    return out + this.ind("end");
  }

  private printGotoStatement(statement: lua.GotoStatement): string {
    return this.ind("goto ") + statement.label;
  }

  private printLabelStatement(statement: lua.LabelStatement): string {
    return this.ind("::") + statement.name + "::";
  }

  private printReturnStatement(statement: lua.ReturnStatement): string {
    if (statement.expressions.length === 0) return this.ind("return");
    return (
      this.ind("return ") + statement.expressions.map((e) => this.printExpression(e)).join(", ")
    );
  }

  private printBreakStatement(): string {
    return this.ind("break");
  }
  private printContinueStatement(): string {
    return this.ind("continue");
  }

  private printExpressionStatement(statement: lua.ExpressionStatement): string {
    return this.ind() + this.printExpression(statement.expression);
  }

  private printExpression(expression: lua.Expression): string {
    switch (expression.kind) {
      case lua.SyntaxKind.StringLiteral:
        return escapeString((expression as lua.StringLiteral).value);
      case lua.SyntaxKind.NumericLiteral:
        return String((expression as lua.NumericLiteral).value);
      case lua.SyntaxKind.NilKeyword:
        return "nil";
      case lua.SyntaxKind.DotsKeyword:
        return "...";
      case lua.SyntaxKind.ArgKeyword:
        return "arg";
      case lua.SyntaxKind.TrueKeyword:
        return "true";
      case lua.SyntaxKind.FalseKeyword:
        return "false";
      case lua.SyntaxKind.FunctionExpression:
        return this.printFunctionExpression(expression as lua.FunctionExpression);
      case lua.SyntaxKind.TableFieldExpression:
        return this.printTableFieldExpression(expression as lua.TableFieldExpression);
      case lua.SyntaxKind.TableExpression:
        return this.printTableExpression(expression as lua.TableExpression);
      case lua.SyntaxKind.UnaryExpression:
        return this.printUnaryExpression(expression as lua.UnaryExpression);
      case lua.SyntaxKind.BinaryExpression:
        return this.printBinaryExpression(expression as lua.BinaryExpression);
      case lua.SyntaxKind.CallExpression:
        return this.printCallExpression(expression as lua.CallExpression);
      case lua.SyntaxKind.MethodCallExpression:
        return this.printMethodCallExpression(expression as lua.MethodCallExpression);
      case lua.SyntaxKind.Identifier:
        return this.printIdentifier(expression as lua.Identifier);
      case lua.SyntaxKind.TableIndexExpression:
        return this.printTableIndexExpression(expression as lua.TableIndexExpression);
      case lua.SyntaxKind.ParenthesizedExpression:
        return (
          "(" + this.printExpression((expression as lua.ParenthesizedExpression).expression) + ")"
        );
      case lua.SyntaxKind.ConditionalExpression:
        return this.printConditionalExpression(expression as lua.ConditionalExpression);
      default:
        throw new Error(
          `Tried to print unknown expression kind: ${lua.SyntaxKind[expression.kind]}`,
        );
    }
  }

  private printIdentifier(expression: lua.Identifier): string {
    return expression.text;
  }

  private printFunctionParameters(expression: lua.FunctionExpression): string {
    const parts = (expression.params ?? []).map((i) => this.printIdentifier(i));
    if (expression.dots) parts.push("...");
    return parts.join(", ");
  }

  private printFunctionExpression(expression: lua.FunctionExpression): string {
    let out = "function(" + this.printFunctionParameters(expression) + ")";

    if (lua.isInlineFunctionExpression(expression)) {
      const returnStatement = expression.body.statements[0];
      const returnExprs = returnStatement.expressions
        .map((e) => this.printExpression(e))
        .join(", ");
      return out + " return " + returnExprs + " end";
    }

    out += "\n";
    this.pushIndent();
    out += this.printBlock(expression.body);
    this.popIndent();
    return out + this.ind("end");
  }

  private printFunctionDefinition(statement: lua.FunctionDefinition): string {
    const expression = statement.right[0];
    let out = "function " + this.printExpression(statement.left[0]);
    out += "(" + this.printFunctionParameters(expression) + ")\n";

    this.pushIndent();
    out += this.printBlock(expression.body);
    this.popIndent();

    return out + this.ind("end");
  }

  private printTableFieldExpression(expression: lua.TableFieldExpression): string {
    const value = this.printExpression(expression.value);
    if (expression.key) {
      if (lua.isStringLiteral(expression.key) && isValidLuaIdentifier(expression.key.value)) {
        return expression.key.value + " = " + value;
      }
      return "[" + this.printExpression(expression.key) + "] = " + value;
    }
    return value;
  }

  private printTableExpression(expression: lua.TableExpression): string {
    return "{" + expression.fields.map((f) => this.printTableFieldExpression(f)).join(", ") + "}";
  }

  private printUnaryExpression(expression: lua.UnaryExpression): string {
    return (
      operatorMap[expression.operator] +
      this.parenthesizedIfNeeded(expression.operand, operatorPrecedence[expression.operator])
    );
  }

  private printBinaryExpression(expression: lua.BinaryExpression): string {
    const isRightAssoc = rightAssociativeOperators.has(expression.operator);
    const prec = operatorPrecedence[expression.operator];
    const left = this.parenthesizedIfNeeded(expression.left, isRightAssoc ? prec + 1 : prec);
    const right = this.parenthesizedIfNeeded(expression.right, isRightAssoc ? prec : prec + 1);
    return left + " " + operatorMap[expression.operator] + " " + right;
  }

  private parenthesizedIfNeeded(expression: lua.Expression, minPrecedenceToOmit?: number): string {
    return this.needsParenthesis(expression, minPrecedenceToOmit)
      ? "(" + this.printExpression(expression) + ")"
      : this.printExpression(expression);
  }

  private needsParenthesis(expression: lua.Expression, minPrecedenceToOmit?: number): boolean {
    if (lua.isBinaryExpression(expression) || lua.isUnaryExpression(expression)) {
      const op = (expression as lua.BinaryExpression | lua.UnaryExpression).operator;
      return minPrecedenceToOmit === undefined || operatorPrecedence[op] < minPrecedenceToOmit;
    }
    return lua.isFunctionExpression(expression) || lua.isTableExpression(expression);
  }

  private printCallExpression(expression: lua.CallExpression): string {
    const callee = this.parenthesizedIfNeeded(expression.expression);
    const args = expression.params
      ? expression.params.map((p) => this.printExpression(p)).join(", ")
      : "";
    return callee + "(" + args + ")";
  }

  private printMethodCallExpression(expression: lua.MethodCallExpression): string {
    const prefix =
      this.needsParenthesis(expression.prefixExpression) ||
      lua.isStringLiteral(expression.prefixExpression)
        ? "(" + this.printExpression(expression.prefixExpression) + ")"
        : this.printExpression(expression.prefixExpression);
    const args = expression.params
      ? expression.params.map((p) => this.printExpression(p)).join(", ")
      : "";
    return prefix + ":" + this.printIdentifier(expression.name) + "(" + args + ")";
  }

  private printTableIndexExpression(expression: lua.TableIndexExpression): string {
    const table = this.parenthesizedIfNeeded(expression.table);
    if (lua.isStringLiteral(expression.index) && isValidLuaIdentifier(expression.index.value)) {
      return table + "." + expression.index.value;
    }
    return table + "[" + this.printExpression(expression.index) + "]";
  }

  private printConditionalExpression(expression: lua.ConditionalExpression): string {
    return (
      "if " +
      this.printExpression(expression.condition) +
      " then " +
      this.printExpression(expression.whenTrue) +
      " else " +
      this.printExpression(expression.whenFalse)
    );
  }
}

export function print(file: lua.File): string {
  return new Printer().print(file);
}
