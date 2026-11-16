/**
 * Input-trace scaling benchmark; timings are observations, not test thresholds.
 *
 * Run from the checkout with:
 *   mise exec -- deno run scripts/bench-input-trace.ts
 *   mise exec -- node --experimental-transform-types scripts/bench-input-trace.ts
 *   mise exec -- bun scripts/bench-input-trace.ts
 *
 * Use --store-only or --parse-only to select workloads. Compare the same script
 * on the baseline and candidate revisions, with no other benchmarks running.
 */
import * as assert from "node:assert/strict";
import process from "node:process";
import { object } from "../packages/core/src/constructs.ts";
import {
  createInputTrace,
  type TraceEntry,
} from "../packages/core/src/input-trace.ts";
import { multiple, optional } from "../packages/core/src/modifiers.ts";
import { parseSync } from "../packages/core/src/parser.ts";
import { argument, option } from "../packages/core/src/primitives.ts";
import { string } from "../packages/core/src/valueparser.ts";

function measure<T>(
  workload: string,
  count: number,
  run: () => T,
  verify: (result: T) => void,
): void {
  const batch = count <= 32 ? 100 : 1;
  for (let i = 0; i < batch; i++) verify(run());
  const samples: number[] = [];
  for (let sample = 0; sample < 5; sample++) {
    const results: T[] = new Array(batch);
    const start = performance.now();
    for (let i = 0; i < batch; i++) results[i] = run();
    samples.push((performance.now() - start) / batch);
    for (const result of results) verify(result);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({ workload, count, batch, medianMs: samples[2], samples }),
  );
}

console.log(JSON.stringify({ versions: process.versions }));

if (!process.argv.includes("--parse-only")) {
  for (const deep of [false, true]) {
    for (const count of [8, 32, 500, 1000, 2000, 4000, 8000]) {
      const prefix = deep
        ? ["root", "command", "merge", "config", "paths"]
        : ["paths"];
      const paths = Array.from({ length: count }, (_, i) => [...prefix, i]);
      const missing = [...prefix, -1];
      const entries: readonly TraceEntry[] = paths.map((_, i) => ({
        kind: "argument-value",
        rawInput: `p${i}`,
        consumed: [`p${i}`],
      }));
      const suffix = deep ? "deep" : "shallow";
      const write = () => {
        let trace = createInputTrace();
        for (let i = 0; i < count; i++) trace = trace.set(paths[i], entries[i]);
        return trace;
      };
      const verify = (trace: ReturnType<typeof createInputTrace>) => {
        for (let i = 0; i < count; i++) {
          assert.strictEqual(trace.get(paths[i]), entries[i]);
        }
      };
      measure(`write-${suffix}`, count, write, verify);
      const base = write();
      measure(
        `read-${suffix}`,
        count,
        () => paths.map((path) => base.get(path)),
        (values) => assert.deepStrictEqual(values, entries),
      );
      measure(
        `read-miss-${suffix}`,
        count,
        () => paths.map(() => base.get(missing)),
        (values) => assert.ok(values.every((value) => value === undefined)),
      );
      const replacement: TraceEntry = {
        kind: "custom",
        rawInput: "new",
        consumed: ["new"],
      };
      measure(`overwrite-${suffix}`, count, () => {
        let trace = base;
        for (const path of paths) trace = trace.set(path, replacement);
        return trace;
      }, (trace) => {
        for (const path of paths) {
          assert.strictEqual(trace.get(path), replacement);
        }
        verify(base);
      });
      measure(`delete-${suffix}`, count, () => {
        let trace = base;
        for (const path of paths) trace = trace.delete(path);
        return trace;
      }, (trace) => {
        for (const path of paths) assert.equal(trace.get(path), undefined);
        verify(base);
      });
      measure(
        `delete-miss-${suffix}`,
        count,
        () => base.delete(missing),
        verify,
      );
      // Every fork remains alive until verification; the base must stay intact.
      const forks = paths.slice(0, 32);
      measure(
        `fork-${suffix}`,
        count,
        () => forks.map((path) => base.set(path, replacement)),
        (traces) => {
          for (let i = 0; i < traces.length; i++) {
            assert.strictEqual(traces[i].get(forks[i]), replacement);
            const other = (i + 1) % traces.length;
            assert.strictEqual(traces[i].get(forks[other]), entries[other]);
          }
          verify(base);
        },
      );
    }
  }
}

if (!process.argv.includes("--store-only")) {
  const parser = object({
    name: optional(option("--name", string())),
    paths: multiple(argument(string())),
  });
  for (const count of [1, 8, 32, 500, 1000, 2000, 4000, 8000]) {
    const paths = Array.from({ length: count }, (_, i) => `p${i.toString(36)}`);
    for (const separator of [false, true]) {
      const input = separator ? ["--", ...paths] : paths;
      measure(
        separator ? "parse-after-separator" : "parse",
        count,
        () => parseSync(parser, input),
        (result) => {
          assert.ok(result.success);
          if (result.success) {
            assert.deepStrictEqual(result.value, { name: undefined, paths });
          }
        },
      );
    }
  }
  const small = object({
    name: option("--name", string()),
    host: option("--host", string()),
    port: option("--port", string()),
    mode: option("--mode", string()),
  });
  const smallInput = [
    "--name",
    "demo",
    "--host",
    "localhost",
    "--port",
    "3000",
    "--mode",
    "dev",
  ];
  measure("four-options", 4, () => parseSync(small, smallInput), (result) => {
    assert.deepStrictEqual(result, {
      success: true,
      value: { name: "demo", host: "localhost", port: "3000", mode: "dev" },
    });
  });
  const repeated = multiple(option("--value", string()));
  for (const count of [8, 500, 2000]) {
    const values = Array.from({ length: count }, (_, i) => `v${i}`);
    const input = values.flatMap((value) => ["--value", value]);
    measure(
      "repeated-options",
      count,
      () => parseSync(repeated, input),
      (result) => {
        assert.deepStrictEqual(result, { success: true, value: values });
      },
    );
  }
}
