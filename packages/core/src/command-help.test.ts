import type { ValueParser } from "./valueparser.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { longestMatch, object, or, seq } from "./constructs.ts";
import { formatDocPage } from "./doc.ts";
import { runParser } from "./facade.ts";
import { map, multiple, optional, withDefault } from "./modifiers.ts";
import { getDocPage, type Mode, parse, type Parser } from "./parser.ts";
import { argument, command, constant, flag, option } from "./primitives.ts";
import { string } from "./valueparser.ts";

function inner(
  async: boolean,
  required = false,
): Parser<Mode, boolean, unknown> {
  const valueParser: ValueParser<"async", boolean> = {
    mode: "async",
    metavar: "BOOL",
    placeholder: false,
    parse: () => Promise.resolve({ success: true as const, value: true }),
    format: String,
  };
  const asynchronous = option("--verbose", valueParser);
  return async
    ? required ? asynchronous : withDefault(asynchronous, false)
    : option("--verbose");
}

describe("command-level showUsage", () => {
  for (const async of [false, true]) {
    const mode = async ? "async" : "sync";
    it(`${mode}: overrides runner defaults and preserves callback usage`, async () => {
      const parser = object("Commands", {
        command: or(
          command("build", inner(async), { showUsage: true }),
          command("test", inner(async), { showUsage: false }),
        ),
      });
      for (
        const args of [["--help"], ["build", "--help"], ["help", "build"], [
          "test",
          "--help",
        ]]
      ) {
        let output = "";
        await runParser(parser, "tool", args, {
          help: {
            option: true,
            command: true,
            onShow(_code, page) {
              assert.ok(page.usage != null);
              assert.equal(
                formatDocPage("tool", page, { colors: false }),
                output,
              );
              return "shown";
            },
          },
          showUsage: false,
          colors: false,
          stdout: (text) => {
            output = text;
          },
        });
        assert.equal(output.includes("Usage:"), args.includes("build"));
      }
    });

    it(`${mode}: inherits only from actual ancestors`, async () => {
      for (const child of [undefined, false, true]) {
        const parser = command(
          "parent",
          command("child", inner(async), {
            showUsage: child,
          }),
          { showUsage: true },
        );
        const page = await getDocPage(parser, ["parent", "child"]);
        assert.equal(page?.showUsage, child ?? true);
      }
      const nested = seq(
        command("a", command("b", inner(async)), { showUsage: true }),
      );
      const siblings = seq(
        command("a", constant(false), { showUsage: true }),
        command("b", inner(async)),
      );
      assert.deepEqual(nested.usage, siblings.usage);
      assert.ok((await getDocPage(nested, ["a", "b"]))?.showUsage);
      assert.equal(
        (await getDocPage(siblings, ["a", "b"]))?.showUsage,
        undefined,
      );
    });

    it(`${mode}: supports wrappers without changing the synopsis`, async () => {
      for (const showUsage of [true, false]) {
        const configured = command("build", inner(async), { showUsage });
        const original = command("build", inner(async));
        const pairs = [
          [optional(configured), optional(original)],
          [withDefault(configured, false), withDefault(original, false)],
          [multiple(configured), multiple(original)],
          [map(configured, String), map(original, String)],
        ] as const;
        for (const [parser, baseline] of pairs) {
          const page = await getDocPage(parser, ["build"]);
          assert.equal(page?.showUsage, showUsage);
          assert.deepEqual(
            page?.usage,
            (await getDocPage(baseline, ["build"]))?.usage,
          );
          assert.equal(
            (await getDocPage(object({ command: parser }), []))?.showUsage,
            undefined,
          );
        }
      }
    });

    it(`${mode}: isolates repeated siblings and aliases`, async () => {
      const parser = multiple(or(
        command("a", inner(async), { showUsage: true }),
        command("b", inner(async), { aliases: ["bee"] }),
      ));
      assert.equal(
        (await getDocPage(parser, ["a", "bee"]))?.showUsage,
        undefined,
      );
      const alias = command("build", inner(async), {
        aliases: ["b"],
        showUsage: false,
      });
      assert.ok((await getDocPage(alias, ["b"]))?.showUsage === false);
    });

    it(`${mode}: uses the selected command for help above errors`, async () => {
      const parser = command("build", inner(async), { showUsage: true });
      let output = "";
      await runParser(parser, "tool", ["build", "--invalid"], {
        aboveError: "help",
        showUsage: false,
        colors: false,
        stderr: (text) => {
          output += text;
        },
        onError: () => "error",
      });
      assert.match(output, /Usage:/);
      assert.match(output, /Error:/);
    });

    it(`${mode}: discards command policy when switching to an argument branch`, async () => {
      const parser = or(
        command("build", inner(async), { showUsage: true }),
        object({ input: argument(string()), second: flag("--second") }),
      );
      const result = await parse(parser, ["build", "--second"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { input: "build", second: true });
      const page = await getDocPage(parser, ["build", "--second"]);
      assert.equal(page?.showUsage, undefined);
    });

    it(`${mode}: retains selected command policy across the options terminator`, async () => {
      for (const showUsage of [false, true]) {
        const configured = command("build", constant("CMD"), { showUsage });
        for (
          const parser of [
            or(inner(async, true), configured),
            longestMatch(inner(async, true), configured),
          ]
        ) {
          const args = ["build", "--"];
          const result = await parse(parser, args);
          assert.ok(result.success);
          assert.equal(result.value, "CMD");
          assert.equal((await getDocPage(parser, args))?.showUsage, showUsage);
          let output = "";
          await runParser(parser, "tool", [...args, "--invalid"], {
            aboveError: "help",
            showUsage: !showUsage,
            colors: false,
            stderr: (text) => {
              output += text;
            },
            onError: () => "error",
          });
          assert.equal(output.includes("Usage:"), showUsage);
          assert.match(output, /Error:/);
        }
      }
    });

    it(`${mode}: keeps same-named command branches separate`, async () => {
      const parser = or(
        seq(flag("--one"), command("build", inner(async), { showUsage: true })),
        seq(
          flag("--two"),
          command("build", inner(async), { showUsage: false }),
        ),
      );
      assert.ok((await getDocPage(parser, ["--one", "build"]))?.showUsage);
      assert.ok(
        (await getDocPage(parser, ["--two", "build"]))?.showUsage === false,
      );
    });

    it(`${mode}: inherits through wrapped commands but ignores option values`, async () => {
      const parser = command(
        "parent",
        optional(command("child", inner(async))),
        {
          showUsage: false,
        },
      );
      assert.ok(
        (await getDocPage(parser, ["parent", "child"]))?.showUsage === false,
      );
      const root = object({
        name: option("--name", string()),
        command: optional(command("build", inner(async), { showUsage: true })),
      });
      assert.equal(
        (await getDocPage(root, ["--name", "build"]))?.showUsage,
        undefined,
      );
    });
  }

  it("formats page defaults with explicit formatter overrides", () => {
    const page = {
      usage: flag("--verbose").usage,
      sections: [],
      showUsage: false,
    };
    assert.doesNotMatch(formatDocPage("tool", page), /Usage:/);
    assert.match(formatDocPage("tool", page, { showUsage: true }), /Usage:/);
    assert.doesNotMatch(
      formatDocPage("tool", { ...page, showUsage: true }, { showUsage: false }),
      /Usage:/,
    );
  });

  it("supports bare command help but does not leak into a root menu", () => {
    const parser = command("build", flag("--verbose"), { showUsage: false });
    assert.ok(getDocPage(parser)?.showUsage === false);
    assert.equal(getDocPage(object({ command: parser }))?.showUsage, undefined);
  });

  it("rejects non-boolean command settings", () => {
    assert.throws(
      // @ts-expect-error JavaScript callers can pass invalid values.
      () => command("build", constant(false), { showUsage: "yes" }),
      TypeError,
    );
    assert.throws(
      // @ts-expect-error JavaScript callers can pass invalid values.
      () => command("build", constant(false), { showUsage: 1 }),
      TypeError,
    );
    assert.doesNotThrow(() =>
      // @ts-expect-error Nullish runtime settings follow neighboring command options.
      command("build", constant(false), { showUsage: null })
    );
  });
});
