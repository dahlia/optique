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
import { command, constant } from "@optique/core/primitives";
import { or } from "@optique/core/constructs";
import { getDocPage } from "@optique/core/parser";

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

  it("escapes hyphens in command term name", () => {
    const term: UsageTerm = { type: "command", name: "dry-run" };
    assert.equal(formatUsageTermAsRoff(term), "\\fBdry\\-run\\fR");
  });

  it("escapes roff special characters in command term name", () => {
    const term: UsageTerm = { type: "command", name: "cmd\\arg" };
    assert.equal(formatUsageTermAsRoff(term), "\\fBcmd\\\\arg\\fR");
  });

  it("escapes backslashes in argument metavar", () => {
    const term: UsageTerm = { type: "argument", metavar: "C:\\TMP" };
    assert.equal(formatUsageTermAsRoff(term), "\\fIC:\\\\TMP\\fR");
  });

  it("escapes backslashes in option metavar", () => {
    const term: UsageTerm = {
      type: "option",
      names: ["--dir"],
      metavar: "C:\\TMP",
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[\\fB\\-\\-dir\\fR \\fIC:\\\\TMP\\fR]",
    );
  });

  it("formats optional term", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [{ type: "argument", metavar: "OUTPUT" }],
    };
    assert.equal(formatUsageTermAsRoff(term), "[\\fIOUTPUT\\fR]");
  });

  it("avoids double brackets for optional wrapping option with metavar", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [{ type: "option", names: ["--host"], metavar: "STRING" }],
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[\\fB\\-\\-host\\fR \\fISTRING\\fR]",
    );
  });

  it("avoids double brackets for optional wrapping boolean option", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [{ type: "option", names: ["--debug"] }],
    };
    assert.equal(formatUsageTermAsRoff(term), "[\\fB\\-\\-debug\\fR]");
  });

  it("avoids double brackets for optional wrapping aliased option", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [{ type: "option", names: ["--verbose", "-v"] }],
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[\\fB\\-\\-verbose\\fR | \\fB\\-v\\fR]",
    );
  });

  it("keeps child brackets for optional wrapping multiple options", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [
        { type: "option", names: ["--verbose", "-v"] },
        { type: "option", names: ["--output", "-o"], metavar: "FILE" },
      ],
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[[\\fB\\-\\-verbose\\fR | \\fB\\-v\\fR] [\\fB\\-\\-output\\fR | \\fB\\-o\\fR \\fIFILE\\fR]]",
    );
  });

  it("preserves inner brackets for nested optional with siblings", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [
        { type: "literal", value: "foo" },
        {
          type: "optional",
          terms: [{ type: "argument", metavar: "BAR" }],
        },
      ],
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[foo [\\fIBAR\\fR]]",
    );
  });

  it("preserves option brackets in mixed optional group", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [
        { type: "argument", metavar: "FILE" },
        { type: "option", names: ["--flag"] },
      ],
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[\\fIFILE\\fR [\\fB\\-\\-flag\\fR]]",
    );
  });

  it("preserves option brackets in mixed multiple(min=0) group", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [
        { type: "argument", metavar: "FILE" },
        { type: "option", names: ["--recursive"] },
      ],
      min: 0,
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[\\fIFILE\\fR [\\fB\\-\\-recursive\\fR] ...]",
    );
  });

  it("preserves inner brackets for nested multiple(min=0) with siblings", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [
        { type: "literal", value: "foo" },
        {
          type: "multiple",
          terms: [{ type: "argument", metavar: "BAR" }],
          min: 0,
        },
      ],
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[foo [\\fIBAR\\fR ...]]",
    );
  });

  it("avoids double brackets for optional(multiple(option(...)))", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [{
        type: "multiple",
        terms: [{ type: "option", names: ["--tag"], metavar: "STRING" }],
        min: 0,
      }],
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[\\fB\\-\\-tag\\fR \\fISTRING\\fR ...]",
    );
  });

  it("avoids double brackets for multiple(optional(option(...)))", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{
        type: "optional",
        terms: [{ type: "option", names: ["--flag"] }],
      }],
      min: 0,
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[\\fB\\-\\-flag\\fR ...]",
    );
  });

  it("preserves grouping for nested multiple(min=0) wrapping option", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{
        type: "multiple",
        terms: [{ type: "option", names: ["--tag"], metavar: "STRING" }],
        min: 0,
      }],
      min: 0,
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[[\\fB\\-\\-tag\\fR \\fISTRING\\fR ...] ...]",
    );
  });

  it("preserves grouping for multiple wrapping optional wrapping multiple", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{
        type: "optional",
        terms: [{
          type: "multiple",
          terms: [{ type: "option", names: ["--tag"], metavar: "STRING" }],
          min: 0,
        }],
      }],
      min: 0,
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[[\\fB\\-\\-tag\\fR \\fISTRING\\fR ...] ...]",
    );
  });

  it("formats multiple term with min 0", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{ type: "argument", metavar: "FILE" }],
      min: 0,
    };
    assert.equal(formatUsageTermAsRoff(term), "[\\fIFILE\\fR ...]");
  });

  it("avoids double brackets for multiple(min=0) wrapping option", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{ type: "option", names: ["--include"], metavar: "PATTERN" }],
      min: 0,
    };
    assert.equal(
      formatUsageTermAsRoff(term),
      "[\\fB\\-\\-include\\fR \\fIPATTERN\\fR ...]",
    );
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

  it("escapes literal term starting with period", () => {
    const term: UsageTerm = { type: "literal", value: ".env" };
    assert.equal(formatUsageTermAsRoff(term), "\\&.env");
  });

  it("escapes literal term starting with single quote", () => {
    const term: UsageTerm = { type: "literal", value: "'quoted" };
    assert.equal(formatUsageTermAsRoff(term), "\\&'quoted");
  });

  it("formats passthrough term", () => {
    const term: UsageTerm = { type: "passthrough" };
    assert.equal(formatUsageTermAsRoff(term), "[...]");
  });

  it("throws for unknown usage term type", () => {
    const invalid = { type: "unknown" } as unknown as UsageTerm;
    assert.throws(
      () => formatUsageTermAsRoff(invalid),
      /Unknown usage term type: unknown/,
    );
  });

  it("skips hidden terms", () => {
    const term: UsageTerm = {
      type: "argument",
      metavar: "SECRET",
      hidden: true,
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("skips terms with hidden: 'usage'", () => {
    const term: UsageTerm = {
      type: "argument",
      metavar: "SECRET",
      hidden: "usage",
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("skips terms with hidden: 'help'", () => {
    const term: UsageTerm = {
      type: "argument",
      metavar: "SECRET",
      hidden: "help",
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("keeps terms with hidden: 'doc' visible in usage", () => {
    const term: UsageTerm = {
      type: "argument",
      metavar: "SECRET",
      hidden: "doc",
    };
    assert.equal(formatUsageTermAsRoff(term), "\\fISECRET\\fR");
  });

  it("collapses optional wrapping all-hidden terms", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [{ type: "argument", metavar: "SECRET", hidden: true }],
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("collapses multiple (min=0) wrapping all-hidden terms", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{ type: "argument", metavar: "SECRET", hidden: true }],
      min: 0,
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("collapses multiple (min=1) wrapping all-hidden terms", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{ type: "argument", metavar: "SECRET", hidden: true }],
      min: 1,
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("removes hidden branches from exclusive terms", () => {
    const term: UsageTerm = {
      type: "exclusive",
      terms: [
        [{ type: "command", name: "shown" }],
        [{ type: "command", name: "hidden", hidden: true }],
      ],
    };
    assert.equal(formatUsageTermAsRoff(term), "\\fBshown\\fR");
  });

  it("collapses exclusive with all-hidden branches", () => {
    const term: UsageTerm = {
      type: "exclusive",
      terms: [
        [{ type: "command", name: "a", hidden: true }],
        [{ type: "command", name: "b", hidden: true }],
      ],
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("collapses optional wrapping hidden: 'usage' terms", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [{ type: "argument", metavar: "S", hidden: "usage" }],
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("collapses multiple wrapping hidden: 'usage' terms", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{ type: "argument", metavar: "S", hidden: "usage" }],
      min: 0,
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("removes hidden: 'usage' branches from exclusive terms", () => {
    const term: UsageTerm = {
      type: "exclusive",
      terms: [
        [{ type: "command", name: "shown" }],
        [{ type: "command", name: "secret", hidden: "usage" }],
      ],
    };
    assert.equal(formatUsageTermAsRoff(term), "\\fBshown\\fR");
  });

  it("collapses optional wrapping hidden: 'help' terms", () => {
    const term: UsageTerm = {
      type: "optional",
      terms: [{ type: "argument", metavar: "S", hidden: "help" }],
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("collapses multiple wrapping hidden: 'help' terms", () => {
    const term: UsageTerm = {
      type: "multiple",
      terms: [{ type: "argument", metavar: "S", hidden: "help" }],
      min: 1,
    };
    assert.equal(formatUsageTermAsRoff(term), "");
  });

  it("removes hidden: 'help' branches from exclusive terms", () => {
    const term: UsageTerm = {
      type: "exclusive",
      terms: [
        [{ type: "command", name: "shown" }],
        [{ type: "command", name: "secret", hidden: "help" }],
      ],
    };
    assert.equal(formatUsageTermAsRoff(term), "\\fBshown\\fR");
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

    assert.ok(result.includes('.TH "MYAPP" 1'));
    assert.ok(result.includes(".SH NAME"));
    assert.ok(result.includes("myapp"));
  });

  it("does not duplicate date placeholder with version and manual", () => {
    const page: DocPage = {
      sections: [],
    };

    // When date is omitted but both version and manual are given,
    // .TH must have exactly 5 args: name section date source manual
    const options: ManPageOptions = {
      name: "myapp",
      section: 1,
      version: "1.0.0",
      manual: "User Commands",
    };

    const result = formatDocPageAsMan(page, options);
    const thLine = result.split("\n").find((l) => l.startsWith(".TH"))!;

    assert.equal(
      thLine,
      '.TH "MYAPP" 1 "" "myapp 1.0.0" "User Commands"',
    );
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

  it("escapes quotes in .TH header fields", () => {
    const page: DocPage = {
      sections: [],
    };

    const options: ManPageOptions = {
      name: 'my"app',
      section: 1,
      version: '1.0"beta',
      manual: 'User "Commands"',
    };

    const result = formatDocPageAsMan(page, options);
    const thLine = result.split("\n").find((l) => l.startsWith(".TH"))!;

    assert.equal(
      thLine,
      '.TH "MY\\(dqAPP" 1 "" "my\\(dqapp 1.0\\(dqbeta" "User \\(dqCommands\\(dq"',
    );
  });

  it("treats empty header strings as absent", () => {
    const page: DocPage = { sections: [] };
    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
      date: "",
      version: "",
      manual: "",
    });
    const thLine = result.split("\n").find((l) => l.startsWith(".TH"))!;
    assert.equal(thLine, '.TH "MYAPP" 1');
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
    assert.ok(result.includes('.B "myapp"'));
    assert.ok(result.includes("\\fB\\-\\-verbose\\fR"));
    assert.ok(result.includes("\\fIFILE\\fR"));
  });

  it("escapes literal usage term starting with period in SYNOPSIS", () => {
    const page: DocPage = {
      usage: [{ type: "literal", value: ".env" }],
      sections: [],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".SH SYNOPSIS"));
    assert.ok(result.includes("\\&.env"));
    assert.ok(!result.includes("\n.env\n"));
  });

  it("escapes literal doc entry term starting with period", () => {
    const page: DocPage = {
      sections: [
        {
          entries: [
            {
              term: { type: "literal", value: ".env" },
              description: message`hidden env file`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".TP"));
    assert.ok(result.includes("\\&.env"));
    assert.ok(!result.split("\n").some((l) => l === ".env"));
  });

  it("escapes literal doc entry term starting with single quote", () => {
    const page: DocPage = {
      sections: [
        {
          entries: [
            {
              term: { type: "literal", value: "'quoted" },
              description: message`quoted term`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes("\\&'quoted"));
  });

  it("escapes backslashes in argument metavar in SYNOPSIS", () => {
    const page: DocPage = {
      usage: [{ type: "argument", metavar: "C:\\TMP" }],
      sections: [],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes("\\fIC:\\\\TMP\\fR"));
    assert.ok(!result.includes("\\fIC:\\TMP\\fR"));
  });

  it("escapes backslashes in option metavar in SYNOPSIS", () => {
    const page: DocPage = {
      usage: [{ type: "option", names: ["--dir"], metavar: "C:\\TMP" }],
      sections: [],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes("\\fIC:\\\\TMP\\fR"));
  });

  it("escapes backslashes in argument metavar in doc entry", () => {
    const page: DocPage = {
      sections: [
        {
          entries: [
            {
              term: { type: "argument", metavar: "C:\\TMP" },
              description: message`a path`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".TP"));
    assert.ok(result.includes("\\fIC:\\\\TMP\\fR"));
  });

  it("escapes backslashes in option metavar in doc entry", () => {
    const page: DocPage = {
      sections: [
        {
          entries: [
            {
              term: { type: "option", names: ["--dir"], metavar: "C:\\TMP" },
              description: message`a path`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".TP"));
    assert.ok(result.includes("\\fIC:\\\\TMP\\fR"));
  });

  it("escapes backslashes in section titles", () => {
    const page: DocPage = {
      sections: [
        {
          title: "A\\B",
          entries: [
            {
              term: { type: "argument", metavar: "FILE" },
              description: message`desc`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, minimalOptions);
    assert.ok(result.includes('.SH "A\\(rsB"'));
  });

  it("escapes double quotes in section titles", () => {
    const page: DocPage = {
      sections: [
        {
          title: 'say "hello"',
          entries: [
            {
              term: { type: "argument", metavar: "FILE" },
              description: message`desc`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, minimalOptions);
    assert.ok(result.includes('.SH "SAY \\(dqHELLO\\(dq"'));
  });

  it("escapes combined backslashes and quotes in section titles", () => {
    const page: DocPage = {
      sections: [
        {
          title: 'A\\B "quoted"',
          entries: [
            {
              term: { type: "argument", metavar: "FILE" },
              description: message`desc`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, minimalOptions);
    assert.ok(result.includes('.SH "A\\(rsB \\(dqQUOTED\\(dq"'));
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

    assert.ok(result.includes('.SH "OPTIONS"'));
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

    assert.ok(result.includes('.SH "COMMANDS"'));
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

    assert.ok(!result.includes('.SH "EMPTY"'));
  });

  it("infers COMMANDS heading for untitled command-only sections", () => {
    const page: DocPage = {
      sections: [{
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
      }],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes('.SH "COMMANDS"'));
    assert.ok(!result.includes('.SH "OPTIONS"'));
  });

  it("infers ARGUMENTS heading for untitled argument-only sections", () => {
    const page: DocPage = {
      sections: [{
        entries: [
          {
            term: { type: "argument", metavar: "INPUT" },
          },
        ],
      }],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes('.SH "ARGUMENTS"'));
    assert.ok(!result.includes('.SH "OPTIONS"'));
  });

  it("infers OPTIONS heading for untitled option-only sections", () => {
    const page: DocPage = {
      sections: [{
        entries: [
          {
            term: { type: "option", names: ["--verbose"] },
            description: message`Enable verbose output.`,
          },
        ],
      }],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes('.SH "OPTIONS"'));
  });

  it("falls back to OPTIONS for untitled mixed sections", () => {
    const page: DocPage = {
      sections: [{
        entries: [
          {
            term: { type: "option", names: ["--verbose"] },
            description: message`Enable verbose output.`,
          },
          {
            term: { type: "command", name: "build" },
            description: message`Build the project.`,
          },
        ],
      }],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes('.SH "OPTIONS"'));
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

  it("falls back to page.author when options.author is absent", () => {
    const page: DocPage = {
      sections: [],
      author: message`Page Author`,
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".SH AUTHOR"));
    assert.ok(result.includes("Page Author"));
  });

  it("prefers options.author over page.author", () => {
    const page: DocPage = {
      sections: [],
      author: message`Page Author`,
    };

    const options: ManPageOptions = {
      ...minimalOptions,
      author: message`Options Author`,
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes("Options Author"));
    assert.ok(!result.includes("Page Author"));
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

  it("falls back to page.bugs when options.bugs is absent", () => {
    const page: DocPage = {
      sections: [],
      bugs: message`Page Bugs`,
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".SH BUGS"));
    assert.ok(result.includes("Page Bugs"));
  });

  it("prefers options.bugs over page.bugs", () => {
    const page: DocPage = {
      sections: [],
      bugs: message`Page Bugs`,
    };

    const options: ManPageOptions = {
      ...minimalOptions,
      bugs: message`Options Bugs`,
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes("Options Bugs"));
    assert.ok(!result.includes("Page Bugs"));
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

  it("falls back to page.examples when options.examples is absent", () => {
    const page: DocPage = {
      sections: [],
      examples: message`Page Examples`,
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes(".SH EXAMPLES"));
    assert.ok(result.includes("Page Examples"));
  });

  it("prefers options.examples over page.examples", () => {
    const page: DocPage = {
      sections: [],
      examples: message`Page Examples`,
    };

    const options: ManPageOptions = {
      ...minimalOptions,
      examples: message`Options Examples`,
    };

    const result = formatDocPageAsMan(page, options);

    assert.ok(result.includes("Options Examples"));
    assert.ok(!result.includes("Page Examples"));
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
    assert.ok(result.includes('.BR "git" (1),'));
    assert.ok(result.includes('.BR "make" (1)'));
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

  it("generates FILES section", () => {
    const page: DocPage = {
      sections: [],
    };

    const filesSection: DocSection = {
      entries: [
        {
          term: { type: "argument", metavar: "/etc/myapp.conf" },
          description: message`Primary configuration file.`,
        },
      ],
    };

    const options: ManPageOptions = {
      ...minimalOptions,
      files: filesSection,
    };

    const result = formatDocPageAsMan(page, options);
    assert.ok(result.includes(".SH FILES"));
    assert.ok(result.includes("Primary configuration file."));
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

  it("renders default when description is omitted", () => {
    const section: DocSection = {
      title: "Options",
      entries: [
        {
          term: { type: "option", names: ["--mode"], metavar: "MODE" },
          default: message`safe`,
        },
      ],
    };

    const page: DocPage = {
      sections: [section],
    };

    const result = formatDocPageAsMan(page, minimalOptions);
    assert.ok(result.includes('.SH "OPTIONS"'));
    assert.ok(result.includes("\\fB\\-\\-mode\\fR \\fIMODE\\fR"));
    assert.ok(result.includes("[safe]"));
  });

  it("handles entries with choices", () => {
    const section: DocSection = {
      title: "Options",
      entries: [
        {
          term: { type: "option", names: ["--mode"], metavar: "MODE" },
          description: message`Select mode.`,
          choices: message`fast, slow`,
        },
      ],
    };

    const page: DocPage = {
      sections: [section],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes("Select mode."));
    assert.ok(result.includes("(choices: fast, slow)"));
  });

  it("renders choices when description is omitted", () => {
    const section: DocSection = {
      title: "Options",
      entries: [
        {
          term: { type: "option", names: ["--mode"], metavar: "MODE" },
          choices: message`fast, slow`,
        },
      ],
    };

    const page: DocPage = {
      sections: [section],
    };

    const result = formatDocPageAsMan(page, minimalOptions);
    assert.ok(result.includes("\\fB\\-\\-mode\\fR \\fIMODE\\fR"));
    assert.ok(result.includes("(choices: fast, slow)"));
  });

  it("handles entries with both default and choices", () => {
    const section: DocSection = {
      title: "Options",
      entries: [
        {
          term: { type: "option", names: ["--port"], metavar: "NUM" },
          description: message`Port to listen on.`,
          default: message`8080`,
          choices: message`80, 443, 8080`,
        },
      ],
    };

    const page: DocPage = {
      sections: [section],
    };

    const result = formatDocPageAsMan(page, minimalOptions);

    assert.ok(result.includes("Port to listen on."));
    assert.ok(result.includes("[8080]"));
    assert.ok(result.includes("(choices: 80, 443, 8080)"));
  });

  it("supports usage formatter fallback for doc entry terms", () => {
    const section: DocSection = {
      title: "Examples",
      entries: [
        {
          term: {
            type: "optional",
            terms: [{ type: "argument", metavar: "X" }],
          },
          description: message`Optional value.`,
        },
      ],
    };

    const page: DocPage = {
      sections: [section],
    };

    const result = formatDocPageAsMan(page, minimalOptions);
    assert.ok(result.includes('.SH "EXAMPLES"'));
    assert.ok(result.includes("[\\fIX\\fR]"));
    assert.ok(result.includes("Optional value."));
  });

  it("uses different section numbers", () => {
    const page: DocPage = { sections: [] };

    for (const section of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      const result = formatDocPageAsMan(page, { name: "myapp", section });
      assert.ok(result.includes(`.TH "MYAPP" ${section}`));
    }
  });

  it("uppercases program name in .TH", () => {
    const page: DocPage = { sections: [] };

    const result = formatDocPageAsMan(page, { name: "my-app", section: 1 });
    assert.ok(result.includes('.TH "MY\\-APP" 1'));
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
    const optionsPos = result.indexOf('.SH "OPTIONS"');
    const seeAlsoPos = result.indexOf(".SH SEE ALSO");
    const authorPos = result.indexOf(".SH AUTHOR");

    assert.ok(namePos < synopsisPos);
    assert.ok(synopsisPos < descPos);
    assert.ok(descPos < optionsPos);
    assert.ok(optionsPos < seeAlsoPos);
    assert.ok(seeAlsoPos < authorPos);
  });

  it("skips doc entries with doc-hidden terms entirely", () => {
    const page: DocPage = {
      sections: [
        {
          title: "OPTIONS",
          entries: [
            {
              term: { type: "option", names: ["--visible"], hidden: false },
              description: message`A visible option`,
            },
            {
              term: { type: "option", names: ["--secret"], hidden: "doc" },
              description: message`A secret option`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    assert.ok(result.includes("\\-\\-visible"));
    assert.ok(!result.includes("\\-\\-secret"));
    assert.ok(!result.includes("A secret option"));
  });

  it("suppresses nested doc-hidden terms inside wrapper doc entries", () => {
    const page: DocPage = {
      sections: [
        {
          title: "OPTIONS",
          entries: [
            {
              term: {
                type: "optional",
                terms: [
                  { type: "argument", metavar: "SECRET", hidden: "doc" },
                ],
              },
              description: message`A wrapped secret`,
            },
            {
              term: { type: "option", names: ["--keep"] },
              description: message`A visible option`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    assert.ok(!result.includes("SECRET"));
    assert.ok(!result.includes("A wrapped secret"));
    assert.ok(result.includes("\\-\\-keep"));
  });

  it("collapses multiple wrapping doc-hidden terms in doc sections", () => {
    const page: DocPage = {
      sections: [
        {
          title: "OPTIONS",
          entries: [
            {
              term: {
                type: "multiple",
                terms: [
                  { type: "argument", metavar: "SECRET", hidden: "doc" },
                ],
                min: 0,
              },
              description: message`A repeated secret`,
            },
            {
              term: { type: "option", names: ["--keep"] },
              description: message`Kept`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    assert.ok(!result.includes("SECRET"));
    assert.ok(!result.includes("A repeated secret"));
    assert.ok(result.includes("\\-\\-keep"));
  });

  it("removes doc-hidden branches from exclusive in doc sections", () => {
    const page: DocPage = {
      sections: [
        {
          title: "COMMANDS",
          entries: [
            {
              term: {
                type: "exclusive",
                terms: [
                  [{ type: "command", name: "public" }],
                  [{ type: "command", name: "internal", hidden: "doc" }],
                ],
              },
              description: message`A command group`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    assert.ok(result.includes("public"));
    assert.ok(!result.includes("internal"));
    assert.ok(!result.includes(" | "));
  });

  it("keeps hidden: 'usage' terms visible in doc sections", () => {
    const page: DocPage = {
      sections: [
        {
          title: "OPTIONS",
          entries: [
            {
              term: {
                type: "option",
                names: ["--internal"],
                hidden: "usage",
              },
              description: message`An internal option`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    assert.ok(result.includes("\\-\\-internal"));
    assert.ok(result.includes("An internal option"));
  });

  it("keeps nested hidden: 'usage' terms visible in doc wrappers", () => {
    const page: DocPage = {
      sections: [
        {
          title: "OPTIONS",
          entries: [
            {
              term: {
                type: "optional",
                terms: [
                  {
                    type: "argument",
                    metavar: "INTERNAL",
                    hidden: "usage",
                  },
                ],
              },
              description: message`A wrapped usage-hidden term`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    assert.ok(result.includes("INTERNAL"));
    assert.ok(result.includes("A wrapped usage-hidden term"));
  });

  it("omits section header when all entries are doc-hidden", () => {
    const page: DocPage = {
      sections: [
        {
          title: "SECRET",
          entries: [
            {
              term: { type: "option", names: ["--a"], hidden: "doc" },
              description: message`Hidden A`,
            },
            {
              term: { type: "option", names: ["--b"], hidden: true },
              description: message`Hidden B`,
            },
          ],
        },
        {
          title: "VISIBLE",
          entries: [
            {
              term: { type: "option", names: ["--keep"] },
              description: message`Kept`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    assert.ok(!result.includes('.SH "SECRET"'));
    assert.ok(result.includes('.SH "VISIBLE"'));
    assert.ok(result.includes("\\-\\-keep"));
  });

  it("uses comma separator for nested option names in doc wrappers", () => {
    const page: DocPage = {
      sections: [
        {
          title: "OPTIONS",
          entries: [
            {
              term: {
                type: "optional",
                terms: [
                  { type: "option", names: ["-v", "--verbose"] },
                ],
              },
              description: message`Verbose output`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    assert.ok(result.includes("\\fB\\-v\\fR, \\fB\\-\\-verbose\\fR"));
    assert.ok(!result.includes(" | "));
  });

  it("keeps hidden: 'doc' option in SYNOPSIS but omits from doc section", () => {
    const page: DocPage = {
      usage: [
        { type: "option", names: ["--visible"], metavar: "VISIBLE" },
        {
          type: "option",
          names: ["--doc-hidden"],
          metavar: "SECRET",
          hidden: "doc",
        },
      ],
      sections: [
        {
          title: "OPTIONS",
          entries: [
            {
              term: {
                type: "option",
                names: ["--visible"],
                metavar: "VISIBLE",
              },
              description: message`A visible option`,
            },
            {
              term: {
                type: "option",
                names: ["--doc-hidden"],
                metavar: "SECRET",
                hidden: "doc",
              },
              description: message`A doc-hidden option`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    // SYNOPSIS should contain both options
    const synopsisStart = result.indexOf(".SH SYNOPSIS");
    assert.notEqual(synopsisStart, -1);
    const nextSection = result.indexOf(".SH", synopsisStart + 1);
    assert.notEqual(nextSection, -1);
    const synopsis = result.slice(synopsisStart, nextSection);
    assert.ok(synopsis.includes("\\-\\-visible"));
    assert.ok(synopsis.includes("\\-\\-doc\\-hidden"));

    // OPTIONS section should only contain the visible option
    const optionsStart = result.indexOf('.SH "OPTIONS"');
    assert.notEqual(optionsStart, -1);
    const optionsSection = result.slice(optionsStart);
    assert.ok(optionsSection.includes("\\-\\-visible"));
    assert.ok(!optionsSection.includes("\\-\\-doc\\-hidden"));
    assert.ok(!optionsSection.includes("A doc-hidden option"));
  });

  it("keeps hidden: 'doc' command in SYNOPSIS but omits from doc section", () => {
    const page: DocPage = {
      usage: [
        {
          type: "exclusive",
          terms: [
            [{ type: "command", name: "visible" }],
            [{ type: "command", name: "doc-hidden", hidden: "doc" }],
          ],
        },
      ],
      sections: [
        {
          title: "COMMANDS",
          entries: [
            {
              term: { type: "command", name: "visible" },
              description: message`A visible command`,
            },
            {
              term: { type: "command", name: "doc-hidden", hidden: "doc" },
              description: message`A doc-hidden command`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    // SYNOPSIS should contain both commands
    const synopsisStart = result.indexOf(".SH SYNOPSIS");
    assert.notEqual(synopsisStart, -1);
    const nextSection = result.indexOf(".SH", synopsisStart + 1);
    assert.notEqual(nextSection, -1);
    const synopsis = result.slice(synopsisStart, nextSection);
    assert.ok(synopsis.includes("\\fBvisible\\fR"));
    assert.ok(synopsis.includes("\\fBdoc\\-hidden\\fR"));

    // COMMANDS section should only contain the visible command
    const commandsStart = result.indexOf('.SH "COMMANDS"');
    assert.notEqual(commandsStart, -1);
    const commandsSection = result.slice(commandsStart);
    assert.ok(commandsSection.includes("\\fBvisible\\fR"));
    assert.ok(!commandsSection.includes("\\fBdoc\\-hidden\\fR"));
    assert.ok(!commandsSection.includes("A doc-hidden command"));
  });

  it("keeps hidden: 'doc' argument in SYNOPSIS but omits from doc section", () => {
    const page: DocPage = {
      usage: [
        { type: "argument", metavar: "VISIBLE" },
        { type: "argument", metavar: "SECRET", hidden: "doc" },
      ],
      sections: [
        {
          title: "ARGUMENTS",
          entries: [
            {
              term: { type: "argument", metavar: "VISIBLE" },
              description: message`A visible argument`,
            },
            {
              term: { type: "argument", metavar: "SECRET", hidden: "doc" },
              description: message`A doc-hidden argument`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "myapp",
      section: 1,
    });

    // SYNOPSIS should contain both arguments
    const synopsisStart = result.indexOf(".SH SYNOPSIS");
    assert.notEqual(synopsisStart, -1);
    const nextSection = result.indexOf(".SH", synopsisStart + 1);
    assert.notEqual(nextSection, -1);
    const synopsis = result.slice(synopsisStart, nextSection);
    assert.ok(synopsis.includes("\\fIVISIBLE\\fR"));
    assert.ok(synopsis.includes("\\fISECRET\\fR"));

    // ARGUMENTS section should only contain the visible argument
    const argsStart = result.indexOf('.SH "ARGUMENTS"');
    assert.notEqual(argsStart, -1);
    const argsSection = result.slice(argsStart);
    assert.ok(argsSection.includes("\\fIVISIBLE\\fR"));
    assert.ok(!argsSection.includes("\\fISECRET\\fR"));
    assert.ok(!argsSection.includes("A doc-hidden argument"));
  });

  it("escapes hyphens in program name", () => {
    const page: DocPage = {
      brief: message`A test app.`,
      usage: [{ type: "argument", metavar: "FILE" }],
      sections: [],
    };

    const result = formatDocPageAsMan(page, {
      name: "my-app",
      section: 1,
      version: "1.0",
    });

    assert.ok(result.includes('.TH "MY\\-APP" 1'));
    assert.ok(result.includes("my\\-app \\- A test app."));
    assert.ok(result.includes('.B "my\\-app"'));
    assert.ok(result.includes('"my\\-app 1.0"'));
  });

  it("escapes hyphens in program name without brief", () => {
    const page: DocPage = {
      usage: [{ type: "argument", metavar: "FILE" }],
      sections: [],
    };

    const result = formatDocPageAsMan(page, {
      name: "my-app",
      section: 1,
    });

    const nameStart = result.indexOf(".SH NAME");
    const nextSection = result.indexOf(".SH", nameStart + 1);
    const nameSection = result.slice(nameStart, nextSection);
    assert.ok(nameSection.includes("my\\-app"));
    assert.ok(!nameSection.includes("my-app"));
  });

  it("escapes hyphens in command entry terms", () => {
    const page: DocPage = {
      usage: [{ type: "command", name: "dry-run" }],
      sections: [
        {
          title: "Commands",
          entries: [
            {
              term: { type: "command", name: "dry-run" },
              description: message`Dry run.`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "test",
      section: 1,
    });

    assert.ok(result.includes("\\fBdry\\-run\\fR"));
    assert.ok(!result.includes("\\fBdry-run\\fR"));
  });

  it("escapes hyphens in SEE ALSO references", () => {
    const page: DocPage = {
      usage: [],
      sections: [],
    };

    const result = formatDocPageAsMan(page, {
      name: "test",
      section: 1,
      seeAlso: [
        { name: "git-fast", section: 1 },
        { name: "git-log", section: 1 },
      ],
    });

    assert.ok(result.includes('.BR "git\\-fast" (1),'));
    assert.ok(result.includes('.BR "git\\-log" (1)'));
    assert.ok(!result.includes(".BR git-fast"));
    assert.ok(!result.includes(".BR git-log"));
  });

  it("escapes roff special characters in program name", () => {
    const page: DocPage = {
      brief: message`A test app.`,
      usage: [{ type: "argument", metavar: "FILE" }],
      sections: [],
    };

    const result = formatDocPageAsMan(page, {
      name: "app\\bin",
      section: 1,
    });

    assert.ok(result.includes("app\\\\bin \\-"));
    assert.ok(result.includes('.B "app\\(rsbin"'));
    // .TH is also a request argument context, so backslash → \(rs
    const thLine = result.split("\n").find((l) => l.startsWith(".TH"))!;
    assert.ok(thLine.startsWith('.TH "APP\\(rsBIN"'));
  });

  it("escapes roff special characters in command entry terms", () => {
    const page: DocPage = {
      usage: [{ type: "command", name: "cmd\\arg" }],
      sections: [
        {
          title: "Commands",
          entries: [
            {
              term: { type: "command", name: "cmd\\arg" },
              description: message`Run command.`,
            },
          ],
        },
      ],
    };

    const result = formatDocPageAsMan(page, {
      name: "test",
      section: 1,
    });

    assert.ok(result.includes("\\fBcmd\\\\arg\\fR"));
  });

  it("escapes roff special characters in SEE ALSO references", () => {
    const page: DocPage = {
      usage: [],
      sections: [],
    };

    const result = formatDocPageAsMan(page, {
      name: "test",
      section: 1,
      seeAlso: [{ name: "app\\bin", section: 1 }],
    });

    assert.ok(result.includes('.BR "app\\(rsbin" (1)'));
  });

  it("quotes program name with spaces in .TH and SYNOPSIS", () => {
    const page: DocPage = {
      brief: message`A test app.`,
      usage: [{ type: "argument", metavar: "FILE" }],
      sections: [],
    };

    const result = formatDocPageAsMan(page, {
      name: "my app",
      section: 1,
    });

    const thLine = result.split("\n").find((l) => l.startsWith(".TH"))!;
    assert.ok(thLine.startsWith('.TH "MY APP" 1'));
    assert.ok(result.includes('.B "my app"'));
    assert.ok(result.includes("my app \\-"));
  });

  it("escapes quotes in .B program name", () => {
    const page: DocPage = {
      usage: [{ type: "argument", metavar: "FILE" }],
      sections: [],
    };

    const result = formatDocPageAsMan(page, {
      name: 'my"app',
      section: 1,
    });

    assert.ok(result.includes('.B "my\\(dqapp"'));
  });

  it("quotes SEE ALSO names with spaces", () => {
    const page: DocPage = {
      sections: [],
    };

    const result = formatDocPageAsMan(page, {
      name: "test",
      section: 1,
      seeAlso: [{ name: "my app", section: 1 }],
    });

    assert.ok(result.includes('.BR "my app" (1)'));
  });

  it("escapes quotes in SEE ALSO names", () => {
    const page: DocPage = {
      sections: [],
    };

    const result = formatDocPageAsMan(page, {
      name: "test",
      section: 1,
      seeAlso: [{ name: 'my"app', section: 1 }],
    });

    assert.ok(result.includes('.BR "my\\(dqapp" (1)'));
  });

  it("rejects empty name", () => {
    const page: DocPage = {
      sections: [],
    };

    assert.throws(
      () => formatDocPageAsMan(page, { name: "", section: 1 }),
      TypeError,
    );
  });

  it("rejects invalid section numbers", () => {
    const page: DocPage = {
      sections: [],
    };

    for (const section of [0, 9, -1, 99, 1.5] as never[]) {
      assert.throws(
        () => formatDocPageAsMan(page, { name: "myapp", section }),
        RangeError,
      );
    }
  });

  it("rejects invalid seeAlso section numbers", () => {
    const page: DocPage = {
      sections: [],
    };

    for (const section of [0, 9, -1, 99, 1.5] as never[]) {
      assert.throws(
        () =>
          formatDocPageAsMan(page, {
            name: "myapp",
            section: 1,
            seeAlso: [{ name: "git", section }],
          }),
        RangeError,
      );
    }
  });

  it("renders static usageLine override via getDocPage() in SYNOPSIS", async () => {
    const parser = command(
      "serve",
      or(
        command("start", constant("start")),
        command("stop", constant("stop")),
      ),
      {
        usageLine: [{ type: "literal", value: "serve-custom" }],
      },
    );

    // No args — getDocPage resolves usageLine for the top-level command.
    const page = await getDocPage(parser);
    assert.ok(page);
    const result = formatDocPageAsMan(page, minimalOptions);

    const synopsisStart = result.indexOf(".SH SYNOPSIS");
    assert.notEqual(synopsisStart, -1);
    const nextSection = result.indexOf(".SH", synopsisStart + 1);
    const synopsis = nextSection === -1
      ? result.slice(synopsisStart)
      : result.slice(synopsisStart, nextSection);

    assert.ok(synopsis.includes("\\fBserve\\fR"));
    assert.ok(synopsis.includes("serve-custom"));
    // Default subcommands should be replaced by the usageLine override
    assert.ok(!synopsis.includes("\\fBstart\\fR"));
    assert.ok(!synopsis.includes("\\fBstop\\fR"));
  });

  it("renders function usageLine override via getDocPage() in SYNOPSIS", async () => {
    const parser = command(
      "config",
      or(
        command("get", constant("get")),
        command("set", constant("set")),
      ),
      {
        usageLine: (defaultUsage) => [
          { type: "literal", value: "SUBCOMMAND" },
          ...defaultUsage,
        ],
      },
    );

    // With args — getDocPage resolves usageLine for navigated command.
    const page = await getDocPage(parser, ["config"]);
    assert.ok(page);
    const result = formatDocPageAsMan(page, minimalOptions);

    const synopsisStart = result.indexOf(".SH SYNOPSIS");
    assert.notEqual(synopsisStart, -1);
    const nextSection = result.indexOf(".SH", synopsisStart + 1);
    const synopsis = nextSection === -1
      ? result.slice(synopsisStart)
      : result.slice(synopsisStart, nextSection);

    assert.ok(synopsis.includes("\\fBconfig\\fR"));
    assert.ok(synopsis.includes("SUBCOMMAND"));
    // "SUBCOMMAND" should appear exactly once (not duplicated)
    const firstIdx = synopsis.indexOf("SUBCOMMAND");
    const secondIdx = synopsis.indexOf("SUBCOMMAND", firstIdx + 1);
    assert.equal(secondIdx, -1, "SUBCOMMAND should not appear twice");
  });

  it("skips ancestor usageLine on subcommand man pages", async () => {
    const parser = command(
      "config",
      or(
        command("get", constant("get")),
        command("set", constant("set")),
      ),
      {
        usageLine: [{ type: "ellipsis" }],
      },
    );

    const page = await getDocPage(parser, ["config", "get"]);
    assert.ok(page);
    const result = formatDocPageAsMan(page, minimalOptions);

    const synopsisStart = result.indexOf(".SH SYNOPSIS");
    assert.notEqual(synopsisStart, -1);
    const nextSection = result.indexOf(".SH", synopsisStart + 1);
    const synopsis = nextSection === -1
      ? result.slice(synopsisStart)
      : result.slice(synopsisStart, nextSection);

    assert.ok(synopsis.includes("\\fBget\\fR"));
    assert.ok(synopsis.includes("\\fBconfig\\fR"));
    assert.ok(
      !synopsis.includes("..."),
      "ancestor usageLine should not be applied on subcommand page",
    );
  });
});
