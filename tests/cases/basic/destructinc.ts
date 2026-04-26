// Source-order eval: the pre-increment `arr[i]` read must be hoisted to a
// temp before `++i` lands so destructuring sees the right values.

const arr = [1, 2];

let i = 0;
let [v1, v2] = [arr[i], arr[++i]];

let [v3, v4] = [arr[i], arr[--i]];

const sum = v1 + v2 + v3 + v4;
