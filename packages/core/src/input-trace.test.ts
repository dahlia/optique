/**
 * Unit tests for InputTrace — immutable path-keyed trace store.
 *
 * Part of https://github.com/dahlia/optique/issues/752
 */
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { createInputTrace, type TraceEntry } from "./input-trace.ts";

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
});
