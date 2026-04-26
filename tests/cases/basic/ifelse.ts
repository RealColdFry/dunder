export function classify(input: number): number {
  if (input === 0) {
    return 0;
  } else if (input === 1) {
    return 1;
  } else if (input === 2) {
    return 2;
  } else {
    return 3;
  }
}
