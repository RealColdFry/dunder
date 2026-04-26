// Real-IPC benchmark harness. Boots tsgo, walks source files referenced in
// the trace, replays the log against the live checker under one of several
// batching policies, and reports wall-clock + coverage.
//
// Usage:
//   npm run replay-bench -- \
//     --trace=<log.jsonl> --project=<tsconfig.json> \
//     --policy=naive|memoized|pipelined|batched \
//     [--limit=N] [--warmup=N] [--runs=M]

import { API, SignatureKind } from "@typescript/native-preview/async";
import type {
  Checker,
  Type,
  Symbol as TsSymbol,
  Signature,
} from "@typescript/native-preview/async";
import {
  SyntaxKind,
  type Expression,
  type Node,
  type SourceFile,
} from "@typescript/native-preview/ast";
import { resolveTsgoBin } from "../../src/tsgo-bin.ts";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve as resolvePath } from "node:path";
import { isCallable } from "./replay-shared.ts";

interface NodeArg {
  node: { kind: string; pos: number; end: number; file?: string };
}
interface RefArg {
  ref: number;
}
type Arg = NodeArg | RefArg | { opaque: true } | string | number | boolean | null;

interface Entry {
  seq: number;
  receiverSeq: number | null;
  receiverKind: string;
  method: string;
  mapsTo: string;
  args: Arg[];
  resultSeq?: number;
  resultSeqs?: number[];
}

type Policy = "naive" | "memoized" | "pipelined" | "batched" | "memoized-batched";

const BATCH_OVERLOAD_METHODS = new Set([
  "getTypeAtLocation",
  "getSymbolAtLocation",
  "getTypeOfSymbol",
  "getTypeAtPosition",
  "getSymbolAtPosition",
]);

function isRefArg(a: Arg): a is RefArg {
  return typeof a === "object" && a !== null && "ref" in a;
}
function isNodeArg(a: Arg): a is NodeArg {
  return typeof a === "object" && a !== null && "node" in a;
}

function classify(e: Entry): "rpc" | "bundled" | "unsupported" {
  if (e.mapsTo.startsWith("(bundled") || e.mapsTo === "(flags bit)") return "bundled";
  if (e.mapsTo === "UNSUPPORTED" || e.mapsTo === "UNKNOWN") return "unsupported";
  if (!isCallable(e.mapsTo)) return "unsupported";
  return "rpc";
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
  return `${e.mapsTo}@${recv}(${e.args.map(normalizeArg).join("|")})`;
}

async function readEntries(path: string, limit: number): Promise<Entry[]> {
  const out: Entry[] = [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.length === 0) continue;
    out.push(JSON.parse(line) as Entry);
    if (limit > 0 && out.length >= limit) break;
  }
  return out;
}

function computeLayers(entries: Entry[]): Map<number, number> {
  const availableAt = new Map<number, number>();
  const layerBySeq = new Map<number, number>();
  for (const e of entries) {
    let layer = 0;
    if (e.receiverSeq !== null) {
      const a = availableAt.get(e.receiverSeq);
      if (a !== undefined && a > layer) layer = a;
    }
    for (const a of e.args) {
      if (isRefArg(a)) {
        const av = availableAt.get(a.ref);
        if (av !== undefined && av > layer) layer = av;
      }
    }
    layerBySeq.set(e.seq, layer);
    if (e.resultSeq !== undefined) {
      const prev = availableAt.get(e.resultSeq);
      if (prev === undefined || layer + 1 < prev) availableAt.set(e.resultSeq, layer + 1);
    }
    if (e.resultSeqs) {
      for (const r of e.resultSeqs) {
        const prev = availableAt.get(r);
        if (prev === undefined || layer + 1 < prev) availableAt.set(r, layer + 1);
      }
    }
  }
  return layerBySeq;
}

function nodeKey(file: string, pos: number, end: number, kind: number): string {
  return `${file}:${pos}:${end}:${kind}`;
}

function syntaxKindFromName(name: string): number | undefined {
  const v = (SyntaxKind as unknown as Record<string, number | string>)[name];
  return typeof v === "number" ? v : undefined;
}

async function buildNodeLookup(
  files: Set<string>,
  getSourceFile: (path: string) => Promise<SourceFile | undefined>,
): Promise<Map<string, Node>> {
  const m = new Map<string, Node>();
  for (const f of files) {
    const sf = await getSourceFile(f);
    if (!sf) continue;
    const visit = (node: Node): void => {
      m.set(nodeKey(f, node.pos, node.end, node.kind), node);
      node.forEachChild(visit);
    };
    m.set(nodeKey(f, sf.pos, sf.end, sf.kind), sf);
    sf.forEachChild(visit);
  }
  return m;
}

interface RunResult {
  policy: Policy;
  ms: number;
  attempted: number;
  issued: number;
  skipped: { reason: string; count: number }[];
}

interface Coverage {
  attempted: number;
  issued: number;
  skipReasons: Map<string, number>;
}

function bumpSkip(c: Coverage, reason: string): void {
  c.skipReasons.set(reason, (c.skipReasons.get(reason) ?? 0) + 1);
}

interface ResolvedEntry {
  entry: Entry;
  layer: number;
  receiver: unknown | null; // live object or null if no receiver
  argRefs: unknown[]; // live objects for {ref:N} args, in arg order
  argScalars: (string | number | boolean | null)[]; // scalar args, in arg order
  argNodes: Node[]; // node args, in arg order
}

// Resolve the live objects this entry needs from the running ref map. Returns
// null if any required dep isn't available (call must be skipped).
function resolveDeps(
  e: Entry,
  refMap: Map<number, unknown>,
  nodeLookup: Map<string, Node>,
): ResolvedEntry | { reason: string } {
  let receiver: unknown | null = null;
  if (e.receiverSeq !== null) {
    receiver = refMap.get(e.receiverSeq);
    if (receiver === undefined) return { reason: "missing-receiver" };
  }
  const argRefs: unknown[] = [];
  const argScalars: (string | number | boolean | null)[] = [];
  const argNodes: Node[] = [];
  for (const a of e.args) {
    if (isRefArg(a)) {
      const v = refMap.get(a.ref);
      if (v === undefined) return { reason: "missing-arg-ref" };
      argRefs.push(v);
    } else if (isNodeArg(a)) {
      const n = a.node;
      if (!n.file || n.pos < 0 || n.end < 0) return { reason: "synthetic-node" };
      const kindNum = syntaxKindFromName(n.kind);
      if (kindNum === undefined) return { reason: "unknown-syntax-kind" };
      const live = nodeLookup.get(nodeKey(n.file, n.pos, n.end, kindNum));
      if (!live) return { reason: "node-not-found" };
      argNodes.push(live);
    } else if (typeof a === "object" && a !== null && "opaque" in a) {
      return { reason: "opaque-arg" };
    } else {
      argScalars.push(a as string | number | boolean | null);
    }
  }
  // layer is set by caller.
  return { entry: e, layer: 0, receiver, argRefs, argScalars, argNodes };
}

// Single-call dispatch keyed off the trace's `mapsTo` (IPC method name).
function dispatch(
  checker: Checker,
  r: ResolvedEntry,
): (() => Promise<unknown>) | { reason: string } {
  const { entry: e, receiver, argNodes, argRefs, argScalars } = r;
  switch (e.mapsTo) {
    case "getTypeAtLocation":
      if (argNodes.length !== 1) return { reason: "bad-arity" };
      return () => checker.getTypeAtLocation(argNodes[0]);
    case "getSymbolAtLocation":
      if (argNodes.length !== 1) return { reason: "bad-arity" };
      return () => checker.getSymbolAtLocation(argNodes[0]);
    case "getTypeOfSymbolAtLocation": {
      if (argRefs.length !== 1 || argNodes.length !== 1) return { reason: "bad-arity" };
      const sym = argRefs[0] as TsSymbol;
      return () => checker.getTypeOfSymbolAtLocation(sym, argNodes[0]);
    }
    case "getDeclaredTypeOfSymbol": {
      if (argRefs.length !== 1) return { reason: "bad-arity" };
      const sym = argRefs[0] as TsSymbol;
      return () => checker.getDeclaredTypeOfSymbol(sym);
    }
    case "getSignaturesOfType": {
      if (argRefs.length !== 1 || argScalars.length !== 1) return { reason: "bad-arity" };
      const t = argRefs[0] as Type;
      const kind = argScalars[0] as number;
      return () => checker.getSignaturesOfType(t, kind);
    }
    case "getSignaturesOfType(Call)": {
      if (!receiver) return { reason: "no-receiver" };
      return () => checker.getSignaturesOfType(receiver as Type, SignatureKind.Call);
    }
    case "getContextualType":
      if (argNodes.length !== 1) return { reason: "bad-arity" };
      return () => checker.getContextualType(argNodes[0] as Expression);
    case "getPropertiesOfType": {
      if (!receiver) return { reason: "no-receiver" };
      return () => checker.getPropertiesOfType(receiver as Type);
    }
    case "getBaseTypes":
    case "Type.getBaseType": {
      if (!receiver) return { reason: "no-receiver" };
      return () => checker.getBaseTypes(receiver as Type);
    }
    case "getReturnTypeOfSignature":
    case "Signature.getReturnType": {
      if (!receiver) return { reason: "no-receiver" };
      return () => checker.getReturnTypeOfSignature(receiver as Signature);
    }
    case "getTypeArguments": {
      if (!receiver) return { reason: "no-receiver" };
      return () => checker.getTypeArguments(receiver as Type);
    }
    case "Type.getSymbol": {
      if (!receiver) return { reason: "no-receiver" };
      return () => (receiver as Type).getSymbol();
    }
    case "Type.getTypes": {
      if (!receiver) return { reason: "no-receiver" };
      // Only valid on UnionOrIntersectionType / TemplateLiteralType.
      // Cast through unknown to a structural type that exposes getTypes.
      const t = receiver as unknown as {
        getTypes?: () => Promise<readonly Type[]>;
      };
      if (typeof t.getTypes !== "function") return { reason: "no-method-on-type" };
      return () => t.getTypes!();
    }
    case "Type.getConstraint": {
      if (!receiver) return { reason: "no-receiver" };
      // Only valid on SubstitutionType.
      const t = receiver as unknown as { getConstraint?: () => Promise<Type> };
      if (typeof t.getConstraint !== "function") return { reason: "no-method-on-type" };
      return () => t.getConstraint!();
    }
    case "Symbol.getMembers": {
      if (!receiver) return { reason: "no-receiver" };
      return () => (receiver as TsSymbol).getMembers();
    }
    case "Symbol.getExports": {
      if (!receiver) return { reason: "no-receiver" };
      return () => (receiver as TsSymbol).getExports();
    }
    case "Symbol.getParent": {
      if (!receiver) return { reason: "no-receiver" };
      return () => (receiver as TsSymbol).getParent();
    }
    case "Symbol.getExportSymbol": {
      if (!receiver) return { reason: "no-receiver" };
      return () => (receiver as TsSymbol).getExportSymbol();
    }
    default:
      return { reason: `no-mapping:${e.mapsTo}` };
  }
}

function recordResult(refMap: Map<number, unknown>, e: Entry, result: unknown): void {
  if (result === undefined || result === null) return;
  if (e.resultSeq !== undefined) refMap.set(e.resultSeq, result);
  if (e.resultSeqs && Array.isArray(result)) {
    const arr = result as unknown[];
    for (let i = 0; i < e.resultSeqs.length && i < arr.length; i++) {
      const v = arr[i];
      if (v !== undefined && v !== null) refMap.set(e.resultSeqs[i], v);
    }
  }
}

function errorReason(err: unknown, method: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Server-side panics arrive as JSON-RPC errors; the message is multi-line.
  // Keep the first line for grouping.
  const first = msg.split("\n", 1)[0].slice(0, 200);
  return `error:${method}:${first}`;
}

async function runNaive(
  entries: Entry[],
  checker: Checker,
  nodeLookup: Map<string, Node>,
  cov: Coverage,
): Promise<void> {
  const refMap = new Map<number, unknown>();
  for (const e of entries) {
    if (classify(e) !== "rpc") continue;
    cov.attempted++;
    const r = resolveDeps(e, refMap, nodeLookup);
    if ("reason" in r) {
      bumpSkip(cov, r.reason);
      continue;
    }
    const d = dispatch(checker, r);
    if (typeof d !== "function") {
      bumpSkip(cov, d.reason);
      continue;
    }
    try {
      const result = await d();
      cov.issued++;
      recordResult(refMap, e, result);
    } catch (err) {
      bumpSkip(cov, errorReason(err, e.method));
    }
  }
}

async function runMemoized(
  entries: Entry[],
  checker: Checker,
  nodeLookup: Map<string, Node>,
  cov: Coverage,
): Promise<void> {
  const refMap = new Map<number, unknown>();
  const memo = new Map<string, unknown>();
  for (const e of entries) {
    if (classify(e) !== "rpc") continue;
    cov.attempted++;
    const r = resolveDeps(e, refMap, nodeLookup);
    if ("reason" in r) {
      bumpSkip(cov, r.reason);
      continue;
    }
    const k = memoKey(e);
    let result: unknown;
    if (memo.has(k)) {
      result = memo.get(k);
    } else {
      const d = dispatch(checker, r);
      if (typeof d !== "function") {
        bumpSkip(cov, d.reason);
        continue;
      }
      try {
        result = await d();
        cov.issued++;
        memo.set(k, result);
      } catch (err) {
        bumpSkip(cov, errorReason(err, e.method));
        continue;
      }
    }
    recordResult(refMap, e, result);
  }
}

async function runLayered(
  entries: Entry[],
  layerBySeq: Map<number, number>,
  checker: Checker,
  nodeLookup: Map<string, Node>,
  cov: Coverage,
  policy: "pipelined" | "batched" | "memoized-batched",
): Promise<void> {
  const refMap = new Map<number, unknown>();
  // memoized-batched: only the first occurrence of each memoKey gets issued;
  // later duplicates copy the cached result into their own resultSeqs.
  const memoResults = new Map<string, unknown>();

  // Group RPC-classified entries by layer in trace order.
  const byLayer = new Map<number, Entry[]>();
  for (const e of entries) {
    if (classify(e) !== "rpc") continue;
    const layer = layerBySeq.get(e.seq)!;
    let arr = byLayer.get(layer);
    if (!arr) {
      arr = [];
      byLayer.set(layer, arr);
    }
    arr.push(e);
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b);

  for (const layer of layers) {
    const queue = byLayer.get(layer)!;

    // Resolve deps for all entries up front (against the ref map as it stands
    // entering this layer). After this layer's awaits complete, we update
    // refMap with the produced results before moving on.
    interface Pending {
      entry: Entry;
      resolved: ResolvedEntry;
    }
    const pendingByMethod = new Map<string, Pending[]>();
    const pendingSequential: Pending[] = [];
    const useBatchOverloads = policy === "batched" || policy === "memoized-batched";
    // memoized-batched: entries that are duplicates of something queued/cached
    // in this layer. After the layer's awaits complete, we recordResult for
    // them using memoResults.
    const layerDups: Entry[] = [];
    const queuedKeys = new Set<string>();
    for (const e of queue) {
      cov.attempted++;
      if (policy === "memoized-batched") {
        const k = memoKey(e);
        if (memoResults.has(k)) {
          recordResult(refMap, e, memoResults.get(k));
          continue;
        }
        if (queuedKeys.has(k)) {
          layerDups.push(e);
          continue;
        }
      }
      const r = resolveDeps(e, refMap, nodeLookup);
      if ("reason" in r) {
        bumpSkip(cov, r.reason);
        continue;
      }
      const d = dispatch(checker, r);
      if (typeof d !== "function") {
        bumpSkip(cov, d.reason);
        continue;
      }
      (r as ResolvedEntry & { thunk?: () => Promise<unknown> }).thunk = d;
      if (policy === "memoized-batched") queuedKeys.add(memoKey(e));
      if (
        useBatchOverloads &&
        BATCH_OVERLOAD_METHODS.has(e.mapsTo) &&
        e.receiverKind === "checker"
      ) {
        let arr = pendingByMethod.get(e.mapsTo);
        if (!arr) {
          arr = [];
          pendingByMethod.set(e.mapsTo, arr);
        }
        arr.push({ entry: e, resolved: r });
      } else {
        pendingSequential.push({ entry: e, resolved: r });
      }
    }

    // Issue: pipelined = all Promise.all'd individually; batched = array form
    // for the supported methods, plus Promise.all for the rest. Each promise
    // resolves to an array of {entry, result?, error?} so a single failure
    // doesn't poison the layer.
    type Outcome = { entry: Entry; result?: unknown; error?: unknown };
    const promises: Promise<Outcome[]>[] = [];

    for (const [method, items] of pendingByMethod) {
      if (method === "getTypeAtLocation" || method === "getSymbolAtLocation") {
        const nodes = items.map((it) => it.resolved.argNodes[0]);
        const call =
          method === "getTypeAtLocation"
            ? checker.getTypeAtLocation(nodes)
            : checker.getSymbolAtLocation(nodes);
        const p = call.then(
          (arr) => items.map((it, i) => ({ entry: it.entry, result: arr[i] })),
          (err) => items.map((it) => ({ entry: it.entry, error: err })),
        );
        promises.push(p);
        cov.issued++;
      } else if (method === "getTypeOfSymbol") {
        const symbols = items.map((it) => it.resolved.argRefs[0] as TsSymbol);
        const p = checker.getTypeOfSymbol(symbols).then(
          (arr) => items.map((it, i) => ({ entry: it.entry, result: arr[i] })),
          (err) => items.map((it) => ({ entry: it.entry, error: err })),
        );
        promises.push(p);
        cov.issued++;
      } else {
        for (const it of items) pendingSequential.push(it);
      }
    }

    for (const it of pendingSequential) {
      const thunk = (it.resolved as ResolvedEntry & { thunk: () => Promise<unknown> }).thunk;
      promises.push(
        thunk().then(
          (result) => [{ entry: it.entry, result }],
          (err) => [{ entry: it.entry, error: err }],
        ),
      );
      cov.issued++;
    }

    const settled = await Promise.all(promises);
    for (const group of settled) {
      for (const { entry, result, error } of group) {
        if (error !== undefined) {
          bumpSkip(cov, errorReason(error, entry.method));
        } else {
          recordResult(refMap, entry, result);
          if (policy === "memoized-batched") {
            memoResults.set(memoKey(entry), result);
          }
        }
      }
    }
    // Fan-out cached results to intra-layer duplicates.
    if (policy === "memoized-batched") {
      for (const e of layerDups) {
        const k = memoKey(e);
        if (memoResults.has(k)) recordResult(refMap, e, memoResults.get(k));
      }
    }
  }
}

interface Args {
  trace: string;
  project: string;
  policy: Policy;
  limit: number;
  warmup: number;
  runs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : undefined;
  };
  const trace = get("trace");
  const project = get("project");
  const policyRaw = get("policy") ?? "naive";
  if (!trace || !project) {
    console.error(
      "usage: replay-bench --trace=<log.jsonl> --project=<tsconfig.json> [--policy=...] [--limit=N] [--warmup=N] [--runs=M]",
    );
    process.exit(2);
  }
  const policy = policyRaw as Policy;
  if (!["naive", "memoized", "pipelined", "batched", "memoized-batched"].includes(policy)) {
    console.error(`unknown policy: ${policyRaw}`);
    process.exit(2);
  }
  const initCwd = process.env.INIT_CWD ?? process.cwd();
  return {
    trace: resolvePath(initCwd, trace),
    project: resolvePath(initCwd, project),
    policy,
    limit: Number(get("limit") ?? 0),
    warmup: Number(get("warmup") ?? 0),
    runs: Number(get("runs") ?? 1),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.trace)) throw new Error(`trace not found: ${args.trace}`);
  if (!existsSync(args.project)) throw new Error(`project not found: ${args.project}`);

  console.error(`Loading trace ${args.trace}${args.limit ? ` (limit ${args.limit})` : ""}...`);
  const entries = await readEntries(args.trace, args.limit);
  console.error(`  ${entries.length.toLocaleString()} entries loaded.`);

  console.error("Computing layers...");
  const layerBySeq = computeLayers(entries);
  let maxLayer = 0;
  for (const v of layerBySeq.values()) if (v > maxLayer) maxLayer = v;
  console.error(`  max layer: ${maxLayer}`);

  // Distinct files referenced.
  const files = new Set<string>();
  for (const e of entries) {
    for (const a of e.args) {
      if (isNodeArg(a) && a.node.file) files.add(a.node.file);
    }
  }
  console.error(`  distinct source files in trace: ${files.size}`);

  console.error("Booting tsgo...");
  const api = new API({
    tsserverPath: resolveTsgoBin(),
    cwd: dirname(args.project),
  });
  try {
    const snapshot = await api.updateSnapshot({ openProject: args.project });
    const project = snapshot.getProject(args.project);
    if (!project) throw new Error(`project not loaded: ${args.project}`);
    // Force project-wide checking once so semantic state is warm.
    await project.program.getSemanticDiagnostics();

    console.error("Building node lookup...");
    const nodeLookup = await buildNodeLookup(files, (p) => project.program.getSourceFile(p));
    console.error(`  ${nodeLookup.size.toLocaleString()} nodes indexed`);

    const runOnce = async (): Promise<RunResult> => {
      const cov: Coverage = { attempted: 0, issued: 0, skipReasons: new Map() };
      const t0 = performance.now();
      switch (args.policy) {
        case "naive":
          await runNaive(entries, project.checker, nodeLookup, cov);
          break;
        case "memoized":
          await runMemoized(entries, project.checker, nodeLookup, cov);
          break;
        case "pipelined":
          await runLayered(entries, layerBySeq, project.checker, nodeLookup, cov, "pipelined");
          break;
        case "batched":
          await runLayered(entries, layerBySeq, project.checker, nodeLookup, cov, "batched");
          break;
        case "memoized-batched":
          await runLayered(
            entries,
            layerBySeq,
            project.checker,
            nodeLookup,
            cov,
            "memoized-batched",
          );
          break;
      }
      const ms = performance.now() - t0;
      return {
        policy: args.policy,
        ms,
        attempted: cov.attempted,
        issued: cov.issued,
        skipped: [...cov.skipReasons.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([reason, count]) => ({ reason, count })),
      };
    };

    for (let i = 0; i < args.warmup; i++) {
      console.error(`warmup ${i + 1}/${args.warmup}...`);
      await runOnce();
    }

    const results: RunResult[] = [];
    for (let i = 0; i < args.runs; i++) {
      console.error(`run ${i + 1}/${args.runs}...`);
      results.push(await runOnce());
    }

    const ms = results.map((r) => r.ms).sort((a, b) => a - b);
    const median = ms[Math.floor(ms.length / 2)];
    const last = results[results.length - 1];

    console.log("");
    console.log(`policy:    ${args.policy}`);
    console.log(`runs:      ${results.length} (warmup ${args.warmup})`);
    console.log(`median ms: ${median.toFixed(2)}`);
    console.log(`all ms:    ${ms.map((m) => m.toFixed(2)).join(", ")}`);
    console.log(`attempted: ${last.attempted.toLocaleString()}`);
    console.log(`issued:    ${last.issued.toLocaleString()}`);
    if (last.skipped.length > 0) {
      console.log("skipped:");
      for (const s of last.skipped) console.log(`  ${s.count.toString().padStart(6)}  ${s.reason}`);
    }
  } finally {
    await api.close();
  }
}

await main();
