// Continue skips the rest of the iteration and runs the update; break
// exits the loop entirely.

export function __main(): number {
  let sum = 0;
  for (let i = 0; i < 10; i = i + 1) {
    if (i === 0) continue;
    if (i > 5) break;
    sum = sum + i;
  }
  return sum;
}
