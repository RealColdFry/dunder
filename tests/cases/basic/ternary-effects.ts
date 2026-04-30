function statementPos(cond: boolean) {
  let i = 0;
  cond ? i++ : i--;
  return i;
}

function effectfulTrue(cond: boolean) {
  let i = 0;
  const r = cond ? (i += 1) : i;
  return r + i;
}

function effectfulFalse(cond: boolean) {
  let i = 0;
  const r = cond ? i : (i += 2);
  return r + i;
}

function pure(cond: boolean) {
  return cond ? 1 : 2;
}
