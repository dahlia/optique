import { longestMatch, object } from "@optique/core/constructs";
import {
  annotationStateValueKey,
  getAnnotations,
  injectAnnotations,
} from "@optique/core/annotations";
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
import { createDependencyRuntimeContext } from "./dependency-runtime.ts";
import {
  parse,
  parseAsync,
  type Parser,
  type ParserContext,
  type Suggestion,
} from "@optique/core/parser";
import { argument, constant, flag, option } from "@optique/core/primitives";
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

  it("should normalize defaults through multiple() wrappers", () => {
    const parser = withDefault(
      multiple(option("--domain", domain({ lowercase: true }))),
      ["Example.COM"],
    );
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["example.com"]);
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
  });

  it("should retry async complete on annotated wrapper state failures", async () => {
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
    // Note: In object() context, optional(constant()) returns undefined
    // because object() doesn't call parse() on parsers that can't consume
    // any more input. This is expected behavior - constant() is typically
    // used for discriminated unions, not for default values in object().
    // Use withDefault() instead for default values.
    it("should return undefined in object() context (documents current behavior)", () => {
      const parser = object({
        mode: optional(constant("default-mode" as const)),
        verbose: optional(option("-v")),
      });

      // Empty input - optional returns undefined because constant() is never
      // tried (it can't consume anything)
      const result1 = parse(parser, []);
      assert.ok(result1.success);
      if (result1.success) {
        // This documents current behavior - mode is undefined, not "default-mode"
        assert.equal(result1.value.mode, undefined);
        assert.equal(result1.value.verbose, undefined);
      }

      // With verbose flag
      const result2 = parse(parser, ["-v"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.mode, undefined);
        assert.equal(result2.value.verbose, true);
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
      const annotations = { testCtx: "phase1" };
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
      const annotations = { testCtx: "phase1" };
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
