/**
 * Unit tests for InputTrace — immutable path-keyed trace store.
 *
 * Part of https://github.com/dahlia/optique/issues/752
 */
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import {
  createInputTrace,
  type InputTrace,
  inspectInputTrace,
  type TraceEntry,
} from "./input-trace.ts";

// =============================================================================
// Helpers
// =============================================================================

function makeEntry(
  kind: TraceEntry["kind"],
  rawInput: string,
): TraceEntry {
  return { kind, rawInput, consumed: [rawInput] };
}

// =============================================================================
// Tests
// =============================================================================

describe("InputTrace", () => {
  test("empty trace returns undefined for any path", () => {
    const trace = createInputTrace();
    assert.equal(trace.get([]), undefined);
    assert.equal(trace.get(["a"]), undefined);
    assert.equal(trace.get(["a", "b"]), undefined);
  });

  test("set and get roundtrip for option-value entry", () => {
    const entry = makeEntry("option-value", "--env=prod");
    const trace = createInputTrace().set(["env"], entry);
    assert.deepStrictEqual(trace.get(["env"]), entry);
  });

  test("set and get roundtrip for argument-value entry", () => {
    const entry = makeEntry("argument-value", "myfile.txt");
    const trace = createInputTrace().set(["file"], entry);
    assert.deepStrictEqual(trace.get(["file"]), entry);
  });

  test("set and get roundtrip for literal entry", () => {
    const entry = makeEntry("literal", "serve");
    const trace = createInputTrace().set(["command"], entry);
    assert.deepStrictEqual(trace.get(["command"]), entry);
  });

  test("set and get roundtrip for custom entry", () => {
    const entry = makeEntry("custom", "whatever");
    const trace = createInputTrace().set(["x"], entry);
    assert.deepStrictEqual(trace.get(["x"]), entry);
  });

  test("entry with all optional fields", () => {
    const entry: TraceEntry = {
      kind: "option-value",
      rawInput: "prod",
      consumed: ["--env", "prod"],
      preliminaryResult: { success: true, value: "prod" },
      optionNames: ["--env", "-e"],
      metavar: "ENV",
    };
    const trace = createInputTrace().set(["env"], entry);
    assert.deepStrictEqual(trace.get(["env"]), entry);
  });

  test("immutability: set returns new instance", () => {
    const original = createInputTrace();
    const entry = makeEntry("option-value", "prod");
    const updated = original.set(["env"], entry);
    assert.notStrictEqual(original, updated);
    assert.equal(original.get(["env"]), undefined);
    assert.deepStrictEqual(updated.get(["env"]), entry);
  });

  test("multiple entries at different paths", () => {
    const entry1 = makeEntry("option-value", "prod");
    const entry2 = makeEntry("option-value", "us-east-1");
    const trace = createInputTrace()
      .set(["env"], entry1)
      .set(["region"], entry2);
    assert.deepStrictEqual(trace.get(["env"]), entry1);
    assert.deepStrictEqual(trace.get(["region"]), entry2);
  });

  test("nested paths", () => {
    const entry = makeEntry("option-value", "prod");
    const trace = createInputTrace().set(["config", "env"], entry);
    assert.deepStrictEqual(trace.get(["config", "env"]), entry);
    assert.equal(trace.get(["config"]), undefined);
    assert.equal(trace.get(["env"]), undefined);
  });

  test("overwrite existing entry", () => {
    const entry1 = makeEntry("option-value", "dev");
    const entry2 = makeEntry("option-value", "prod");
    const trace = createInputTrace()
      .set(["env"], entry1)
      .set(["env"], entry2);
    assert.deepStrictEqual(trace.get(["env"]), entry2);
  });

  test("delete removes entry", () => {
    const entry = makeEntry("option-value", "prod");
    const trace = createInputTrace().set(["env"], entry);
    const deleted = trace.delete(["env"]);
    assert.equal(deleted.get(["env"]), undefined);
  });

  test("delete returns new instance", () => {
    const entry = makeEntry("option-value", "prod");
    const trace = createInputTrace().set(["env"], entry);
    const deleted = trace.delete(["env"]);
    assert.notStrictEqual(trace, deleted);
    assert.deepStrictEqual(trace.get(["env"]), entry);
  });

  test("delete non-existent path returns new instance", () => {
    const trace = createInputTrace();
    const deleted = trace.delete(["nonexistent"]);
    assert.notStrictEqual(trace, deleted);
  });

  test("numeric path keys", () => {
    const entry = makeEntry("argument-value", "first");
    const trace = createInputTrace().set([0], entry);
    assert.deepStrictEqual(trace.get([0]), entry);
    assert.equal(trace.get(["0"]), undefined);
  });

  test("symbol path keys", () => {
    const sym = Symbol("test");
    const entry = makeEntry("option-value", "val");
    const trace = createInputTrace().set([sym], entry);
    assert.deepStrictEqual(trace.get([sym]), entry);
  });

  test("mixed path key types", () => {
    const sym = Symbol("nested");
    const entry = makeEntry("option-value", "val");
    const trace = createInputTrace().set(["a", 0, sym], entry);
    assert.deepStrictEqual(trace.get(["a", 0, sym]), entry);
  });

  test("empty path", () => {
    const entry = makeEntry("literal", "root");
    const trace = createInputTrace().set([], entry);
    assert.deepStrictEqual(trace.get([]), entry);
  });

  test("registered symbol path keys (Symbol.for)", () => {
    const sym = Symbol.for("optique.test.registered");
    const entry = makeEntry("option-value", "val");
    const trace = createInputTrace().set([sym], entry);
    assert.deepStrictEqual(trace.get([sym]), entry);
  });

  test("registered and non-registered symbols do not collide", () => {
    const reg = Symbol.for("optique.test.name");
    const local = Symbol("optique.test.name");
    const entry1 = makeEntry("option-value", "reg");
    const entry2 = makeEntry("option-value", "local");
    const trace = createInputTrace()
      .set([reg], entry1)
      .set([local], entry2);
    assert.deepStrictEqual(trace.get([reg]), entry1);
    assert.deepStrictEqual(trace.get([local]), entry2);
  });

  test("keys containing NUL do not collide with multi-segment paths", () => {
    const entry1 = makeEntry("option-value", "single");
    const entry2 = makeEntry("option-value", "multi");
    // A single segment with embedded NUL + type prefix must not alias
    // a two-segment path that would match if using naive NUL-joining.
    const trace = createInputTrace()
      .set(["a\0sb"], entry1)
      .set(["a", "b"], entry2);
    assert.deepStrictEqual(trace.get(["a\0sb"]), entry1);
    assert.deepStrictEqual(trace.get(["a", "b"]), entry2);
  });
});

describe("persistent trace snapshots", () => {
  function check(trace: InputTrace, expected: ReadonlyMap<number, TraceEntry>) {
    const { size, height } = inspectInputTrace(trace);
    assert.equal(size, expected.size);
    assert.ok(height <= Math.ceil(1.45 * Math.log2(size + 2)));
    for (let i = 0; i < 128; i++) {
      assert.strictEqual(trace.get(["paths", i]), expected.get(i));
    }
  }

  test("rotations and deletions preserve every historical version", () => {
    const orders = [
      [1],
      [2, 1],
      [1, 2],
      [3, 2, 1], // Left-left.
      [1, 2, 3], // Right-right.
      [3, 1, 2], // Left-right.
      [1, 3, 2], // Right-left.
      [4, 2, 5, 1, 3], // Delete 5: sibling balance is zero.
      [2, 1, 4, 3, 5], // Delete 1: mirrored zero-balance case.
      [8, 4, 12, 2, 6, 10, 14, 9, 11], // Deeper successor.
      [8, 4, 14, 2, 6, 10, 16, 11], // Successor has a right child.
      [8, 4, 12, 2, 6, 10, 14, 9, 11, 13, 15],
      Array.from({ length: 128 }, (_, i) => i),
      Array.from({ length: 128 }, (_, i) => 127 - i),
      Array.from({ length: 128 }, (_, i) => i % 2 ? 127 - (i >> 1) : i >> 1),
    ];
    for (const order of orders) {
      for (
        const deletion of [
          order,
          order.toReversed(),
          order.toSorted((a, b) => a - b),
          order.toSorted((a, b) => b - a),
        ]
      ) {
        let trace = createInputTrace();
        const expected = new Map<number, TraceEntry>();
        const versions: [InputTrace, ReadonlyMap<number, TraceEntry>][] = [];
        for (const i of order) {
          const entry = makeEntry("argument-value", String(i));
          trace = trace.set(["paths", i], entry);
          expected.set(i, entry);
          check(trace, expected);
          versions.push([trace, new Map(expected)]);
        }
        const unchanged = trace.delete(["missing"]);
        assert.notStrictEqual(unchanged, trace);
        check(unchanged, expected);
        for (const i of deletion) {
          trace = trace.delete(["paths", i]);
          expected.delete(i);
          check(trace, expected);
        }
        assert.deepEqual(inspectInputTrace(trace), { size: 0, height: 0 });
        for (const [snapshot, values] of versions) check(snapshot, values);
      }
    }
  });

  test("seeded operations can fork any retained version", () => {
    let seed = 0x1122;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const local = Symbol("same");
    const paths: readonly (readonly PropertyKey[])[] = [
      [],
      [""],
      ["a"],
      ["a", "b"],
      ["a\0sb"],
      [0],
      ["0"],
      ["é"],
      ["e\u0301"],
      ["日本語", "한글"],
      ["__proto__"],
      [local],
      [Symbol("same")],
      [Symbol.for("same")],
      [Infinity],
      [-Infinity],
      [NaN],
      ["3:sx", "\0:"],
      ...Array.from({ length: 96 }, (_, i) => ["paths", i]),
    ];
    const versions: [InputTrace, ReadonlyMap<number, TraceEntry>][] = [
      [createInputTrace(), new Map()],
    ];
    for (let step = 0; step < 1500; step++) {
      // High bits avoid correlations between the LCG's low bits and operations.
      const [base, prior] = versions[(random() >>> 8) % versions.length];
      const index = (random() >>> 8) % paths.length;
      const expected = new Map(prior);
      const entry = makeEntry("custom", `value-${step}`);
      const remove = (random() >>> 8) % 3 === 0;
      const next = remove
        ? base.delete(paths[index])
        : base.set(paths[index], entry);
      if (remove) expected.delete(index);
      else expected.set(index, entry);
      assert.notStrictEqual(next, base);
      assert.equal(inspectInputTrace(next).size, expected.size);
      for (let i = 0; i < paths.length; i++) {
        assert.strictEqual(next.get(paths[i]), expected.get(i));
        assert.strictEqual(base.get(paths[i]), prior.get(i));
      }
      versions.push([next, expected]);
    }
    for (const [snapshot, values] of versions) {
      assert.equal(inspectInputTrace(snapshot).size, values.size);
      for (let i = 0; i < paths.length; i++) {
        assert.strictEqual(snapshot.get(paths[i]), values.get(i));
      }
    }
  });

  test("caller path mutation and same-entry updates preserve identity", () => {
    const path: PropertyKey[] = ["parent"];
    const entry = makeEntry("custom", "parent");
    const parent = createInputTrace().set(path, entry);
    path.push("child");
    const childEntry = makeEntry("custom", "child");
    const child = parent.set(path, childEntry);
    const same = child.set(path, childEntry);
    assert.notStrictEqual(same, child);
    assert.strictEqual(same.get(path), childEntry);
    assert.strictEqual(parent.get(["parent"]), entry);
    assert.equal(parent.get(path), undefined);
    const removed = child.delete(["parent"]);
    assert.equal(removed.get(["parent"]), undefined);
    assert.strictEqual(removed.get(path), childEntry);
    assert.strictEqual(child.get(["parent"]), entry);
    assert.equal(inspectInputTrace(removed).size, 1);
  });
});
