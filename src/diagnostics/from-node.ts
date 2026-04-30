// Compute a `Location` from a TS Node + its containing SourceFile.
// Used by validators and any other producer that has a Node but needs to
// emit a Diagnostic with a resolved (file, line, column, length).

import type ts from "typescript";
import type { Location } from "./types.ts";

export function locationFromNode(sf: ts.SourceFile, node: ts.Node): Location {
  const start = node.getStart(sf);
  const end = node.getEnd();
  const { line, character } = sf.getLineAndCharacterOfPosition(start);
  return {
    file: sf.fileName,
    line: line + 1,
    column: character + 1,
    length: end - start,
  };
}
