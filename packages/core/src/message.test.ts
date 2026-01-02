import {
  commandLine,
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
  valueSet,
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

  it("should create commandLine term", () => {
    const term = commandLine("myapp completion bash > output.bash");
    assert.equal(term.type, "commandLine");
    assert.equal(term.commandLine, "myapp completion bash > output.bash");
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

  it("should format commandLine without colors", () => {
    const msg: Message = [
      { type: "text", text: "Run: " },
      {
        type: "commandLine",
        commandLine: "myapp completion bash > output.bash",
      },
    ];
    const formatted = formatMessage(msg, {
      colors: false,
      quotes: true,
    });
    assert.equal(formatted, "Run: `myapp completion bash > output.bash`");
  });

  it("should format commandLine with colors", () => {
    const msg: Message = [
      { type: "text", text: "Run: " },
      {
        type: "commandLine",
        commandLine: "myapp completion bash > output.bash",
      },
    ];
    const formatted = formatMessage(msg, { colors: true, quotes: true });
    assert.equal(
      formatted,
      "Run: \x1b[36m`myapp completion bash > output.bash`\x1b[0m",
    );
  });

  it("should format commandLine without quotes", () => {
    const msg: Message = [
      { type: "text", text: "Example: " },
      { type: "commandLine", commandLine: "myapp --help" },
    ];
    const formatted = formatMessage(msg, { quotes: false });
    assert.equal(formatted, "Example: myapp --help");
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

  describe("resetSuffix functionality", () => {
    it("should apply resetSuffix after ANSI reset sequences", () => {
      const msg: Message = [
        { type: "text", text: "Environment variable " },
        { type: "envVar", envVar: "PATH" },
        { type: "text", text: " is required" },
      ];
      const formatted = formatMessage(msg, {
        colors: { resetSuffix: "\x1b[2m" },
        quotes: false,
      });

      // Should contain the resetSuffix after the envVar reset
      assert.ok(formatted.includes("\x1b[0m\x1b[2m"));
      assert.ok(formatted.includes("\x1b[1;4mPATH\x1b[0m\x1b[2m is required"));
    });

    it("should work with boolean colors option (backward compatibility)", () => {
      const msg: Message = [
        { type: "text", text: "Value " },
        { type: "value", value: "test" },
        { type: "text", text: " is invalid" },
      ];

      // Test with colors: true (boolean)
      const withColors = formatMessage(msg, { colors: true, quotes: false });
      assert.equal(withColors, "Value \x1b[32mtest\x1b[0m is invalid");

      // Test with colors: false (boolean)
      const withoutColors = formatMessage(msg, {
        colors: false,
        quotes: false,
      });
      assert.equal(withoutColors, "Value test is invalid");
    });

    it("should apply resetSuffix to all styled elements", () => {
      const msg: Message = [
        { type: "optionName", optionName: "--verbose" },
        { type: "text", text: " and " },
        { type: "metavar", metavar: "FILE" },
        { type: "text", text: " with " },
        { type: "envVar", envVar: "HOME" },
      ];
      const formatted = formatMessage(msg, {
        colors: { resetSuffix: "\x1b[2m" },
        quotes: false,
      });

      // Each styled element should end with resetSuffix
      assert.ok(formatted.includes("--verbose\x1b[0m\x1b[2m"));
      assert.ok(formatted.includes("FILE\x1b[0m\x1b[2m"));
      assert.ok(formatted.includes("HOME\x1b[0m\x1b[2m"));
    });

    it("should handle empty resetSuffix", () => {
      const msg: Message = [
        { type: "text", text: "Option " },
        { type: "optionName", optionName: "--help" },
        { type: "text", text: " is available" },
      ];
      const formatted = formatMessage(msg, {
        colors: { resetSuffix: "" },
        quotes: false,
      });

      // Should behave like normal colors: true
      assert.equal(formatted, "Option \x1b[3m--help\x1b[0m is available");
    });

    it("should handle undefined resetSuffix", () => {
      const msg: Message = [
        { type: "text", text: "Value " },
        { type: "value", value: "42" },
      ];
      const formatted = formatMessage(msg, {
        colors: { resetSuffix: undefined },
        quotes: false,
      });

      // Should behave like normal colors: true
      assert.equal(formatted, "Value \x1b[32m42\x1b[0m");
    });
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

  it("should handle resetSuffix when colors is an object", () => {
    const msg = message`Port: ${value("8080")}`;
    const formatted = formatMessage(msg, {
      colors: { resetSuffix: "\x1b[2m" },
      quotes: false,
    });

    assert.equal(
      formatted,
      "Port: \x1b[32m8080\x1b[0m\x1b[2m",
    );
  });

  it("should handle resetSuffix with multiple terms", () => {
    const msg = message`Options: ${optionName("--verbose")} and ${
      value("true")
    }`;
    const formatted = formatMessage(msg, {
      colors: { resetSuffix: "\x1b[2m" },
      quotes: false,
    });

    assert.equal(
      formatted,
      "Options: \x1b[3m--verbose\x1b[0m\x1b[2m and \x1b[32mtrue\x1b[0m\x1b[2m",
    );
  });

  it("should handle resetSuffix with boolean colors for backward compatibility", () => {
    const msg = message`Port: ${value("8080")}`;
    const formatted = formatMessage(msg, { colors: true, quotes: false });

    assert.equal(
      formatted,
      "Port: \x1b[32m8080\x1b[0m",
    );
  });

  it("should handle resetSuffix with envVar term", () => {
    const msg = message`Environment variable: ${envVar("API_URL")}`;
    const formatted = formatMessage(msg, {
      colors: { resetSuffix: "\x1b[2m" },
      quotes: false,
    });

    assert.equal(
      formatted,
      "Environment variable: \x1b[1;4mAPI_URL\x1b[0m\x1b[2m",
    );
  });

  it("should handle resetSuffix with commandLine term", () => {
    const msg = message`Run: ${commandLine("myapp --help")}`;
    const formatted = formatMessage(msg, {
      colors: { resetSuffix: "\x1b[2m" },
      quotes: false,
    });

    assert.equal(
      formatted,
      "Run: \x1b[36mmyapp --help\x1b[0m\x1b[2m",
    );
  });

  it("should handle resetSuffix with values term", () => {
    const msg = message`Values: ${values(["red", "green", "blue"])}`;
    const formatted = formatMessage(msg, {
      colors: { resetSuffix: "\x1b[2m" },
      quotes: false,
    });

    assert.equal(
      formatted,
      "Values: \x1b[32mred green blue\x1b[0m\x1b[2m",
    );
  });

  it("should not apply resetSuffix when colors is false", () => {
    const msg = message`Port: ${value("8080")}`;
    const formatted = formatMessage(msg, {
      colors: false,
      quotes: false,
    });

    assert.equal(formatted, "Port: 8080");
  });

  it("should handle empty resetSuffix", () => {
    const msg = message`Port: ${value("8080")}`;
    const formatted = formatMessage(msg, {
      colors: { resetSuffix: "" },
      quotes: false,
    });

    assert.equal(
      formatted,
      "Port: \x1b[32m8080\x1b[0m",
    );
  });
});

describe("formatMessage - explicit line breaks", () => {
  it("should treat single newline as space (soft break)", () => {
    const msg: Message = [
      { type: "text", text: "Line 1." },
      { type: "text", text: "\n" },
      { type: "text", text: "Line 2." },
    ];
    const formatted = formatMessage(msg, { quotes: false });

    // Single newline is converted to space
    assert.equal(formatted, "Line 1. Line 2.");
  });

  it("should treat single newline within text as space", () => {
    const msg: Message = [
      { type: "text", text: "Line 1.\nLine 2." },
    ];
    const formatted = formatMessage(msg, { quotes: false });

    // Single newline is converted to space
    assert.equal(formatted, "Line 1. Line 2.");
  });

  it("should treat double newline as hard break", () => {
    const msg: Message = [
      { type: "text", text: "Para 1.\n\nPara 2." },
    ];
    const formatted = formatMessage(msg, { quotes: false });

    // Double newline creates actual line break
    assert.equal(formatted, "Para 1.\nPara 2.");
  });

  it("should handle multiple double newlines", () => {
    const msg: Message = [
      { type: "text", text: "A\n\nB\n\nC" },
    ];
    const formatted = formatMessage(msg, { quotes: false });

    assert.equal(formatted, "A\nB\nC");
  });

  it("should handle triple+ newlines as single hard break", () => {
    const msg: Message = [
      { type: "text", text: "Line 1\n\n\nLine 2" },
    ];
    const formatted = formatMessage(msg, { quotes: false });

    // Triple newlines still treated as single hard break
    assert.equal(formatted, "Line 1\nLine 2");
  });

  it("should handle double newline with option names", () => {
    const msg: Message = [
      { type: "text", text: "No matched option for " },
      { type: "optionName", optionName: "--verbos" },
      { type: "text", text: "." },
      { type: "text", text: "\n\n" },
      { type: "text", text: "Did you mean " },
      { type: "optionName", optionName: "--verbose" },
      { type: "text", text: "?" },
    ];
    const formatted = formatMessage(msg, { quotes: false });

    assert.ok(formatted.includes("\n"));
    assert.ok(formatted.includes("--verbos"));
    assert.ok(formatted.includes("--verbose"));
    const lines = formatted.split("\n");
    assert.equal(lines.length, 2);
  });

  it("should reset width tracking after hard line break", () => {
    const msg: Message = [
      { type: "text", text: "Short.\n\nThis is a much longer second line." },
    ];
    const formatted = formatMessage(msg, { quotes: false, maxWidth: 50 });

    const lines = formatted.split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines[0].startsWith("Short."));
    assert.ok(lines[1].includes("This is a much longer second line."));
  });

  it("should normalize single newlines in long text", () => {
    const msg: Message = [
      {
        type: "text",
        text: "This is a\nvery long\nsentence that\nspans multiple\nlines.",
      },
    ];
    const formatted = formatMessage(msg, { quotes: false });

    // All single newlines become spaces
    assert.equal(
      formatted,
      "This is a very long sentence that spans multiple lines.",
    );
  });

  it("should handle mixed single and double newlines", () => {
    const msg: Message = [
      {
        type: "text",
        text:
          "Para 1 line 1.\nPara 1 line 2.\n\nPara 2 line 1.\nPara 2 line 2.",
      },
    ];
    const formatted = formatMessage(msg, { quotes: false });

    assert.equal(
      formatted,
      "Para 1 line 1. Para 1 line 2.\nPara 2 line 1. Para 2 line 2.",
    );
  });

  it("should handle empty paragraphs (multiple consecutive double newlines)", () => {
    const msg: Message = [
      { type: "text", text: "Line 1\n\n\n\nLine 2" },
    ];
    const formatted = formatMessage(msg, { quotes: false });

    // Multiple double newlines still create single hard break
    assert.equal(formatted, "Line 1\nLine 2");
  });
});

describe("valueSet", () => {
  it("should format list with conjunction by default", () => {
    const msg = valueSet(["error", "warn", "info"], { locale: "en" });

    // Should have 5 terms: value, text(", "), value, text(", and "), value
    assert.ok(Array.isArray(msg));
    assert.equal(msg.length, 5);
    assert.deepEqual(msg[0], { type: "value", value: "error" });
    assert.deepEqual(msg[1], { type: "text", text: ", " });
    assert.deepEqual(msg[2], { type: "value", value: "warn" });
    assert.deepEqual(msg[3], { type: "text", text: ", and " });
    assert.deepEqual(msg[4], { type: "value", value: "info" });
  });

  it("should format list with disjunction", () => {
    const msg = valueSet(["error", "warn", "info"], {
      locale: "en",
      type: "disjunction",
    });

    assert.ok(Array.isArray(msg));
    assert.equal(msg.length, 5);
    assert.deepEqual(msg[0], { type: "value", value: "error" });
    assert.deepEqual(msg[1], { type: "text", text: ", " });
    assert.deepEqual(msg[2], { type: "value", value: "warn" });
    assert.deepEqual(msg[3], { type: "text", text: ", or " });
    assert.deepEqual(msg[4], { type: "value", value: "info" });
  });

  it("should handle empty array", () => {
    const msg = valueSet([]);
    assert.ok(Array.isArray(msg));
    assert.equal(msg.length, 0);
  });

  it("should handle single element", () => {
    const msg = valueSet(["only"], { locale: "en" });
    assert.ok(Array.isArray(msg));
    assert.equal(msg.length, 1);
    assert.deepEqual(msg[0], { type: "value", value: "only" });
  });

  it("should handle two elements", () => {
    const msg = valueSet(["first", "second"], { locale: "en" });

    // Should have 3 terms: value, text(" and "), value
    assert.ok(Array.isArray(msg));
    assert.equal(msg.length, 3);
    assert.deepEqual(msg[0], { type: "value", value: "first" });
    assert.deepEqual(msg[1], { type: "text", text: " and " });
    assert.deepEqual(msg[2], { type: "value", value: "second" });
  });

  it("should handle two elements with disjunction", () => {
    const msg = valueSet(["first", "second"], {
      locale: "en",
      type: "disjunction",
    });

    assert.ok(Array.isArray(msg));
    assert.equal(msg.length, 3);
    assert.deepEqual(msg[0], { type: "value", value: "first" });
    assert.deepEqual(msg[1], { type: "text", text: " or " });
    assert.deepEqual(msg[2], { type: "value", value: "second" });
  });

  it("should work with Korean locale", () => {
    const msg = valueSet(["error", "warn", "info"], {
      locale: "ko",
      type: "disjunction",
    });

    // Korean uses different separators
    assert.ok(Array.isArray(msg));
    assert.equal(msg.length, 5);
    // Check that values are preserved
    assert.deepEqual(msg[0], { type: "value", value: "error" });
    assert.deepEqual(msg[2], { type: "value", value: "warn" });
    assert.deepEqual(msg[4], { type: "value", value: "info" });
    // Korean "or" is "또는"
    assert.equal(msg[3].type, "text");
    if (msg[3].type === "text") {
      assert.ok(msg[3].text.includes("또는"));
    }
  });

  it("should accept Intl.Locale object", () => {
    const locale = new Intl.Locale("en-US");
    const msg = valueSet(["a", "b"], { locale });

    assert.ok(Array.isArray(msg));
    assert.equal(msg.length, 3);
    assert.deepEqual(msg[0], { type: "value", value: "a" });
    assert.deepEqual(msg[2], { type: "value", value: "b" });
  });

  it("should accept array of locales", () => {
    const msg = valueSet(["a", "b"], { locale: ["en-US", "en"] });

    assert.ok(Array.isArray(msg));
    assert.equal(msg.length, 3);
  });

  it("should work without options (use system default)", () => {
    const msg = valueSet(["a", "b", "c"]);

    // Should produce valid output with system default locale
    assert.ok(Array.isArray(msg));
    assert.equal(msg.length, 5);
    assert.deepEqual(msg[0], { type: "value", value: "a" });
    assert.deepEqual(msg[2], { type: "value", value: "b" });
    assert.deepEqual(msg[4], { type: "value", value: "c" });
  });

  it("should integrate with message template", () => {
    const msg = message`Expected ${valueSet(["a", "b"], { locale: "en" })}.`;

    const formatted = formatMessage(msg, { quotes: true });
    assert.equal(formatted, 'Expected "a" and "b".');
  });

  it("should integrate with message template using disjunction", () => {
    const msg = message`Expected one of ${
      valueSet(["error", "warn", "info"], { locale: "en", type: "disjunction" })
    }.`;

    const formatted = formatMessage(msg, { quotes: true });
    assert.equal(formatted, 'Expected one of "error", "warn", or "info".');
  });
});
