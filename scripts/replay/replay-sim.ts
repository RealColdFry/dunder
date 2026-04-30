// Replay simulator for instrumented TSTL checker logs.
//
// Reads a JSONL trace produced by the TSTL instrumentation harness and reports
// IPC round-trip counts under three batching policies:
//
//   naive       — every RPC-classified call is its own round trip.
//   memoized    — dedupe by (method, receiver-object-id, normalized args).
//   pipelined   — group by topological depth in the call graph; within a layer,
//                 every RPC-classified call ships as its own request frame but
//                 issued concurrently (Promise.all). Models tsgo today.
//   batched     — pipelined, plus methods with array overloads collapse to one
//                 RPC per (layer, method). Lower bound for any pre-pass scheme
//                 that respects data dependencies.
//
// Single-pass over the file; designed to stream multi-GB JSONL traces.
//
// Usage:
//   node --experimental-transform-types --no-warnings scripts/replay-sim.ts <log.jsonl>

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve as resolvePath } from "node:path";
import { isCallable } from "./replay-shared.ts";

interface NodeArg {
  node: {
    kind: string;
    pos: number;
    end: number;
    file?: string;
  };
}
interface RefArg {
  ref: number;
}
interface OpaqueArg {
  opaque: true;
}
type Arg = NodeArg | RefArg | OpaqueArg | string | number | boolean | null;

interface Entry {
  seq: number;
  receiverSeq: number | null;
  receiverKind: string;
  method: string;
  mapsTo: string;
  kind: string;
  args: Arg[];
  returns: string;
  resultSeq?: number;
  resultSeqs?: number[];
}

type Class = "bundled" | "unsupported" | "rpc";

// Methods with array-overload batch support in the tsgo IPC client. Anything
// not on this list can only be pipelined (Promise.all'd) under the batched
// policy.
const BATCH_OVERLOAD_METHODS = new Set([
  "getTypeAtLocation",
  "getSymbolAtLocation",
  "getTypeOfSymbol",
  "getTypeAtPosition",
  "getSymbolAtPosition",
]);

function classify(e: Entry): Class {
  if (e.mapsTo.startsWith("(bundled") || e.mapsTo === "(flags bit)") return "bundled";
  if (e.mapsTo === "UNSUPPORTED" || e.mapsTo === "UNKNOWN") return "unsupported";
  // Instrumentation may write hopeful mapsTo strings for methods the live
  // tsgo IPC client doesn't expose. Treat those as unsupported.
  if (!isCallable(e.mapsTo)) return "unsupported";
  return "rpc";
}

function isRefArg(a: Arg): a is RefArg {
  return typeof a === "object" && a !== null && "ref" in a;
}
function isNodeArg(a: Arg): a is NodeArg {
  return typeof a === "object" && a !== null && "node" in a;
}

function normalizeArg(a: Arg): string {
  if (a === null) return "null";
  if (typeof a !== "object") return JSON.stringify(a);
  if (isRefArg(a)) return `ref:${a.ref}`;
  if (isNodeArg(a)) {
    const n = a.node;
    return `node:${n.kind}:${n.file ?? ""}:${n.pos}:${n.end}`;
  }
  return JSON.stringify(a);
}

function memoKey(e: Entry): string {
  const recv = e.receiverSeq === null ? `${e.receiverKind}` : `${e.receiverKind}:${e.receiverSeq}`;
  const args = e.args.map(normalizeArg).join("|");
  return `${e.mapsTo}@${recv}(${args})`;
}

interface Stats {
  total: number;
  rpc: number;
  bundled: number;
  unsupported: number;
  naive: number;
  memoSeen: Set<string>;
  // (layer, method) -> call count. One key per group; size of map is the
  // number of "batched-policy" RPCs.
  batchedGroups: Map<string, number>;
  // Same as batchedGroups but only counts the first occurrence of each
  // memoKey, modelling memoized + batched.
  memoBatchedGroups: Map<string, number>;
  // Per-layer call count for the pipelined policy (one frame per call).
  pipelinedPerLayer: Map<number, number>;
  // Earliest layer at which a given resultSeq becomes available.
  availableAt: Map<number, number>;
  unsupportedMethods: Map<string, number>;
  batchedPerLayer: Map<
    number,
    {
      methods: Set<string>;
      calls: number;
    }
  >;
  maxLayer: number;
}

function makeStats(): Stats {
  return {
    total: 0,
    rpc: 0,
    bundled: 0,
    unsupported: 0,
    naive: 0,
    memoSeen: new Set(),
    batchedGroups: new Map(),
    memoBatchedGroups: new Map(),
    pipelinedPerLayer: new Map(),
    availableAt: new Map(),
    unsupportedMethods: new Map(),
    batchedPerLayer: new Map(),
    maxLayer: 0,
  };
}

function fold(s: Stats, e: Entry): void {
  s.total++;
  const c = classify(e);
  s[c]++;

  // Compute this call's layer from currently-available results.
  // Deps that weren't produced upstream in the trace are treated as
  // session-level (available from L0). Permissive but keeps the lower bound
  // honest.
  let layer = 0;
  if (e.receiverSeq !== null) {
    const a = s.availableAt.get(e.receiverSeq);
    if (a !== undefined && a > layer) layer = a;
  }
  for (const a of e.args) {
    if (isRefArg(a)) {
      const av = s.availableAt.get(a.ref);
      if (av !== undefined && av > layer) layer = av;
    }
  }

  // Results produced here become visible at layer + 1.
  if (e.resultSeq !== undefined) {
    const prev = s.availableAt.get(e.resultSeq);
    if (prev === undefined || layer + 1 < prev) s.availableAt.set(e.resultSeq, layer + 1);
  }
  if (e.resultSeqs !== undefined) {
    for (const r of e.resultSeqs) {
      const prev = s.availableAt.get(r);
      if (prev === undefined || layer + 1 < prev) s.availableAt.set(r, layer + 1);
    }
  }

  if (c !== "rpc") {
    if (c === "unsupported") {
      s.unsupportedMethods.set(e.method, (s.unsupportedMethods.get(e.method) ?? 0) + 1);
    }
    return;
  }

  s.naive++;
  const mk = memoKey(e);
  const memoFirstSeen = !s.memoSeen.has(mk);
  s.memoSeen.add(mk);
  if (layer > s.maxLayer) s.maxLayer = layer;

  // pipelined: 1 frame per call, grouped per-layer for reporting only.
  s.pipelinedPerLayer.set(layer, (s.pipelinedPerLayer.get(layer) ?? 0) + 1);

  // batched: methods with array overloads collapse to 1 RPC per (layer, method);
  // others remain 1 RPC per call (= pipelined within the layer).
  if (BATCH_OVERLOAD_METHODS.has(e.mapsTo)) {
    const key = `${layer}::${e.mapsTo}`;
    s.batchedGroups.set(key, (s.batchedGroups.get(key) ?? 0) + 1);
    if (memoFirstSeen) s.memoBatchedGroups.set(key, (s.memoBatchedGroups.get(key) ?? 0) + 1);
  } else {
    s.batchedGroups.set(`${layer}::${e.mapsTo}::${e.seq}`, 1);
    if (memoFirstSeen) s.memoBatchedGroups.set(`${layer}::${e.mapsTo}::${e.seq}`, 1);
  }

  let bl = s.batchedPerLayer.get(layer);
  if (!bl) {
    bl = {
      methods: new Set(),
      calls: 0,
    };
    s.batchedPerLayer.set(layer, bl);
  }
  bl.methods.add(e.method);
  bl.calls++;
}

async function streamLog(path: string, onEntry: (e: Entry) => void): Promise<void> {
  const stream = createReadStream(path, {
    encoding: "utf8",
  });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  let progressTick = 0;
  const PROGRESS_EVERY = 100_000;
  for await (const line of rl) {
    lineNo++;
    if (line.length === 0) continue;
    try {
      const e = JSON.parse(line) as Entry;
      onEntry(e);
    } catch (err) {
      console.error(`parse error on line ${lineNo}: ${(err as Error).message}`);
      throw err;
    }
    if (lineNo - progressTick >= PROGRESS_EVERY) {
      progressTick = lineNo;
      process.stderr.write(`  ...${lineNo.toLocaleString()} lines\r`);
    }
  }
  if (progressTick > 0) process.stderr.write(`  ...${lineNo.toLocaleString()} lines\n`);
}

function pipelinedTotal(s: Stats): number {
  // Sanity check: should equal s.naive.
  let total = 0;
  for (const v of s.pipelinedPerLayer.values()) total += v;
  return total;
}

function report(s: Stats): void {
  console.log(`Total log entries:        ${s.total.toLocaleString()}`);
  console.log(`  rpc-classified:         ${s.rpc.toLocaleString()}`);
  console.log(`  bundled (free reads):   ${s.bundled.toLocaleString()}`);
  console.log(`  unsupported/unknown:    ${s.unsupported.toLocaleString()}`);
  console.log("");
  console.log("RPC frame counts under each policy:");
  console.log(`  naive (1 frame/call):       ${s.naive.toLocaleString()}`);
  console.log(`  memoized (dedupe):          ${s.memoSeen.size.toLocaleString()}`);
  console.log(
    `  pipelined (Promise.all):    ${pipelinedTotal(s).toLocaleString()}  across ${s.batchedPerLayer.size} layer(s)`,
  );
  console.log(
    `  batched (+array overloads): ${s.batchedGroups.size.toLocaleString()}  across ${s.batchedPerLayer.size} layer(s)`,
  );
  console.log(`  memoized + batched:         ${s.memoBatchedGroups.size.toLocaleString()}`);
  console.log("");
  console.log("Per-layer breakdown:");
  const layers = [...s.batchedPerLayer.keys()].sort((a, b) => a - b);
  for (const layer of layers) {
    const bl = s.batchedPerLayer.get(layer)!;
    const overloadable = [...bl.methods].filter((m) => BATCH_OVERLOAD_METHODS.has(m));
    console.log(
      `  L${layer}: ${bl.calls.toLocaleString()} call(s), ${bl.methods.size} distinct method(s), ${overloadable.length} with array overload`,
    );
  }
  if (s.unsupportedMethods.size > 0) {
    console.log("");
    console.log("Unsupported/unknown methods (TSTL needs, no tsgo IPC mapping):");
    const sorted = [...s.unsupportedMethods.entries()].sort((a, b) => b[1] - a[1]);
    for (const [m, n] of sorted) {
      console.log(`  ${n.toLocaleString().padStart(8)}  ${m}`);
    }
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: replay-sim <log.jsonl>");
    process.exit(2);
  }
  const initCwd = process.env.INIT_CWD ?? process.cwd();
  const path = resolvePath(initCwd, arg);
  const stats = makeStats();
  await streamLog(path, (e) => fold(stats, e));
  report(stats);
}

await main();
