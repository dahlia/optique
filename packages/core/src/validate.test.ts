import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeControlChars,
  validateCommandNames,
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
    validateMetaNameCollisions(new Set(), new Set(), [], []);
  });

  it("should pass with no collisions", () => {
    validateMetaNameCollisions(
      new Set(["--verbose", "-v"]),
      new Set(["build", "test"]),
      [["help option", ["--help"]]],
      [["help command", ["help"]]],
    );
  });

  it("should pass when meta features use custom names avoiding collision", () => {
    validateMetaNameCollisions(
      new Set(["--help"]),
      new Set(["help"]),
      [["help option", ["--info"]]],
      [["help command", ["info"]]],
    );
  });

  it("should throw on duplicate within a single meta option feature", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          new Set(),
          new Set(),
          [["help option", ["--help", "--help"]]],
          [],
        ),
      {
        name: "TypeError",
        message: /help option.*duplicate.*"--help"/i,
      },
    );
  });

  it("should throw on duplicate within a single meta command feature", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          new Set(),
          new Set(),
          [],
          [["help command", ["help", "help"]]],
        ),
      {
        name: "TypeError",
        message: /help command.*duplicate.*"help"/i,
      },
    );
  });

  it("should throw when two meta options share a name", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          new Set(),
          new Set(),
          [
            ["help option", ["--meta"]],
            ["completion option", ["--meta"]],
          ],
          [],
        ),
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
        validateMetaNameCollisions(
          new Set(),
          new Set(),
          [],
          [
            ["help command", ["meta"]],
            ["version command", ["meta"]],
          ],
        ),
      {
        name: "TypeError",
        message: /help command.*version command|version command.*help command/i,
      },
    );
  });

  it("should throw when three meta commands share a name", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          new Set(),
          new Set(),
          [],
          [
            ["help command", ["meta"]],
            ["version command", ["meta"]],
            ["completion command", ["meta"]],
          ],
        ),
      { name: "TypeError" },
    );
  });

  it("should throw when user option collides with meta option", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          new Set(["--help"]),
          new Set(),
          [["help option", ["--help"]]],
          [],
        ),
      {
        name: "TypeError",
        message: /user.*"--help".*help option/i,
      },
    );
  });

  it("should throw when user command collides with meta command", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          new Set(),
          new Set(["help"]),
          [],
          [["help command", ["help"]]],
        ),
      {
        name: "TypeError",
        message: /user.*"help".*help command/i,
      },
    );
  });

  it("should not throw when meta feature is disabled", () => {
    // User has --help but help option is not in metaOptions (disabled)
    validateMetaNameCollisions(
      new Set(["--help"]),
      new Set(["help"]),
      [],
      [],
    );
  });

  it("should detect collision with aliases", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          new Set(),
          new Set(["aide"]),
          [],
          [["help command", ["help", "aide"]]],
        ),
      {
        name: "TypeError",
        message: /user.*"aide".*help command/i,
      },
    );
  });
});
