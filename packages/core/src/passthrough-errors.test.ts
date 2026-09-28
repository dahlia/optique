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

      it("allows a greedy fallback after a consuming positional failure", () => {
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
        assert.ok(
          parseSync<unknown>(
            compose(failing, passThrough({ format: "greedy" })),
            [
              "positional",
            ],
          ).success,
        );
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
