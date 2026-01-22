import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHyphens, escapeRoff, formatMessageAsRoff } from "./roff.ts";
import {
  commandLine,
  envVar,
  message,
  metavar,
  optionName,
  optionNames,
  text,
  value,
  values,
} from "@optique/core/message";

describe("escapeRoff()", () => {
  it("returns unchanged text for normal strings", () => {
    assert.equal(escapeRoff("Hello, world!"), "Hello, world!");
  });

  it("escapes backslashes", () => {
    assert.equal(escapeRoff("path\\to\\file"), "path\\\\to\\\\file");
  });

  it("escapes period at the start of a line", () => {
    assert.equal(escapeRoff(".TH MYAPP 1"), "\\&.TH MYAPP 1");
  });

  it("escapes single quote at the start of a line", () => {
    assert.equal(escapeRoff("'quoted text'"), "\\&'quoted text'");
  });

  it("escapes period after newline", () => {
    assert.equal(
      escapeRoff("First line\n.Second line"),
      "First line\n\\&.Second line",
    );
  });

  it("escapes single quote after newline", () => {
    assert.equal(
      escapeRoff("First line\n'Second line"),
      "First line\n\\&'Second line",
    );
  });

  it("handles multiple special characters", () => {
    assert.equal(
      escapeRoff(".start\\middle\n.end"),
      "\\&.start\\\\middle\n\\&.end",
    );
  });

  it("handles empty string", () => {
    assert.equal(escapeRoff(""), "");
  });

  it("preserves normal punctuation", () => {
    assert.equal(
      escapeRoff("Hello, world! How are you?"),
      "Hello, world! How are you?",
    );
  });

  it("escapes period in the middle of text (not at line start)", () => {
    // Period in the middle should not be escaped
    assert.equal(escapeRoff("Hello. World"), "Hello. World");
  });
});

describe("escapeHyphens()", () => {
  it("escapes single hyphen", () => {
    assert.equal(escapeHyphens("-"), "\\-");
  });

  it("escapes double hyphen", () => {
    assert.equal(escapeHyphens("--"), "\\-\\-");
  });

  it("escapes option-style hyphens", () => {
    assert.equal(escapeHyphens("--foo"), "\\-\\-foo");
  });

  it("escapes short option", () => {
    assert.equal(escapeHyphens("-v"), "\\-v");
  });

  it("escapes multiple hyphens in text", () => {
    assert.equal(
      escapeHyphens("Use --verbose or -v"),
      "Use \\-\\-verbose or \\-v",
    );
  });

  it("handles text without hyphens", () => {
    assert.equal(escapeHyphens("hello world"), "hello world");
  });

  it("handles empty string", () => {
    assert.equal(escapeHyphens(""), "");
  });
});

describe("formatMessageAsRoff()", () => {
  it("returns empty string for empty message", () => {
    assert.equal(formatMessageAsRoff([]), "");
  });

  it("formats plain text", () => {
    const msg = message`Hello, world!`;
    assert.equal(formatMessageAsRoff(msg), "Hello, world!");
  });

  it("formats text with special roff characters", () => {
    const msg = [text(".TH should be escaped")];
    assert.equal(formatMessageAsRoff(msg), "\\&.TH should be escaped");
  });

  it("formats optionName in bold with escaped hyphens", () => {
    const msg = [optionName("--verbose")];
    assert.equal(formatMessageAsRoff(msg), "\\fB\\-\\-verbose\\fR");
  });

  it("formats short optionName", () => {
    const msg = [optionName("-v")];
    assert.equal(formatMessageAsRoff(msg), "\\fB\\-v\\fR");
  });

  it("formats optionNames as comma-separated bold text", () => {
    const msg = [optionNames(["--verbose", "-v"])];
    assert.equal(
      formatMessageAsRoff(msg),
      "\\fB\\-\\-verbose\\fR, \\fB\\-v\\fR",
    );
  });

  it("formats single optionNames", () => {
    const msg = [optionNames(["--help"])];
    assert.equal(formatMessageAsRoff(msg), "\\fB\\-\\-help\\fR");
  });

  it("formats metavar in italic", () => {
    const msg = [metavar("FILE")];
    assert.equal(formatMessageAsRoff(msg), "\\fIFILE\\fR");
  });

  it("formats value with quotes", () => {
    const msg = [value("hello")];
    assert.equal(formatMessageAsRoff(msg), '"hello"');
  });

  it("formats value with special characters", () => {
    const msg = [value("path\\to\\file")];
    assert.equal(formatMessageAsRoff(msg), '"path\\\\to\\\\file"');
  });

  it("formats values as space-separated quoted strings", () => {
    const msg = [values(["a", "b", "c"])];
    assert.equal(formatMessageAsRoff(msg), '"a" "b" "c"');
  });

  it("formats single values", () => {
    const msg = [values(["only"])];
    assert.equal(formatMessageAsRoff(msg), '"only"');
  });

  it("formats empty values", () => {
    const msg = [values([])];
    assert.equal(formatMessageAsRoff(msg), "");
  });

  it("formats envVar in bold", () => {
    const msg = [envVar("PATH")];
    assert.equal(formatMessageAsRoff(msg), "\\fBPATH\\fR");
  });

  it("formats commandLine in bold", () => {
    const msg = [commandLine("myapp --help")];
    assert.equal(formatMessageAsRoff(msg), "\\fBmyapp \\-\\-help\\fR");
  });

  it("formats complex message with multiple terms", () => {
    const msg = message`Use ${optionName("--config")} ${
      metavar("FILE")
    } to specify config.`;
    assert.equal(
      formatMessageAsRoff(msg),
      "Use \\fB\\-\\-config\\fR \\fIFILE\\fR to specify config.",
    );
  });

  it("formats message with environment variable reference", () => {
    const msg = message`Set ${envVar("API_KEY")} environment variable.`;
    assert.equal(
      formatMessageAsRoff(msg),
      "Set \\fBAPI_KEY\\fR environment variable.",
    );
  });

  it("handles paragraph breaks (double newlines)", () => {
    const msg = [text("First paragraph.\n\nSecond paragraph.")];
    assert.equal(
      formatMessageAsRoff(msg),
      "First paragraph.\n.PP\nSecond paragraph.",
    );
  });

  it("handles single newlines as soft breaks", () => {
    const msg = [text("Line one.\nLine two.")];
    assert.equal(formatMessageAsRoff(msg), "Line one.\nLine two.");
  });

  it("handles multiple paragraph breaks", () => {
    const msg = [text("First.\n\nSecond.\n\nThird.")];
    assert.equal(
      formatMessageAsRoff(msg),
      "First.\n.PP\nSecond.\n.PP\nThird.",
    );
  });

  it("formats message with all term types", () => {
    const msg = [
      text("Run "),
      commandLine("myapp"),
      text(" with "),
      optionName("--port"),
      text(" "),
      metavar("NUM"),
      text(". Default is "),
      value("8080"),
      text(". See "),
      envVar("PORT"),
      text("."),
    ];
    assert.equal(
      formatMessageAsRoff(msg),
      'Run \\fBmyapp\\fR with \\fB\\-\\-port\\fR \\fINUM\\fR. Default is "8080". See \\fBPORT\\fR.',
    );
  });
});
