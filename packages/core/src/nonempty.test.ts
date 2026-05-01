import {
  ensureNonEmptyString,
  isNonEmptyString,
  type NonEmptyString,
} from "./nonempty.ts";
import * as fc from "fast-check";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const propertyParameters = { numRuns: 200 } as const;

describe("isNonEmptyString", () => {
  it("should return true for non-empty strings", () => {
    assert.equal(isNonEmptyString("a"), true);
    assert.equal(isNonEmptyString("hello"), true);
    assert.equal(isNonEmptyString(" "), true);
    assert.equal(isNonEmptyString("  "), true);
    assert.equal(isNonEmptyString("\n"), true);
    assert.equal(isNonEmptyString("\t"), true);
  });

  it("should return false for empty string", () => {
    assert.equal(isNonEmptyString(""), false);
  });

  it("should narrow type correctly", () => {
    const value: string = "test";
    if (isNonEmptyString(value)) {
      // Type should be narrowed to NonEmptyString
      const narrowed: NonEmptyString = value;
      assert.equal(narrowed, "test");
    } else {
      assert.fail("Should not reach here");
    }
  });

  it("should work in conditional expressions", () => {
    const values = ["hello", "", "world", ""];
    const nonEmpty = values.filter(isNonEmptyString);
    assert.deepEqual(nonEmpty, ["hello", "world"]);
  });

  it("should match string length for arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        assert.equal(isNonEmptyString(value), value.length > 0);
      }),
      propertyParameters,
    );
  });
});

describe("ensureNonEmptyString", () => {
  it("should not throw for non-empty strings", () => {
    assert.doesNotThrow(() => ensureNonEmptyString("a"));
    assert.doesNotThrow(() => ensureNonEmptyString("hello"));
    assert.doesNotThrow(() => ensureNonEmptyString(" "));
    assert.doesNotThrow(() => ensureNonEmptyString("\n"));
  });

  it("should throw TypeError for empty string", () => {
    assert.throws(
      () => ensureNonEmptyString(""),
      {
        name: "TypeError",
        message: "Expected a non-empty string.",
      },
    );
  });

  it("should narrow type after assertion", () => {
    const value: string = "test";
    ensureNonEmptyString(value);
    // Type should be narrowed to NonEmptyString after assertion
    const narrowed: NonEmptyString = value;
    assert.equal(narrowed, "test");
  });

  it("should accept exactly the same arbitrary strings as the type guard", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        if (isNonEmptyString(value)) {
          assert.doesNotThrow(() => ensureNonEmptyString(value));
        } else {
          assert.throws(
            () => ensureNonEmptyString(value),
            {
              name: "TypeError",
              message: "Expected a non-empty string.",
            },
          );
        }
      }),
      propertyParameters,
    );
  });
});
