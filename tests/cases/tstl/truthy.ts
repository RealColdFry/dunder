// Each `if`/`while`/`do-while`/`?:` condition below has a type that
// cannot be falsy under TS's flag-based truthiness. The TSTL backend's
// truthy-only-condition validator should warn at each.

declare const n: number;
declare const s: string;
declare const o: { a: number };

if (n) {
}

while (s) {}

do {} while (o);

const x = n ? 1 : 2;

// These should NOT warn: union with falsy constituent.
declare const maybeN: number | undefined;
declare const b: boolean;

if (maybeN) {
}

if (b) {
}
