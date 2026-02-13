import {
  type DocPage,
  type DocPageFormatOptions,
  formatDocPage,
} from "@optique/core/doc";
import { message, valueSet } from "@optique/core/message";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("formatDocPage", () => {
  it("should format a minimal page with only sections", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "argument", metavar: "test" },
          description: [{ type: "text", text: "A test command" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page);
    const expected = "\n  test                        A test command\n";
    assert.equal(result, expected);
  });

  it("should format a page with brief", () => {
    const page: DocPage = {
      brief: [{ type: "text", text: "This is a brief description" }],
      sections: [],
    };

    const result = formatDocPage("myapp", page);
    const expected = "This is a brief description\n";
    assert.equal(result, expected);
  });

  it("should format a page with usage", () => {
    const page: DocPage = {
      usage: [{ type: "command", name: "command" }],
      sections: [],
    };

    const result = formatDocPage("myapp", page);
    const expected = "Usage: myapp command\n";
    assert.equal(result, expected);
  });

  it("should format a page with description", () => {
    const page: DocPage = {
      description: [{ type: "text", text: "This is a detailed description" }],
      sections: [],
    };

    const result = formatDocPage("myapp", page);
    const expected = "\nThis is a detailed description\n";
    assert.equal(result, expected);
  });

  it("should format a page with footer", () => {
    const page: DocPage = {
      footer: [{ type: "text", text: "This is footer text" }],
      sections: [],
    };

    const result = formatDocPage("myapp", page);
    const expected = "\nThis is footer text";
    assert.equal(result, expected);
  });

  it("should format sections with titles", () => {
    const page: DocPage = {
      sections: [{
        title: "Options",
        entries: [{
          term: { type: "option", names: ["-v", "--verbose"] },
          description: [{ type: "text", text: "Enable verbose output" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page);
    const expected =
      "\nOptions:\n  -v, --verbose               Enable verbose output\n";
    assert.equal(result, expected);
  });

  it("should format entries with default values when showDefault is false", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-p", "--port"] },
          description: [{ type: "text", text: "Port number" }],
          default: [{ type: "text", text: "8080" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page);
    const expected = "\n  -p, --port                  Port number\n";
    assert.equal(result, expected);
  });

  it("should show default values when showDefault is true", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-p", "--port"] },
          description: [{ type: "text", text: "Port number" }],
          default: [{ type: "text", text: "8080" }],
        }, {
          term: { type: "option", names: ["-h", "--host"] },
          default: [{ type: "text", text: "localhost" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page, { showDefault: true });
    const expected =
      "\n  -p, --port                  Port number [8080]\n  -h, --host                   [localhost]\n";
    assert.equal(result, expected);
  });

  it("should show default values with custom prefix and suffix", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-f", "--format"] },
          description: [{ type: "text", text: "Output format" }],
          default: [{ type: "text", text: "json" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page, {
      showDefault: { prefix: " (default: ", suffix: ")" },
    });
    const expected =
      "\n  -f, --format                Output format (default: json)\n";
    assert.equal(result, expected);
  });

  it("should dim default values when colors are enabled", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-p", "--port"] },
          description: [{ type: "text", text: "Port number" }],
          default: [{ type: "text", text: "8080" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page, {
      showDefault: true,
      colors: true,
    });
    const expected =
      "\n  \u001b[3m-p\u001b[0m\u001b[2m, \u001b[0m\u001b[3m--port\u001b[0m                  Port number\u001b[2m [8080]\u001b[0m\n";
    assert.equal(result, expected);
  });

  it("should not show defaults when entry.default is undefined", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-v", "--verbose"] },
          description: [{ type: "text", text: "Enable verbose output" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page, { showDefault: true });
    const expected = "\n  -v, --verbose               Enable verbose output\n";
    assert.equal(result, expected);
  });

  it("should handle entries without descriptions", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "command", name: "command" },
        }],
      }],
    };

    const result = formatDocPage("myapp", page);
    const expected = "\n  command                     \n";
    assert.equal(result, expected);
  });

  it("should respect termIndent option", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "argument", metavar: "test" },
          description: [{ type: "text", text: "Test description" }],
        }],
      }],
    };

    const options: DocPageFormatOptions = { termIndent: 4 };
    const result = formatDocPage("myapp", page, options);
    const expected = "\n    test                        Test description\n";
    assert.equal(result, expected);
  });

  it("should respect termWidth option", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "argument", metavar: "short" },
          description: [{ type: "text", text: "Description" }],
        }],
      }],
    };

    const options: DocPageFormatOptions = { termWidth: 10 };
    const result = formatDocPage("myapp", page, options);
    const expected = "\n  short       Description\n";
    assert.equal(result, expected);
  });

  it("should respect maxWidth option with brief", () => {
    const page: DocPage = {
      brief: [{
        type: "text",
        text:
          "A very long brief description that should be wrapped at some point",
      }],
      sections: [],
    };

    const options: DocPageFormatOptions = { maxWidth: 30 };
    const result = formatDocPage("myapp", page, options);
    // Text should be wrapped
    assert.ok(result.includes("A very long brief"));
    assert.ok(result.includes("\n"));
  });

  it("should handle colors option", () => {
    const page: DocPage = {
      usage: [{ type: "command", name: "command" }],
      sections: [],
    };

    const options: DocPageFormatOptions = { colors: true };
    const result = formatDocPage("myapp", page, options);

    // Verify exact format: bold+dim label, space, bold program name, space, bold command
    const expected =
      "\u001b[1;2mUsage:\u001b[0m \u001b[1mmyapp\u001b[0m \u001b[1mcommand\u001b[0m\n";
    assert.equal(
      result,
      expected,
      "Output should match expected format exactly",
    );
  });

  it("should sort sections with untitled sections first", () => {
    const page: DocPage = {
      sections: [{
        title: "Commands",
        entries: [{
          term: { type: "command", name: "cmd" },
          description: [{ type: "text", text: "A command" }],
        }],
      }, {
        entries: [{
          term: { type: "argument", metavar: "untitled" },
          description: [{ type: "text", text: "Untitled entry" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page);
    const expected =
      "\n  untitled                    Untitled entry\n\nCommands:\n  cmd                         A command\n";
    assert.equal(result, expected);
  });

  it("should format complete page with all components", () => {
    const page: DocPage = {
      brief: [{ type: "text", text: "A complete CLI application" }],
      usage: [
        { type: "command", name: "myapp" },
        { type: "optional", terms: [{ type: "option", names: ["-v"] }] },
      ],
      description: [{
        type: "text",
        text: "This application does many useful things.",
      }],
      sections: [{
        title: "Options",
        entries: [{
          term: { type: "option", names: ["-v", "--verbose"] },
          description: [{ type: "text", text: "Enable verbose output" }],
        }, {
          term: { type: "option", names: ["-h", "--help"] },
          description: [{ type: "text", text: "Show help information" }],
        }],
      }],
      footer: [{
        type: "text",
        text: "For more information, visit our website.",
      }],
    };

    const result = formatDocPage("myapp", page);
    const expected =
      "A complete CLI application\nUsage: myapp myapp [-v]\n\nThis application does many useful things.\n\nOptions:\n  -v, --verbose               Enable verbose output\n  -h, --help                  Show help information\n\nFor more information, visit our website.";
    assert.equal(result, expected);
  });

  it("should apply resetSuffix correctly in default values with colors", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-p", "--port"] },
          description: [{ type: "text", text: "Port number" }],
          default: [{ type: "value", value: "8080" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page, {
      showDefault: true,
      colors: true,
    });

    // Should contain resetSuffix after ANSI reset to maintain dim styling
    assert.ok(result.includes("\x1b[2m"));
    assert.ok(result.includes("\x1b[32m8080\x1b[0m\x1b[2m"));
  });

  it("should handle resetSuffix with custom prefix and suffix", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-f", "--format"] },
          description: [{ type: "text", text: "Output format" }],
          default: [{ type: "value", value: "json" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page, {
      showDefault: { prefix: " (default: ", suffix: ")" },
      colors: true,
    });

    // Should contain resetSuffix in the custom format
    assert.ok(
      result.includes("\x1b[2m (default: \x1b[32mjson\x1b[0m\x1b[2m)\x1b[0m"),
    );
  });

  it("should not apply resetSuffix when colors is false", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-p", "--port"] },
          description: [{ type: "text", text: "Port number" }],
          default: [{ type: "value", value: "8080" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page, {
      showDefault: true,
      colors: false,
    });

    // Should not contain any ANSI codes
    assert.ok(!result.includes("\x1b["));
    assert.ok(result.includes('Port number ["8080"]'));
  });

  it("should handle complex message defaults with resetSuffix", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["--config"] },
          description: [{ type: "text", text: "Configuration file" }],
          default: [
            { type: "text", text: "Uses " },
            { type: "envVar", envVar: "CONFIG_FILE" },
            { type: "text", text: " if set" },
          ],
        }],
      }],
    };

    const result = formatDocPage("myapp", page, {
      showDefault: true,
      colors: true,
    });

    // Should maintain resetSuffix throughout the complex message
    assert.ok(
      result.includes(
        "\x1b[2m [Uses \x1b[1;4mCONFIG_FILE\x1b[0m\x1b[2m if set]\x1b[0m",
      ),
    );
  });

  it("should skip sections with no entries (Issue #29)", () => {
    const page: DocPage = {
      usage: [{ type: "command", name: "cmd1" }],
      sections: [
        {
          title: "Group 1 commands",
          entries: [], // Empty entries array
        },
        {
          title: "Options",
          entries: [
            {
              term: { type: "option", names: ["--help"] },
              description: [{ type: "text", text: "Show help" }],
            },
          ],
        },
      ],
    };

    const output = formatDocPage("test", page, { colors: false });

    // Should not contain the empty "Group 1 commands:" section
    assert.ok(!output.includes("Group 1 commands:"));

    // Should still contain the Options section with entries
    assert.ok(output.includes("Options:"));
    assert.ok(output.includes("--help"));
  });

  it("should handle multiple empty sections", () => {
    const page: DocPage = {
      usage: [{ type: "command", name: "test" }],
      sections: [
        {
          title: "Empty Section 1",
          entries: [],
        },
        {
          title: "Non-Empty Section",
          entries: [
            {
              term: { type: "option", names: ["-v", "--verbose"] },
              description: [{ type: "text", text: "Verbose output" }],
            },
          ],
        },
        {
          title: "Empty Section 2",
          entries: [],
        },
      ],
    };

    const output = formatDocPage("test", page, { colors: false });

    // Should not contain either empty section
    assert.ok(!output.includes("Empty Section 1:"));
    assert.ok(!output.includes("Empty Section 2:"));

    // Should still contain the non-empty section
    assert.ok(output.includes("Non-Empty Section:"));
    assert.ok(output.includes("-v, --verbose"));
  });

  it("should handle sections with only empty entries", () => {
    const page: DocPage = {
      usage: [], // Empty usage to show default
      sections: [
        {
          title: "Should Not Appear",
          entries: [], // No entries at all
        },
        {
          entries: [], // Untitled section with no entries
        },
      ],
    };

    const output = formatDocPage("test", page, { colors: false });

    // Should not contain the titled empty section
    assert.ok(!output.includes("Should Not Appear:"));

    // Output should only have the usage line
    assert.equal(output.trim(), "Usage: test");
  });

  it("should format examples, author, and bugs sections", () => {
    const page: DocPage = {
      usage: [],
      sections: [],
      examples: message`myapp --help\nmyapp --version`,
      author: message`Jane Doe <jane@example.com>`,
      bugs: message`Report bugs at https://github.com/example/myapp/issues`,
    };

    const result = formatDocPage("myapp", page);

    assert.ok(result.includes("Examples:\n"));
    // formatMessage converts \n to space, so check for indented content
    assert.ok(result.includes("  myapp --help myapp --version"));

    assert.ok(result.includes("Author:\n"));
    assert.ok(result.includes("  Jane Doe <jane@example.com>"));

    assert.ok(result.includes("Bugs:\n"));
    assert.ok(
      result.includes(
        "  Report bugs at https://github.com/example/myapp/issues",
      ),
    );
  });

  it("should format examples, author, and bugs with bold+dim labels when colors enabled", () => {
    const page: DocPage = {
      usage: [],
      sections: [],
      examples: message`Example usage`,
      author: message`John Doe`,
      bugs: message`Bug tracker`,
    };

    const result = formatDocPage("myapp", page, { colors: true });

    // Even with empty usage array, formatUsage still outputs the program name
    const expected = [
      "\x1b[1;2mUsage:\x1b[0m \x1b[1mmyapp\x1b[0m ",
      "",
      "\x1b[1;2mExamples:\x1b[0m",
      "  Example usage",
      "",
      "\x1b[1;2mAuthor:\x1b[0m",
      "  John Doe",
      "",
      "\x1b[1;2mBugs:\x1b[0m",
      "  Bug tracker",
      "",
    ].join("\n");

    assert.equal(result, expected);
  });

  it("should render examples, author, and bugs in correct order before footer", () => {
    const page: DocPage = {
      usage: [],
      sections: [],
      examples: message`Example usage`,
      author: message`John Doe`,
      bugs: message`Bug tracker`,
      footer: message`Footer text`,
    };

    const result = formatDocPage("test", page);

    const examplesIndex = result.indexOf("Examples:");
    const authorIndex = result.indexOf("Author:");
    const bugsIndex = result.indexOf("Bugs:");
    const footerIndex = result.indexOf("Footer text");

    // Check that all sections are present
    assert.ok(examplesIndex !== -1, "Examples section should be present");
    assert.ok(authorIndex !== -1, "Author section should be present");
    assert.ok(bugsIndex !== -1, "Bugs section should be present");
    assert.ok(footerIndex !== -1, "Footer should be present");

    // Check order: Examples → Author → Bugs → Footer
    assert.ok(
      examplesIndex < authorIndex,
      "Examples should come before Author",
    );
    assert.ok(authorIndex < bugsIndex, "Author should come before Bugs");
    assert.ok(bugsIndex < footerIndex, "Bugs should come before Footer");
  });

  it("should not include examples, author, or bugs sections when not provided", () => {
    const page: DocPage = {
      usage: [],
      sections: [],
      footer: message`Footer only`,
    };

    const result = formatDocPage("test", page);

    assert.ok(!result.includes("Examples:"));
    assert.ok(!result.includes("Author:"));
    assert.ok(!result.includes("Bugs:"));
    assert.ok(result.includes("Footer only"));
  });

  it("should format all labels with bold+dim when colors enabled", () => {
    const page: DocPage = {
      usage: [{ type: "command", name: "myapp" }],
      sections: [
        {
          title: "Options",
          entries: [{
            term: { type: "option", names: ["--help"] },
            description: message`Show help`,
          }],
        },
        {
          title: "Commands",
          entries: [{
            term: { type: "command", name: "test" },
            description: message`Run tests`,
          }],
        },
      ],
      examples: message`myapp --help`,
      author: message`Jane Doe`,
      bugs: message`GitHub Issues`,
    };

    const result = formatDocPage("myapp", page, { colors: true });

    const expected = [
      // Usage includes both program name and command name
      "\x1b[1;2mUsage:\x1b[0m \x1b[1mmyapp\x1b[0m \x1b[1mmyapp\x1b[0m",
      "",
      "\x1b[1;2mOptions:\x1b[0m",
      // Options are rendered with italic (code 3) by default
      "  \x1b[3m--help\x1b[0m                      Show help",
      "",
      "\x1b[1;2mCommands:\x1b[0m",
      // Commands are rendered with bold (code 1)
      "  \x1b[1mtest\x1b[0m                        Run tests",
      "",
      "\x1b[1;2mExamples:\x1b[0m",
      "  myapp --help",
      "",
      "\x1b[1;2mAuthor:\x1b[0m",
      "  Jane Doe",
      "",
      "\x1b[1;2mBugs:\x1b[0m",
      "  GitHub Issues",
      "",
    ].join("\n");

    assert.equal(result, expected);
  });

  it("should format all labels as plain text when colors disabled", () => {
    const page: DocPage = {
      usage: [{ type: "command", name: "myapp" }],
      sections: [
        {
          title: "Options",
          entries: [{
            term: { type: "option", names: ["--help"] },
            description: message`Show help`,
          }],
        },
      ],
      examples: message`myapp --help`,
      author: message`Jane Doe`,
      bugs: message`GitHub Issues`,
    };

    const result = formatDocPage("myapp", page, { colors: false });

    const expected = [
      // Usage includes both program name and command name
      "Usage: myapp myapp",
      "",
      "Options:",
      // Default termWidth is 26, spacing adjusted accordingly
      "  --help                      Show help",
      "",
      "Examples:",
      "  myapp --help",
      "",
      "Author:",
      "  Jane Doe",
      "",
      "Bugs:",
      "  GitHub Issues",
      "",
    ].join("\n");

    assert.equal(result, expected);
  });

  it("should not show choices when showChoices is not set", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["--format"] },
          description: [{ type: "text", text: "Output format" }],
          choices: valueSet(["json", "yaml", "xml"], { type: "unit" }),
        }],
      }],
    };

    const result = formatDocPage("myapp", page);
    assert.ok(!result.includes("choices"));
    assert.ok(!result.includes("json"));
  });

  it("should not show choices when showChoices is false", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["--format"] },
          description: [{ type: "text", text: "Output format" }],
          choices: valueSet(["json", "yaml", "xml"], { type: "unit" }),
        }],
      }],
    };

    const result = formatDocPage("myapp", page, { showChoices: false });
    assert.ok(!result.includes("choices"));
    assert.ok(!result.includes("json, yaml, xml"));
  });

  it("should show choices when showChoices is true", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["--format"] },
          description: [{ type: "text", text: "Output format" }],
          choices: valueSet(["json", "yaml", "xml"], { type: "unit" }),
        }],
      }],
    };

    const result = formatDocPage("myapp", page, { showChoices: true });
    assert.ok(result.includes("Output format (choices: json, yaml, xml)"));
  });

  it("should show choices with custom prefix, suffix, and label", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["--format"] },
          description: [{ type: "text", text: "Output format" }],
          choices: valueSet(["json", "yaml"], { type: "unit" }),
        }],
      }],
    };

    const result = formatDocPage("myapp", page, {
      showChoices: { prefix: " {", suffix: "}", label: "" },
    });
    assert.ok(result.includes("Output format {json, yaml}"));
  });

  it("should show choices with custom label", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["--format"] },
          description: [{ type: "text", text: "Output format" }],
          choices: valueSet(["json", "yaml"], { type: "unit" }),
        }],
      }],
    };

    const result = formatDocPage("myapp", page, {
      showChoices: { label: "valid: " },
    });
    assert.ok(result.includes("Output format (valid: json, yaml)"));
  });

  it("should show choices without description", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["--level"] },
          choices: valueSet(["debug", "info", "warn"], { type: "unit" }),
        }],
      }],
    };

    const result = formatDocPage("myapp", page, { showChoices: true });
    assert.ok(result.includes("(choices: debug, info, warn)"));
  });

  it("should not show choices when entry has no choices field", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-v", "--verbose"] },
          description: [{ type: "text", text: "Enable verbose output" }],
        }],
      }],
    };

    const result = formatDocPage("myapp", page, { showChoices: true });
    assert.ok(!result.includes("choices"));
    assert.ok(result.includes("Enable verbose output"));
  });

  it("should render description, default, then choices in order", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["--format"] },
          description: [{ type: "text", text: "Output format" }],
          default: [{ type: "text", text: "json" }],
          choices: valueSet(["json", "yaml", "xml"], { type: "unit" }),
        }],
      }],
    };

    const result = formatDocPage("myapp", page, {
      showDefault: true,
      showChoices: true,
    });
    const line = result.split("\n").find((l) => l.includes("--format"))!;
    const defaultIdx = line.indexOf("[json]");
    const choicesIdx = line.indexOf("(choices:");
    assert.ok(defaultIdx !== -1, "default should be present");
    assert.ok(choicesIdx !== -1, "choices should be present");
    assert.ok(
      defaultIdx < choicesIdx,
      "default should come before choices",
    );
  });

  it("should dim choices with per-value coloring when colors are enabled", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["--format"] },
          description: [{ type: "text", text: "Output format" }],
          choices: valueSet(["json", "yaml"], { type: "unit" }),
        }],
      }],
    };

    const result = formatDocPage("myapp", page, {
      showChoices: true,
      colors: true,
    });
    // Should contain dim ANSI wrapping and per-value green coloring
    assert.ok(result.includes("\x1b[2m"));
    assert.ok(result.includes("\x1b[0m"));
    // Each value should get its own green color within the dim context
    assert.ok(
      result.includes("\x1b[32mjson\x1b[0m\x1b[2m"),
      "json should be green with dim reset",
    );
    assert.ok(
      result.includes("\x1b[32myaml\x1b[0m\x1b[2m"),
      "yaml should be green with dim reset",
    );
    // Commas should be in the dim context, not inside green
    assert.ok(
      result.includes("\x1b[2m, \x1b[32m") ||
        result.includes("\x1b[0m\x1b[2m, \x1b[32m"),
      "commas should be between value color sequences",
    );
  });
});
