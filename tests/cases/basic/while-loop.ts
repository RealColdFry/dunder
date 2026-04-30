function countDown(n: number) {
  while (n > 0) {
    n--;
  }
  return n;
}

function sumTo(n: number) {
  let i = 0;
  let total = 0;
  while (i < n) {
    i++;
    total += i;
  }
  return total;
}

function doAtLeastOnce(n: number) {
  let i = 0;
  do {
    i++;
  } while (i < n);
  return i;
}

function whileBreak() {
  let i = 0;
  while (true) {
    if (i >= 5) break;
    i++;
  }
  return i;
}

function whileContinue() {
  let i = 0;
  let evens = 0;
  while (i < 10) {
    i++;
    if (i % 2 === 1) continue;
    evens++;
  }
  return evens;
}
