import {
  type ErrorMessage,
  formatErrorMessage,
  message,
  metavar,
  optionName,
  optionNames,
  text,
  value,
  values,
} from "./error.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("message template function", () => {
  it("should create error message with text only", () => {
    const error = message`This is a simple error`;

    assert.ok(Array.isArray(error));
    assert.equal(error.length, 1);
    assert.equal(error[0].type, "text");
    assert.equal(error[0].text, "This is a simple error");
  });

  it("should create error message with interpolated strings", () => {
    const val = "testValue";
    const error = message`Expected valid input, got ${val}`;

    assert.ok(Array.isArray(error));
    assert.equal(error.length, 2);
    assert.equal(error[0].type, "text");
    assert.equal(error[0].text, "Expected valid input, got ");
    assert.equal(error[1].type, "value");
    assert.equal(error[1].value, "testValue");
  });

  it("should create error message with multiple interpolated values", () => {
    const min = "10";
    const max = "100";
    const actual = "150";
    const error = message`Value ${actual} is not between ${min} and ${max}`;

    assert.ok(Array.isArray(error));
    assert.equal(error.length, 6); // no trailing empty text
    assert.equal(error[0].type, "text");
    assert.equal(error[0].text, "Value ");
    assert.equal(error[1].type, "value");
    assert.equal(error[1].value, "150");
    assert.equal(error[2].type, "text");
    assert.equal(error[2].text, " is not between ");
    assert.equal(error[3].type, "value");
    assert.equal(error[3].value, "10");
    assert.equal(error[4].type, "text");
    assert.equal(error[4].text, " and ");
    assert.equal(error[5].type, "value");
    assert.equal(error[5].value, "100");
  });

  it("should handle ErrorMessageTerm objects in interpolation", () => {
    const optName = optionName("--port");
    const error = message`Option ${optName} is required`;

    assert.ok(Array.isArray(error));
    assert.equal(error.length, 3);
    assert.equal(error[0].type, "text");
    assert.equal(error[0].text, "Option ");
    assert.equal(error[1].type, "optionName");
    assert.equal(error[1].optionName, "--port");
    assert.equal(error[2].type, "text");
    assert.equal(error[2].text, " is required");
  });

  it("should handle nested ErrorMessage arrays", () => {
    const innerError = message`invalid value`;
    const error = message`Parsing failed: ${innerError}`;

    assert.ok(Array.isArray(error));
    assert.equal(error.length, 2);
    assert.equal(error[0].type, "text");
    assert.equal(error[0].text, "Parsing failed: ");
    assert.equal(error[1].type, "text");
    assert.equal(error[1].text, "invalid value");
  });

  it("should create error message with text ending (dot case)", () => {
    const expected = "42";
    const actual = "invalid";
    const error = message`Expected ${expected}, got ${actual}.`;

    assert.ok(Array.isArray(error));
    assert.equal(error.length, 5); // text, value, text, value, text
    assert.equal(error[0].type, "text");
    assert.equal(error[0].text, "Expected ");
    assert.equal(error[1].type, "value");
    assert.equal(error[1].value, expected);
    assert.equal(error[2].type, "text");
    assert.equal(error[2].text, ", got ");
    assert.equal(error[3].type, "value");
    assert.equal(error[3].value, actual);
    assert.equal(error[4].type, "text");
    assert.equal(error[4].text, ".");
  });

  it("should create error message with range format", () => {
    const min = "1";
    const max = "100";
    const value = "150";
    const error = message`Value ${value} is out of range [${min}, ${max}]`;

    assert.ok(Array.isArray(error));
    assert.equal(error.length, 7); // text, value, text, value, text, value, text
    const formatted = formatErrorMessage(error);
    assert.ok(formatted.includes("Value"));
    assert.ok(formatted.includes("150"));
    assert.ok(formatted.includes("out of range"));
    assert.ok(formatted.includes("1"));
    assert.ok(formatted.includes("100"));
  });
});

describe("error term constructors", () => {
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
});

describe("formatErrorMessage", () => {
  it("should format simple text message", () => {
    const error: ErrorMessage = [{ type: "text", text: "Simple error" }];
    const formatted = formatErrorMessage(error);
    assert.equal(formatted, "Simple error");
  });

  it("should format option name without colors", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Unknown option " },
      { type: "optionName", optionName: "--invalid" },
    ];
    const formatted = formatErrorMessage(error, {
      colors: false,
      quotes: true,
    });
    assert.equal(formatted, "Unknown option `--invalid`");
  });

  it("should format option name with colors", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Unknown option " },
      { type: "optionName", optionName: "--invalid" },
    ];
    const formatted = formatErrorMessage(error, { colors: true, quotes: true });
    assert.equal(formatted, "Unknown option \x1b[3m`--invalid`\x1b[0m");
  });

  it("should format option names without quotes", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Use one of " },
      { type: "optionNames", optionNames: ["--help", "--version"] },
    ];
    const formatted = formatErrorMessage(error, { quotes: false });
    assert.equal(formatted, "Use one of --help/--version");
  });

  it("should format option names with quotes", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Use one of " },
      { type: "optionNames", optionNames: ["--help", "--version"] },
    ];
    const formatted = formatErrorMessage(error, { quotes: true });
    assert.equal(formatted, "Use one of `--help`/`--version`");
  });

  it("should format metavar without colors", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Expected " },
      { type: "metavar", metavar: "FILE" },
    ];
    const formatted = formatErrorMessage(error, {
      colors: false,
      quotes: true,
    });
    assert.equal(formatted, "Expected `FILE`");
  });

  it("should format metavar with colors", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Expected " },
      { type: "metavar", metavar: "FILE" },
    ];
    const formatted = formatErrorMessage(error, { colors: true, quotes: true });
    assert.equal(formatted, "Expected \x1b[1m`FILE`\x1b[0m");
  });

  it("should format single value without colors", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Invalid value " },
      { type: "value", value: "invalid" },
    ];
    const formatted = formatErrorMessage(error, {
      colors: false,
      quotes: true,
    });
    assert.equal(formatted, 'Invalid value "invalid"');
  });

  it("should format single value with colors", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Invalid value " },
      { type: "value", value: "invalid" },
    ];
    const formatted = formatErrorMessage(error, { colors: true, quotes: true });
    assert.equal(formatted, 'Invalid value \x1b[32m"invalid"\x1b[0m');
  });

  it("should format multiple values", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Expected one of " },
      { type: "values", values: ["red", "green", "blue"] },
    ];
    const formatted = formatErrorMessage(error, { quotes: true });
    assert.equal(formatted, 'Expected one of "red" "green" "blue"');
  });

  it("should format values without quotes", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Got " },
      { type: "values", values: ["foo", "bar"] },
    ];
    const formatted = formatErrorMessage(error, { quotes: false });
    assert.equal(formatted, "Got foo bar");
  });

  it("should handle default options", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Error: " },
      { type: "value", value: "test" },
    ];
    const formatted = formatErrorMessage(error);
    assert.equal(formatted, 'Error: "test"');
  });

  it("should handle complex mixed message", () => {
    const error: ErrorMessage = [
      { type: "text", text: "Option " },
      { type: "optionName", optionName: "--port" },
      { type: "text", text: " expects " },
      { type: "metavar", metavar: "NUMBER" },
      { type: "text", text: ", got " },
      { type: "value", value: "invalid" },
    ];
    const formatted = formatErrorMessage(error, { quotes: true });
    assert.equal(formatted, 'Option `--port` expects `NUMBER`, got "invalid"');
  });
});

describe("integration tests", () => {
  it("should create and format complete error message", () => {
    const option = "--timeout";
    const expected = "NUMBER";
    const actual = "not-a-number";

    const error = message`Option ${optionName(option)} expects ${
      metavar(expected)
    }, got ${actual}`;
    const formatted = formatErrorMessage(error, { quotes: true });

    assert.equal(
      formatted,
      'Option `--timeout` expects `NUMBER`, got "not-a-number"',
    );
  });

  it("should handle constraint violation message", () => {
    const min = "10";
    const max = "100";
    const actual = "150";

    const error =
      message`Value must be between ${min} and ${max}, got ${actual}`;
    const formatted = formatErrorMessage(error);

    assert.equal(formatted, 'Value must be between "10" and "100", got "150"');
  });

  it("should format choice error message", () => {
    const choices = ["red", "green", "blue"];
    const invalid = "purple";

    const error = message`Expected one of ${values(choices)}, got ${invalid}`;
    const formatted = formatErrorMessage(error, { quotes: true });

    assert.equal(
      formatted,
      'Expected one of "red" "green" "blue", got "purple"',
    );
  });
});
