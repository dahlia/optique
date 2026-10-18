import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DocPage } from "@optique/core/doc";
import { message } from "@optique/core/message";
import type { HiddenVisibility, UsageTerm } from "@optique/core/usage";
import {
  formatCommandReference,
  getCommandReferenceAnchor,
  type MarkdownCommandEntry,
  type MarkdownReferenceOptions,
} from "#src/markdown.ts";

const options: MarkdownReferenceOptions = {
  name: "tool",
  coverage: {
    commands: "all-visible",
    help: "excluded",
    version: "excluded",
    completion: "excluded",
  },
};
const empty: DocPage = { sections: [] };

it("escapes terminal controls in usage while preserving line breaks", () => {
  const rendered = formatCommandReference([{
    path: [],
    page: {
      sections: [],
      usage: [{ type: "literal", value: "first\n\u001b[2J\u0085second" }],
    },
  }], options);
  assert.ok(!rendered.includes("\u001b"));
  assert.ok(!rendered.includes("\u0085"));
  assert.ok(rendered.includes("first\n\\u001b[2J\\u0085second"));
});

it("rejects C1 controls in tokens and renders controls in text visibly", () => {
  assert.throws(() => getCommandReferenceAnchor(["\u0085"]), TypeError);
  assert.throws(() =>
    formatCommandReference([
      root("serve"),
      { path: ["serve"], page: empty, aliases: ["\u0085"] },
    ], options), TypeError);
  const rendered = formatCommandReference([
    {
      path: [],
      page: {
        sections: [],
        description: [{ type: "text", text: "NEL\u0085" }],
      },
    },
  ], options);
  assert.ok(!rendered.includes("\u0085"));
  assert.ok(rendered.includes("0085"));
});

it("rejects malformed omission scope from JavaScript callers", () => {
  const gap = { path: [], scope: "page" as const, reason: "missing" };
  Reflect.set(gap, "scope", "<img src=x onerror=alert(1)>");
  assert.throws(() =>
    formatCommandReference([root()], {
      ...options,
      coverage: { ...options.coverage, commands: "partial" },
      unresolved: [gap],
    }), /scope/i);
});
const command = (name: string): Extract<UsageTerm, { type: "command" }> => ({
  type: "command",
  name,
});
const root = (...names: string[]): MarkdownCommandEntry => ({
  path: [],
  page: {
    sections: [{
      title: "Commands",
      entries: names.map((name) => ({ term: command(name) })),
    }],
  },
});

describe("formatCommandReference()", () => {
  it("renders a deterministic three-command reference in caller order", () => {
    const entries = [
      root("alpha", "beta", "gamma"),
      ...["gamma", "alpha", "beta"].map((name) => ({
        path: [name],
        page: empty,
      })),
    ];
    const rendered = formatCommandReference(entries, options);
    assert.equal(
      rendered,
      readFileSync(
        new URL(
          "../test/fixtures/markdown-reference/three-commands.expected.txt",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(rendered, formatCommandReference(entries, options));
    assert.ok(
      rendered.indexOf("## `tool gamma`") < rendered.indexOf("## `tool alpha`"),
    );
    assert.ok(
      rendered.indexOf("## `tool alpha`") < rendered.indexOf("## `tool beta`"),
    );
    assert.match(rendered, /author-declared/);
    assert.match(rendered, /all visible commands/);
    assert.match(rendered, /help: not documented here \(if configured\)/);
    for (const entry of entries) {
      const anchor = getCommandReferenceAnchor(entry.path);
      assert.match(
        rendered,
        new RegExp(`id="${anchor.replaceAll(".", "\\.")}"`),
      );
      assert.ok(rendered.includes(`href="#${anchor}"`));
    }
    assert.ok(rendered.endsWith("\n"));
    assert.ok(!rendered.includes("undefined"));
  });

  it("renders nested pages, shared inputs and every documentation field", () => {
    const verbose: UsageTerm = { type: "option", names: ["-v", "--verbose"] };
    const entries: readonly MarkdownCommandEntry[] = [
      root("config"),
      {
        path: ["config"],
        page: {
          sections: [{
            entries: [{ term: command("get") }, { term: command("set") }],
          }],
        },
      },
      {
        path: ["config", "get"],
        aliases: ["g"],
        page: {
          brief: message`Read a setting.`,
          description: message`Reads the current setting.`,
          usage: [command("config"), command("get"), {
            type: "optional",
            terms: [verbose],
          }, {
            type: "multiple",
            terms: [{ type: "argument", metavar: "KEY" }],
            min: 1,
          }],
          sections: [{
            title: "Shared options",
            entries: [{
              term: verbose,
              description: message`Detailed output.`,
            }],
          }, {
            title: "Settings",
            entries: [{
              term: { type: "option", names: ["--format"], metavar: "FORMAT" },
              default: message`json`,
              choices: message`json, text`,
              envVars: ["TOOL_FORMAT"],
              description: message`Output format.`,
            }],
          }],
          examples: message`tool config get theme`,
          environmentBindings: [{
            name: "TOOL_HOME",
            description: message`Settings directory.`,
          }, { name: "HIDDEN_BINDING", hidden: "doc" }],
          author: message`Maintainers`,
          bugs: message`Report a problem.`,
          footer: message`Read only.`,
        },
      },
      { path: ["config", "set"], page: empty },
    ];
    const rendered = formatCommandReference(entries, {
      ...options,
      version: "1.2.3",
      showAliases: true,
      examples: message`tool docs`,
    });
    for (
      const content of [
        "Read a setting",
        "Reads the current setting",
        "Shared options",
        "Settings",
        "Detailed output",
        "Output format",
        "json",
        "text",
        "TOOL_FORMAT",
        "TOOL_HOME",
        "Settings directory",
        "tool config get theme",
        "Maintainers",
        "Report a problem",
        "Read only",
        "1.2.3",
        "tool docs",
      ]
    ) assert.ok(rendered.includes(content), content);
    assert.ok(rendered.includes("tool config get [-v/--verbose] KEY..."));
    assert.ok(!rendered.includes("tool config get config get"));
    assert.ok(!rendered.includes("HIDDEN_BINDING"));
    assert.ok(rendered.includes("tool config g"));
  });

  it("keeps identical leaf names under different parents distinct", () => {
    const entries = [
      root("local", "remote"),
      ...["local", "remote"].flatMap((parent) => [
        {
          path: [parent],
          page: { sections: [{ entries: [{ term: command("get") }] }] },
        },
        { path: [parent, "get"], aliases: ["g"], page: empty },
      ]),
    ];
    const rendered = formatCommandReference(entries, {
      ...options,
      showAliases: true,
    });
    for (const parent of ["local", "remote"]) {
      assert.ok(
        rendered.includes(
          `href="#${getCommandReferenceAnchor([parent, "get"])}"`,
        ),
      );
    }
    assert.notEqual(
      getCommandReferenceAnchor(["local", "get"]),
      getCommandReferenceAnchor(["remote", "get"]),
    );
  });

  it("filters hidden sections and descendants while retaining doc-hidden usage terms", () => {
    const hidden: readonly HiddenVisibility[] = [true, "doc", "help"];
    for (const visibility of hidden) {
      const rendered = formatCommandReference([
        {
          ...root("secret", "visible"),
          page: {
            ...root("secret", "visible").page,
            usage: [
              { ...command("secret"), hidden: "doc" },
              command("visible"),
            ],
          },
        },
        {
          path: ["secret"],
          hidden: visibility,
          page: { sections: [{ entries: [{ term: command("missing") }] }] },
        },
        { path: ["secret", "child"], page: empty },
        { path: ["visible"], page: empty },
      ], options);
      assert.ok(rendered.includes("tool secret visible"));
      assert.ok(
        !rendered.includes(`href="#${getCommandReferenceAnchor(["secret"])}"`),
      );
      assert.ok(!rendered.includes("missing"));
      assert.ok(!rendered.includes("tool secret child"));
    }
  });

  it("retains usage-hidden command sections and documentation entries", () => {
    const rendered = formatCommandReference([
      {
        path: [],
        page: {
          usage: [{ ...command("quiet"), hidden: "usage" }],
          sections: [{
            entries: [{ term: { ...command("quiet"), hidden: "usage" } }],
          }],
        },
      },
      { path: ["quiet"], hidden: "usage", page: empty },
    ], options);
    assert.ok(rendered.includes("## `tool quiet`"));
    assert.ok(
      rendered.includes(`href="#${getCommandReferenceAnchor(["quiet"])}"`),
    );
    assert.ok(!rendered.includes("\ntool quiet\n"));
  });

  it("honors page/formatter showUsage and never calls usage callbacks", () => {
    const usage: readonly UsageTerm[] = [{
      ...command("shown"),
      usageLine() {
        throw new Error("Do not call.");
      },
    }];
    const entries = [{
      path: [],
      page: { usage, showUsage: false, sections: [] },
    }];
    assert.ok(!formatCommandReference(entries, options).includes("### Usage"));
    assert.ok(
      formatCommandReference(entries, { ...options, showUsage: true }).includes(
        "tool shown",
      ),
    );
    assert.ok(
      !formatCommandReference([{ path: [], page: { usage, sections: [] } }], {
        ...options,
        showUsage: false,
      }).includes("### Usage"),
    );
  });

  it("uses entry aliases and local display policy without exposing hidden aliases", () => {
    const entries: readonly MarkdownCommandEntry[] = [
      {
        path: [],
        page: {
          sections: [{
            entries: [{
              term: { ...command("get"), aliases: ["wrong"] },
              showAliases: true,
            }],
          }],
        },
      },
      {
        path: ["get"],
        aliases: ["g", "secret"],
        hiddenAliases: ["secret"],
        showAliases: false,
        page: empty,
      },
    ];
    const rendered = formatCommandReference(entries, options);
    assert.ok(rendered.includes("<code>g</code>"));
    assert.ok(!rendered.includes("tool g</code>"));
    assert.ok(!rendered.includes("secret"));
    assert.ok(!rendered.includes("wrong"));
    assert.ok(
      !formatCommandReference([root("get"), entries[1]], options).includes(
        "<code>g</code>",
      ),
    );
  });

  it("rejects duplicate paths and ambiguous spellings even when hidden", () => {
    assert.throws(
      () => formatCommandReference([root(), root()], options),
      /Duplicate command path/,
    );
    for (const hidden of [undefined, "doc"] as const) {
      assert.throws(() =>
        formatCommandReference([
          root("add", "audit"),
          { path: ["add"], aliases: ["a"], page: empty },
          { path: ["audit"], aliases: ["a"], hidden, page: empty },
        ], options), /Ambiguous command spelling/);
    }
    assert.throws(
      () =>
        formatCommandReference([root("a", "b"), {
          path: ["a"],
          hiddenAliases: ["b"],
          page: empty,
        }, { path: ["b"], page: empty }], options),
      /Ambiguous command spelling/,
    );
    assert.doesNotThrow(() =>
      formatCommandReference([root("a"), {
        path: ["a"],
        aliases: ["a", "a"],
        page: empty,
      }], options)
    );
  });

  it("checks visible child sections and prefixes and labels partial coverage", () => {
    assert.throws(
      () => formatCommandReference([root("missing")], options),
      /Missing command pages/,
    );
    assert.throws(
      () =>
        formatCommandReference(
          [{ path: ["config", "get"], page: empty }],
          options,
        ),
      /Missing command pages/,
    );
    const rendered = formatCommandReference([root("missing"), {
      path: ["config", "get"],
      page: empty,
    }], {
      ...options,
      coverage: { ...options.coverage, commands: "partial", help: "included" },
    });
    assert.match(rendered, /partial/);
    assert.match(rendered, /Missing command pages/);
    assert.ok(rendered.includes("tool missing"));
    assert.ok(
      !rendered.includes(`href="#${getCommandReferenceAnchor(["missing"])}"`),
    );
    assert.match(rendered, /help: included/);
  });

  it("skips doc-hidden references before coverage checks", () => {
    assert.doesNotThrow(() =>
      formatCommandReference([{
        path: [],
        page: {
          sections: [{
            entries: [{ term: { ...command("secret"), hidden: "doc" } }],
          }],
        },
      }], options)
    );
  });

  it("validates paths and root metadata, preserving delimiter and Unicode identities", () => {
    for (const segment of ["", "two words", "line\nbreak", "\ud800"]) {
      assert.throws(() => getCommandReferenceAnchor([segment]), TypeError);
    }
    assert.notEqual(
      getCommandReferenceAnchor(["a/b"]),
      getCommandReferenceAnchor(["a", "b"]),
    );
    assert.notEqual(
      getCommandReferenceAnchor(["한글"]),
      getCommandReferenceAnchor(["한글", "a"]),
    );
    assert.throws(
      () =>
        formatCommandReference([{
          path: [],
          aliases: ["root-alias"],
          page: empty,
        }], options),
      /root/i,
    );
    assert.throws(
      () =>
        formatCommandReference([root(), {
          path: ["a"],
          aliases: ["bad alias"],
          page: empty,
        }], options),
      TypeError,
    );
    assert.throws(
      () => formatCommandReference([root()], { ...options, name: "bad\nname" }),
      TypeError,
    );
  });
  it("prints supplied collection omissions and rejects a complete claim", () => {
    const entries = [root("dynamic"), { path: ["dynamic"], page: empty }];
    const unresolved = [{
      path: ["dynamic"],
      scope: "page" as const,
      reason: "functional-usage",
    }];
    assert.throws(
      () => formatCommandReference(entries, { ...options, unresolved }),
      /Unresolved/,
    );
    const rendered = formatCommandReference(entries, {
      ...options,
      coverage: { ...options.coverage, commands: "partial" },
      unresolved,
    });
    assert.ok(rendered.includes("Unresolved documentation"));
    assert.ok(rendered.includes("functional-usage"));
    assert.ok(rendered.includes("tool dynamic"));
    assert.doesNotThrow(() =>
      formatCommandReference([root("dynamic"), {
        path: ["dynamic"],
        hidden: "doc",
        page: empty,
      }], { ...options, unresolved })
    );
  });
});
