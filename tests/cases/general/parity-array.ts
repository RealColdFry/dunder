// Parity demo: array indexing + length. Exercises the EsArrayLength /
// EsIndex divergences (DIV-ARR-INDEX-001) end-to-end, and tests that
// dunder's 0-to-1 index translation produces the same observable
// results as JS.

export function __main() {
  const arr = [10, 20, 30, 40, 50];
  let sum = 0;
  let i = 0;
  while (i < arr.length) {
    sum = sum + arr[i];
    i = i + 1;
  }
  return { sum, len: arr.length, first: arr[0], last: arr[arr.length - 1] };
}
