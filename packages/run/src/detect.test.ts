import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectColorSupport, detectTerminalWidth } from "./detect.ts";

describe("detectColorSupport()", () => {
  it("should enable colors if FORCE_COLOR is '1', '2', '3', 'true', or ''", () => {
    assert.ok(detectColorSupport({}, { FORCE_COLOR: "1" }));
    assert.ok(detectColorSupport({}, { FORCE_COLOR: "2" }));
    assert.ok(detectColorSupport({}, { FORCE_COLOR: "3" }));
    assert.ok(detectColorSupport({}, { FORCE_COLOR: "true" }));
    assert.ok(detectColorSupport({}, { FORCE_COLOR: "" }));
  });

  it("should disable colors if FORCE_COLOR is '0' or any unsupported value", () => {
    assert.ok(!detectColorSupport({ isTTY: true }, { FORCE_COLOR: "0" }));
    assert.ok(!detectColorSupport({ isTTY: true }, { FORCE_COLOR: "false" }));
    assert.ok(!detectColorSupport({ isTTY: true }, { FORCE_COLOR: "foo" }));
  });

  it("should disable colors if NO_COLOR is present", () => {
    assert.ok(!detectColorSupport({ isTTY: true }, { NO_COLOR: "" }));
    assert.ok(!detectColorSupport({ isTTY: true }, { NO_COLOR: "1" }));
  });

  it("should disable colors if NODE_DISABLE_COLORS is present", () => {
    assert.ok(
      !detectColorSupport({ isTTY: true }, { NODE_DISABLE_COLORS: "" }),
    );
  });

  it("should prioritize FORCE_COLOR over NO_COLOR and NODE_DISABLE_COLORS", () => {
    assert.ok(detectColorSupport({}, { FORCE_COLOR: "1", NO_COLOR: "1" }));
    assert.ok(
      detectColorSupport({}, { FORCE_COLOR: "1", NODE_DISABLE_COLORS: "1" }),
    );
  });

  it("should fallback to stdout.isTTY if no environment variables are set", () => {
    assert.ok(detectColorSupport({ isTTY: true }, {}));
    assert.ok(!detectColorSupport({ isTTY: false }, {}));
    assert.ok(!detectColorSupport({}, {}));
  });
});

describe("detectTerminalWidth()", () => {
  it("should use stdout.columns if it is a positive integer", () => {
    assert.equal(detectTerminalWidth({ columns: 80 }, {}), 80);
    assert.equal(detectTerminalWidth({ columns: 120 }, {}), 120);
  });

  it("should ignore stdout.columns if it is not a positive integer", () => {
    assert.equal(detectTerminalWidth({ columns: 0 }, {}), undefined);
    assert.equal(detectTerminalWidth({ columns: -10 }, {}), undefined);
    assert.equal(detectTerminalWidth({ columns: 80.5 }, {}), undefined);
  });

  it("should fallback to COLUMNS environment variable if stdout.columns is invalid or missing", () => {
    assert.equal(detectTerminalWidth({}, { COLUMNS: "100" }), 100);
    assert.equal(detectTerminalWidth({ columns: 0 }, { COLUMNS: "100" }), 100);
  });

  it("should allow whitespace around COLUMNS environment variable", () => {
    assert.equal(detectTerminalWidth({}, { COLUMNS: "  80  " }), 80);
  });

  it("should ignore COLUMNS if it is not a positive decimal integer", () => {
    assert.equal(detectTerminalWidth({}, { COLUMNS: "0" }), undefined);
    assert.equal(detectTerminalWidth({}, { COLUMNS: "-80" }), undefined);
    assert.equal(detectTerminalWidth({}, { COLUMNS: "80.5" }), undefined);
    assert.equal(detectTerminalWidth({}, { COLUMNS: "abc" }), undefined);
    assert.equal(detectTerminalWidth({}, { COLUMNS: "" }), undefined);
  });

  it("should return undefined if neither provides a valid width", () => {
    assert.equal(detectTerminalWidth({}, {}), undefined);
  });
});
