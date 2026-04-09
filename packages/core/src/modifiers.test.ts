import { group, longestMatch, object } from "@optique/core/constructs";
import {
  annotationStateValueKey,
  getAnnotations,
  injectAnnotations,
} from "@optique/core/annotations";
import { injectAnnotations as injectAnnotationsLocal } from "./annotations.ts";
import {
  createDependencySourceState,
  createPendingDependencySourceState,
  dependency,
  isDependencySourceState,
  transformsDependencyValueMarker,
  wrappedDependencySourceMarker,
} from "@optique/core/dependency";
import {
  envVar,
  formatMessage,
  type Message,
  message,
  text,
  url,
} from "@optique/core/message";
import {
  map,
  multiple,
  nonEmpty,
  optional,
  withDefault,
  WithDefaultError,
} from "@optique/core/modifiers";
import { map as mapLocal, multiple as multipleLocal } from "./modifiers.ts";
import {
  completeOrExtractPhase2Seed,
  extractPhase2SeedKey,
} from "./phase2-seed.ts";
import { createDependencyRuntimeContext } from "./dependency-runtime.ts";
import {
  parse,
  parseAsync,
  type Parser,
  type ParserContext,
  suggest,
  suggestAsync,
  type Suggestion,
  suggestSync,
} from "@optique/core/parser";
import {
  argument,
  command,
  constant,
  flag,
  option,
} from "@optique/core/primitives";
import {
  choice,
  domain,
  integer,
  macAddress,
  string,
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function assertErrorIncludes(error: Message, text: string): void {
  const formatted = formatMessage(error);
  assert.ok(formatted.includes(text));
}

function createPromiseLike<T>(value: T): PromiseLike<T> {
  const promise = Promise.resolve(value);
  return {
    then<TResult1 = T, TResult2 = never>(
      onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): PromiseLike<TResult1 | TResult2> {
      return promise.then(onFulfilled, onRejected);
    },
  };
}

async function waitForStartedCount(
  started: readonly unknown[],
  count: number,
  messageText: string,
): Promise<void> {
  const timeoutAt = Date.now() + 1_000;
  while (started.length < count) {
    if (Date.now() >= timeoutAt) {
      throw new TypeError(messageText);
    }
    await Promise.resolve();
  }
}

function asyncChoice<T extends string>(
  choices: readonly T[],
): ValueParser<"async", T> {
  return {
    $mode: "async",
    metavar: "CHOICE",
    placeholder: choices[0],
    parse(input: string): Promise<ValueParserResult<T>> {
      if (choices.includes(input as T)) {
        return Promise.resolve({ success: true, value: input as T });
      }
      return Promise.resolve({
        success: false,
        error: message`Must be one of: ${choices.join(", ")}`,
      });
    },
    format(value: T): string {
      return value;
    },
    async *suggest(prefix: string): AsyncIterable<Suggestion> {
      for (const choice of choices) {
        if (choice.startsWith(prefix)) {
          yield { kind: "literal", text: choice };
        }
      }
    },
  };
}

async function collectSuggestions(
  suggestions: Iterable<Suggestion> | AsyncIterable<Suggestion>,
): Promise<readonly Suggestion[]> {
  const collected: Suggestion[] = [];
  for await (const suggestion of suggestions) {
    collected.push(suggestion);
  }
  return collected;
}

function unwrapPrimitiveState(state: unknown): string {
  if (typeof state === "object" && state !== null) {
    const value =
      (state as Record<PropertyKey, unknown>)[annotationStateValueKey];
    if (typeof value === "string") {
      return value;
    }
  }
  return String(state);
}

describe("optional", () => {
  it("should create a parser with same priority as wrapped parser", () => {
    const baseParser = option("-v", "--verbose");
    const optionalParser = optional(baseParser);

    assert.equal(optionalParser.priority, baseParser.priority);
    assert.equal(optionalParser.initialState, undefined);
  });

  it("should return wrapped parser value when it succeeds", () => {
    const baseParser = option("-v", "--verbose");
    const optionalParser = optional(baseParser);

    // When used directly, must have correct context
    const context = {
      buffer: ["-v"] as readonly string[],
      state: optionalParser.initialState,
      optionsTerminated: false,
      usage: optionalParser.usage,
    };

    const parseResult = optionalParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = optionalParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, true);
      }
    }
  });

  it("should preserve delegated object state for missing-source completion", () => {
    const annotation = Symbol.for("@test/optional-complete-state");
    const sourceId = Symbol("mode");
    const receivedStates: unknown[] = [];
    const inner = {
      $mode: "sync" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse() {
        return {
          success: false as const,
          consumed: 0,
          error: message`No match.`,
        };
      },
      complete(state: unknown) {
        receivedStates.push(state);
        return {
          success: true as const,
          value: getAnnotations(state)?.[annotation] === "ok"
            ? "annotated"
            : "missing",
        };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
      dependencyMetadata: {
        source: {
          kind: "source" as const,
          sourceId,
          preservesSourceValue: true,
          extractSourceValue: () => undefined,
          getMissingSourceValue: () => ({
            success: true as const,
            value: "fallback",
          }),
        },
      },
    } as const satisfies Parser<"sync", string, undefined> & {
      readonly dependencyMetadata: {
        readonly source: {
          readonly kind: "source";
          readonly sourceId: typeof sourceId;
          readonly preservesSourceValue: true;
          readonly extractSourceValue: (
            state: unknown,
          ) => ValueParserResult<unknown> | undefined;
          readonly getMissingSourceValue: () => ValueParserResult<string>;
        };
      };
    };
    const parser = optional(inner);
    const deferredState = injectAnnotations(undefined, {
      [annotation]: "ok",
    });
    const result = (
      parser.complete as (
        state: unknown,
      ) => ValueParserResult<string | undefined>
    )(deferredState);

    assert.equal(receivedStates.length, 1);
    assert.strictEqual(receivedStates[0], deferredState);
    assert.deepEqual(result, { success: true, value: "annotated" });
  });

  it("should not delegate omitted completion to non-preserving multiple sources", () => {
    const sourceId = Symbol("multiple-source");
    const source = {
      $mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse: () => ({
        success: false as const,
        consumed: 0,
        error: message`No match.`,
      }),
      complete: () => ({
        success: true as const,
        value: "fallback",
      }),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
      dependencyMetadata: {
        source: {
          kind: "source" as const,
          sourceId,
          preservesSourceValue: true,
          extractSourceValue: () => undefined,
          getMissingSourceValue: () => ({
            success: true as const,
            value: "fallback",
          }),
        },
      },
    } as const satisfies Parser<"sync", string, undefined> & {
      readonly dependencyMetadata: {
        readonly source: {
          readonly kind: "source";
          readonly sourceId: typeof sourceId;
          readonly preservesSourceValue: true;
          readonly extractSourceValue: (
            state: unknown,
          ) => ValueParserResult<unknown> | undefined;
          readonly getMissingSourceValue: () => ValueParserResult<string>;
        };
      };
    };
    const parser = optional(multiple(source, { min: 1 }));

    const result = parser.complete(undefined);
    assert.deepEqual(result, { success: true, value: undefined });
  });

  it("should propagate successful parse results correctly", () => {
    const baseParser = option("-n", "--name", string());
    const optionalParser = optional(baseParser);

    const context = {
      buffer: ["-n", "Alice"] as readonly string[],
      state: optionalParser.initialState,
      optionsTerminated: false,
      usage: optionalParser.usage,
    };

    const parseResult = optionalParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      assert.deepEqual(parseResult.next.buffer, []);
      assert.deepEqual(parseResult.consumed, ["-n", "Alice"]);
      assert.ok(Array.isArray(parseResult.next.state));
      if (Array.isArray(parseResult.next.state)) {
        assert.equal(parseResult.next.state.length, 1);
      }
    }
  });

  it("should return success with empty consumed when inner parser fails without consuming", () => {
    const baseParser = option("-v", "--verbose");
    const optionalParser = optional(baseParser);

    const context = {
      buffer: ["--help"] as readonly string[],
      state: optionalParser.initialState,
      optionsTerminated: false,
      usage: optionalParser.usage,
    };

    const parseResult = optionalParser.parse(context);
    // When inner parser fails without consuming input, optional returns success
    // with empty consumed array, leaving buffer unchanged
    assert.ok(parseResult.success);
    if (parseResult.success) {
      assert.deepEqual(parseResult.consumed, []);
      assert.deepEqual(parseResult.next.buffer, ["--help"]);
    }
  });

  it("should complete with undefined when state is undefined", () => {
    const baseParser = option("-v", "--verbose");
    const optionalParser = optional(baseParser);

    const completeResult = optionalParser.complete(undefined);
    assert.ok(completeResult.success);
    if (completeResult.success) {
      assert.equal(completeResult.value, undefined);
    }
  });

  it("should complete with wrapped parser result when state is defined", () => {
    const baseParser = option("-v", "--verbose");
    const optionalParser = optional(baseParser);

    const successfulState = { success: true as const, value: true };
    const completeResult = optionalParser.complete([successfulState]);
    assert.ok(completeResult.success);
    if (completeResult.success) {
      assert.equal(completeResult.value, true);
    }
  });

  it("should propagate wrapped parser completion failures", () => {
    const baseParser = option("-p", "--port", integer({ min: 1 }));
    const optionalParser = optional(baseParser);

    const failedState = {
      success: false as const,
      error: [{ type: "text", text: "Port must be >= 1" }] as Message,
    };
    const completeResult = optionalParser.complete([failedState]);
    assert.ok(!completeResult.success);
    if (!completeResult.success) {
      assertErrorIncludes(completeResult.error, "Port must be >= 1");
    }
  });

  it("should work in object combinations - main use case", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      port: optional(option("-p", "--port", integer())),
      output: optional(option("-o", "--output", string())),
    });

    const resultWithOptional = parse(parser, ["-v", "-p", "8080"]);
    assert.ok(resultWithOptional.success);
    if (resultWithOptional.success) {
      assert.equal(resultWithOptional.value.verbose, true);
      assert.equal(resultWithOptional.value.port, 8080);
      assert.equal(resultWithOptional.value.output, undefined);
    }

    const resultWithoutOptional = parse(parser, ["-v"]);
    assert.ok(resultWithoutOptional.success);
    if (resultWithoutOptional.success) {
      assert.equal(resultWithoutOptional.value.verbose, true);
      assert.equal(resultWithoutOptional.value.port, undefined);
      assert.equal(resultWithoutOptional.value.output, undefined);
    }
  });

  it("should work with constant parsers", () => {
    const baseParser = constant("hello");
    const optionalParser = optional(baseParser);

    const context = {
      buffer: [] as readonly string[],
      state: optionalParser.initialState,
      optionsTerminated: false,
      usage: optionalParser.usage,
    };

    const parseResult = optionalParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = optionalParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, "hello");
      }
    }
  });

  it("should handle options terminator correctly", () => {
    const baseParser = option("-v", "--verbose");
    const optionalParser = optional(baseParser);

    const context = {
      buffer: ["-v"] as readonly string[],
      state: optionalParser.initialState,
      optionsTerminated: true,
      usage: optionalParser.usage,
    };

    const parseResult = optionalParser.parse(context);
    // When optionsTerminated is true, option parser fails without consuming input,
    // so optional returns success with empty consumed
    assert.ok(parseResult.success);
    if (parseResult.success) {
      assert.deepEqual(parseResult.consumed, []);
      assert.deepEqual(parseResult.next.buffer, ["-v"]);
    }
  });

  it("should work with bundled short options through wrapped parser", () => {
    const baseParser = option("-v");
    const optionalParser = optional(baseParser);

    const context = {
      buffer: ["-vd"] as readonly string[],
      state: optionalParser.initialState,
      optionsTerminated: false,
      usage: optionalParser.usage,
    };

    const parseResult = optionalParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      assert.deepEqual(parseResult.next.buffer, ["-d"]);
      assert.deepEqual(parseResult.consumed, ["-v"]);

      const completeResult = optionalParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, true);
      }
    }
  });

  it("should handle state transitions correctly", () => {
    const baseParser = option("-n", "--name", string());
    const optionalParser = optional(baseParser);

    // Test with undefined initial state
    assert.equal(optionalParser.initialState, undefined);

    // Test state wrapping during successful parse
    const context = {
      buffer: ["-n", "test"] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: optionalParser.usage,
    };

    const parseResult = optionalParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      assert.ok(Array.isArray(parseResult.next.state));
      if (Array.isArray(parseResult.next.state)) {
        assert.equal(parseResult.next.state.length, 1);
        assert.ok(parseResult.next.state[0]);
        if (parseResult.next.state[0]) {
          assert.ok(parseResult.next.state[0].success);
          if (parseResult.next.state[0].success) {
            assert.equal(parseResult.next.state[0].value, "test");
          }
        }
      }
    }
  });

  it("should reproduce example.ts usage patterns", () => {
    // Based on the example.ts file usage of optional()
    const parser = object({
      name: option("-n", "--name", string()),
      age: optional(option("-a", "--age", integer())),
      website: optional(option("-w", "--website", string())),
      locale: optional(option("-l", "--locale", string())),
      id: argument(string()),
    });

    const resultWithOptionals = parse(parser, [
      "-n",
      "John",
      "-a",
      "30",
      "-w",
      "https://example.com",
      "user123",
    ]);
    assert.ok(resultWithOptionals.success);
    if (resultWithOptionals.success) {
      assert.equal(resultWithOptionals.value.name, "John");
      assert.equal(resultWithOptionals.value.age, 30);
      assert.equal(resultWithOptionals.value.website, "https://example.com");
      assert.equal(resultWithOptionals.value.locale, undefined);
      assert.equal(resultWithOptionals.value.id, "user123");
    }

    const resultWithoutOptionals = parse(parser, ["-n", "Jane", "user456"]);
    assert.ok(resultWithoutOptionals.success);
    if (resultWithoutOptionals.success) {
      assert.equal(resultWithoutOptionals.value.name, "Jane");
      assert.equal(resultWithoutOptionals.value.age, undefined);
      assert.equal(resultWithoutOptionals.value.website, undefined);
      assert.equal(resultWithoutOptionals.value.locale, undefined);
      assert.equal(resultWithoutOptionals.value.id, "user456");
    }
  });

  it("should work with argument parsers in object context", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      file: optional(argument(string({ metavar: "FILE" }))),
    });

    const resultWithArg = parse(parser, ["-v", "file.txt"]);
    assert.ok(resultWithArg.success);
    if (resultWithArg.success) {
      assert.equal(resultWithArg.value.verbose, true);
      assert.equal(resultWithArg.value.file, "file.txt");
    }

    const resultWithoutArg = parse(parser, ["-v"]);
    assert.ok(resultWithoutArg.success);
    if (resultWithoutArg.success) {
      assert.equal(resultWithoutArg.value.verbose, true);
      assert.equal(resultWithoutArg.value.file, undefined);
    }
  });

  it("should work in complex combinations with validation", () => {
    const parser = object({
      command: option("-c", "--command", string()),
      port: optional(
        option("-p", "--port", integer({ min: 1024, max: 0xffff })),
      ),
      debug: optional(option("-d", "--debug")),
    });

    const validResult = parse(parser, ["-c", "start", "-p", "8080", "-d"]);
    assert.ok(validResult.success);
    if (validResult.success) {
      assert.equal(validResult.value.command, "start");
      assert.equal(validResult.value.port, 8080);
      assert.equal(validResult.value.debug, true);
    }

    const invalidPortResult = parse(parser, ["-c", "start", "-p", "100"]);
    assert.ok(!invalidPortResult.success);

    const missingOptionalResult = parse(parser, ["-c", "start"]);
    assert.ok(missingOptionalResult.success);
    if (missingOptionalResult.success) {
      assert.equal(missingOptionalResult.value.command, "start");
      assert.equal(missingOptionalResult.value.port, undefined);
      assert.equal(missingOptionalResult.value.debug, undefined);
    }
  });

  describe("getDocFragments", () => {
    it("should delegate to wrapped parser", () => {
      const baseParser = option("-v", "--verbose");
      const optionalParser = optional(baseParser);

      // Test with undefined state
      const fragments1 = optionalParser.getDocFragments({
        kind: "unavailable" as const,
      });
      const baseFragments = baseParser.getDocFragments(
        baseParser.initialState === undefined
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: baseParser.initialState },
      );
      assert.deepEqual(fragments1, baseFragments);
    });

    it("should delegate with wrapped state when defined", () => {
      const baseParser = option("-p", "--port", integer());
      const optionalParser = optional(baseParser);

      // Test with wrapped state
      const wrappedState = [{ success: true as const, value: 8080 }] as [
        { success: true; value: number },
      ];
      const fragments = optionalParser.getDocFragments(
        { kind: "available" as const, state: wrappedState },
        8080,
      );

      // Should delegate to base parser with unwrapped state and default value
      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "option");
        if (fragments.fragments[0].term.type === "option") {
          assert.deepEqual(fragments.fragments[0].term.names, ["-p", "--port"]);
        }
        assert.deepEqual(fragments.fragments[0].default, message`${"8080"}`);
      }
    });

    it("should work with argument parsers", () => {
      const baseParser = argument(string({ metavar: "FILE" }));
      const optionalParser = optional(baseParser);

      const fragments = optionalParser.getDocFragments(
        { kind: "unavailable" as const },
        "default.txt",
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "argument");
        if (fragments.fragments[0].term.type === "argument") {
          assert.equal(fragments.fragments[0].term.metavar, "FILE");
        }
        assert.deepEqual(
          fragments.fragments[0].default,
          message`${"default.txt"}`,
        );
      }
    });

    it("should preserve description from wrapped parser", () => {
      const description = message`Enable verbose output`;
      const baseParser = option("-v", "--verbose", { description });
      const optionalParser = optional(baseParser);

      const fragments = optionalParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].description, description);
      }
    });
  });

  it("should return undefined when parsing empty input (issue #48)", () => {
    const optionalParser = optional(option("-v", "--verbose"));

    const result = parse(optionalParser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, undefined);
    }
  });

  it("should return undefined when parsing empty input with value parser (issue #48)", () => {
    const optionalParser = optional(option("--name", string()));

    const result = parse(optionalParser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, undefined);
    }
  });

  it("should propagate errors when inner parser partially consumes input", () => {
    const optionalParser = optional(option("-n", "--name", string()));

    // "-n" is partially matched but requires a value
    const result = parse(optionalParser, ["-n"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "value");
    }
  });

  it("should return undefined when parsing options terminator (issue #50)", () => {
    const optionalParser = optional(option("--name", string()));

    const result = parse(optionalParser, ["--"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, undefined);
    }
  });

  it("should return undefined with -- and propagate optionsTerminated (issue #50)", () => {
    const optionalParser = optional(option("--name", string()));

    const context = {
      buffer: ["--", "positional"] as readonly string[],
      state: optionalParser.initialState,
      optionsTerminated: false,
      usage: optionalParser.usage,
    };

    const parseResult = optionalParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      // Should consume "--" and set optionsTerminated
      assert.deepEqual(parseResult.consumed, ["--"]);
      assert.equal(parseResult.next.optionsTerminated, true);
      // Buffer should have "positional" remaining
      assert.deepEqual(parseResult.next.buffer, ["positional"]);
      // State should be undefined so complete() returns undefined
      assert.equal(parseResult.next.state, undefined);
    }
  });

  it("should provide async suggestions for async wrapped parser", async () => {
    const optionalParser = optional(
      option("--format", asyncChoice(["json", "yaml"] as const)),
    );

    const suggestions = await collectSuggestions(
      optionalParser.suggest(
        {
          buffer: ["--format"] as const,
          state: optionalParser.initialState,
          optionsTerminated: false,
          usage: optionalParser.usage,
        },
        "j",
      ),
    );

    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "json"),
    );
  });

  it("should return the wrapped default value as a plain result", () => {
    const modeSource = dependency(choice(["dev", "prod"] as const));
    const defaultedSource = withDefault(
      option("--mode", modeSource),
      "dev" as const,
    );
    const optionalParser = optional(defaultedSource);

    const completeResult = optionalParser.complete(undefined);
    assert.deepEqual(completeResult, { success: true, value: "dev" });
  });

  it("delegates omitted source completion from the inner initial state", () => {
    const sourceId = Symbol("optional-initial-source");
    const inner = {
      $mode: "sync" as const,
      $valueType: [] as readonly ("fallback" | "initial" | "live")[],
      $stateType: [] as readonly {
        readonly value: "fallback" | "initial" | "live";
      }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: "initial" as const },
      parse: () => ({
        success: false as const,
        consumed: 0,
        error: message`No parse.`,
      }),
      complete(state: { readonly value: "fallback" | "initial" | "live" }) {
        return {
          success: true as const,
          value: state.value,
        };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
      dependencyMetadata: {
        source: {
          kind: "source" as const,
          sourceId,
          preservesSourceValue: true,
          getMissingSourceValue() {
            return { success: true as const, value: "fallback" };
          },
          extractSourceValue() {
            return undefined;
          },
        },
      },
    } as const satisfies Parser<
      "sync",
      "fallback" | "initial" | "live",
      { readonly value: "fallback" | "initial" | "live" }
    >;
    const parser = optional(inner);

    assert.deepEqual(parser.complete(undefined), {
      success: true,
      value: "initial",
    });
  });

  it("delegates omitted async source completion from the inner initial state", async () => {
    const sourceId = Symbol("optional-initial-source-async");
    const inner = {
      $mode: "async" as const,
      $valueType: [] as readonly ("fallback" | "initial" | "live")[],
      $stateType: [] as readonly {
        readonly value: "fallback" | "initial" | "live";
      }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: "initial" as const },
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No parse.`,
        }),
      complete(state: { readonly value: "fallback" | "initial" | "live" }) {
        return Promise.resolve({
          success: true as const,
          value: state.value,
        });
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
      dependencyMetadata: {
        source: {
          kind: "source" as const,
          sourceId,
          preservesSourceValue: true,
          getMissingSourceValue() {
            return Promise.resolve({
              success: true as const,
              value: "fallback",
            });
          },
          extractSourceValue() {
            return Promise.resolve(undefined);
          },
        },
      },
    } as const satisfies Parser<
      "async",
      "fallback" | "initial" | "live",
      { readonly value: "fallback" | "initial" | "live" }
    >;
    const parser = optional(inner);

    assert.deepEqual(await parser.complete(undefined), {
      success: true,
      value: "initial",
    });
  });

  it("rejects instead of throwing when async omitted-source completion throws synchronously", async () => {
    const sourceId = Symbol("optional-sync-throw-omitted-source");
    const inner = {
      $mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { readonly value: string }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: "fallback" },
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No parse.`,
        }),
      complete() {
        throw new TypeError("Synchronous optional complete failure.");
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
      dependencyMetadata: {
        source: {
          kind: "source" as const,
          sourceId,
          preservesSourceValue: true,
          getMissingSourceValue() {
            return Promise.resolve({
              success: true as const,
              value: "fallback",
            });
          },
          extractSourceValue() {
            return Promise.resolve(undefined);
          },
        },
      },
    } as const satisfies Parser<
      "async",
      string,
      { readonly value: string }
    >;
    const parser = optional(inner);
    let result: ReturnType<typeof parser.complete> | undefined;

    assert.doesNotThrow(() => {
      result = parser.complete(undefined);
    });
    assert.ok(result instanceof Promise);
    await assert.rejects(result, {
      name: "TypeError",
      message: "Synchronous optional complete failure.",
    });
  });

  it("rejects instead of throwing when async wrapped-state completion throws synchronously", async () => {
    const inner = {
      $mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { readonly value: string }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: "fallback" },
      parse: () =>
        Promise.resolve({
          success: true as const,
          next: {
            buffer: [] as const,
            state: { value: "live" },
            optionsTerminated: false,
            usage: [] as const,
          },
          consumed: [] as const,
        }),
      complete() {
        throw new TypeError("Synchronous optional wrapped-state failure.");
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<
      "async",
      string,
      { readonly value: string }
    >;
    const parser = optional(inner);
    let result: ReturnType<typeof parser.complete> | undefined;

    assert.doesNotThrow(() => {
      result = parser.complete([{ value: "live" }]);
    });
    assert.ok(result instanceof Promise);
    await assert.rejects(result, {
      name: "TypeError",
      message: "Synchronous optional wrapped-state failure.",
    });
  });

  it("should collapse deferred missing-source failures to undefined", () => {
    const sourceId = Symbol("optional-deferred-missing-source");
    const inner = {
      $mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly ({ readonly pending: true } | undefined)[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context: ParserContext<{ readonly pending: true } | undefined>) {
        return { success: true as const, next: context, consumed: [] };
      },
      complete() {
        return {
          success: false as const,
          error: message`Missing config value.`,
        };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
      shouldDeferCompletion() {
        return true;
      },
      dependencyMetadata: {
        source: {
          kind: "source" as const,
          sourceId,
          preservesSourceValue: true,
          getMissingSourceValue() {
            return { success: true as const, value: "fallback" };
          },
          extractSourceValue() {
            return undefined;
          },
        },
      },
    } as const satisfies Parser<
      "sync",
      string,
      { readonly pending: true } | undefined
    >;
    const parser = optional(withDefault(inner, "fallback"));

    assert.deepEqual(
      (
        parser.complete as (
          state: unknown,
        ) => ValueParserResult<string | undefined>
      )({ pending: true }),
      {
        success: true,
        value: undefined,
      },
    );
  });

  it("should collapse async deferred missing-source failures to undefined", async () => {
    const sourceId = Symbol("optional-deferred-missing-source-async");
    const inner = {
      $mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly ({ readonly pending: true } | undefined)[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context: ParserContext<{ readonly pending: true } | undefined>) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({
          success: false as const,
          error: message`Missing config value.`,
        });
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
      shouldDeferCompletion() {
        return true;
      },
      dependencyMetadata: {
        source: {
          kind: "source" as const,
          sourceId,
          preservesSourceValue: true,
          getMissingSourceValue() {
            return Promise.resolve({
              success: true as const,
              value: "fallback",
            });
          },
          extractSourceValue() {
            return Promise.resolve(undefined);
          },
        },
      },
    } as const satisfies Parser<
      "async",
      string,
      { readonly pending: true } | undefined
    >;
    const parser = optional(withDefault(inner, "fallback"));

    assert.deepEqual(
      await (
        parser.complete as (
          state: unknown,
        ) => Promise<ValueParserResult<string | undefined>>
      )({ pending: true }),
      {
        success: true,
        value: undefined,
      },
    );
  });
});

describe("withDefault", () => {
  it("should create a parser with same priority as wrapped parser", () => {
    const baseParser = option("-v", "--verbose");
    const defaultParser = withDefault(baseParser, false);

    assert.equal(defaultParser.priority, baseParser.priority);
    assert.equal(defaultParser.initialState, undefined);
  });

  it("should return wrapped parser value when it succeeds", () => {
    const baseParser = option("-v", "--verbose");
    const defaultParser = withDefault(baseParser, false);

    const context = {
      buffer: ["-v"] as readonly string[],
      state: defaultParser.initialState,
      optionsTerminated: false,
      usage: defaultParser.usage,
    };

    const parseResult = defaultParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = defaultParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, true);
      }
    }
  });

  it("should return default value when parser doesn't match", () => {
    const baseParser = option("-v", "--verbose");
    const defaultValue = false;
    const defaultParser = withDefault(baseParser, defaultValue);

    const completeResult = defaultParser.complete(undefined);
    assert.ok(completeResult.success);
    if (completeResult.success) {
      assert.equal(completeResult.value, defaultValue);
    }
  });

  it("should work with function-based default values", () => {
    let callCount = 0;
    const defaultFunction = () => {
      callCount++;
      return callCount > 1;
    };

    const baseParser = option("-v", "--verbose");
    const defaultParser = withDefault(baseParser, defaultFunction);

    // First call
    const completeResult1 = defaultParser.complete(undefined);
    assert.ok(completeResult1.success);
    if (completeResult1.success) {
      assert.equal(completeResult1.value, false);
    }

    // Second call should increment
    const completeResult2 = defaultParser.complete(undefined);
    assert.ok(completeResult2.success);
    if (completeResult2.success) {
      assert.equal(completeResult2.value, true);
    }
  });

  it("rejects instead of throwing when async deferred completion throws synchronously", async () => {
    const inner = {
      $mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { readonly pending: true }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { pending: true as const },
      parse: () =>
        Promise.resolve({
          success: true as const,
          next: {
            buffer: [] as const,
            state: { pending: true as const },
            optionsTerminated: false,
            usage: [] as const,
          },
          consumed: [] as const,
        }),
      complete() {
        throw new TypeError("Synchronous withDefault deferred failure.");
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
      shouldDeferCompletion() {
        return true;
      },
    } as const satisfies Parser<
      "async",
      string,
      { readonly pending: true }
    >;
    const parser = withDefault(inner, "fallback");
    let result: Promise<ValueParserResult<string>> | undefined;

    assert.doesNotThrow(() => {
      result = (
        parser.complete as (
          state: unknown,
        ) => Promise<ValueParserResult<string>>
      )({ pending: true });
    });
    assert.ok(result instanceof Promise);
    await assert.rejects(result, {
      name: "TypeError",
      message: "Synchronous withDefault deferred failure.",
    });
  });

  it("rejects instead of throwing when async wrapped completion throws synchronously", async () => {
    const inner = {
      $mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { readonly value: string }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: "fallback" },
      parse: () =>
        Promise.resolve({
          success: true as const,
          next: {
            buffer: [] as const,
            state: { value: "live" },
            optionsTerminated: false,
            usage: [] as const,
          },
          consumed: [] as const,
        }),
      complete() {
        throw new TypeError("Synchronous withDefault complete failure.");
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<
      "async",
      string,
      { readonly value: string }
    >;
    const parser = withDefault(inner, "fallback");
    let result: ReturnType<typeof parser.complete> | undefined;

    assert.doesNotThrow(() => {
      result = parser.complete([{ value: "live" }]);
    });
    assert.ok(result instanceof Promise);
    await assert.rejects(result, {
      name: "TypeError",
      message: "Synchronous withDefault complete failure.",
    });
  });

  it("should propagate successful parse results correctly", () => {
    const baseParser = option("-n", "--name", string());
    const defaultParser = withDefault(baseParser, "anonymous");

    const context = {
      buffer: ["-n", "Alice"] as readonly string[],
      state: defaultParser.initialState,
      optionsTerminated: false,
      usage: defaultParser.usage,
    };

    const parseResult = defaultParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      assert.deepEqual(parseResult.next.buffer, []);
      assert.deepEqual(parseResult.consumed, ["-n", "Alice"]);
      assert.ok(Array.isArray(parseResult.next.state));

      const completeResult = defaultParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, "Alice");
      }
    }
  });

  it("should return success with empty consumed when inner parser fails without consuming", () => {
    const baseParser = option("-v", "--verbose");
    const defaultParser = withDefault(baseParser, false);

    const context = {
      buffer: ["--help"] as readonly string[],
      state: defaultParser.initialState,
      optionsTerminated: false,
      usage: defaultParser.usage,
    };

    const parseResult = defaultParser.parse(context);
    // When inner parser fails without consuming input, withDefault returns success
    // with empty consumed array, leaving buffer unchanged
    assert.ok(parseResult.success);
    if (parseResult.success) {
      assert.deepEqual(parseResult.consumed, []);
      assert.deepEqual(parseResult.next.buffer, ["--help"]);
    }
  });

  it("should work in object combinations - main use case", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      port: withDefault(option("-p", "--port", integer()), 8080),
      host: withDefault(option("-h", "--host", string()), "localhost"),
    });

    const resultWithDefaults = parse(parser, ["-v"]);
    assert.ok(resultWithDefaults.success);
    if (resultWithDefaults.success) {
      assert.equal(resultWithDefaults.value.verbose, true);
      assert.equal(resultWithDefaults.value.port, 8080);
      assert.equal(resultWithDefaults.value.host, "localhost");
    }

    const resultWithValues = parse(parser, [
      "-v",
      "-p",
      "3000",
      "-h",
      "example.com",
    ]);
    assert.ok(resultWithValues.success);
    if (resultWithValues.success) {
      assert.equal(resultWithValues.value.verbose, true);
      assert.equal(resultWithValues.value.port, 3000);
      assert.equal(resultWithValues.value.host, "example.com");
    }
  });

  it("should work with constant parsers", () => {
    const baseParser = constant("hello");
    const defaultParser = withDefault(baseParser, "default");

    const context = {
      buffer: [] as readonly string[],
      state: defaultParser.initialState,
      optionsTerminated: false,
      usage: defaultParser.usage,
    };

    const parseResult = defaultParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = defaultParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, "hello");
      }
    }
  });

  it("should work with different value types", () => {
    const stringParser = withDefault(option("-s", string()), "default-string");
    const numberParser = withDefault(option("-n", integer()), 42);
    const booleanParser = withDefault(option("-b"), true);
    const arrayParser = withDefault(constant([1, 2, 3]), [1, 2, 3]);

    // Test string default
    const stringResult = stringParser.complete(undefined);
    assert.ok(stringResult.success);
    if (stringResult.success) {
      assert.equal(stringResult.value, "default-string");
    }

    // Test number default
    const numberResult = numberParser.complete(undefined);
    assert.ok(numberResult.success);
    if (numberResult.success) {
      assert.equal(numberResult.value, 42);
    }

    // Test boolean default
    const booleanResult = booleanParser.complete(undefined);
    assert.ok(booleanResult.success);
    if (booleanResult.success) {
      assert.equal(booleanResult.value, true);
    }

    // Test array default (returns constant value, not default when parser succeeds)
    const arrayResult = arrayParser.complete([[1, 2, 3]]);
    assert.ok(arrayResult.success);
    if (arrayResult.success) {
      assert.deepEqual(arrayResult.value, [1, 2, 3]);
    }
  });

  it("should propagate wrapped parser completion failures", () => {
    const baseParser = option("-p", "--port", integer({ min: 1 }));
    const defaultParser = withDefault(baseParser, 8080);

    const failedState = {
      success: false as const,
      error: [{ type: "text", text: "Port must be >= 1" }] as Message,
    };
    const completeResult = defaultParser.complete([failedState]);
    assert.ok(!completeResult.success);
    if (!completeResult.success) {
      assertErrorIncludes(completeResult.error, "Port must be >= 1");
    }
  });

  it("should handle state transitions correctly", () => {
    const baseParser = option("-n", "--name", string());
    const defaultParser = withDefault(baseParser, "anonymous");

    // Test with undefined initial state
    assert.equal(defaultParser.initialState, undefined);

    // Test state wrapping during successful parse
    const context = {
      buffer: ["-n", "test"] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: defaultParser.usage,
    };

    const parseResult = defaultParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      assert.ok(Array.isArray(parseResult.next.state));
      if (Array.isArray(parseResult.next.state)) {
        assert.equal(parseResult.next.state.length, 1);
        assert.ok(parseResult.next.state[0]);
        if (parseResult.next.state[0]) {
          assert.ok(parseResult.next.state[0].success);
          if (parseResult.next.state[0].success) {
            assert.equal(parseResult.next.state[0].value, "test");
          }
        }
      }
    }
  });

  it("should work with argument parsers in object context", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      file: withDefault(argument(string({ metavar: "FILE" })), "input.txt"),
    });

    const resultWithArg = parse(parser, ["-v", "custom.txt"]);
    assert.ok(resultWithArg.success);
    if (resultWithArg.success) {
      assert.equal(resultWithArg.value.verbose, true);
      assert.equal(resultWithArg.value.file, "custom.txt");
    }

    const resultWithDefault = parse(parser, ["-v"]);
    assert.ok(resultWithDefault.success);
    if (resultWithDefault.success) {
      assert.equal(resultWithDefault.value.verbose, true);
      assert.equal(resultWithDefault.value.file, "input.txt");
    }
  });

  it("should work in complex combinations with validation", () => {
    const parser = object({
      command: option("-c", "--command", string()),
      port: withDefault(
        option("-p", "--port", integer({ min: 1024, max: 0xffff })),
        8080,
      ),
      debug: withDefault(option("-d", "--debug"), false),
    });

    const validResult = parse(parser, ["-c", "start", "-p", "3000", "-d"]);
    assert.ok(validResult.success);
    if (validResult.success) {
      assert.equal(validResult.value.command, "start");
      assert.equal(validResult.value.port, 3000);
      assert.equal(validResult.value.debug, true);
    }

    const defaultResult = parse(parser, ["-c", "start"]);
    assert.ok(defaultResult.success);
    if (defaultResult.success) {
      assert.equal(defaultResult.value.command, "start");
      assert.equal(defaultResult.value.port, 8080);
      assert.equal(defaultResult.value.debug, false);
    }
  });

  describe("getDocFragments", () => {
    it("should delegate to wrapped parser", () => {
      const baseParser = option("-v", "--verbose");
      const defaultParser = withDefault(baseParser, false);

      // Test with undefined state
      const fragments1 = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });
      const baseFragments = baseParser.getDocFragments(
        baseParser.initialState === undefined
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: baseParser.initialState },
      );
      assert.deepEqual(fragments1, baseFragments);
    });

    it("should delegate with wrapped state when defined", () => {
      const baseParser = option("-p", "--port", integer());
      const defaultParser = withDefault(baseParser, 3000);

      // Test with wrapped state
      const wrappedState = [{ success: true as const, value: 8080 }] as [
        { success: true; value: number },
      ];
      const fragments = defaultParser.getDocFragments(
        { kind: "available" as const, state: wrappedState },
        8080,
      );

      // Should delegate to base parser with unwrapped state and default value
      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "option");
        if (fragments.fragments[0].term.type === "option") {
          assert.deepEqual(fragments.fragments[0].term.names, ["-p", "--port"]);
        }
        assert.deepEqual(fragments.fragments[0].default, message`${"8080"}`);
      }
    });

    it("should show default value when upper default is not provided", () => {
      const baseParser = option("-p", "--port", integer());
      const defaultParser = withDefault(baseParser, 3000);

      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].default, message`${"3000"}`);
      }
    });

    it("should prefer upper default value when provided", () => {
      const baseParser = option("-p", "--port", integer());
      const defaultParser = withDefault(baseParser, 3000);

      const fragments = defaultParser.getDocFragments(
        { kind: "unavailable" as const },
        8080,
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].default, message`${"8080"}`);
      }
    });

    it("should work with function-based default values", () => {
      const baseParser = option("-p", "--port", integer());
      const defaultFunc = () => 3000;
      const defaultParser = withDefault(baseParser, defaultFunc);

      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].default, message`${"3000"}`);
      }
    });

    it("should not evaluate function-based defaults when a custom help message is provided", () => {
      const baseParser = option("--token", string());
      const customMessage = message`${envVar("API_TOKEN")}`;
      let callbackCalls = 0;
      const defaultParser = withDefault(baseParser, () => {
        callbackCalls += 1;
        throw new WithDefaultError(
          message`Environment variable ${envVar("API_TOKEN")} is not set.`,
        );
      }, {
        message: customMessage,
      });

      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(callbackCalls, 0);
      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].default, customMessage);
      }
    });

    it("should omit the default in help when a function-based default throws", () => {
      const baseParser = option("--config", string());
      const defaultParser = withDefault(baseParser, () => {
        throw new WithDefaultError(
          message`Environment variable ${envVar("CONFIG_PATH")} is not set.`,
        );
      });

      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].default, undefined);
      }
    });

    it("should preserve description from wrapped parser", () => {
      const description = message`Server port number`;
      const baseParser = option("-p", "--port", integer(), { description });
      const defaultParser = withDefault(baseParser, 3000);

      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].description, description);
      }
    });

    it("should work with argument parsers", () => {
      const baseParser = argument(string({ metavar: "FILE" }));
      const defaultParser = withDefault(baseParser, "input.txt");

      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "argument");
        if (fragments.fragments[0].term.type === "argument") {
          assert.equal(fragments.fragments[0].term.metavar, "FILE");
        }
        assert.deepEqual(
          fragments.fragments[0].default,
          message`${"input.txt"}`,
        );
      }
    });
  });

  it("should handle errors thrown by default value callback", () => {
    const baseParser = option("--url", string());
    const defaultParser = withDefault(baseParser, () => {
      throw new Error("Environment variable not set");
    });

    const completeResult = defaultParser.complete(undefined);
    assert.ok(!completeResult.success);
    if (!completeResult.success) {
      assertErrorIncludes(completeResult.error, "Environment variable not set");
    }
  });

  it("should handle WithDefaultError with structured message", () => {
    const baseParser = option("--config", string());
    const defaultParser = withDefault(baseParser, () => {
      throw new WithDefaultError(
        message`Environment variable ${text("CONFIG_PATH")} is not set`,
      );
    });

    const completeResult = defaultParser.complete(undefined);
    assert.ok(!completeResult.success);
    if (!completeResult.success) {
      assert.deepEqual(
        completeResult.error,
        message`Environment variable ${text("CONFIG_PATH")} is not set`,
      );
    }
  });

  it("should not catch errors when default value callback succeeds", () => {
    const baseParser = option("--port", integer());
    const defaultParser = withDefault(baseParser, () => {
      return 8080;
    });

    const completeResult = defaultParser.complete(undefined);
    assert.ok(completeResult.success);
    if (completeResult.success) {
      assert.equal(completeResult.value, 8080);
    }
  });

  describe("with options parameter", () => {
    it("should use custom message in help output", () => {
      const baseParser = option("--url", string());
      const customMessage = message`${
        envVar("SERVICE_URL")
      } environment variable`;
      const defaultParser = withDefault(baseParser, "https://default.com", {
        message: customMessage,
      });

      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].default, customMessage);
      }
    });

    it("should still use actual default value for parsing", () => {
      const baseParser = option("--url", string());
      const actualDefault = "https://actual-default.com";
      const defaultParser = withDefault(baseParser, actualDefault, {
        message: message`Environment variable`,
      });

      const completeResult = defaultParser.complete(undefined);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, actualDefault);
      }
    });

    it("should work with function-based default values", () => {
      const baseParser = option("--port", integer());
      const defaultFunc = () => 3000;
      const customMessage = message`Default port from config`;
      const defaultParser = withDefault(baseParser, defaultFunc, {
        message: customMessage,
      });

      // Test help output shows custom message
      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].default, customMessage);
      }

      // Test parsing still uses actual function result
      const completeResult = defaultParser.complete(undefined);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, 3000);
      }
    });

    it("should preserve other parser properties", () => {
      const description = message`Server URL`;
      const baseParser = option("--url", string(), { description });
      const defaultParser = withDefault(baseParser, "https://default.com", {
        message: message`Custom default`,
      });

      assert.equal(defaultParser.priority, baseParser.priority);
      assert.deepEqual(defaultParser.usage, [{
        type: "optional",
        terms: baseParser.usage,
      }]);

      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].description, description);
        assert.equal(fragments.fragments[0].term.type, "option");
        if (fragments.fragments[0].term.type === "option") {
          assert.deepEqual(fragments.fragments[0].term.names, ["--url"]);
        }
      }
    });

    it("should work without custom message (backward compatibility)", () => {
      const baseParser = option("--port", integer());
      const defaultParser = withDefault(baseParser, 3000);

      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        // Should show the formatted default value
        assert.deepEqual(fragments.fragments[0].default, message`${"3000"}`);
      }
    });

    it("should work with complex message formatting", () => {
      const baseParser = option("--config", string());
      const customMessage = message`Path from ${envVar("CONFIG_DIR")} or ${
        text("~/.config")
      }`;
      const defaultParser = withDefault(baseParser, "/etc/config", {
        message: customMessage,
      });

      const fragments = defaultParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].default, customMessage);
      }
    });
  });

  it("should return default value when parsing empty input (issue #48)", () => {
    const defaultParser = withDefault(option("--name", string()), "Bob");

    const result = parse(defaultParser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "Bob");
    }
  });

  it("should return default value when parsing empty input with boolean flag (issue #48)", () => {
    const defaultParser = withDefault(option("-v", "--verbose"), false);

    const result = parse(defaultParser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, false);
    }
  });

  it("should propagate errors when inner parser partially consumes input", () => {
    const defaultParser = withDefault(
      option("-n", "--name", string()),
      "default",
    );

    // "-n" is partially matched but requires a value
    const result = parse(defaultParser, ["-n"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "value");
    }
  });

  it("should return default value when parsing options terminator (issue #50)", () => {
    const defaultParser = withDefault(option("--name", string()), "Bob");

    const result = parse(defaultParser, ["--"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "Bob");
    }
  });

  it("should return default value with -- and propagate optionsTerminated (issue #50)", () => {
    const defaultParser = withDefault(option("--name", string()), "Bob");

    const context = {
      buffer: ["--", "positional"] as readonly string[],
      state: defaultParser.initialState,
      optionsTerminated: false,
      usage: defaultParser.usage,
    };

    const parseResult = defaultParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      // Should consume "--" and set optionsTerminated
      assert.deepEqual(parseResult.consumed, ["--"]);
      assert.equal(parseResult.next.optionsTerminated, true);
      // Buffer should have "positional" remaining
      assert.deepEqual(parseResult.next.buffer, ["positional"]);
      // State should be undefined so complete() returns default value
      assert.equal(parseResult.next.state, undefined);
    }
  });

  it("should preserve literal types from choice() parser (issue #58)", () => {
    // This test verifies that withDefault preserves the literal type
    // from a choice() parser instead of widening it to string.
    const parser = object({
      format: withDefault(option("--format", choice(["auto", "text"])), "auto"),
    });

    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      // Runtime check that the value is correct
      assert.equal(result.value.format, "auto");

      // Type-level check: the following assignment should compile without error
      // because format should be "auto" | "text", not string.
      // If the type were widened to string, this would fail to compile.
      const _format: "auto" | "text" = result.value.format;
      void _format; // Prevent unused variable warning
    }

    // Test with explicit value
    const resultWithValue = parse(parser, ["--format", "text"]);
    assert.ok(resultWithValue.success);
    if (resultWithValue.success) {
      assert.equal(resultWithValue.value.format, "text");
      const _format: "auto" | "text" = resultWithValue.value.format;
      void _format; // Prevent unused variable warning
    }
  });

  it("should suggest from wrapped parser with existing sync state", () => {
    const defaultParser = withDefault(
      option("--format", choice(["json", "yaml"] as const)),
      "json" as const,
    );

    const parsed = defaultParser.parse({
      buffer: ["--format", "json"] as const,
      state: defaultParser.initialState,
      optionsTerminated: false,
      usage: defaultParser.usage,
    });
    assert.ok(parsed.success);
    if (!parsed.success) {
      return;
    }

    const suggestions = [...defaultParser.suggest(
      {
        buffer: ["--format"] as const,
        state: parsed.next.state,
        optionsTerminated: false,
        usage: defaultParser.usage,
      },
      "y",
    )];

    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "yaml"),
    );
  });

  it("should suggest from wrapped parser with existing async state", async () => {
    const defaultParser = withDefault(
      option("--format", asyncChoice(["json", "yaml"] as const)),
      "json" as const,
    );

    const parsed = await defaultParser.parse({
      buffer: ["--format", "json"] as const,
      state: defaultParser.initialState,
      optionsTerminated: false,
      usage: defaultParser.usage,
    });
    assert.ok(parsed.success);
    if (!parsed.success) {
      return;
    }

    const suggestions = await collectSuggestions(
      defaultParser.suggest(
        {
          buffer: ["--format"] as const,
          state: parsed.next.state,
          optionsTerminated: false,
          usage: defaultParser.usage,
        },
        "y",
      ),
    );

    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "yaml"),
    );
  });

  it("should normalize default values through the value parser", () => {
    const mac = macAddress({ case: "lower", outputSeparator: ":" });
    const parser = withDefault(
      option("--mac", mac),
      "AA-BB-CC-DD-EE-FF",
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "aa:bb:cc:dd:ee:ff");
    }
  });

  it("should normalize default values for domain with lowercase", () => {
    const dom = domain({ lowercase: true });
    const parser = withDefault(option("--domain", dom), "Example.COM");
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "example.com");
    }
  });

  it("should not normalize when value parser has no normalize", () => {
    const parser = withDefault(option("--name", string()), "Hello");
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "Hello");
    }
  });

  it("should not crash on sentinel defaults of incompatible type", () => {
    const parser = withDefault(
      option("--domain", domain({ lowercase: true })),
      { kind: "local" } as never,
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, { kind: "local" });
    }
  });

  it("should preserve string sentinel defaults that are not valid values", () => {
    const parser = withDefault(
      option("--mac", macAddress({ outputSeparator: ":" })),
      "local",
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "local");
    }
  });

  it("should preserve dotted sentinel defaults for macAddress", () => {
    const parser = withDefault(
      option("--mac", macAddress()),
      "foo.bar.baz",
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "foo.bar.baz");
    }
  });

  it("should normalize defaults through nonEmpty() wrappers", () => {
    const parser = withDefault(
      nonEmpty(option("--domain", domain({ lowercase: true }))),
      "Example.COM",
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "example.com");
    }
  });

  it("should preserve non-domain sentinels in defaults", () => {
    const parser = withDefault(
      option("--domain", domain({ lowercase: true })),
      "LOCAL",
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "LOCAL");
    }
  });

  it("should preserve defaults that fail parser validation", () => {
    // normalize() uses parse() internally, so defaults that would
    // fail validation are returned unchanged
    const parser = withDefault(
      option(
        "--domain",
        domain({ lowercase: true, allowedTlds: ["com"] }),
      ),
      "Example.NET",
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "Example.NET");
    }
  });

  it("should preserve MAC defaults with wrong separator", () => {
    const parser = withDefault(
      option("--mac", macAddress({ separator: "none" })),
      "aa:bb:cc:dd:ee:ff",
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      // parse() rejects colon-separated input with separator: "none",
      // so the default is preserved unchanged
      assert.equal(result.value, "aa:bb:cc:dd:ee:ff");
    }
  });

  it("should preserve non-string sentinel objects in defaults", () => {
    const parser = withDefault(
      option("--mac", macAddress()),
      { kind: "local" } as never,
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, { kind: "local" });
    }
  });

  it("returns multiple()'s empty result instead of the default when min is 0", () => {
    // Since https://github.com/dahlia/optique/issues/408,
    // multiple() with the default `min: 0` always succeeds at parse
    // time (returning an empty array) even when no input is provided.
    // As a consequence, withDefault(multiple(...), nonEmptyDefault) no
    // longer falls back to its default value because the wrapped
    // multiple() never reports a parse failure.  Users who want the
    // previous "use default when no matches" behaviour can wrap the
    // result with map() (e.g. `map(multiple(p), xs => xs.length > 0 ?
    // xs : fallback)`).
    const parser = withDefault(
      multiple(option("--domain", domain({ lowercase: true }))),
      ["Example.COM"],
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, [] as readonly string[]);
    }
  });

  it("still forwards multiple() normalizer through withDefault", () => {
    // Regression guard for https://github.com/dahlia/optique/issues/408
    // — `withDefault` must keep forwarding `multiple()`'s
    // `normalizeValue` through the full wrapper chain even though the
    // configured default is no longer reached at parse time for
    // `min: 0`.  Exercising the composition directly (rather than
    // just `multiple(...).normalizeValue`) ensures that an accidental
    // regression in `withDefault`'s `normalizeValue` forwarding would
    // still be caught by this test.
    const parser = withDefault(
      multiple(option("--domain", domain({ lowercase: true }))),
      ["fallback.example"],
    );
    assert.equal(typeof parser.normalizeValue, "function");
    if (typeof parser.normalizeValue === "function") {
      assert.deepEqual(
        parser.normalizeValue(["Example.COM", "Foo.Bar"]),
        ["example.com", "foo.bar"],
      );
    }
  });

  it("should normalize defaults through object() wrappers", () => {
    const parser = withDefault(
      object({
        domain: option("--domain", domain({ lowercase: true })),
      }),
      { domain: "Example.COM" },
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, { domain: "example.com" });
    }
  });

  it("should normalize defaults in help text rendering", () => {
    const mac = macAddress({ case: "lower", outputSeparator: ":" });
    const parser = withDefault(option("--mac", mac), "AA:BB:CC:DD:EE:FF");
    const syncParser = parser as unknown as {
      getDocFragments(
        state: { kind: "unavailable" },
        defaultValue?: unknown,
      ): { fragments: readonly { default?: unknown }[] };
    };
    const doc = syncParser.getDocFragments({ kind: "unavailable" });
    const entry = doc.fragments.find(
      (f: { default?: unknown }) => f.default != null,
    ) as { default?: readonly { type: string; text?: string }[] } | undefined;
    assert.ok(entry);
    assert.ok(entry.default);
    const textPart = entry.default.find(
      (t: { type: string; text?: string }) => t.type === "value",
    );
    assert.ok(textPart);
    assert.equal(
      (textPart as unknown as { value: string }).value,
      "aa:bb:cc:dd:ee:ff",
    );
  });
});

describe("map", () => {
  it("should create a parser with same priority and properties as wrapped parser", () => {
    const baseParser = option("-v", "--verbose");
    const mappedParser = map(baseParser, (b) => !b);

    assert.equal(mappedParser.priority, baseParser.priority);
    assert.deepEqual(mappedParser.usage, baseParser.usage);
    assert.equal(mappedParser.initialState, baseParser.initialState);
  });

  it("should transform boolean values correctly", () => {
    const baseParser = option("-v", "--verbose");
    const mappedParser = map(baseParser, (b) => !b);

    const context = {
      buffer: ["-v"] as readonly string[],
      state: mappedParser.initialState,
      optionsTerminated: false,
      usage: mappedParser.usage,
    };

    const parseResult = mappedParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = mappedParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        // Original would be true, mapped should be false
        assert.equal(completeResult.value, false);
      }
    }
  });

  it("should transform string values correctly", () => {
    const baseParser = option("-n", "--name", string());
    const mappedParser = map(baseParser, (s) => s.toUpperCase());

    const context = {
      buffer: ["-n", "alice"] as readonly string[],
      state: mappedParser.initialState,
      optionsTerminated: false,
      usage: mappedParser.usage,
    };

    const parseResult = mappedParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = mappedParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, "ALICE");
      }
    }
  });

  it("should transform number values correctly", () => {
    const baseParser = option("-p", "--port", integer());
    const mappedParser = map(baseParser, (n) => `port: ${n}`);

    const context = {
      buffer: ["-p", "8080"] as readonly string[],
      state: mappedParser.initialState,
      optionsTerminated: false,
      usage: mappedParser.usage,
    };

    const parseResult = mappedParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = mappedParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, "port: 8080");
      }
    }
  });

  it("should work with argument parsers", () => {
    const baseParser = argument(string({ metavar: "FILE" }));
    const mappedParser = map(baseParser, (filename) => filename + ".backup");

    const context = {
      buffer: ["input.txt"] as readonly string[],
      state: mappedParser.initialState,
      optionsTerminated: false,
      usage: mappedParser.usage,
    };

    const parseResult = mappedParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = mappedParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, "input.txt.backup");
      }
    }
  });

  it("should work with constant parsers", () => {
    const baseParser = constant("hello");
    const mappedParser = map(baseParser, (s) => s.toUpperCase());

    const context = {
      buffer: [] as readonly string[],
      state: mappedParser.initialState,
      optionsTerminated: false,
      usage: mappedParser.usage,
    };

    const parseResult = mappedParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = mappedParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, "HELLO");
      }
    }
  });

  it("should propagate parsing errors from wrapped parser", () => {
    const baseParser = option("-p", "--port", integer({ min: 1 }));
    const mappedParser = map(baseParser, (n) => `port: ${n}`);

    const context = {
      buffer: ["--help"] as readonly string[],
      state: mappedParser.initialState,
      optionsTerminated: false,
      usage: mappedParser.usage,
    };

    const parseResult = mappedParser.parse(context);
    assert.ok(!parseResult.success);
    if (!parseResult.success) {
      assert.equal(parseResult.consumed, 0);
      assertErrorIncludes(parseResult.error, "No matched option");
    }
  });

  it("should propagate completion errors from wrapped parser", () => {
    const baseParser = option("-p", "--port", integer({ min: 1000 }));
    const mappedParser = map(baseParser, (n) => `port: ${n}`);

    // Create a failed state to simulate validation failure
    const failedState = {
      success: false as const,
      error: [{ type: "text", text: "Port must be >= 1000" }] as Message,
    };

    const completeResult = mappedParser.complete(failedState);
    assert.ok(!completeResult.success);
    if (!completeResult.success) {
      assertErrorIncludes(completeResult.error, "Port must be >= 1000");
    }
  });

  it("should work in object combinations - main use case", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      disallow: map(option("--allow"), (b) => !b),
      upperName: map(option("-n", "--name", string()), (s) => s.toUpperCase()),
      portDescription: map(
        option("-p", "--port", integer()),
        (n) => `port: ${n}`,
      ),
    });

    const result = parse(parser, [
      "-v",
      "--allow",
      "-n",
      "alice",
      "-p",
      "8080",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.disallow, false); // inverted from --allow true
      assert.equal(result.value.upperName, "ALICE");
      assert.equal(result.value.portDescription, "port: 8080");
    }
  });

  it("should work with optional parsers in object context", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      name: map(
        optional(option("-n", "--name", string())),
        (s) => s ? s.toUpperCase() : "ANONYMOUS",
      ),
    });

    // Test with value present
    const resultWithValue = parse(parser, ["-v", "-n", "alice"]);
    assert.ok(resultWithValue.success);
    if (resultWithValue.success) {
      assert.equal(resultWithValue.value.name, "ALICE");
      assert.equal(resultWithValue.value.verbose, true);
    }

    // Test with optional value absent but required verbose present
    const resultWithoutValue = parse(parser, ["-v"]);
    assert.ok(resultWithoutValue.success);
    if (resultWithoutValue.success) {
      assert.equal(resultWithoutValue.value.name, "ANONYMOUS");
      assert.equal(resultWithoutValue.value.verbose, true);
    }
  });

  it("should work with multiple parsers in object context", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      files: map(
        multiple(option("-f", "--file", string())),
        (files) => files.map((f) => f.toUpperCase()),
      ),
    });

    const result = parse(parser, ["-v", "-f", "a.txt", "-f", "b.txt"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value.files, ["A.TXT", "B.TXT"]);
      assert.equal(result.value.verbose, true);
    }

    // Test with no files - multiple() returns empty array by default
    const emptyResult = parse(parser, ["-v"]);
    assert.ok(emptyResult.success);
    if (emptyResult.success) {
      assert.deepEqual(emptyResult.value.files, []);
      assert.equal(emptyResult.value.verbose, true);
    }
  });

  it("should work with withDefault parsers in object context", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      port: map(
        withDefault(option("-p", "--port", integer()), 8080),
        (n) => `port: ${n}`,
      ),
    });

    // Test with value provided
    const resultWithValue = parse(parser, ["-v", "-p", "3000"]);
    assert.ok(resultWithValue.success);
    if (resultWithValue.success) {
      assert.equal(resultWithValue.value.port, "port: 3000");
      assert.equal(resultWithValue.value.verbose, true);
    }

    // Test with default value
    const resultWithDefault = parse(parser, ["-v"]);
    assert.ok(resultWithDefault.success);
    if (resultWithDefault.success) {
      assert.equal(resultWithDefault.value.port, "port: 8080");
      assert.equal(resultWithDefault.value.verbose, true);
    }
  });

  it("should support complex transformations", () => {
    const baseParser = option("-c", "--config", string());
    const mappedParser = map(baseParser, (config) => ({
      filename: config,
      exists: config.endsWith(".json"),
      size: config.length,
    }));

    const result = parse(mappedParser, ["-c", "app.json"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.filename, "app.json");
      assert.equal(result.value.exists, true);
      assert.equal(result.value.size, 8);
    }
  });

  it("should support type conversion", () => {
    const baseParser = option("-n", "--number", integer());
    const mappedParser = map(baseParser, (n) => n.toString());

    const result = parse(mappedParser, ["-n", "42"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "42");
      assert.equal(typeof result.value, "string");
    }
  });

  it("should delegate getDocFragments to wrapped parser", () => {
    const baseParser = option("-v", "--verbose");
    const mappedParser = map(baseParser, (b) => !b);

    const fragments = mappedParser.getDocFragments(
      mappedParser.initialState === undefined
        ? { kind: "unavailable" as const }
        : { kind: "available" as const, state: mappedParser.initialState },
    );
    const baseFragments = baseParser.getDocFragments(
      baseParser.initialState === undefined
        ? { kind: "unavailable" as const }
        : { kind: "available" as const, state: baseParser.initialState },
    );
    assert.deepEqual(fragments, baseFragments);
  });

  it("should preserve description from wrapped parser", () => {
    const description = message`Enable verbose output`;
    const baseParser = option("-v", "--verbose", { description });
    const mappedParser = map(baseParser, (b) => !b);

    const fragments = mappedParser.getDocFragments(
      mappedParser.initialState === undefined
        ? { kind: "unavailable" as const }
        : { kind: "available" as const, state: mappedParser.initialState },
    );

    assert.equal(fragments.fragments.length, 1);
    assert.equal(fragments.fragments[0].type, "entry");
    if (fragments.fragments[0].type === "entry") {
      assert.deepEqual(fragments.fragments[0].description, description);
    }
  });

  it("should support chaining multiple maps", () => {
    const baseParser = option("-n", "--name", string());
    const mappedParser = map(
      map(baseParser, (s) => s.toLowerCase()),
      (s) => s.split("").reverse().join(""),
    );

    const result = parse(mappedParser, ["-n", "ALICE"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "ecila"); // "ALICE" -> "alice" -> "ecila"
    }
  });

  it("should map thenable replay results for derived metadata", async () => {
    const sourceId = Symbol("mode");
    const baseParser = option("--level", string());
    Object.defineProperty(baseParser, "dependencyMetadata", {
      value: {
        derived: {
          kind: "derived" as const,
          dependencyIds: [sourceId],
          replayParse: () =>
            createPromiseLike({
              success: true as const,
              value: "debug",
            }),
        },
      },
      configurable: true,
    });

    const mappedParser = map(baseParser, (value) => value.toUpperCase());
    const replayParse = mappedParser.dependencyMetadata?.derived?.replayParse;
    assert.ok(replayParse);

    const result = await Promise.resolve(replayParse("ignored", ["prod"]));
    assert.deepEqual(result, { success: true, value: "DEBUG" });
  });
});

describe("multiple", () => {
  it("should create a parser with same priority as wrapped parser", () => {
    const baseParser = option("-l", "--locale", string());
    const multipleParser = multiple(baseParser);

    assert.equal(multipleParser.priority, baseParser.priority);
    assert.deepEqual(multipleParser.initialState, []);
  });

  it("should parse multiple occurrences of wrapped parser", () => {
    const baseParser = option("-l", "--locale", string());
    const multipleParser = multiple(baseParser);

    const result = parse(multipleParser, ["-l", "en", "-l", "fr", "-l", "de"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["en", "fr", "de"]);
    }
  });

  it("should preserve annotations on each item state in complete()", () => {
    const annotation = Symbol.for("@test/multiple-item-annotations");
    const baseParser: Parser<"sync", string, { value: string }> = {
      $mode: "sync",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: "" },
      parse(context) {
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return {
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          };
        }
        return {
          success: true as const,
          consumed: [head],
          next: {
            ...context,
            buffer: tail,
            state: { value: head },
          },
        };
      },
      complete(state) {
        const annotations = getAnnotations(state);
        if (annotations?.[annotation] !== "ok") {
          return {
            success: false as const,
            error: message`Missing annotations on item state.`,
          };
        }
        return { success: true as const, value: state.value };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const parseResult = parser.parse({
      buffer: ["alpha"],
      state: injectAnnotations(parser.initialState, { [annotation]: "ok" }),
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = parser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.deepEqual(completeResult.value, ["alpha"]);
      }
    }
  });

  it("should preserve annotations on each async item state in complete()", async () => {
    const annotation = Symbol.for("@test/multiple-item-annotations-async");
    const baseParser: Parser<"async", string, { value: string }> = {
      $mode: "async",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: "" },
      parse(context) {
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          consumed: [head],
          next: {
            ...context,
            buffer: tail,
            state: { value: head },
          },
        });
      },
      complete(state) {
        const annotations = getAnnotations(state);
        if (annotations?.[annotation] !== "ok") {
          return Promise.resolve({
            success: false as const,
            error: message`Missing annotations on async item state.`,
          });
        }
        return Promise.resolve({ success: true as const, value: state.value });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const parseResult = await parser.parse({
      buffer: ["alpha"],
      state: injectAnnotations(parser.initialState, { [annotation]: "ok" }),
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parseResult.success);
    if (parseResult.success) {
      const completeResult = await parser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.deepEqual(completeResult.value, ["alpha"]);
      }
    }
  });

  it("should preserve annotations after fallback parse in sync branch", () => {
    const annotation = Symbol.for("@test/multiple-fallback-annotations");
    const baseParser: Parser<"sync", string, { readonly used: boolean }> = {
      $mode: "sync",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { used: false },
      parse(context) {
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return {
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          };
        }
        if (context.state.used) {
          return {
            success: false as const,
            consumed: 0,
            error: message`State already used.`,
          };
        }
        return {
          success: true as const,
          consumed: [head],
          next: {
            ...context,
            buffer: tail,
            state: { used: true },
          },
        };
      },
      complete(state) {
        const annotations = getAnnotations(state);
        if (annotations?.[annotation] !== "ok") {
          return {
            success: false as const,
            error: message`Missing annotations on fallback item state.`,
          };
        }
        return { success: true as const, value: state.used ? "ok" : "bad" };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const result = parse(parser, ["a", "b"], {
      annotations: { [annotation]: "ok" },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["ok", "ok"]);
    }
  });

  it("should pass annotations to inner parse state in sync branch", () => {
    const annotation = Symbol.for("@test/multiple-parse-annotations-sync");
    const baseParser: Parser<"sync", string, string> = {
      $mode: "sync",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        if (getAnnotations(context.state)?.[annotation] !== "ok") {
          return {
            success: false as const,
            consumed: 0,
            error: message`Missing annotations on parse state.`,
          };
        }
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return {
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          };
        }
        return {
          success: true as const,
          consumed: [head],
          next: { ...context, buffer: tail, state: head },
        };
      },
      complete(state) {
        return { success: true as const, value: unwrapPrimitiveState(state) };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const result = parse(parser, ["alpha"], {
      annotations: { [annotation]: "ok" },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["alpha"]);
    }
  });

  it("should retry sync parse with unwrapped primitive state after throw", () => {
    const parser = multiple({
      $mode: "sync" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        if (typeof context.state !== "string") {
          throw new TypeError("Expected string state.");
        }
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return {
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          };
        }
        return {
          success: true as const,
          consumed: [head],
          next: { ...context, buffer: tail, state: head },
        };
      },
      complete(state) {
        return {
          success: true as const,
          value: unwrapPrimitiveState(state).toUpperCase(),
        };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    });

    const result = parse(parser, ["alpha"], {
      annotations: { [Symbol.for("@test/parse-fallback-sync")]: true },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["ALPHA"]);
    }
  });

  it("should preserve annotations after fallback parse in async branch", async () => {
    const annotation = Symbol.for("@test/multiple-fallback-annotations-async");
    const baseParser: Parser<"async", string, { readonly used: boolean }> = {
      $mode: "async",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { used: false },
      parse(context) {
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          });
        }
        if (context.state.used) {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`State already used.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          consumed: [head],
          next: {
            ...context,
            buffer: tail,
            state: { used: true },
          },
        });
      },
      complete(state) {
        const annotations = getAnnotations(state);
        if (annotations?.[annotation] !== "ok") {
          return Promise.resolve({
            success: false as const,
            error: message`Missing annotations on async fallback item state.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          value: state.used ? "ok" : "bad",
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const result = await parse(parser, ["a", "b"], {
      annotations: { [annotation]: "ok" },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["ok", "ok"]);
    }
  });

  it("should pass annotations to inner parse state in async branch", async () => {
    const annotation = Symbol.for("@test/multiple-parse-annotations-async");
    const baseParser: Parser<"async", string, string> = {
      $mode: "async",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        if (getAnnotations(context.state)?.[annotation] !== "ok") {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`Missing annotations on async parse state.`,
          });
        }
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          consumed: [head],
          next: { ...context, buffer: tail, state: head },
        });
      },
      complete(state) {
        return Promise.resolve({
          success: true as const,
          value: unwrapPrimitiveState(state),
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const result = await parse(parser, ["alpha"], {
      annotations: { [annotation]: "ok" },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["alpha"]);
    }
  });

  it("should retry async parse with unwrapped primitive state after throw", async () => {
    const parser = multiple({
      $mode: "async" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        if (typeof context.state !== "string") {
          return Promise.reject(new TypeError("Expected string state."));
        }
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          consumed: [head],
          next: { ...context, buffer: tail, state: head },
        });
      },
      complete(state) {
        return Promise.resolve({
          success: true as const,
          value: unwrapPrimitiveState(state).toUpperCase(),
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    });

    const result = await parse(parser, ["alpha"], {
      annotations: { [Symbol.for("@test/parse-fallback-async")]: true },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["ALPHA"]);
    }
  });

  it("should preserve annotations for primitive item states", () => {
    const annotation = Symbol.for("@test/multiple-primitive-item-annotations");
    const baseParser: Parser<"sync", string, string> = {
      $mode: "sync",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return {
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          };
        }
        if (context.state !== "") {
          return {
            success: false as const,
            consumed: 0,
            error: message`State already used.`,
          };
        }
        return {
          success: true as const,
          consumed: [head],
          next: {
            ...context,
            buffer: tail,
            state: head,
          },
        };
      },
      complete(state) {
        if (getAnnotations(state)?.[annotation] !== "ok") {
          return {
            success: false as const,
            error: message`Missing annotations on primitive item state.`,
          };
        }
        if (typeof state === "object" && state !== null) {
          const value = (state as Record<PropertyKey, unknown>)[
            annotationStateValueKey
          ];
          if (typeof value === "string") {
            return { success: true as const, value };
          }
        }
        return { success: true as const, value: state };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const result = parse(parser, ["a", "b"], {
      annotations: { [annotation]: "ok" },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["a", "b"]);
    }
  });

  it("should not leak wrapped primitive item states in complete()", () => {
    const annotation = Symbol.for("@test/multiple-primitive-complete");
    const parser = multiple(constant("ok"));

    const result = parse(parser, [], {
      annotations: { [annotation]: true },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["ok"]);
      assert.equal(typeof result.value[0], "string");
    }
  });

  it("should fallback to unwrapped primitive state in complete()", () => {
    const baseParser: Parser<"sync", string, string> = {
      $mode: "sync",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return {
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          };
        }
        return {
          success: true as const,
          consumed: [head],
          next: { ...context, buffer: tail, state: head },
        };
      },
      complete(state) {
        return { success: true as const, value: state.toUpperCase() };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const result = parse(parser, ["alpha"], {
      annotations: { [Symbol.for("@test/fallback-complete")]: true },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["ALPHA"]);
    }
  });

  it("should retry complete on annotated wrapper state failures", () => {
    const seenStates: string[] = [];
    const baseParser: Parser<"sync", string, string> = {
      $mode: "sync",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return {
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          };
        }
        return {
          success: true as const,
          consumed: [head],
          next: { ...context, buffer: tail, state: head },
        };
      },
      complete(state) {
        seenStates.push(typeof state === "string" ? state : "wrapped");
        if (typeof state !== "string") {
          return {
            success: false as const,
            error: message`Expected string state.`,
          };
        }
        return { success: true as const, value: state.toUpperCase() };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const result = parse(parser, ["alpha"], {
      annotations: { [Symbol.for("@test/fallback-complete-failure")]: true },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["ALPHA"]);
    }
    assert.deepEqual(seenStates, ["wrapped", "alpha"]);
  });

  it("should retry async complete on annotated wrapper state failures", async () => {
    const seenStates: string[] = [];
    const baseParser: Parser<"async", string, string> = {
      $mode: "async",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          consumed: [head],
          next: { ...context, buffer: tail, state: head },
        });
      },
      complete(state) {
        seenStates.push(typeof state === "string" ? state : "wrapped");
        if (typeof state !== "string") {
          return Promise.resolve({
            success: false as const,
            error: message`Expected string state.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          value: state.toUpperCase(),
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const result = await parse(parser, ["alpha"], {
      annotations: {
        [Symbol.for("@test/fallback-complete-failure-async")]: true,
      },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["ALPHA"]);
    }
    assert.deepEqual(seenStates, ["wrapped", "alpha"]);
  });

  it("should fallback to unwrapped primitive state in suggest()", () => {
    const baseParser: Parser<"sync", string, string> = {
      $mode: "sync",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        const [head, ...tail] = context.buffer;
        if (head === undefined) {
          return {
            success: false as const,
            consumed: 0,
            error: message`Expected a value.`,
          };
        }
        return {
          success: true as const,
          consumed: [head],
          next: { ...context, buffer: tail, state: head },
        };
      },
      complete(state) {
        return { success: true as const, value: state.toUpperCase() };
      },
      suggest(context) {
        if (typeof context.state !== "string") {
          throw new TypeError("Expected string state.");
        }
        return [{ kind: "literal" as const, text: "beta" }];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const parseResult = parser.parse({
      buffer: ["alpha"],
      state: injectAnnotations(parser.initialState, {
        [Symbol.for("@test/fallback-suggest")]: true,
      }),
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parseResult.success);
    if (!parseResult.success) {
      return;
    }
    const suggestions = [...parser.suggest({
      buffer: [],
      state: parseResult.next.state,
      optionsTerminated: false,
      usage: parser.usage,
    }, "")];
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "beta"),
    );
  });

  it("should pass annotations to inner suggest state", () => {
    const annotation = Symbol.for("@test/multiple-suggest-annotations");
    const baseParser: Parser<"sync", string, string> = {
      $mode: "sync",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse() {
        return {
          success: false as const,
          consumed: 0,
          error: message`Expected a value.`,
        };
      },
      complete() {
        return {
          success: false as const,
          error: message`Expected a value.`,
        };
      },
      suggest(context) {
        if (getAnnotations(context.state)?.[annotation] !== "ok") {
          return [];
        }
        return [{ kind: "literal" as const, text: "beta" }];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const suggestions = [
      ...parser.suggest({
        buffer: [],
        state: injectAnnotations(parser.initialState, {
          [annotation]: "ok",
        }),
        optionsTerminated: false,
        usage: parser.usage,
      }, "") as Iterable<Suggestion>,
    ];
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "beta"),
    );
  });

  it("should pass annotations to async inner suggest state", async () => {
    const annotation = Symbol.for("@test/multiple-suggest-annotations-async");
    const baseParser: Parser<"async", string, string> = {
      $mode: "async",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`Expected a value.`,
        });
      },
      complete() {
        return Promise.resolve({
          success: false as const,
          error: message`Expected a value.`,
        });
      },
      async *suggest(context) {
        if (getAnnotations(context.state)?.[annotation] !== "ok") {
          return;
        }
        yield { kind: "literal" as const, text: "beta" };
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const suggestions = await collectSuggestions(
      parser.suggest({
        buffer: [],
        state: injectAnnotations(parser.initialState, {
          [annotation]: "ok",
        }),
        optionsTerminated: false,
        usage: parser.usage,
      }, "") as AsyncIterable<Suggestion>,
    );
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "beta"),
    );
  });

  it("keeps top-level choice suggestions under annotations via suggestSync()", () => {
    const annotation = Symbol.for("@test/issue-189/top-level-choice");
    const parser = multiple(argument(choice(["alpha", "beta"] as const)));

    const parsed = parse(parser, ["alpha"], {
      annotations: { [annotation]: true },
    });
    assert.deepEqual(parsed, { success: true, value: ["alpha"] });

    const suggestions = suggestSync(parser, ["a"], {
      annotations: { [annotation]: true },
    });
    assert.deepEqual(suggestions, [{ kind: "literal", text: "alpha" }]);
  });

  it("keeps top-level command suggestions under annotations via public entrypoints", () => {
    const annotation = Symbol.for("@test/issue-189/top-level-command");
    const parser = multiple(
      command("go", object({ silent: option("--silent") })),
    );

    const suggestions = suggest(parser, ["g"], {
      annotations: { [annotation]: true },
    });
    assert.deepEqual(suggestions, [{ kind: "literal", text: "go" }]);
  });

  it("keeps forwarding wrapper suggestions under annotations via public entrypoints", () => {
    const annotation = Symbol.for("@test/issue-189/group-wrapper");
    const parser = group(
      "wrapped",
      multiple(argument(choice(["alpha", "beta"] as const))),
    );

    const suggestions = suggest(parser, ["a"], {
      annotations: { [annotation]: true },
    });
    assert.deepEqual(suggestions, [{ kind: "literal", text: "alpha" }]);
  });

  it("keeps async top-level suggestions under annotations via public entrypoints", async () => {
    const annotation = Symbol.for("@test/issue-189/top-level-async");
    const parser = multiple(argument(asyncChoice(["alpha", "beta"] as const)));

    const parsed = await parseAsync(parser, ["alpha"], {
      annotations: { [annotation]: true },
    });
    assert.deepEqual(parsed, { success: true, value: ["alpha"] });

    const suggestions = await suggestAsync(parser, ["a"], {
      annotations: { [annotation]: true },
    });
    assert.deepEqual(suggestions, [{ kind: "literal", text: "alpha" }]);
  });

  it("should continue suggestions from the in-progress sync item", () => {
    const baseParser: Parser<"sync", string, { readonly step: number }> = {
      $mode: "sync",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { step: 0 },
      parse() {
        return {
          success: false as const,
          consumed: 0,
          error: message`Expected a value.`,
        };
      },
      complete(state) {
        return { success: true as const, value: `step-${state.step}` };
      },
      suggest(context) {
        if (
          context.state.step === 1 &&
          JSON.stringify(context.exec?.path) === JSON.stringify(["root", 0])
        ) {
          return [{ kind: "literal" as const, text: "second" }];
        }
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const suggestions = [...parser.suggest({
      buffer: [],
      state: [{ step: 1 }],
      optionsTerminated: false,
      usage: parser.usage,
      exec: {
        usage: parser.usage,
        phase: "suggest",
        path: ["root"],
        trace: undefined,
      },
    }, "")];

    assert.deepEqual(suggestions, [{ kind: "literal", text: "second" }]);
  });

  it("should continue suggestions from the in-progress async item", async () => {
    const baseParser: Parser<"async", string, { readonly step: number }> = {
      $mode: "async",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { step: 0 },
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`Expected a value.`,
        });
      },
      complete(state) {
        return Promise.resolve({
          success: true as const,
          value: `step-${state.step}`,
        });
      },
      async *suggest(context) {
        if (
          context.state.step === 1 &&
          JSON.stringify(context.exec?.path) === JSON.stringify(["root", 0])
        ) {
          yield { kind: "literal" as const, text: "second" };
        }
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const suggestions = await collectSuggestions(parser.suggest({
      buffer: [],
      state: [{ step: 1 }],
      optionsTerminated: false,
      usage: parser.usage,
      exec: {
        usage: parser.usage,
        phase: "suggest",
        path: ["root"],
        trace: undefined,
      },
    }, ""));

    assert.deepEqual(suggestions, [{ kind: "literal", text: "second" }]);
  });

  it("should not fallback to unwrapped primitive state after async suggest succeeds", async () => {
    const annotation = Symbol.for("@test/async-suggest-primitive-success");
    const baseParser: Parser<"async", string, string> = {
      $mode: "async",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`Expected a value.`,
        });
      },
      complete() {
        return Promise.resolve({
          success: false as const,
          error: message`Expected a value.`,
        });
      },
      async *suggest(context) {
        if (getAnnotations(context.state)?.[annotation] === "ok") {
          yield { kind: "literal" as const, text: "wrapped-ok" };
          return;
        }
        if (typeof context.state === "string") {
          yield { kind: "literal" as const, text: "primitive-ok" };
        }
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = multiple(baseParser);
    const suggestions = await collectSuggestions(
      parser.suggest({
        buffer: [],
        state: injectAnnotations(parser.initialState, {
          [annotation]: "ok",
        }),
        optionsTerminated: false,
        usage: parser.usage,
      }, "") as AsyncIterable<Suggestion>,
    );

    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "wrapped-ok"),
    );
    assert.ok(
      !suggestions.some((s) =>
        s.kind === "literal" && s.text === "primitive-ok"
      ),
    );
  });

  it("should not deduplicate distinct URL descriptions in suggest()", () => {
    const parser = multiple({
      $mode: "sync" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse() {
        return {
          success: false as const,
          consumed: 0,
          error: message`Expected a value.`,
        };
      },
      complete() {
        return {
          success: false as const,
          error: message`Expected a value.`,
        };
      },
      suggest() {
        return [
          {
            kind: "literal" as const,
            text: "docs",
            description: message`See ${url("https://example.com/a")}.`,
          },
          {
            kind: "literal" as const,
            text: "docs",
            description: message`See ${url("https://example.com/b")}.`,
          },
        ];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    });

    const suggestions = [
      ...parser.suggest({
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      }, "") as Iterable<Suggestion>,
    ];

    assert.equal(suggestions.length, 2);
    assert.ok(
      suggestions.some((s) =>
        s.kind === "literal" &&
        s.description != null &&
        formatMessage(s.description).includes("https://example.com/a")
      ),
    );
    assert.ok(
      suggestions.some((s) =>
        s.kind === "literal" &&
        s.description != null &&
        formatMessage(s.description).includes("https://example.com/b")
      ),
    );
  });

  it("should not fallback to unwrapped primitive initial state after suggest succeeds", () => {
    const annotation = Symbol.for("@test/suggest-primitive-success");
    const parser = multiple({
      $mode: "sync" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse() {
        return {
          success: false as const,
          consumed: 0,
          error: message`Expected a value.`,
        };
      },
      complete() {
        return {
          success: false as const,
          error: message`Expected a value.`,
        };
      },
      suggest(context) {
        if (getAnnotations(context.state)?.[annotation] === true) {
          return [{ kind: "literal" as const, text: "wrapped-ok" }];
        }
        if (typeof context.state === "string") {
          return [{ kind: "literal" as const, text: "primitive-ok" }];
        }
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    });

    const suggestions = [
      ...parser.suggest({
        buffer: [],
        state: injectAnnotations(parser.initialState, {
          [annotation]: true,
        }),
        optionsTerminated: false,
        usage: parser.usage,
      }, "") as Iterable<Suggestion>,
    ];
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "wrapped-ok"),
    );
    assert.ok(
      !suggestions.some((s) =>
        s.kind === "literal" && s.text === "primitive-ok"
      ),
    );
  });

  it("should not leak annotations into non-plain suggest initial state", () => {
    const marker = Symbol.for("@test/non-plain-suggest");
    class CustomState {
      value = 1;
    }
    const initialState = new CustomState();
    const baseParser: Parser<"sync", string, CustomState> = {
      $mode: "sync",
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState,
      parse() {
        return {
          success: false as const,
          consumed: 0,
          error: message`Expected a value.`,
        };
      },
      complete() {
        return {
          success: false as const,
          error: message`Expected a value.`,
        };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };
    const parser = multiple(baseParser);
    const suggestions = [
      ...parser.suggest({
        buffer: [],
        state: injectAnnotations(parser.initialState, { [marker]: "ok" }),
        optionsTerminated: false,
        usage: parser.usage,
      }, "") as Iterable<Suggestion>,
    ];

    assert.deepEqual(suggestions, []);
    assert.equal(getAnnotations(initialState), undefined);
  });

  it("should return empty array when no matches found in object context", () => {
    const parser = object({
      locales: multiple(option("-l", "--locale", string())),
      verbose: option("-v", "--verbose"),
    });

    const result = parse(parser, ["-v"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value.locales, []);
      assert.equal(result.value.verbose, true);
    }
  });

  it("should work with argument parsers", () => {
    const baseParser = argument(string());
    const multipleParser = multiple(baseParser);

    const result = parse(multipleParser, [
      "file1.txt",
      "file2.txt",
      "file3.txt",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["file1.txt", "file2.txt", "file3.txt"]);
    }
  });

  it("should enforce minimum constraint", () => {
    const baseParser = option("-l", "--locale", string());
    const multipleParser = multiple(baseParser, { min: 2 });

    const resultTooFew = parse(multipleParser, ["-l", "en"]);
    assert.ok(!resultTooFew.success);
    if (!resultTooFew.success) {
      assertErrorIncludes(
        resultTooFew.error,
        "Expected at least 2 values, but got only 1",
      );
    }

    const resultEnough = parse(multipleParser, ["-l", "en", "-l", "fr"]);
    assert.ok(resultEnough.success);
    if (resultEnough.success) {
      assert.deepEqual(resultEnough.value, ["en", "fr"]);
    }
  });

  it("should enforce maximum constraint", () => {
    const baseParser = argument(string());
    const multipleParser = multiple(baseParser, { max: 2 });

    const resultTooMany = parse(multipleParser, [
      "file1.txt",
      "file2.txt",
      "file3.txt",
    ]);
    assert.ok(!resultTooMany.success);
    if (!resultTooMany.success) {
      assertErrorIncludes(
        resultTooMany.error,
        "Unexpected option or argument",
      );
    }

    const resultOkay = parse(multipleParser, ["file1.txt", "file2.txt"]);
    assert.ok(resultOkay.success);
    if (resultOkay.success) {
      assert.deepEqual(resultOkay.value, ["file1.txt", "file2.txt"]);
    }
  });

  it("should enforce both min and max constraints", () => {
    const baseParser = argument(string());
    const multipleParser = multiple(baseParser, { min: 1, max: 3 });

    // When used standalone, multiple() fails if it can't parse at least one occurrence
    const resultTooFew = parse(multipleParser, []);
    assert.ok(!resultTooFew.success);
    if (!resultTooFew.success) {
      assertErrorIncludes(
        resultTooFew.error,
        "Expected an argument, but got end of input",
      );
    }

    const resultTooMany = parse(multipleParser, ["a", "b", "c", "d"]);
    assert.ok(!resultTooMany.success);
    if (!resultTooMany.success) {
      assertErrorIncludes(
        resultTooMany.error,
        "Unexpected option or argument",
      );
    }

    const resultJustRight = parse(multipleParser, ["a", "b"]);
    assert.ok(resultJustRight.success);
    if (resultJustRight.success) {
      assert.deepEqual(resultJustRight.value, ["a", "b"]);
    }
  });

  it("should work with default options (min=0, max=Infinity)", () => {
    const parser = object({
      options: multiple(option("-x", string())),
      help: option("-h", "--help"),
    });

    // When min=0, should allow empty array in object context
    const resultEmpty = parse(parser, ["-h"]);
    assert.ok(resultEmpty.success);
    if (resultEmpty.success) {
      assert.deepEqual(resultEmpty.value.options, []);
      assert.equal(resultEmpty.value.help, true);
    }

    // Test with many values to ensure no arbitrary limit
    const manyArgs = Array.from({ length: 10 }, (_, i) => ["-x", `value${i}`])
      .flat();
    manyArgs.push("-h");
    const resultMany = parse(parser, manyArgs);
    assert.ok(resultMany.success);
    if (resultMany.success) {
      assert.equal(resultMany.value.options.length, 10);
      assert.equal(resultMany.value.options[0], "value0");
      assert.equal(resultMany.value.options[9], "value9");
      assert.equal(resultMany.value.help, true);
    }
  });

  it("should work in object combinations", () => {
    const parser = object({
      locales: multiple(option("-l", "--locale", string())),
      verbose: option("-v", "--verbose"),
      files: multiple(argument(string()), { min: 1 }),
    });

    const result = parse(parser, [
      "-l",
      "en",
      "-l",
      "fr",
      "-v",
      "file1.txt",
      "file2.txt",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value.locales, ["en", "fr"]);
      assert.equal(result.value.verbose, true);
      assert.deepEqual(result.value.files, ["file1.txt", "file2.txt"]);
    }
  });

  it("should propagate wrapped parser failures", () => {
    const baseParser = option("-p", "--port", integer({ min: 1, max: 0xffff }));
    const multipleParser = multiple(baseParser);

    const result = parse(multipleParser, ["-p", "8080", "-p", "invalid"]);
    assert.ok(!result.success);
    // The failure should come from the invalid integer parsing
  });

  it("should handle mixed successful and failed parsing attempts in object context", () => {
    const parser = object({
      numbers: multiple(option("-n", "--number", integer())),
      other: option("--other", string()),
    });

    const result = parse(parser, ["-n", "42", "-n", "100", "--other", "value"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value.numbers, [42, 100]);
      assert.equal(result.value.other, "value");
    }
  });

  it("should work with boolean flag options", () => {
    const baseParser = option("-v", "--verbose");
    const multipleParser = multiple(baseParser);

    const result = parse(multipleParser, ["-v", "-v", "-v"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, [true, true, true]);
    }
  });

  it("should handle parse context state management correctly", () => {
    const baseParser = option("-l", "--locale", string());
    const multipleParser = multiple(baseParser);

    const context = {
      buffer: ["-l", "en", "-l", "fr"] as readonly string[],
      state: multipleParser.initialState,
      optionsTerminated: false,
      usage: multipleParser.usage,
    };

    let parseResult = multipleParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      assert.deepEqual(parseResult.consumed, ["-l", "en"]);
      assert.equal(parseResult.next.state.length, 1);

      // Parse next occurrence
      parseResult = multipleParser.parse(parseResult.next);
      assert.ok(parseResult.success);
      if (parseResult.success) {
        assert.deepEqual(parseResult.consumed, ["-l", "fr"]);
        assert.equal(parseResult.next.state.length, 2);
      }
    }
  });

  it("should complete with proper value array", () => {
    const baseParser = option("-n", "--number", integer());
    const multipleParser = multiple(baseParser);

    const mockStates = [
      { success: true as const, value: 42 },
      { success: true as const, value: 100 },
      { success: true as const, value: 7 },
    ];

    const completeResult = multipleParser.complete(mockStates);
    assert.ok(completeResult.success);
    if (completeResult.success) {
      assert.deepEqual(completeResult.value, [42, 100, 7]);
    }
  });

  it("should fail completion if wrapped parser completion fails", () => {
    const baseParser = option("-n", "--number", integer());
    const multipleParser = multiple(baseParser);

    const mockStates = [
      { success: true as const, value: 42 },
      {
        success: false as const,
        error: [{ type: "text", text: "Invalid number" }] as Message,
      },
      { success: true as const, value: 7 },
    ];

    const completeResult = multipleParser.complete(mockStates);
    assert.ok(!completeResult.success);
    if (!completeResult.success) {
      assertErrorIncludes(completeResult.error, "Invalid number");
    }
  });

  it("should handle empty state array with min constraint", () => {
    const baseParser = option("-l", "--locale", string());
    const multipleParser = multiple(baseParser, { min: 1 });

    const completeResult = multipleParser.complete([]);
    assert.ok(!completeResult.success);
    if (!completeResult.success) {
      assertErrorIncludes(
        completeResult.error,
        "Expected at least 1 values, but got only 0",
      );
    }
  });

  it("should handle max constraint at completion", () => {
    const baseParser = option("-l", "--locale", string());
    const multipleParser = multiple(baseParser, { max: 2 });

    const mockStates = [
      { success: true as const, value: "en" },
      { success: true as const, value: "fr" },
      { success: true as const, value: "de" },
    ];

    const completeResult = multipleParser.complete(mockStates);
    assert.ok(!completeResult.success);
    if (!completeResult.success) {
      assertErrorIncludes(
        completeResult.error,
        "Expected at most 2 values, but got 3",
      );
    }
  });

  it("should work with constant parsers", () => {
    const baseParser = constant("fixed-value");
    const multipleParser = multiple(baseParser, { min: 1, max: 3 });

    // Since constant parser always succeeds without consuming input,
    // this would theoretically create infinite loop, but the implementation
    // should handle it properly by checking state changes
    const result = parse(multipleParser, []);
    assert.ok(result.success);
    if (result.success) {
      // Should get exactly one value since constant doesn't consume input
      assert.deepEqual(result.value, ["fixed-value"]);
    }
  });

  it("should reproduce example.ts usage patterns", () => {
    // Based on the example.ts usage of multiple()
    const parser1 = object({
      name: option("-n", "--name", string()),
      locales: multiple(option("-l", "--locale", string())),
      id: argument(string()),
    });

    const result1 = parse(parser1, [
      "-n",
      "John",
      "-l",
      "en-US",
      "-l",
      "fr-FR",
      "user123",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.name, "John");
      assert.deepEqual(result1.value.locales, ["en-US", "fr-FR"]);
      assert.equal(result1.value.id, "user123");
    }

    // Test the constrained multiple arguments pattern
    const parser2 = object({
      title: option("-t", "--title", string()),
      ids: multiple(argument(string()), { min: 1, max: 3 }),
    });

    const result2 = parse(parser2, ["-t", "My Title", "id1", "id2"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.title, "My Title");
      assert.deepEqual(result2.value.ids, ["id1", "id2"]);
    }

    // Test constraint violation
    const result3 = parse(parser2, ["-t", "Title", "id1", "id2", "id3", "id4"]);
    assert.ok(!result3.success);
    if (!result3.success) {
      assertErrorIncludes(
        result3.error,
        "Unexpected option or argument",
      );
    }
  });

  it("should handle options terminator correctly", () => {
    const parser = object({
      locales: multiple(option("-l", "--locale", string())),
      args: multiple(argument(string())),
    });

    const result = parse(parser, ["-l", "en", "--", "-l", "fr"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value.locales, ["en"]);
      assert.deepEqual(result.value.args, ["-l", "fr"]);
    }
  });

  it("should handle state transitions and updates correctly", () => {
    const baseParser = argument(string());
    const multipleParser = multiple(baseParser);

    // Test initial state
    assert.deepEqual(multipleParser.initialState, []);

    const context1 = {
      buffer: ["arg1"] as readonly string[],
      state: [],
      optionsTerminated: false,
      usage: multipleParser.usage,
    };

    const parseResult1 = multipleParser.parse(context1);
    assert.ok(parseResult1.success);
    if (parseResult1.success) {
      assert.equal(parseResult1.next.state.length, 1);
      assert.deepEqual(parseResult1.consumed, ["arg1"]);

      const context2 = {
        ...parseResult1.next,
        buffer: ["arg2"] as readonly string[],
      };

      const parseResult2 = multipleParser.parse(context2);
      assert.ok(parseResult2.success);
      if (parseResult2.success) {
        assert.equal(parseResult2.next.state.length, 2);
        assert.deepEqual(parseResult2.consumed, ["arg2"]);
      }
    }
  });

  it("should work with complex value parsers", () => {
    const baseParser = option(
      "-p",
      "--port",
      integer({ min: 1024, max: 0xffff }),
    );
    const multipleParser = multiple(baseParser, { min: 1, max: 5 });

    const validResult = parse(multipleParser, [
      "-p",
      "8080",
      "-p",
      "9000",
      "-p",
      "3000",
    ]);
    assert.ok(validResult.success);
    if (validResult.success) {
      assert.deepEqual(validResult.value, [8080, 9000, 3000]);
    }

    const invalidResult = parse(multipleParser, ["-p", "8080", "-p", "100"]);
    assert.ok(!invalidResult.success);
    // Should fail due to port 100 being below minimum

    const tooManyResult = parse(multipleParser, [
      "-p",
      "8080",
      "-p",
      "9000",
      "-p",
      "3000",
      "-p",
      "4000",
      "-p",
      "5000",
      "-p",
      "6000",
    ]);
    assert.ok(!tooManyResult.success);
    if (!tooManyResult.success) {
      assertErrorIncludes(
        tooManyResult.error,
        "Unexpected option or argument",
      );
    }
  });

  it("should maintain type safety with different value types", () => {
    const stringMultiple = multiple(option("-s", string()));
    const integerMultiple = multiple(option("-i", integer()));
    const booleanMultiple = multiple(option("-b"));

    const stringResult = parse(stringMultiple, ["-s", "hello", "-s", "world"]);
    assert.ok(stringResult.success);
    if (stringResult.success) {
      const typedStrings: readonly string[] = stringResult.value;
      void typedStrings;
      assert.equal(stringResult.value.length, 2);
      assert.equal(typeof stringResult.value[0], "string");
      assert.deepEqual(stringResult.value, ["hello", "world"]);
    }

    const integerResult = parse(integerMultiple, ["-i", "42", "-i", "100"]);
    assert.ok(integerResult.success);
    if (integerResult.success) {
      const typedIntegers: readonly number[] = integerResult.value;
      void typedIntegers;
      assert.equal(integerResult.value.length, 2);
      assert.equal(typeof integerResult.value[0], "number");
      assert.deepEqual(integerResult.value, [42, 100]);
    }

    const booleanResult = parse(booleanMultiple, ["-b", "-b"]);
    assert.ok(booleanResult.success);
    if (booleanResult.success) {
      const typedBooleans: readonly boolean[] = booleanResult.value;
      void typedBooleans;
      assert.equal(booleanResult.value.length, 2);
      assert.equal(typeof booleanResult.value[0], "boolean");
      assert.deepEqual(booleanResult.value, [true, true]);
    }
  });

  it("should append a sync item when a new slot reuses undefined state", () => {
    const itemParser = {
      $mode: "sync" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return {
          success: true as const,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: context.state,
          },
          consumed: [context.buffer[0]!],
        };
      },
      complete() {
        return { success: true as const, value: "item" };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"sync", string, undefined>;
    const parser = multiple(itemParser);

    const first = parser.parse({
      buffer: ["first"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(first.success);
    if (!first.success) return;

    const second = parser.parse({
      buffer: ["second"],
      state: first.next.state,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(second.success);
    if (!second.success) return;

    assert.deepEqual(second.next.state, [undefined, undefined]);
    assert.deepEqual(parser.complete(second.next.state), {
      success: true,
      value: ["item", "item"],
    });
  });

  it("should append an async item when a new slot reuses undefined state", async () => {
    const itemParser = {
      $mode: "async" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: context.state,
          },
          consumed: [context.buffer[0]!],
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "item" });
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"async", string, undefined>;
    const parser = multiple(itemParser);

    const first = await parser.parse({
      buffer: ["first"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(first.success);
    if (!first.success) return;

    const second = await parser.parse({
      buffer: ["second"],
      state: first.next.state,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(second.success);
    if (!second.success) return;

    assert.deepEqual(second.next.state, [undefined, undefined]);
    assert.deepEqual(await parser.complete(second.next.state), {
      success: true,
      value: ["item", "item"],
    });
  });

  it("should not append an empty optional slot on empty input", () => {
    const parser = multiple(optional(option("--name", string())));

    const result = parse(parser, []);
    assert.ok(result.success);
    if (!result.success) return;
    assert.deepEqual(result.value, []);
  });

  it("should not append an empty withDefault slot on empty input", () => {
    const parser = multiple(withDefault(option("--name", string()), "guest"));

    const result = parse(parser, []);
    assert.ok(result.success);
    if (!result.success) return;
    assert.deepEqual(result.value, []);
  });

  it("should not append an empty async optional slot on empty input", async () => {
    const parser = multiple(optional(option("--mode", asyncChoice(["dev"]))));

    const result = await parseAsync(parser, []);
    assert.ok(result.success);
    if (!result.success) return;
    assert.deepEqual(result.value, []);
  });

  it("should not append an empty slot for zero-consumption wrapper state", () => {
    type WrappedState = {
      readonly hasCliValue: boolean;
      readonly cliState?: string;
    };
    const parser = multiple({
      $mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly WrappedState[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { hasCliValue: false, cliState: "" },
      parse(context: ParserContext<WrappedState>) {
        return {
          success: true as const,
          next: {
            ...context,
            state: { hasCliValue: false, cliState: "" },
          },
          consumed: [],
        };
      },
      complete(state: WrappedState) {
        return { success: true as const, value: state.cliState ?? "" };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    });

    const result = parse(parser, []);
    assert.ok(result.success);
    if (!result.success) return;
    assert.deepEqual(result.value, []);
  });

  it("should reopen a wrapped terminal slot before parsing the next item", () => {
    type WrappedState = {
      readonly hasCliValue: boolean;
      readonly cliState?: ValueParserResult<string>;
    };
    const parser = multiple({
      $mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly WrappedState[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { hasCliValue: false },
      parse(context: ParserContext<WrappedState>) {
        if (context.buffer.length === 0) {
          return {
            success: true as const,
            next: context,
            consumed: [],
          };
        }
        return {
          success: true as const,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: {
              hasCliValue: true,
              cliState: {
                success: true as const,
                value: context.buffer[0],
              },
            },
          },
          consumed: [context.buffer[0]],
        };
      },
      complete(state: WrappedState) {
        if (state.cliState?.success) {
          return { success: true as const, value: state.cliState.value };
        }
        return { success: false as const, error: message`Missing value.` };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    });

    const first = parser.parse({
      buffer: ["first"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(first.success);
    if (!first.success) return;

    const second = parser.parse({
      buffer: ["second"],
      state: first.next.state,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(second.success);
    if (!second.success) return;

    assert.deepEqual(parser.complete(second.next.state), {
      success: true,
      value: ["first", "second"],
    });
  });

  it("should not reopen a sync slot after a consumed extension failure", () => {
    type ItemState =
      | { readonly first: string }
      | ValueParserResult<string>
      | undefined;
    const itemParser = {
      $mode: "sync" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context: ParserContext<ItemState>) {
        if (context.state == null) {
          return {
            success: true as const,
            next: {
              ...context,
              buffer: context.buffer.slice(1),
              state: { first: context.buffer[0]! },
            },
            consumed: [context.buffer[0]!],
          };
        }
        if (!("success" in context.state) && context.buffer[0] === "ok") {
          return {
            success: true as const,
            next: {
              ...context,
              buffer: context.buffer.slice(1),
              state: {
                success: true as const,
                value: `${context.state.first}:ok`,
              },
            },
            consumed: [context.buffer[0]!],
          };
        }
        return {
          success: false as const,
          consumed: 1,
          error: message`Expected closing token.`,
        };
      },
      complete(state: ItemState) {
        if (state != null && typeof state === "object" && "success" in state) {
          return state;
        }
        return {
          success: false as const,
          error: message`Expected closing token.`,
        };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"sync", string, ItemState>;
    const parser = multiple(itemParser);

    const first = parser.parse({
      buffer: ["start"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(first.success);
    if (!first.success) return;

    const second = parser.parse({
      buffer: ["bad"],
      state: first.next.state,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(!second.success);
    if (second.success) return;
    assert.equal(second.consumed, 1);
    assert.deepEqual(second.error, message`Expected closing token.`);
  });

  it("should not reopen an async slot after a consumed extension failure", async () => {
    type ItemState =
      | { readonly first: string }
      | ValueParserResult<string>
      | undefined;
    const itemParser = {
      $mode: "async" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context: ParserContext<ItemState>) {
        if (context.state == null) {
          return Promise.resolve({
            success: true as const,
            next: {
              ...context,
              buffer: context.buffer.slice(1),
              state: { first: context.buffer[0]! },
            },
            consumed: [context.buffer[0]!],
          });
        }
        if (!("success" in context.state) && context.buffer[0] === "ok") {
          return Promise.resolve({
            success: true as const,
            next: {
              ...context,
              buffer: context.buffer.slice(1),
              state: {
                success: true as const,
                value: `${context.state.first}:ok`,
              },
            },
            consumed: [context.buffer[0]!],
          });
        }
        return Promise.resolve({
          success: false as const,
          consumed: 1,
          error: message`Expected closing token.`,
        });
      },
      complete(state: ItemState) {
        if (state != null && typeof state === "object" && "success" in state) {
          return Promise.resolve(state);
        }
        return Promise.resolve({
          success: false as const,
          error: message`Expected closing token.`,
        });
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"async", string, ItemState>;
    const parser = multiple(itemParser);

    const first = await parser.parse({
      buffer: ["start"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(first.success);
    if (!first.success) return;

    const second = await parser.parse({
      buffer: ["bad"],
      state: first.next.state,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(!second.success);
    if (second.success) return;
    assert.equal(second.consumed, 1);
    assert.deepEqual(second.error, message`Expected closing token.`);
  });

  // Regression tests for
  // https://github.com/dahlia/optique/issues/408.  `multiple()` is
  // documented as "zero or more", but standalone top-level use with
  // empty input previously failed because `multiple().parse()`
  // propagated the inner parser's end-of-input failure instead of
  // absorbing it and letting `complete()` return an empty array.
  describe("zero-or-more at top level (#408)", () => {
    it("returns [] for multiple(flag) with empty input", () => {
      const result = parse(multiple(flag("-v")), []);
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value, []);
    });

    it("returns [] for multiple(option) with empty input", () => {
      const result = parse(multiple(option("--tag", string())), []);
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value, []);
    });

    it("returns [] for multiple(argument) with empty input", () => {
      const result = parse(multiple(argument(string())), []);
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value, []);
    });

    it("returns [] with explicit { min: 0 } and empty input", () => {
      const result = parse(multiple(flag("-v"), { min: 0 }), []);
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value, []);
    });

    it("propagates inner end-of-input failure when min > 0 and empty", () => {
      // With `min > 0`, `multiple().parse()` must propagate
      // zero-consumption inner failures so outer wrappers like
      // optional()/withDefault() can still absorb them; the top-level
      // parse surface therefore sees the inner end-of-input error
      // rather than a `validateMultipleResult` min error.
      const result = parse(multiple(flag("-v"), { min: 2 }), []);
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(
          result.error,
          "Expected an option, but got end of input",
        );
      }
    });

    it("preserves optional(multiple(min>0)) fallback on empty input", () => {
      // Regression guard: optional() / withDefault() must continue to
      // absorb multiple(min>0) parse failures on empty input after
      // #408, so that the fallback values can be applied.
      const result = parse(optional(multiple(flag("-v"), { min: 1 })), []);
      assert.ok(result.success);
      if (result.success) assert.equal(result.value, undefined);
    });

    it("preserves withDefault(multiple(min>0), default) fallback", () => {
      const result = parse(
        withDefault(multiple(flag("-v"), { min: 1 }), [true as const]),
        [],
      );
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value, [true]);
    });

    it("still succeeds with matches present at top level", () => {
      const result = parse(multiple(flag("-v")), ["-v", "-v"]);
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value, [true, true]);
    });

    it("surfaces inner parser error for an unknown trailing token", () => {
      // Absorption is scoped to truly empty input; when the buffer
      // still holds unconsumed tokens the inner parser's specific
      // mismatch error must be surfaced so users see informative
      // messages like "No matched option for `-x`" with suggestions,
      // instead of the generic top-level stall fallback.
      const result = parse(multiple(flag("-v")), ["-v", "-x"]);
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "No matched option for");
      }
    });

    it("surfaces inner parser error for a leading unknown token", () => {
      // Regression guard for the scoping fix: a standalone
      // multiple() with an unknown leading token must keep
      // reporting the inner parser's specific mismatch error
      // (with suggestions), not the generic stall fallback.  See
      // https://github.com/dahlia/optique/pull/776#discussion_r3046559404.
      const result = parse(multiple(flag("-v")), ["-x"]);
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "No matched option for");
      }
    });

    it("still propagates inner parse failures that consumed tokens", () => {
      // The fix only absorbs `consumed === 0` failures; parse-time
      // failures with `consumed > 0` must still propagate.  A missing
      // option value triggers that exact branch in `option().parse()`
      // (as opposed to a value-parser validation error, which goes
      // through the `ValueParserResult` / `complete()` path and would
      // not exercise the propagation branch under test here).
      const result = parse(
        multiple(option("-p", integer({ min: 1, max: 100 }))),
        ["-p", "5", "-p"],
      );
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "requires a value");
      }
    });

    it("still works inside object() with empty args", () => {
      // Regression guard: the `object()` zero-or-more path must
      // continue to work after the fix.
      const result = parse(object({ v: multiple(flag("-v")) }), []);
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value.v, []);
    });

    it("still fails inside object() when inner multiple has min > 0", () => {
      // Regression guard: `object()` must continue to surface
      // `multiple(p, { min: N > 0 })` failures on empty input through
      // its own error reporting path after the #408 fix.  Asserting a
      // stable fragment from the object() end-of-input path ties the
      // failure specifically to the `multiple(min > 0)` probe, since
      // `min: 0` would let every child complete and the parse would
      // succeed with `{ v: [] }` instead of reaching this branch.  See
      // https://github.com/dahlia/optique/pull/776#discussion_r3047719147.
      const result = parse(
        object({ v: multiple(flag("-v"), { min: 1 }) }),
        [],
      );
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "No matching option found");
      }
    });

    it("returns [] asynchronously for multiple(option) with empty input", async () => {
      const parser = multiple(
        option("--tag", asyncChoice(["a", "b"] as const)),
      );
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value, []);
    });

    it("propagates inner end-of-input asynchronously when min > 0", async () => {
      const parser = multiple(
        option("--tag", asyncChoice(["a", "b"] as const)),
        { min: 1 },
      );
      const result = await parseAsync(parser, []);
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(
          result.error,
          "Expected an option, but got end of input",
        );
      }
    });

    // The async branch of `multiple().parse()` was changed symmetrically
    // with the sync branch, so mirror the wrapper regression guards on
    // the async path as well.  See
    // https://github.com/dahlia/optique/pull/776#discussion_r3047719139.
    it("returns [] asynchronously from withDefault(multiple(min=0)) on empty input", async () => {
      const parser = withDefault(
        multiple(option("--tag", asyncChoice(["a", "b"] as const))),
        ["a"] as readonly ("a" | "b")[],
      );
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value, []);
    });

    it("preserves async optional(multiple(min>0)) fallback on empty input", async () => {
      const parser = optional(
        multiple(
          option("--tag", asyncChoice(["a", "b"] as const)),
          { min: 1 },
        ),
      );
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) assert.equal(result.value, undefined);
    });

    it("preserves async withDefault(multiple(min>0), default) fallback", async () => {
      const parser = withDefault(
        multiple(
          option("--tag", asyncChoice(["a", "b"] as const)),
          { min: 1 },
        ),
        ["a"] as readonly ("a" | "b")[],
      );
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value, ["a"]);
    });
  });

  describe("getDocFragments", () => {
    it("should delegate to wrapped parser", () => {
      const baseParser = option("-l", "--locale", string());
      const multipleParser = multiple(baseParser);

      // Should delegate to base parser with the last state
      const fragments = multipleParser.getDocFragments(
        { kind: "available" as const, state: [] },
      );
      const baseFragments = baseParser.getDocFragments(
        baseParser.initialState === undefined
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: baseParser.initialState },
      );
      assert.deepEqual(fragments, baseFragments);
    });

    it("should delegate with latest state when state array has items", () => {
      const baseParser = option("-l", "--locale", string());
      const multipleParser = multiple(baseParser);

      const states = [
        { success: true as const, value: "en" },
        { success: true as const, value: "fr" },
      ];
      const fragments = multipleParser.getDocFragments(
        { kind: "available" as const, state: states },
        ["en", "fr"],
      );

      // Should delegate to base parser with latest state and first default value
      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "option");
        if (fragments.fragments[0].term.type === "option") {
          assert.deepEqual(fragments.fragments[0].term.names, [
            "-l",
            "--locale",
          ]);
        }
        assert.deepEqual(fragments.fragments[0].default, message`${"en"}`);
      }
    });

    it("should use undefined as default when default array is empty", () => {
      const baseParser = option("-l", "--locale", string());
      const multipleParser = multiple(baseParser);

      const states = [{ success: true as const, value: "en" }];
      const fragments = multipleParser.getDocFragments(
        { kind: "available" as const, state: states },
        [],
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].default, undefined);
      }
    });

    it("should work with argument parsers", () => {
      const baseParser = argument(string({ metavar: "FILE" }));
      const multipleParser = multiple(baseParser);

      const fragments = multipleParser.getDocFragments(
        { kind: "available" as const, state: [] },
        [
          "file1.txt",
          "file2.txt",
        ],
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "argument");
        if (fragments.fragments[0].term.type === "argument") {
          assert.equal(fragments.fragments[0].term.metavar, "FILE");
        }
        assert.deepEqual(
          fragments.fragments[0].default,
          message`${"file1.txt"}`,
        );
      }
    });

    it("should preserve description from wrapped parser", () => {
      const description = message`Supported locales`;
      const baseParser = option("-l", "--locale", string(), { description });
      const multipleParser = multiple(baseParser);

      const fragments = multipleParser.getDocFragments(
        { kind: "available" as const, state: [] },
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].description, description);
      }
    });

    it("should work with empty state array", () => {
      const baseParser = option("-v", "--verbose");
      const multipleParser = multiple(baseParser);

      const fragments = multipleParser.getDocFragments(
        { kind: "available" as const, state: [] },
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "option");
        if (fragments.fragments[0].term.type === "option") {
          assert.deepEqual(fragments.fragments[0].term.names, [
            "-v",
            "--verbose",
          ]);
        }
      }
    });

    it("should unwrap injected primitive state before delegating docs", () => {
      let observedState: unknown;
      const baseParser: Parser<"sync", string, string> = {
        $mode: "sync",
        $valueType: [] as const,
        $stateType: [] as const,
        priority: 0,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: "",
        parse(context) {
          return {
            success: false as const,
            consumed: 0,
            error: message`Unexpected parse: ${context.buffer.join(", ")}`,
          };
        },
        complete(state) {
          return { success: true as const, value: state };
        },
        suggest() {
          return [];
        },
        getDocFragments(state) {
          observedState = state.kind === "available" ? state.state : undefined;
          return { fragments: [] };
        },
      };
      const parser = multiple(baseParser);
      const wrappedState = injectAnnotations("active", {
        [Symbol.for("@test/multiple-doc-state-wrapper")]: true,
      });

      parser.getDocFragments(
        { kind: "available", state: [wrappedState] },
      );

      assert.equal(observedState, "active");
    });
  });
});

describe("multiple() error customization", () => {
  it("should use custom tooFew error", () => {
    const parser = multiple(argument(string()), {
      min: 2,
      errors: {
        tooFew: message`You must provide at least 2 file paths.`,
      },
    });

    // Create a context with only one value parsed
    const singleArgState = [{
      success: true,
      value: "file1.txt",
    }] as const;

    const result = parser.complete(singleArgState);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "You must provide at least 2 file paths.",
      );
    }
  });

  it("should use custom tooFew error with function", () => {
    const parser = multiple(argument(string()), {
      min: 3,
      errors: {
        tooFew: (min, actual) =>
          message`Need ${text(min.toString())} files, but only found ${
            text(actual.toString())
          }.`,
      },
    });

    // Create a context with only one value parsed
    const singleArgState = [{
      success: true,
      value: "file1.txt",
    }] as const;

    const result = parser.complete(singleArgState);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Need 3 files, but only found 1.",
      );
    }
  });

  it("should use custom tooMany error", () => {
    const parser = multiple(argument(string()), {
      max: 2,
      errors: {
        tooMany: message`Too many arguments provided. Maximum allowed is 2.`,
      },
    });

    // Create a context with three values parsed
    const threeArgState = [
      { success: true, value: "file1.txt" },
      { success: true, value: "file2.txt" },
      { success: true, value: "file3.txt" },
    ] as const;

    const result = parser.complete(threeArgState);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Too many arguments provided. Maximum allowed is 2.",
      );
    }
  });

  it("should use custom tooMany error with function", () => {
    const parser = multiple(argument(string()), {
      max: 1,
      errors: {
        tooMany: (max, actual) =>
          message`Expected only ${text(max.toString())} file, but got ${
            text(actual.toString())
          }.`,
      },
    });

    // Create a context with two values parsed
    const twoArgState = [
      { success: true, value: "file1.txt" },
      { success: true, value: "file2.txt" },
    ] as const;

    const result = parser.complete(twoArgState);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Expected only 1 file, but got 2.",
      );
    }
  });

  it("should use custom unexpectedValue error for Boolean flags", () => {
    const parser = option("--flag", {
      errors: {
        unexpectedValue: (value: string) =>
          message`Flag cannot have value ${value}.`,
      },
    });

    const result = parser.parse({
      buffer: ["--flag=test"],
      state: { success: true, value: false },
      optionsTerminated: false,
      usage: parser.usage,
    });

    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(
        formatMessage(result.error),
        'Flag cannot have value "test".',
      );
    }
  });

  it("should use custom multiple error for arguments", () => {
    const parser = argument(string(), {
      errors: {
        multiple: (metavar: string) =>
          message`Argument ${metavar} was already provided.`,
      },
    });

    // First call succeeds
    const firstResult = parser.parse({
      buffer: ["first"],
      state: undefined,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(firstResult.success);

    // Second call should fail with custom error
    const secondResult = parser.parse({
      buffer: ["second"],
      state: firstResult.success ? firstResult.next.state : undefined,
      optionsTerminated: false,
      usage: parser.usage,
    });

    assert.ok(!secondResult.success);
    if (!secondResult.success) {
      assert.equal(
        formatMessage(secondResult.error),
        'Argument "STRING" was already provided.',
      );
    }
  });
});

describe("state management edge cases", () => {
  describe("inner parser succeeds without consuming", () => {
    it("should handle optional(constant()) - inner succeeds without consuming", () => {
      // constant() always succeeds without consuming any input
      const parser = optional(constant("fixed-value"));

      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        // Should return the constant value, not undefined
        assert.equal(result.value, "fixed-value");
      }
    });

    it("should handle withDefault(constant()) - inner succeeds without consuming", () => {
      const parser = withDefault(constant("inner-value"), "default-value");

      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        // constant() succeeds, so we get inner value, not default
        assert.equal(result.value, "inner-value");
      }
    });

    it("should handle state unwrapping when inner parser succeeds with no consume", () => {
      // Test that state is properly unwrapped in complete()
      const parser = optional(constant(42));

      const context = {
        buffer: [] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const parseResult = parser.parse(context);
      assert.ok(parseResult.success);
      if (parseResult.success) {
        const completeResult = parser.complete(parseResult.next.state);
        assert.ok(completeResult.success);
        if (completeResult.success) {
          assert.equal(completeResult.value, 42);
        }
      }
    });
  });

  describe("optionsTerminated propagation", () => {
    it("should propagate optionsTerminated through optional()", () => {
      const parser = optional(argument(string()));

      // With optionsTerminated = true, arguments should work
      const context = {
        buffer: ["--looks-like-option"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: true,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        // Should consume the argument even though it looks like an option
        assert.deepEqual(result.consumed, ["--looks-like-option"]);
        assert.deepEqual(result.next.buffer, []);
        // optionsTerminated should be preserved in next context
        assert.equal(result.next.optionsTerminated, true);
      }
    });

    it("should propagate optionsTerminated through withDefault()", () => {
      const parser = withDefault(argument(string()), "default");

      // With optionsTerminated = true
      const context = {
        buffer: ["-arg"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: true,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        // Should consume the argument even though it starts with -
        assert.deepEqual(result.consumed, ["-arg"]);
        assert.equal(result.next.optionsTerminated, true);
      }
    });

    it("should propagate optionsTerminated through multiple()", () => {
      const parser = multiple(argument(string()));

      const context = {
        buffer: ["--arg1", "--arg2"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: true,
        usage: parser.usage,
      };

      // First parse
      const result1 = parser.parse(context);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.consumed, ["--arg1"]);
        assert.equal(result1.next.optionsTerminated, true);

        // Second parse
        const result2 = parser.parse(result1.next);
        assert.ok(result2.success);
        if (result2.success) {
          assert.deepEqual(result2.consumed, ["--arg2"]);
          assert.equal(result2.next.optionsTerminated, true);
        }
      }
    });
  });

  describe("constant() with optional()", () => {
    // In object() context, `optional(constant())` preserves the constant
    // value, matching the standalone behaviour.  See
    // https://github.com/dahlia/optique/issues/233 for the original bug
    // report.  `withDefault()` composes analogously: the inner parser's
    // completed value wins over the configured default.
    it("should preserve constant value in object() context", () => {
      const parser = object({
        mode: optional(constant("default-mode" as const)),
        verbose: optional(option("-v")),
      });

      // Empty input: optional(constant(...)) should produce the constant
      // value, not undefined.  optional(option(...)) should still return
      // undefined because the inner option's parse() fails on empty input.
      const result1 = parse(parser, []);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.mode, "default-mode");
        assert.equal(result1.value.verbose, undefined);
      }

      // With verbose flag: the constant should still be preserved.
      const result2 = parse(parser, ["-v"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.mode, "default-mode");
        assert.equal(result2.value.verbose, true);
      }
    });

    it("should preserve constant value through withDefault() in object()", () => {
      const parser = object({
        mode: withDefault(
          constant("inner" as const),
          "fallback" as const,
        ),
      });

      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        // The inner constant produces a value, so withDefault must not
        // substitute its own fallback.
        assert.equal(result.value.mode, "inner");
      }
    });

    it("should return constant value when used standalone (not in object)", () => {
      // When used standalone with parse(), optional(constant()) works as expected
      const parser = optional(constant("fixed-value"));

      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "fixed-value");
      }
    });

    it("should handle map(optional(constant()))", () => {
      const parser = map(
        optional(constant(10)),
        (value) => value ?? 0,
      );

      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        // constant() succeeds, so we get 10, not 0
        assert.equal(result.value, 10);
      }
    });
  });

  describe("nested state management", () => {
    it("should handle optional(optional()) correctly", () => {
      const parser = optional(optional(option("-v")));

      // With -v
      const result1 = parse(parser, ["-v"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, true);
      }

      // Without -v - outer optional wraps inner optional's undefined
      const result2 = parse(parser, []);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, undefined);
      }
    });

    it("should handle multiple(optional())", () => {
      const parser = multiple(optional(option("-v")));

      // This creates an array of optional values
      const context = {
        buffer: ["-v"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.consumed, ["-v"]);
      }
    });

    it("should handle withDefault(withDefault())", () => {
      const inner = withDefault(option("-v"), false);
      const outer = withDefault(inner, false);

      // No input - should use outer default
      const result = parse(outer, []);
      assert.ok(result.success);
      if (result.success) {
        // Inner withDefault makes option return false when not present
        // Outer withDefault doesn't change that
        assert.equal(result.value, false);
      }
    });
  });

  // Regression tests for https://github.com/dahlia/optique/issues/233.
  // optional()/withDefault() must preserve values from parsers whose
  // useful result is produced during complete() (e.g. constant(),
  // bindEnv(), bindConfig() with fallbacks, or custom parsers that
  // succeed in parse() with consumed: [] and return a value in complete()).
  describe("complete-only inner parsers (issue #233)", () => {
    // A minimal custom parser that matches the "complete-only" shape
    // described in the issue: parse() always succeeds with no consumption,
    // leaving the initial state intact.  complete() unconditionally
    // returns a value.
    function completeOnly<T>(value: T): Parser<"sync", T, undefined> {
      return {
        $valueType: [] as readonly T[],
        $stateType: [] as readonly undefined[],
        $mode: "sync",
        priority: 0,
        usage: [],
        leadingNames: new Set<string>(),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          return { success: true, next: context, consumed: [] };
        },
        complete(_state) {
          return { success: true, value };
        },
        suggest(_context, _prefix) {
          return [];
        },
        getDocFragments(_state, _defaultValue?) {
          return { fragments: [] };
        },
      };
    }

    // Async counterpart of `completeOnly()`.  Using a real async parser
    // here ensures `parseAsync(optional(...))` and
    // `parseAsync(object({ x: withDefault(...) }))` actually exercise
    // `parseOptionalStyleAsync` / the async wrapper path, rather than
    // dispatching through the sync fast path for a sync inner parser.
    function asyncCompleteOnly<T>(
      value: T,
    ): Parser<"async", T, undefined> {
      return {
        $valueType: [] as readonly T[],
        $stateType: [] as readonly undefined[],
        $mode: "async",
        priority: 0,
        usage: [],
        leadingNames: new Set<string>(),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          return Promise.resolve({
            success: true as const,
            next: context,
            consumed: [] as readonly string[],
          });
        },
        complete(_state) {
          return Promise.resolve({ success: true as const, value });
        },
        suggest(_context, _prefix) {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<
              Suggestion
            > {
              yield* [];
            },
          };
        },
        getDocFragments(_state, _defaultValue?) {
          return { fragments: [] };
        },
      };
    }

    // A parser that reads its annotation-propagated state in both
    // `parse()` and `complete()`.  The value it returns is a function
    // of the annotation payload passed via `parse(..., { annotations })`,
    // so any regression that drops annotations on the way from
    // `deriveOptionalInnerParseState()` into the inner parser's
    // `parse()` or `complete()` turns into an assertion failure rather
    // than a silent pass.
    function annotationReader(
      marker: symbol,
    ): Parser<"sync", string, { readonly tag: string }> {
      const initial: { readonly tag: string } = { tag: "initial" };
      return {
        $valueType: [] as readonly string[],
        $stateType: [] as readonly { readonly tag: string }[],
        $mode: "sync",
        priority: 0,
        usage: [],
        leadingNames: new Set<string>(),
        acceptingAnyToken: false,
        initialState: initial,
        parse(context) {
          const annotations = getAnnotations(context.state);
          const tag = (annotations?.[marker] as string | undefined) ??
            "no-annotations-in-parse";
          return {
            success: true,
            next: { ...context, state: { tag } },
            consumed: [],
          };
        },
        complete(state) {
          const annotations = getAnnotations(state);
          const completeTag = (annotations?.[marker] as string | undefined) ??
            state.tag;
          return { success: true, value: completeTag };
        },
        suggest(_context, _prefix) {
          return [];
        },
        getDocFragments(_state, _defaultValue?) {
          return { fragments: [] };
        },
      };
    }

    it("optional(completeOnly) returns inner value standalone", () => {
      const parser = optional(completeOnly("ok"));
      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "ok");
      }
    });

    it("withDefault(completeOnly, fallback) prefers inner value", () => {
      const parser = withDefault(completeOnly("ok"), "fallback");
      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "ok");
      }
    });

    it("optional(completeOnly) with annotations returns inner value", () => {
      const annotation = Symbol.for("@test/issue-233-completeOnly");
      const parser = optional(completeOnly("ok"));
      const result = parse(parser, [], {
        annotations: { [annotation]: "present" },
      });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "ok");
      }
    });

    it("object({ x: optional(completeOnly) }) returns inner value", () => {
      const parser = object({ x: optional(completeOnly("ok")) });
      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.x, "ok");
      }
    });

    it("object({ x: withDefault(completeOnly, fb) }) returns inner value", () => {
      const parser = object({
        x: withDefault(completeOnly("ok"), "fallback"),
      });
      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.x, "ok");
      }
    });

    it("object sync: optional(constant) preserves value alongside flags", () => {
      const parser = object({
        mode: optional(constant("default-mode" as const)),
        verbose: optional(option("-v")),
      });
      const result = parse(parser, ["-v"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.mode, "default-mode");
        assert.equal(result.value.verbose, true);
      }
    });

    it("object sync: withDefault(constant, fallback) uses inner value", () => {
      const parser = object({
        x: withDefault(constant("inner" as const), "fallback" as const),
      });
      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.x, "inner");
      }
    });

    it("parseAsync: optional(completeOnly) standalone returns inner value", async () => {
      const parser = optional(completeOnly("ok"));
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "ok");
      }
    });

    it("parseAsync: object({ x: optional(completeOnly) }) returns inner value", async () => {
      const parser = object({ x: optional(completeOnly("ok")) });
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.x, "ok");
      }
    });

    it("parseAsync: object({ x: withDefault(constant) }) uses inner value", async () => {
      const parser = object({
        x: withDefault(constant("inner" as const), "fallback" as const),
      });
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.x, "inner");
      }
    });

    // Negative regression: the fix must NOT cause optional(option(...))
    // to return a value for a flag that wasn't provided.  The option's
    // parse() fails with consumed: 0 on empty input, so optional should
    // still return undefined.
    it("optional(option(string)) returns undefined when flag is absent", () => {
      const parser = optional(option("--foo", string()));
      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, undefined);
      }
    });

    it("optional(boolean option) returns undefined when flag is absent", () => {
      const parser = optional(option("-v"));
      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, undefined);
      }
    });

    it("withDefault(option) uses the configured default on absent input", () => {
      const parser = withDefault(option("--foo", string()), "d");
      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "d");
      }
    });

    it("object({ verbose: optional(option('-v')) }) preserves absent as undefined", () => {
      const parser = object({ verbose: optional(option("-v")) });
      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.verbose, undefined);
      }
    });

    // Annotation propagation tests that actually verify the annotation
    // reached the inner parser, not just that the wrapper did not throw.
    // If `deriveOptionalInnerParseState()` ever stops propagating
    // annotations from the outer wrapper state into the inner parser's
    // initial state, these assertions fail.
    it("optional(annotationReader) exposes the annotation value", () => {
      const marker = Symbol.for("@test/issue-233-annotation-propagation");
      const parser = optional(annotationReader(marker));
      const result = parse(parser, [], {
        annotations: { [marker]: "propagated" },
      });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "propagated");
      }
    });

    it("withDefault(annotationReader, fb) exposes the annotation value", () => {
      const marker = Symbol.for(
        "@test/issue-233-annotation-propagation-withDefault",
      );
      const parser = withDefault(annotationReader(marker), "fallback");
      const result = parse(parser, [], {
        annotations: { [marker]: "propagated" },
      });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "propagated");
      }
    });

    it("object({ x: optional(annotationReader) }) exposes the annotation", () => {
      const marker = Symbol.for("@test/issue-233-annotation-propagation-obj");
      const parser = object({ x: optional(annotationReader(marker)) });
      const result = parse(parser, [], {
        annotations: { [marker]: "propagated" },
      });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.x, "propagated");
      }
    });

    // Regression test for the review feedback on `deriveOptionalInnerParseState`:
    // when the inner parser's `initialState` is a non-plain class
    // instance (for example one that carries `#private` fields), the
    // annotation-propagation helper must NOT clone the instance via
    // `Object.create` + `getOwnPropertyDescriptors`, because that drops
    // the private fields and produces a broken state object.  Using
    // `inheritAnnotations()` returns non-plain instances unchanged, so
    // the inner parser still sees a usable state.
    it("optional(customParser) preserves class-based initialState under annotations", () => {
      class StateWithPrivate {
        #secret = "private-value";

        read(): string {
          return this.#secret;
        }
      }

      const parser: Parser<"sync", string, StateWithPrivate> = {
        $valueType: [] as readonly string[],
        $stateType: [] as readonly StateWithPrivate[],
        $mode: "sync",
        priority: 0,
        usage: [],
        leadingNames: new Set<string>(),
        acceptingAnyToken: false,
        initialState: new StateWithPrivate(),
        parse(context) {
          return { success: true, next: context, consumed: [] };
        },
        complete(state) {
          return { success: true, value: state.read() };
        },
        suggest(_context, _prefix) {
          return [];
        },
        getDocFragments(_state, _defaultValue?) {
          return { fragments: [] };
        },
      };

      const marker = Symbol.for("@test/issue-233-class-state");
      const optionalResult = parse(optional(parser), [], {
        annotations: { [marker]: "annotated" },
      });
      assert.ok(optionalResult.success);
      if (optionalResult.success) {
        assert.equal(optionalResult.value, "private-value");
      }

      const withDefaultResult = parse(
        withDefault(parser, "fallback"),
        [],
        { annotations: { [marker]: "annotated" } },
      );
      assert.ok(withDefaultResult.success);
      if (withDefaultResult.success) {
        assert.equal(withDefaultResult.value, "private-value");
      }
    });

    // Async coverage using a real `Parser<"async", ...>` inner parser.
    // The existing async tests above wrap a sync `completeOnly()`, which
    // dispatches through the sync fast path and does NOT exercise
    // `parseOptionalStyleAsync()`.  These tests do.
    it("parseAsync: optional(asyncCompleteOnly) standalone", async () => {
      const parser = optional(asyncCompleteOnly("ok"));
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "ok");
      }
    });

    it("parseAsync: withDefault(asyncCompleteOnly, fb) standalone", async () => {
      const parser = withDefault(asyncCompleteOnly("ok"), "fallback");
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "ok");
      }
    });

    it("parseAsync: object({ x: optional(asyncCompleteOnly) })", async () => {
      const parser = object({ x: optional(asyncCompleteOnly("ok")) });
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.x, "ok");
      }
    });

    it("parseAsync: object({ x: withDefault(asyncCompleteOnly, fb) })", async () => {
      const parser = object({
        x: withDefault(asyncCompleteOnly("ok"), "fallback"),
      });
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.x, "ok");
      }
    });

    it("parseAsync: optional(asyncCompleteOnly) with annotations", async () => {
      const marker = Symbol.for("@test/issue-233-async-annotations");
      const parser = optional(asyncCompleteOnly("ok"));
      const result = await parseAsync(parser, [], {
        annotations: { [marker]: "present" },
      });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "ok");
      }
    });

    // Regression test for the review feedback that
    // `deriveOptionalInnerParseState()` was wrapping primitive inner
    // initial states (e.g. `constant("v")` whose `initialState` IS
    // `"v"`) into an `injectAnnotations` wrapper object whenever the
    // outer context carried annotations.  Because echo-semantics
    // parsers like `constant()` return their state verbatim from
    // `complete()`, the wrapper leaked into the final value inside
    // `object({ ... })`, so a field declared as
    // `optional(constant("v"))` produced `{}` instead of `"v"`.  The
    // fix is to return the primitive initial state unchanged from
    // `deriveOptionalInnerParseState()` (nullish initial states still
    // go through `inheritAnnotations()` so source-binding wrappers
    // like `bindEnv()` / `bindConfig()` can still resolve from
    // annotations at parse-time).
    it("object({ x: optional(constant(...)) }) with annotations returns the primitive", () => {
      const marker = Symbol.for("@test/issue-233-primitive-constant");
      const parser = object({ mode: optional(constant("v" as const)) });
      const result = parse(parser, [], {
        annotations: { [marker]: "present" },
      });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.mode, "v");
      }
    });

    it("object({ x: withDefault(constant(...), fb) }) with annotations returns the inner primitive", () => {
      const marker = Symbol.for(
        "@test/issue-233-primitive-constant-withDefault",
      );
      const parser = object({
        mode: withDefault(constant("inner" as const), "fallback" as const),
      });
      const result = parse(parser, [], {
        annotations: { [marker]: "present" },
      });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.mode, "inner");
      }
    });

    it("optional(constant(...)) standalone with annotations returns the primitive", () => {
      const marker = Symbol.for("@test/issue-233-primitive-standalone");
      const parser = optional(constant("v" as const));
      const result = parse(parser, [], {
        annotations: { [marker]: "present" },
      });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "v");
      }
    });

    // Regression test for the review feedback that
    // `deriveOptionalInnerParseState()` was dropping outer-array
    // annotations on parse-time re-entry.  When `object()` commits a
    // child optional() state via `getAnnotatedChildState()`, the
    // committed value is an annotated array wrapping the inner state.
    // If `optional.parse()` is then re-invoked with that wrapped state
    // (e.g., during a subsequent greedy-loop iteration), the helper
    // must propagate the array's annotations back onto the inner
    // element so source-binding wrappers under the optional still see
    // them on the second pass.
    it("optional() re-entry with annotated array state propagates annotations to inner parse()", () => {
      const marker = Symbol.for("@test/issue-233-array-reentry");
      let lastSeenAnnotation: string | undefined;
      const inner: Parser<"sync", string, { readonly tag: string }> = {
        $valueType: [] as readonly string[],
        $stateType: [] as readonly { readonly tag: string }[],
        $mode: "sync",
        priority: 0,
        usage: [],
        leadingNames: new Set<string>(),
        acceptingAnyToken: false,
        initialState: { tag: "initial" },
        parse(context) {
          const annotations = getAnnotations(context.state);
          const tag = (annotations?.[marker] as string | undefined) ??
            "no-annotations";
          lastSeenAnnotation = tag;
          return {
            success: true,
            next: { ...context, state: { tag } },
            consumed: [],
          };
        },
        complete(state) {
          return { success: true, value: state.tag };
        },
        suggest(_context, _prefix) {
          return [];
        },
        getDocFragments(_state, _defaultValue?) {
          return { fragments: [] };
        },
      };
      const optionalParser = optional(inner);

      // First call: simulate the top-level annotated context that the
      // initial parse iteration sees.
      const annotatedInitial = injectAnnotations(
        optionalParser.initialState,
        { [marker]: "first" },
      ) as [{ readonly tag: string }] | undefined;
      const first = optionalParser.parse({
        buffer: [],
        state: annotatedInitial,
        optionsTerminated: false,
        usage: optionalParser.usage,
      });
      assert.ok(first.success);
      if (!first.success) return;
      assert.equal(lastSeenAnnotation, "first");

      // Build the exact shape `object()` would commit: an annotated
      // array wrapping the inner state from the previous parse, where
      // the annotations live on the array wrapper rather than the
      // inner element.
      const reentryState = injectAnnotations(first.next.state, {
        [marker]: "reentry",
      }) as [{ readonly tag: string }];

      // Second call: re-invoke parse() with the annotated array.  The
      // inner parser must see the re-entry annotation, not the original
      // tag baked into its state from the first call.
      lastSeenAnnotation = undefined;
      const second = optionalParser.parse({
        buffer: [],
        state: reentryState,
        optionsTerminated: false,
        usage: optionalParser.usage,
      });
      assert.ok(second.success);
      assert.equal(lastSeenAnnotation, "reentry");
    });
  });
});

describe("nonEmpty", () => {
  it("should create a parser with same priority as wrapped parser", () => {
    const baseParser = option("-v", "--verbose");
    const nonEmptyParser = nonEmpty(baseParser);

    assert.equal(nonEmptyParser.priority, baseParser.priority);
    assert.deepEqual(nonEmptyParser.initialState, baseParser.initialState);
  });

  it("should preserve wrapped parser mode", () => {
    const baseParser = option("-v", "--verbose");
    const nonEmptyParser = nonEmpty(baseParser);

    assert.equal(nonEmptyParser.$mode, baseParser.$mode);
  });

  it("should succeed when inner parser succeeds and consumes input", () => {
    const baseParser = option("-v", "--verbose");
    const nonEmptyParser = nonEmpty(baseParser);

    const context = {
      buffer: ["-v"] as readonly string[],
      state: nonEmptyParser.initialState,
      optionsTerminated: false,
      usage: nonEmptyParser.usage,
    };

    const parseResult = nonEmptyParser.parse(context);
    assert.ok(parseResult.success);
    if (parseResult.success) {
      assert.deepEqual(parseResult.consumed, ["-v"]);
      assert.deepEqual(parseResult.next.buffer, []);

      const completeResult = nonEmptyParser.complete(parseResult.next.state);
      assert.ok(completeResult.success);
      if (completeResult.success) {
        assert.equal(completeResult.value, true);
      }
    }
  });

  it("should fail when inner parser succeeds but consumes zero tokens", () => {
    const baseParser = constant("hello");
    const nonEmptyParser = nonEmpty(baseParser);

    const context = {
      buffer: [] as readonly string[],
      state: nonEmptyParser.initialState,
      optionsTerminated: false,
      usage: nonEmptyParser.usage,
    };

    const parseResult = nonEmptyParser.parse(context);
    assert.ok(!parseResult.success);
    if (!parseResult.success) {
      assertErrorIncludes(parseResult.error, "at least one token");
    }
  });

  it("should propagate inner parser failure", () => {
    const baseParser = option("-v", "--verbose");
    const nonEmptyParser = nonEmpty(baseParser);

    const context = {
      buffer: ["--other"] as readonly string[],
      state: nonEmptyParser.initialState,
      optionsTerminated: false,
      usage: nonEmptyParser.usage,
    };

    const parseResult = nonEmptyParser.parse(context);
    assert.ok(!parseResult.success);
  });

  it("should work with object parser that consumes input", () => {
    const parser = nonEmpty(object({
      verbose: option("-v", "--verbose"),
      debug: option("-d", "--debug"),
    }));

    const result = parse(parser, ["-v"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.debug, false);
    }
  });

  it("should fail with object parser that consumes no input", () => {
    const parser = nonEmpty(object({
      verbose: option("-v", "--verbose"),
      debug: option("-d", "--debug"),
    }));

    const result = parse(parser, []);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "at least one token");
    }
  });

  it("should work with longestMatch() for conditional defaults", () => {
    // This is the main use case from issue #79
    const activeParser = nonEmpty(object({
      mode: constant("active" as const),
      cwd: withDefault(option("--cwd", string()), "./default"),
      key: optional(option("--key", string())),
    }));

    const helpParser = object({
      mode: constant("help" as const),
    });

    const parser = longestMatch(activeParser, helpParser);

    // No options provided - helpParser wins because activeParser fails (zero consumption)
    const helpResult = parse(parser, []);
    assert.ok(helpResult.success);
    if (helpResult.success) {
      assert.equal(helpResult.value.mode, "help");
    }

    // With --key option - activeParser wins and applies defaults
    const activeResult = parse(parser, ["--key", "mykey"]);
    assert.ok(activeResult.success);
    if (activeResult.success) {
      assert.equal(activeResult.value.mode, "active");
      assert.equal(activeResult.value.cwd, "./default");
      assert.equal(activeResult.value.key, "mykey");
    }

    // With --cwd option - activeParser wins
    const cwdResult = parse(parser, ["--cwd", "./custom"]);
    assert.ok(cwdResult.success);
    if (cwdResult.success) {
      assert.equal(cwdResult.value.mode, "active");
      assert.equal(cwdResult.value.cwd, "./custom");
    }
  });

  it("should delegate complete() to inner parser", () => {
    const baseParser = option("-n", "--name", string());
    const nonEmptyParser = nonEmpty(baseParser);

    const state = { success: true as const, value: "Alice" };
    const result = nonEmptyParser.complete(state);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "Alice");
    }
  });

  it("should delegate suggest() to inner parser", () => {
    const baseParser = option("-f", "--format", choice(["json", "yaml"]));
    const nonEmptyParser = nonEmpty(baseParser);

    const context = {
      buffer: ["--format"] as readonly string[],
      state: nonEmptyParser.initialState,
      optionsTerminated: false,
      usage: nonEmptyParser.usage,
    };

    const suggestions = [...nonEmptyParser.suggest(context, "")];
    assert.ok(suggestions.length > 0);
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "json"),
    );
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "yaml"),
    );
  });

  it("should delegate getDocFragments() to inner parser", () => {
    const description = message`Enable verbose output`;
    const baseParser = option("-v", "--verbose", { description });
    const nonEmptyParser = nonEmpty(baseParser);

    const fragments = nonEmptyParser.getDocFragments({ kind: "unavailable" });
    const baseFragments = baseParser.getDocFragments({ kind: "unavailable" });

    assert.deepEqual(fragments, baseFragments);
  });

  it("should preserve usage from inner parser", () => {
    const baseParser = option("-v", "--verbose");
    const nonEmptyParser = nonEmpty(baseParser);

    assert.deepEqual(nonEmptyParser.usage, baseParser.usage);
  });

  it("should work with withDefault wrapper", () => {
    const parser = nonEmpty(object({
      verbose: option("-v", "--verbose"),
      port: withDefault(option("-p", "--port", integer()), 8080),
    }));

    // Providing at least one option makes it succeed
    const result = parse(parser, ["-v"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.port, 8080);
    }
  });

  it("should work with multiple modifier", () => {
    // When wrapped in object(), multiple() without { min: 1 } succeeds
    // with empty array when no args are provided (zero tokens consumed).
    // nonEmpty() turns that into a failure.
    const parser = nonEmpty(object({
      files: multiple(argument(string())),
    }));

    const result = parse(parser, ["file1.txt", "file2.txt"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value.files, ["file1.txt", "file2.txt"]);
    }

    // No arguments - object({ files: multiple(...) }) succeeds with { files: [] }
    // but consumes zero tokens, so nonEmpty() fails
    const emptyResult = parse(parser, []);
    assert.ok(!emptyResult.success);
    if (!emptyResult.success) {
      assertErrorIncludes(emptyResult.error, "at least one token");
    }
  });

  it("should parse successfully with async wrapped parser", async () => {
    const parser = nonEmpty(
      withDefault(
        option("--format", asyncChoice(["json", "yaml"] as const)),
        "json" as const,
      ),
    );

    const parseResult = await parser.parse({
      buffer: ["--format", "json"] as const,
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parseResult.success);
    if (!parseResult.success) {
      return;
    }

    const completeResult = await parser.complete(parseResult.next.state);
    assert.ok(completeResult.success);
    if (completeResult.success) {
      assert.equal(completeResult.value, "json");
    }
  });

  it("should fail in async mode when inner parser consumes no input", async () => {
    const parser = nonEmpty(
      withDefault(
        option("--format", asyncChoice(["json", "yaml"] as const)),
        "json" as const,
      ),
    );

    const parseResult = await parser.parse({
      buffer: [] as const,
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });

    assert.ok(!parseResult.success);
    if (!parseResult.success) {
      assertErrorIncludes(parseResult.error, "at least one token");
    }
  });
});

describe("branch coverage: modifiers edge cases", () => {
  // Line 710: withDefault getDocFragments with options.message and a non-entry
  // fragment (section) — the else branch that returns the fragment unchanged.
  it("withDefault: options.message skips non-entry fragments", () => {
    // object() returns section fragments; wrap it in withDefault with message
    const inner = object({ x: option("--x", string()) });
    const parser = withDefault(inner, { x: "default" }, {
      message: message`custom`,
    });
    const fragments = parser.getDocFragments(
      { kind: "unavailable" },
      undefined,
    );
    // Should return fragments without error (section fragments pass through)
    assert.ok(Array.isArray(fragments.fragments));
  });

  // Line 935: async multiple() parse — "not added" (update existing state).
  // This branch fires when added=false and parse succeeds, so we keep
  // context.state.slice(0, -1) instead of the full context.state.
  it("multiple: async parser updates existing state (slice branch)", async () => {
    const parser = multiple(
      option("--tag", asyncChoice(["a", "b", "c"] as const)),
    );

    // Parse first --tag to populate state
    const ctx1 = {
      buffer: ["--tag", "a"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };
    const r1 = await parser.parse(ctx1);
    assert.ok(r1.success);

    // Parse second --tag while state already has one item.
    // added starts as false (state.length >= 1), and parse succeeds
    // so we go to the slice branch (added=false).
    const ctx2 = {
      buffer: ["--tag", "b"],
      state: r1.success ? r1.next.state : parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };
    const r2 = await parser.parse(ctx2);
    assert.ok(r2.success);
    if (r2.success) {
      // Two items should be in state now
      assert.equal((r2.next.state as readonly unknown[]).length, 2);
    }
  });

  // Line 982: async multiple() complete — inner complete() failure.
  it("multiple: async complete fails when inner completion fails", async () => {
    const inner: Parser<"async", string, string> = {
      $mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: true,
      initialState: "",
      parse(context) {
        if (context.buffer.length === 0) {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`No parse.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: context.buffer[0],
          },
          consumed: [context.buffer[0]],
        });
      },
      complete(state: string): Promise<ValueParserResult<string>> {
        return Promise.resolve(
          state === "bad"
            ? {
              success: false as const,
              error: message`Async complete failure.`,
            }
            : { success: true as const, value: state },
        );
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const failComplete = multiple(inner);

    const result = await failComplete.complete(["ok", "bad"]);
    assert.ok(!result.success);
    if (!result.success) {
      assert.deepEqual(result.error, message`Async complete failure.`);
    }
  });

  it("multiple: async complete preserves later source registration order", async () => {
    const sourceId = Symbol("mode");
    const gates = new Map<
      string,
      { readonly promise: Promise<void>; readonly resolve: () => void }
    >();
    for (const state of ["slow", "fast"] as const) {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      gates.set(state, { promise, resolve });
    }
    const started: string[] = [];
    const child: Parser<"async", string, string> = {
      $mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [] as const,
        });
      },
      async complete(state, exec) {
        started.push(state);
        await gates.get(state)?.promise;
        exec?.dependencyRuntime?.registerSource(sourceId, state, "cli");
        return { success: true as const, value: `item-${state}` };
      },
      async *suggest() {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = multiple(child);
    const runtime = createDependencyRuntimeContext();

    const pending = parser.complete(
      ["slow", "fast"],
      {
        usage: parser.usage,
        phase: "complete",
        path: ["root"],
        dependencyRuntime: runtime,
        dependencyRegistry: runtime.registry,
      },
    );

    assert.deepEqual(started, ["slow"]);
    gates.get("slow")?.resolve();
    await waitForStartedCount(
      started,
      2,
      "multiple() async completion did not start the second item.",
    );
    assert.deepEqual(started, ["slow", "fast"]);
    gates.get("fast")?.resolve();

    const result = await pending;
    assert.ok(result.success);
    assert.equal(runtime.getSource(sourceId), "fast");
  });

  it("multiple: async suggest preserves later source registration order", async () => {
    const sourceId = Symbol("mode");
    const gates = new Map<
      string,
      { readonly promise: Promise<void>; readonly resolve: () => void }
    >();
    for (const state of ["slow", "fast"] as const) {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      gates.set(state, { promise, resolve });
    }
    const started: string[] = [];
    const child: Parser<"async", string, string> = {
      $mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [] as const,
        });
      },
      async complete(state, exec) {
        started.push(state);
        await gates.get(state)?.promise;
        exec?.dependencyRuntime?.registerSource(sourceId, state, "cli");
        return { success: true as const, value: `item-${state}` };
      },
      async *suggest(context) {
        yield {
          kind: "literal" as const,
          text: `latest-${
            String(
              context.exec?.dependencyRuntime?.getSource(sourceId),
            )
          }`,
        };
      },
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = multiple(child);
    const runtime = createDependencyRuntimeContext();

    const suggestionsPromise = (async () => {
      const suggestions: Suggestion[] = [];
      for await (
        const suggestion of parser.suggest({
          buffer: [],
          state: ["slow", "fast"],
          optionsTerminated: false,
          usage: parser.usage,
          dependencyRegistry: runtime.registry,
          exec: {
            usage: parser.usage,
            phase: "suggest",
            path: ["root"],
            dependencyRuntime: runtime,
            dependencyRegistry: runtime.registry,
          },
        }, "")
      ) {
        suggestions.push(suggestion);
      }
      return suggestions;
    })();

    assert.deepEqual(started, ["slow"]);
    gates.get("slow")?.resolve();
    await waitForStartedCount(
      started,
      2,
      "multiple() async suggest did not start the second item.",
    );
    assert.deepEqual(started, ["slow", "fast"]);
    gates.get("fast")?.resolve();

    const suggestions = await suggestionsPromise;
    assert.deepEqual(suggestions, [{ kind: "literal", text: "latest-fast" }]);
  });

  // Line 1012: multiple() suggest — shouldInclude returns true for non-literal
  // suggestion kind (e.g., "file" or "directory" kinds pass through always).
  function coerceRuntimeSuggestState<TState>(state: unknown): TState {
    // @ts-expect-error: intentionally exercise runtime-only state shapes.
    return state;
  }

  it("multiple: suggest passes through non-literal suggestions", () => {
    const fileValueParser: ValueParser<"sync", string> = {
      $mode: "sync",
      metavar: "FILE",
      placeholder: "",
      parse(input: string): { success: true; value: string } {
        return { success: true, value: input };
      },
      format(v: string): string {
        return v;
      },
      *suggest(_prefix: string): Iterable<Suggestion> {
        yield { kind: "file", type: "any", pattern: "*.txt" };
      },
    };

    const parser = multiple(argument(fileValueParser));
    const ctx = {
      buffer: [],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };
    const suggestions = [
      ...(parser.suggest(ctx, "") as Iterable<Suggestion>),
    ];
    // The file-kind suggestion should pass through shouldInclude (returns true)
    assert.ok(suggestions.some((s) => s.kind === "file"));
  });

  it("multiple: suggest does not open a new slot after reaching max", () => {
    const parser = multiple(argument(choice(["one", "two"] as const)), {
      max: 1,
    });
    const parsed = parser.parse({
      buffer: ["one"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parsed.success);
    if (!parsed.success) return;

    const suggestions = [
      ...parser.suggest(parsed.next, "") as Iterable<Suggestion>,
    ];

    assert.deepEqual(suggestions, []);
  });

  it("multiple: sync parse stops consuming after reaching max", () => {
    const parser = multiple(argument(string()), { max: 1 });
    const first = parser.parse({
      buffer: ["a"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(first.success);
    if (!first.success) return;

    const second = parser.parse({
      buffer: ["b"],
      state: first.next.state,
      optionsTerminated: false,
      usage: parser.usage,
    });

    assert.ok(second.success);
    if (!second.success) return;

    assert.deepEqual(second.consumed, []);
    assert.equal(second.next.buffer[0], "b");
    assert.deepEqual(second.next.state, first.next.state);
  });

  it("multiple: async parse stops consuming after reaching max", async () => {
    const parser = multiple(argument(asyncChoice(["a", "b"] as const)), {
      max: 1,
    });
    const first = await parser.parse({
      buffer: ["a"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(first.success);
    if (!first.success) return;

    const second = await parser.parse({
      buffer: ["b"],
      state: first.next.state,
      optionsTerminated: false,
      usage: parser.usage,
    });

    assert.ok(second.success);
    if (!second.success) return;

    assert.deepEqual(second.consumed, []);
    assert.equal(second.next.buffer[0], "b");
    assert.deepEqual(second.next.state, first.next.state);
  });

  it("multiple: zero-consumption fresh object state does not add a slot", () => {
    const inner: Parser<
      "sync",
      "idle",
      { readonly kind: "idle" }
    > = {
      $mode: "sync" as const,
      $valueType: [] as readonly "idle"[],
      $stateType: [] as readonly { readonly kind: "idle" }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { kind: "idle" as const },
      parse(context) {
        return {
          success: true as const,
          next: context,
          consumed: [],
        };
      },
      complete: (state) => ({ success: true as const, value: state.kind }),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = multiple(inner);

    const result = parser.parse({
      buffer: [],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });

    assert.ok(result.success);
    if (!result.success) return;
    assert.deepEqual(result.next.state, []);
  });

  // Line 155/442: async optional/withDefault suggestAsync — state is undefined
  // (not an array), so the else branch uses syncParser.initialState.
  it("optional: async suggest with undefined state uses initialState", async () => {
    const asyncOpt = optional(
      option("--mode", asyncChoice(["fast", "slow"] as const)),
    );
    // State undefined means inner state is not yet set; cast bypasses generic
    // complexity since the runtime branch under test only checks Array.isArray.
    const ctx = {
      buffer: [] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: asyncOpt.usage,
    } as Parameters<typeof asyncOpt.suggest>[0];
    const suggestions = await collectSuggestions(
      asyncOpt.suggest(ctx, "--") as AsyncIterable<Suggestion>,
    );
    // Should get suggestions from the inner parser with its initialState
    assert.ok(Array.isArray(suggestions));
  });

  it("withDefault: async suggest with undefined state uses initialState", async () => {
    const asyncWd = withDefault(
      option("--mode", asyncChoice(["fast", "slow"] as const)),
      "fast" as const,
    );
    const ctx = {
      buffer: [] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: asyncWd.usage,
    } as Parameters<typeof asyncWd.suggest>[0];
    const suggestions = await collectSuggestions(
      asyncWd.suggest(ctx, "--") as AsyncIterable<Suggestion>,
    );
    assert.ok(Array.isArray(suggestions));
  });

  it("optional: suggest uses direct object state when present", () => {
    const inner = {
      $mode: "sync" as const,
      $valueType: [] as readonly ("initial" | "live")[],
      $stateType: [] as readonly { readonly value: "initial" | "live" }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: "initial" as const },
      parse: () => ({
        success: false as const,
        consumed: 0,
        error: message`No parse.`,
      }),
      complete: (state: { readonly value: "initial" | "live" }) => ({
        success: true as const,
        value: state.value,
      }),
      *suggest(context: ParserContext<{ readonly value: "initial" | "live" }>) {
        yield { kind: "literal" as const, text: context.state.value };
      },
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<
      "sync",
      "initial" | "live",
      { readonly value: "initial" | "live" }
    >;
    const parser = optional(inner);

    const suggestContext: Parameters<typeof parser.suggest>[0] = {
      buffer: [],
      state: coerceRuntimeSuggestState({ value: "live" }),
      optionsTerminated: false,
      usage: parser.usage,
    };
    const suggestions = [...parser.suggest(suggestContext, "")];

    assert.deepEqual(suggestions, [{ kind: "literal", text: "live" }]);
  });

  it("withDefault: suggest uses direct object state when present", () => {
    const inner = {
      $mode: "sync" as const,
      $valueType: [] as readonly ("initial" | "live")[],
      $stateType: [] as readonly { readonly value: "initial" | "live" }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: "initial" as const },
      parse: () => ({
        success: false as const,
        consumed: 0,
        error: message`No parse.`,
      }),
      complete: (state: { readonly value: "initial" | "live" }) => ({
        success: true as const,
        value: state.value,
      }),
      *suggest(context: ParserContext<{ readonly value: "initial" | "live" }>) {
        yield { kind: "literal" as const, text: context.state.value };
      },
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<
      "sync",
      "initial" | "live",
      { readonly value: "initial" | "live" }
    >;
    const parser = withDefault(inner, "initial" as const);

    const suggestContext: Parameters<typeof parser.suggest>[0] = {
      buffer: [],
      state: coerceRuntimeSuggestState({ value: "live" }),
      optionsTerminated: false,
      usage: parser.usage,
    };
    const suggestions = [...parser.suggest(suggestContext, "")];

    assert.deepEqual(suggestions, [{ kind: "literal", text: "live" }]);
  });

  it("withDefault: transformed async parser returns plain fallback result", async () => {
    const depId = Symbol("dep");
    const transformedAsyncParser = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [transformsDependencyValueMarker]: true as const,
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No match.`,
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "inner" },
            depId,
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = withDefault(
      transformedAsyncParser as unknown as ReturnType<typeof option>,
      "fallback",
    );

    const result = await parser.complete(undefined);
    assert.deepEqual(result, { success: true, value: "fallback" });
  });

  it("withDefault: transformed async parser without dependency returns default", async () => {
    const transformedAsyncParser = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [transformsDependencyValueMarker]: true as const,
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No match.`,
        }),
      complete: () =>
        Promise.resolve({ success: true as const, value: "inner" }),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = withDefault(
      transformedAsyncParser as unknown as ReturnType<typeof option>,
      () => "fallback",
    );

    const result = await parser.complete(undefined);
    assert.deepEqual(result, { success: true, value: "fallback" });
  });

  it("withDefault: wrapped dependency source uses plain fallback value", () => {
    const pending = createPendingDependencySourceState(Symbol("wrapped-dep"));
    const wrappedParser = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [wrappedDependencySourceMarker]: pending,
      parse: () => ({
        success: false as const,
        consumed: 0,
        error: message`No match.`,
      }),
      complete: () => ({ success: true as const, value: "inner" }),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = withDefault(
      wrappedParser as unknown as ReturnType<typeof option>,
      "fallback",
    );

    const result = parser.complete(undefined);
    assert.deepEqual(result, { success: true, value: "fallback" });
  });

  it("withDefault: defined async transform state delegates to inner parser", async () => {
    const depId = Symbol("pending-dep");
    const transformedAsyncParser = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [transformsDependencyValueMarker]: true as const,
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No match.`,
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "inner" },
            depId,
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = withDefault(
      transformedAsyncParser as unknown as ReturnType<typeof option>,
      "fallback",
    );
    const result = await parser.complete([undefined] as unknown as [undefined]);
    assert.ok(isDependencySourceState(result));
    if (!isDependencySourceState(result)) return;
    assert.ok(result.result.success);
    if (result.result.success) {
      assert.equal(result.result.value, "inner");
    }
  });

  it("withDefault: sync parser returns plain fallback for missing value", () => {
    const baseParser = option("--name", string());
    const parser = withDefault(baseParser, "fallback");

    const result = parser.complete(undefined);
    assert.deepEqual(result, { success: true, value: "fallback" });
  });

  it("optional: wrapped async dependency complete returns undefined when missing", async () => {
    const depId = Symbol("opt-async-dep");
    const pending = createPendingDependencySourceState(depId);
    const asyncWrapped = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [wrappedDependencySourceMarker]: pending,
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No match.`,
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "inner" },
            depId,
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, undefined>;

    const parser = optional(asyncWrapped);
    const result = await parser.complete(undefined);
    assert.deepEqual(result, { success: true, value: undefined });
  });

  it("optional: async wrapped dependency pending state delegates inner parser", async () => {
    const depId = Symbol("opt-async-pending");
    const pending = createPendingDependencySourceState(depId);
    const asyncWrapped = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [wrappedDependencySourceMarker]: pending,
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No match.`,
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "inner" },
            depId,
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, undefined>;

    const parser = optional(asyncWrapped);
    const result = await parser.complete([pending] as unknown as [undefined]);
    assert.ok(isDependencySourceState(result));
  });

  it("optional: async suggest with wrapped state uses inner state", async () => {
    const asyncOpt = optional(
      option("--mode", asyncChoice(["fast", "slow"] as const)),
    );
    const parsed = await asyncOpt.parse({
      buffer: ["--mode", "fast"],
      state: asyncOpt.initialState,
      optionsTerminated: false,
      usage: asyncOpt.usage,
    });
    assert.ok(parsed.success);
    if (!parsed.success) return;

    const suggestions = await collectSuggestions(
      asyncOpt.suggest(
        {
          buffer: [],
          state: parsed.next.state,
          optionsTerminated: false,
          usage: asyncOpt.usage,
        },
        "--m",
      ) as AsyncIterable<Suggestion>,
    );
    assert.ok(Array.isArray(suggestions));
  });

  it("withDefault: transformed dependency path reports default callback errors", async () => {
    const depId = Symbol("wd-transform-dep");
    const transformedAsyncParser = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [transformsDependencyValueMarker]: true as const,
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No match.`,
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "inner" },
            depId,
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, undefined>;
    const parser = withDefault(
      transformedAsyncParser,
      () => {
        throw new WithDefaultError(message`callback failed`);
      },
    );

    const result = await parser.complete(undefined);
    assert.ok(!result.success);
  });

  it("withDefault: wrapped dependency source reports default callback errors", () => {
    const pending = createPendingDependencySourceState(Symbol("wrapped-fail"));
    const wrappedParser = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [wrappedDependencySourceMarker]: pending,
      parse: () => ({
        success: false as const,
        consumed: 0,
        error: message`No match.`,
      }),
      complete: () => ({ success: true as const, value: "inner" }),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, undefined>;
    const parser = withDefault(
      wrappedParser,
      () => {
        throw new Error("wrapped default failed");
      },
    );

    const result = parser.complete(undefined);
    assert.ok(!result.success);
  });

  it("withDefault: transformed pending dependency path handles callback errors", async () => {
    const depId = Symbol("pending-transform-fail");
    const transformedAsyncParser = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [transformsDependencyValueMarker]: true as const,
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No match.`,
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "inner" },
            depId,
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, undefined>;
    const parser = withDefault(
      transformedAsyncParser,
      () => {
        throw new Error("pending transform failed");
      },
    );

    const pending = createPendingDependencySourceState(depId);
    const result = await parser.complete([pending] as unknown as [undefined]);
    assert.ok(!result.success);
  });

  it("withDefault: plain missing path handles callback errors", () => {
    const baseParser = option("--name", string());
    const parser = withDefault(
      baseParser,
      () => {
        throw new Error("pending callback failed");
      },
    );

    const result = parser.complete(undefined);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "pending callback failed");
    }
  });

  it("multiple: async parse updates existing slot without appending", async () => {
    const inner = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: 0,
      parse(context: {
        readonly buffer: readonly string[];
        readonly state: number;
        readonly optionsTerminated: boolean;
        readonly usage: readonly unknown[];
      }) {
        const token = context.buffer[0];
        if (token == null) {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`No token.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: context.state + 1,
          },
          consumed: [token],
        });
      },
      complete: (state: number) =>
        Promise.resolve({ success: true as const, value: String(state) }),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, number>;
    const parser = multiple(inner);

    const first = await parser.parse({
      buffer: ["a"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(first.success);
    if (!first.success) return;

    const second = await parser.parse({
      buffer: ["b"],
      state: first.next.state,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(second.success);
    if (second.success) {
      assert.deepEqual(second.next.state, [2]);
    }
  });

  it("multiple: async complete returns first failure from inner parser", async () => {
    const inner = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No parse.`,
        }),
      complete: (state: string) =>
        Promise.resolve(
          state === "bad"
            ? { success: false as const, error: message`bad state` }
            : { success: true as const, value: state },
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, string>;
    const parser = multiple(inner);

    const result = await parser.complete(["ok", "bad"]);
    assert.ok(!result.success);
  });

  it("multiple: complete retries unwrapped injected states after failure", () => {
    const seenStates: string[] = [];
    const inner = {
      $mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: "",
      parse: () => ({
        success: false as const,
        consumed: 0,
        error: message`No parse.`,
      }),
      complete(state: unknown) {
        seenStates.push(typeof state === "string" ? state : "wrapped");
        if (typeof state !== "string") {
          return { success: false as const, error: message`wrapped state` };
        }
        return { success: true as const, value: state };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"sync", string, string>;
    const parser = multiple(inner);
    const wrappedState = injectAnnotations("alpha", {
      [Symbol("annotation")]: true,
    });

    const result = parser.complete([wrappedState]);

    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["alpha"]);
    }
    assert.deepEqual(seenStates, ["wrapped", "alpha"]);
  });

  it("multiple: async suggest derives selected values with child exec paths", async () => {
    const seenPaths: PropertyKey[][] = [];
    const inner = {
      $mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: "",
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No parse.`,
        }),
      complete(
        _state: string,
        exec?: { readonly path: readonly PropertyKey[] },
      ) {
        const path = [...(exec?.path ?? ["root"])];
        seenPaths.push(path);
        const pathText = path.map(String).join("/");
        return Promise.resolve({
          success: true as const,
          value: `item-${pathText}`,
        });
      },
      async *suggest() {
        yield { kind: "literal" as const, text: "item-root/0" };
        yield { kind: "literal" as const, text: "item-root/1" };
      },
      getDocFragments() {
        return { fragments: [] };
      },
    } as const satisfies Parser<"async", string, string>;
    const parser = multiple(inner);

    const suggestions = await collectSuggestions(
      parser.suggest(
        {
          buffer: [],
          state: ["first", "second"],
          optionsTerminated: false,
          usage: parser.usage,
          exec: {
            usage: parser.usage,
            phase: "suggest",
            path: ["root"],
          },
        },
        "",
      ) as AsyncIterable<Suggestion>,
    );

    assert.deepEqual(suggestions, []);
    assert.deepEqual(seenPaths, [["root", 0], ["root", 1]]);
  });

  it("optional: getSuggestRuntimeNodes preserves outer annotations", () => {
    const annotations = { [Symbol("annotation")]: true };
    let seenState: unknown;
    const inner = {
      $mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly unknown[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: { kind: "initial" as const },
      getSuggestRuntimeNodes(state: unknown) {
        seenState = state;
        return [];
      },
      parse: () => ({
        success: false as const,
        consumed: 0,
        error: message`No parse.`,
      }),
      complete: () => ({ success: true as const, value: "ok" }),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"sync", string, unknown>;
    const parser = optional(inner);
    const state = injectAnnotations([{ kind: "value" as const }], annotations);

    parser.getSuggestRuntimeNodes?.(state as [unknown], ["root"]);

    assert.ok(seenState != null && typeof seenState === "object");
    assert.deepEqual(getAnnotations(seenState), annotations);
    assert.equal((seenState as { readonly kind: "value" }).kind, "value");
  });

  it("withDefault: getSuggestRuntimeNodes preserves object wrapper state", () => {
    const annotations = { [Symbol("annotation")]: true };
    const wrappedState = injectAnnotations(undefined, annotations);
    let seenState: unknown;
    const inner = {
      $mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly unknown[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: "initial",
      getSuggestRuntimeNodes(state: unknown) {
        seenState = state;
        return [];
      },
      parse: () => ({
        success: false as const,
        consumed: 0,
        error: message`No parse.`,
      }),
      complete: () => ({ success: true as const, value: "ok" }),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"sync", string, unknown>;
    const parser = withDefault(inner, "fallback");

    parser.getSuggestRuntimeNodes?.(
      wrappedState as unknown as [unknown] | undefined,
      ["root"],
    );

    assert.equal(seenState, wrappedState);
    assert.deepEqual(getAnnotations(seenState), annotations);
  });

  it("withDefault: transformed complete(undefined) catches callback errors", async () => {
    const depId = Symbol("wd-catch-undefined");
    const transformedAsyncParser = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [transformsDependencyValueMarker]: true as const,
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No match.`,
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "inner" },
            depId,
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, undefined>;

    const parser = withDefault(
      transformedAsyncParser,
      () => {
        throw new Error("default callback exploded");
      },
    );
    const result = await parser.complete(undefined);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        formatMessage(result.error).includes("default callback exploded"),
      );
    }
  });

  it("withDefault: transformed missing complete catches callback errors", async () => {
    const transformedAsyncParser = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [transformsDependencyValueMarker]: true as const,
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No match.`,
        }),
      complete: () =>
        Promise.resolve({
          success: true as const,
          value: "inner",
        }),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, undefined>;

    const parser = withDefault(
      transformedAsyncParser,
      () => {
        throw new Error("pending default callback exploded");
      },
    );
    const result = await parser.complete(undefined);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        formatMessage(result.error).includes(
          "pending default callback exploded",
        ),
      );
    }
  });

  it("withDefault: wrapped dependency path catches callback errors", () => {
    const pending = createPendingDependencySourceState(Symbol("wrapped-catch"));
    const wrappedParser = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      [wrappedDependencySourceMarker]: pending,
      parse: () => ({
        success: false as const,
        consumed: 0,
        error: message`No match.`,
      }),
      complete: () => ({ success: true as const, value: "inner" }),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, undefined>;

    const parser = withDefault(
      wrappedParser,
      () => {
        throw new Error("wrapped callback exploded");
      },
    );
    const result = parser.complete(undefined);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        formatMessage(result.error).includes("wrapped callback exploded"),
      );
    }
  });
});

describe("shouldDeferCompletion forwarding", () => {
  // Helper: create a sync parser with shouldDeferCompletion that records
  // received state and returns a configurable value.
  function createDeferrableParser(
    deferResult: boolean | ((state: unknown) => boolean),
  ) {
    const receivedStates: unknown[] = [];
    const base = option("--val", string());
    const parser = {
      ...base,
      receivedStates,
      shouldDeferCompletion(
        state: ValueParserResult<string> | undefined,
      ): boolean {
        receivedStates.push(state);
        return typeof deferResult === "function"
          ? deferResult(state)
          : deferResult;
      },
    };
    return parser;
  }

  describe("optional() shouldDeferCompletion", () => {
    it("should unwrap outer state before delegating to inner hook", () => {
      const inner = createDeferrableParser(true);
      const outer = optional(inner);

      assert.ok(typeof outer.shouldDeferCompletion === "function");
      const innerState: ValueParserResult<string> = {
        success: true,
        value: "hello",
      };
      // Outer state shape is [TState] | undefined
      outer.shouldDeferCompletion!([innerState]);

      // Inner hook should receive the unwrapped inner state, not the array
      assert.equal(inner.receivedStates.length, 1);
      assert.deepEqual(inner.receivedStates[0], innerState);
    });

    it("should propagate annotations from outer array to inner state", () => {
      const inner = createDeferrableParser(true);
      const outer = optional(inner);

      const innerState: ValueParserResult<string> = {
        success: true,
        value: "hello",
      };
      const testCtxKey = Symbol.for("@test/optional-defer-ctx");
      const annotations = { [testCtxKey]: "phase1" };
      const annotatedOuter = injectAnnotations(
        [innerState] as [ValueParserResult<string>],
        annotations,
      );
      outer.shouldDeferCompletion!(annotatedOuter);

      assert.equal(inner.receivedStates.length, 1);
      const received = inner.receivedStates[0];
      assert.ok(received != null && typeof received === "object");
      assert.deepEqual(
        getAnnotations(received as Record<PropertyKey, unknown>),
        annotations,
      );
    });

    it("should return false when outer state is undefined", () => {
      const inner = createDeferrableParser(true);
      const outer = optional(inner);

      const result = outer.shouldDeferCompletion!(undefined);
      assert.ok(!result);
      // Inner hook should NOT have been called
      assert.equal(inner.receivedStates.length, 0);
    });

    it("should propagate inner hook's return value", () => {
      const inner = createDeferrableParser(false);
      const outer = optional(inner);

      const innerState: ValueParserResult<string> = {
        success: true,
        value: "test",
      };
      const result = outer.shouldDeferCompletion!([innerState]);
      assert.ok(!result);
    });

    it("should delegate non-array objects to inner hook", () => {
      const inner = createDeferrableParser(true);
      const outer = optional(inner);

      // When called with a non-array object (e.g., PromptBindState),
      // the hook should delegate directly to the inner hook.
      const otherState = { someKey: "value" };
      const result = outer.shouldDeferCompletion!(
        otherState as unknown as
          | [ValueParserResult<string> | undefined]
          | undefined,
      );
      assert.ok(result);
      assert.equal(inner.receivedStates.length, 1);
      assert.deepEqual(inner.receivedStates[0], otherState);
    });
  });

  describe("withDefault() shouldDeferCompletion", () => {
    it("should unwrap outer state before delegating to inner hook", () => {
      const inner = createDeferrableParser(true);
      const outer = withDefault(inner, "fallback");

      assert.ok(typeof outer.shouldDeferCompletion === "function");
      const innerState: ValueParserResult<string> = {
        success: true,
        value: "hello",
      };
      outer.shouldDeferCompletion!([innerState]);

      assert.equal(inner.receivedStates.length, 1);
      assert.deepEqual(inner.receivedStates[0], innerState);
    });

    it("should propagate annotations from outer array to inner state", () => {
      const inner = createDeferrableParser(true);
      const outer = withDefault(inner, "fallback");

      const innerState: ValueParserResult<string> = {
        success: true,
        value: "hello",
      };
      const testCtxKey = Symbol.for("@test/withDefault-defer-ctx");
      const annotations = { [testCtxKey]: "phase1" };
      const annotatedOuter = injectAnnotations(
        [innerState] as [ValueParserResult<string>],
        annotations,
      );
      outer.shouldDeferCompletion!(annotatedOuter);

      assert.equal(inner.receivedStates.length, 1);
      const received = inner.receivedStates[0];
      assert.ok(received != null && typeof received === "object");
      assert.deepEqual(
        getAnnotations(received as Record<PropertyKey, unknown>),
        annotations,
      );
    });

    it("should return false when outer state is undefined", () => {
      const inner = createDeferrableParser(true);
      const outer = withDefault(inner, "fallback");

      const result = outer.shouldDeferCompletion!(undefined);
      assert.ok(!result);
      assert.equal(inner.receivedStates.length, 0);
    });

    it("should propagate inner hook's return value", () => {
      const inner = createDeferrableParser(false);
      const outer = withDefault(inner, "fallback");

      const innerState: ValueParserResult<string> = {
        success: true,
        value: "test",
      };
      const result = outer.shouldDeferCompletion!([innerState]);
      assert.ok(!result);
    });

    it("should delegate non-array objects to inner hook", () => {
      const inner = createDeferrableParser(true);
      const outer = withDefault(inner, "fallback");

      const otherState = { someKey: "value" };
      const result = outer.shouldDeferCompletion!(
        otherState as unknown as
          | [ValueParserResult<string> | undefined]
          | undefined,
      );
      assert.ok(result);
      assert.equal(inner.receivedStates.length, 1);
      assert.deepEqual(inner.receivedStates[0], otherState);
    });
  });
});

describe("leadingNames", () => {
  it("should forward from inner parser for optional()", () => {
    const inner = flag("--verbose");
    assert.deepEqual(optional(inner).leadingNames, inner.leadingNames);
  });

  it("should forward from inner parser for withDefault()", () => {
    const inner = option("--name", string());
    assert.deepEqual(
      withDefault(inner, "default").leadingNames,
      inner.leadingNames,
    );
  });

  it("should forward from inner parser for map()", () => {
    const inner = option("--count", integer());
    assert.deepEqual(
      map(inner, (n) => n * 2).leadingNames,
      inner.leadingNames,
    );
  });

  it("should forward from inner parser for multiple()", () => {
    const inner = option("--file", string());
    assert.deepEqual(multiple(inner).leadingNames, inner.leadingNames);
  });

  it("should forward from inner parser for nonEmpty()", () => {
    const inner = multiple(option("--tag", string()));
    assert.deepEqual(nonEmpty(inner).leadingNames, inner.leadingNames);
  });
});

describe("acceptingAnyToken", () => {
  it("should be false for optional() even with catch-all inner", () => {
    assert.ok(!optional(argument(string())).acceptingAnyToken);
  });

  it("should be false for withDefault() even with catch-all inner", () => {
    assert.ok(!withDefault(argument(string()), "x").acceptingAnyToken);
  });

  it("should be false for multiple(min=0) even with catch-all inner", () => {
    assert.ok(!multiple(argument(string())).acceptingAnyToken);
  });

  it("should propagate for multiple(min>0) with catch-all inner", () => {
    assert.ok(multiple(argument(string()), { min: 1 }).acceptingAnyToken);
  });

  it("should propagate through map()", () => {
    assert.ok(map(argument(string()), (s) => s.length).acceptingAnyToken);
  });

  it("should propagate through nonEmpty()", () => {
    assert.ok(
      nonEmpty(multiple(argument(string()), { min: 1 })).acceptingAnyToken,
    );
  });
});

describe("multiple() dependency source extraction", () => {
  it("keeps scanning when the newest async source is thenable", async () => {
    const sourceId = Symbol("mode");
    const earlier = Symbol("earlier");
    const latest = Symbol("latest");
    const visited: unknown[] = [];
    const inner: Parser<"async", string, symbol | null> = {
      $mode: "async" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: null,
      parse: () =>
        Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No parse.`,
        }),
      complete: () =>
        Promise.resolve({
          success: false as const,
          error: message`No completion.`,
        }),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    Object.defineProperty(inner, "dependencyMetadata", {
      value: {
        source: {
          kind: "source" as const,
          sourceId,
          preservesSourceValue: true,
          extractSourceValue(state: unknown) {
            visited.push(state);
            if (state === latest) {
              return createPromiseLike(undefined);
            }
            if (state === earlier) {
              return createPromiseLike({
                success: true as const,
                value: "prod",
              });
            }
            return undefined;
          },
        },
      },
      configurable: true,
      enumerable: false,
    });
    const parser = multiple(inner);
    const result = await parser.dependencyMetadata?.source?.extractSourceValue([
      earlier,
      latest,
    ]);
    assert.deepEqual(result, { success: true, value: "prod" });
    assert.deepEqual(visited, [latest, earlier]);
  });
});

describe("multiple() phase-two seed extraction", () => {
  it("unwraps injected annotation wrappers before extracting item seeds", () => {
    const marker = Symbol.for("@test/multiple-phase-two-seed");
    const child: Parser<"sync", string, string> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "",
      parse(context) {
        return {
          success: true as const,
          next: context,
          consumed: [],
        };
      },
      complete() {
        return { success: false as const, error: message`Missing item.` };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    Object.defineProperty(child, extractPhase2SeedKey, {
      value(state: string | object) {
        return typeof state === "string" ? { value: state } : null;
      },
    });

    const wrappedItem = injectAnnotationsLocal("optique.json", {
      [marker]: true,
    });
    const seed = completeOrExtractPhase2Seed(
      multipleLocal(child, { min: 1 }),
      [wrappedItem],
    );

    assert.deepEqual(seed, { value: ["optique.json"] });
  });
});

describe("withDefault() phase-two seed extraction", () => {
  it("preserves default-only seeds", () => {
    const seed = completeOrExtractPhase2Seed(
      withDefault(option("--name", string()), "fallback"),
      undefined,
    );

    assert.deepEqual(seed, { value: "fallback" });
  });
});

describe("map() phase-two seed extraction", () => {
  function createExtractOnlyParser(
    seed:
      | { readonly value: number; readonly deferred?: true }
      | null,
  ): Parser<"sync", number, number> {
    const parser: Parser<"sync", number, number> = {
      $mode: "sync",
      $valueType: [] as readonly number[],
      $stateType: [] as readonly number[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: 0,
      parse(context) {
        return {
          success: true as const,
          next: context,
          consumed: [],
        };
      },
      complete() {
        return { success: false as const, error: message`Missing value.` };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    Object.defineProperty(parser, extractPhase2SeedKey, {
      value() {
        return seed;
      },
    });
    return parser;
  }

  it("propagates non-deferred transform failures", () => {
    const parser = mapLocal(
      createExtractOnlyParser({ value: 1 }),
      (_value) => {
        throw new Error("Seed transform boom.");
      },
    );

    assert.throws(
      () => completeOrExtractPhase2Seed(parser, 1),
      /Seed transform boom\./,
    );
  });

  it("keeps deferred transform failures as placeholders", () => {
    const parser = mapLocal(
      createExtractOnlyParser({ value: 1, deferred: true }),
      (_value) => {
        throw new Error("Deferred transform boom.");
      },
    );

    assert.deepEqual(
      completeOrExtractPhase2Seed(parser, 1),
      {
        value: undefined,
        deferred: true,
      },
    );
  });
});

describe("validateValue forwarding through modifiers (#414)", () => {
  describe("optional()", () => {
    it("forwards validation to the inner parser for defined values", () => {
      const parser = optional(option("-x", integer({ min: 1, max: 10 })));
      assert.ok(typeof parser.validateValue === "function");
      const result = parser.validateValue!(99);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
    });

    it("returns success for undefined values", () => {
      const parser = optional(option("-x", integer({ min: 1, max: 10 })));
      const result = parser.validateValue!(undefined);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(result.success);
      if (result.success) assert.equal(result.value, undefined);
    });

    it("returns success for valid defined values", () => {
      const parser = optional(option("-x", integer({ min: 1, max: 10 })));
      const result = parser.validateValue!(5);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(result.success);
      if (result.success) assert.equal(result.value, 5);
    });
  });

  describe("withDefault()", () => {
    it("forwards validation to the inner parser", () => {
      const parser = withDefault(
        option("-x", integer({ min: 1, max: 10 })),
        5,
      );
      assert.ok(typeof parser.validateValue === "function");
      const result = parser.validateValue!(99);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
    });

    it("accepts valid values from the inner parser's type", () => {
      const parser = withDefault(
        option("-x", integer({ min: 1, max: 10 })),
        5,
      );
      const result = parser.validateValue!(7);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(result.success);
      if (result.success) assert.equal(result.value, 7);
    });
  });

  describe("map()", () => {
    it("strips validateValue because the mapping is one-way", () => {
      const parser = map(
        option("-x", integer({ min: 1, max: 10 })),
        (n) => n * 2,
      );
      assert.equal(parser.validateValue, undefined);
    });
  });

  describe("multiple()", () => {
    it("validates each element through the inner parser", () => {
      const parser = multiple(option("-x", integer({ min: 1, max: 10 })));
      assert.ok(typeof parser.validateValue === "function");
      const result = parser.validateValue!([5, 99, 3]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
    });

    it("accepts arrays where every element is valid", () => {
      const parser = multiple(option("-x", integer({ min: 1, max: 10 })));
      const result = parser.validateValue!([1, 5, 10]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(result.success);
    });

    it("rejects arrays shorter than min", () => {
      const parser = multiple(option("-x", string()), { min: 2 });
      assert.ok(typeof parser.validateValue === "function");
      const result = parser.validateValue!(["only-one"]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
    });

    it("rejects arrays longer than max", () => {
      const parser = multiple(option("-x", string()), { max: 2 });
      const result = parser.validateValue!(["a", "b", "c"]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
    });

    it("accepts arrays within min and max", () => {
      const parser = multiple(option("-x", string()), { min: 1, max: 3 });
      const result = parser.validateValue!(["a", "b"]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(result.success);
    });

    it("formats arity errors identically to the CLI path", () => {
      const parser = multiple(option("-x", string()), { min: 3 });
      const result = parser.validateValue!(["a"]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(
          formatMessage(result.error),
          "Expected at least 3 values, but got only 1.",
        );
      }
    });

    it("honors options.errors.tooFew in validateValue", () => {
      const parser = multiple(option("-x", string()), {
        min: 3,
        errors: { tooFew: message`custom too-few.` },
      });
      const result = parser.validateValue!(["a"]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(formatMessage(result.error), "custom too-few.");
      }
    });

    it("honors options.errors.tooMany in validateValue", () => {
      const parser = multiple(option("-x", string()), {
        max: 2,
        errors: {
          tooMany: (max, actual) =>
            message`too many: ${text(String(max))}/${text(String(actual))}.`,
        },
      });
      const result = parser.validateValue!(["a", "b", "c"]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(formatMessage(result.error), "too many: 2/3.");
      }
    });

    it("preserves canonicalized element values from innerValidate", () => {
      // When the inner value parser canonicalizes on parse (e.g., a
      // URL parser that strips trailing slashes, or here a string
      // parser that uppercases), CLI parsing passes the normalized
      // value through.  The fallback path must do the same — returning
      // the original array would let non-canonical values leak from
      // bindEnv() / bindConfig() defaults (review r3048978718).
      const upcaseString: ValueParser<"sync", string> = {
        $mode: "sync",
        metavar: "TEXT",
        placeholder: "",
        parse: (input: string) => ({
          success: true,
          value: input.toUpperCase(),
        }),
        format: (value: string) => value,
      };
      const parser = multiple(option("-x", upcaseString));
      const result = parser.validateValue!(["hello", "world"]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["HELLO", "WORLD"]);
      }
    });

    it("preserves canonicalized element values in async mode", async () => {
      const upcaseString: ValueParser<"async", string> = {
        $mode: "async",
        metavar: "TEXT",
        placeholder: "",
        parse: (input: string) =>
          Promise.resolve({ success: true, value: input.toUpperCase() }),
        format: (value: string) => value,
      };
      const parser = multiple(option("-x", upcaseString));
      const promise = parser.validateValue!(["foo", "bar"]);
      assert.ok(promise instanceof Promise);
      const result = await promise;
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["FOO", "BAR"]);
      }
    });

    it("rejects non-array fallback values", () => {
      // Fallback validation is the only barrier between a mis-typed
      // default (escaped via `as never`) and the parsed result; a
      // multiple() parser can never produce a non-array shape from CLI
      // input, so validateValue must reject one instead of silently
      // accepting it (see review comment r3048902497).
      const parser = multiple(option("-x", string()));
      const stringResult = parser.validateValue!("admin" as never);
      assert.ok(
        stringResult && typeof stringResult === "object" &&
          "success" in stringResult,
      );
      assert.ok(!stringResult.success);
      if (!stringResult.success) {
        const formatted = formatMessage(stringResult.error);
        assert.ok(
          formatted.includes("array"),
          `expected error to mention "array", got: ${formatted}`,
        );
        assert.ok(
          formatted.includes("string"),
          `expected error to mention the received type, got: ${formatted}`,
        );
      }

      const nullResult = parser.validateValue!(null as never);
      assert.ok(
        nullResult && typeof nullResult === "object" && "success" in nullResult,
      );
      assert.ok(!nullResult.success);
      if (!nullResult.success) {
        const formatted = formatMessage(nullResult.error);
        assert.ok(
          formatted.includes("null"),
          `expected error to mention "null", got: ${formatted}`,
        );
      }
    });
  });

  describe("nonEmpty()", () => {
    it("passes validateValue through from the inner parser", () => {
      const parser = nonEmpty(
        multiple(option("-x", integer({ min: 1, max: 10 }))),
      );
      assert.ok(typeof parser.validateValue === "function");
      const result = parser.validateValue!([99, 5]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
    });

    it("accepts values that pass the inner parser's validation", () => {
      const parser = nonEmpty(
        multiple(option("-x", integer({ min: 1, max: 10 }))),
      );
      const result = parser.validateValue!([5, 7]);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(result.success);
    });

    it("does not add fallback arity checks beyond inner validateValue", () => {
      // nonEmpty() enforces arity at CLI parse time only; on the fallback
      // path it must delegate entirely to the inner parser's validator
      // (see review comment r3048781571).  With an inner multiple()
      // whose min is 0, an empty array must pass; with min 1 it must
      // fail because the inner multiple enforces the arity.
      const min0 = nonEmpty(
        multiple(option("-x", integer({ min: 1, max: 10 })), { min: 0 }),
      );
      const min0Result = min0.validateValue!([]);
      assert.ok(min0Result && "success" in min0Result);
      assert.ok(min0Result.success);
      if (min0Result.success) assert.deepEqual(min0Result.value, []);

      const min1 = nonEmpty(
        multiple(option("-x", integer({ min: 1, max: 10 })), { min: 1 }),
      );
      const min1Result = min1.validateValue!([]);
      assert.ok(min1Result && "success" in min1Result);
      assert.ok(!min1Result.success);
    });
  });

  describe("async mode", () => {
    it("optional() forwards validateValue in async mode", async () => {
      const parser = optional(
        option("--format", asyncChoice(["json", "yaml"] as const)),
      );
      assert.ok(typeof parser.validateValue === "function");
      const badResult = parser.validateValue!("xml" as never);
      assert.ok(badResult instanceof Promise);
      const bad = await badResult;
      assert.ok(!bad.success);

      const goodResult = parser.validateValue!("json");
      assert.ok(goodResult instanceof Promise);
      const good = await goodResult;
      assert.ok(good.success);
      if (good.success) assert.equal(good.value, "json");

      const undefResult = parser.validateValue!(undefined);
      assert.ok(undefResult instanceof Promise);
      const undef = await undefResult;
      assert.ok(undef.success);
    });

    it("withDefault() forwards validateValue in async mode", async () => {
      const parser = withDefault(
        option("--format", asyncChoice(["json", "yaml"] as const)),
        "json" as const,
      );
      assert.ok(typeof parser.validateValue === "function");
      const badResult = parser.validateValue!("xml" as never);
      assert.ok(badResult instanceof Promise);
      const bad = await badResult;
      assert.ok(!bad.success);
    });

    it("multiple() validates each element in async mode", async () => {
      const parser = multiple(
        option("--format", asyncChoice(["json", "yaml"] as const)),
      );
      assert.ok(typeof parser.validateValue === "function");
      const badResult = parser.validateValue!(["json", "xml" as never]);
      assert.ok(badResult instanceof Promise);
      const bad = await badResult;
      assert.ok(!bad.success);

      const goodResult = parser.validateValue!(["json", "yaml"]);
      assert.ok(goodResult instanceof Promise);
      const good = await goodResult;
      assert.ok(good.success);
    });

    it("nonEmpty() forwards validateValue in async mode", async () => {
      const parser = nonEmpty(
        multiple(
          option("--format", asyncChoice(["json", "yaml"] as const)),
        ),
      );
      assert.ok(typeof parser.validateValue === "function");
      const result = parser.validateValue!(["json", "xml" as never]);
      assert.ok(result instanceof Promise);
      const awaited = await result;
      assert.ok(!awaited.success);
    });

    it("map() strips validateValue in async mode too", () => {
      const parser = map(
        option("--format", asyncChoice(["json", "yaml"] as const)),
        (format) => format.toUpperCase(),
      );
      assert.equal(parser.validateValue, undefined);
    });
  });
});
