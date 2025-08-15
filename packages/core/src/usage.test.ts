import {
  formatUsage,
  type OptionName,
  type Usage,
  type UsageFormatOptions,
  type UsageTerm,
} from "@optique/core/usage";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("formatUsage", () => {
  describe("argument terms", () => {
    it("should format a simple argument", () => {
      const usage: Usage = [
        { type: "argument", metavar: "FILE" },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test FILE");
    });

    it("should format argument with colors", () => {
      const usage: Usage = [
        { type: "argument", metavar: "FILE" },
      ];
      const result = formatUsage("test", usage, { colors: true });
      assert.equal(result, "\x1b[1mtest\x1b[0m \x1b[4mFILE\x1b[0m");
    });

    it("should format multiple arguments", () => {
      const usage: Usage = [
        { type: "argument", metavar: "INPUT" },
        { type: "argument", metavar: "OUTPUT" },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test INPUT OUTPUT");
    });
  });

  describe("option terms", () => {
    it("should format a simple option", () => {
      const usage: Usage = [
        {
          type: "option",
          names: ["--verbose", "-v"],
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test --verbose/-v");
    });

    it("should format option with colors", () => {
      const usage: Usage = [
        {
          type: "option",
          names: ["--verbose", "-v"],
        },
      ];
      const result = formatUsage("test", usage, { colors: true });
      assert.equal(
        result,
        "\x1b[1mtest\x1b[0m \x1b[3m--verbose\x1b[0m\x1b[2m/\x1b[0m\x1b[3m-v\x1b[0m",
      );
    });

    it("should format option with metavar", () => {
      const usage: Usage = [
        {
          type: "option",
          names: ["--output", "-o"],
          metavar: "FILE",
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test --output/-o FILE");
    });

    it("should format option with metavar and colors", () => {
      const usage: Usage = [
        {
          type: "option",
          names: ["--output", "-o"],
          metavar: "FILE",
        },
      ];
      const result = formatUsage("test", usage, { colors: true });
      assert.equal(
        result,
        "\x1b[1mtest\x1b[0m \x1b[3m--output\x1b[0m\x1b[2m/\x1b[0m\x1b[3m-o\x1b[0m \x1b[4m\x1b[2mFILE\x1b[0m",
      );
    });

    it("should format option with onlyShortestOptions", () => {
      const usage: Usage = [
        {
          type: "option",
          names: ["--verbose", "-v"],
        },
      ];
      const result = formatUsage("test", usage, { onlyShortestOptions: true });
      assert.equal(result, "test -v");
    });

    it("should format option with onlyShortestOptions and colors", () => {
      const usage: Usage = [
        {
          type: "option",
          names: ["--verbose", "-v"],
        },
      ];
      const result = formatUsage("test", usage, {
        onlyShortestOptions: true,
        colors: true,
      });
      assert.equal(result, "\x1b[1mtest\x1b[0m \x1b[3m-v\x1b[0m");
    });

    it("should pick shortest option name when onlyShortestOptions is true", () => {
      const usage: Usage = [
        {
          type: "option",
          names: ["--very-long-option", "-s", "--short"],
        },
      ];
      const result = formatUsage("test", usage, { onlyShortestOptions: true });
      assert.equal(result, "test -s");
    });
  });

  describe("command terms", () => {
    it("should format a command", () => {
      const usage: Usage = [
        { type: "command", name: "init" },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test init");
    });

    it("should format command with colors", () => {
      const usage: Usage = [
        { type: "command", name: "init" },
      ];
      const result = formatUsage("test", usage, { colors: true });
      assert.equal(result, "\x1b[1mtest\x1b[0m \x1b[1minit\x1b[0m");
    });

    it("should format multiple commands", () => {
      const usage: Usage = [
        { type: "command", name: "git" },
        { type: "command", name: "commit" },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test git commit");
    });
  });

  describe("optional terms", () => {
    it("should format optional argument", () => {
      const usage: Usage = [
        {
          type: "optional",
          terms: [{ type: "argument", metavar: "FILE" }],
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test [FILE]");
    });

    it("should format optional argument with colors", () => {
      const usage: Usage = [
        {
          type: "optional",
          terms: [{ type: "argument", metavar: "FILE" }],
        },
      ];
      const result = formatUsage("test", usage, { colors: true });
      assert.equal(
        result,
        "\x1b[1mtest\x1b[0m \x1b[2m[\x1b[0m\x1b[4mFILE\x1b[0m\x1b[2m]\x1b[0m",
      );
    });

    it("should format optional option", () => {
      const usage: Usage = [
        {
          type: "optional",
          terms: [{
            type: "option",
            names: ["--verbose", "-v"],
          }],
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test [--verbose/-v]");
    });

    it("should format nested optional", () => {
      const usage: Usage = [
        {
          type: "optional",
          terms: [{
            type: "optional",
            terms: [{ type: "argument", metavar: "FILE" }],
          }],
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test [[FILE]]");
    });
  });

  describe("exclusive terms", () => {
    it("should format exclusive options", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--verbose", "-v"] }],
            [{ type: "option", names: ["--quiet", "-q"] }],
          ],
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test (--verbose/-v | --quiet/-q)");
    });

    it("should format exclusive options with colors", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--verbose", "-v"] }],
            [{ type: "option", names: ["--quiet", "-q"] }],
          ],
        },
      ];
      const result = formatUsage("test", usage, { colors: true });
      assert.equal(
        result,
        "\x1b[1mtest\x1b[0m \x1b[2m(\x1b[0m\x1b[3m--verbose\x1b[0m\x1b[2m/\x1b[0m\x1b[3m-v\x1b[0m | \x1b[3m--quiet\x1b[0m\x1b[2m/\x1b[0m\x1b[3m-q\x1b[0m\x1b[2m)\x1b[0m",
      );
    });

    it("should format exclusive arguments", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "argument", metavar: "FILE" }],
            [{ type: "argument", metavar: "DIR" }],
          ],
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test (FILE | DIR)");
    });

    it("should format mixed exclusive terms", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--file", "-f"], metavar: "PATH" }],
            [{ type: "argument", metavar: "INPUT" }],
            [{ type: "command", name: "stdin" }],
          ],
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test (--file/-f PATH | INPUT | stdin)");
    });
  });

  describe("multiple terms", () => {
    it("should format multiple with min 0", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [{ type: "argument", metavar: "FILE" }],
          min: 0,
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test [FILE...]");
    });

    it("should format multiple with min 0 and colors", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [{ type: "argument", metavar: "FILE" }],
          min: 0,
        },
      ];
      const result = formatUsage("test", usage, { colors: true });
      assert.equal(
        result,
        "\x1b[1mtest\x1b[0m \x1b[2m[\x1b[0m\x1b[4mFILE\x1b[0m\x1b[2m...\x1b[0m\x1b[2m]\x1b[0m",
      );
    });

    it("should format multiple with min 1", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [{ type: "argument", metavar: "FILE" }],
          min: 1,
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test FILE...");
    });

    it("should format multiple with min 1 and colors", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [{ type: "argument", metavar: "FILE" }],
          min: 1,
        },
      ];
      const result = formatUsage("test", usage, { colors: true });
      assert.equal(
        result,
        "\x1b[1mtest\x1b[0m \x1b[4mFILE\x1b[0m\x1b[2m...\x1b[0m",
      );
    });

    it("should format multiple with min 2", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [{ type: "argument", metavar: "FILE" }],
          min: 2,
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test FILE FILE...");
    });

    it("should format multiple with min 3", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [{
            type: "option",
            names: ["--include", "-I"],
            metavar: "PATTERN",
          }],
          min: 3,
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(
        result,
        "test --include/-I PATTERN --include/-I PATTERN --include/-I PATTERN...",
      );
    });

    it("should format multiple options", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [{ type: "option", names: ["--verbose", "-v"] }],
          min: 0,
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test [--verbose/-v...]");
    });
  });

  describe("complex usage combinations", () => {
    it("should format command with options and arguments", () => {
      const usage: Usage = [
        { type: "command", name: "cp" },
        {
          type: "optional",
          terms: [{ type: "option", names: ["--recursive", "-r"] }],
        },
        { type: "argument", metavar: "SOURCE" },
        { type: "argument", metavar: "DEST" },
      ];
      const result = formatUsage("test", usage);
      assert.equal(result, "test cp [--recursive/-r] SOURCE DEST");
    });

    it("should format git-like command", () => {
      const usage: Usage = [
        { type: "command", name: "git" },
        {
          type: "exclusive",
          terms: [
            [
              { type: "command", name: "commit" },
              {
                type: "optional",
                terms: [{
                  type: "option",
                  names: ["--message", "-m"],
                  metavar: "MSG",
                }],
              },
            ],
            [
              { type: "command", name: "add" },
              {
                type: "multiple",
                terms: [{ type: "argument", metavar: "FILE" }],
                min: 1,
              },
            ],
          ],
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(
        result,
        "test git (commit [--message/-m MSG] | add FILE...)",
      );
    });

    it("should format complex nested structure", () => {
      const usage: Usage = [
        { type: "command", name: "tool" },
        {
          type: "optional",
          terms: [{
            type: "exclusive",
            terms: [
              [{ type: "option", names: ["--verbose", "-v"] }],
              [{ type: "option", names: ["--quiet", "-q"] }],
            ],
          }],
        },
        {
          type: "multiple",
          terms: [{
            type: "optional",
            terms: [{ type: "argument", metavar: "FILE" }],
          }],
          min: 0,
        },
      ];
      const result = formatUsage("test", usage);
      assert.equal(
        result,
        "test tool [(--verbose/-v | --quiet/-q)] [[FILE]...]",
      );
    });
  });

  describe("empty usage", () => {
    it("should format empty usage", () => {
      const usage: Usage = [];
      const result = formatUsage("test", usage);
      assert.equal(result, "test ");
    });
  });

  describe("OptionName type", () => {
    it("should accept GNU-style long options", () => {
      const optionName: OptionName = "--verbose";
      assert.equal(optionName, "--verbose");
    });

    it("should accept POSIX-style short options", () => {
      const optionName: OptionName = "-v";
      assert.equal(optionName, "-v");
    });

    it("should accept Java-style options", () => {
      const optionName: OptionName = "-verbose";
      assert.equal(optionName, "-verbose");
    });

    it("should accept MS-DOS-style options", () => {
      const optionName: OptionName = "/verbose";
      assert.equal(optionName, "/verbose");
    });

    it("should accept plus-prefixed options", () => {
      const optionName: OptionName = "+verbose";
      assert.equal(optionName, "+verbose");
    });
  });

  describe("error handling", () => {
    it("should throw on unknown usage term type", () => {
      const invalidTerm = { type: "unknown" } as unknown as UsageTerm;
      const usage: Usage = [invalidTerm];

      assert.throws(
        () => formatUsage("test", usage),
        /Unknown usage term type: unknown/,
      );
    });
  });
});

describe("UsageFormatOptions", () => {
  it("should accept onlyShortestOptions option", () => {
    const options: UsageFormatOptions = { onlyShortestOptions: true };
    assert.equal(options.onlyShortestOptions, true);
  });

  it("should accept colors option", () => {
    const options: UsageFormatOptions = { colors: true };
    assert.equal(options.colors, true);
  });

  it("should accept both options", () => {
    const options: UsageFormatOptions = {
      onlyShortestOptions: true,
      colors: true,
    };
    assert.equal(options.onlyShortestOptions, true);
    assert.equal(options.colors, true);
  });

  it("should accept maxWidth option", () => {
    const options: UsageFormatOptions = { maxWidth: 80 };
    assert.equal(options.maxWidth, 80);
  });

  it("should accept all options", () => {
    const options: UsageFormatOptions = {
      onlyShortestOptions: true,
      colors: true,
      maxWidth: 80,
    };
    assert.equal(options.onlyShortestOptions, true);
    assert.equal(options.colors, true);
    assert.equal(options.maxWidth, 80);
  });

  it("should work with empty options", () => {
    const options: UsageFormatOptions = {};
    const usage: Usage = [{ type: "argument", metavar: "FILE" }];
    const result = formatUsage("test", usage, options);
    assert.equal(result, "test FILE");
  });
});

describe("maxWidth option", () => {
  it("should wrap simple terms when exceeding maxWidth", () => {
    const usage: Usage = [
      { type: "command", name: "command" },
      { type: "option", names: ["--verbose", "-v"] },
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("test", usage, { maxWidth: 10 });
    assert.equal(result, "test \ncommand \n--verbose/\n-v FILE");
  });

  it("should not wrap when content fits within maxWidth", () => {
    const usage: Usage = [
      { type: "command", name: "cmd" },
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("test", usage, { maxWidth: 20 });
    assert.equal(result, "test cmd FILE");
  });

  it("should wrap at exact maxWidth boundary", () => {
    const usage: Usage = [
      { type: "command", name: "command" },
      { type: "argument", metavar: "FILE" },
    ];
    // "test command FILE" is 17 characters
    const result = formatUsage("test", usage, { maxWidth: 20 });
    assert.equal(result, "test command FILE");

    // Force wrap at 12 characters (test command = 12 chars exactly)
    const resultWrapped = formatUsage("test", usage, { maxWidth: 12 });
    assert.equal(resultWrapped, "test command\nFILE");
  });

  it("should handle very small maxWidth", () => {
    const usage: Usage = [
      { type: "command", name: "cmd" },
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("test", usage, { maxWidth: 1 });
    assert.equal(result, "test \ncmd\n\nFILE");
  });

  it("should wrap multiple terms correctly", () => {
    const usage: Usage = [
      { type: "command", name: "tool" },
      { type: "option", names: ["--output", "-o"], metavar: "PATH" },
      { type: "option", names: ["--verbose", "-v"] },
      { type: "argument", metavar: "INPUT" },
    ];
    const result = formatUsage("test", usage, { maxWidth: 15 });
    assert.equal(result, "test tool \n--output/-o \nPATH --verbose/\n-v INPUT");
  });

  it("should wrap optional terms", () => {
    const usage: Usage = [
      { type: "command", name: "cmd" },
      {
        type: "optional",
        terms: [
          { type: "option", names: ["--verbose", "-v"] },
          { type: "argument", metavar: "FILE" },
        ],
      },
    ];
    const result = formatUsage("test", usage, { maxWidth: 10 });
    assert.equal(result, "test cmd [\n--verbose/\n-v FILE]");
  });

  it("should wrap exclusive terms", () => {
    const usage: Usage = [
      { type: "command", name: "tool" },
      {
        type: "exclusive",
        terms: [
          [{ type: "option", names: ["--verbose", "-v"] }],
          [{ type: "option", names: ["--quiet", "-q"] }],
          [{ type: "argument", metavar: "CONFIG" }],
        ],
      },
    ];
    const result = formatUsage("test", usage, { maxWidth: 15 });
    assert.equal(
      result,
      "test tool (\n--verbose/-v | \n--quiet/-q | \nCONFIG)",
    );
  });

  it("should wrap multiple terms with nested structure", () => {
    const usage: Usage = [
      { type: "command", name: "git" },
      {
        type: "exclusive",
        terms: [
          [
            { type: "command", name: "commit" },
            {
              type: "optional",
              terms: [{
                type: "option",
                names: ["--message", "-m"],
                metavar: "MSG",
              }],
            },
          ],
          [
            { type: "command", name: "add" },
            {
              type: "multiple",
              terms: [{ type: "argument", metavar: "FILE" }],
              min: 1,
            },
          ],
        ],
      },
    ];
    const result = formatUsage("test", usage, { maxWidth: 20 });
    assert.equal(
      result,
      "test git (commit [\n--message/-m MSG] | \nadd FILE...)",
    );
  });

  it("should wrap multiple occurrence terms", () => {
    const usage: Usage = [
      { type: "command", name: "tool" },
      {
        type: "multiple",
        terms: [{
          type: "option",
          names: ["--include", "-I"],
          metavar: "PATTERN",
        }],
        min: 2,
      },
    ];
    const result = formatUsage("test", usage, { maxWidth: 20 });
    assert.equal(
      result,
      "test tool --include/\n-I PATTERN --include\n/-I PATTERN...",
    );
  });

  it("should handle empty usage with maxWidth", () => {
    const usage: Usage = [];
    const result = formatUsage("test", usage, { maxWidth: 10 });
    assert.equal(result, "test ");
  });

  it("should handle single character terms with maxWidth", () => {
    const usage: Usage = [
      { type: "command", name: "a" },
      { type: "command", name: "b" },
      { type: "command", name: "c" },
    ];
    const result = formatUsage("test", usage, { maxWidth: 3 });
    assert.equal(result, "test \na b\nc");
  });

  it("should handle maxWidth of 0", () => {
    const usage: Usage = [
      { type: "command", name: "cmd" },
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("test", usage, { maxWidth: 0 });
    assert.equal(result, "test \ncmd\n\nFILE");
  });

  it("should handle very long single term that exceeds maxWidth", () => {
    const usage: Usage = [
      {
        type: "option",
        names: ["--very-very-long-option-name"],
        metavar: "VERY_LONG_METAVAR",
      },
    ];
    const result = formatUsage("test", usage, { maxWidth: 10 });
    // Single term should not be broken, just placed on its own line
    assert.equal(
      result,
      "test \n--very-very-long-option-name\n\nVERY_LONG_METAVAR",
    );
  });

  it("should not wrap when undefined maxWidth", () => {
    const usage: Usage = [
      { type: "command", name: "command" },
      { type: "option", names: ["--verbose", "-v"] },
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("test", usage, { maxWidth: undefined });
    assert.equal(result, "test command --verbose/-v FILE");
  });

  it("should combine maxWidth with colors option", () => {
    const usage: Usage = [
      { type: "command", name: "cmd" },
      { type: "option", names: ["--verbose", "-v"] },
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("test", usage, { maxWidth: 10, colors: true });
    assert.equal(
      result,
      "\x1b[1mtest\x1b[0m \x1b[1mcmd\x1b[0m \n\x1b[3m--verbose\x1b[0m\x1b[2m/\x1b[0m\n\x1b[3m-v\x1b[0m \x1b[4mFILE\x1b[0m",
    );
  });

  it("should combine maxWidth with onlyShortestOptions", () => {
    const usage: Usage = [
      { type: "command", name: "command" },
      { type: "option", names: ["--verbose", "-v"] },
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("test", usage, {
      maxWidth: 10,
      onlyShortestOptions: true,
    });
    assert.equal(result, "test \ncommand -v\nFILE");
  });

  it("should combine maxWidth with both colors and onlyShortestOptions", () => {
    const usage: Usage = [
      { type: "command", name: "cmd" },
      { type: "option", names: ["--verbose", "-v"] },
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("test", usage, {
      maxWidth: 8,
      colors: true,
      onlyShortestOptions: true,
    });
    assert.equal(
      result,
      "\x1b[1mtest\x1b[0m \x1b[1mcmd\x1b[0m\n\x1b[3m-v\x1b[0m \x1b[4mFILE\x1b[0m",
    );
  });

  it("should wrap option with metavar when combined with other options", () => {
    const usage: Usage = [
      { type: "command", name: "tool" },
      {
        type: "option",
        names: ["--output", "-o"],
        metavar: "PATH",
      },
    ];
    const result = formatUsage("test", usage, {
      maxWidth: 12,
      colors: true,
      onlyShortestOptions: true,
    });
    assert.equal(
      result,
      "\x1b[1mtest\x1b[0m \x1b[1mtool\x1b[0m \x1b[3m-o\x1b[0m",
    );
  });
});

describe("programName parameter", () => {
  it("should include program name in output", () => {
    const usage: Usage = [
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("myapp", usage);
    assert.equal(result, "myapp FILE");
  });

  it("should work with different program names", () => {
    const usage: Usage = [
      { type: "option", names: ["--verbose", "-v"] },
    ];
    const result1 = formatUsage("tool1", usage);
    const result2 = formatUsage("another-tool", usage);

    assert.equal(result1, "tool1 --verbose/-v");
    assert.equal(result2, "another-tool --verbose/-v");
  });

  it("should handle empty program name", () => {
    const usage: Usage = [
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("", usage);
    assert.equal(result, " FILE");
  });

  it("should handle program name with spaces", () => {
    const usage: Usage = [
      { type: "argument", metavar: "FILE" },
    ];
    const result = formatUsage("my program", usage);
    assert.equal(result, "my program FILE");
  });
});

describe("expandCommands option", () => {
  it("should expand commands when expandCommands is true", () => {
    const usage: Usage = [
      { type: "command", name: "git" },
      {
        type: "exclusive",
        terms: [
          [{ type: "command", name: "add" }, {
            type: "argument",
            metavar: "FILE",
          }],
          [{ type: "command", name: "commit" }, {
            type: "option",
            names: ["--message", "-m"],
          }],
        ],
      },
    ];
    const result = formatUsage("test", usage, { expandCommands: true });
    const lines = result.split("\n");

    assert.equal(lines.length, 2);
    assert.equal(lines[0], "test git add FILE");
    assert.equal(lines[1], "test git commit --message/-m");
  });

  it("should not expand when expandCommands is false", () => {
    const usage: Usage = [
      { type: "command", name: "git" },
      {
        type: "exclusive",
        terms: [
          [{ type: "command", name: "add" }, {
            type: "argument",
            metavar: "FILE",
          }],
          [{ type: "command", name: "commit" }, {
            type: "option",
            names: ["--message", "-m"],
          }],
        ],
      },
    ];
    const result = formatUsage("test", usage, { expandCommands: false });

    assert.equal(result, "test git (add FILE | commit --message/-m)");
  });

  it("should not expand when expandCommands is undefined", () => {
    const usage: Usage = [
      { type: "command", name: "git" },
      {
        type: "exclusive",
        terms: [
          [{ type: "command", name: "add" }, {
            type: "argument",
            metavar: "FILE",
          }],
          [{ type: "command", name: "commit" }, {
            type: "option",
            names: ["--message", "-m"],
          }],
        ],
      },
    ];
    const result = formatUsage("test", usage);

    assert.equal(result, "test git (add FILE | commit --message/-m)");
  });

  it("should work with expandCommands and colors", () => {
    const usage: Usage = [
      { type: "command", name: "tool" },
      {
        type: "exclusive",
        terms: [
          [{ type: "command", name: "start" }],
          [{ type: "command", name: "stop" }],
        ],
      },
    ];
    const result = formatUsage("test", usage, {
      expandCommands: true,
      colors: true,
    });
    const lines = result.split("\n");

    assert.equal(lines.length, 2);
    assert.equal(
      lines[0],
      "\x1b[1mtest\x1b[0m \x1b[1mtool\x1b[0m \x1b[1mstart\x1b[0m",
    );
    assert.equal(
      lines[1],
      "\x1b[1mtest\x1b[0m \x1b[1mtool\x1b[0m \x1b[1mstop\x1b[0m",
    );
  });
});
