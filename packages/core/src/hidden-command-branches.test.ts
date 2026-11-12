import { conditional, object, or, tuple } from "./constructs.ts";
import type { DocPage } from "./doc.ts";
import { multiple, optional } from "./modifiers.ts";
import { getDocPage, type Mode, parse, type Parser } from "./parser.ts";
import { command, constant, option } from "./primitives.ts";
import { cloneUsage, formatUsage, type Usage } from "./usage.ts";
import { choice, string, type ValueParser } from "./valueparser.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const hidden = { hidden: "usage" } as const;

function synopsis(page: DocPage | undefined): string {
  assert.ok(page);
  assert.ok(page.usage);
  return formatUsage("app", page.usage, { expandCommands: true });
}

function values(mode: Mode, parsedInputs: string[]): ValueParser<Mode, string> {
  if (mode === "sync") return string({ metavar: "VALUE" });
  return {
    mode: "async",
    metavar: "VALUE",
    placeholder: "",
    parse(input) {
      parsedInputs.push(input);
      return Promise.resolve({ success: true, value: input });
    },
    format: (value) => value,
  };
}

async function selectedPage(
  parser: Parser<Mode, unknown, unknown>,
  mode: Mode,
  args: readonly string[],
  expected: unknown,
  parsedInputs: readonly string[],
): Promise<DocPage> {
  assert.equal(parser.mode, mode);
  const before = cloneUsage(parser.usage);
  const root = synopsis(await getDocPage(parser));
  assert.deepEqual(await parse(parser, args), {
    success: true,
    value: expected,
  });
  const page = await getDocPage(parser, args);
  assert.ok(page);
  assert.deepEqual(parser.usage, before);
  assert.equal(synopsis(await getDocPage(parser)), root);
  if (mode === "async") assert.ok(parsedInputs.includes("selected"));
  return page;
}

describe("hidden command branch selection", () => {
  for (const mode of ["sync", "async"] as const) {
    it(`${mode}: reveals only the selected conditional command`, async () => {
      const parsedInputs: string[] = [];
      const valueParser = values(mode, parsedInputs);
      const parser = conditional(
        option("--mode", choice(["public", "internal"])),
        {
          public: command(
            "serve",
            option("--public-host", valueParser),
            hidden,
          ),
          internal: command(
            "serve",
            option("--internal-token", valueParser),
            { hidden: true },
          ),
        },
      );
      const page = await selectedPage(
        parser,
        mode,
        ["--mode", "public", "serve", "--public-host", "selected"],
        ["public", "selected"],
        parsedInputs,
      );
      const text = synopsis(page);
      assert.match(text, /\bserve\b/);
      assert.match(text, /--public-host/);
      assert.doesNotMatch(text, /--internal-token/);
      assert.equal(text.match(/\bserve\b/g)?.length, 1);
    });

    it(`${mode}: keeps an unselected shared command prefix hidden`, async () => {
      const parsedInputs: string[] = [];
      const valueParser = values(mode, parsedInputs);
      const parser = optional(or(
        command(
          "alpha",
          command("foo", option("--value", valueParser), hidden),
          hidden,
        ),
        command(
          "alpha",
          command("bar", option("--other", valueParser), hidden),
          hidden,
        ),
      ));
      const page = await selectedPage(
        parser,
        mode,
        ["alpha", "foo", "--value", "selected"],
        "selected",
        parsedInputs,
      );
      const text = synopsis(page);
      assert.match(text, /\bfoo\b/);
      assert.equal(text.match(/\balpha\b/g)?.length, 1);
      assert.doesNotMatch(text, /\bbar\b/);
    });

    it(`${mode}: retains a trailing command after selecting the short branch`, async () => {
      const parsedInputs: string[] = [];
      const parser = tuple([
        optional(or(
          command("alpha", command("beta", constant("long"), hidden), hidden),
          tuple([
            option("--short"),
            command("alpha", constant("short"), hidden),
          ]),
        )),
        multiple(
          command(
            "beta",
            option("--value", values(mode, parsedInputs)),
            hidden,
          ),
          { min: 1, max: 1 },
        ),
      ]);
      const page = await selectedPage(
        parser,
        mode,
        ["--short", "alpha", "beta", "--value", "selected"],
        [[true, "short"], ["selected"]],
        parsedInputs,
      );
      assert.ok(page.usage);
      // The option gate selects the shorter alternative.  The final beta
      // belongs to the following tuple field, not the longer alternative.
      const trailing = page.usage.at(-1);
      assert.ok(trailing);
      assert.match(formatUsage("app", [trailing]), /\bbeta\b/);
    });

    it(`${mode}: distinguishes branches reusing the same command parser`, async () => {
      const parsedInputs: string[] = [];
      const valueParser = values(mode, parsedInputs);
      const serve = command("serve", constant("serve"), hidden);
      const parser = conditional(
        option("--mode", choice(["public", "internal"])),
        {
          public: tuple([serve, option("--public-host", valueParser)]),
          internal: tuple([serve, option("--internal-token", valueParser)]),
        },
      );
      const page = await selectedPage(
        parser,
        mode,
        ["--mode", "public", "serve", "--public-host", "selected"],
        ["public", ["serve", "selected"]],
        parsedInputs,
      );
      const text = synopsis(page);
      assert.match(text, /\bserve\b/);
      assert.doesNotMatch(text, /--internal-token/);
      assert.equal(text.match(/\bserve\b/g)?.length, 1);
    });

    it(`${mode}: reveals only the final branch after shared-option replay`, async () => {
      const parsedInputs: string[] = [];
      const valueParser = values(mode, parsedInputs);
      const parser = optional(or(
        object({
          shared: option("--shared", valueParser),
          action: command("serve", constant("public"), hidden),
          publicHost: option("--public-host", valueParser),
        }),
        object({
          shared: option("--shared", valueParser),
          action: command("serve", constant("internal"), hidden),
          internalToken: option("--internal-token", valueParser),
        }),
      ));
      const page = await selectedPage(
        parser,
        mode,
        ["--shared", "seed", "--internal-token", "selected", "serve"],
        { shared: "seed", action: "internal", internalToken: "selected" },
        parsedInputs,
      );
      const text = synopsis(page);
      assert.match(text, /\bserve\b/);
      assert.match(text, /--internal-token/);
      assert.doesNotMatch(text, /--public-host/);
      assert.equal(text.match(/\bserve\b/g)?.length, 1);
    });

    it(`${mode}: retains commands selected in earlier repeated items`, async () => {
      const parsedInputs: string[] = [];
      const valueParser = values(mode, parsedInputs);
      const parser = multiple(command(
        "item",
        or(
          command(
            "alpha",
            tuple([constant("alpha"), option("--value", valueParser)]),
            hidden,
          ),
          command(
            "beta",
            tuple([constant("beta"), option("--value", valueParser)]),
            hidden,
          ),
          command("gamma", constant("gamma"), hidden),
        ),
      ));
      const page = await selectedPage(
        parser,
        mode,
        [
          "item",
          "alpha",
          "--value",
          "selected",
          "item",
          "beta",
          "--value",
          "selected",
        ],
        [["alpha", "selected"], ["beta", "selected"]],
        parsedInputs,
      );
      const text = synopsis(page);
      assert.match(text, /\balpha\b/);
      assert.match(text, /\bbeta\b/);
      assert.doesNotMatch(text, /\bgamma\b/);
    });
  }
});

describe("exclusive navigation with a usage-free discriminator", () => {
  for (const mode of ["sync", "async"] as const) {
    for (const shape of ["direct", "nested", "default"] as const) {
      it(`${mode}: navigates to the selected ${shape} branch`, async () => {
        const parsedInputs: string[] = [];
        const value = values(mode, parsedInputs);
        const branches = {
          public: command("serve", option("--public-host", value), hidden),
          internal: command("serve", option("--internal-token", value), hidden),
        };
        const cli = shape === "default"
          ? conditional(
            constant("fallback"),
            branches,
            command("serve", option("--default-target", value), hidden),
          )
          : conditional(constant("internal"), branches);
        const parser = shape === "nested"
          ? command(
            "project",
            tuple([cli, optional(option("--global"))]),
            hidden,
          )
          : cli;
        const flag = shape === "default"
          ? "--default-target"
          : "--internal-token";
        const args = shape === "nested"
          ? ["project", "serve", flag, "selected", "--global"]
          : ["serve", flag, "selected"];
        const expected = shape === "nested"
          ? [["internal", "selected"], true]
          : [shape === "default" ? undefined : "internal", "selected"];
        const page = await selectedPage(
          parser,
          mode,
          args,
          expected,
          parsedInputs,
        );
        const text = synopsis(page);
        assert.match(text, /\bserve\b/);
        assert.ok(text.includes(flag));
        assert.doesNotMatch(text, /--public-host/);
        if (shape === "nested") assert.match(text, /--global/);
      });
    }

    it(`${mode}: applies only the selected same-named command's usageLine`, async () => {
      const parsedInputs: string[] = [];
      const called: string[] = [];
      const value = values(mode, parsedInputs);
      const parser = conditional(constant("internal"), {
        public: command("serve", option("--public-host", value), {
          ...hidden,
          usageLine() {
            called.push("public");
            return [{ type: "literal", value: "PUBLIC" }];
          },
        }),
        internal: command("serve", option("--internal-token", value), {
          ...hidden,
          usageLine() {
            called.push("internal");
            return [{ type: "literal", value: "INTERNAL" }];
          },
        }),
      });
      await selectedPage(
        parser,
        mode,
        ["serve", "--internal-token", "selected"],
        ["internal", "selected"],
        parsedInputs,
      );
      assert.equal(
        synopsis(await getDocPage(parser, ["serve"])),
        "app serve INTERNAL",
      );
      assert.deepEqual(called, ["internal"]);
    });
  }
});

describe("exclusive navigation through command wrappers", () => {
  for (const mode of ["sync", "async"] as const) {
    for (
      const wrapper of ["optional", "multiple", "nested", "with tail"] as const
    ) {
      for (const wrongHidden of [false, true]) {
        it(`${mode}: selects ${wrapper} before a ${wrongHidden ? "hidden" : "visible"} same-named branch`, async () => {
          const parsedInputs: string[] = [];
          const value = values(mode, parsedInputs);
          const selected = command(
            "alpha",
            option("--selected", value),
            hidden,
          );
          const wrapped = wrapper === "optional"
            ? optional(selected)
            : wrapper === "multiple"
            ? multiple(selected, { min: 1, max: 1 })
            : wrapper === "nested"
            ? optional(or(
              multiple(optional(selected), { min: 1, max: 1 }),
              command("different", constant("different"), hidden),
            ))
            : tuple([optional(selected), optional(option("--global"))]);
          const parser = or(
            wrapped,
            command("alpha", option("--wrong", value), { hidden: wrongHidden }),
          );
          const args = wrapper === "with tail"
            ? ["alpha", "--selected", "selected", "--global"]
            : ["alpha", "--selected", "selected"];
          const expected = wrapper === "optional"
            ? "selected"
            : wrapper === "with tail"
            ? ["selected", true]
            : ["selected"];
          const page = await selectedPage(
            parser,
            mode,
            args,
            expected,
            parsedInputs,
          );
          const text = synopsis(page);
          assert.equal(text.match(/\balpha\b/g)?.length, 1);
          assert.match(text, /--selected/);
          assert.doesNotMatch(text, /--wrong/);
          if (wrapper === "with tail") assert.match(text, /--global/);
          assert.ok(page.usage);
          assert.notEqual(page.usage[0].type, "command");
        });
      }
    }
  }
});

describe("wrapped command navigation provenance guards", () => {
  for (const mode of ["sync", "async"] as const) {
    it(`${mode}: skips known unselected IDs during name fallback`, async () => {
      const parsedInputs: string[] = [];
      const value = values(mode, parsedInputs);
      const selected = command("alpha", option("--selected", value), hidden);
      const wrong = command("alpha", option("--wrong", value), hidden);
      const usage: Usage = [{
        type: "exclusive",
        terms: [wrong.usage, [
          { type: "command", name: "alpha", hidden: "usage" },
          { type: "literal", value: "CUSTOM" },
        ]],
      }];
      const page = await selectedPage(
        { ...selected, usage },
        mode,
        ["alpha", "--selected", "selected"],
        "selected",
        parsedInputs,
      );
      assert.equal(synopsis(page), "app alpha CUSTOM");
    });

    it(`${mode}: preserves selections from multiple repeated alternatives`, async () => {
      const parsedInputs: string[] = [];
      const value = values(mode, parsedInputs);
      const parser = or(
        multiple(
          command(
            "item",
            or(
              command("alpha", option("--value", value), hidden),
              command("beta", option("--value", value), hidden),
              command("gamma", constant("gamma"), hidden),
            ),
            hidden,
          ),
          { min: 2, max: 2 },
        ),
        command("item", option("--wrong", value)),
      );
      const page = await selectedPage(
        parser,
        mode,
        [
          "item",
          "alpha",
          "--value",
          "selected",
          "item",
          "beta",
          "--value",
          "selected",
        ],
        ["selected", "selected"],
        parsedInputs,
      );
      const text = synopsis(page);
      assert.match(text, /\balpha\b/);
      assert.match(text, /\bbeta\b/);
      assert.doesNotMatch(text, /\bgamma\b|--wrong/);
      assert.ok(page.usage);
      assert.equal(page.usage[0].type, "multiple");
      assert.equal(page.usage[0].min, 2);
    });

    it(`${mode}: does not run an unselected sibling's usageLine`, async () => {
      const parsedInputs: string[] = [];
      const value = values(mode, parsedInputs);
      let wrongCalls = 0;
      const parser = or(
        optional(command("alpha", option("--selected", value), hidden)),
        command("alpha", option("--wrong", value), {
          usageLine() {
            wrongCalls++;
            return [{ type: "literal", value: "WRONG" }];
          },
        }),
      );
      await selectedPage(
        parser,
        mode,
        ["alpha", "--selected", "selected"],
        "selected",
        parsedInputs,
      );
      const text = synopsis(await getDocPage(parser, ["alpha"]));
      assert.match(text, /\balpha\b/);
      assert.match(text, /--selected/);
      assert.equal(wrongCalls, 0);
    });
  }
});
