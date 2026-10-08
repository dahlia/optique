import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineEmptyInputBehavior,
  defineTraits,
  delegateSuggestNodes,
  getEmptyInputBehavior,
  getTraits,
  inheritEmptyInputBehavior,
  mapSourceMetadata,
  type ParserSourceMetadata,
} from "#src/extension.ts";
import { message } from "#src/message.ts";
import type { Parser } from "#src/parser.ts";
import { parse, parseAsync } from "#src/parser.ts";
import { group, longestMatch, object, or, tuple } from "#src/constructs.ts";
import {
  map,
  multiple,
  nonEmpty,
  optional,
  withDefault,
} from "#src/modifiers.ts";
import { argument, constant, fail } from "#src/primitives.ts";
import { string } from "#src/valueparser.ts";
import { formatUsage, normalizeUsage } from "#src/usage.ts";
import fc from "fast-check";

function createTestParser(
  dependencyMetadata?: Parser<"sync", unknown, unknown>["dependencyMetadata"],
): Parser<"sync", unknown, unknown> {
  return {
    mode: "sync",
    $valueType: [] as const,
    $stateType: [] as const,
    priority: 0,
    usage: [],
    leadingNames: new Set(),
    acceptingAnyToken: false,
    initialState: undefined,
    parse(context) {
      return {
        success: false as const,
        consumed: 0,
        error: message`unused parse: ${String(context.state)}`,
      };
    },
    complete() {
      return { success: true as const, value: undefined };
    },
    suggest() {
      return [];
    },
    getDocFragments() {
      return { fragments: [] };
    },
    ...(dependencyMetadata === undefined ? {} : { dependencyMetadata }),
  };
}

function createSourceMetadata(
  sourceId: symbol,
): NonNullable<
  Parser<"sync", unknown, unknown>["dependencyMetadata"]
>["source"] {
  return {
    kind: "source",
    sourceId,
    preservesSourceValue: true,
    extractSourceValue(state) {
      if (typeof state !== "string") return undefined;
      return { success: true as const, value: state };
    },
  };
}

describe("extension", () => {
  describe("defineTraits()/getTraits()", () => {
    it("returns an empty object when no traits are defined", () => {
      const parser = createTestParser();

      assert.deepEqual(getTraits(parser), {});
      assert.ok(Object.isFrozen(getTraits(parser)));
    });

    it("defines and reads parser traits", () => {
      const parser = createTestParser();

      defineTraits(parser, {
        inheritsAnnotations: true,
        completesFromSource: true,
        requiresSourceBinding: true,
      });

      assert.deepEqual(getTraits(parser), {
        inheritsAnnotations: true,
        completesFromSource: true,
        requiresSourceBinding: true,
      });
    });

    it("preserves completesFromSource across parser spreads", () => {
      const parser = createTestParser();

      defineTraits(parser, { completesFromSource: true });

      const clone = { ...parser };

      assert.deepEqual(getTraits(clone), { completesFromSource: true });
    });
  });

  describe("delegateSuggestNodes()", () => {
    it("appends the outer source node after inner nodes by default", () => {
      const innerParser = createTestParser({
        source: createSourceMetadata(Symbol("inner-source")),
      });
      const outerParser = createTestParser({
        source: createSourceMetadata(Symbol("outer-source")),
      });

      const nodes = delegateSuggestNodes(
        innerParser,
        outerParser,
        "outer-state",
        ["field"],
        "inner-state",
      );

      assert.equal(nodes.length, 2);
      assert.equal(nodes[0].parser, innerParser);
      assert.equal(nodes[0].state, "inner-state");
      assert.deepEqual(nodes[0].path, ["field"]);
      assert.equal(nodes[1].parser, outerParser);
      assert.equal(nodes[1].state, "outer-state");
      assert.deepEqual(nodes[1].path, ["field"]);
    });

    it("prepends the outer source node when requested", () => {
      const innerParser = createTestParser({
        source: createSourceMetadata(Symbol("inner-source")),
      });
      const outerParser = createTestParser({
        source: createSourceMetadata(Symbol("outer-source")),
      });

      const nodes = delegateSuggestNodes(
        innerParser,
        outerParser,
        "outer-state",
        ["field"],
        "inner-state",
        "prepend",
      );

      assert.equal(nodes.length, 2);
      assert.equal(nodes[0].parser, outerParser);
      assert.equal(nodes[1].parser, innerParser);
    });

    it("returns only inner nodes when outer parser has no source metadata", () => {
      const innerParser = createTestParser({
        source: createSourceMetadata(Symbol("inner-source")),
      });
      const outerParser = createTestParser();

      const nodes = delegateSuggestNodes(
        innerParser,
        outerParser,
        "outer-state",
        ["field"],
        "inner-state",
      );

      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].parser, innerParser);
      assert.equal(nodes[0].state, "inner-state");
      assert.deepEqual(nodes[0].path, ["field"]);
    });
  });

  describe("mapSourceMetadata()", () => {
    it("maps source metadata while preserving other dependency capabilities", () => {
      const derived = {
        kind: "derived" as const,
        dependencyIds: [Symbol("dep")],
        replayParse: () => ({ success: true as const, value: "ok" }),
      };
      const transform = { transformsSourceValue: true as const };
      const parser = createTestParser({
        source: createSourceMetadata(Symbol("source")),
        derived,
        transform,
      });

      const mapped = mapSourceMetadata(
        parser,
        (source: ParserSourceMetadata<"sync", unknown, unknown>) => ({
          ...source,
          preservesSourceValue: false,
        }),
      );

      assert.ok(mapped != null);
      assert.ok(mapped.source != null);
      assert.ok(!mapped.source.preservesSourceValue);
      assert.equal(mapped.derived, derived);
      assert.equal(mapped.transform, transform);
    });

    it("returns undefined when the parser has no source metadata", () => {
      const parser = createTestParser();

      const mapped = mapSourceMetadata(
        parser,
        (source: ParserSourceMetadata<"sync", unknown, unknown>) => source,
      );

      assert.equal(mapped, undefined);
    });

    it("preserves non-source dependency metadata unchanged", () => {
      const derived = {
        kind: "derived" as const,
        dependencyIds: [Symbol("dep")],
        replayParse: () => ({ success: true as const, value: "ok" }),
      };
      const transform = { transformsSourceValue: true as const };
      const parser = createTestParser({ derived, transform });

      const mapped = mapSourceMetadata(
        parser,
        (source: ParserSourceMetadata<"sync", unknown, unknown>) => source,
      );

      assert.deepEqual(mapped, { derived, transform });
    });
  });
});

describe("empty-input behavior", () => {
  it("should let declared custom branches determine group notation", () => {
    const fallback = staticEmptyParser("success", true, true);
    const required = argument(string({ metavar: "FILE" }));
    const parser = or(fallback, required);
    assert.ok(parse(parser, []).success);
    assert.equal(formatUsage("app", parser.usage), "app [FILE]");
    const ambiguous = group(
      "files",
      or(
        fallback,
        staticEmptyParser("success", true, true),
        optional(required),
      ),
      { hidden: "doc" },
    );
    assert.ok(!parse(ambiguous, []).success);
    assert.equal(
      formatUsage("app", normalizeUsage(ambiguous.usage)),
      "app (FILE)",
    );
  });

  it("should rank provisional async declarations against definitive ones", async () => {
    const definitive = staticEmptyParser("success", true, true);
    const asyncParser = asyncEmptyParser("provisional", false, false);
    defineEmptyInputBehavior(asyncParser, {
      step: "provisional",
      afterStep: false,
      fromInitial: false,
    });
    const parser = longestMatch(asyncParser, definitive);
    assert.ok((await parseAsync(parser, [])).success);
    assert.deepEqual(getEmptyInputBehavior(parser), {
      step: "success",
      afterStep: true,
      fromInitial: true,
    });
    assert.ok((await parser.complete(parser.initialState)).success);
  });

  it("should declare committed provisional longest matches as definitive", () => {
    const custom = staticEmptyParser("provisional", true, true);
    const committed = longestMatch(custom, fail());
    const parser = or(argument(string({ metavar: "FILE" })), committed);
    assert.ok(parse(parser, []).success);
    assert.equal(getEmptyInputBehavior(committed).step, "success");
    assert.equal(
      formatUsage("app", normalizeUsage(parser.usage)),
      "app [FILE]",
    );
  });

  it("should keep parse-phase completion probes unknown for public declarations", () => {
    const base = staticEmptyParser("success", true, true);
    const custom: Parser<"sync", string, boolean> = {
      ...base,
      complete(state, exec) {
        return exec?.phase === "parse"
          ? { success: false, error: message`Completion phase required.` }
          : base.complete(state, exec);
      },
    };
    defineEmptyInputBehavior(custom, {
      step: "success",
      afterStep: true,
      fromInitial: true,
    });
    const aggregate = object({ custom });
    const parser = or(aggregate, argument(string({ metavar: "FILE" })));
    assert.ok(parse(custom, []).success);
    assert.ok(!parse(parser, []).success);
    assert.equal(getEmptyInputBehavior(aggregate).step, undefined);
    for (
      const wrapped of [
        tuple([custom]),
        map(custom, (value) => value),
        nonEmpty(custom),
        optional(custom),
        withDefault(custom, "fallback"),
        longestMatch(custom, fail()),
        or(custom, fail()),
      ]
    ) {
      const nested = object({ wrapped });
      assert.ok(!parse(nested, []).success);
      assert.equal(getEmptyInputBehavior(nested).step, undefined);
    }
    const transparent = { ...custom };
    inheritEmptyInputBehavior(transparent, custom);
    assert.equal(
      getEmptyInputBehavior(object({ transparent })).step,
      undefined,
    );

    assert.equal(
      formatUsage("app", normalizeUsage(parser.usage)),
      "app (FILE)",
    );
  });

  it("should keep item retention unknown for public successful declarations", () => {
    const custom = staticEmptyParser("success", true, true);
    assert.deepEqual(getEmptyInputBehavior(multiple(custom, { min: 1 })), {
      fromInitial: false,
    });
    const failure = staticEmptyParser("failure", false, false);
    assert.deepEqual(getEmptyInputBehavior(multiple(failure)), {
      step: "success",
      afterStep: true,
      fromInitial: true,
    });
  });

  it("should snapshot declarations, omit unknown fields and hide internal state", () => {
    const parser = constant("value");
    const declaration: {
      step: "success";
      afterStep: boolean;
      fromInitial?: boolean;
      next: { unchanged: true };
    } = { step: "success", afterStep: true, next: { unchanged: true } };
    defineEmptyInputBehavior(parser, declaration);
    declaration.afterStep = false;
    assert.deepEqual(getEmptyInputBehavior(parser), {
      step: "success",
      afterStep: true,
    });
    assert.ok(Object.isFrozen(getEmptyInputBehavior(parser)));
    assert.equal(
      getEmptyInputBehavior(multiple(parser, { min: 1 })).afterStep,
      undefined,
    );
    defineEmptyInputBehavior(parser, {});
    assert.deepEqual(getEmptyInputBehavior(parser), {});
    defineEmptyInputBehavior(parser, { step: undefined, afterStep: undefined });
    assert.deepEqual(getEmptyInputBehavior(parser), {});
    defineEmptyInputBehavior(parser, { step: "failure", fromInitial: false });
    assert.equal(getEmptyInputBehavior(parser).step, "failure");
  });

  it("should reject malformed JavaScript declarations before replacing facts", () => {
    const parser = constant("value");
    for (
      const declaration of [
        { step: "sucess" },
        { step: null },
        { afterStep: 1 },
        { fromInitial: null },
        { step: "failure", afterStep: false },
      ]
    ) {
      assert.throws(
        () =>
          Reflect.apply(defineEmptyInputBehavior, undefined, [
            parser,
            declaration,
          ]),
        TypeError,
      );
      assert.equal(getEmptyInputBehavior(parser).step, "success");
    }
  });

  it("should invalidate replaced methods, data states and modes, and drop spreads", () => {
    for (
      const member of ["parse", "complete", "initialState", "mode"] as const
    ) {
      const parser = constant("value");
      Object.defineProperty(parser, member, {
        value: member === "parse"
          ? fail().parse
          : member === "complete"
          ? fail().complete
          : member === "mode"
          ? "async"
          : "changed",
        configurable: true,
      });
      assert.deepEqual(getEmptyInputBehavior(parser), {});
    }
    assert.deepEqual(getEmptyInputBehavior({ ...constant("value") }), {});
    assert.equal(getEmptyInputBehavior(constant(NaN)).step, "success");
  });

  it("should bind own and inherited state getters without evaluating them", () => {
    const inner = constant("value");
    const getter = () => {
      throw new Error("Metadata must not read the state.");
    };
    const parser = { ...inner };
    Object.defineProperty(parser, "initialState", {
      get: getter,
      configurable: true,
    });
    defineEmptyInputBehavior(parser, { step: "success" });
    assert.equal(getEmptyInputBehavior(parser).step, "success");
    const inherited: Parser<"sync", string, string> = Object.create(parser);
    defineEmptyInputBehavior(inherited, { step: "success" });
    assert.equal(getEmptyInputBehavior(inherited).step, "success");
    Object.defineProperty(parser, "initialState", {
      get: () => "new",
      configurable: true,
    });
    assert.deepEqual(getEmptyInputBehavior(parser), {});
    assert.deepEqual(getEmptyInputBehavior(inherited), {});
  });

  it("should invalidate getter-to-data and data-to-getter replacements", () => {
    const parser = constant("value");
    Object.defineProperty(parser, "initialState", {
      get: () => "value",
      configurable: true,
    });
    assert.deepEqual(getEmptyInputBehavior(parser), {});
    defineEmptyInputBehavior(parser, { step: "success" });
    Object.defineProperty(parser, "initialState", {
      value: "value",
      configurable: true,
    });
    assert.deepEqual(getEmptyInputBehavior(parser), {});
  });

  it("should keep inherited completion probes unknown when methods differ", () => {
    const inner = constant("value");
    const wrapper = {
      ...inner,
      complete(
        state: Parameters<typeof inner.complete>[0],
        exec?: Parameters<typeof inner.complete>[1],
      ) {
        return exec?.phase === "parse"
          ? {
            success: false as const,
            error: message`Completion phase required.`,
          }
          : inner.complete(state, exec);
      },
    };
    inheritEmptyInputBehavior(wrapper, inner);
    const aggregate = object({ wrapper });
    const parser = or(aggregate, argument(string({ metavar: "FILE" })));
    assert.ok(parse(wrapper, []).success);
    assert.ok(!parse(parser, []).success);
    assert.equal(getEmptyInputBehavior(aggregate).step, undefined);
    assert.equal(
      formatUsage("app", normalizeUsage(parser.usage)),
      "app (FILE)",
    );
  });

  it("should preserve internal item facts only for identical execution members", () => {
    const inner = constant("value");
    const transparent = { ...inner };
    inheritEmptyInputBehavior(transparent, inner);
    const repeated = multiple(transparent, { min: 1 });
    assert.ok(parse(repeated, []).success);
    assert.equal(getEmptyInputBehavior(repeated).afterStep, true);
    const delegate = {
      ...inner,
      parse: (context: Parameters<typeof inner.parse>[0]) =>
        inner.parse(context),
    };
    inheritEmptyInputBehavior(delegate, inner);
    assert.deepEqual(
      getEmptyInputBehavior(delegate),
      getEmptyInputBehavior(inner),
    );
    assert.equal(
      getEmptyInputBehavior(multiple(delegate, { min: 1 })).afterStep,
      undefined,
    );
    const changed = { ...inner, initialState: "different" };
    inheritEmptyInputBehavior(changed, inner);
    assert.equal(
      getEmptyInputBehavior(multiple(changed, { min: 1 })).afterStep,
      undefined,
    );
  });

  it("should lose item facts when spread snapshots a state getter", () => {
    const inner = object({ value: constant("value") });
    const wrapper = { ...inner };
    inheritEmptyInputBehavior(wrapper, inner);
    assert.equal(
      getEmptyInputBehavior(multiple(wrapper, { min: 1 })).afterStep,
      undefined,
    );
  });

  it("should clear destinations when the source is unknown and reject mode changes", () => {
    const wrapper = constant("value");
    inheritEmptyInputBehavior(wrapper, { ...fail() });
    assert.deepEqual(getEmptyInputBehavior(wrapper), {});
    const asyncWrapper = asyncEmptyParser("success", true, true);
    assert.throws(
      () => inheritEmptyInputBehavior(asyncWrapper, wrapper),
      TypeError,
    );
  });

  it("should keep known behavior sound across generated custom compositions", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("success", "provisional", "failure"),
        fc.boolean(),
        fc.boolean(),
        (step, afterStep, fromInitial) => {
          const parser = staticEmptyParser(step, afterStep, fromInitial);
          const parsers: readonly Parser<"sync", unknown, unknown>[] = [
            parser,
            optional(parser),
            withDefault(parser, "default"),
            tuple([parser]),
            or(parser, argument(string())),
            longestMatch(parser, constant("fallback")),
            multiple(parser),
            multiple(parser, { min: 1 }),
          ];
          for (const composed of parsers) {
            const behavior = getEmptyInputBehavior(composed);
            const result = composed.parse({
              buffer: [],
              state: composed.initialState,
              optionsTerminated: false,
              usage: composed.usage,
            });
            if (behavior.step !== undefined) {
              assert.equal(
                behavior.step,
                !result.success
                  ? "failure"
                  : result.provisional
                  ? "provisional"
                  : "success",
              );
            }
            if (behavior.afterStep !== undefined && result.success) {
              assert.equal(
                behavior.afterStep,
                composed.complete(result.next.state).success,
              );
            }
            if (behavior.fromInitial !== undefined) {
              assert.equal(
                behavior.fromInitial,
                composed.complete(composed.initialState).success,
              );
            }
            if (
              behavior.step !== undefined &&
              (behavior.step === "failure" || behavior.afterStep !== undefined)
            ) {
              assert.equal(
                parse(composed, []).success,
                behavior.step !== "failure" && behavior.afterStep === true,
              );
            }
          }
        },
      ),
    );
  });
  it("should keep known async composition behavior sound", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("success", "provisional", "failure"),
        fc.boolean(),
        fc.boolean(),
        async (step, afterStep, fromInitial) => {
          const parser = asyncEmptyParser(step, afterStep, fromInitial);
          const parsers: readonly Parser<"async", unknown, unknown>[] = [
            parser,
            optional(parser),
            tuple([parser]),
            or(parser, argument(string())),
            longestMatch(parser, constant("fallback")),
            multiple(parser),
          ];
          for (const composed of parsers) {
            const behavior = getEmptyInputBehavior(composed);
            const result = await composed.parse({
              buffer: [],
              state: composed.initialState,
              optionsTerminated: false,
              usage: composed.usage,
            });
            if (behavior.step !== undefined) {
              assert.equal(
                behavior.step,
                !result.success
                  ? "failure"
                  : result.provisional
                  ? "provisional"
                  : "success",
              );
            }
            if (behavior.afterStep !== undefined && result.success) {
              assert.equal(
                behavior.afterStep,
                (await composed.complete(result.next.state)).success,
              );
            }
            if (behavior.fromInitial !== undefined) {
              assert.equal(
                behavior.fromInitial,
                (await composed.complete(composed.initialState)).success,
              );
            }
            if (
              behavior.step !== undefined &&
              (behavior.step === "failure" || behavior.afterStep !== undefined)
            ) {
              assert.equal(
                (await parseAsync(composed, [])).success,
                behavior.step !== "failure" && behavior.afterStep === true,
              );
            }
          }
        },
      ),
    );
  });
});

// Helpers
function staticEmptyParser(
  step: "success" | "provisional" | "failure",
  afterStep: boolean,
  fromInitial: boolean,
): Parser<"sync", string, boolean> {
  const parser: Parser<"sync", string, boolean> = {
    mode: "sync",
    $valueType: [],
    $stateType: [],
    priority: 0,
    usage: [],
    leadingNames: new Set(),
    acceptingAnyToken: false,
    initialState: false,
    parse(context) {
      return step === "failure"
        ? { success: false, consumed: 0, error: message`No value.` }
        : {
          success: true,
          ...(step === "provisional" ? { provisional: true } : {}),
          next: { ...context, state: true },
          consumed: [],
        };
    },
    complete(state) {
      return (state ? afterStep : fromInitial)
        ? { success: true, value: "custom" }
        : { success: false, error: message`No value.` };
    },
    suggest() {
      return [];
    },
    getDocFragments() {
      return { fragments: [] };
    },
  };
  defineEmptyInputBehavior(parser, {
    step,
    ...(step === "failure" ? {} : { afterStep }),
    fromInitial,
  });
  return parser;
}

function asyncEmptyParser(
  step: "success" | "provisional" | "failure",
  afterStep: boolean,
  fromInitial: boolean,
): Parser<"async", string, boolean> {
  const inner = staticEmptyParser(step, afterStep, fromInitial);
  const parser: Parser<"async", string, boolean> = {
    mode: "async",
    $valueType: [],
    $stateType: [],
    priority: 0,
    usage: inner.usage,
    leadingNames: inner.leadingNames,
    acceptingAnyToken: false,
    initialState: inner.initialState,
    async parse(context) {
      return await inner.parse(context);
    },
    async complete(state) {
      return await inner.complete(state);
    },
    async *suggest() {},
    getDocFragments: inner.getDocFragments,
  };
  defineEmptyInputBehavior(parser, {
    step,
    ...(step === "failure" ? {} : { afterStep }),
    fromInitial,
  });
  return parser;
}
