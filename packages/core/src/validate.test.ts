import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeControlChars,
  validateCommandNames,
  validateContextIds,
  validateLabel,
  validateMetaNameCollisions,
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
    const expected = {
      name: "TypeError",
      message: "Program name must be a string.",
    };
    assert.throws(() => validateProgramName(123 as never), expected);
    assert.throws(() => validateProgramName({} as never), expected);
    assert.throws(() => validateProgramName(null as never), expected);
    assert.throws(() => validateProgramName(undefined as never), expected);
    assert.throws(() => validateProgramName(Symbol("x") as never), expected);
    assert.throws(() => validateProgramName(true as never), expected);
  });

  it("should throw TypeError for empty string", () => {
    assert.throws(
      () => validateProgramName(""),
      { name: "TypeError", message: "Program name must not be empty." },
    );
  });

  it("should throw TypeError for whitespace-only string", () => {
    assert.throws(
      () => validateProgramName("   "),
      {
        name: "TypeError",
        message: 'Program name must not be whitespace-only: "   ".',
      },
    );
    assert.throws(
      () => validateProgramName("\t"),
      {
        name: "TypeError",
        message: 'Program name must not be whitespace-only: "\\t".',
      },
    );
  });

  it("should throw TypeError for strings with control characters", () => {
    assert.throws(
      () => validateProgramName("bad\nname"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\nname".',
      },
    );
    assert.throws(
      () => validateProgramName("bad\rname"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\rname".',
      },
    );
    assert.throws(
      () => validateProgramName("bad\x00name"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\x00name".',
      },
    );
    assert.throws(
      () => validateProgramName("bad\x1fname"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\x1fname".',
      },
    );
    assert.throws(
      () => validateProgramName("bad\x7fname"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\x7fname".',
      },
    );
  });

  it("should throw TypeError for C1 control characters", () => {
    assert.throws(
      () => validateProgramName("bad\x80name"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\x80name".',
      },
    );
    assert.throws(
      () => validateProgramName("bad\x85name"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\x85name".',
      },
    );
    assert.throws(
      () => validateProgramName("bad\x9bname"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\x9bname".',
      },
    );
    assert.throws(
      () => validateProgramName("bad\x9cname"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\x9cname".',
      },
    );
    assert.throws(
      () => validateProgramName("bad\x9fname"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\x9fname".',
      },
    );
  });

  it("should throw TypeError for Unicode line separators", () => {
    assert.throws(
      () => validateProgramName("bad\u2028name"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\u2028name".',
      },
    );
    assert.throws(
      () => validateProgramName("bad\u2029name"),
      {
        name: "TypeError",
        message:
          'Program name must not contain control characters: "bad\\u2029name".',
      },
    );
  });
});

describe("validateOptionNames", () => {
  it("should reject C0 control characters", () => {
    assert.throws(
      () => validateOptionNames(["--bad\nname"], "Option"),
      {
        name: "TypeError",
        message:
          'Option name must not contain control characters: "--bad\\nname".',
      },
    );
    assert.throws(
      () => validateOptionNames(["--bad\rname"], "Option"),
      {
        name: "TypeError",
        message:
          'Option name must not contain control characters: "--bad\\rname".',
      },
    );
    assert.throws(
      () => validateOptionNames(["--bad\x00name"], "Option"),
      {
        name: "TypeError",
        message:
          'Option name must not contain control characters: "--bad\\x00name".',
      },
    );
  });

  it("should reject C1 control characters", () => {
    assert.throws(
      () => validateOptionNames(["--bad\x80name"], "Option"),
      {
        name: "TypeError",
        message:
          'Option name must not contain control characters: "--bad\\x80name".',
      },
    );
    assert.throws(
      () => validateOptionNames(["--bad\x9bname"], "Option"),
      {
        name: "TypeError",
        message:
          'Option name must not contain control characters: "--bad\\x9bname".',
      },
    );
    assert.throws(
      () => validateOptionNames(["--bad\x9cname"], "Option"),
      {
        name: "TypeError",
        message:
          'Option name must not contain control characters: "--bad\\x9cname".',
      },
    );
  });

  it("should reject Unicode line separators", () => {
    assert.throws(
      () => validateOptionNames(["--bad\u2028name"], "Option"),
      {
        name: "TypeError",
        message:
          'Option name must not contain control characters: "--bad\\u2028name".',
      },
    );
    assert.throws(
      () => validateOptionNames(["--bad\u2029name"], "Option"),
      {
        name: "TypeError",
        message:
          'Option name must not contain control characters: "--bad\\u2029name".',
      },
    );
  });
});

describe("validateCommandNames", () => {
  it("should reject C0 control characters", () => {
    assert.throws(
      () => validateCommandNames(["bad\nname"], "Command"),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\nname".',
      },
    );
    assert.throws(
      () => validateCommandNames(["bad\rname"], "Command"),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\rname".',
      },
    );
    assert.throws(
      () => validateCommandNames(["bad\x00name"], "Command"),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\x00name".',
      },
    );
  });

  it("should reject C1 control characters", () => {
    assert.throws(
      () => validateCommandNames(["bad\x80name"], "Command"),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\x80name".',
      },
    );
    assert.throws(
      () => validateCommandNames(["bad\x9bname"], "Command"),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\x9bname".',
      },
    );
    assert.throws(
      () => validateCommandNames(["bad\x9cname"], "Command"),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\x9cname".',
      },
    );
  });

  it("should reject Unicode line separators", () => {
    assert.throws(
      () => validateCommandNames(["bad\u2028name"], "Command"),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\u2028name".',
      },
    );
    assert.throws(
      () => validateCommandNames(["bad\u2029name"], "Command"),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\u2029name".',
      },
    );
  });
});

describe("validateMetaNameCollisions", () => {
  it("should pass with no meta features", () => {
    validateMetaNameCollisions([]);
  });

  it("should pass with no collisions", () => {
    validateMetaNameCollisions(
      [
        ["option", "help option", ["--help"]],
        ["command", "help command", ["help"]],
      ],
    );
  });

  it("should pass when meta features use custom names avoiding collision", () => {
    validateMetaNameCollisions(
      [
        ["option", "help option", ["--info"]],
        ["command", "help command", ["info"]],
      ],
    );
  });

  it("should throw on duplicate within a single meta feature", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions([
          ["option", "help option", ["--help", "--help"]],
        ]),
      { name: "TypeError", message: /help option.*duplicate.*"--help"/i },
    );
  });

  it("should throw on duplicate within a single meta command feature", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions([
          ["command", "help command", ["help", "help"]],
        ]),
      { name: "TypeError", message: /help command.*duplicate.*"help"/i },
    );
  });

  it("should throw when two meta options share a name", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions([
          ["option", "help option", ["--meta"]],
          ["option", "completion option", ["--meta"]],
        ]),
      {
        name: "TypeError",
        message:
          /help option.*completion option|completion option.*help option/i,
      },
    );
  });

  it("should throw when two meta commands share a name", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions([
          ["command", "help command", ["meta"]],
          ["command", "version command", ["meta"]],
        ]),
      {
        name: "TypeError",
        message: /help command.*version command|version command.*help command/i,
      },
    );
  });

  it("should not throw when meta feature is disabled", () => {
    validateMetaNameCollisions([]);
  });

  // Meta-vs-meta prefix collision tests
  it("should throw when meta command name matches prefixMatch meta option", () => {
    // help.command.names = ["--completion=bash"] + completion.option enabled
    assert.throws(
      () =>
        validateMetaNameCollisions([
          ["command", "help command", ["--completion=bash"]],
          ["option", "completion option", ["--completion"], true],
        ]),
      {
        name: "TypeError",
        message: /prefix.*"--completion".*shadows.*"--completion=bash"/i,
      },
    );
  });

  it("should not prefix-match between meta features without prefixMatch", () => {
    // help and version don't use prefix matching
    validateMetaNameCollisions([
      ["option", "help option", ["--help"]],
      ["command", "version command", ["--help=verbose"]],
    ]);
  });

  it("should reject prefix-shadowing aliases within the same meta feature", () => {
    // completion.option.names = ["--completion", "--completion=bash"]
    assert.throws(
      () =>
        validateMetaNameCollisions([
          [
            "option",
            "completion option",
            ["--completion", "--completion=bash"],
            true,
          ],
        ]),
      {
        name: "TypeError",
        message: /prefix.*"--completion".*shadows.*"--completion=bash"/i,
      },
    );
  });

  // Cross-namespace collision tests
  it("should throw when meta command name collides with meta option name", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions([
          ["option", "help option", ["--help"]],
          ["command", "version command", ["--help"]],
        ]),
      {
        name: "TypeError",
        message: /help option.*version command|version command.*help option/i,
      },
    );
  });

  it("should not prefix-match when prefixMatch is not set", () => {
    // help/version use exact matching; --help=foo is a valid user name
    validateMetaNameCollisions([["option", "help option", ["--help"]]]);
  });

  it("should allow exact matching for meta command entries", () => {
    validateMetaNameCollisions([["command", "completion command", [
      "--completion",
    ]]]);
  });
});

describe("validateLabel", () => {
  it("should reject non-string labels", () => {
    const expected = {
      name: "TypeError",
      message: "Label must be a string.",
    };
    assert.throws(() => validateLabel(123 as never), expected);
    assert.throws(() => validateLabel(null as never), expected);
    assert.throws(() => validateLabel(undefined as never), expected);
  });

  it("should accept valid labels", () => {
    validateLabel("Options");
    validateLabel("Connection options");
    validateLabel("Server config");
    validateLabel("DB");
    validateLabel("Paramètres de connexion");
  });

  it("should reject empty label", () => {
    assert.throws(
      () => validateLabel(""),
      {
        name: "TypeError",
        message: "Label must not be empty.",
      },
    );
  });

  it("should reject whitespace-only labels", () => {
    assert.throws(
      () => validateLabel("   "),
      {
        name: "TypeError",
        message: /whitespace-only/,
      },
    );
    assert.throws(
      () => validateLabel("\t"),
      {
        name: "TypeError",
        message: /whitespace-only/,
      },
    );
  });

  it("should reject labels with newlines", () => {
    assert.throws(
      () => validateLabel("bad\nlabel"),
      {
        name: "TypeError",
        message: /control characters/,
      },
    );
    assert.throws(
      () => validateLabel("bad\rlabel"),
      {
        name: "TypeError",
        message: /control characters/,
      },
    );
    assert.throws(
      () => validateLabel("bad\r\nlabel"),
      {
        name: "TypeError",
        message: /control characters/,
      },
    );
  });

  it("should reject labels with C0 control characters", () => {
    assert.throws(
      () => validateLabel("bad\x00label"),
      {
        name: "TypeError",
        message: /control characters/,
      },
    );
    assert.throws(
      () => validateLabel("bad\x1flabel"),
      {
        name: "TypeError",
        message: /control characters/,
      },
    );
  });

  it("should reject labels with DEL and C1 control characters", () => {
    assert.throws(
      () => validateLabel("bad\x7flabel"),
      {
        name: "TypeError",
        message: /control characters/,
      },
    );
    assert.throws(
      () => validateLabel("bad\x80label"),
      {
        name: "TypeError",
        message: /control characters/,
      },
    );
    assert.throws(
      () => validateLabel("bad\x9flabel"),
      {
        name: "TypeError",
        message: /control characters/,
      },
    );
  });

  it("should reject labels with Unicode line separators", () => {
    assert.throws(
      () => validateLabel("bad\u2028label"),
      {
        name: "TypeError",
        message: /control characters/,
      },
    );
    assert.throws(
      () => validateLabel("bad\u2029label"),
      {
        name: "TypeError",
        message: /control characters/,
      },
    );
  });
});

describe("validateContextIds", () => {
  it("should accept an empty array", () => {
    validateContextIds([]);
  });

  it("should accept contexts with distinct ids", () => {
    validateContextIds([
      { id: Symbol.for("@test/a") },
      { id: Symbol.for("@test/b") },
      { id: Symbol.for("@test/c") },
    ]);
  });

  it("should throw TypeError for duplicate ids", () => {
    const shared = Symbol.for("@test/dup");
    assert.throws(
      () =>
        validateContextIds([
          { id: shared },
          { id: shared },
        ]),
      {
        name: "TypeError",
        message: /Duplicate SourceContext id/,
      },
    );
  });

  it("should identify the duplicate id in the error message", () => {
    const shared = Symbol.for("@test/identified");
    assert.throws(
      () =>
        validateContextIds([
          { id: Symbol.for("@test/unique") },
          { id: shared },
          { id: shared },
        ]),
      {
        name: "TypeError",
        message: /Symbol\(@test\/identified\)/,
      },
    );
  });

  it("should detect duplicates from Symbol.for with same key", () => {
    assert.throws(
      () =>
        validateContextIds([
          { id: Symbol.for("@test/same-key") },
          { id: Symbol.for("@test/same-key") },
        ]),
      {
        name: "TypeError",
        message: /Duplicate SourceContext id/,
      },
    );
  });

  it("should not treat distinct Symbol() calls as duplicates", () => {
    validateContextIds([
      { id: Symbol("@test/local") },
      { id: Symbol("@test/local") },
    ]);
  });
});
