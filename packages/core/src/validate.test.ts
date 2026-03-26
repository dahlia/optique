import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeControlChars,
  type UserParserNames,
  validateCommandNames,
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
  const e: ReadonlySet<string> = new Set<string>();
  // Helper: build UserParserNames with same sets for leading and all
  function u(
    opts: ReadonlySet<string> = e,
    cmds: ReadonlySet<string> = e,
    lits: ReadonlySet<string> = e,
  ): UserParserNames {
    return {
      leadingOptions: opts,
      leadingCommands: cmds,
      leadingLiterals: lits,
      allOptions: opts,
      allCommands: cmds,
      allLiterals: lits,
    };
  }

  it("should pass with no meta features", () => {
    validateMetaNameCollisions(u(), []);
  });

  it("should pass with no collisions", () => {
    validateMetaNameCollisions(
      u(new Set(["--verbose", "-v"]), new Set(["build", "test"])),
      [
        ["option", "help option", ["--help"]],
        ["command", "help command", ["help"]],
      ],
    );
  });

  it("should pass when meta features use custom names avoiding collision", () => {
    validateMetaNameCollisions(
      u(new Set(["--help"]), new Set(["help"])),
      [
        ["option", "help option", ["--info"]],
        ["command", "help command", ["info"]],
      ],
    );
  });

  it("should throw on duplicate within a single meta feature", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(u(), [
          ["option", "help option", ["--help", "--help"]],
        ]),
      { name: "TypeError", message: /help option.*duplicate.*"--help"/i },
    );
  });

  it("should throw on duplicate within a single meta command feature", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(u(), [
          ["command", "help command", ["help", "help"]],
        ]),
      { name: "TypeError", message: /help command.*duplicate.*"help"/i },
    );
  });

  it("should throw when two meta options share a name", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(u(), [
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
        validateMetaNameCollisions(u(), [
          ["command", "help command", ["meta"]],
          ["command", "version command", ["meta"]],
        ]),
      {
        name: "TypeError",
        message: /help command.*version command|version command.*help command/i,
      },
    );
  });

  it("should throw when user option collides with meta option", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(u(new Set(["--help"])), [
          ["option", "help option", ["--help"]],
        ]),
      { name: "TypeError", message: /user.*"--help".*help option/i },
    );
  });

  it("should throw when user command collides with meta command", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(u(e, new Set(["help"])), [
          ["command", "help command", ["help"]],
        ]),
      { name: "TypeError", message: /user.*"help".*help command/i },
    );
  });

  it("should not throw when meta feature is disabled", () => {
    validateMetaNameCollisions(
      u(new Set(["--help"]), new Set(["help"])),
      [],
    );
  });

  it("should detect collision with aliases", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(u(e, new Set(["aide"])), [
          ["command", "help command", ["help", "aide"]],
        ]),
      { name: "TypeError", message: /user.*"aide".*help command/i },
    );
  });

  // Meta-vs-meta prefix collision tests
  it("should throw when meta command name matches prefixMatch meta option", () => {
    // help.command.names = ["--completion=bash"] + completion.option enabled
    assert.throws(
      () =>
        validateMetaNameCollisions(u(), [
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
    validateMetaNameCollisions(u(), [
      ["option", "help option", ["--help"]],
      ["command", "version command", ["--help=verbose"]],
    ]);
  });

  it("should reject prefix-shadowing aliases within the same meta feature", () => {
    // completion.option.names = ["--completion", "--completion=bash"]
    assert.throws(
      () =>
        validateMetaNameCollisions(u(), [
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
        validateMetaNameCollisions(u(), [
          ["option", "help option", ["--help"]],
          ["command", "version command", ["--help"]],
        ]),
      {
        name: "TypeError",
        message: /help option.*version command|version command.*help option/i,
      },
    );
  });

  it("should throw when user command collides with meta option (all depth)", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          {
            leadingOptions: e,
            leadingCommands: e,
            leadingLiterals: e,
            allOptions: e,
            allCommands: new Set(["--help"]),
            allLiterals: e,
          },
          [["option", "help option", ["--help"]]],
        ),
      { name: "TypeError", message: /user.*"--help".*help option/i },
    );
  });

  // Position-scoping tests
  it("should not flag nested option against meta command (position-aware)", () => {
    validateMetaNameCollisions(
      {
        leadingOptions: e,
        leadingCommands: e,
        leadingLiterals: e,
        allOptions: new Set(["--version"]),
        allCommands: e,
        allLiterals: e,
      },
      [["command", "version command", ["--version"]]],
    );
  });

  it("should not flag nested command against meta command (position-aware)", () => {
    validateMetaNameCollisions(
      {
        leadingOptions: e,
        leadingCommands: e,
        leadingLiterals: e,
        allOptions: e,
        allCommands: new Set(["help"]),
        allLiterals: e,
      },
      [["command", "help command", ["help"]]],
    );
  });

  it("should flag leading option against meta command (position-aware)", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          {
            leadingOptions: new Set(["--version"]),
            leadingCommands: e,
            leadingLiterals: e,
            allOptions: e,
            allCommands: e,
            allLiterals: e,
          },
          [["command", "version command", ["--version"]]],
        ),
      {
        name: "TypeError",
        message: /user.*option.*"--version".*version command/i,
      },
    );
  });

  it("should flag nested option against meta option (scans everywhere)", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          {
            leadingOptions: e,
            leadingCommands: e,
            leadingLiterals: e,
            allOptions: new Set(["--help"]),
            allCommands: e,
            allLiterals: e,
          },
          [["option", "help option", ["--help"]]],
        ),
      { name: "TypeError", message: /user.*"--help".*help option/i },
    );
  });

  it("should flag nested command against meta option (scans everywhere)", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          {
            leadingOptions: e,
            leadingCommands: e,
            leadingLiterals: e,
            allOptions: e,
            allCommands: new Set(["--help"]),
            allLiterals: e,
          },
          [["option", "help option", ["--help"]]],
        ),
      { name: "TypeError", message: /user.*"--help".*help option/i },
    );
  });

  // Literal value collision tests
  it("should flag literal value colliding with meta option", () => {
    // conditional(option("--mode", string()), { "--help": object({}) })
    assert.throws(
      () =>
        validateMetaNameCollisions(
          u(e, e, new Set(["--help"])),
          [["option", "help option", ["--help"]]],
        ),
      { name: "TypeError", message: /literal.*"--help".*help option/i },
    );
  });

  it("should not flag non-leading literal value against meta command", () => {
    // Meta commands only match at args[0]; non-leading literals are safe
    validateMetaNameCollisions(
      {
        leadingOptions: e,
        leadingCommands: e,
        leadingLiterals: e,
        allOptions: e,
        allCommands: e,
        allLiterals: new Set(["help"]),
      },
      [["command", "help command", ["help"]]],
    );
  });

  it("should flag leading literal value colliding with meta command", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          {
            leadingOptions: e,
            leadingCommands: e,
            leadingLiterals: new Set(["help"]),
            allOptions: e,
            allCommands: e,
            allLiterals: new Set(["help"]),
          },
          [["command", "help command", ["help"]]],
        ),
      { name: "TypeError", message: /literal.*"help".*help command/i },
    );
  });

  // Prefix matching tests (only for entries with prefixMatch: true)
  it("should flag user option matching prefix when prefixMatch is true", () => {
    // Put --completion=bash only in allOptions (not leading) to prove
    // that prefix matching checks the all-depth set.
    assert.throws(
      () =>
        validateMetaNameCollisions(
          {
            leadingOptions: e,
            leadingCommands: e,
            leadingLiterals: e,
            allOptions: new Set(["--completion=bash"]),
            allCommands: e,
            allLiterals: e,
          },
          [["option", "completion option", ["--completion"], true]],
        ),
      {
        name: "TypeError",
        message: /user.*"--completion=bash".*completion option/i,
      },
    );
  });

  it("should flag user command matching prefix when prefixMatch is true", () => {
    assert.throws(
      () =>
        validateMetaNameCollisions(
          {
            leadingOptions: e,
            leadingCommands: e,
            leadingLiterals: e,
            allOptions: e,
            allCommands: new Set(["--completion=bash"]),
            allLiterals: e,
          },
          [["option", "completion option", ["--completion"], true]],
        ),
      {
        name: "TypeError",
        message: /user.*"--completion=bash".*completion option/i,
      },
    );
  });

  it("should flag literal matching prefix when prefixMatch is true", () => {
    // conditional(option("--mode", string()), { "--completion=bash": ... })
    assert.throws(
      () =>
        validateMetaNameCollisions(
          u(e, e, new Set(["--completion=bash"])),
          [["option", "completion option", ["--completion"], true]],
        ),
      {
        name: "TypeError",
        message: /literal.*"--completion=bash".*completion option/i,
      },
    );
  });

  it("should not prefix-match when prefixMatch is not set", () => {
    // help/version use exact matching; --help=foo is a valid user name
    validateMetaNameCollisions(
      u(new Set(["--help=foo"])),
      [["option", "help option", ["--help"]]],
    );
  });

  it("should not flag prefix match against meta command entries", () => {
    validateMetaNameCollisions(
      u(new Set(["--completion=bash"])),
      [["command", "completion command", ["--completion"]]],
    );
  });

  it("should flag literal matching prefix against meta option", () => {
    // prefixMatch is only meaningful for option-form meta entries
    // (facade.ts only sets it for the completion option).
    assert.throws(
      () =>
        validateMetaNameCollisions(
          {
            leadingOptions: e,
            leadingCommands: e,
            leadingLiterals: e,
            allOptions: e,
            allCommands: e,
            allLiterals: new Set(["--completion=bash"]),
          },
          [["option", "completion option", ["--completion"], true]],
        ),
      {
        name: "TypeError",
        message: /literal.*"--completion=bash".*completion option/i,
      },
    );
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
