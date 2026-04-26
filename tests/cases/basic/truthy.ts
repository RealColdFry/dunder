function check(x: number, s: string) {
  if (x) {
    return s;
  }
  return !s ? "empty" : "ok";
}
