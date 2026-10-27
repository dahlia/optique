import { getDocPageSync } from "#src/parser.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { object, or, seq } from "#src/constructs.ts";
import { argument, command, flag, option } from "#src/primitives.ts";
import { multiple, optional, withDefault } from "#src/modifiers.ts";
import { choice, integer, string } from "#src/valueparser.ts";
import { formatMessage, message } from "#src/message.ts";
import { formatUsage } from "#src/usage.ts";
import { collectDocPages, DocPageCollectionError } from "#src/doc-pages.ts";
import type { DocPage } from "#src/doc.ts";
import { hiddenCommandAliasesKey } from "#src/internal/command-alias.ts";

const blank: DocPage = { sections: [] };
describe("collectDocPages()", () => {
  it("retains labels on ordered sequences", () => {
    const parser = seq("Ordered", argument(string()), option("--x", integer()));
    assert.ok(
      collectDocPages(parser).entries[0].page.sections.some((section) =>
        section.title === "Ordered"
      ),
    );
  });

  it("keeps selected command tokens visible in their own synopses", () => {
    const direct = command("visible", flag("--flag"), { hidden: "usage" });
    assert.equal(
      formatUsage("app", collectDocPages(direct).entries[1].page.usage ?? []),
      "app visible --flag",
    );
    const nested = command(
      "config",
      or(
        command("get", flag("--g")),
        command("set", flag("--s")),
      ),
      { hidden: "usage" },
    );
    const page = collectDocPages(nested).entries.find((entry) =>
      entry.path.join("/") === "config/get"
    );
    assert.equal(
      formatUsage("app", page?.page.usage ?? []),
      "app config get --g",
    );
  });

  it("reports consecutive command-bearing sequence children as an opaque ambiguous scope", () => {
    const parser = seq(command("x", flag("--x")), command("y", flag("--y")));
    const result = collectDocPages(parser, { strict: false });
    assert.deepEqual(result.entries.map((entry) => entry.path), [[]]);
    assert.deepEqual(result.unresolved, [{
      path: [],
      scope: "subtree",
      reason: "ambiguous-command-path",
    }]);
    assert.throws(() => collectDocPages(parser), DocPageCollectionError);
    assert.doesNotThrow(() =>
      collectDocPages(parser, {
        entries: [
          { path: [], page: blank, coverage: "subtree" },
          { path: ["x"], page: blank },
          { path: ["x", "y"], page: blank },
        ],
      })
    );
  });

  it("requires authored descendant pages affected by an opaque shared input", () => {
    const parser = object({
      shared: { ...flag("--custom") },
      action: command("serve", flag("--serve")),
    });
    const entries = [{ path: [], page: blank, coverage: "subtree" as const }];
    const result = collectDocPages(parser, { strict: false, entries });
    assert.deepEqual(result.unresolved, [{
      path: ["serve"],
      scope: "page",
      reason: "unregistered-parser",
    }]);
    assert.throws(
      () => collectDocPages(parser, { entries }),
      DocPageCollectionError,
    );
    assert.doesNotThrow(() =>
      collectDocPages(parser, {
        entries: [...entries, { path: ["serve"], page: blank }],
      })
    );
  });

  it("requires an authored page for known incomplete descendants of a subtree assertion", () => {
    const parser = command("opaque", { ...flag("--custom") });
    assert.throws(() =>
      collectDocPages(parser, {
        entries: [{ path: [], page: blank, coverage: "subtree" }],
      }), DocPageCollectionError);
    assert.doesNotThrow(() =>
      collectDocPages(parser, {
        entries: [
          { path: [], page: blank, coverage: "subtree" },
          { path: ["opaque"], page: blank },
        ],
      })
    );
  });

  it("reports shared-input omissions on every affected page", () => {
    const parser = object({
      format: withDefault(
        option(
          "--format",
          choice(["json", "text"], {
            caseInsensitive: true,
          }),
        ),
        "JSON",
      ),
      action: command("serve", flag("--serve")),
    });
    const result = collectDocPages(parser, {
      strict: false,
      entries: [{ path: [], page: blank }],
    });
    assert.deepEqual(result.unresolved, [{
      path: ["serve"],
      scope: "page",
      reason: "static-default-format-unavailable",
    }]);
    assert.throws(() =>
      collectDocPages(parser, {
        entries: [{ path: [], page: blank }],
      }), DocPageCollectionError);
    assert.doesNotThrow(() =>
      collectDocPages(parser, {
        entries: [{ path: [], page: blank }, { path: ["serve"], page: blank }],
      })
    );
  });

  it("skips documentation-hidden object scopes before enumeration and reporting", () => {
    for (const hidden of [true, "doc", "help"] as const) {
      const parser = or(
        object({ secret: command("secret", { ...flag("--secret") }) }, {
          hidden,
        }),
        command("public", flag("--public")),
      );
      const result = collectDocPages(parser);
      assert.deepEqual(result.entries.map((entry) => entry.path), [[], [
        "public",
      ]]);
      assert.deepEqual(result.unresolved, []);
      assert.ok(
        result.entries[0].page.sections.flatMap((section) => section.entries)
          .every((entry) =>
            entry.term.type !== "command" || entry.term.name !== "secret"
          ),
      );
    }
  });

  it("applies object usage visibility to projected command synopses", () => {
    const parser = object({ action: command("serve", flag("--port")) }, {
      hidden: "usage",
    });
    const result = collectDocPages(parser);
    assert.deepEqual(result.entries.map((entry) => entry.path), [[], [
      "serve",
    ]]);
    assert.equal(
      formatUsage("app", result.entries[1].page.usage ?? []),
      "app serve",
    );
    assert.ok(result.entries[1].page.sections[0].entries.length > 0);
  });

  it("retains repetition empty-input facts in collected usage", () => {
    const parser = multiple(optional(option("--x")), { min: 1 });
    assert.equal(
      formatUsage("app", collectDocPages(parser).entries[0].page.usage ?? []),
      formatUsage("app", parser.usage),
    );
  });

  it("preserves nested group labels independently of the outer label", () => {
    const parser = object("Outer", {
      a: option("--a"),
      inner: object("Inner", { b: option("--b") }),
    });
    assert.deepEqual(
      collectDocPages(parser).entries[0].page.sections.map((section) => ({
        title: section.title,
        names: section.entries.map((entry) =>
          entry.term.type === "option" ? entry.term.names : []
        ),
      })),
      [
        { title: "Inner", names: [["--b"]] },
        { title: "Outer", names: [["--a"]] },
      ],
    );
  });

  it("rejects hidden aliases that collide with another canonical destination", () => {
    const aliases = {
      aliases: ["f"],
      [hiddenCommandAliasesKey]: ["other"],
    } as const;
    const parser = command("first", flag("--a"), aliases);
    assert.throws(() =>
      collectDocPages(parser, {
        entries: [{ path: ["other"], page: blank }],
      }), /Ambiguous command spelling/);
  });

  it("uses the choice constructor's captured values after custom key side effects", () => {
    const choices = ["json", "text"];
    const value = choice(choices, {
      key(text) {
        choices[0] = "mutated";
        return text;
      },
    });
    const result = collectDocPages(option("--format", value));
    const entry = result.entries[0].page.sections[0].entries[0];
    assert.equal(
      formatMessage(entry.choices ?? [], { colors: false }),
      "json, text",
    );
  });

  it("does not project a scalar fallback through a value-shaping construct", () => {
    const parser = withDefault(
      object({ port: option("--port", integer()) }),
      999,
    );
    const result = collectDocPages(parser, { strict: false });
    assert.ok(
      result.entries[0].page.sections.flatMap((section) => section.entries)
        .every((entry) => entry.default == null),
    );
    assert.ok(
      result.unresolved.some((gap) =>
        gap.reason === "static-default-format-unavailable"
      ),
    );
  });

  it("collects nested commands/shared options and safe documented values", () => {
    const parser = object({
      verbose: optional(flag("--verbose")),
      action: or(
        command("serve", withDefault(option("--port", integer()), 8080)),
        command(
          "config",
          or(
            command(
              "get",
              multiple(argument(string({ metavar: "KEY" })), { min: 1 }),
              { aliases: ["g"] },
            ),
            command("set", option("--format", choice(["json", "text"]))),
          ),
        ),
      ),
    });
    const result = collectDocPages(parser);
    assert.deepEqual(result.entries.map((entry) => entry.path), [
      [],
      ["serve"],
      ["config"],
      ["config", "get"],
      ["config", "set"],
    ]);
    assert.deepEqual(result.unresolved, []);
    assert.equal(result.scope, "parser");
    for (const entry of result.entries) {
      assert.ok(
        entry.page.sections.flatMap((section) => section.entries).some((
          entry,
        ) =>
          entry.term.type === "option" && entry.term.names.includes("--verbose")
        ),
      );
    }
    const port = result.entries[1].page.sections.flatMap((section) =>
      section.entries
    ).find((entry) =>
      entry.term.type === "option" && entry.term.names.includes("--port")
    );
    assert.equal(
      formatMessage(port?.default ?? [], { colors: false, quotes: false }),
      "8080",
    );
    assert.ok(
      result.entries[4].page.sections.flatMap((section) => section.entries)
        .some((entry) => entry.choices != null),
    );
    assert.deepEqual(result.entries[3].aliases, ["g"]);
  });

  it("reports unknown scopes and throws in strict mode", () => {
    const opaque = { ...flag("--custom") };
    const parser = command("opaque", opaque);
    assert.throws(() => collectDocPages(parser), DocPageCollectionError);
    const result = collectDocPages(parser, { strict: false });
    assert.deepEqual(
      result.unresolved.map((gap) => ({
        path: gap.path,
        scope: gap.scope,
        reason: gap.reason,
      })),
      [{ path: ["opaque"], scope: "subtree", reason: "unregistered-parser" }],
    );
    assert.ok(result.entries.some((entry) => entry.path[0] === "opaque"));
  });

  it("replaces automatic pages and distinguishes page/subtree assertions", () => {
    const parser = command("opaque", { ...flag("--custom") });
    const replacement: DocPage = {
      description: message`Authored`,
      sections: [],
    };
    assert.throws(
      () =>
        collectDocPages(parser, {
          entries: [{ path: ["opaque"], page: replacement, coverage: "page" }],
        }),
      DocPageCollectionError,
    );
    const result = collectDocPages(parser, {
      entries: [{ path: ["opaque"], page: replacement, coverage: "subtree" }, {
        path: ["opaque", "child"],
        page: blank,
        coverage: "page",
      }],
    });
    assert.deepEqual(result.unresolved, []);
    assert.equal(
      result.entries.find((entry) => entry.path.join("/") === "opaque")?.page
        .description?.[0].type,
      "text",
    );
    assert.ok(
      result.entries.some((entry) => entry.path.join("/") === "opaque/child"),
    );
    assert.throws(
      () =>
        collectDocPages(parser, {
          entries: [{ path: [], page: blank }, { path: [], page: blank }],
        }),
      /Duplicate/,
    );
  });

  it("omits function defaults, honors messages, and handles static usage overrides", () => {
    const callback = () => {
      throw new Error("Must not execute.");
    };
    const parser = or(
      command("a", withDefault(option("--a", integer()), callback)),
      command(
        "b",
        withDefault(option("--b", integer()), callback, {
          message: message`chosen later`,
        }),
      ),
      command("c", option("--c", string()), {
        usageLine: [{ type: "literal", value: "CUSTOM" }],
      }),
    );
    const result = collectDocPages(parser);
    assert.ok(
      result.entries[1].page.sections.flatMap((section) => section.entries)
        .every((entry) => entry.default == null),
    );
    assert.ok(
      result.entries[2].page.sections.flatMap((section) => section.entries)
        .some((entry) =>
          entry.default != null &&
          formatMessage(entry.default, { colors: false }) === "chosen later"
        ),
    );
    assert.equal(
      formatUsage("app", result.entries[3].page.usage ?? []),
      "app c CUSTOM",
    );
    const functional = command("f", flag("--flag"), { usageLine: callback });
    assert.throws(() => collectDocPages(functional), DocPageCollectionError);
    assert.ok(
      collectDocPages(functional, { strict: false }).entries[1].page.usage ==
        null,
    );
    assert.doesNotThrow(() =>
      collectDocPages(functional, {
        entries: [{
          path: ["f"],
          page: { usage: [{ type: "command", name: "f" }], sections: [] },
        }],
      })
    );
  });

  it("skips hidden descendants before reports, retaining usage-hidden sections", () => {
    for (const hidden of [true, "doc", "help"] as const) {
      const parser = or(
        command("hidden", { ...flag("--custom") }, { hidden }),
        command("visible", flag("--flag"), { hidden: "usage" }),
      );
      const result = collectDocPages(parser);
      assert.deepEqual(result.entries.map((entry) => entry.path), [[], [
        "visible",
      ]]);
      assert.deepEqual(result.unresolved, []);
    }
    assert.doesNotThrow(() =>
      collectDocPages(
        withDefault(
          option("--hidden", { ...integer() }, { hidden: "doc" }),
          42,
        ),
      )
    );
  });

  it("keeps ordered prefixes out of paths and retains their usage", () => {
    const result = collectDocPages(
      seq(
        argument(string({ metavar: "PROFILE" })),
        command("serve", withDefault(option("--port", integer()), 8080)),
      ),
    );
    assert.deepEqual(result.entries.map((entry) => entry.path), [[], [
      "serve",
    ]]);
    assert.equal(
      formatUsage("app", result.entries[1].page.usage ?? []),
      "app PROFILE serve [--port INTEGER]",
    );
  });

  it("preserves section labels and nearest showUsage policies", () => {
    const result = collectDocPages(
      command(
        "config",
        command("get", object("Inputs", { key: argument(string()) }), {
          showUsage: true,
        }),
        { showUsage: false },
      ),
    );
    assert.equal(result.entries[1].page.showUsage, false);
    assert.equal(result.entries[2].page.showUsage, true);
    assert.ok(
      result.entries[2].page.sections.some((section) =>
        section.title === "Inputs"
      ),
    );
  });
  it("removes references to supplied hidden pages and rejects missing known descendants", () => {
    const parser = or(
      command("visible", flag("--v")),
      command("hidden", flag("--h")),
    );
    const result = collectDocPages(parser, {
      entries: [{ path: ["hidden"], hidden: "doc", page: blank }],
    });
    assert.ok(
      !result.entries[0].page.sections.flatMap((section) => section.entries)
        .some((entry) =>
          entry.term.type === "command" && entry.term.name === "hidden"
        ),
    );
    assert.throws(
      () =>
        collectDocPages({ ...flag("--custom") }, {
          entries: [{
            path: [],
            coverage: "subtree",
            page: {
              sections: [{
                entries: [{ term: { type: "command", name: "missing" } }],
              }],
            },
          }],
        }),
      DocPageCollectionError,
    );
  });
  it("does not expose mutable registry snapshots through collected pages", () => {
    const parser = command(
      "serve",
      option("--format", choice(["json", "text"])),
    );
    const first = collectDocPages(parser);
    const page = first.entries[1].page;
    const entry = page.sections.flatMap((section) => section.entries)[0];
    if (entry.term.type === "option") {
      Reflect.set(entry.term.names, 0, "--corrupt");
    }
    if (entry.choices?.[0]?.type === "text") {
      Reflect.set(entry.choices[0], "text", "corrupt");
    }
    const second = collectDocPages(parser);
    const fresh =
      second.entries[1].page.sections.flatMap((section) => section.entries)[0];
    assert.ok(
      fresh.term.type === "option" && fresh.term.names.includes("--format"),
    );
    assert.equal(
      formatMessage(fresh.choices ?? [], { colors: false }),
      "json, text",
    );
  });
  it("omits lazy defaults that ordinary help evaluates", () => {
    let calls = 0;
    const parser = withDefault(option("--port", integer()), () => {
      calls++;
      return 8080;
    });
    const collected = collectDocPages(parser);
    assert.equal(calls, 0);
    assert.ok(
      collected.entries[0].page.sections.flatMap((section) => section.entries)
        .every((entry) => entry.default == null),
    );
    const ordinary = getDocPageSync(parser);
    assert.ok(calls > 0);
    assert.ok(
      ordinary?.sections.flatMap((section) => section.entries).some((entry) =>
        entry.default != null
      ),
    );
  });

  it("does not call custom choice normalization when displaying a default", () => {
    let calls = 0;
    const value = choice(["json", "text"], {
      key(text) {
        calls++;
        return text.toLowerCase();
      },
    });
    const parser = withDefault(option("--format", value), "JSON");
    calls = 0;
    const result = collectDocPages(parser, { strict: false });
    assert.equal(calls, 0);
    assert.ok(
      result.unresolved.some((gap) =>
        gap.reason === "static-default-format-unavailable"
      ),
    );
    assert.ok(
      result.entries[0].page.sections.flatMap((section) => section.entries)
        .every((entry) => entry.default == null),
    );
    assert.doesNotThrow(() =>
      collectDocPages(
        withDefault(option("--format", value), "JSON", {
          message: message`json`,
        }),
      )
    );
    assert.equal(calls, 0);
  });
});
