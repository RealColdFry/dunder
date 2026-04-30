// Parity demo: do-while with continue. The same shape as TSTL's
// `dowhile with continue` test, scaled down and run with our default
// backend (LuaJIT-as-5.1 in the parity VM). Locks in the do-while
// continue-label-vs-cond-check fix from this session.

export function __main() {
  const arrTest = [0, 1, 2, 3, 4];
  let i = 0;
  do {
    if (i % 2 == 0) {
      i++;
      continue;
    }
    let j = 2;
    do {
      if (j == 2) {
        j--;
        continue;
      }
      arrTest[i] = j;
      j--;
    } while (j > 0);

    i++;
  } while (i < arrTest.length);
  return arrTest;
}
