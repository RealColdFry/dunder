// Lexical closure capture: each call to makeCounter creates a fresh `count`
// binding; the returned arrow function references that binding via Lua's
// upvalue mechanism (same as ES). Multiple inc() calls mutate the captured
// `count` so subsequent reads see the updated value.

function makeCounter() {
  let count = 0;
  return () => {
    count = count + 1;
    return count;
  };
}
const inc = makeCounter();
inc();
inc();
