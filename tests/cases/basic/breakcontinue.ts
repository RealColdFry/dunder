declare function print(...args: unknown[]): void;

function findFirstEven(n: number) {
  for (let i = 0; i < n; i = i + 1) {
    if (i === 0) continue;
    if (i % 2 === 0) return i;
    if (i > 100) break;
  }
  return -1;
}

print(findFirstEven(20));
