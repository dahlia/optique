import { group, longestMatch, merge, object, or } from "./constructs.ts";
import { formatDocPage } from "./doc.ts";
import { message } from "./message.ts";
import { map, optional, withDefault } from "./modifiers.ts";
import { getDocPage, getDocPageAsync, type Parser } from "./parser.ts";
import { argument, command, constant, flag, option } from "./primitives.ts";
import { string, type ValueParser } from "./valueparser.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const brief = message`Compile the code`;
const description = message`Run all the compilation tools.`;
const footer = message`See the build guide.`;
const watchDescription = message`Rebuild on change`;

function buildCommand() {
  return command(
    "build",
    object({
      action: constant("build"),
      watch: option("-w", "--watch", { description: watchDescription }),
    }),
    { brief, description, footer },
  );
}

function commands() {
  return or(
    buildCommand(),
    command("test", object({ action: constant("test") }), {
      description: message`Run the tests`,
    }),
  );
}

describe("command documentation inside object", () => {
  it("keeps selected command fragments compatible with deep equality", () => {
    const parser = command("build", constant("build"), {
      brief,
      description,
      footer,
    });
    assert.deepEqual(
      parser.getDocFragments({
        kind: "available",
        state: ["matched", "build"],
      }),
      { fragments: [], brief, description, footer },
    );
  });

  for (const labeled of [false, true]) {
    it(`preserves command metadata in a ${labeled ? "labeled" : "plain"} object`, () => {
      const fields = { command: commands() };
      const parser = labeled ? object("Commands", fields) : object(fields);
      const page = getDocPage(parser, ["build"]);
      assert.ok(page);
      assert.deepEqual(page.brief, brief);
      assert.deepEqual(page.description, description);
      assert.deepEqual(page.footer, footer);
      const help = formatDocPage("optique-demo", page, { colors: false });
      for (
        const text of [
          "Compile the code",
          "Run all the compilation tools.",
          "See the build guide.",
          "Rebuild on change",
        ]
      ) assert.ok(help.includes(text), help);
      const entries = page.sections.flatMap((section) => section.entries);
      assert.ok(
        entries.some((entry) =>
          entry.term.type === "option" && entry.term.names.includes("--watch")
        ),
      );
      assert.ok(!entries.some((entry) => entry.term.type === "command"));
    });
  }

  for (const hidden of [false, true]) {
    for (const args of [["build"], ["--verbose", "build"]]) {
      it(`does not promote ${hidden ? "hidden" : "visible"} sibling option descriptions with ${args.join(" ")}`, () => {
        const parser = object({
          verbose: option("--verbose", {
            description: message`Enable verbose output`,
            hidden,
          }),
          command: commands(),
        });
        const page = getDocPage(parser, args);
        assert.ok(page);
        assert.deepEqual(page.brief, brief);
        assert.deepEqual(page.description, description);
        assert.deepEqual(page.footer, footer);
      });
    }
  }

  it("keeps command descriptions in root listings without promoting page metadata", () => {
    const parser = object("Commands", { command: commands() });
    const page = getDocPage(parser);
    assert.ok(page);
    assert.equal(page.brief, undefined);
    assert.equal(page.description, undefined);
    assert.equal(page.footer, undefined);
    const entries = page.sections.flatMap((section) => section.entries);
    const build = entries.find((entry) =>
      entry.term.type === "command" && entry.term.name === "build"
    );
    assert.ok(build);
    assert.deepEqual(build.description, brief);
  });

  for (const hidden of [false, true]) {
    it(`preserves a description-only ${hidden ? "hidden" : "visible"} command only when selected`, () => {
      const parser = object({
        command: command("build", object({}), { description, hidden }),
      });
      const root = getDocPage(parser);
      assert.ok(root);
      assert.equal(root.description, undefined);
      const entries = root.sections.flatMap((section) => section.entries);
      assert.equal(entries.length, hidden ? 0 : 1);
      const selected = getDocPage(parser, ["build"]);
      assert.ok(selected);
      assert.deepEqual(selected.description, description);
    });
  }

  it("preserves nested command metadata and parent fallbacks through nested objects", () => {
    const childDescription = message`Build a nested project.`;
    const parser = object({
      nested: object({
        command: command(
          "build",
          object({
            command: command("build", object({}), {
              description: childDescription,
            }),
          }),
          { brief, description, footer },
        ),
      }),
    });
    const parent = getDocPage(parser, ["build"]);
    assert.ok(parent);
    assert.deepEqual(parent.description, description);
    const child = getDocPage(parser, ["build", "build"]);
    assert.ok(child);
    assert.deepEqual(child.brief, brief);
    assert.deepEqual(child.description, childDescription);
    assert.deepEqual(child.footer, footer);
  });

  const wrappers = {
    group: () => group("Commands", commands()),
    longestMatch: () =>
      longestMatch(buildCommand(), command("test", object({}))),
    map: () => map(commands(), (value) => value),
    optional: () => optional(commands()),
    withDefault: () => withDefault(commands(), { action: "test" }),
    withDefaultMessage: () =>
      withDefault(commands(), { action: "test" }, {
        message: message`Test by default`,
      }),
    labeledMerge: () =>
      merge(
        "Options",
        object({
          verbose: option("--verbose", { description: message`Verbose` }),
        }),
        object({ command: commands() }),
      ),
    merge: () =>
      merge(
        object({
          verbose: option("--verbose", { description: message`Verbose` }),
        }),
        object({ command: commands() }),
      ),
  };
  for (const [name, wrap] of Object.entries(wrappers)) {
    it(`preserves selected metadata through ${name}`, () => {
      const parser = object({ command: wrap() });
      const page = getDocPage(parser, ["build"]);
      assert.ok(page);
      assert.deepEqual(page.brief, brief);
      assert.deepEqual(page.description, description);
      assert.deepEqual(page.footer, footer);
    });
  }

  it("keeps ordinary option descriptions out of enclosing command metadata", () => {
    const parser = object({
      command: command(
        "build",
        object({
          verbose: group(
            "Options",
            option("--verbose", {
              description: message`Enable verbose output`,
              hidden: true,
            }),
          ),
        }),
        { description },
      ),
    });
    const page = getDocPage(parser, ["build"]);
    assert.ok(page);
    assert.deepEqual(page.description, description);
  });

  const entryParsers: Readonly<
    Record<string, () => Parser<"sync", unknown, unknown>>
  > = {
    option: () => option("--verbose", { description: message`Verbose output` }),
    flag: () => flag("--verbose", { description: message`Verbose output` }),
    argument: () => argument(string(), { description: message`An input file` }),
    group: () =>
      group(
        "Options",
        option("--verbose", {
          description: message`Verbose output`,
        }),
      ),
  };
  for (const [name, createEntry] of Object.entries(entryParsers)) {
    it(`does not promote a command's inner ${name} entry description`, () => {
      const parser = object({
        command: command("build", createEntry(), { description }),
      });
      const page = getDocPage(parser, ["build"]);
      assert.ok(page);
      assert.deepEqual(page.description, description);
    });
  }

  it("does not promote an unselected grouped subcommand's description", () => {
    const parser = object({
      command: command(
        "build",
        group(
          "Commands",
          command("inner", object({}), {
            description: message`An inner command`,
          }),
        ),
        { description },
      ),
    });
    const page = getDocPage(parser, ["build"]);
    assert.ok(page);
    assert.deepEqual(page.description, description);
  });

  it("preserves selected command metadata through the asynchronous documentation path", async () => {
    const valueParser: ValueParser<"async", string> = {
      mode: "async",
      metavar: "TARGET",
      placeholder: "",
      parse: (input) => Promise.resolve({ success: true, value: input }),
      format: (value) => value,
    };
    const parser = object("Commands", {
      command: or(
        command(
          "build",
          object({
            target: option("--target", valueParser, {
              description: message`Build target`,
            }),
          }),
          { brief, description, footer },
        ),
        command("test", object({})),
      ),
    });
    assert.equal(parser.mode, "async");
    const page = await getDocPageAsync(parser, ["build", "--target", "x86"]);
    assert.ok(page);
    assert.deepEqual(page.brief, brief);
    assert.deepEqual(page.description, description);
    assert.deepEqual(page.footer, footer);
  });

  it("uses the first defined metadata field from selected sibling commands", () => {
    const parser = object({
      first: command("first", object({}), { description }),
      second: command("second", object({}), {
        brief,
        description: message`Second command`,
        footer,
      }),
    });
    const page = getDocPage(parser, ["first", "second"]);
    assert.ok(page);
    assert.deepEqual(page.brief, brief);
    assert.deepEqual(page.description, description);
    assert.deepEqual(page.footer, footer);
  });
});
