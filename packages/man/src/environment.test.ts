import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocEntry, DocPage } from "@optique/core/doc";
import { type Message, message } from "@optique/core/message";
import { defineProgram } from "@optique/core/program";
import { constant } from "@optique/core/primitives";
import { formatDocPageAsMan, type ManPageOptions } from "#src/man.ts";
import { generateManPageAsync, generateManPageSync } from "#src/generator.ts";

const entry: DocEntry & { readonly envVars: readonly string[] } = {
  term: { type: "option", names: ["--level"] },
  description: message`Verbosity.`,
  envVars: ["APP_LEVEL"],
};
const page: DocPage = { sections: [{ entries: [entry] }] };
describe("man environment documentation", () => {
  const options: ManPageOptions = {
    name: "app",
    section: 1,
    date: "September 2026",
  };

  it("supports inline, section and both while leaving default output unchanged", () => {
    const baseline = formatDocPageAsMan(page, options);
    assert.ok(!baseline.includes("APP_LEVEL"));
    const inline = formatDocPageAsMan(page, {
      ...options,
      showEnvironment: true,
    });
    assert.match(inline, /\[env: \\fBAPP_LEVEL\\fR\]/);
    assert.ok(!inline.includes(".SH ENVIRONMENT"));
    const section = formatDocPageAsMan(page, {
      ...options,
      showEnvironment: { placement: "section" },
    });
    assert.match(section, /\.SH ENVIRONMENT/);
    assert.ok(!section.includes("[env:"));
    const both = formatDocPageAsMan(page, {
      ...options,
      showEnvironment: { placement: "both" },
    });
    assert.match(both, /\.SH ENVIRONMENT/);
    assert.match(both, /\[env:/);
  });

  it("preserves manual overrides and empty-section suppression", () => {
    const manual = {
      entries: [{ term: { type: "literal" as const, value: "MANUAL" } }],
    };
    const config: ManPageOptions = {
      ...options,
      environment: manual,
      showEnvironment: { placement: "both" },
    };
    const output = formatDocPageAsMan(page, config);
    assert.equal(output.match(/\.SH ENVIRONMENT/g)?.length, 1);
    assert.match(output, /MANUAL/);
    assert.match(output, /\[env: \\fBAPP_LEVEL\\fR\]/);
    const suppressed: ManPageOptions = {
      ...config,
      environment: { entries: [] },
    };
    assert.ok(
      !formatDocPageAsMan(page, suppressed).includes(".SH ENVIRONMENT"),
    );
  });

  it("passes the option through Program generation", () => {
    const parser = {
      ...constant("done"),
      getDocFragments: () => ({
        fragments: [{ type: "entry" as const, ...entry }],
      }),
    };
    const program = defineProgram({ parser, metadata: { name: "app" } });
    const config: ManPageOptions = {
      ...options,
      showEnvironment: { placement: "section" },
    };
    assert.match(generateManPageSync(program, config), /\.SH ENVIRONMENT/);
  });

  it("passes section titles through asynchronous Parser and Program generation", async () => {
    const parser = {
      ...constant("done"),
      getDocFragments: () => ({
        fragments: [{ type: "entry" as const, ...entry }],
      }),
    };
    const program = defineProgram({ parser, metadata: { name: "app" } });
    const config: ManPageOptions = {
      ...options,
      showEnvironment: { placement: "section", sectionTitle: "Variables" },
    };
    for (
      const output of await Promise.all([
        generateManPageAsync(parser, config),
        generateManPageAsync(program, config),
      ])
    ) {
      assert.match(output, /\.SH "VARIABLES"/);
    }
    const manual: ManPageOptions = {
      ...config,
      environment: {
        title: "Ignored",
        entries: [{ ...entry, term: { type: "literal", value: "MANUAL" } }],
      },
    };
    assert.match(formatDocPageAsMan(page, manual), /\.SH ENVIRONMENT/);
    assert.ok(!formatDocPageAsMan(page, manual).includes("VARIABLES"));
    // Existing callers can still read environment as a DocSection.
    assert.equal(manual.environment?.entries.length, 1);
    assert.match(
      formatDocPageAsMan(page, { ...manual, showEnvironment: false }),
      /MANUAL/,
    );
  });

  it("keeps annotation-only and trailing-line-break bodies free of leading spaces", () => {
    const descriptions: readonly (Message | undefined)[] = [
      undefined,
      [],
      [{ type: "text", text: "Verbosity." }, { type: "lineBreak" }],
    ];
    for (const description of descriptions) {
      const input: DocPage = {
        sections: [{ entries: [{ ...entry, description }] }],
      };
      const output = formatDocPageAsMan(input, {
        ...options,
        showEnvironment: true,
      });
      assert.ok(output.split("\n").includes("[env: \\fBAPP_LEVEL\\fR]"));
      assert.ok(!output.includes("\n [env:"));
    }
  });

  it("escapes roff-sensitive variable names in inline annotations", () => {
    const unusual = { ...entry, envVars: ["APP\\VALUE\n.SH INJECTED"] };
    const input = { sections: [{ entries: [unusual] }] };
    const output = formatDocPageAsMan(input, {
      ...options,
      showEnvironment: true,
    });
    assert.ok(!output.includes("\n.SH INJECTED"));
    assert.ok(output.includes("\n\\&.SH INJECTED"));
  });
});
