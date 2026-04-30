// LCS-based line diff. Output format mirrors `diff -u` without hunk
// headers: ` ` for context, `-` for left-only, `+` for right-only. Used
// by the harness to surface dunder-vs-TSTL emit differences in failure
// dumps. Returns the empty string when the two inputs are identical so
// callers can decide whether to render the section at all.
//
// `colorize` adds ANSI red/green to `-` and `+` lines respectively.
// Vitest's reporter preserves ANSI in error messages, so the colored
// output renders correctly when the dump is appended to a test error.
// Pass `false` for non-TTY destinations (CI logs, file redirects) to
// keep output greppable.

// Each colored line resets first, then sets its own color. The lead reset
// breaks out of any styling vitest's reporter applied to the surrounding
// error message (errors are rendered red by default), which would
// otherwise dye every embedded `+` / `-` line the same color as the
// outer wrap.
const ANSI_MINUS = "\x1b[0m\x1b[31m";
const ANSI_PLUS = "\x1b[0m\x1b[32m";
const ANSI_RESET = "\x1b[0m";

export interface LineDiffOptions {
  colorize?: boolean;
}

export function lineDiff(left: string, right: string, opts: LineDiffOptions = {}): string {
  if (left === right) return "";

  const colorize = opts.colorize ?? false;
  const minus = (s: string): string => (colorize ? `${ANSI_MINUS}- ${s}${ANSI_RESET}` : `- ${s}`);
  const plus = (s: string): string => (colorize ? `${ANSI_PLUS}+ ${s}${ANSI_RESET}` : `+ ${s}`);

  const a = left.split("\n");
  const b = right.split("\n");
  const n = a.length;
  const m = b.length;

  // Standard LCS DP table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(minus(a[i]!));
      i++;
    } else {
      out.push(plus(b[j]!));
      j++;
    }
  }
  while (i < n) out.push(minus(a[i++]!));
  while (j < m) out.push(plus(b[j++]!));
  return out.join("\n");
}
