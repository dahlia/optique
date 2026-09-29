import { concat, group, object, or, tuple } from "@optique/core/constructs";
import { formatMessage, message } from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import { parseAsync, type Parser, parseSync } from "@optique/core/parser";
import {
  argument,
  constant,
  option,
  passThrough,
} from "@optique/core/primitives";
import { string, type ValueParser } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const asyncString: ValueParser<"async", string> = {
  mode: "async",
  metavar: "STRING",
  placeholder: "",
  format: (value) => value,
  parse: (input) => Promise.resolve({ success: true, value: input }),
};

type SyncParser = Parser<"sync", unknown, unknown>;
const compositions = {
  object: (known: SyncParser, extra: SyncParser) => object({ known, extra }),
  tuple: (known: SyncParser, extra: SyncParser) => tuple([known, extra]),
  concat: (known: SyncParser, extra: SyncParser) =>
    concat(tuple([known]), tuple([extra])),
};

describe("pass-through known-option errors", () => {
  for (const [name, compose] of Object.entries(compositions)) {
    describe(name, () => {
      for (const format of ["nextToken", "greedy"] as const) {
        for (const spelling of ["-m", "--message"]) {
          it(`preserves missing values for ${spelling} with ${format}`, () => {
            const known = optional(option("-m", "--message", string()));
            const result = parseSync<unknown>(
              compose(known, passThrough({ format })),
              [
                spelling,
              ],
            );
            assert.deepEqual(result, parseSync<unknown>(known, [spelling]));
            assert.ok(!result.success);
          });
        }
      }

      for (const format of ["nextToken", "greedy"] as const) {
        it(`checks known options before tied nested ${format} capture`, () => {
          const known = optional(option("-m", "--message", string()));
          const extra = object({
            other: option("--other"),
            rest: passThrough({ format }),
          });
          const parser = compose(extra, known);
          for (
            const wrappedExtra of [
              extra,
              optional(extra),
              multiple(extra),
              or(extra, constant(undefined)),
            ]
          ) {
            for (const spelling of ["-m", "--message"]) {
              assert.deepEqual(
                parseSync<unknown>(compose(wrappedExtra, known), [spelling]),
                parseSync<unknown>(known, [spelling]),
              );
            }
          }
          for (
            const input of [["-m", "hello"], ["--message=hello"]]
          ) {
            const result = parseSync<unknown>(parser, input);
            assert.deepEqual(result, {
              success: true,
              value: name === "object"
                ? { known: { other: false, rest: [] }, extra: "hello" }
                : [{ other: false, rest: [] }, "hello"],
            });
          }
          assert.ok(parseSync<unknown>(parser, ["--unknown=value"]).success);
        });
      }

      it("checks attached known flags before tied nested capture", () => {
        for (
          const [known, input, format] of [
            [option("--debug"), "--debug=1", "equalsOnly"],
            [option("/D"), "/D:1", "greedy"],
          ] as const
        ) {
          const extra = object({
            other: option("--other"),
            rest: passThrough({ format }),
          });
          assert.deepEqual(
            parseSync<unknown>(compose(extra, known), [input]),
            parseSync<unknown>(known, [input]),
          );
        }
      });

      it("preserves ordinary tied alternatives ahead of known options", () => {
        const ordinary = { ...option("-m"), leadingNames: new Set<string>() };
        const known = optional(option("-m", string()));
        const extra = object({
          other: option("--other"),
          rest: passThrough({ format: "nextToken" }),
        });
        const parser = name === "object"
          ? object({ extra, ordinary, known }, { allowDuplicates: true })
          : name === "tuple"
          ? tuple([extra, ordinary, known], { allowDuplicates: true })
          : concat(tuple([extra]), tuple([ordinary]), tuple([known]));
        const result = parseSync<unknown>(parser, ["-m"]);
        assert.deepEqual(result, {
          success: true,
          value: name === "object"
            ? {
              extra: { other: false, rest: [] },
              ordinary: true,
              known: undefined,
            }
            : [{ other: false, rest: [] }, true, undefined],
        });
      });

      it("preserves explicitly higher-priority nested capture", () => {
        const known = optional(option("-m", string()));
        const extra = object({
          other: option("--other"),
          rest: passThrough({ format: "nextToken" }),
        });
        assert.ok(
          parseSync<unknown>(
            compose({ ...extra, priority: known.priority + 1 }, known),
            ["-m"],
          ).success,
        );
      });

      it("parses bundled flags before tied nested capture", () => {
        const known = object({ verbose: option("-v"), debug: option("-d") });
        const extra = object({
          other: option("--other"),
          rest: passThrough({ format: "nextToken" }),
        });
        const parser = compose(extra, known);
        assert.deepEqual(parseSync<unknown>(parser, ["-vd"]), {
          success: true,
          value: name === "object"
            ? {
              known: { other: false, rest: [] },
              extra: { verbose: true, debug: true },
            }
            : [{ other: false, rest: [] }, { verbose: true, debug: true }],
        });
        for (const input of [["-vv"], ["-v", "-vd"]]) {
          const expected = parseSync<unknown>(known, input);
          assert.ok(!expected.success);
          assert.deepEqual(parseSync<unknown>(parser, input), expected);
        }
      });

      it("does not treat attached short-option values as bundles", () => {
        const extra = object({
          other: option("--other"),
          rest: passThrough({ format: "nextToken" }),
        });
        const parser = name === "object"
          ? object({
            extra,
            value: optional(option("-m", string())),
            positional: optional(argument(string())),
          })
          : name === "tuple"
          ? tuple([
            extra,
            optional(option("-m", string())),
            optional(argument(string())),
          ])
          : concat(
            tuple([extra]),
            tuple([optional(option("-m", string()))]),
            tuple([optional(argument(string()))]),
          );
        assert.deepEqual(parseSync<unknown>(parser, ["-mhello"]), {
          success: true,
          value: name === "object"
            ? {
              extra: { other: false, rest: ["-mhello"] },
              value: undefined,
              positional: undefined,
            }
            : [{ other: false, rest: ["-mhello"] }, undefined, undefined],
        });
      });

      it("allows ordinary recovery after partial nested progress", () => {
        const base = option("-m", string());
        const known = object({
          verbose: option("-v"),
          value: optional({
            ...base,
            parse: (context) =>
              context.buffer[0] === "-m"
                ? {
                  success: false,
                  consumed: 1,
                  error: message`Try another parser.`,
                }
                : base.parse(context),
          }),
        });
        const extra = object({
          recovered: option("-m"),
          rest: passThrough({ format: "nextToken" }),
        });
        const parser = name === "object"
          ? object({ known, extra }, { allowDuplicates: true })
          : name === "tuple"
          ? tuple([known, extra], { allowDuplicates: true })
          : concat(tuple([known]), tuple([extra]));
        assert.deepEqual(
          parseSync<unknown>(parser, ["-v", "-m", "--unknown"]),
          {
            success: true,
            value: name === "object"
              ? {
                known: { verbose: true, value: undefined },
                extra: { recovered: true, rest: ["--unknown"] },
              }
              : [{ verbose: true, value: undefined }, {
                recovered: true,
                rest: ["--unknown"],
              }],
          },
        );
      });

      it("preserves a custom missing-value diagnostic after earlier input", () => {
        const known = optional(option("-m", string(), {
          errors: { endOfInput: message`Please supply a message.` },
        }));
        const result = parseSync<unknown>(
          compose(known, passThrough({ format: "nextToken" })),
          ["--unknown", "value", "-m"],
        );
        assert.deepEqual(result, {
          success: false,
          error: message`Please supply a message.`,
        });
      });

      for (const format of ["equalsOnly", "nextToken", "greedy"] as const) {
        it(`preserves Boolean attached-value errors with ${format}`, () => {
          const known = option("--debug");
          const result = parseSync<unknown>(
            compose(known, passThrough({ format })),
            [
              "--debug=1",
            ],
          );
          assert.deepEqual(result, parseSync<unknown>(known, ["--debug=1"]));
          assert.ok(!result.success);
        });
      }

      if (name === "object") {
        it("preserves duplicate-option errors", () => {
          const known = option("-v");
          const result = parseSync<unknown>(
            compose(known, passThrough({ format: "nextToken" })),
            ["-v", "-v"],
          );
          assert.deepEqual(result, parseSync<unknown>(known, ["-v", "-v"]));
          assert.ok(!result.success);
        });
      }

      for (const spelling of ["/M", "+m"] as const) {
        it(`preserves missing values for ${spelling} with greedy capture`, () => {
          const known = optional(option(spelling, string()));
          const result = parseSync<unknown>(
            compose(known, passThrough({ format: "greedy" })),
            [spelling],
          );
          assert.deepEqual(result, parseSync<unknown>(known, [spelling]));
          assert.ok(!result.success);
        });
      }

      const wrappers = {
        map: () => map(passThrough({ format: "nextToken" }), (args) => args),
        optional: () => optional(passThrough({ format: "nextToken" })),
        withDefault: () =>
          withDefault(passThrough({ format: "nextToken" }), []),
        multiple: () => multiple(passThrough({ format: "nextToken" })),
        group: () => group("Extra", passThrough({ format: "nextToken" })),
        object: () => object({ rest: passThrough({ format: "nextToken" }) }),
        tuple: () => tuple([passThrough({ format: "nextToken" })]),
        concat: () => concat(tuple([passThrough({ format: "nextToken" })])),
        or: () => or(passThrough({ format: "nextToken" }), constant([])),
      };
      for (const [wrapper, extra] of Object.entries(wrappers)) {
        it(`preserves failures through ${wrapper}`, () => {
          const known = optional(option("-m", string()));
          const result = parseSync<unknown>(compose(known, extra()), ["-m"]);
          assert.deepEqual(result, parseSync<unknown>(known, ["-m"]));
          assert.ok(!result.success);
        });
      }

      it("forwards unknown options and accepts valid known options", () => {
        const known = optional(option("-m", string()));
        const parser = compose(known, passThrough({ format: "nextToken" }));
        const result = parseSync<unknown>(parser, [
          "--unknown",
          "value",
          "-m",
          "hello",
          "--other=x",
        ]);
        assert.ok(result.success);
        if (result.success) {
          assert.deepEqual(
            result.value,
            name === "object"
              ? { known: "hello", extra: ["--unknown", "value", "--other=x"] }
              : ["hello", ["--unknown", "value", "--other=x"]],
          );
        }
        assert.ok(parseSync<unknown>(parser, ["--unknown"]).success);
      });

      it("lets greedy capture follow an argument and --", () => {
        const result = parseSync<unknown>(
          compose(argument(string()), passThrough({ format: "greedy" })),
          ["container", "--", "-x"],
        );
        assert.ok(result.success);
        if (result.success) {
          assert.deepEqual(
            result.value,
            name === "object"
              ? { known: "container", extra: ["--", "-x"] }
              : ["container", ["--", "-x"]],
          );
        }
      });

      it("allows ordinary sibling recovery at --", () => {
        const result = parseSync<unknown>(
          compose(argument(string()), argument(string())),
          ["a", "--", "b"],
        );
        assert.ok(result.success);
      });

      it("allows a greedy fallback after a non-option consuming failure", () => {
        const failing: SyncParser = {
          ...argument(string()),
          parse: (context) =>
            context.buffer.length === 0
              ? { success: true, next: context, consumed: [] }
              : {
                success: false,
                consumed: 1,
                error: message`Speculative failure.`,
              },
          complete: () => ({ success: true, value: undefined }),
        };
        for (
          const token of [
            "positional",
            "--unknown",
            "-x",
            "/X",
            "+x",
            "--unknown=value",
          ]
        ) {
          assert.deepEqual(
            parseSync<unknown>(
              compose(failing, passThrough({ format: "greedy" })),
              [token],
            ),
            {
              success: true,
              value: name === "object"
                ? { known: undefined, extra: [token] }
                : [undefined, [token]],
            },
          );
        }
      });

      it("allows a normal option alternative to recover before forwarding later input", () => {
        const base = option("-m");
        const known = optional({
          ...base,
          parse: (context) =>
            context.buffer[0] === "-m"
              ? {
                success: false,
                consumed: 1,
                error: message`Try another parser.`,
              }
              : base.parse(context),
        });
        const extra = object({
          flag: option("-m"),
          rest: passThrough({ format: "nextToken" }),
        });
        const result = parseSync<unknown>(
          name === "object"
            ? object({ known, extra }, { allowDuplicates: true })
            : name === "tuple"
            ? tuple([known, extra], { allowDuplicates: true })
            : concat(tuple([known]), tuple([extra])),
          ["-m", "--unknown=value"],
        );
        assert.ok(result.success);
      });
    });
  }

  for (const format of ["nextToken", "greedy"] as const) {
    const known = optional(option("-m", "--message", asyncString));
    const parsers = {
      object: object({ known, extra: passThrough({ format }) }),
      tuple: tuple([known, passThrough({ format })]),
      concat: concat(tuple([known]), tuple([passThrough({ format })])),
    };
    for (const [name, parser] of Object.entries(parsers)) {
      it(`preserves true async ${name} missing values with ${format}`, async () => {
        for (const spelling of ["-m", "--message"]) {
          const result = await parseAsync<unknown>(parser, [spelling]);
          assert.deepEqual(
            result,
            await parseAsync<unknown>(known, [spelling]),
          );
          assert.ok(!result.success);
        }
        const valid = await parseAsync<unknown>(parser, [
          "-m",
          "hello",
          "--unknown=value",
        ]);
        assert.ok(valid.success);
      });
    }
  }

  for (const format of ["nextToken", "greedy"] as const) {
    const known = optional(option("-m", "--message", asyncString));
    const extra = object({
      other: option("--other"),
      rest: passThrough({ format }),
    });
    const parsers = {
      object: object({ extra, known }),
      tuple: tuple([extra, known]),
      concat: concat(tuple([extra]), tuple([known])),
    };
    for (const [name, parser] of Object.entries(parsers)) {
      it(`checks true async ${name} known options before tied nested ${format} capture`, async () => {
        for (const spelling of ["-m", "--message"]) {
          assert.deepEqual(
            await parseAsync<unknown>(parser, [spelling]),
            await parseAsync<unknown>(known, [spelling]),
          );
        }
        const result = await parseAsync<unknown>(parser, ["-m", "hello"]);
        assert.deepEqual(result, {
          success: true,
          value: name === "object"
            ? { extra: { other: false, rest: [] }, known: "hello" }
            : [{ other: false, rest: [] }, "hello"],
        });
        assert.ok(
          (await parseAsync<unknown>(parser, ["--unknown=value"])).success,
        );
      });
    }
  }

  for (const name of ["object", "tuple", "concat"] as const) {
    it(`forwards unknown option-shaped tokens after a true async ${name} consuming failure`, async () => {
      const failing: Parser<"async", unknown, unknown> = {
        ...argument(asyncString),
        parse: (context) =>
          Promise.resolve(
            context.buffer.length === 0
              ? { success: true, next: context, consumed: [] }
              : {
                success: false,
                consumed: 1,
                error: message`Speculative failure.`,
              },
          ),
        complete: () => Promise.resolve({ success: true, value: undefined }),
      };
      const extra = passThrough({ format: "greedy" });
      const parser = name === "object"
        ? object({ failing, extra })
        : name === "tuple"
        ? tuple([failing, extra])
        : concat(tuple([failing]), tuple([extra]));
      for (const token of ["--unknown", "-x", "/X", "+x", "--unknown=value"]) {
        assert.deepEqual(await parseAsync<unknown>(parser, [token]), {
          success: true,
          value: name === "object"
            ? { failing: undefined, extra: [token] }
            : [undefined, [token]],
        });
      }
    });

    it(`parses bundles before tied nested capture in true async ${name}`, async () => {
      const known = object({
        verbose: option("-v"),
        debug: option("-d"),
        marker: optional(option("--marker", asyncString)),
      });
      const extra = object({
        other: option("--other"),
        rest: passThrough({ format: "nextToken" }),
      });
      const parser = name === "object"
        ? object({ extra, known })
        : name === "tuple"
        ? tuple([extra, known])
        : concat(tuple([extra]), tuple([known]));
      assert.deepEqual(await parseAsync<unknown>(parser, ["-vd"]), {
        success: true,
        value: name === "object"
          ? {
            extra: { other: false, rest: [] },
            known: { verbose: true, debug: true, marker: undefined },
          }
          : [{ other: false, rest: [] }, {
            verbose: true,
            debug: true,
            marker: undefined,
          }],
      });
      for (const input of [["-vv"], ["-v", "-vd"]]) {
        const expected = await parseAsync<unknown>(known, input);
        assert.ok(!expected.success);
        assert.deepEqual(await parseAsync<unknown>(parser, input), expected);
      }
    });
  }

  it("preserves the original missing-value wording", () => {
    const result = parseSync<unknown>(
      object({
        message: optional(option("-m", string())),
        extra: passThrough({ format: "nextToken" }),
      }),
      ["-m"],
    );
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "`-m` requires `STRING`.");
    }
  });
});
