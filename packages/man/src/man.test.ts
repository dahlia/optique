import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatDateForMan,
  formatDocPageAsMan,
  formatUsageTermAsRoff,
  type ManPageOptions,
} from "./man.ts";
import type { DocPage, DocSection } from "@optique/core/doc";
import type { Usage, UsageTerm } from "@optique/core/usage";
import { message } from "@optique/core/message";

describe("formatDateForMan()", () => {
  it("formats Date object to 'Month Year' format", () => {
    const date = new Date(2026, 0, 22); // January 22, 2026
    assert.equal(formatDateForMan(date), "January 2026");
  });

  it("handles different months", () => {
    assert.equal(formatDateForMan(new Date(2026, 5, 15)), "June 2026");
    assert.equal(formatDateForMan(new Date(2025, 11, 1)), "December 2025");
  });

  it("returns string date as-is", () => {
    assert.equal(formatDateForMan("January 2026"), "January 2026");
    assert.equal(formatDateForMan("2026-01-22"), "2026-01-22");
  });

  it("returns undefined for undefined input", () => {
    assert.equal(formatDateForMan(undefined), undefined);
  });
});

describe("formatUsageTermAsRoff()", () => {
  it("formats argument term", () => {
    const term: UsageTerm = { type: "argument", metavar: "FILE" };
    assert.equal(formatUsageTermAsRoff(term), "\\fIFILE\\fR");
  });

  it("formats option term without metavar", () => {
    const term: UsageTerm = { type: "option", names: ["--verbose", "-v"] };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[\\fB\\-\\-verbose\\fR | \\fB\\-v\\fR]",
    );
  });

  it("formats option term with metavar", () => {
    const term: UsageTerm = {
      type: "option",
      names: ["--config", "-c"],
      metavar: "FILE",
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[\\fB\\-\\-config\\fR | \\fB\\-c\\fR \\fIFILE\\fR]",
    );
  });

  it("formats single option name", () => {
    const term: UsageTerm = { type: "option", names: ["--help"] };
    assert.equal(formatUsageTermAsRoff(term), "[\\fB\\-\\-help\\fR]");
  });

  it("formats command term", () => {
    const term: UsageTerm = { type: "command", name: "build" };
    assert.equal(formatUsageTermAsRoff(term), "\\fBbuild\\fR");
  });

  it("formats optional term", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [{ type: "argument", metavar: "OUTPUT" }],
    };
    assert.equal(formatUsageTermAsRoff(term), "[\\fIOUTPUT\\fR]");
  });

  it("formats multiple term with min 0", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{ type: "argument", metavar: "FILE" }],
      min: 0,
    };
    assert.equal(formatUsageTermAsRoff(term), "[\\fIFILE\\fR ...]");
  });

  it("formats multiple term with min 1", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{ type: "argument", metavar: "FILE" }],
      min: 1,
    };
    assert.equal(formatUsageTermAsRoff(term), "\\fIFILE\\fR ...");
  });

  it("formats exclusive term", () => {
    const term: UsageTerm = {
      type: "exclusive",
      terms: [
        [{ type: "command", name: "start" }],
        [{ type: "command", name: "stop" }],
      ],
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "(\\fBstart\\fR | \\fBstop\\fR)",
    );
  });

  it("formats literal term", () => {
    const term: UsageTerm = { type: "literal", value: "debug" };
    assert.equal(formatUsageTermAsRoff(term), "debug");
  });

  it("formats passthrough term", () => {
    const term: UsageTerm = { type: "passthrough" };
    assert.equal(formatUsageTermAsRoff(term), "[...]");
  });

  it("skips hidden terms", () => {
    const term: UsageTerm = {
      type: "argument",
      metavar: "SECRET",
      hidden: true,
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });
});

describe("formatDocPageAsMan()", () => {
  const minimalOptions: ManPageOptions = {
    name: "myapp",
    section: 1,
  };

  it("generates minimal man page with required fields", () => {
    const page: DocPage = {
      sections: [],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".TH MYAPP 1"));
    assert.ok(result.includes(".SH NAME"));
    assert.ok(result.includes("myapp"));
  });

  it("includes version and date in header", () => {
    const page: DocPage = {
      sections: [],
    };

    const options: ManPageOptions = {
      name: "myapp",
      section: 1,
      version: "1.0.0",
      date: new Date(2026, 0, 22),
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes('"January 2026"'));
    assert.ok(result.includes('"myapp 1.0.0"'));
  });

  it("includes manual title in header", () => {
    const page: DocPage = {
      sections: [],
    };

    const options: ManPageOptions = {
      name: "myapp",
      section: 1,
      manual: "User Commands",
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes('"User Commands"'));
  });

  it("uses brief in NAME section", () => {
    const page: DocPage = {
      brief: message`A sample CLI application`,
      sections: [],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".SH NAME"));
    assert.ok(result.includes("myapp \\- A sample CLI application"));
  });

  it("generates SYNOPSIS section from usage", () => {
    const usage: Usage = [
      { type: "option", names: ["--verbose", "-v"] },
      { type: "argument", metavar: "FILE" },
    ];

    const page: DocPage = {
      usage,
      sections: [],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".SH SYNOPSIS"));
    assert.ok(result.includes(".B myapp"));
    assert.ok(result.includes("\\fB\\-\\-verbose\\fR"));
    assert.ok(result.includes("\\fIFILE\\fR"));
  });

  it("generates DESCRIPTION section", () => {
    const page: DocPage = {
      description: message`This is a detailed description of the application.`,
      sections: [],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".SH DESCRIPTION"));
    assert.ok(
      result.includes("This is a detailed description of the application."),
    );
  });

  it("generates OPTIONS section with .TP macros", () => {
    const optionsSection: DocSection = {
      title: "Options",
      entries: [
        {
          term: { type: "option", names: ["--verbose", "-v"] },
          description: message`Enable verbose output.`,
        },
        {
          term: { type: "option", names: ["--config", "-c"], metavar: "FILE" },
          description: message`Path to configuration file.`,
        },
      ],
    };

    const page: DocPage = {
      sections: [optionsSection],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".SH OPTIONS"));
    assert.ok(result.includes(".TP"));
    assert.ok(result.includes("\\fB\\-\\-verbose\\fR, \\fB\\-v\\fR"));
    assert.ok(result.includes("Enable verbose output."));
    assert.ok(
      result.includes("\\fB\\-\\-config\\fR, \\fB\\-c\\fR \\fIFILE\\fR"),
    );
    assert.ok(result.includes("Path to configuration file."));
  });

  it("generates COMMANDS section", () => {
    const commandsSection: DocSection = {
      title: "Commands",
      entries: [
        {
          term: { type: "command", name: "build" },
          description: message`Build the project.`,
        },
        {
          term: { type: "command", name: "test" },
          description: message`Run tests.`,
        },
      ],
    };

    const page: DocPage = {
      sections: [commandsSection],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".SH COMMANDS"));
    assert.ok(result.includes("\\fBbuild\\fR"));
    assert.ok(result.includes("Build the project."));
    assert.ok(result.includes("\\fBtest\\fR"));
    assert.ok(result.includes("Run tests."));
  });

  it("skips empty sections", () => {
    const emptySection: DocSection = {
      title: "Empty",
      entries: [],
    };

    const page: DocPage = {
      sections: [emptySection],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(!result.includes(".SH EMPTY"));
  });

  it("generates AUTHOR section", () => {
    const page: DocPage = {
      sections: [],
    };

    const options: ManPageOptions = {
      ...minimalOptions,
      author: message`Hong Minhee <hong@minhee.org>`,
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes(".SH AUTHOR"));
    assert.ok(result.includes("Hong Minhee <hong@minhee.org>"));
  });

  it("generates BUGS section", () => {
    const page: DocPage = {
      sections: [],
    };

    const options: ManPageOptions = {
      ...minimalOptions,
      bugs: message`Report bugs to https://github.com/dahlia/optique/issues`,
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes(".SH BUGS"));
    assert.ok(
      result.includes(
        "Report bugs to https://github.com/dahlia/optique/issues",
      ),
    );
  });

  it("generates EXAMPLES section", () => {
    const page: DocPage = {
      sections: [],
    };

    const options: ManPageOptions = {
      ...minimalOptions,
      examples: message`Run with verbose output:\n\n  myapp --verbose file.txt`,
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes(".SH EXAMPLES"));
    assert.ok(result.includes("Run with verbose output:"));
  });

  it("generates SEE ALSO section", () => {
    const page: DocPage = {
      sections: [],
    };

    const options: ManPageOptions = {
      ...minimalOptions,
      seeAlso: [
        { name: "git", section: 1 },
        { name: "make", section: 1 },
      ],
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes(".SH SEE ALSO"));
    assert.ok(result.includes(".BR git (1),"));
    assert.ok(result.includes(".BR make (1)"));
  });

  it("generates ENVIRONMENT section", () => {
    const page: DocPage = {
      sections: [],
    };

    const envSection: DocSection = {
      entries: [
        {
          term: { type: "argument", metavar: "API_KEY" },
          description: message`API key for authentication.`,
        },
      ],
    };

    const options: ManPageOptions = {
      ...minimalOptions,
      environment: envSection,
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes(".SH ENVIRONMENT"));
    assert.ok(result.includes("API_KEY"));
    assert.ok(result.includes("API key for authentication."));
  });

  it("generates EXIT STATUS section", () => {
    const page: DocPage = {
      sections: [],
    };

    const exitSection: DocSection = {
      entries: [
        {
          term: { type: "literal", value: "0" },
          description: message`Success.`,
        },
        {
          term: { type: "literal", value: "1" },
          description: message`General error.`,
        },
      ],
    };

    const options: ManPageOptions = {
      ...minimalOptions,
      exitStatus: exitSection,
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes(".SH EXIT STATUS"));
    assert.ok(result.includes(".TP"));
    assert.ok(result.includes("0"));
    assert.ok(result.includes("Success."));
    assert.ok(result.includes("1"));
    assert.ok(result.includes("General error."));
  });

  it("includes footer content", () => {
    const page: DocPage = {
      sections: [],
      footer: message`For more information, visit https://optique.dev/`,
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    // Footer should be included somewhere, typically at the end
    assert.ok(
      result.includes("For more information, visit https://optique.dev/"),
    );
  });

  it("handles entries without description", () => {
    const section: DocSection = {
      title: "Options",
      entries: [
        {
          term: { type: "option", names: ["--help"] },
          // No description
        },
      ],
    };

    const page: DocPage = {
      sections: [section],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes("\\fB\\-\\-help\\fR"));
    // Should not throw
  });

  it("handles entries with default value", () => {
    const section: DocSection = {
      title: "Options",
      entries: [
        {
          term: { type: "option", names: ["--port"], metavar: "NUM" },
          description: message`Port to listen on.`,
          default: message`8080`,
        },
      ],
    };

    const page: DocPage = {
      sections: [section],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes("Port to listen on."));
    assert.ok(result.includes("8080"));
  });

  it("uses different section numbers", () => {
    const page: DocPage = { sections: [] };

    for (const section of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      const result = formatDocPageAsMan(page, { name: "myapp", section });
      assert.ok(result.includes(`.TH MYAPP ${section}`));
    }
  });

  it("uppercases program name in .TH", () => {
    const page: DocPage = { sections: [] };

    const result = formatDocPageAsMan(page, { name: "my-app", section: 1 });
    assert.ok(result.includes(".TH MY-APP 1"));
  });

  it("generates complete man page with all sections", () => {
    const page: DocPage = {
      brief: message`A sample CLI application`,
      usage: [
        { type: "option", names: ["--verbose"] },
        { type: "argument", metavar: "FILE" },
      ],
      description: message`This is a detailed description.`,
      sections: [
        {
          title: "Options",
          entries: [
            {
              term: { type: "option", names: ["--verbose"] },
              description: message`Enable verbose output.`,
            },
          ],
        },
      ],
    };

    const options: ManPageOptions = {
      name: "myapp",
      section: 1,
      version: "1.0.0",
      date: "January 2026",
      manual: "User Commands",
      author: message`Hong Minhee`,
      seeAlso: [{ name: "git", section: 1 }],
    };

    const result = formatDocPageAsMan(page, options);

    // Verify all major sections are present in order
    const namePos = result.indexOf(".SH NAME");
    const synopsisPos = result.indexOf(".SH SYNOPSIS");
    const descPos = result.indexOf(".SH DESCRIPTION");
    const optionsPos = result.indexOf(".SH OPTIONS");
    const seeAlsoPos = result.indexOf(".SH SEE ALSO");
    const authorPos = result.indexOf(".SH AUTHOR");

    assert.ok(namePos < synopsisPos);
    assert.ok(synopsisPos < descPos);
    assert.ok(descPos < optionsPos);
    assert.ok(optionsPos < seeAlsoPos);
    assert.ok(seeAlsoPos < authorPos);
  });
});
