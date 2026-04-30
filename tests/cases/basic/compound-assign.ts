let n = 1;
n += 2;
n -= 1;
n *= 3;
n /= 2;
n %= 5;
n **= 2;

let s = "hi";
s += " there";

function asExpression() {
  let i = 0;
  const r = (i += 5);
  return r + i;
}
