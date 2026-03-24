import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateProgramName } from "./validate.ts";

describe("validateProgramName", () => {
  it("should accept valid program names", () => {
    validateProgramName("myapp");
    validateProgramName("my program");
    validateProgramName("my-app");
    validateProgramName("path/to/app");
    validateProgramName("C:\\Program Files\\app.exe");
  });

  it("should throw TypeError for non-string values", () => {
    assert.throws(
      () => validateProgramName(123 as never),
      TypeError,
    );
    assert.throws(
      () => validateProgramName({} as never),
      TypeError,
    );
    assert.throws(
      () => validateProgramName(null as never),
      TypeError,
    );
    assert.throws(
      () => validateProgramName(undefined as never),
      TypeError,
    );
    assert.throws(
      () => validateProgramName(Symbol("x") as never),
      TypeError,
    );
    assert.throws(
      () => validateProgramName(true as never),
      TypeError,
    );
  });

  it("should throw TypeError for empty string", () => {
    assert.throws(
      () => validateProgramName(""),
      TypeError,
    );
  });

  it("should throw TypeError for whitespace-only string", () => {
    assert.throws(
      () => validateProgramName("   "),
      TypeError,
    );
    assert.throws(
      () => validateProgramName("\t"),
      TypeError,
    );
  });

  it("should throw TypeError for strings with control characters", () => {
    assert.throws(
      () => validateProgramName("bad\nname"),
      TypeError,
    );
    assert.throws(
      () => validateProgramName("bad\rname"),
      TypeError,
    );
    assert.throws(
      () => validateProgramName("bad\x00name"),
      TypeError,
    );
    assert.throws(
      () => validateProgramName("bad\x1fname"),
      TypeError,
    );
    assert.throws(
      () => validateProgramName("bad\x7fname"),
      TypeError,
    );
  });
});
