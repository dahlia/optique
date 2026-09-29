import {
  concat,
  conditional,
  group,
  object,
  tuple,
} from "@optique/core/constructs";
import { multiple, optional } from "@optique/core/modifiers";
import { parseAsync } from "@optique/core/parser";
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
  const value = mode === "sync" ? string() : asyncString;
  it(`${mode} reused command slots retain their own option matches`, async () => {
    const shared = optional(command("run", optional(option("-m", value))));
    const extra = object({
      unrelated: optional(command("other", constant(undefined))),
      rest: passThrough({ format: "nextToken" }),
    });
    const parser = object({ extra, first: shared, second: shared }, {
      allowDuplicates: true,
    });
    const expected = await parseAsync<unknown>(shared, ["run", "-m"]);
    assert.ok(!expected.success);
    assert.deepEqual(
      await parseAsync<unknown>(parser, ["run", "-m"]),
      expected,
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
    it(`${mode} ${outer} ignores inactive conditional option priorities`, async () => {
      const cond = conditional(constant("run"), {
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
    });
    it(`${mode} ${outer} ignores inactive conditional capture priorities`, async () => {
      const cond = conditional(constant("run"), {
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
