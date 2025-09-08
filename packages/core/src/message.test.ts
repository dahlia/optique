import {
  envVar,
  formatMessage,
  type Message,
  message,
  metavar,
  optionName,
  optionNames,
  text,
  value,
  values,
} from "./message.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("message template function", () => {
  it("should create message with text only", () => {
    const msg = message`This is a simple message`;

    assert.ok(Array.isArray(msg));
    assert.deepEqual(
      msg,
      [
        { type: "text", text: "This is a simple message" },
      ] as const,
    );
  });

  it("should create message with interpolated strings", () => {
    const val = "testValue";
    const msg = message`Expected valid input, got ${val}`;

    assert.ok(Array.isArray(msg));
    assert.deepEqual(
      msg,
      [
        { type: "text", text: "Expected valid input, got " },
        { type: "value", value: "testValue" },
      ] as const,
    );
  });

  it("should create message with multiple interpolated values", () => {
    const min = "10";
    const max = "100";
    const actual = "150";
    const msg = message`Value ${actual} is not between ${min} and ${max}`;

    assert.ok(Array.isArray(msg));
    assert.deepEqual(
      msg,
      [
        { type: "text", text: "Value " },
        { type: "value", value: "150" },
        { type: "text", text: " is not between " },
        { type: "value", value: "10" },
        { type: "text", text: " and " },
        { type: "value", value: "100" },
      ] as const,
    );
  });

  it("should handle MessageTerm objects in interpolation", () => {
    const optName = optionName("--port");
    const msg = message`Option ${optName} is required`;

    assert.ok(Array.isArray(msg));
    assert.deepEqual(
      msg,
      [
        { type: "text", text: "Option " },
        { type: "optionName", optionName: "--port" },
        { type: "text", text: " is required" },
      ] as const,
    );
  });

  it("should handle nested Message arrays", () => {
    const innerMessage = message`invalid value`;
    const msg = message`Parsing failed: ${innerMessage}`;

    assert.ok(Array.isArray(msg));
    assert.deepEqual(
      msg,
      [
        { type: "text", text: "Parsing failed: " },
        { type: "text", text: "invalid value" },
      ] as const,
    );
  });

  it("should create message with text ending (dot case)", () => {
    const expected = "42";
    const actual = "invalid";
    const msg = message`Expected ${expected}, got ${actual}.`;

    assert.ok(Array.isArray(msg));
    assert.deepEqual(
      msg,
      [
        { type: "text", text: "Expected " },
        { type: "value", value: expected },
        { type: "text", text: ", got " },
        { type: "value", value: actual },
        { type: "text", text: "." },
      ] as const,
    );
  });

  it("should create message with range format", () => {
    const min = "1";
    const max = "100";
    const value = "150";
    const msg = message`Value ${value} is out of range [${min}, ${max}]`;

    assert.ok(Array.isArray(msg));
    assert.deepEqual(
      msg,
      [
        { type: "text", text: "Value " },
        { type: "value", value: "150" },
        { type: "text", text: " is out of range [" },
        { type: "value", value: "1" },
        { type: "text", text: ", " },
        { type: "value", value: "100" },
        { type: "text", text: "]" },
      ] as const,
    );
  });
});

describe("message term constructors", () => {
  it("should create text term", () => {
    const term = text("Hello world");
    assert.equal(term.type, "text");
    assert.equal(term.text, "Hello world");
  });

  it("should create option name term", () => {
    const term = optionName("--verbose");
    assert.equal(term.type, "optionName");
    assert.equal(term.optionName, "--verbose");
  });

  it("should create option names term", () => {
    const term = optionNames(["--help", "-h"]);
    assert.equal(term.type, "optionNames");
    assert.deepEqual(term.optionNames, ["--help", "-h"]);
  });

  it("should create metavar term", () => {
    const term = metavar("FILE");
    assert.equal(term.type, "metavar");
    assert.equal(term.metavar, "FILE");
  });

  it("should create value term", () => {
    const term = value("42");
    assert.equal(term.type, "value");
    assert.equal(term.value, "42");
  });

  it("should create values term", () => {
    const term = values(["foo", "bar", "baz"]);
    assert.equal(term.type, "values");
    assert.deepEqual(term.values, ["foo", "bar", "baz"]);
  });

  it("should create envVar term", () => {
    const term = envVar("API_URL");
    assert.equal(term.type, "envVar");
    assert.equal(term.envVar, "API_URL");
  });
});

describe("formatMessage", () => {
  it("should format simple text message", () => {
    const msg: Message = [{ type: "text", text: "Simple message" }];
    const formatted = formatMessage(msg);
    assert.equal(formatted, "Simple message");
  });

  it("should format option name without colors", () => {
    const msg: Message = [
      { type: "text", text: "Unknown option " },
      { type: "optionName", optionName: "--invalid" },
    ];
    const formatted = formatMessage(msg, {
      colors: false,
      quotes: true,
    });
    assert.equal(formatted, "Unknown option `--invalid`");
  });

  it("should format option name with colors", () => {
    const msg: Message = [
      { type: "text", text: "Unknown option " },
      { type: "optionName", optionName: "--invalid" },
    ];
    const formatted = formatMessage(msg, { colors: true, quotes: true });
    assert.equal(formatted, "Unknown option \x1b[3m`--invalid`\x1b[0m");
  });

  it("should format option names without quotes", () => {
    const msg: Message = [
      { type: "text", text: "Use one of " },
      { type: "optionNames", optionNames: ["--help", "--version"] },
    ];
    const formatted = formatMessage(msg, { quotes: false });
    assert.equal(formatted, "Use one of --help/--version");
  });

  it("should format option names with quotes", () => {
    const msg: Message = [
      { type: "text", text: "Use one of " },
      { type: "optionNames", optionNames: ["--help", "--version"] },
    ];
    const formatted = formatMessage(msg, { quotes: true });
    assert.equal(formatted, "Use one of `--help`/`--version`");
  });

  it("should format metavar without colors", () => {
    const msg: Message = [
      { type: "text", text: "Expected " },
      { type: "metavar", metavar: "FILE" },
    ];
    const formatted = formatMessage(msg, {
      colors: false,
      quotes: true,
    });
    assert.equal(formatted, "Expected `FILE`");
  });

  it("should format metavar with colors", () => {
    const msg: Message = [
      { type: "text", text: "Expected " },
      { type: "metavar", metavar: "FILE" },
    ];
    const formatted = formatMessage(msg, { colors: true, quotes: true });
    assert.equal(formatted, "Expected \x1b[1m`FILE`\x1b[0m");
  });

  it("should format envVar without colors", () => {
    const msg: Message = [
      { type: "text", text: "Environment variable " },
      { type: "envVar", envVar: "API_URL" },
      { type: "text", text: " is not set" },
    ];
    const formatted = formatMessage(msg, {
      colors: false,
      quotes: true,
    });
    assert.equal(formatted, "Environment variable `API_URL` is not set");
  });

  it("should format envVar with colors", () => {
    const msg: Message = [
      { type: "text", text: "Environment variable " },
      { type: "envVar", envVar: "API_URL" },
      { type: "text", text: " is not set" },
    ];
    const formatted = formatMessage(msg, { colors: true, quotes: true });
    assert.equal(
      formatted,
      "Environment variable \x1b[1;4m`API_URL`\x1b[0m is not set",
    );
  });

  it("should format single value without colors", () => {
    const msg: Message = [
      { type: "text", text: "Invalid value " },
      { type: "value", value: "invalid" },
    ];
    const formatted = formatMessage(msg, {
      colors: false,
      quotes: true,
    });
    assert.equal(formatted, 'Invalid value "invalid"');
  });

  it("should format single value with colors", () => {
    const msg: Message = [
      { type: "text", text: "Invalid value " },
      { type: "value", value: "invalid" },
    ];
    const formatted = formatMessage(msg, { colors: true, quotes: true });
    assert.equal(formatted, 'Invalid value \x1b[32m"invalid"\x1b[0m');
  });

  it("should format multiple values", () => {
    const msg: Message = [
      { type: "text", text: "Expected one of " },
      { type: "values", values: ["red", "green", "blue"] },
    ];
    const formatted = formatMessage(msg, { quotes: true });
    assert.equal(formatted, 'Expected one of "red" "green" "blue"');
  });

  it("should format values without quotes", () => {
    const msg: Message = [
      { type: "text", text: "Got " },
      { type: "values", values: ["foo", "bar"] },
    ];
    const formatted = formatMessage(msg, { quotes: false });
    assert.equal(formatted, "Got foo bar");
  });

  it("should handle default options", () => {
    const msg: Message = [
      { type: "text", text: "Error: " },
      { type: "value", value: "test" },
    ];
    const formatted = formatMessage(msg);
    assert.equal(formatted, 'Error: "test"');
  });

  it("should handle complex mixed message", () => {
    const msg: Message = [
      { type: "text", text: "Option " },
      { type: "optionName", optionName: "--port" },
      { type: "text", text: " expects " },
      { type: "metavar", metavar: "NUMBER" },
      { type: "text", text: ", got " },
      { type: "value", value: "invalid" },
    ];
    const formatted = formatMessage(msg, { quotes: true });
    assert.equal(formatted, 'Option `--port` expects `NUMBER`, got "invalid"');
  });

  it("should wrap message at maxWidth", () => {
    const msg: Message = [
      {
        type: "text",
        text: "This is a very long message that should be wrapped ",
      },
      { type: "optionName", optionName: "--port" },
      { type: "text", text: " expects " },
      { type: "metavar", metavar: "NUMBER" },
    ];
    const formatted = formatMessage(msg, { maxWidth: 30 });
    assert.ok(formatted.includes("\n"));
    const lines = formatted.split("\n");
    assert.ok(lines.length > 1);
    // The wrapping logic wraps when the next segment would exceed maxWidth
    // So lines may be longer than maxWidth if a single segment is long
    const nonEmptyLines = lines.filter((line) => line.length > 0);
    assert.ok(nonEmptyLines.length >= 2);
  });

  it("should not wrap when maxWidth is not set", () => {
    const msg: Message = [
      {
        type: "text",
        text:
          "This is a very long message that should not be wrapped without maxWidth option ",
      },
      { type: "optionName", optionName: "--port" },
    ];
    const formatted = formatMessage(msg);
    assert.ok(!formatted.includes("\n"));
  });

  it("should wrap at word boundaries with maxWidth", () => {
    const msg: Message = [
      { type: "text", text: "Short text " },
      { type: "value", value: "very-long-value-that-exceeds-width" },
      { type: "text", text: " more text" },
    ];
    const formatted = formatMessage(msg, { maxWidth: 20 });
    assert.ok(formatted.includes("\n"));
  });

  it("should handle maxWidth with colors enabled", () => {
    const msg: Message = [
      { type: "text", text: "Error with " },
      { type: "optionName", optionName: "--verbose-option" },
      { type: "text", text: " parameter value " },
      { type: "value", value: "test" },
    ];
    const formatted = formatMessage(msg, { maxWidth: 25, colors: true });
    assert.ok(formatted.includes("\n"));
    // Should still wrap based on visual width, not ANSI code length
    const lines = formatted.split("\n");
    assert.ok(lines.length > 1);
  });

  it("should handle maxWidth of zero", () => {
    const msg: Message = [
      { type: "text", text: "Test" },
      { type: "value", value: "value" },
    ];
    const formatted = formatMessage(msg, { maxWidth: 0 });
    // Should still produce output but might wrap aggressively
    assert.ok(typeof formatted === "string");
    assert.ok(formatted.length > 0);
  });

  it("should handle single character maxWidth", () => {
    const msg: Message = [
      { type: "text", text: "A" },
      { type: "text", text: "B" },
      { type: "text", text: "C" },
    ];
    const formatted = formatMessage(msg, { maxWidth: 1 });
    assert.ok(formatted.includes("\n"));
    const lines = formatted.split("\n");
    assert.ok(lines.length >= 2);
  });
});

describe("integration tests", () => {
  it("should create and format complete message", () => {
    const option = "--timeout";
    const expected = "NUMBER";
    const actual = "not-a-number";

    const msg = message`Option ${optionName(option)} expects ${
      metavar(expected)
    }, got ${actual}`;
    const formatted = formatMessage(msg, { quotes: true });

    assert.equal(
      formatted,
      'Option `--timeout` expects `NUMBER`, got "not-a-number"',
    );
  });

  it("should handle constraint violation message", () => {
    const min = "10";
    const max = "100";
    const actual = "150";

    const msg = message`Value must be between ${min} and ${max}, got ${actual}`;
    const formatted = formatMessage(msg);

    assert.equal(formatted, 'Value must be between "10" and "100", got "150"');
  });

  it("should format choice error message", () => {
    const choices = ["red", "green", "blue"];
    const invalid = "purple";

    const msg = message`Expected one of ${values(choices)}, got ${invalid}`;
    const formatted = formatMessage(msg, { quotes: true });

    assert.equal(
      formatted,
      'Expected one of "red" "green" "blue", got "purple"',
    );
  });
});
