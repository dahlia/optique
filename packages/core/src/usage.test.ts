import {
  extractArgumentMetavars,
  extractCommandNames,
  extractOptionNames,
  formatUsage,
  formatUsageTerm,
  normalizeUsage,
  type OptionName,
  type Usage,
  type UsageFormatOptions,
  type UsageTerm,
  type UsageTermFormatOptions,
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

describe("formatUsageTerm", () => {
  describe("argument terms", () => {
    it("should format a simple argument term", () => {
      const term: UsageTerm = { type: "argument", metavar: "FILE" };
      const result = formatUsageTerm(term);
      assert.equal(result, "FILE");
    });

    it("should format argument term with colors", () => {
      const term: UsageTerm = { type: "argument", metavar: "FILE" };
      const result = formatUsageTerm(term, { colors: true });
      assert.equal(result, "\x1b[4mFILE\x1b[0m");
    });

    it("should format argument term with long metavar", () => {
      const term: UsageTerm = {
        type: "argument",
        metavar: "VERY_LONG_INPUT_FILE",
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "VERY_LONG_INPUT_FILE");
    });
  });

  describe("option terms", () => {
    it("should format option term with single name", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose"],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "--verbose");
    });

    it("should format option term with multiple names", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v"],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "--verbose/-v");
    });

    it("should format option term with custom options separator", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v"],
      };
      const result = formatUsageTerm(term, { optionsSeparator: "|" });
      assert.equal(result, "--verbose|-v");
    });

    it("should format option term with three names", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v", "-V"],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "--verbose/-v/-V");
    });

    it("should format option term with metavar", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--output", "-o"],
        metavar: "FILE",
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "--output/-o FILE");
    });

    it("should format option term with colors", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v"],
      };
      const result = formatUsageTerm(term, { colors: true });
      assert.equal(
        result,
        "\x1b[3m--verbose\x1b[0m\x1b[2m/\x1b[0m\x1b[3m-v\x1b[0m",
      );
    });

    it("should format option term with colors and custom separator", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v"],
      };
      const result = formatUsageTerm(term, {
        colors: true,
        optionsSeparator: "|",
      });
      assert.equal(
        result,
        "\x1b[3m--verbose\x1b[0m\x1b[2m|\x1b[0m\x1b[3m-v\x1b[0m",
      );
    });

    it("should format option term with metavar and colors", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--output", "-o"],
        metavar: "FILE",
      };
      const result = formatUsageTerm(term, { colors: true });
      assert.equal(
        result,
        "\x1b[3m--output\x1b[0m\x1b[2m/\x1b[0m\x1b[3m-o\x1b[0m \x1b[4m\x1b[2mFILE\x1b[0m",
      );
    });

    it("should format option term with onlyShortestOptions", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v"],
      };
      const result = formatUsageTerm(term, { onlyShortestOptions: true });
      assert.equal(result, "-v");
    });

    it("should format option term with onlyShortestOptions and colors", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v"],
      };
      const result = formatUsageTerm(term, {
        onlyShortestOptions: true,
        colors: true,
      });
      assert.equal(result, "\x1b[3m-v\x1b[0m");
    });

    it("should pick shortest name when onlyShortestOptions is true", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--very-long-option", "-s", "--short"],
      };
      const result = formatUsageTerm(term, { onlyShortestOptions: true });
      assert.equal(result, "-s");
    });

    it("should handle equal length names when onlyShortestOptions is true", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--first", "--other"],
      };
      const result = formatUsageTerm(term, { onlyShortestOptions: true });
      assert.equal(result, "--first"); // First one wins on ties
    });
  });

  describe("command terms", () => {
    it("should format a command term", () => {
      const term: UsageTerm = { type: "command", name: "init" };
      const result = formatUsageTerm(term);
      assert.equal(result, "init");
    });

    it("should format command term with colors", () => {
      const term: UsageTerm = { type: "command", name: "init" };
      const result = formatUsageTerm(term, { colors: true });
      assert.equal(result, "\x1b[1minit\x1b[0m");
    });

    it("should format command term with hyphenated name", () => {
      const term: UsageTerm = { type: "command", name: "some-command" };
      const result = formatUsageTerm(term);
      assert.equal(result, "some-command");
    });
  });

  describe("optional terms", () => {
    it("should format optional argument", () => {
      const term: UsageTerm = {
        type: "optional",
        terms: [{ type: "argument", metavar: "FILE" }],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "[FILE]");
    });

    it("should format optional option", () => {
      const term: UsageTerm = {
        type: "optional",
        terms: [{ type: "option", names: ["--verbose", "-v"] }],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "[--verbose/-v]");
    });

    it("should format optional with multiple terms", () => {
      const term: UsageTerm = {
        type: "optional",
        terms: [
          { type: "option", names: ["--output", "-o"], metavar: "FILE" },
          { type: "argument", metavar: "INPUT" },
        ],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "[--output/-o FILE INPUT]");
    });

    it("should format optional with colors", () => {
      const term: UsageTerm = {
        type: "optional",
        terms: [{ type: "argument", metavar: "FILE" }],
      };
      const result = formatUsageTerm(term, { colors: true });
      assert.equal(result, "\x1b[2m[\x1b[0m\x1b[4mFILE\x1b[0m\x1b[2m]\x1b[0m");
    });

    it("should format nested optional", () => {
      const term: UsageTerm = {
        type: "optional",
        terms: [{
          type: "optional",
          terms: [{ type: "argument", metavar: "FILE" }],
        }],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "[[FILE]]");
    });
  });

  describe("exclusive terms", () => {
    it("should format exclusive with two options", () => {
      const term: UsageTerm = {
        type: "exclusive",
        terms: [
          [{ type: "option", names: ["--verbose", "-v"] }],
          [{ type: "option", names: ["--quiet", "-q"] }],
        ],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "(--verbose/-v | --quiet/-q)");
    });

    it("should format exclusive with three options", () => {
      const term: UsageTerm = {
        type: "exclusive",
        terms: [
          [{ type: "option", names: ["--verbose", "-v"] }],
          [{ type: "option", names: ["--quiet", "-q"] }],
          [{ type: "option", names: ["--debug", "-d"] }],
        ],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "(--verbose/-v | --quiet/-q | --debug/-d)");
    });

    it("should format exclusive with mixed term types", () => {
      const term: UsageTerm = {
        type: "exclusive",
        terms: [
          [{ type: "option", names: ["--file", "-f"], metavar: "PATH" }],
          [{ type: "argument", metavar: "INPUT" }],
          [{ type: "command", name: "stdin" }],
        ],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "(--file/-f PATH | INPUT | stdin)");
    });

    it("should format exclusive with colors", () => {
      const term: UsageTerm = {
        type: "exclusive",
        terms: [
          [{ type: "option", names: ["--verbose", "-v"] }],
          [{ type: "option", names: ["--quiet", "-q"] }],
        ],
      };
      const result = formatUsageTerm(term, { colors: true });
      assert.equal(
        result,
        "\x1b[2m(\x1b[0m\x1b[3m--verbose\x1b[0m\x1b[2m/\x1b[0m\x1b[3m-v\x1b[0m | \x1b[3m--quiet\x1b[0m\x1b[2m/\x1b[0m\x1b[3m-q\x1b[0m\x1b[2m)\x1b[0m",
      );
    });

    it("should format exclusive with multiple terms per branch", () => {
      const term: UsageTerm = {
        type: "exclusive",
        terms: [
          [
            { type: "command", name: "add" },
            { type: "argument", metavar: "FILE" },
          ],
          [
            { type: "command", name: "remove" },
            { type: "argument", metavar: "FILE" },
          ],
        ],
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "(add FILE | remove FILE)");
    });
  });

  describe("multiple terms", () => {
    it("should format multiple with min 0", () => {
      const term: UsageTerm = {
        type: "multiple",
        terms: [{ type: "argument", metavar: "FILE" }],
        min: 0,
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "[FILE...]");
    });

    it("should format multiple with min 1", () => {
      const term: UsageTerm = {
        type: "multiple",
        terms: [{ type: "argument", metavar: "FILE" }],
        min: 1,
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "FILE...");
    });

    it("should format multiple with min 2", () => {
      const term: UsageTerm = {
        type: "multiple",
        terms: [{ type: "argument", metavar: "FILE" }],
        min: 2,
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "FILE FILE...");
    });

    it("should format multiple with min 3", () => {
      const term: UsageTerm = {
        type: "multiple",
        terms: [{
          type: "option",
          names: ["--include", "-I"],
          metavar: "PATTERN",
        }],
        min: 3,
      };
      const result = formatUsageTerm(term);
      assert.equal(
        result,
        "--include/-I PATTERN --include/-I PATTERN --include/-I PATTERN...",
      );
    });

    it("should format multiple with colors and min 0", () => {
      const term: UsageTerm = {
        type: "multiple",
        terms: [{ type: "argument", metavar: "FILE" }],
        min: 0,
      };
      const result = formatUsageTerm(term, { colors: true });
      assert.equal(
        result,
        "\x1b[2m[\x1b[0m\x1b[4mFILE\x1b[0m\x1b[2m...\x1b[0m\x1b[2m]\x1b[0m",
      );
    });

    it("should format multiple with colors and min 1", () => {
      const term: UsageTerm = {
        type: "multiple",
        terms: [{ type: "argument", metavar: "FILE" }],
        min: 1,
      };
      const result = formatUsageTerm(term, { colors: true });
      assert.equal(result, "\x1b[4mFILE\x1b[0m\x1b[2m...\x1b[0m");
    });

    it("should format multiple options", () => {
      const term: UsageTerm = {
        type: "multiple",
        terms: [{ type: "option", names: ["--verbose", "-v"] }],
        min: 0,
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "[--verbose/-v...]");
    });

    it("should format multiple with complex terms", () => {
      const term: UsageTerm = {
        type: "multiple",
        terms: [
          { type: "option", names: ["--include", "-I"], metavar: "PATH" },
          { type: "argument", metavar: "FILE" },
        ],
        min: 1,
      };
      const result = formatUsageTerm(term);
      assert.equal(result, "--include/-I PATH FILE...");
    });
  });

  describe("maxWidth option", () => {
    it("should wrap argument term when exceeding maxWidth", () => {
      const term: UsageTerm = {
        type: "argument",
        metavar: "VERY_LONG_FILENAME",
      };
      const result = formatUsageTerm(term, { maxWidth: 10 });
      assert.equal(result, "\nVERY_LONG_FILENAME");
    });

    it("should wrap option term when exceeding maxWidth", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--very-long-option", "-v"],
        metavar: "LONG_VALUE",
      };
      const result = formatUsageTerm(term, { maxWidth: 15 });
      assert.equal(result, "\n--very-long-option\n/-v LONG_VALUE");
    });

    it("should wrap optional term when exceeding maxWidth", () => {
      const term: UsageTerm = {
        type: "optional",
        terms: [
          { type: "option", names: ["--verbose", "-v"] },
          { type: "argument", metavar: "FILE" },
        ],
      };
      const result = formatUsageTerm(term, { maxWidth: 10 });
      assert.equal(result, "[--verbose\n/-v FILE]");
    });

    it("should wrap exclusive term when exceeding maxWidth", () => {
      const term: UsageTerm = {
        type: "exclusive",
        terms: [
          [{ type: "option", names: ["--verbose", "-v"] }],
          [{ type: "option", names: ["--quiet", "-q"] }],
          [{ type: "argument", metavar: "CONFIG" }],
        ],
      };
      const result = formatUsageTerm(term, { maxWidth: 15 });
      assert.equal(result, "(--verbose/-v |\n--quiet/-q | \nCONFIG)");
    });

    it("should wrap multiple term when exceeding maxWidth", () => {
      const term: UsageTerm = {
        type: "multiple",
        terms: [{
          type: "option",
          names: ["--include", "-I"],
          metavar: "PATTERN",
        }],
        min: 2,
      };
      const result = formatUsageTerm(term, { maxWidth: 20 });
      assert.equal(result, "--include/-I PATTERN\n--include/-I PATTERN\n...");
    });

    it("should not wrap when content fits within maxWidth", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v"],
      };
      const result = formatUsageTerm(term, { maxWidth: 20 });
      assert.equal(result, "--verbose/-v");
    });

    it("should handle maxWidth of 0", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v"],
      };
      const result = formatUsageTerm(term, { maxWidth: 0 });
      assert.equal(result, "\n--verbose\n/\n-v");
    });
  });

  describe("option combinations", () => {
    it("should combine colors with custom options separator", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v", "-V"],
      };
      const result = formatUsageTerm(term, {
        colors: true,
        optionsSeparator: " | ",
      });
      assert.equal(
        result,
        "\x1b[3m--verbose\x1b[0m\x1b[2m | \x1b[0m\x1b[3m-v\x1b[0m\x1b[2m | \x1b[0m\x1b[3m-V\x1b[0m",
      );
    });

    it("should combine onlyShortestOptions with colors", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--very-long-option", "-s"],
      };
      const result = formatUsageTerm(term, {
        onlyShortestOptions: true,
        colors: true,
      });
      assert.equal(result, "\x1b[3m-s\x1b[0m");
    });

    it("should combine maxWidth with colors", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--verbose", "-v"],
        metavar: "LEVEL",
      };
      const result = formatUsageTerm(term, {
        maxWidth: 10,
        colors: true,
      });
      assert.equal(
        result,
        "\x1b[3m--verbose\x1b[0m\x1b[2m/\x1b[0m\n\x1b[3m-v\x1b[0m \x1b[4m\x1b[2mLEVEL\x1b[0m",
      );
    });

    it("should combine all options together", () => {
      const term: UsageTerm = {
        type: "option",
        names: ["--very-long-verbose-option", "-v"],
      };
      const result = formatUsageTerm(term, {
        onlyShortestOptions: true,
        colors: true,
        maxWidth: 20,
        optionsSeparator: " or ",
      });
      assert.equal(result, "\x1b[3m-v\x1b[0m");
    });
  });

  describe("empty options", () => {
    it("should work with empty options object", () => {
      const term: UsageTerm = { type: "argument", metavar: "FILE" };
      const result = formatUsageTerm(term, {});
      assert.equal(result, "FILE");
    });

    it("should work with no options parameter", () => {
      const term: UsageTerm = { type: "command", name: "init" };
      const result = formatUsageTerm(term);
      assert.equal(result, "init");
    });
  });

  describe("error handling", () => {
    it("should throw on unknown usage term type", () => {
      const invalidTerm = { type: "unknown" } as unknown as UsageTerm;

      assert.throws(
        () => formatUsageTerm(invalidTerm),
        /Unknown usage term type: unknown/,
      );
    });
  });

  describe("UsageTermFormatOptions interface", () => {
    it("should accept all UsageFormatOptions", () => {
      const options: UsageTermFormatOptions = {
        onlyShortestOptions: true,
        colors: true,
        maxWidth: 80,
      };
      assert.equal(options.onlyShortestOptions, true);
      assert.equal(options.colors, true);
      assert.equal(options.maxWidth, 80);
    });

    it("should accept optionsSeparator option", () => {
      const options: UsageTermFormatOptions = {
        optionsSeparator: " | ",
      };
      assert.equal(options.optionsSeparator, " | ");
    });

    it("should accept all options together", () => {
      const options: UsageTermFormatOptions = {
        onlyShortestOptions: true,
        colors: true,
        maxWidth: 80,
        optionsSeparator: " | ",
      };
      assert.equal(options.onlyShortestOptions, true);
      assert.equal(options.colors, true);
      assert.equal(options.maxWidth, 80);
      assert.equal(options.optionsSeparator, " | ");
    });
  });
});

describe("normalizeUsage", () => {
  describe("basic term types", () => {
    it("should not modify argument terms", () => {
      const usage: Usage = [
        { type: "argument", metavar: "FILE" },
      ];
      const result = normalizeUsage(usage);
      assert.deepEqual(result, usage);
    });

    it("should not modify option terms", () => {
      const usage: Usage = [
        { type: "option", names: ["--verbose", "-v"] },
      ];
      const result = normalizeUsage(usage);
      assert.deepEqual(result, usage);
    });

    it("should not modify command terms", () => {
      const usage: Usage = [
        { type: "command", name: "init" },
      ];
      const result = normalizeUsage(usage);
      assert.deepEqual(result, usage);
    });
  });

  describe("optional terms", () => {
    it("should normalize nested optional terms", () => {
      const usage: Usage = [
        {
          type: "optional",
          terms: [
            {
              type: "optional",
              terms: [{ type: "argument", metavar: "FILE" }],
            },
          ],
        },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        {
          type: "optional",
          terms: [
            {
              type: "optional",
              terms: [{ type: "argument", metavar: "FILE" }],
            },
          ],
        },
      ];
      assert.deepEqual(result, expected);
    });

    it("should normalize optional terms with exclusive children", () => {
      const usage: Usage = [
        {
          type: "optional",
          terms: [
            {
              type: "exclusive",
              terms: [
                [{ type: "option", names: ["--verbose", "-v"] }],
                [{ type: "option", names: ["--quiet", "-q"] }],
              ],
            },
          ],
        },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        {
          type: "optional",
          terms: [
            {
              type: "exclusive",
              terms: [
                [{ type: "option", names: ["--verbose", "-v"] }],
                [{ type: "option", names: ["--quiet", "-q"] }],
              ],
            },
          ],
        },
      ];
      assert.deepEqual(result, expected);
    });
  });

  describe("multiple terms", () => {
    it("should normalize multiple terms with nested structure", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [
            {
              type: "optional",
              terms: [{ type: "argument", metavar: "FILE" }],
            },
          ],
          min: 0,
        },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        {
          type: "multiple",
          terms: [
            {
              type: "optional",
              terms: [{ type: "argument", metavar: "FILE" }],
            },
          ],
          min: 0,
        },
      ];
      assert.deepEqual(result, expected);
    });

    it("should preserve min value in multiple terms", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [{ type: "argument", metavar: "FILE" }],
          min: 2,
        },
      ];
      const result = normalizeUsage(usage);
      assert.deepEqual(result, usage);
    });
  });

  describe("exclusive terms flattening", () => {
    it("should flatten nested exclusive terms", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--verbose", "-v"] }],
            [{
              type: "exclusive",
              terms: [
                [{ type: "option", names: ["--quiet", "-q"] }],
                [{ type: "option", names: ["--debug", "-d"] }],
              ],
            }],
          ],
        },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--verbose", "-v"] }],
            [{ type: "option", names: ["--quiet", "-q"] }],
            [{ type: "option", names: ["--debug", "-d"] }],
          ],
        },
      ];
      assert.deepEqual(result, expected);
    });

    it("should flatten multiple levels of nested exclusive terms", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--first", "-f"] }],
            [{
              type: "exclusive",
              terms: [
                [{ type: "option", names: ["--second", "-s"] }],
                [{
                  type: "exclusive",
                  terms: [
                    [{ type: "option", names: ["--third", "-t"] }],
                    [{ type: "option", names: ["--fourth", "-4"] }],
                  ],
                }],
              ],
            }],
          ],
        },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--first", "-f"] }],
            [{ type: "option", names: ["--second", "-s"] }],
            [{ type: "option", names: ["--third", "-t"] }],
            [{ type: "option", names: ["--fourth", "-4"] }],
          ],
        },
      ];
      assert.deepEqual(result, expected);
    });

    it("should not flatten exclusive terms that are not direct children", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [
            [
              { type: "command", name: "add" },
              {
                type: "exclusive",
                terms: [
                  [{ type: "option", names: ["--force", "-f"] }],
                  [{ type: "option", names: ["--interactive", "-i"] }],
                ],
              },
            ],
            [{ type: "command", name: "remove" }],
          ],
        },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        {
          type: "exclusive",
          terms: [
            [
              { type: "command", name: "add" },
              {
                type: "exclusive",
                terms: [
                  [{ type: "option", names: ["--force", "-f"] }],
                  [{ type: "option", names: ["--interactive", "-i"] }],
                ],
              },
            ],
            [{ type: "command", name: "remove" }],
          ],
        },
      ];
      assert.deepEqual(result, expected);
    });

    it("should handle exclusive terms with mixed content types", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--file", "-f"], metavar: "PATH" }],
            [{
              type: "exclusive",
              terms: [
                [{ type: "argument", metavar: "INPUT" }],
                [{ type: "command", name: "stdin" }],
              ],
            }],
          ],
        },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--file", "-f"], metavar: "PATH" }],
            [{ type: "argument", metavar: "INPUT" }],
            [{ type: "command", name: "stdin" }],
          ],
        },
      ];
      assert.deepEqual(result, expected);
    });
  });

  describe("complex nested structures", () => {
    it("should normalize deeply nested structure with all term types", () => {
      const usage: Usage = [
        { type: "command", name: "tool" },
        {
          type: "optional",
          terms: [
            {
              type: "multiple",
              terms: [
                {
                  type: "exclusive",
                  terms: [
                    [{ type: "option", names: ["--verbose", "-v"] }],
                    [{
                      type: "exclusive",
                      terms: [
                        [{ type: "option", names: ["--quiet", "-q"] }],
                        [{ type: "option", names: ["--debug", "-d"] }],
                      ],
                    }],
                  ],
                },
              ],
              min: 1,
            },
          ],
        },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        { type: "command", name: "tool" },
        {
          type: "optional",
          terms: [
            {
              type: "multiple",
              terms: [
                {
                  type: "exclusive",
                  terms: [
                    [{ type: "option", names: ["--verbose", "-v"] }],
                    [{ type: "option", names: ["--quiet", "-q"] }],
                    [{ type: "option", names: ["--debug", "-d"] }],
                  ],
                },
              ],
              min: 1,
            },
          ],
        },
      ];
      assert.deepEqual(result, expected);
    });

    it("should handle multiple exclusive flattening in different parts", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--option1", "-1"] }],
            [{
              type: "exclusive",
              terms: [
                [{ type: "option", names: ["--option2", "-2"] }],
                [{ type: "option", names: ["--option3", "-3"] }],
              ],
            }],
          ],
        },
        { type: "argument", metavar: "FILE" },
        {
          type: "optional",
          terms: [
            {
              type: "exclusive",
              terms: [
                [{ type: "command", name: "start" }],
                [{
                  type: "exclusive",
                  terms: [
                    [{ type: "command", name: "stop" }],
                    [{ type: "command", name: "restart" }],
                  ],
                }],
              ],
            },
          ],
        },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--option1", "-1"] }],
            [{ type: "option", names: ["--option2", "-2"] }],
            [{ type: "option", names: ["--option3", "-3"] }],
          ],
        },
        {
          type: "optional",
          terms: [
            {
              type: "exclusive",
              terms: [
                [{ type: "command", name: "start" }],
                [{ type: "command", name: "stop" }],
                [{ type: "command", name: "restart" }],
              ],
            },
          ],
        },
        { type: "argument", metavar: "FILE" },
      ];
      assert.deepEqual(result, expected);
    });
  });

  describe("empty and edge cases", () => {
    it("should handle empty usage", () => {
      const usage: Usage = [];
      const result = normalizeUsage(usage);
      assert.deepEqual(result, []);
    });

    it("should handle exclusive with single term", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--verbose", "-v"] }],
          ],
        },
      ];
      const result = normalizeUsage(usage);
      assert.deepEqual(result, usage);
    });

    it("should handle exclusive with empty terms array", () => {
      const usage: Usage = [
        {
          type: "exclusive",
          terms: [],
        },
      ];
      const result = normalizeUsage(usage);
      assert.deepEqual(result, usage);
    });

    it("should handle optional with empty terms", () => {
      const usage: Usage = [
        {
          type: "optional",
          terms: [],
        },
      ];
      const result = normalizeUsage(usage);
      assert.deepEqual(result, usage);
    });

    it("should handle multiple with empty terms", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [],
          min: 0,
        },
      ];
      const result = normalizeUsage(usage);
      assert.deepEqual(result, usage);
    });
  });

  describe("immutability", () => {
    it("should not modify the original usage object", () => {
      const original: Usage = [
        {
          type: "exclusive",
          terms: [
            [{ type: "option", names: ["--verbose", "-v"] }],
            [{
              type: "exclusive",
              terms: [
                [{ type: "option", names: ["--quiet", "-q"] }],
                [{ type: "option", names: ["--debug", "-d"] }],
              ],
            }],
          ],
        },
      ];
      const originalCopy = JSON.parse(JSON.stringify(original));

      normalizeUsage(original);

      assert.deepEqual(original, originalCopy);
    });
  });

  describe("sorting behavior", () => {
    it("should place commands first", () => {
      const usage: Usage = [
        { type: "argument", metavar: "FILE" },
        { type: "option", names: ["--verbose", "-v"] },
        { type: "command", name: "start" },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        { type: "command", name: "start" },
        { type: "option", names: ["--verbose", "-v"] },
        { type: "argument", metavar: "FILE" },
      ];
      assert.deepEqual(result, expected);
    });

    it("should place arguments last", () => {
      const usage: Usage = [
        { type: "argument", metavar: "INPUT" },
        { type: "option", names: ["--quiet", "-q"] },
        { type: "argument", metavar: "OUTPUT" },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        { type: "option", names: ["--quiet", "-q"] },
        { type: "argument", metavar: "INPUT" },
        { type: "argument", metavar: "OUTPUT" },
      ];
      assert.deepEqual(result, expected);
    });

    it("should treat optional arguments as arguments for sorting", () => {
      const usage: Usage = [
        {
          type: "optional",
          terms: [{ type: "argument", metavar: "FILE" }],
        },
        { type: "option", names: ["--verbose", "-v"] },
        { type: "command", name: "init" },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        { type: "command", name: "init" },
        { type: "option", names: ["--verbose", "-v"] },
        {
          type: "optional",
          terms: [{ type: "argument", metavar: "FILE" }],
        },
      ];
      assert.deepEqual(result, expected);
    });

    it("should treat multiple arguments as arguments for sorting", () => {
      const usage: Usage = [
        {
          type: "multiple",
          terms: [{ type: "argument", metavar: "FILES" }],
          min: 1,
        },
        { type: "option", names: ["--recursive", "-r"] },
        { type: "command", name: "copy" },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        { type: "command", name: "copy" },
        { type: "option", names: ["--recursive", "-r"] },
        {
          type: "multiple",
          terms: [{ type: "argument", metavar: "FILES" }],
          min: 1,
        },
      ];
      assert.deepEqual(result, expected);
    });

    it("should handle mixed optional/multiple that don't end with arguments", () => {
      const usage: Usage = [
        {
          type: "optional",
          terms: [{ type: "option", names: ["--force", "-f"] }],
        },
        { type: "argument", metavar: "FILE" },
        {
          type: "multiple",
          terms: [{
            type: "option",
            names: ["--include", "-I"],
            metavar: "PATTERN",
          }],
          min: 0,
        },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        {
          type: "optional",
          terms: [{ type: "option", names: ["--force", "-f"] }],
        },
        {
          type: "multiple",
          terms: [{
            type: "option",
            names: ["--include", "-I"],
            metavar: "PATTERN",
          }],
          min: 0,
        },
        { type: "argument", metavar: "FILE" },
      ];
      assert.deepEqual(result, expected);
    });

    it("should sort commands, options, and arguments correctly", () => {
      const usage: Usage = [
        { type: "argument", metavar: "SOURCE" },
        { type: "option", names: ["--dry-run", "-n"] },
        { type: "command", name: "move" },
        { type: "argument", metavar: "DEST" },
        { type: "option", names: ["--verbose", "-v"] },
        { type: "command", name: "copy" },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        { type: "command", name: "move" },
        { type: "command", name: "copy" },
        { type: "option", names: ["--dry-run", "-n"] },
        { type: "option", names: ["--verbose", "-v"] },
        { type: "argument", metavar: "SOURCE" },
        { type: "argument", metavar: "DEST" },
      ];
      assert.deepEqual(result, expected);
    });

    it("should preserve order within same category", () => {
      const usage: Usage = [
        { type: "command", name: "second" },
        { type: "command", name: "first" },
        { type: "option", names: ["--beta", "-b"] },
        { type: "option", names: ["--alpha", "-a"] },
      ];
      const result = normalizeUsage(usage);
      const expected: Usage = [
        { type: "command", name: "second" },
        { type: "command", name: "first" },
        { type: "option", names: ["--beta", "-b"] },
        { type: "option", names: ["--alpha", "-a"] },
      ];
      assert.deepEqual(result, expected);
    });
  });
});

describe("extractOptionNames", () => {
  it("should extract option names from a simple option term", () => {
    const usage: Usage = [
      { type: "option", names: ["--verbose", "-v"] },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--verbose", "-v"]));
  });

  it("should extract option names from multiple option terms", () => {
    const usage: Usage = [
      { type: "option", names: ["--verbose", "-v"] },
      { type: "option", names: ["--quiet", "-q"] },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--verbose", "-v", "--quiet", "-q"]));
  });

  it("should return empty set for argument terms", () => {
    const usage: Usage = [
      { type: "argument", metavar: "FILE" },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set());
  });

  it("should return empty set for command terms", () => {
    const usage: Usage = [
      { type: "command", name: "init" },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set());
  });

  it("should extract option names from optional terms", () => {
    const usage: Usage = [
      {
        type: "optional",
        terms: [{ type: "option", names: ["--force", "-f"] }],
      },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--force", "-f"]));
  });

  it("should extract option names from multiple terms", () => {
    const usage: Usage = [
      {
        type: "multiple",
        terms: [{ type: "option", names: ["--include", "-I"] }],
        min: 0,
      },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--include", "-I"]));
  });

  it("should extract option names from exclusive terms", () => {
    const usage: Usage = [
      {
        type: "exclusive",
        terms: [
          [{ type: "option", names: ["--verbose", "-v"] }],
          [{ type: "option", names: ["--quiet", "-q"] }],
        ],
      },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--verbose", "-v", "--quiet", "-q"]));
  });

  it("should extract option names from nested structures", () => {
    const usage: Usage = [
      {
        type: "optional",
        terms: [
          {
            type: "exclusive",
            terms: [
              [{ type: "option", names: ["--verbose", "-v"] }],
              [{ type: "option", names: ["--debug", "-d"] }],
            ],
          },
        ],
      },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--verbose", "-v", "--debug", "-d"]));
  });

  it("should extract option names from complex nested usage", () => {
    const usage: Usage = [
      { type: "command", name: "tool" },
      {
        type: "optional",
        terms: [{ type: "option", names: ["--config", "-c"] }],
      },
      {
        type: "multiple",
        terms: [
          {
            type: "exclusive",
            terms: [
              [{ type: "option", names: ["--input", "-i"] }],
              [{ type: "option", names: ["--output", "-o"] }],
            ],
          },
        ],
        min: 1,
      },
      { type: "argument", metavar: "FILE" },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(
      result,
      new Set(["--config", "-c", "--input", "-i", "--output", "-o"]),
    );
  });

  it("should handle empty usage", () => {
    const usage: Usage = [];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set());
  });

  it("should handle usage with no options", () => {
    const usage: Usage = [
      { type: "command", name: "test" },
      { type: "argument", metavar: "FILE" },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set());
  });

  it("should not duplicate option names", () => {
    const usage: Usage = [
      { type: "option", names: ["--verbose", "-v"] },
      { type: "option", names: ["--verbose"] }, // Same name appears again
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--verbose", "-v"]));
  });

  it("should extract option names with metavar", () => {
    const usage: Usage = [
      { type: "option", names: ["--output", "-o"], metavar: "FILE" },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--output", "-o"]));
  });

  it("should handle deeply nested optional and multiple wrappers", () => {
    const usage: Usage = [
      {
        type: "optional",
        terms: [
          {
            type: "multiple",
            terms: [
              {
                type: "optional",
                terms: [{ type: "option", names: ["--flag", "-f"] }],
              },
            ],
            min: 0,
          },
        ],
      },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--flag", "-f"]));
  });

  it("should skip hidden options", () => {
    const usage: Usage = [
      { type: "option", names: ["--visible"], metavar: "V" },
      { type: "option", names: ["--hidden"], metavar: "H", hidden: true },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--visible"]));
  });

  it("should skip hidden options in optional term", () => {
    const usage: Usage = [
      {
        type: "optional",
        terms: [
          { type: "option", names: ["--visible"] },
          { type: "option", names: ["--hidden"], hidden: true },
        ],
      },
    ];
    const result = extractOptionNames(usage);
    assert.deepEqual(result, new Set(["--visible"]));
  });
});

describe("extractCommandNames hidden filtering", () => {
  it("should skip hidden commands", () => {
    const usage: Usage = [
      { type: "command", name: "visible" },
      { type: "command", name: "hidden", hidden: true },
    ];
    const result = extractCommandNames(usage);
    assert.deepEqual(result, new Set(["visible"]));
  });

  it("should skip hidden commands in exclusive term", () => {
    const usage: Usage = [
      {
        type: "exclusive",
        terms: [
          [{ type: "command", name: "visible" }],
          [{ type: "command", name: "hidden", hidden: true }],
        ],
      },
    ];
    const result = extractCommandNames(usage);
    assert.deepEqual(result, new Set(["visible"]));
  });
});

describe("extractArgumentMetavars hidden filtering", () => {
  it("should skip hidden arguments", () => {
    const usage: Usage = [
      { type: "argument", metavar: "VISIBLE" },
      { type: "argument", metavar: "HIDDEN", hidden: true },
    ];
    const result = extractArgumentMetavars(usage);
    assert.deepEqual(result, new Set(["VISIBLE"]));
  });

  it("should skip hidden arguments in optional term", () => {
    const usage: Usage = [
      {
        type: "optional",
        terms: [
          { type: "argument", metavar: "VISIBLE" },
          { type: "argument", metavar: "HIDDEN", hidden: true },
        ],
      },
    ];
    const result = extractArgumentMetavars(usage);
    assert.deepEqual(result, new Set(["VISIBLE"]));
  });
});
