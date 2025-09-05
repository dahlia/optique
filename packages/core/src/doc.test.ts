import {
  type DocPage,
  type DocPageFormatOptions,
  formatDocPage,
} from "@optique/core/doc";
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
          default: "8080",
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
          default: "8080",
        }, {
          term: { type: "option", names: ["-h", "--host"] },
          default: "localhost",
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
          default: "json",
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
          default: "8080",
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
    const expected =
      "Usage: \u001b[1mmyapp\u001b[0m \u001b[1mcommand\u001b[0m\n";
    assert.equal(result, expected);
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
});
