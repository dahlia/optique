import {
  concat,
  group,
  longestMatch,
  merge,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import { parseAsync, type Parser } from "@optique/core/parser";
import {
  command,
  constant,
  option,
  passThrough,
} from "@optique/core/primitives";
import { string, type ValueParser } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { it } from "node:test";

const asyncString: ValueParser<"async", string> = {
  mode: "async",
  metavar: "STRING",
  placeholder: "",
  format: (value) => value,
  parse: (input) => Promise.resolve({ success: true, value: input }),
};

for (const mode of ["sync", "async"] as const) {
  const parse = parseAsync<unknown>;
  const value = mode === "sync" ? string() : asyncString;

  for (const outer of ["object", "tuple", "concat"] as const) {
    const compose = (
      extra: Parser<"sync" | "async", unknown, unknown>,
      known: Parser<"sync" | "async", unknown, unknown>,
    ) =>
      outer === "object"
        ? object({ extra, known })
        : outer === "tuple"
        ? tuple([extra, known])
        : concat(tuple([extra]), tuple([known]));

    it(`${mode} ${outer} uses capture priority despite unrelated command priority`, async () => {
      const known = optional(option("-m", value));
      const rest = passThrough({ format: "nextToken" });
      const cmd = optional(command("run", constant(undefined)));
      const highCapture = { ...rest, priority: known.priority + 1 };
      assert.ok(
        (await parse(compose(object({ cmd, rest: highCapture }), known), [
          "-m",
        ])).success,
      );
      const extras: readonly Parser<"sync", unknown, unknown>[] = [
        object({ cmd, rest }),
        tuple([cmd, rest]),
        concat(tuple([cmd]), tuple([rest])),
      ];
      for (const extra of extras) {
        for (
          const wrapped of [
            extra,
            optional(extra),
            withDefault(extra, undefined),
            multiple(extra),
            map(extra, (value) => value),
            group("Extra", extra),
          ]
        ) {
          assert.deepEqual(
            await parse(compose(wrapped, known), ["-m"]),
            await parse(known, ["-m"]),
          );
        }
        assert.ok(
          (await parse(compose(extra, known), ["--unknown", "value"])).success,
        );
        assert.ok(
          (await parse(
            compose({ ...extra, priority: known.priority + 1 }, known),
            ["-m"],
          )).success,
        );
      }
    });

    for (const wrapper of ["merge", "or", "longestMatch"] as const) {
      it(`${mode} ${outer} preserves partial failure through ${wrapper}`, async () => {
        const fields = object({
          verbose: option("-v"),
          message: optional(option("-m", value)),
        });
        const known = wrapper === "merge"
          ? merge(
            object({ verbose: option("-v") }),
            object({ message: optional(option("-m", value)) }),
          )
          : wrapper === "or"
          ? or(fields, constant(undefined))
          : longestMatch(fields, constant(undefined));
        const parser = compose(passThrough({ format: "greedy" }), known);
        const expected = await parse(fields, ["-v", "-m"]);
        assert.ok(!expected.success);
        assert.deepEqual(await parse(parser, ["-v", "-m"]), expected);
        assert.ok(
          (await parse(parser, ["-v", "-m", "hello", "--unknown"])).success,
        );
      });
    }

    it(`${mode} ${outer} retains the deepest failure after partial progress`, async () => {
      const failure = (consumed: number, text: string) => {
        const base = option("-x", value);
        return optional({
          ...base,
          parse: (context: Parameters<typeof base.parse>[0]) => {
            const result = context.buffer[0] === "-x"
              ? { success: false as const, consumed, error: message`${text}` }
              : undefined;
            return mode === "async"
              ? result == null ? base.parse(context) : Promise.resolve(result)
              : result ?? base.parse(context);
          },
        });
      };
      const known = object({
        verbose: option("-v"),
        shallow: failure(1, "Shallow failure."),
        deep: failure(2, "Deep failure."),
      }, { allowDuplicates: true });
      const expected = await parse(known, ["-v", "-x", "value"]);
      assert.ok(!expected.success);
      assert.deepEqual(
        await parse(compose(passThrough({ format: "greedy" }), known), [
          "-v",
          "-x",
          "value",
        ]),
        expected,
      );
      const tied = object({
        verbose: option("-v"),
        first: failure(1, "First failure."),
        second: failure(1, "Second failure."),
      }, { allowDuplicates: true });
      assert.deepEqual(
        await parse(compose(passThrough({ format: "greedy" }), tied), [
          "-v",
          "-x",
        ]),
        await parse(tied, ["-v", "-x"]),
      );
    });
  }
}
