import { object } from "@optique/core/constructs";
import {
  envVar,
  formatMessage,
  type Message,
  message,
  text,
} from "@optique/core/message";
import {
  map,
  multiple,
  optional,
  withDefault,
  WithDefaultError,
} from "@optique/core/modifiers";
import { parse } from "@optique/core/parser";
import { argument, constant, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function assertErrorIncludes(error: Message, text: string): void {
  const formatted = formatMessage(error);
  assert.ok(formatted.includes(text));
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
        "Expected at most 2 values, but got 3",
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
        "Expected at most 3 values, but got 4",
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
        "Expected at most 3 values, but got 4",
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
        "Expected at most 5 values, but got 6",
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
      assert.equal(stringResult.value.length, 2);
      assert.equal(typeof stringResult.value[0], "string");
      assert.deepEqual(stringResult.value, ["hello", "world"]);
    }

    const integerResult = parse(integerMultiple, ["-i", "42", "-i", "100"]);
    assert.ok(integerResult.success);
    if (integerResult.success) {
      assert.equal(integerResult.value.length, 2);
      assert.equal(typeof integerResult.value[0], "number");
      assert.deepEqual(integerResult.value, [42, 100]);
    }

    const booleanResult = parse(booleanMultiple, ["-b", "-b"]);
    assert.ok(booleanResult.success);
    if (booleanResult.success) {
      assert.equal(booleanResult.value.length, 2);
      assert.equal(typeof booleanResult.value[0], "boolean");
      assert.deepEqual(booleanResult.value, [true, true]);
    }
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
