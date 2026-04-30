// Conversion from TS-side diagnostic shapes (tsgo / tsc) to dunder's
// `Diagnostic`. Both pipelines flatten through this so downstream
// consumers see one shape regardless of which checker produced it.
//
// Severity mapping treats anything that is not `Warning` as `error`. TS
// has finer-grained categories (Suggestion, Message) that dunder collapses
// to "warning" for now; revisit if we ever want to surface suggestions.
//
// Message extraction is pipeline-specific because tsgo pre-flattens chains
// into `text` while tsc exposes `messageText` as a possibly-nested chain.

import type ts from "typescript";
import type { Diagnostic, Location } from "./types.ts";

// ── tsgo ────────────────────────────────────────────────────────────────

interface TsgoDiagnosticLike {
  text: string;
  code: number;
  category: { name: string } | string | number;
  file?: { fileName: string; text: string } | undefined;
  start?: number;
  length?: number;
}

export function fromTsgoDiagnostic(
  d: TsgoDiagnosticLike,
  kind: "syntactic" | "semantic",
): Diagnostic {
  return {
    severity: severityOf(d.category),
    code: d.code,
    message: d.text,
    origin: `checker:${kind}`,
    location: locationFromTsgo(d),
  };
}

function locationFromTsgo(d: TsgoDiagnosticLike): Location | null {
  if (!d.file || d.start === undefined) return null;
  const { line, column } = lineColumnAt(d.file.text, d.start);
  return {
    file: d.file.fileName,
    line,
    column,
    length: d.length ?? 0,
  };
}

// ── tsc ─────────────────────────────────────────────────────────────────

export function fromTscDiagnostic(
  d: ts.Diagnostic,
  kind: "syntactic" | "semantic",
  flattenMessageText: (m: string | ts.DiagnosticMessageChain | undefined, sep: string) => string,
): Diagnostic {
  return {
    severity: severityOfNumeric(d.category),
    code: d.code,
    message: flattenMessageText(d.messageText, "\n"),
    origin: `checker:${kind}`,
    location: locationFromTsc(d),
  };
}

function locationFromTsc(d: ts.Diagnostic): Location | null {
  if (!d.file || d.start === undefined) return null;
  const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
  return {
    file: d.file.fileName,
    line: line + 1,
    column: character + 1,
    length: d.length ?? 0,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────

// tsgo's category surfaces as a name string ("Error", "Warning", etc.) on
// some shapes and as an enum number on others depending on transport.
// Treat both, plus a defensive fallback to "error".
function severityOf(category: TsgoDiagnosticLike["category"]): "error" | "warning" {
  if (typeof category === "string") return category === "Warning" ? "warning" : "error";
  if (typeof category === "number") return severityOfNumeric(category);
  if (category && typeof category === "object" && "name" in category) {
    return category.name === "Warning" ? "warning" : "error";
  }
  return "error";
}

// tsc's DiagnosticCategory: Warning=0, Error=1, Suggestion=2, Message=3.
function severityOfNumeric(category: number): "error" | "warning" {
  return category === 0 ? "warning" : "error";
}

// 1-based line/column from a byte offset in source text. Walks the text
// once; not optimal for many calls on the same file but diagnostics are
// few and this avoids a SourceFile dependency.
function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}
