function andEffect(cond: boolean) {
  let i = 0;
  const r = cond && (i += 1);
  return r + i;
}

function orEffect(cond: boolean) {
  let i = 0;
  const r = cond || (i += 1);
  return r + i;
}

function pureAnd(a: boolean, b: boolean) {
  return a && b;
}

function pureOr(a: boolean, b: boolean) {
  return a || b;
}
