import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { object, or } from "@optique/core/constructs";
import type { DocEntry, DocPage } from "@optique/core/doc";
import { message } from "@optique/core/message";
import { command } from "@optique/core/primitives";
import { defineProgram } from "@optique/core/program";
import { formatDocPageAsMan, type ManPageOptions } from "#src/man.ts";
import { generateManPageAsync, generateManPageSync } from "#src/generator.ts";

const options: ManPageOptions = {
  name: "app",
  section: 1,
  date: "October 2026",
};

function pageOf(entry: Partial<DocEntry> = {}): DocPage {
  return {
    sections: [{
      entries: [{
        term: { type: "command", name: "install", aliases: ["i", "add-pkg"] },
        description: message`Install a package.`,
        ...entry,
      }],
    }],
  };
}

describe("man command alias documentation", () => {
  it("leaves aliases out by default", () => {
    const output = formatDocPageAsMan(pageOf(), options);
    assert.ok(!output.includes("aliases"));
    assert.ok(!output.includes("pkg"));
  });

  it("renders aliases when showAliases is true", () => {
    const output = formatDocPageAsMan(pageOf(), {
      ...options,
      showAliases: true,
    });
    assert.ok(
      output.includes("Install a package. (aliases: i, add\\-pkg)"),
      output,
    );
  });

  it("applies custom formatting options", () => {
    const output = formatDocPageAsMan(pageOf(), {
      ...options,
      showAliases: { prefix: " [", suffix: "]", label: "aka " },
    });
    assert.ok(
      output.includes("Install a package. [aka i, add\\-pkg]"),
      output,
    );
  });

  it("honors per-entry overrides in both directions", () => {
    const forcedOn = formatDocPageAsMan(pageOf({ showAliases: true }), options);
    assert.ok(forcedOn.includes("(aliases: i, add\\-pkg)"), forcedOn);
    const forcedOff = formatDocPageAsMan(pageOf({ showAliases: false }), {
      ...options,
      showAliases: true,
    });
    assert.ok(!forcedOff.includes("aliases"), forcedOff);
  });

  it("renders aliases for entries without a description", () => {
    const output = formatDocPageAsMan(pageOf({ description: undefined }), {
      ...options,
      showAliases: true,
    });
    assert.match(output, /\\fBinstall\\fR\n\(aliases: i, add\\-pkg\)$/);
  });

  it("escapes roff syntax in every part of the annotation", () => {
    for (const description of [message`Install.`, undefined]) {
      const output = formatDocPageAsMan(pageOf({ description }), {
        ...options,
        showAliases: {
          prefix: " \\fB",
          label: "\n.SH INJECTED\n",
          suffix: "\n'br",
        },
      });
      assert.ok(!output.includes("\n.SH INJECTED"), output);
      assert.ok(!output.includes("\n'br"), output);
      assert.ok(output.includes("\\\\fB"), output);
    }
  });

  it("ignores showAliases on non-command entries", () => {
    const page: DocPage = {
      sections: [{
        entries: [{
          term: { type: "option", names: ["--verbose"] },
          description: message`Be verbose.`,
          showAliases: true,
        }],
      }],
    };
    const output = formatDocPageAsMan(page, { ...options, showAliases: true });
    assert.ok(!output.includes("aliases"));
  });

  it("passes showAliases through Parser and Program generation", async () => {
    const parser = or(
      command("install", object({}), {
        aliases: ["i"],
        description: message`Install a package.`,
      }),
      command("remove", object({}), {
        description: message`Remove a package.`,
      }),
    );
    const program = defineProgram({ parser, metadata: { name: "app" } });
    const config: ManPageOptions = { ...options, showAliases: true };
    for (
      const output of [
        generateManPageSync(parser, config),
        generateManPageSync(program, config),
        ...await Promise.all([
          generateManPageAsync(parser, config),
          generateManPageAsync(program, config),
        ]),
      ]
    ) {
      assert.ok(output.includes("Install a package. (aliases: i)"), output);
    }
  });
});
