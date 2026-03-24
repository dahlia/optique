import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeControlChars,
  validateCommandNames,
  validateOptionNames,
  validateProgramName,
} from "./validate.ts";

describe("escapeControlChars", () => {
  it("should escape ASCII control characters", () => {
    assert.equal(escapeControlChars("a\nb"), "a\\nb");
    assert.equal(escapeControlChars("a\rb"), "a\\rb");
    assert.equal(escapeControlChars("a\tb"), "a\\tb");
    assert.equal(escapeControlChars("a\x00b"), "a\\x00b");
    assert.equal(escapeControlChars("a\x1fb"), "a\\x1fb");
    assert.equal(escapeControlChars("a\x7fb"), "a\\x7fb");
  });

  it("should escape C1 control characters", () => {
    assert.equal(escapeControlChars("a\x80b"), "a\\x80b");
    assert.equal(escapeControlChars("a\x85b"), "a\\x85b");
    assert.equal(escapeControlChars("a\x9bb"), "a\\x9bb");
    assert.equal(escapeControlChars("a\x9cb"), "a\\x9cb");
    assert.equal(escapeControlChars("a\x9fb"), "a\\x9fb");
  });

  it("should escape Unicode line separators", () => {
    assert.equal(escapeControlChars("a\u2028b"), "a\\u2028b");
    assert.equal(escapeControlChars("a\u2029b"), "a\\u2029b");
  });

  it("should leave printable characters unchanged", () => {
    assert.equal(escapeControlChars("hello world"), "hello world");
    assert.equal(escapeControlChars("café"), "café");
  });
});

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

  it("should throw TypeError for C1 control characters", () => {
    assert.throws(
      () => validateProgramName("bad\x80name"),
      TypeError,
    );
    assert.throws(
      () => validateProgramName("bad\x85name"),
      TypeError,
    );
    assert.throws(
      () => validateProgramName("bad\x9bname"),
      TypeError,
    );
    assert.throws(
      () => validateProgramName("bad\x9cname"),
      TypeError,
    );
    assert.throws(
      () => validateProgramName("bad\x9fname"),
      TypeError,
    );
  });

  it("should throw TypeError for Unicode line separators", () => {
    assert.throws(
      () => validateProgramName("bad\u2028name"),
      TypeError,
    );
    assert.throws(
      () => validateProgramName("bad\u2029name"),
      TypeError,
    );
  });
});

describe("validateOptionNames", () => {
  it("should reject C0 control characters", () => {
    assert.throws(
      () => validateOptionNames(["--bad\nname"], "Option"),
      TypeError,
    );
    assert.throws(
      () => validateOptionNames(["--bad\rname"], "Option"),
      TypeError,
    );
    assert.throws(
      () => validateOptionNames(["--bad\x00name"], "Option"),
      TypeError,
    );
  });

  it("should reject C1 control characters", () => {
    assert.throws(
      () => validateOptionNames(["--bad\x80name"], "Option"),
      TypeError,
    );
    assert.throws(
      () => validateOptionNames(["--bad\x9bname"], "Option"),
      TypeError,
    );
    assert.throws(
      () => validateOptionNames(["--bad\x9cname"], "Option"),
      TypeError,
    );
  });

  it("should reject Unicode line separators", () => {
    assert.throws(
      () => validateOptionNames(["--bad\u2028name"], "Option"),
      TypeError,
    );
    assert.throws(
      () => validateOptionNames(["--bad\u2029name"], "Option"),
      TypeError,
    );
  });
});

describe("validateCommandNames", () => {
  it("should reject C0 control characters", () => {
    assert.throws(
      () => validateCommandNames(["bad\nname"], "Command"),
      TypeError,
    );
    assert.throws(
      () => validateCommandNames(["bad\rname"], "Command"),
      TypeError,
    );
    assert.throws(
      () => validateCommandNames(["bad\x00name"], "Command"),
      TypeError,
    );
  });

  it("should reject C1 control characters", () => {
    assert.throws(
      () => validateCommandNames(["bad\x80name"], "Command"),
      TypeError,
    );
    assert.throws(
      () => validateCommandNames(["bad\x9bname"], "Command"),
      TypeError,
    );
    assert.throws(
      () => validateCommandNames(["bad\x9cname"], "Command"),
      TypeError,
    );
  });

  it("should reject Unicode line separators", () => {
    assert.throws(
      () => validateCommandNames(["bad\u2028name"], "Command"),
      TypeError,
    );
    assert.throws(
      () => validateCommandNames(["bad\u2029name"], "Command"),
      TypeError,
    );
  });
});
