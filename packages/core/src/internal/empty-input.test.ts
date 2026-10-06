import { group, longestMatch, object, or, tuple } from "../constructs.ts";
import { createInputTrace } from "../input-trace.ts";
import {
  map,
  multiple,
  nonEmpty,
  optional,
  withDefault,
} from "../modifiers.ts";
import {
  argument,
  command,
  constant,
  fail,
  flag,
  option,
  passThrough,
} from "../primitives.ts";
import { string } from "../valueparser.ts";
import { acceptsEmptyInput, getEmptyInputFacts } from "./empty-input.ts";
import {
  createParserContext,
  type ExecutionContext,
  type Mode,
  parse,
  type Parser,
} from "./parser.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";

type AnyParser = Parser<"sync", unknown, unknown>;

function exec(
  parser: AnyParser,
  phase: "parse" | "complete",
): ExecutionContext {
  return {
    usage: parser.usage,
    phase,
    path: [],
    commandPath: [],
    trace: createInputTrace(),
  };
}

interface Observed {
  readonly step: "success" | "provisional" | "failure";
  readonly afterStep?: boolean;
  readonly fromInitial: boolean;
  readonly root: boolean;
}

function observe(parser: AnyParser): Observed {
  const result = parser.parse(createParserContext({
    buffer: [],
    state: parser.initialState,
    optionsTerminated: false,
  }, exec(parser, "parse")));
  const step = !result.success
    ? "failure"
    : result.provisional
    ? "provisional"
    : "success";
  return {
    step,
    ...(result.success
      ? {
        afterStep: parser.complete(
          result.next.state,
          exec(parser, "complete"),
        ).success,
      }
      : {}),
    fromInitial: parser.complete(
      parser.initialState,
      exec(parser, "complete"),
    ).success,
    root: parse(parser, []).success,
  };
}

/** Asserts that every known fact agrees with the runtime. */
function assertFactsSound(parser: AnyParser, label: string): void {
  const facts = getEmptyInputFacts(parser);
  const observed = observe(parser);
  if (facts.step != null) {
    assert.equal(facts.step, observed.step, `${label}: step`);
  }
  if (facts.afterStep != null && observed.afterStep != null) {
    assert.equal(facts.afterStep, observed.afterStep, `${label}: afterStep`);
  }
  if (facts.fromInitial != null) {
    assert.equal(
      facts.fromInitial,
      observed.fromInitial,
      `${label}: fromInitial`,
    );
  }
  const root = acceptsEmptyInput(facts);
  if (root != null) assert.equal(root, observed.root, `${label}: root`);
}

const FILE = () => argument(string({ metavar: "FILE" }));
const DIR = () => argument(string({ metavar: "DIR" }));

describe("empty-input facts", () => {
  const cases: readonly [string, () => Parser<Mode, unknown, unknown>][] = [
    ["constant string", () => constant("x")],
    ["constant null", () => constant(null)],
    ["constant object", () => constant({})],
    ["constant singleton array", () => constant(["x"])],
    ["fail", () => fail()],
    ["argument", FILE],
    ["valued option", () => option("--x", string())],
    ["Boolean option", () => option("--y")],
    ["flag", () => flag("--f")],
    ["command", () => command("c", constant(1))],
    ["passThrough", () => passThrough()],
    ["optional(argument)", () => optional(FILE())],
    ["optional(constant)", () => optional(constant("x"))],
    ["optional(constant null)", () => optional(constant(null))],
    ["withDefault(argument, value)", () => withDefault(FILE(), "d")],
    [
      "withDefault(argument, throwing thunk)",
      () =>
        withDefault(FILE(), (): string => {
          throw new Error("Unavailable.");
        }),
    ],
    ["map(constant)", () => map(constant("x"), (x) => x)],
    ["nonEmpty(constant)", () => nonEmpty(constant("x"))],
    [
      "nonEmpty(multiple(constant, 1))",
      () => nonEmpty(multiple(constant("x"), { min: 1 })),
    ],
    ["group(optional)", () => group("g", optional(FILE()))],
    ["multiple(argument)", () => multiple(FILE())],
    ["multiple(argument, 1)", () => multiple(FILE(), { min: 1 })],
    [
      "multiple(optional(argument), 1)",
      () => multiple(optional(FILE()), { min: 1 }),
    ],
    ["multiple(constant, 1)", () => multiple(constant("x"), { min: 1 })],
    ["multiple(constant, 2)", () => multiple(constant("x"), { min: 2 })],
    ["multiple(constant null, 1)", () => multiple(constant(null), { min: 1 })],
    ["multiple(constant object, 1)", () => multiple(constant({}), { min: 1 })],
    [
      "multiple(constant singleton array, 1)",
      () => multiple(constant(["x"]), { min: 1 }),
    ],
    [
      "multiple(optional(constant), 1)",
      () => multiple(optional(constant("x")), { min: 1 }),
    ],
    [
      "multiple(optional(constant null), 1)",
      () => multiple(optional(constant(null)), { min: 1 }),
    ],
    [
      "optional(multiple(constant null, 1))",
      () => optional(multiple(constant(null), { min: 1 })),
    ],
    [
      "multiple(or(constant null, fail), 1)",
      () => multiple(or(constant(null), fail()), { min: 1 }),
    ],
    [
      "multiple(object(constant), 1)",
      () => multiple(object({ c: constant("x") }), { min: 1 }),
    ],
    [
      "multiple(tuple(constant), 1)",
      () => multiple(tuple([constant("x")]), { min: 1 }),
    ],
    [
      "multiple(tuple(optional(argument)), 1)",
      () => multiple(tuple([optional(FILE())]), { min: 1 }),
    ],
    ["multiple(argument, max)", () => multiple(FILE(), { max: 2 })],
    ["multiple(object resembling a bound CLI state, 1)", () =>
      multiple(
        object({ hasCliValue: constant(false), x: optional(constant("x")) }),
        { min: 1 },
      )],
    ["or(multiple(object resembling a bound CLI state, 1), argument)", () =>
      or(
        multiple(
          object({ hasCliValue: constant(false), x: optional(constant("x")) }),
          { min: 1 },
        ),
        FILE(),
      )],
    [
      "or(multiple(constant null, fractional min), argument)",
      () => or(multiple(constant(null), { min: 0.5 }), FILE()),
    ],
    ["or(optional, optional)", () => or(optional(FILE()), optional(DIR()))],
    [
      "or(optional(option), argument)",
      () => or(optional(option("--x", string())), FILE()),
    ],
    ["or(constant, argument)", () => or(constant("a"), FILE())],
    [
      "or(constant, constant, argument)",
      () => or(constant("a"), constant("b"), FILE()),
    ],
    ["or(fail, argument)", () => or(fail(), FILE())],
    ["or(passThrough, argument)", () => or(passThrough(), FILE())],
    [
      "or(nonEmpty(constant), argument)",
      () => or(nonEmpty(constant("x")), FILE()),
    ],
    [
      "or(multiple(constant null, 1), constant)",
      () => or(multiple(constant(null), { min: 1 }), constant("ok")),
    ],
    [
      "longestMatch(optional, optional)",
      () => longestMatch(optional(FILE()), optional(DIR())),
    ],
    [
      "longestMatch(multiple(constant null, 1), constant)",
      () => longestMatch(multiple(constant(null), { min: 1 }), constant("ok")),
    ],
    [
      "longestMatch(optional(option), argument)",
      () => longestMatch(optional(option("--x", string())), FILE()),
    ],
    ["object()", () => object({})],
    ["object(argument)", () => object({ a: FILE() })],
    ["object(Boolean option)", () => object({ y: option("--y") })],
    ["object(nonEmpty(constant))", () => object({ v: nonEmpty(constant(1)) })],
    [
      "object(or(constant, constant))",
      () => object({ v: or(constant(1), constant(2)) }),
    ],
    ["object(longestMatch(optional(option), argument))", () =>
      object({
        v: longestMatch(optional(option("--x", string())), FILE()),
      })],
    ["tuple(argument)", () => tuple([FILE()])],
    [
      "tuple(optional, optional)",
      () => tuple([optional(FILE()), optional(DIR())]),
    ],
    [
      "tuple(or(constant, constant))",
      () => tuple([or(constant(1), constant(2))]),
    ],
    ["issue example 1", () => or(optional(FILE()), optional(DIR()))],
    ["issue example 2", () =>
      or(
        multiple(tuple([optional(fail()), constant("x")]), { min: 1 }),
        FILE(),
      )],
  ];

  for (const [label, create] of cases) {
    it(`agrees with the runtime: ${label}`, () => {
      assertFactsSound(create() as AnyParser, label);
    });
  }

  it("knows both issue examples", () => {
    const ambiguous = or(optional(FILE()), optional(DIR()));
    assert.equal(acceptsEmptyInput(getEmptyInputFacts(ambiguous)), false);
    const repeated = or(
      multiple(tuple([optional(fail()), constant("x")]), { min: 1 }),
      FILE(),
    );
    assert.equal(acceptsEmptyInput(getEmptyInputFacts(repeated)), true);
  });

  it("does not assume that a map() transform succeeds", () => {
    // The transform throws for the value that the first branch completes
    // to without input, so parsing an empty argument list throws.
    const parser = or(
      map(optional(FILE()), (value: string | undefined) => value!.length),
      FILE(),
    );
    assert.throws(() => parse(parser, []), TypeError);
    assert.equal(acceptsEmptyInput(getEmptyInputFacts(parser)), undefined);
    assert.equal(
      acceptsEmptyInput(getEmptyInputFacts(map(FILE(), (v) => v.length))),
      false,
    );
  });

  it("leaves repetition with a fractional minimum unknown", () => {
    const parser = multiple(constant(null), { min: 0.5 });
    assert.deepEqual(getEmptyInputFacts(parser), {});
  });

  it("forgets facts when parse or complete is replaced", () => {
    const parser = constant("x");
    assert.equal(getEmptyInputFacts(parser).step, "success");
    const spread = { ...parser };
    assert.deepEqual(getEmptyInputFacts(spread), {});
    const replaced = {
      ...parser,
      complete: () => ({ success: false as const, error: [] }),
    };
    assert.deepEqual(getEmptyInputFacts(replaced), {});
  });

  it("leaves custom parsers unknown", () => {
    const custom: Parser<"sync", string, undefined> = {
      ...fail<string>(),
      parse: () => ({ success: false, consumed: 0, error: [] }),
    };
    assert.deepEqual(getEmptyInputFacts(custom), {});
    const composed = or(custom, constant("x"));
    assert.equal(acceptsEmptyInput(getEmptyInputFacts(composed)), undefined);
  });
});

type Spec =
  | { readonly kind: "constant"; readonly value: unknown }
  | {
    readonly kind:
      | "fail"
      | "argument"
      | "option"
      | "booleanOption"
      | "flag"
      | "command"
      | "passThrough";
  }
  | {
    readonly kind:
      | "optional"
      | "withDefault"
      | "withDefaultThunk"
      | "map"
      | "nonEmpty"
      | "group";
    readonly child: Spec;
  }
  | { readonly kind: "multiple"; readonly child: Spec; readonly min: number }
  | {
    readonly kind: "or" | "longestMatch" | "tuple" | "object";
    readonly children: readonly Spec[];
  };

const specArbitrary: fc.Arbitrary<Spec> = fc.letrec<{ spec: Spec }>((tie) => ({
  spec: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constantFrom<Spec>(
      { kind: "constant", value: "x" },
      { kind: "constant", value: null },
      { kind: "constant", value: undefined },
      { kind: "constant", value: 0 },
      { kind: "constant", value: {} },
      { kind: "constant", value: ["x"] },
      { kind: "command" },
      { kind: "passThrough" },
      { kind: "fail" },
      { kind: "argument" },
      { kind: "option" },
      { kind: "booleanOption" },
      { kind: "flag" },
    ),
    fc.record({
      kind: fc.constantFrom(
        "optional" as const,
        "withDefault" as const,
        "withDefaultThunk" as const,
        "map" as const,
        "nonEmpty" as const,
        "group" as const,
      ),
      child: tie("spec"),
    }),
    fc.record({
      kind: fc.constant("multiple" as const),
      child: tie("spec"),
      min: fc.integer({ min: 0, max: 2 }),
    }),
    fc.record({
      kind: fc.constantFrom(
        "or" as const,
        "longestMatch" as const,
        "tuple" as const,
        "object" as const,
      ),
      children: fc.array(tie("spec"), { minLength: 1, maxLength: 3 }),
    }),
  ),
})).spec;

function build(spec: Spec, counter: { n: number }): AnyParser {
  const id = () => `${++counter.n}`;
  switch (spec.kind) {
    case "constant":
      return constant(spec.value) as AnyParser;
    case "fail":
      return fail() as AnyParser;
    case "argument":
      return argument(string({ metavar: "ARG" })) as AnyParser;
    case "option":
      return option(`--o${id()}`, string()) as AnyParser;
    case "booleanOption":
      return option(`--b${id()}`) as AnyParser;
    case "flag":
      return flag(`--f${id()}`) as AnyParser;
    case "command":
      return command(`c${id()}`, constant(1)) as AnyParser;
    case "passThrough":
      return passThrough() as AnyParser;
    case "optional":
      return optional(build(spec.child, counter)) as AnyParser;
    case "withDefault":
      return withDefault(build(spec.child, counter), "d") as AnyParser;
    case "withDefaultThunk":
      return withDefault(build(spec.child, counter), () => "d") as AnyParser;
    case "map":
      return map(build(spec.child, counter), (v) => v) as AnyParser;
    case "nonEmpty":
      return nonEmpty(build(spec.child, counter)) as AnyParser;
    case "group":
      return group("G", build(spec.child, counter)) as AnyParser;
    case "multiple":
      return multiple(build(spec.child, counter), {
        min: spec.min,
      }) as AnyParser;
    case "or": {
      const [first, ...rest] = spec.children.map((c) => build(c, counter));
      return or(first, ...rest) as AnyParser;
    }
    case "longestMatch": {
      const [first, ...rest] = spec.children.map((c) => build(c, counter));
      return longestMatch(first, ...rest) as AnyParser;
    }
    case "tuple":
      return tuple(spec.children.map((c) => build(c, counter))) as AnyParser;
    case "object":
      return object(
        Object.fromEntries(
          spec.children.map((c, i) => [`k${i}`, build(c, counter)]),
        ),
      ) as AnyParser;
  }
}

describe("empty-input facts (property)", () => {
  it("never contradict the runtime", () => {
    fc.assert(
      fc.property(specArbitrary, (spec) => {
        let parser: AnyParser;
        try {
          parser = build(spec, { n: 0 });
        } catch {
          // Some generated compositions are rejected at construction time.
          fc.pre(false);
          return;
        }
        assertFactsSound(parser, JSON.stringify(spec));
      }),
      { numRuns: 2000 },
    );
  });
});
