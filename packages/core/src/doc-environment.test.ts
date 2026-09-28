import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cloneDocEntry,
  deriveEnvironmentSection,
  type DocEntry,
  type DocPage,
  type DocPageFormatOptions,
  formatDocPage,
} from "@optique/core/doc";
import { message } from "@optique/core/message";
import { getDisplayWidth } from "#src/displaywidth.ts";

const entry: DocEntry = {
  term: { type: "option", names: ["--level"], metavar: "LEVEL" },
  description: message`Verbosity.`,
  envVars: ["APP_LEVEL"],
};
const page: DocPage = { sections: [{ entries: [entry] }] };
const render = (options: DocPageFormatOptions = {}) =>
  formatDocPage("app", page, { colors: false, ...options });

describe("environment documentation", () => {
  it("preserves default output", () => {
    assert.equal(render(), "\n  --level LEVEL               Verbosity.\n");
    assert.equal(render({ showEnvironment: false }), render());
  });

  it("renders inline names after defaults and choices", () => {
    const options: DocPageFormatOptions = {
      showEnvironment: true,
      showDefault: true,
      showChoices: true,
    };
    const entryWithDefault: DocEntry = {
      ...entry,
      default: message`${"warn"}`,
      choices: message`${"warn"}, ${"debug"}`,
    };
    const output = formatDocPage("app", {
      sections: [{ entries: [entryWithDefault] }],
    }, options);
    assert.match(
      output,
      /Verbosity\. \["warn"\] \(choices: warn, debug\) \[env: APP_LEVEL\]/,
    );
    assert.ok(!output.includes("Environment:"));
  });

  it("supports section-only and both, without mutating the page", () => {
    const original = structuredClone(page);
    const section = render({ showEnvironment: { placement: "section" } });
    assert.match(section, /Environment:\n/);
    assert.match(section, /APP_LEVEL\s+--level LEVEL/);
    assert.ok(!section.includes("[env:"));
    const both = render({ showEnvironment: { placement: "both" } });
    assert.match(both, /\[env: APP_LEVEL\]/);
    assert.match(both, /Environment:\n/);
    assert.deepEqual(page, original);
  });

  it("deep-clones metadata while keeping legacy entries unchanged", () => {
    const copy = cloneDocEntry(entry);
    assert.deepEqual(copy, entry);
    assert.notStrictEqual(copy.envVars, entry.envVars);
    assert.deepEqual(cloneDocEntry({ term: entry.term }), { term: entry.term });
  });

  it("omits hidden entries and groups shared names", () => {
    const entries: readonly DocEntry[] = [
      entry,
      { ...entry, term: { type: "option", names: ["--verbose"] } },
      {
        ...entry,
        term: { type: "option", names: ["--secret"], hidden: true },
        envVars: ["SECRET"],
      },
    ];
    const options: DocPageFormatOptions = {
      showEnvironment: { placement: "section" },
    };
    const output = formatDocPage("app", { sections: [{ entries }] }, options);
    assert.equal(output.match(/APP_LEVEL/g)?.length, 1);
    assert.match(output, /--level LEVEL, --verbose/);
    assert.ok(!output.includes("SECRET"));
  });

  it("ignores empty names without introducing a description column", () => {
    const empty: DocEntry = {
      term: { type: "literal", value: "x" },
      envVars: [""],
    };
    const options: DocPageFormatOptions = {
      showEnvironment: true,
      maxWidth: 3,
    };
    assert.equal(
      formatDocPage("a", { sections: [{ entries: [empty] }] }, options),
      "\n  x\n",
    );
  });

  it("derives independent sections in stable order from valid visible terms", () => {
    const entries: readonly DocEntry[] = [
      { ...entry, envVars: ["B", "A", "B", ""] },
      { ...entry, envVars: ["A"] },
      {
        term: { type: "argument", metavar: "FILE", hidden: "usage" },
        envVars: ["A"],
      },
      { term: { type: "literal", value: "" }, envVars: ["EMPTY"] },
      {
        term: { type: "command", name: "secret", hidden: "doc" },
        envVars: ["SECRET"],
      },
    ];
    const input = { sections: [{ entries }] };
    const section = deriveEnvironmentSection(input);
    assert.ok(section);
    assert.deepEqual(section.entries.map((e) => e.term), [{
      type: "literal",
      value: "B",
    }, { type: "literal", value: "A" }]);
    assert.deepEqual(section.entries[1].description, [
      { type: "optionNames", optionNames: ["--level"] },
      { type: "text", text: " " },
      { type: "metavar", metavar: "LEVEL" },
      { type: "text", text: ", " },
      { type: "metavar", metavar: "FILE" },
    ]);
    assert.deepEqual(deriveEnvironmentSection({ sections: [] }), undefined);
    assert.notStrictEqual(
      deriveEnvironmentSection(input)?.entries,
      section.entries,
    );
  });

  it("places generated sections after sorted sections and before examples", () => {
    const input: DocPage = {
      sections: [
        { title: "Z options", entries: [entry] },
        {
          title: "A options",
          entries: [{
            term: { type: "option", names: ["--other"] },
            description: message`Other option.`,
          }],
        },
      ],
      examples: message`app --level debug`,
    };
    const seen: string[] = [];
    const options: DocPageFormatOptions = {
      showEnvironment: { placement: "both", sectionTitle: "Variables" },
      sectionOrder(a, b) {
        seen.push(a.title ?? "", b.title ?? "");
        return (a.title ?? "").localeCompare(b.title ?? "");
      },
    };
    const output = formatDocPage("app", input, options);
    assert.ok(output.indexOf("Variables:") > output.indexOf("Verbosity."));
    assert.ok(output.indexOf("Variables:") < output.indexOf("Examples:"));
    assert.ok(seen.length > 0);
    assert.ok(!seen.includes("Variables"));
    assert.ok(output.indexOf("A options:") < output.indexOf("Z options:"));
    assert.match(render({ showEnvironment: {} }), /\[env: APP_LEVEL\]/);
  });

  it("validates only a used section heading", () => {
    assert.doesNotThrow(() =>
      render({ showEnvironment: { sectionTitle: "" } })
    );
    assert.throws(
      () =>
        render({ showEnvironment: { placement: "section", sectionTitle: "" } }),
      TypeError,
    );
    assert.throws(
      () =>
        render({
          showEnvironment: { placement: "both", sectionTitle: "bad\nheading" },
        }),
      TypeError,
    );
  });

  it("measures derived entries and wraps inline annotations at narrow widths", () => {
    for (const placement of ["inline", "section", "both"] as const) {
      for (const maxWidth of [32, 48, 80]) {
        const output = render({
          showEnvironment: { placement },
          maxWidth,
          termWidth: "auto",
        });
        for (const line of output.split("\n")) {
          assert.ok(getDisplayWidth(line) <= maxWidth, `${placement}: ${line}`);
        }
      }
    }
    const bare: DocEntry = {
      term: { type: "literal", value: "x" },
      envVars: ["A"],
    };
    const input = { sections: [{ entries: [bare] }] };
    assert.throws(
      () =>
        formatDocPage("app", input, {
          maxWidth: 3,
          showEnvironment: { placement: "section" },
        }),
      RangeError,
    );
  });

  it("supports semantic themes and opaque formatters without adding terminal kinds", () => {
    const themed = formatDocPage("app", {
      sections: [{
        entries: [{
          ...entry,
          term: { type: "option", names: ["--level"] },
        }],
      }],
    }, {
      showEnvironment: true,
      colors: true,
      theme: {
        envVar: (term) => ({ type: "text", text: `<${term.envVar}>` }),
        annotationStyles: { environment: { italic: true } },
      },
    });
    assert.match(themed, /<APP_LEVEL>/);
    assert.ok(themed.includes("\x1b[3m [env:"));
    const opaque = render({
      showEnvironment: true,
      messageFormatter: (terms) =>
        terms.some((term) => term.type === "envVar") ? "ENV" : "DESCRIPTION",
    });
    assert.match(opaque, /DESCRIPTION \[env: ENV\]/);
  });
});

describe("independent environment documentation", () => {
  const independent: DocPage = {
    sections: [{ entries: [entry, { ...entry, envVars: ["SECOND"] }] }],
    environmentBindings: [
      { name: "ONLY", description: message`Purpose.` },
      { name: "APP_LEVEL", description: message`Level purpose.` },
      { name: "ONLY", description: [{ text: "Purpose.", type: "text" }] },
      { name: "ONLY", description: message`Another purpose.` },
      { name: "NAME_ONLY" },
      { name: "ONLY", hidden: true, description: message`Hidden purpose.` },
      { name: "HIDDEN", hidden: "doc" },
      { name: "" },
    ],
  };
  it("orders CLI names first without deduplicating distinct entry metadata", () => {
    const section = deriveEnvironmentSection(independent);
    assert.ok(section);
    assert.deepEqual(section.entries.map((entry) => entry.term), [
      { type: "literal", value: "APP_LEVEL" },
      { type: "literal", value: "SECOND" },
      { type: "literal", value: "ONLY" },
      { type: "literal", value: "NAME_ONLY" },
    ]);
    assert.deepEqual(section.entries[0].description, [
      ...message`Level purpose.`,
      { type: "lineBreak" },
      { type: "text", text: "CLI: " },
      { type: "optionNames", optionNames: ["--level"] },
      { type: "text", text: " " },
      { type: "metavar", metavar: "LEVEL" },
    ]);
    assert.deepEqual(section.entries[2].description, [
      ...message`Purpose.`,
      { type: "lineBreak" },
      ...message`Another purpose.`,
    ]);
    assert.ok(!("description" in section.entries[3]));
  });
  it("uses per-name fallback and ignores hidden records without hiding visible siblings", () => {
    const section = deriveEnvironmentSection(independent, {
      onlyUnreferenced: true,
    });
    assert.deepEqual(section?.entries.map((entry) => entry.term), [
      { type: "literal", value: "ONLY" },
      { type: "literal", value: "NAME_ONLY" },
    ]);
    for (
      const showEnvironment of [true, {}, { placement: "inline" as const }]
    ) {
      const help = formatDocPage("app", independent, { showEnvironment });
      assert.ok(help.includes("ONLY"));
      assert.ok(help.includes("NAME_ONLY"));
      assert.ok(!help.includes("Level purpose."));
      assert.ok(!help.includes("Hidden purpose."));
    }
  });
  it("normalizes structural message equality including URLs and ordered arrays", () => {
    const purpose = [{
      type: "url" as const,
      url: new URL("https://example.com/"),
    }];
    const names = [{
      type: "optionNames" as const,
      optionNames: ["--a", "--b"],
    }];
    const section = deriveEnvironmentSection({
      sections: [],
      environmentBindings: [
        { name: "A", description: purpose },
        {
          name: "A",
          description: [{ type: "url", url: new URL("https://example.com/") }],
        },
        { name: "A", description: names },
        {
          name: "A",
          description: [{ optionNames: ["--a", "--b"], type: "optionNames" }],
        },
      ],
    });
    assert.deepEqual(section?.entries[0].description, [...purpose, {
      type: "lineBreak",
    }, ...names]);
  });
  it("validates an inline title only when the fallback is present", () => {
    const options = { showEnvironment: { sectionTitle: "" } };
    assert.doesNotThrow(() => formatDocPage("app", page, options));
    assert.throws(() => formatDocPage("app", independent, options), TypeError);
    assert.throws(
      () =>
        formatDocPage("app", {
          sections: [],
          environmentBindings: [{ name: "LONG_VARIABLE" }],
        }, { maxWidth: 2, showEnvironment: true }),
      RangeError,
    );
  });
  it("keeps purpose values unquoted in generated sections", () => {
    const help = formatDocPage("app", {
      sections: [],
      environmentBindings: [{
        name: "A",
        description: message`Use ${"seconds"}.`,
      }],
    }, { showEnvironment: true });
    assert.ok(help.includes("Use seconds."));
    assert.ok(!help.includes('"seconds"'));
  });
});

it("compares message terms by documented fields rather than unrelated attached metadata", () => {
  const metadata: Record<string, unknown> = {};
  metadata.self = metadata;
  const term = { type: "text" as const, text: "Purpose.", metadata };
  const section = deriveEnvironmentSection({
    sections: [],
    environmentBindings: [
      { name: "A", description: [term] },
      { name: "A", description: message`Purpose.` },
    ],
  });
  assert.equal(section?.entries[0].description?.length, 1);
});
