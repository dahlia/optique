/**
 * Measures parser array-copy costs without timing assertions.
 *
 * Run with mise exec -- deno run scripts/bench-parser-arrays.ts (or node/bun).
 * Use --counts=1,8,32 or --workloads=positional,mixed to narrow a run.
 * Compare identical scripts in serialized baseline/candidate/control processes.
 * Earlier states are retained only in the bounded direct-copy batches.
 */
import assert from "node:assert/strict";
import process from "node:process";
import { object } from "../packages/core/src/constructs.ts";
import { multiple, optional } from "../packages/core/src/modifiers.ts";
import {
  type Mode,
  parseAsync,
  type Parser,
  type ParserContext,
  parseSync,
} from "../packages/core/src/parser.ts";
import { argument, option } from "../packages/core/src/primitives.ts";
import { string, type ValueParser } from "../packages/core/src/valueparser.ts";

const counts = (process.argv.find((a) => a.startsWith("--counts="))
  ?.slice("--counts=".length) ?? "1,8,32,500,2000,8000,16000,32000")
  .split(",").map(Number);
assert.ok(counts.every((n) => Number.isSafeInteger(n) && n > 0));
const workloads = process.argv.find((a) => a.startsWith("--workloads="))
  ?.slice("--workloads=".length).split(",");
const enabled = (name: string) => workloads == null || workloads.includes(name);

function report(
  workload: string,
  mode: Mode,
  count: number,
  samples: number[],
) {
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(JSON.stringify({
    workload,
    mode,
    count,
    medianMs: sorted[2],
    samples,
  }));
}

function measureSync<T>(
  workload: string,
  count: number,
  run: () => T,
  verify: (result: T) => void,
  direct = false,
) {
  const batch = count <= 32 ? 1000 : direct ? 32 : 1;
  for (let i = 0; i < batch; i++) verify(run());
  const samples: number[] = [];
  for (let sample = 0; sample < 5; sample++) {
    const results: T[] = new Array(batch);
    const start = performance.now();
    for (let i = 0; i < batch; i++) results[i] = run();
    samples.push((performance.now() - start) / batch);
    for (const result of results) verify(result);
  }
  report(workload, "sync", count, samples);
}

async function measureAsync<T>(
  workload: string,
  count: number,
  run: () => Promise<T>,
  verify: (result: T) => void,
  direct = false,
) {
  const batch = count <= 32 ? 1000 : direct ? 32 : 1;
  for (let i = 0; i < batch; i++) verify(await run());
  const samples: number[] = [];
  for (let sample = 0; sample < 5; sample++) {
    const results: T[] = new Array(batch);
    const start = performance.now();
    for (let i = 0; i < batch; i++) results[i] = await run();
    samples.push((performance.now() - start) / batch);
    for (const result of results) verify(result);
  }
  report(workload, "async", count, samples);
}

const syncString = string();
const asyncString: ValueParser<"async", string> = {
  ...syncString,
  mode: "async",
  parse: (input) => Promise.resolve(syncString.parse(input)),
  async *suggest() {},
};
const annotation = Symbol("benchmark");
console.log(
  JSON.stringify({ versions: process.versions, source: import.meta.url }),
);

for (const count of counts) {
  const paths = Array.from({ length: count }, (_, i) => `p${i}`);
  for (const workload of ["positional", "annotated", "mixed"]) {
    if (!enabled(workload)) continue;
    const mixed = workload === "mixed";
    const input = mixed
      ? paths.flatMap((path) => ["--name", path, path])
      : paths;
    const options = workload === "annotated"
      ? { annotations: { [annotation]: "present" } }
      : undefined;
    const sync = mixed
      ? object({
        names: multiple(option("--name", syncString)),
        paths: multiple(argument(syncString)),
      })
      : object({
        name: optional(option("--name", syncString)),
        paths: multiple(argument(syncString)),
      });
    const async = mixed
      ? object({
        names: multiple(option("--name", asyncString)),
        paths: multiple(argument(asyncString)),
      })
      : object({
        name: optional(option("--name", asyncString)),
        paths: multiple(argument(asyncString)),
      });
    const expected = mixed
      ? { names: paths, paths }
      : { name: undefined, paths };
    const verify = (
      result: { readonly success: boolean; readonly value?: unknown },
    ) => {
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, expected);
    };
    measureSync(
      workload,
      count,
      () => parseSync<unknown>(sync, input, options),
      verify,
    );
    await measureAsync(
      workload,
      count,
      () => parseAsync<unknown>(async, input, options),
      verify,
    );
    assert.deepStrictEqual(
      input,
      mixed ? paths.flatMap((p) => ["--name", p, p]) : paths,
    );
  }

  for (const replacement of [false, true]) {
    const workload = replacement ? "direct-replace" : "direct-append";
    if (!enabled(workload)) continue;
    type State = { readonly step: number; readonly success?: true };
    const child: Parser<"sync", number, State> = {
      mode: "sync",
      priority: 0,
      leadingNames: new Set<string>(),
      acceptingAnyToken: true,
      *suggest() {},
      getDocFragments: () => ({ fragments: [] }),
      usage: [],
      initialState: { step: 0 },
      $valueType: [],
      $stateType: [],
      parse: (context) => ({
        success: true,
        consumed: ["x"],
        next: {
          ...context,
          buffer: [],
          state: replacement
            ? { step: context.state.step + 1 }
            : { step: 1, success: true },
        },
      }),
      complete: (state) => ({ success: true, value: state.step }),
    };
    const asyncChild: Parser<"async", number, State> = {
      ...child,
      validateValue: undefined,
      mode: "async",
      async *suggest() {},
      parse: (context) => Promise.resolve(child.parse(context)),
      complete: (state) => Promise.resolve(child.complete(state)),
    };
    const sync = multiple(child);
    const async = multiple(asyncChild);
    const state: readonly State[] = Array.from(
      { length: count },
      () => replacement ? { step: 1 } : { step: 1, success: true },
    );
    const context: ParserContext<readonly State[]> = {
      state,
      buffer: ["x"],
      optionsTerminated: false,
      usage: [],
    };
    const verify = (result: Awaited<ReturnType<typeof sync.parse>>) => {
      assert.ok(result.success);
      if (!result.success) return;
      assert.notStrictEqual(result.next.state, state);
      assert.equal(result.next.state.length, count + (replacement ? 0 : 1));
      for (let i = 0; i < count - (replacement ? 1 : 0); i++) {
        assert.strictEqual(result.next.state[i], state[i]);
      }
      assert.equal(result.next.state.at(-1)?.step, replacement ? 2 : 1);
      assert.equal(state.length, count);
      assert.equal(state.at(-1)?.step, 1);
      assert.deepStrictEqual(context.buffer, ["x"]);
    };
    measureSync(workload, count, () => sync.parse(context), verify, true);
    await measureAsync(
      workload,
      count,
      () => async.parse(context),
      verify,
      true,
    );
  }
}
