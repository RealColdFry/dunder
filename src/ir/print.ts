// IR pretty-printer. Sexp-shaped, keyword-slot, adaptive layout.
//
// Format: `(Kind :slot value :slot value pos pos)`. Boolean flags appear only
// when true. Layout collapses to one line when it fits in MAX_WIDTH; else
// breaks each slot onto its own line at 2-space indent.

import type { ArrayPattern, Expr, Module, Stmt } from "./types.ts";

const MAX_WIDTH = 80;
const INDENT = 2;

// ---- Doc model -------------------------------------------------------------

type Doc =
  | { tag: "atom"; text: string }
  | { tag: "form"; head: string; slots: Slot[] }
  | { tag: "list"; items: Doc[] };

type Slot = { kw?: string; value: Doc };

function atom(text: string): Doc {
  return { tag: "atom", text };
}

function form(head: string, slots: Slot[]): Doc {
  return { tag: "form", head, slots };
}

function list(items: Doc[]): Doc {
  return { tag: "list", items };
}

function kw(key: string, value: Doc): Slot {
  return { kw: key, value };
}

function pos(value: Doc): Slot {
  return { value };
}

// ---- Layout ----------------------------------------------------------------

function inline(doc: Doc): string {
  switch (doc.tag) {
    case "atom":
      return doc.text;
    case "form":
      if (doc.slots.length === 0) return `(${doc.head})`;
      return `(${doc.head} ${doc.slots.map(slotInline).join(" ")})`;
    case "list":
      return `[${doc.items.map(inline).join(" ")}]`;
  }
}

function slotInline(slot: Slot): string {
  const v = inline(slot.value);
  return slot.kw ? `:${slot.kw} ${v}` : v;
}

function render(doc: Doc, indent: number): string {
  const oneLine = inline(doc);
  if (indent + oneLine.length <= MAX_WIDTH) return oneLine;

  switch (doc.tag) {
    case "atom":
      return doc.text;

    case "form": {
      const childIndent = indent + INDENT;
      const pad = " ".repeat(childIndent);
      const lines = [`(${doc.head}`];
      for (const slot of doc.slots) {
        const prefix = slot.kw ? `:${slot.kw} ` : "";
        const valueRendered = render(slot.value, childIndent + prefix.length);
        lines.push(`${pad}${prefix}${valueRendered}`);
      }
      const last = lines.length - 1;
      lines[last] = `${lines[last]})`;
      return lines.join("\n");
    }

    case "list": {
      const childIndent = indent + INDENT;
      const pad = " ".repeat(childIndent);
      const closePad = " ".repeat(indent);
      const lines = ["["];
      for (const item of doc.items) {
        lines.push(`${pad}${render(item, childIndent)}`);
      }
      lines.push(`${closePad}]`);
      return lines.join("\n");
    }
  }
}

// ---- IR → Doc --------------------------------------------------------------

export function printModule(mod: Module): string {
  return render(docModule(mod), 0);
}

function docModule(mod: Module): Doc {
  return form("Module", [pos(list(mod.body.map(docStmt)))]);
}

function docStmt(stmt: Stmt): Doc {
  switch (stmt.kind) {
    case "VarDecl": {
      const slots: Slot[] = [];
      if (stmt.exported) slots.push(kw("exported", atom("true")));
      slots.push(kw("kind", atom(stmt.bindingKind)));
      slots.push(kw("name", atom(stmt.name)));
      if (stmt.init !== undefined) slots.push(kw("init", docExpr(stmt.init)));
      return form("VarDecl", slots);
    }

    case "Destructure": {
      const slots: Slot[] = [];
      if (stmt.exported) slots.push(kw("exported", atom("true")));
      slots.push(kw("kind", atom(stmt.bindingKind)));
      slots.push(kw("pattern", docPattern(stmt.pattern)));
      slots.push(kw("init", docExpr(stmt.init)));
      return form("Destructure", slots);
    }

    case "FunDecl": {
      const slots: Slot[] = [];
      if (stmt.exported) slots.push(kw("exported", atom("true")));
      slots.push(kw("name", atom(stmt.name)));
      slots.push(kw("params", list(stmt.params.map((p) => atom(p.name)))));
      slots.push(kw("body", list(stmt.body.map(docStmt))));
      return form("FunDecl", slots);
    }

    case "If": {
      const slots: Slot[] = [
        kw("cond", docExpr(stmt.cond)),
        kw("then", list(stmt.consequent.map(docStmt))),
      ];
      if (stmt.alternate !== undefined) {
        slots.push(kw("else", list(stmt.alternate.map(docStmt))));
      }
      return form("If", slots);
    }

    case "Loop": {
      const slots: Slot[] = [kw("body", list(stmt.body.map(docStmt)))];
      if (stmt.update !== undefined) {
        slots.push(kw("update", list(stmt.update.map(docStmt))));
      }
      return form("Loop", slots);
    }

    case "Break":
      return form("Break", []);

    case "Continue":
      return form("Continue", []);

    case "Return":
      if (stmt.value === undefined) return form("Return", []);
      return form("Return", [pos(docExpr(stmt.value))]);

    case "ExprStmt":
      return form("ExprStmt", [pos(docExpr(stmt.expr))]);

    case "Assign":
      return form("Assign", [
        kw("target", docExpr(stmt.target)),
        kw("value", docExpr(stmt.value)),
      ]);
  }
}

function docPattern(pat: ArrayPattern): Doc {
  return form(
    "ArrPat",
    [
      pos(
        list(
          pat.elements.map((e) => form("ArrPatElem", [kw("name", atom(e.name))])),
        ),
      ),
    ],
  );
}

function docExpr(expr: Expr): Doc {
  switch (expr.kind) {
    case "NumericLiteral":
      return atom(formatNumber(expr.value));
    case "StringLiteral":
      return atom(JSON.stringify(expr.value));
    case "BooleanLiteral":
      return atom(expr.value ? "true" : "false");
    case "NullLiteral":
      return atom("null");
    case "Identifier":
      return atom(expr.name);

    case "es.NumericAdd":
      return form("es.NumericAdd", [pos(docExpr(expr.left)), pos(docExpr(expr.right))]);

    case "es.StringConcat":
      return form("es.StringConcat", [pos(docExpr(expr.left)), pos(docExpr(expr.right))]);

    case "Arithmetic":
      return form("Arith", [
        kw("op", atom(expr.op)),
        pos(docExpr(expr.left)),
        pos(docExpr(expr.right)),
      ]);

    case "Comparison":
      return form("Cmp", [
        kw("op", atom(expr.op)),
        pos(docExpr(expr.left)),
        pos(docExpr(expr.right)),
      ]);

    case "UnaryExpression":
      return form("Unary", [kw("op", atom(expr.op)), pos(docExpr(expr.operand))]);

    case "es.LogicalNot":
      return form("es.LogicalNot", [pos(docExpr(expr.operand))]);

    case "es.Truthy":
      return form("es.Truthy", [pos(docExpr(expr.expr))]);

    case "es.Equality": {
      const slots: Slot[] = [];
      if (expr.strict) slots.push(kw("strict", atom("true")));
      if (expr.negated) slots.push(kw("negated", atom("true")));
      slots.push(pos(docExpr(expr.left)));
      slots.push(pos(docExpr(expr.right)));
      return form("es.Equality", slots);
    }

    case "es.LogicalExpression":
      return form("es.LogicalExpression", [
        kw("op", atom(expr.op)),
        pos(docExpr(expr.left)),
        pos(docExpr(expr.right)),
      ]);

    case "Call":
      return form("Call", [
        kw("callee", docExpr(expr.callee)),
        kw("args", list(expr.args.map(docExpr))),
      ]);

    case "ArrayLit":
      return form("ArrayLit", [pos(list(expr.elements.map(docExpr)))]);

    case "PropertyAccess":
      return form("Member", [kw("name", atom(expr.name)), pos(docExpr(expr.receiver))]);

    case "es.ArrayLength":
      return form("es.ArrayLength", [pos(docExpr(expr.array))]);

    case "es.Conditional":
      return form("es.Conditional", [
        kw("cond", docExpr(expr.cond)),
        kw("then", docExpr(expr.whenTrue)),
        kw("else", docExpr(expr.whenFalse)),
      ]);

    case "ArrowFun":
      return form("ArrowFun", [
        kw("params", list(expr.params.map((p) => atom(p.name)))),
        kw("body", list(expr.body.map(docStmt))),
      ]);

    case "es.Index":
      return form("es.Index", [
        kw("array", docExpr(expr.array)),
        kw("index", docExpr(expr.index)),
      ]);

    case "ElementAccess":
      return form("ElementAccess", [
        kw("receiver", docExpr(expr.receiver)),
        kw("index", docExpr(expr.index)),
      ]);
  }
}

function formatNumber(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (n === Infinity) return "Infinity";
  if (n === -Infinity) return "-Infinity";
  return String(n);
}
