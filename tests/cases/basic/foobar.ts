function hello(a: number | string, b: string) {
  return a + b;
}

const a = hello(1, "b");
const b = hello("a", "b");
