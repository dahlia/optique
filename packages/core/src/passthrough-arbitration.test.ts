import {
  concat,
  conditional,
  group,
  longestMatch,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { parseAsync } from "@optique/core/parser";
import { message } from "@optique/core/message";
import {
  command,
  constant,
  option,
  passThrough,
} from "@optique/core/primitives";
import { string, type ValueParser } from "@optique/core/valueparser";
import { getKnownCompletion } from "./internal/passthrough.ts";
import { optional as optionalLocal } from "./modifiers.ts";
import { constant as constantLocal } from "./primitives.ts";
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
  const value = mode === "sync" ? string() : asyncString;
  it(`${mode} reused command slots reject duplicate command names`, () => {
    const shared = optional(command("run", optional(option("-m", value))));
    const extra = object({
      unrelated: optional(command("other", constant(undefined))),
      rest: passThrough({ format: "nextToken" }),
    });
    assert.throws(
      () =>
        object({ extra, first: shared, second: shared }, {
          allowDuplicates: true,
        }),
      { name: "TypeError", message: /Duplicate command name "run"/ },
    );
  });
  it(`${mode} exhausted repetitions do not advertise an option match`, async () => {
    const first = {
      ...multiple(option("-m", value), { max: 1 }),
      priority: 15,
    };
    const second = { ...multiple(option("-m", value)), priority: 5 };
    const rest = { ...passThrough({ format: "nextToken" }), priority: 10 };
    const parser = object({ first, second, rest }, { allowDuplicates: true });
    assert.deepEqual(
      await parseAsync<unknown>(parser, ["-m", "first", "-m", "second"]),
      {
        success: true,
        value: { first: ["first"], second: [], rest: ["-m", "second"] },
      },
    );
  });
  it(`${mode} capture can outrank a carried option error`, async () => {
    const known = object({
      verbose: { ...option("-v"), priority: 15 },
      message: optional(option("-m", value)),
    });
    for (
      const capture of [
        { ...passThrough({ format: "nextToken" }), priority: 12 },
        {
          ...object({ rest: passThrough({ format: "nextToken" }) }),
          priority: 12,
        },
      ]
    ) {
      const parser = object({ known, capture });
      assert.ok((await parseAsync<unknown>(parser, ["-v", "-m"])).success);
    }
    const lowerCapture = {
      ...passThrough({ format: "nextToken" }),
      priority: 9,
    };
    assert.deepEqual(
      await parseAsync<unknown>(object({ known, capture: lowerCapture }), [
        "-v",
        "-m",
      ]),
      await parseAsync<unknown>(known, ["-v", "-m"]),
    );
  });
  it(`${mode} grouping retains a known conditional discriminator`, async () => {
    const cond = conditional(group("Mode", group("Value", constant("run"))), {
      run: optional(option("-m", value)),
      other: { ...optional(option("-m", value)), priority: 13 },
    });
    const rest = { ...passThrough({ format: "nextToken" }), priority: 12 };
    assert.deepEqual(
      await parseAsync<unknown>(object({ cond, rest }), ["-m"]),
      {
        success: true,
        value: { cond: ["run", undefined], rest: ["-m"] },
      },
    );
  });
  for (const outer of ["object", "tuple", "concat"] as const) {
    for (const inner of ["object", "tuple", "concat"] as const) {
      it(`${mode} ${outer} orders pure ${inner} captures without a matching option`, async () => {
        for (const capturePriority of [5, 20, 25]) {
          for (const override of [undefined, 30]) {
            const unrelated = {
              ...optional(command("run", optional(option("--other", value)))),
              priority: 25,
            };
            const rest = {
              ...passThrough({ format: "nextToken" }),
              priority: capturePriority,
            };
            const container = inner === "object"
              ? object({ unrelated, rest })
              : inner === "tuple"
              ? tuple([unrelated, rest])
              : concat(tuple([unrelated]), tuple([rest]));
            const mixed = override == null
              ? container
              : { ...container, priority: override };
            const sibling = {
              ...passThrough({ format: "nextToken" }),
              priority: 20,
            };
            const parser = outer === "object"
              ? object({ mixed, sibling })
              : outer === "tuple"
              ? tuple([mixed, sibling])
              : concat(tuple([mixed]), tuple([sibling]));
            const args = ["-m", "hello"];
            const firstWins = (override ?? capturePriority) >= 20;
            const captured = firstWins ? args : [];
            const mixedValue = inner === "object"
              ? { unrelated: undefined, rest: captured }
              : [undefined, captured];
            assert.deepEqual(await parseAsync<unknown>(parser, args), {
              success: true,
              value: outer === "object"
                ? { mixed: mixedValue, sibling: firstWins ? [] : args }
                : [mixedValue, firstWins ? [] : args],
            });
          }
        }
      });
      it(`${mode} ${outer} excludes mixed ${inner} captures that reject the token`, async () => {
        for (const format of ["equalsOnly", "nextToken", "greedy"] as const) {
          for (const name of ["-m", "/m", "+m", "--message"] as const) {
            const args = name === "--message"
              ? ["--message=hello"]
              : [name, "hello"];
            const captures = format === "greedy" ||
              (format === "equalsOnly"
                ? name === "--message"
                : name.startsWith("-"));
            const matched = { ...optional(option(name, value)), priority: 5 };
            const rest = group("Rest", {
              ...passThrough({ format }),
              priority: 15,
            });
            const mixed = inner === "object"
              ? object({ matched, rest })
              : inner === "tuple"
              ? tuple([matched, rest])
              : concat(tuple([matched]), tuple([rest]));
            const known = { ...optional(option(name, value)), priority: 10 };
            const parser = outer === "object"
              ? object({ mixed, known }, { allowDuplicates: true })
              : outer === "tuple"
              ? tuple([mixed, known], { allowDuplicates: true })
              : concat(tuple([mixed]), tuple([known]));
            const captured = captures ? args : [];
            const mixedValue = inner === "object"
              ? { matched: undefined, rest: captured }
              : [undefined, captured];
            const knownValue = captures ? undefined : "hello";
            assert.deepEqual(await parseAsync<unknown>(parser, args), {
              success: true,
              value: outer === "object"
                ? { mixed: mixedValue, known: knownValue }
                : [mixedValue, knownValue],
            });
          }
        }
      });
      it(`${mode} ${outer} retains mixed ${inner} option order after a higher rejection`, async () => {
        const matched = { ...optional(option("-m", value)), priority: 5 };
        const rest = { ...passThrough({ format: "equalsOnly" }), priority: 15 };
        const mixed = inner === "object"
          ? object({ matched, rest })
          : inner === "tuple"
          ? tuple([matched, rest])
          : concat(tuple([matched]), tuple([rest]));
        const higherInner = optional(option("-m", string()));
        const higher = {
          ...higherInner,
          parse(context) {
            if (context.buffer[0] !== "-m") return higherInner.parse(context);
            return {
              success: false as const,
              consumed: 1,
              error: message`Rejected option.`,
            };
          },
        } satisfies typeof higherInner;
        const lower = { ...optional(option("-m", value)), priority: 1 };
        const parser = outer === "object"
          ? object({ mixed, higher, lower }, { allowDuplicates: true })
          : outer === "tuple"
          ? tuple([mixed, higher, lower], { allowDuplicates: true })
          : concat(tuple([mixed]), tuple([higher]), tuple([lower]));
        const mixedValue = inner === "object"
          ? { matched: "hello", rest: [] }
          : ["hello", []];
        assert.deepEqual(await parseAsync<unknown>(parser, ["-m", "hello"]), {
          success: true,
          value: outer === "object"
            ? { mixed: mixedValue, higher: undefined, lower: undefined }
            : [mixedValue, undefined, undefined],
        });
      });
      it(`${mode} ${outer} orders mixed ${inner} by its winning capture`, async () => {
        for (const knownPriority of [5, 15, 20]) {
          for (const unrelatedPriority of [0, 25]) {
            const unrelated = {
              ...optional(command("run", constant(undefined))),
              priority: unrelatedPriority,
            };
            const matched = { ...optional(option("-m", value)), priority: 5 };
            const rest = {
              ...passThrough({ format: "nextToken" }),
              priority: 15,
            };
            const mixed = inner === "object"
              ? object({ unrelated, matched, rest })
              : inner === "tuple"
              ? tuple([unrelated, matched, rest])
              : concat(tuple([unrelated]), tuple([matched]), tuple([rest]));
            const known = {
              ...optional(option("-m", value)),
              priority: knownPriority,
            };
            const parser = outer === "object"
              ? object({ mixed, known }, { allowDuplicates: true })
              : outer === "tuple"
              ? tuple([mixed, known], { allowDuplicates: true })
              : concat(tuple([mixed]), tuple([known]));
            const captured = knownPriority < 15 ? ["-m", "hello"] : [];
            const knownValue = knownPriority < 15 ? undefined : "hello";
            const emptyMixed = inner === "object"
              ? { unrelated: undefined, matched: undefined, rest: captured }
              : [undefined, undefined, captured];
            assert.deepEqual(
              await parseAsync<unknown>(parser, ["-m", "hello"]),
              {
                success: true,
                value: outer === "object"
                  ? { mixed: emptyMixed, known: knownValue }
                  : [emptyMixed, knownValue],
              },
            );
          }
        }
      });
    }
    it(`${mode} ${outer} excludes a rejected capture above an eligible lower lane`, async () => {
      const mixed = object({
        matched: { ...optional(option("-m", value)), priority: 5 },
        rejected: { ...passThrough({ format: "equalsOnly" }), priority: 15 },
        eligible: { ...passThrough({ format: "nextToken" }), priority: 1 },
      });
      const known = optional(option("-m", value));
      const parser = outer === "object"
        ? object({ mixed, known }, { allowDuplicates: true })
        : outer === "tuple"
        ? tuple([mixed, known], { allowDuplicates: true })
        : concat(tuple([mixed]), tuple([known]));
      const mixedValue = { matched: undefined, rejected: [], eligible: [] };
      assert.deepEqual(await parseAsync<unknown>(parser, ["-m", "hello"]), {
        success: true,
        value: outer === "object"
          ? { mixed: mixedValue, known: "hello" }
          : [mixedValue, "hello"],
      });
    });
    it(`${mode} ${outer} orders competing captures inside mixed containers`, async () => {
      const mixed = object({
        unrelated: {
          ...optional(command("run", constant(undefined))),
          priority: 25,
        },
        matched: { ...optional(option("-m", value)), priority: 5 },
        rest: { ...passThrough({ format: "nextToken" }), priority: 15 },
      });
      const rest = { ...passThrough({ format: "nextToken" }), priority: 20 };
      const parser = outer === "object"
        ? object({ mixed, rest })
        : outer === "tuple"
        ? tuple([mixed, rest])
        : concat(tuple([mixed]), tuple([rest]));
      const emptyMixed = { unrelated: undefined, matched: undefined, rest: [] };
      assert.deepEqual(await parseAsync<unknown>(parser, ["-m", "hello"]), {
        success: true,
        value: outer === "object"
          ? { mixed: emptyMixed, rest: ["-m", "hello"] }
          : [emptyMixed, ["-m", "hello"]],
      });
    });
    for (const exclusive of ["or", "longestMatch"] as const) {
      it(`${mode} ${outer} sees capture in a selectable ${exclusive} alternative`, async () => {
        const verbose = option("-v");
        const capture = passThrough({ format: "nextToken" });
        const unrelated = option("--unrelated", value);
        const alt = exclusive === "or"
          ? or(verbose, unrelated, capture)
          : longestMatch(verbose, unrelated, capture);
        const known = optional(option("-m", value));
        const parser = outer === "object"
          ? object({ alt, known })
          : outer === "tuple"
          ? tuple([alt, known])
          : concat(tuple([alt]), tuple([known]));
        const expected = await parseAsync<unknown>(known, ["-m"]);
        assert.ok(!expected.success);
        assert.deepEqual(
          await parseAsync<unknown>(parser, ["-v", "-m"]),
          expected,
        );
      });
    }
    it(`${mode} ${outer} allows recovery from rejected longestMatch errors`, async () => {
      for (const recovery of ["capture", "option"] as const) {
        const known = option("-m", value);
        const alt = recovery === "option"
          ? longestMatch(known, option("-m"))
          : longestMatch(known, constant(undefined));
        const rest = { ...passThrough({ format: "greedy" }), priority: 12 };
        const parser = outer === "object"
          ? object({ alt, rest })
          : outer === "tuple"
          ? tuple([alt, rest])
          : concat(tuple([alt]), tuple([rest]));
        // A higher-priority capture wins outright; an ordinary alternative
        // is checked with a lower-priority capture so it can consume -m.
        const ordinaryRest = passThrough({ format: "greedy" });
        const ordinaryParser = outer === "object"
          ? object({ alt, rest: ordinaryRest })
          : outer === "tuple"
          ? tuple([alt, ordinaryRest])
          : concat(tuple([alt]), tuple([ordinaryRest]));
        assert.deepEqual(
          await parseAsync<unknown>(
            recovery === "capture" ? parser : ordinaryParser,
            ["-m"],
          ),
          {
            success: true,
            value: outer === "object"
              ? {
                alt: recovery === "capture" ? undefined : true,
                rest: recovery === "capture" ? ["-m"] : [],
              }
              : [
                recovery === "capture" ? undefined : true,
                recovery === "capture" ? ["-m"] : [],
              ],
          },
        );
      }
    });
    it(`${mode} ${outer} retains errors rejected by a longestMatch fallback`, async () => {
      const known = optional(option("-m", value));
      const fallback = longestMatch(known, constant(undefined));
      for (
        const alt of [fallback, longestMatch(constant(undefined), fallback)]
      ) {
        const rest = passThrough({ format: "greedy" });
        const parser = outer === "object"
          ? object({ alt, rest })
          : outer === "tuple"
          ? tuple([alt, rest])
          : concat(tuple([alt]), tuple([rest]));
        const expected = await parseAsync<unknown>(known, ["-m"]);
        assert.ok(!expected.success);
        assert.deepEqual(await parseAsync<unknown>(parser, ["-m"]), expected);
      }
    });
    it(`${mode} ${outer} ignores inactive conditional option priorities`, async () => {
      for (
        const discriminator of [
          constant("run"),
          withDefault(withDefault(constant("run"), "other"), "other"),
          withDefault(constant("run"), "other"),
          withDefault(
            withDefault(constant("run"), () => {
              throw new Error("A known child must not evaluate its fallback.");
            }),
            "other",
          ),
        ]
      ) {
        const cond = conditional(discriminator, {
          run: optional(option("-m", value)),
          other: { ...optional(option("-m", value)), priority: 13 },
        });
        const rest = { ...passThrough({ format: "nextToken" }), priority: 12 };
        const parser = outer === "object"
          ? object({ cond, rest })
          : outer === "tuple"
          ? tuple([cond, rest])
          : concat(tuple([cond]), tuple([rest]));
        assert.deepEqual(await parseAsync<unknown>(parser, ["-m"]), {
          success: true,
          value: outer === "object"
            ? { cond: ["run", undefined], rest: ["-m"] }
            : [["run", undefined], ["-m"]],
        });
      }
    });
    it(`${mode} ${outer} ignores inactive conditional capture priorities`, async () => {
      for (
        const discriminator of [
          constant("run"),
          withDefault(withDefault(constant("run"), "other"), "other"),
          withDefault(constant("run"), "other"),
          withDefault(
            withDefault(constant("run"), () => {
              throw new Error("A known child must not evaluate its fallback.");
            }),
            "other",
          ),
        ]
      ) {
        const cond = conditional(discriminator, {
          run: passThrough({ format: "nextToken" }),
          other: { ...passThrough({ format: "nextToken" }), priority: 13 },
        });
        const known = optional(option("-m", value));
        for (const capture of [cond, object({ cond }), tuple([cond])]) {
          const parser = outer === "object"
            ? object({ capture, known })
            : outer === "tuple"
            ? tuple([capture, known])
            : concat(tuple([capture]), tuple([known]));
          const expected = await parseAsync<unknown>(known, ["-m"]);
          assert.ok(!expected.success);
          assert.deepEqual(await parseAsync<unknown>(parser, ["-m"]), expected);
        }
      }
    });
    it(`${mode} ${outer} preserves ordinary sibling order with capture present`, async () => {
      const first = object({
        unrelated: optional(command("run", constant(undefined))),
        matched: optional(option("-m", value)),
      });
      const second = { ...optional(option("-m", value)), priority: 12 };
      const rest = passThrough({ format: "nextToken" });
      const parser = outer === "object"
        ? object({ first, second, rest }, { allowDuplicates: true })
        : outer === "tuple"
        ? tuple([first, second, rest], { allowDuplicates: true })
        : concat(tuple([first]), tuple([second]), tuple([rest]));
      assert.deepEqual(await parseAsync<unknown>(parser, ["-m", "hello"]), {
        success: true,
        value: outer === "object"
          ? {
            first: { unrelated: undefined, matched: "hello" },
            second: undefined,
            rest: [],
          }
          : [{ unrelated: undefined, matched: "hello" }, undefined, []],
      });
    });
    it(`${mode} ${outer} revisits ordinary options before capture`, async () => {
      const known = option("-m", value);
      const rest = passThrough({ format: "nextToken" });
      const parser = outer === "object"
        ? object({ known, rest })
        : outer === "tuple"
        ? tuple([known, rest])
        : concat(tuple([known]), tuple([rest]));
      const args = ["-m", "first", "-m", "second"];
      const expected = await parseAsync<unknown>(known, args);
      assert.ok(!expected.success);
      assert.deepEqual(await parseAsync<unknown>(parser, args), expected);
      const repeated = multiple(option("-m", value));
      const repeatedParser = outer === "object"
        ? object({ known: repeated, rest })
        : outer === "tuple"
        ? tuple([repeated, rest])
        : concat(tuple([repeated]), tuple([rest]));
      assert.deepEqual(await parseAsync<unknown>(repeatedParser, args), {
        success: true,
        value: outer === "object"
          ? { known: ["first", "second"], rest: [] }
          : [["first", "second"], []],
      });
    });
  }
}

it("optional constants retain a known value without invoking completion", async () => {
  const child = constantLocal("run");
  const parser = optionalLocal(child);
  assert.deepEqual(getKnownCompletion(parser, parser.initialState), {
    value: "run",
  });
  assert.deepEqual(getKnownCompletion(parser, ["run"]), { value: "run" });
  assert.deepEqual(await parseAsync(parser, []), {
    success: true,
    value: "run",
  });
  let calls = 0;
  const changed = optionalLocal({
    ...child,
    complete: () => {
      calls++;
      return { success: true as const, value: "other" as const };
    },
  });
  assert.equal(getKnownCompletion(changed, changed.initialState), undefined);
  assert.equal(calls, 0);
});
