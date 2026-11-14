import * as assert from "node:assert/strict";
import { test } from "node:test";
import { createInputTrace, type TraceEntry } from "./input-trace.ts";

test("trace writes do not iterate over previous Map entries", () => {
  // Keep this global iterator probe synchronous and in its own test file.
  // It guards the original whole-Map copy, not every quadratic algorithm.
  const descriptor = Object.getOwnPropertyDescriptor(
    Map.prototype,
    Symbol.iterator,
  );
  assert.ok(descriptor);
  const iterator = Map.prototype[Symbol.iterator];
  let visited = 0;
  const entry: TraceEntry = {
    kind: "argument-value",
    rawInput: "value",
    consumed: ["value"],
  };
  let trace = createInputTrace();
  try {
    Object.defineProperty(Map.prototype, Symbol.iterator, {
      ...descriptor,
      value: function* (this: Map<unknown, unknown>) {
        for (const pair of iterator.call(this)) {
          visited++;
          yield pair;
        }
      },
    });
    const probe = new Map(new Map([["probe", entry]]));
    assert.strictEqual(probe.get("probe"), entry);
    assert.ok(visited > 0, "The iterator probe must observe Map copies.");
    visited = 0;
    for (let i = 0; i < 256; i++) trace = trace.set(["paths", i], entry);
    for (let i = 0; i < 256; i++) {
      assert.strictEqual(trace.get(["paths", i]), entry);
    }
  } finally {
    Object.defineProperty(Map.prototype, Symbol.iterator, descriptor);
  }
  assert.equal(visited, 0, "Trace writes must not copy previous Map entries.");
});
