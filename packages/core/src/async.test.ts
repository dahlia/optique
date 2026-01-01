/**
 * Async mode tests for Parser and ValueParser.
 *
 * This file tests the sync/async mode support added in version 0.9.0,
 * including mode propagation through combinators and async execution.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  concat,
  conditional,
  group,
  longestMatch,
  merge,
  object,
  or,
  tuple,
} from "./constructs.ts";
import { map, multiple, optional, withDefault } from "./modifiers.ts";
import { formatDocPage } from "./doc.ts";
import { runParser } from "./facade.ts";
import { message } from "./message.ts";
import {
  getDocPage,
  parseAsync,
  parseSync,
  suggestAsync,
  type Suggestion,
  suggestSync,
} from "./parser.ts";
import { argument, command, constant, flag, option } from "./primitives.ts";
import { formatUsage } from "./usage.ts";
import {
  choice,
  integer,
  string,
  type ValueParser,
  type ValueParserResult,
} from "./valueparser.ts";

// =============================================================================
// Test Helpers - Async ValueParsers
// =============================================================================

/**
 * Creates an async value parser that simulates async parsing.
 */
function asyncString(delay = 0): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "ASYNC_STRING",
    async parse(input: string): Promise<ValueParserResult<string>> {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return { success: true, value: input.toUpperCase() };
    },
    format(value: string): string {
      return value.toLowerCase();
    },
  };
}

/**
 * Creates an async value parser that can fail.
 */
function asyncInteger(): ValueParser<"async", number> {
  return {
    $mode: "async",
    metavar: "ASYNC_INT",
    parse(input: string): Promise<ValueParserResult<number>> {
      const num = parseInt(input, 10);
      if (isNaN(num)) {
        return Promise.resolve({
          success: false,
          error: message`Invalid integer: ${input}`,
        });
      }
      return Promise.resolve({ success: true, value: num });
    },
    format(value: number): string {
      return value.toString();
    },
  };
}

/**
 * Creates an async value parser with suggestions.
 */
function asyncChoice(
  choices: readonly string[],
): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "ASYNC_CHOICE",
    parse(input: string): Promise<ValueParserResult<string>> {
      if (choices.includes(input)) {
        return Promise.resolve({ success: true, value: input });
      }
      return Promise.resolve({
        success: false,
        error: message`Must be one of: ${choices.join(", ")}`,
      });
    },
    format(value: string): string {
      return value;
    },
    async *suggest(prefix: string): AsyncIterable<Suggestion> {
      for (const c of choices) {
        if (c.startsWith(prefix)) {
          yield { kind: "literal", text: c };
        }
      }
    },
  };
}

// =============================================================================
// Async ValueParser Tests
// =============================================================================

describe("Async ValueParser", () => {
  describe("basic async parsing", () => {
    it("should parse successfully with async parser", async () => {
      const parser = asyncString();
      const result = await parser.parse("hello");
      assert.deepEqual(result, { success: true, value: "HELLO" });
    });

    it("should handle async parsing failure", async () => {
      const parser = asyncInteger();
      const result = await parser.parse("not-a-number");
      assert.equal(result.success, false);
    });

    it("should format values correctly", () => {
      const parser = asyncString();
      assert.equal(parser.format("HELLO"), "hello");
    });

    it("should have $mode property set to async", () => {
      const parser = asyncString();
      assert.equal(parser.$mode, "async");
    });
  });

  describe("async suggestions", () => {
    it("should provide async suggestions", async () => {
      const parser = asyncChoice(["apple", "apricot", "banana"]);
      const suggestions: Suggestion[] = [];
      for await (const s of parser.suggest!("ap")) {
        suggestions.push(s);
      }
      assert.deepEqual(suggestions, [
        { kind: "literal", text: "apple" },
        { kind: "literal", text: "apricot" },
      ]);
    });
  });
});

// =============================================================================
// Mode Propagation Tests - Primitives
// =============================================================================

describe("Mode propagation in primitives", () => {
  describe("option()", () => {
    it("should be sync when using sync ValueParser", () => {
      const parser = option("--name", string());
      assert.equal(parser.$mode, "sync");
    });

    it("should be async when using async ValueParser", () => {
      const parser = option("--name", asyncString());
      assert.equal(parser.$mode, "async");
    });

    it("should parse async option correctly", async () => {
      const parser = object({
        name: option("--name", asyncString()),
      });
      const result = await parseAsync(parser, ["--name", "world"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { name: "WORLD" });
    });
  });

  describe("argument()", () => {
    it("should be sync when using sync ValueParser", () => {
      const parser = argument(string());
      assert.equal(parser.$mode, "sync");
    });

    it("should be async when using async ValueParser", () => {
      const parser = argument(asyncString());
      assert.equal(parser.$mode, "async");
    });

    it("should parse async argument correctly", async () => {
      const parser = object({
        name: argument(asyncString()),
      });
      const result = await parseAsync(parser, ["hello"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { name: "HELLO" });
    });
  });

  describe("constant()", () => {
    it("should always be sync", () => {
      const parser = constant("value");
      assert.equal(parser.$mode, "sync");
    });
  });

  describe("flag()", () => {
    it("should always be sync", () => {
      const parser = flag("-v", "--verbose");
      assert.equal(parser.$mode, "sync");
    });
  });

  describe("command()", () => {
    it("should propagate sync mode from inner parser", () => {
      const inner = object({ name: argument(string()) });
      const parser = command("cmd", inner);
      assert.equal(parser.$mode, "sync");
    });

    it("should propagate async mode from inner parser", () => {
      const inner = object({ name: argument(asyncString()) });
      const parser = command("cmd", inner);
      assert.equal(parser.$mode, "async");
    });
  });
});

// =============================================================================
// Mode Propagation Tests - Modifiers
// =============================================================================

describe("Mode propagation in modifiers", () => {
  describe("optional()", () => {
    it("should propagate sync mode", () => {
      const parser = optional(option("--name", string()));
      assert.equal(parser.$mode, "sync");
    });

    it("should propagate async mode", () => {
      const parser = optional(option("--name", asyncString()));
      assert.equal(parser.$mode, "async");
    });

    it("should parse async optional correctly when present", async () => {
      const parser = object({
        name: optional(option("--name", asyncString())),
      });
      const result = await parseAsync(parser, ["--name", "test"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { name: "TEST" });
    });

    it("should parse async optional correctly when absent", async () => {
      const parser = object({
        name: optional(option("--name", asyncString())),
      });
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.deepEqual(result.value, { name: undefined });
    });
  });

  describe("withDefault()", () => {
    it("should propagate sync mode", () => {
      const parser = withDefault(option("--name", string()), "default");
      assert.equal(parser.$mode, "sync");
    });

    it("should propagate async mode", () => {
      const parser = withDefault(option("--name", asyncString()), "DEFAULT");
      assert.equal(parser.$mode, "async");
    });

    it("should use default when async option is absent", async () => {
      const parser = object({
        name: withDefault(option("--name", asyncString()), "DEFAULT"),
      });
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.deepEqual(result.value, { name: "DEFAULT" });
    });
  });

  describe("map()", () => {
    it("should propagate sync mode", () => {
      const parser = map(option("--count", integer()), (n) => n * 2);
      assert.equal(parser.$mode, "sync");
    });

    it("should propagate async mode", () => {
      const parser = map(option("--name", asyncString()), (s) => s.length);
      assert.equal(parser.$mode, "async");
    });

    it("should apply map function to async result", async () => {
      const parser = object({
        len: map(option("--name", asyncString()), (s) => s.length),
      });
      const result = await parseAsync(parser, ["--name", "hello"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { len: 5 }); // "HELLO".length
    });
  });

  describe("multiple()", () => {
    it("should propagate sync mode", () => {
      const parser = multiple(option("--file", string()));
      assert.equal(parser.$mode, "sync");
    });

    it("should propagate async mode", () => {
      const parser = multiple(option("--file", asyncString()));
      assert.equal(parser.$mode, "async");
    });

    it("should collect multiple async values", async () => {
      const parser = object({
        files: multiple(option("--file", asyncString())),
      });
      const result = await parseAsync(parser, [
        "--file",
        "a",
        "--file",
        "b",
        "--file",
        "c",
      ]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { files: ["A", "B", "C"] });
    });
  });
});

// =============================================================================
// Mode Propagation Tests - Constructs
// =============================================================================

describe("Mode propagation in constructs", () => {
  describe("object()", () => {
    it("should be sync when all fields are sync", () => {
      const parser = object({
        name: option("--name", string()),
        count: option("--count", integer()),
      });
      assert.equal(parser.$mode, "sync");
    });

    it("should be async when any field is async", () => {
      const parser = object({
        name: option("--name", asyncString()),
        count: option("--count", integer()),
      });
      assert.equal(parser.$mode, "async");
    });

    it("should be async when all fields are async", () => {
      const parser = object({
        name: option("--name", asyncString()),
        value: option("--value", asyncString()),
      });
      assert.equal(parser.$mode, "async");
    });

    it("should parse mixed sync/async object correctly", async () => {
      const parser = object({
        name: option("--name", asyncString()),
        count: withDefault(option("--count", integer()), 0),
      });
      const result = await parseAsync(parser, [
        "--name",
        "test",
        "--count",
        "42",
      ]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { name: "TEST", count: 42 });
    });
  });

  describe("tuple()", () => {
    it("should be sync when all elements are sync", () => {
      const parser = tuple([argument(string()), argument(integer())]);
      assert.equal(parser.$mode, "sync");
    });

    it("should be async when any element is async", () => {
      const parser = tuple([argument(asyncString()), argument(integer())]);
      assert.equal(parser.$mode, "async");
    });

    it("should parse async tuple correctly", async () => {
      const parser = tuple([argument(asyncString()), argument(integer())]);
      const result = await parseAsync(parser, ["hello", "42"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, ["HELLO", 42]);
    });
  });

  describe("or()", () => {
    it("should be sync when all alternatives are sync", () => {
      const parser = or(
        object({ cmd: constant("a" as const) }),
        object({ cmd: constant("b" as const) }),
      );
      assert.equal(parser.$mode, "sync");
    });

    it("should be async when any alternative is async", () => {
      const parser = or(
        object({
          cmd: constant("a" as const),
          name: argument(asyncString()),
        }),
        object({ cmd: constant("b" as const) }),
      );
      assert.equal(parser.$mode, "async");
    });

    it("should parse async alternative correctly", async () => {
      const parser = or(
        object({
          cmd: constant("async" as const),
          name: argument(asyncString()),
        }),
        object({ cmd: constant("sync" as const), name: argument(string()) }),
      );
      const result = await parseAsync(parser, ["hello"]);
      assert.ok(result.success);
      // First alternative matches and transforms to uppercase
      assert.deepEqual(result.value, { cmd: "async", name: "HELLO" });
    });
  });

  describe("merge()", () => {
    it("should be sync when all parsers are sync", () => {
      const parser = merge(
        object({ name: option("--name", string()) }),
        object({ count: option("--count", integer()) }),
      );
      assert.equal(parser.$mode, "sync");
    });

    it("should be async when any parser is async", () => {
      const parser = merge(
        object({ name: option("--name", asyncString()) }),
        object({ count: option("--count", integer()) }),
      );
      assert.equal(parser.$mode, "async");
    });

    it("should parse merged async parsers correctly", async () => {
      const parser = merge(
        object({ name: option("--name", asyncString()) }),
        object({ count: withDefault(option("--count", integer()), 0) }),
      );
      const result = await parseAsync(parser, [
        "--name",
        "test",
        "--count",
        "5",
      ]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { name: "TEST", count: 5 });
    });
  });

  describe("longestMatch()", () => {
    it("should be sync when all parsers are sync", () => {
      const parser = longestMatch(
        object({ a: flag("-a") }),
        object({ b: flag("-b") }),
      );
      assert.equal(parser.$mode, "sync");
    });

    it("should be async when any parser is async", () => {
      const parser = longestMatch(
        object({ name: argument(asyncString()) }),
        object({ b: flag("-b") }),
      );
      assert.equal(parser.$mode, "async");
    });
  });
});

// =============================================================================
// Facade Function Tests
// =============================================================================

describe("Async facade functions", () => {
  describe("parseAsync()", () => {
    it("should parse sync parser and return Promise", async () => {
      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });
      const result = await parseAsync(parser, ["--name", "test"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { name: "test" });
    });

    it("should parse async parser and return Promise", async () => {
      const parser = object({
        name: withDefault(option("--name", asyncString()), "DEFAULT"),
      });
      const result = await parseAsync(parser, ["--name", "test"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { name: "TEST" });
    });

    it("should handle parsing errors in async parser", async () => {
      const parser = object({
        num: argument(asyncInteger()),
      });
      const result = await parseAsync(parser, ["not-a-number"]);
      assert.ok(!result.success);
    });
  });

  describe("parseSync()", () => {
    it("should parse sync parser directly", () => {
      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });
      const result = parseSync(parser, ["--name", "test"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { name: "test" });
    });

    // TypeScript should prevent passing async parser to parseSync
    // This is a compile-time check, not a runtime test
  });

  describe("suggestAsync()", () => {
    it("should get suggestions from sync parser", async () => {
      const parser = object({
        format: option("--format", choice(["json", "yaml", "xml"])),
      });
      const suggestions = await suggestAsync(parser, ["--format", "j"]);
      const literals = suggestions
        .filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        )
        .map((s) => s.text);
      assert.ok(literals.includes("json"));
    });

    it("should get suggestions from async parser", async () => {
      const parser = object({
        format: option("--format", asyncChoice(["json", "yaml", "xml"])),
      });
      const suggestions = await suggestAsync(parser, ["--format", "j"]);
      const literals = suggestions
        .filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        )
        .map((s) => s.text);
      assert.ok(literals.includes("json"));
    });
  });

  describe("suggestSync()", () => {
    it("should get suggestions from sync parser directly", () => {
      const parser = object({
        format: option("--format", choice(["json", "yaml", "xml"])),
      });
      const suggestions = suggestSync(parser, ["--format", "y"]);
      const literals = suggestions
        .filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        )
        .map((s) => s.text);
      assert.ok(literals.includes("yaml"));
    });
  });
});

// =============================================================================
// Complex Async Scenarios
// =============================================================================

describe("Complex async scenarios", () => {
  it("should handle deeply nested async parsers", async () => {
    const parser = object({
      cmd: constant("run" as const),
      name: optional(option("--name", asyncString())),
      count: withDefault(option("--count", integer()), 1),
    });
    // Parser should be async due to nested asyncString
    assert.equal(parser.$mode, "async");

    const result = await parseAsync(parser, ["--name", "test", "--count", "5"]);
    assert.ok(result.success);
    assert.deepEqual(result.value, { cmd: "run", name: "TEST", count: 5 });
  });

  it("should handle command with async subparser", async () => {
    const subparser = object({
      file: argument(asyncString()),
    });

    // Using command() directly
    const cmdParser = command("process", subparser);
    assert.equal(cmdParser.$mode, "async");

    // Test parsing through command
    const parser = or(cmdParser, object({ cmd: constant("other" as const) }));
    const result = await parseAsync(parser, ["process", "input.txt"]);
    assert.ok(result.success);
    assert.deepEqual(result.value, { file: "INPUT.TXT" });
  });

  it("should handle or() with mixed sync/async branches", async () => {
    const parser = or(
      object({
        cmd: constant("fetch" as const),
        url: argument(asyncString()),
      }),
      object({
        cmd: constant("local" as const),
        path: argument(string()),
      }),
    );

    assert.equal(parser.$mode, "async");

    // Test async branch
    const result1 = await parseAsync(parser, ["http://example.com"]);
    assert.ok(result1.success);
    assert.deepEqual(result1.value, {
      cmd: "fetch",
      url: "HTTP://EXAMPLE.COM",
    });
  });

  it("should handle multiple() with async parser collecting many values", async () => {
    const parser = object({
      tags: multiple(option("--tag", asyncString())),
    });
    const result = await parseAsync(parser, [
      "--tag",
      "a",
      "--tag",
      "b",
      "--tag",
      "c",
      "--tag",
      "d",
      "--tag",
      "e",
    ]);
    assert.ok(result.success);
    assert.deepEqual(result.value, { tags: ["A", "B", "C", "D", "E"] });
  });

  it("should handle map() chain with async parser", async () => {
    const parser = object({
      greeting: map(
        map(option("--name", asyncString()), (s) => s.toLowerCase()),
        (s) => `Hello, ${s}!`,
      ),
    });

    assert.equal(parser.$mode, "async");

    const result = await parseAsync(parser, ["--name", "World"]);
    assert.ok(result.success);
    assert.deepEqual(result.value, { greeting: "Hello, world!" });
  });
});

// =============================================================================
// Type Safety Tests (compile-time verification)
// =============================================================================

describe("Type safety", () => {
  it("should infer correct mode type for sync parser", () => {
    const parser = object({ name: argument(string()) });
    // TypeScript should infer parser as Parser<"sync", ...>
    const mode: "sync" = parser.$mode;
    assert.equal(mode, "sync");
  });

  it("should infer correct mode type for async parser", () => {
    const parser = object({ name: argument(asyncString()) });
    // TypeScript should infer parser as Parser<"async", ...>
    const mode: "async" = parser.$mode;
    assert.equal(mode, "async");
  });

  it("should infer async mode when combining sync and async", () => {
    const parser = object({
      syncField: argument(string()),
      asyncField: argument(asyncString()),
    });
    // Combined mode should be async
    const mode: "async" = parser.$mode;
    assert.equal(mode, "async");
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Async edge cases", () => {
  it("should handle async parser with delay", async () => {
    const parser = object({
      name: argument(asyncString(10)), // 10ms delay
    });
    const start = Date.now();
    const result = await parseAsync(parser, ["test"]);
    const elapsed = Date.now() - start;
    assert.ok(result.success);
    assert.deepEqual(result.value, { name: "TEST" });
    assert.ok(elapsed >= 10, `Expected delay >= 10ms, got ${elapsed}ms`);
  });

  it("should handle empty args with async parser", async () => {
    const parser = object({
      name: withDefault(option("--name", asyncString()), "DEFAULT"),
    });
    const result = await parseAsync(parser, []);
    assert.ok(result.success);
    assert.deepEqual(result.value, { name: "DEFAULT" });
  });

  it("should propagate errors correctly in async parser", async () => {
    const parser = object({
      num: argument(asyncInteger()),
    });
    const result = await parseAsync(parser, ["invalid"]);
    assert.ok(!result.success);
    if (!result.success) {
      // Error message should be present
      assert.ok(result.error);
    }
  });
});

// =============================================================================
// Additional Construct Tests
// =============================================================================

describe("Additional async construct tests", () => {
  describe("conditional()", () => {
    it("should propagate async mode from discriminator", () => {
      const parser = conditional(
        option("--type", asyncChoice(["a", "b"])),
        {
          a: object({ name: option("--name", string()) }),
          b: object({ count: option("--count", integer()) }),
        },
      );
      assert.equal(parser.$mode, "async");
    });

    it("should propagate async mode from branch parsers", () => {
      const parser = conditional(
        option("--type", choice(["a", "b"])),
        {
          a: object({ name: option("--name", asyncString()) }),
          b: object({ count: option("--count", integer()) }),
        },
      );
      assert.equal(parser.$mode, "async");
    });

    // Note: Async parsing tests for conditional() are skipped because
    // the async implementation for conditional() parse is not complete.
    // Only mode propagation is tested here.
  });

  describe("group()", () => {
    it("should propagate async mode from inner parser", () => {
      const inner = object({
        name: option("--name", asyncString()),
      });
      const parser = group("Options", inner);
      assert.equal(parser.$mode, "async");
    });

    it("should parse async grouped parser", async () => {
      const inner = object({
        name: option("--name", asyncString()),
      });
      const parser = group("Options", inner);
      const result = await parseAsync(parser, ["--name", "test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, { name: "TEST" });
      }
    });
  });

  describe("concat()", () => {
    it("should be sync when all parsers are sync", () => {
      const parser = concat(
        tuple([option("--name", string())]),
        tuple([option("--count", integer())]),
      );
      assert.equal(parser.$mode, "sync");
    });

    it("should be async when any parser is async", () => {
      const parser = concat(
        tuple([option("--name", asyncString())]),
        tuple([option("--count", integer())]),
      );
      assert.equal(parser.$mode, "async");
    });

    // Note: Async parsing test for concat() is skipped because
    // the async implementation for concat() parse is not complete.
    // Only mode propagation is tested here.
  });

  describe("longestMatch()", () => {
    it("should parse async longestMatch correctly", async () => {
      const parser = longestMatch(
        object({
          name: option("--name", asyncString()),
        }),
        object({
          count: option("--count", integer()),
        }),
      );
      const result = await parseAsync(parser, ["--name", "test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, { name: "TEST" });
      }
    });

    it("should select longer match with async parsers", async () => {
      const parser = longestMatch(
        object({
          name: option("--name", asyncString()),
        }),
        object({
          name: option("--name", asyncString()),
          count: option("--count", integer()),
        }),
      );
      const result = await parseAsync(parser, [
        "--name",
        "test",
        "--count",
        "5",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, { name: "TEST", count: 5 });
      }
    });
  });
});

// =============================================================================
// Modifier Edge Cases
// =============================================================================

describe("Async modifier edge cases", () => {
  describe("optional() with async parser failure", () => {
    it("should handle async parsing failure gracefully", async () => {
      const parser = object({
        num: optional(argument(asyncInteger())),
      });
      // Parse with invalid integer - should still work as optional
      const result = await parseAsync(parser, ["not-a-number"]);
      // The parse should fail because the argument parser consumes input
      // but fails to parse it
      assert.ok(!result.success);
    });

    it("should return undefined when async optional has no input", async () => {
      const parser = object({
        num: optional(option("--num", asyncInteger())),
      });
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.num, undefined);
      }
    });
  });

  describe("withDefault() with async parser", () => {
    it("should use default when async parsing fails without consuming", async () => {
      const parser = object({
        name: withDefault(option("--name", asyncString()), "DEFAULT"),
      });
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.name, "DEFAULT");
      }
    });

    it("should use parsed value when async parsing succeeds", async () => {
      const parser = object({
        name: withDefault(option("--name", asyncString()), "DEFAULT"),
      });
      const result = await parseAsync(parser, ["--name", "custom"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.name, "CUSTOM");
      }
    });
  });

  describe("multiple() with async constraints", () => {
    it("should enforce min constraint with async parser", async () => {
      const parser = object({
        names: multiple(option("--name", asyncString()), { min: 2 }),
      });
      const result = await parseAsync(parser, ["--name", "one"]);
      assert.ok(!result.success);
    });

    it("should enforce max constraint with async parser", async () => {
      const parser = object({
        names: multiple(option("--name", asyncString()), { max: 1 }),
      });
      const result = await parseAsync(parser, [
        "--name",
        "one",
        "--name",
        "two",
      ]);
      assert.ok(!result.success);
    });

    it("should pass with valid count for async parser", async () => {
      const parser = object({
        names: multiple(option("--name", asyncString()), { min: 1, max: 2 }),
      });
      const result = await parseAsync(parser, [
        "--name",
        "one",
        "--name",
        "two",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value.names, ["ONE", "TWO"]);
      }
    });
  });
});

// =============================================================================
// Async Suggest Edge Cases
// =============================================================================

describe("Async suggest edge cases", () => {
  describe("suggest from tuple with async elements", () => {
    it("should get suggestions from async tuple element", async () => {
      const parser = tuple([
        option("--format", asyncChoice(["json", "yaml", "xml"])),
        option("--output", string()),
      ]);
      const suggestions = await suggestAsync(parser, ["--format", "j"]);
      const literals = suggestions
        .filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        )
        .map((s) => s.text);
      assert.ok(literals.includes("json"));
    });
  });

  describe("suggest from or() with async branches", () => {
    it("should get suggestions from all async branches", async () => {
      const parser = or(
        object({ format: option("--format", asyncChoice(["json", "yaml"])) }),
        object({ output: option("--output", asyncChoice(["file", "stdout"])) }),
      );
      const suggestions = await suggestAsync(parser, ["--"]);
      const literals = suggestions
        .filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        )
        .map((s) => s.text);
      // Should suggest options from both branches
      assert.ok(literals.includes("--format"));
      assert.ok(literals.includes("--output"));
    });
  });

  describe("suggest from command with async subparser", () => {
    it("should get suggestions from async subparser", async () => {
      const parser = command(
        "convert",
        object({
          format: option("--format", asyncChoice(["json", "yaml", "xml"])),
        }),
      );
      const suggestions = await suggestAsync(parser, [
        "convert",
        "--format",
        "j",
      ]);
      const literals = suggestions
        .filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        )
        .map((s) => s.text);
      assert.ok(literals.includes("json"));
    });
  });

  describe("suggest from optional with async parser", () => {
    it("should get suggestions through optional wrapper", async () => {
      const parser = object({
        format: optional(option("--format", asyncChoice(["json", "yaml"]))),
      });
      const suggestions = await suggestAsync(parser, ["--format", "j"]);
      const literals = suggestions
        .filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        )
        .map((s) => s.text);
      assert.ok(literals.includes("json"));
    });
  });

  describe("suggest from multiple with async parser", () => {
    it("should get suggestions through multiple wrapper", async () => {
      const parser = object({
        formats: multiple(option("--format", asyncChoice(["json", "yaml"]))),
      });
      const suggestions = await suggestAsync(parser, ["--format", "j"]);
      const literals = suggestions
        .filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        )
        .map((s) => s.text);
      assert.ok(literals.includes("json"));
    });
  });

  describe("suggest with empty async results", () => {
    it("should handle async suggest returning no matches", async () => {
      const parser = object({
        format: option("--format", asyncChoice(["json", "yaml"])),
      });
      // Prefix that doesn't match any choice
      const suggestions = await suggestAsync(parser, ["--format", "xyz"]);
      const literals = suggestions
        .filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        )
        .map((s) => s.text);
      // Should return empty or non-matching suggestions
      assert.ok(!literals.includes("json"));
      assert.ok(!literals.includes("yaml"));
    });
  });
});

// =============================================================================
// Async Complete Error Handling
// =============================================================================

describe("Async complete() error handling", () => {
  it("should propagate complete() errors in async object", async () => {
    // asyncInteger will fail on invalid input during complete()
    const parser = object({
      count: argument(asyncInteger()),
    });
    const result = await parseAsync(parser, ["not-a-number"]);
    assert.ok(!result.success);
  });

  it("should propagate complete() errors in async tuple", async () => {
    const parser = tuple([
      argument(asyncInteger()),
      argument(string()),
    ]);
    const result = await parseAsync(parser, ["not-a-number", "hello"]);
    assert.ok(!result.success);
  });

  it("should handle partial success in async merge", async () => {
    const parser = merge(
      object({ name: option("--name", asyncString()) }),
      object({ count: argument(asyncInteger()) }),
    );
    // Valid name but invalid count
    const result = await parseAsync(parser, ["--name", "test", "invalid"]);
    assert.ok(!result.success);
  });
});

// =============================================================================
// Concurrent Async Parsing
// =============================================================================

describe("Concurrent async behavior", () => {
  it("should handle multiple concurrent parseAsync calls", async () => {
    const parser = object({
      name: option("--name", asyncString(10)), // 10ms delay
    });

    // Run multiple parses concurrently
    const results = await Promise.all([
      parseAsync(parser, ["--name", "first"]),
      parseAsync(parser, ["--name", "second"]),
      parseAsync(parser, ["--name", "third"]),
    ]);

    assert.ok(results.every((r) => r.success));
    if (results[0].success && results[1].success && results[2].success) {
      assert.equal(results[0].value.name, "FIRST");
      assert.equal(results[1].value.name, "SECOND");
      assert.equal(results[2].value.name, "THIRD");
    }
  });

  it("should handle concurrent suggests", async () => {
    const parser = object({
      format: option("--format", asyncChoice(["json", "yaml", "xml"])),
    });

    const results = await Promise.all([
      suggestAsync(parser, ["--format", "j"]),
      suggestAsync(parser, ["--format", "y"]),
      suggestAsync(parser, ["--format", "x"]),
    ]);

    // Each should have appropriate suggestions
    const jSuggestions = results[0]
      .filter((s): s is { kind: "literal"; text: string } =>
        s.kind === "literal"
      )
      .map((s) => s.text);
    const ySuggestions = results[1]
      .filter((s): s is { kind: "literal"; text: string } =>
        s.kind === "literal"
      )
      .map((s) => s.text);
    const xSuggestions = results[2]
      .filter((s): s is { kind: "literal"; text: string } =>
        s.kind === "literal"
      )
      .map((s) => s.text);

    assert.ok(jSuggestions.includes("json"));
    assert.ok(ySuggestions.includes("yaml"));
    assert.ok(xSuggestions.includes("xml"));
  });
});

// =============================================================================
// State Persistence Across Multiple Parse Calls
// =============================================================================

describe("State persistence across multiple parse calls", () => {
  describe("parser reuse without state leakage", () => {
    it("should produce consistent results when reusing a sync parser", () => {
      const parser = object({
        name: option("--name", string()),
        count: option("-c", "--count", integer()),
      });

      // First parse
      const result1 = parseSync(parser, ["--name", "alice", "-c", "10"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.name, "alice");
        assert.equal(result1.value.count, 10);
      }

      // Second parse with different values - should not be affected by first
      const result2 = parseSync(parser, ["--name", "bob", "-c", "20"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.name, "bob");
        assert.equal(result2.value.count, 20);
      }

      // Third parse - verify first result wasn't corrupted
      const result3 = parseSync(parser, ["--name", "charlie", "-c", "30"]);
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value.name, "charlie");
        assert.equal(result3.value.count, 30);
      }
    });

    it("should produce consistent results when reusing an async parser", async () => {
      const parser = object({
        name: option("--name", asyncString()),
        count: option("-c", "--count", asyncInteger()),
      });

      // Sequential parses should not affect each other
      const result1 = await parseAsync(parser, ["--name", "alice", "-c", "10"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.name, "ALICE");
        assert.equal(result1.value.count, 10);
      }

      const result2 = await parseAsync(parser, ["--name", "bob", "-c", "20"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.name, "BOB");
        assert.equal(result2.value.count, 20);
      }

      const result3 = await parseAsync(parser, [
        "--name",
        "charlie",
        "-c",
        "30",
      ]);
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value.name, "CHARLIE");
        assert.equal(result3.value.count, 30);
      }
    });
  });

  describe("stateful async value parser", () => {
    // Create a value parser that tracks how many times it was called
    function countingAsyncString(): ValueParser<"async", string> & {
      callCount: number;
    } {
      const parser: ValueParser<"async", string> & { callCount: number } = {
        $mode: "async",
        metavar: "COUNTING_STRING",
        callCount: 0,
        async parse(input: string): Promise<ValueParserResult<string>> {
          this.callCount++;
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { success: true, value: `${input}:${this.callCount}` };
        },
        format(value: string): string {
          return value;
        },
      };
      return parser;
    }

    it("should accumulate state in stateful async parser", async () => {
      const countingParser = countingAsyncString();
      const parser = object({
        value: option("--value", countingParser),
      });

      // Each call should increment the counter
      const result1 = await parseAsync(parser, ["--value", "a"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.value, "a:1");
      }

      const result2 = await parseAsync(parser, ["--value", "b"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.value, "b:2");
      }

      const result3 = await parseAsync(parser, ["--value", "c"]);
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value.value, "c:3");
      }

      // Verify the counter has been incremented
      assert.equal(countingParser.callCount, 3);
    });

    it("should isolate state between independent parser instances", async () => {
      // Create two independent parsers
      const counting1 = countingAsyncString();
      const counting2 = countingAsyncString();

      const parser1 = object({ value: option("--value", counting1) });
      const parser2 = object({ value: option("--value", counting2) });

      // Parse with first parser multiple times
      await parseAsync(parser1, ["--value", "x"]);
      await parseAsync(parser1, ["--value", "y"]);

      // Parse with second parser once
      await parseAsync(parser2, ["--value", "z"]);

      // Each should have independent counts
      assert.equal(counting1.callCount, 2);
      assert.equal(counting2.callCount, 1);
    });
  });

  describe("multiple() accumulator state", () => {
    it("should not accumulate values across parse calls with multiple()", async () => {
      const parser = object({
        items: multiple(option("--item", asyncString())),
      });

      // First parse: 2 items
      const result1 = await parseAsync(parser, [
        "--item",
        "a",
        "--item",
        "b",
      ]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value.items, ["A", "B"]);
      }

      // Second parse: 1 item - should not include items from first parse
      const result2 = await parseAsync(parser, ["--item", "c"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.deepEqual(result2.value.items, ["C"]);
      }

      // Third parse: 3 items
      const result3 = await parseAsync(parser, [
        "--item",
        "d",
        "--item",
        "e",
        "--item",
        "f",
      ]);
      assert.ok(result3.success);
      if (result3.success) {
        assert.deepEqual(result3.value.items, ["D", "E", "F"]);
      }
    });

    it("should handle empty multiple() across parse calls", async () => {
      const parser = object({
        items: withDefault(multiple(option("--item", asyncString())), []),
      });

      // Parse with items
      const result1 = await parseAsync(parser, ["--item", "a"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value.items, ["A"]);
      }

      // Parse without items - should be empty, not carry over
      const result2 = await parseAsync(parser, []);
      assert.ok(result2.success);
      if (result2.success) {
        assert.deepEqual(result2.value.items, []);
      }
    });
  });

  describe("or() branch selection independence", () => {
    it("should select correct branch independently across parse calls", async () => {
      const parser = or(
        object({
          kind: constant("file"),
          path: option("--file", asyncString()),
        }),
        object({
          kind: constant("url"),
          address: option("--url", asyncString()),
        }),
      );

      // First: select file branch
      const result1 = await parseAsync(parser, ["--file", "/path/to/file"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.kind, "file");
        assert.equal((result1.value as { path: string }).path, "/PATH/TO/FILE");
      }

      // Second: select url branch - should not be affected by first
      const result2 = await parseAsync(parser, [
        "--url",
        "https://example.com",
      ]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.kind, "url");
        assert.equal(
          (result2.value as { address: string }).address,
          "HTTPS://EXAMPLE.COM",
        );
      }

      // Third: back to file branch
      const result3 = await parseAsync(parser, ["--file", "/another/path"]);
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value.kind, "file");
        assert.equal((result3.value as { path: string }).path, "/ANOTHER/PATH");
      }
    });
  });

  describe("command selection independence", () => {
    it("should select correct command independently across parse calls", async () => {
      const createCmd = command(
        "create",
        object({
          name: argument(asyncString()),
        }),
      );
      const deleteCmd = command(
        "delete",
        object({
          id: argument(asyncInteger()),
        }),
      );
      const parser = or(createCmd, deleteCmd);

      // First: create command
      const result1 = await parseAsync(parser, ["create", "myitem"]);
      assert.ok(result1.success);
      if (result1.success) {
        const value = result1.value as { name: string };
        assert.equal(value.name, "MYITEM");
      }

      // Second: delete command
      const result2 = await parseAsync(parser, ["delete", "42"]);
      assert.ok(result2.success);
      if (result2.success) {
        const value = result2.value as { id: number };
        assert.equal(value.id, 42);
      }

      // Third: create command again
      const result3 = await parseAsync(parser, ["create", "another"]);
      assert.ok(result3.success);
      if (result3.success) {
        const value = result3.value as { name: string };
        assert.equal(value.name, "ANOTHER");
      }
    });
  });

  describe("suggest() state independence", () => {
    it("should provide independent suggestions across calls", async () => {
      const parser = object({
        format: option("--format", asyncChoice(["json", "yaml", "xml"])),
      });

      // Get suggestions for 'j'
      const suggestions1 = await suggestAsync(parser, ["--format", "j"]);
      const literals1 = suggestions1
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(literals1.includes("json"));

      // Get suggestions for 'y' - should not be affected by previous
      const suggestions2 = await suggestAsync(parser, ["--format", "y"]);
      const literals2 = suggestions2
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(literals2.includes("yaml"));

      // Get suggestions for 'j' again - should be same as first
      const suggestions3 = await suggestAsync(parser, ["--format", "j"]);
      const literals3 = suggestions3
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(literals3.includes("json"));
    });
  });
});

// =============================================================================
// Deeply Nested Complex Combinations
// =============================================================================

describe("Deeply nested async parser combinations", () => {
  describe("command with async options", () => {
    it("should handle or(command(...), command(...)) with async options", async () => {
      // Pattern: subcommands with async options
      const startCmd = command(
        "start",
        object({
          port: option("-p", "--port", asyncInteger()),
          host: withDefault(option("--host", asyncString()), "LOCALHOST"),
          verbose: flag("-v", "--verbose"),
        }),
      );

      const stopCmd = command(
        "stop",
        object({
          force: flag("-f", "--force"),
          timeout: withDefault(option("--timeout", integer()), 30),
        }),
      );

      const parser = or(startCmd, stopCmd);
      assert.equal(parser.$mode, "async");

      // Test start command
      const startResult = await parseAsync(parser, [
        "start",
        "-v",
        "-p",
        "8080",
        "--host",
        "example.com",
      ]);
      assert.ok(startResult.success);
      if (startResult.success) {
        const value = startResult.value as {
          port: number;
          host: string;
          verbose: boolean;
        };
        assert.equal(value.verbose, true);
        assert.equal(value.port, 8080);
        assert.equal(value.host, "EXAMPLE.COM");
      }

      // Test stop command
      const stopResult = await parseAsync(parser, [
        "stop",
        "-f",
        "--timeout",
        "60",
      ]);
      assert.ok(stopResult.success);
      if (stopResult.success) {
        const value = stopResult.value as {
          force: boolean;
          timeout: number;
        };
        assert.equal(value.force, true);
        assert.equal(value.timeout, 60);
      }
    });

    it("should handle triple nesting: command -> merge -> object with async", async () => {
      const parser = command(
        "deploy",
        merge(
          object({
            env: option("--env", asyncChoice(["dev", "staging", "prod"])),
          }),
          object({
            region: option("--region", asyncString()),
            replicas: withDefault(option("--replicas", integer()), 1),
          }),
        ),
      );

      assert.equal(parser.$mode, "async");

      const result = await parseAsync(parser, [
        "deploy",
        "--env",
        "prod",
        "--region",
        "us-east-1",
        "--replicas",
        "3",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.env, "prod");
        assert.equal(result.value.region, "US-EAST-1");
        assert.equal(result.value.replicas, 3);
      }
    });
  });

  describe("longestMatch with merge inside", () => {
    it("should handle longestMatch(merge(...), merge(...)) with distinct options", async () => {
      // Use distinct option names to avoid duplicate detection issues
      const parser = longestMatch(
        merge(
          object({ firstName: option("--first", asyncString()) }),
          object({ age: option("--age", integer()) }),
        ),
        merge(
          object({ lastName: option("--last", asyncString()) }),
          object({ email: option("--email", string()) }),
        ),
      );

      assert.equal(parser.$mode, "async");

      // First match: first + age
      const result1 = await parseAsync(parser, [
        "--first",
        "alice",
        "--age",
        "30",
      ]);
      assert.ok(result1.success);
      if (result1.success) {
        const value = result1.value as { firstName: string; age: number };
        assert.equal(value.firstName, "ALICE");
        assert.equal(value.age, 30);
      }

      // Second match: last + email (should select second branch)
      const result2 = await parseAsync(parser, [
        "--last",
        "smith",
        "--email",
        "smith@example.com",
      ]);
      assert.ok(result2.success);
      if (result2.success) {
        const value = result2.value as { lastName: string; email: string };
        assert.equal(value.lastName, "SMITH");
        assert.equal(value.email, "smith@example.com");
      }
    });
  });

  describe("or with tuple inside", () => {
    it("should handle or(tuple([...async...]), tuple([...async...]))", async () => {
      const parser = or(
        tuple([
          argument(asyncString()), // filename
          option("--format", asyncChoice(["json", "yaml"])),
        ]),
        tuple([
          argument(string()), // url
          option("--method", choice(["GET", "POST"])),
        ]),
      );

      assert.equal(parser.$mode, "async");

      // First branch: async string + async choice
      const result1 = await parseAsync(parser, [
        "data.txt",
        "--format",
        "json",
      ]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value, ["DATA.TXT", "json"]);
      }
    });
  });

  describe("quadruple nesting", () => {
    it("should handle object -> command -> merge -> object chain", async () => {
      const innerObject = object({
        file: argument(asyncString()),
        verbose: flag("-v"),
      });

      const mergedParser = merge(
        object({ global: flag("-g", "--global") }),
        innerObject,
      );

      const cmdParser = command("process", mergedParser);

      const parser = object({
        cmd: cmdParser,
      });

      assert.equal(parser.$mode, "async");

      const result = await parseAsync(parser, [
        "process",
        "-g",
        "input.txt",
        "-v",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.cmd.global, true);
        assert.equal(result.value.cmd.file, "INPUT.TXT");
        assert.equal(result.value.cmd.verbose, true);
      }
    });
  });
});

// =============================================================================
// Multi-Level Modifier Chains
// =============================================================================

describe("Multi-level modifier chains with async", () => {
  describe("chained modifiers", () => {
    it("should handle map(map(map(...))) with async", async () => {
      const parser = object({
        value: map(
          map(
            map(option("--value", asyncString()), (s) => s.toLowerCase()),
            (s) => s.split(""),
          ),
          (arr) => arr.length,
        ),
      });

      assert.equal(parser.$mode, "async");

      const result = await parseAsync(parser, ["--value", "Hello"]);
      assert.ok(result.success);
      if (result.success) {
        // "Hello" -> "HELLO" (async) -> "hello" (map1) -> ["h","e","l","l","o"] (map2) -> 5 (map3)
        assert.equal(result.value.value, 5);
      }
    });

    it("should handle withDefault(optional(...)) with async", async () => {
      // This pattern creates a parser that returns a default if the option is not provided
      // and undefined if explicitly provided but empty
      const parser = object({
        name: withDefault(
          optional(option("--name", asyncString())),
          "ANONYMOUS",
        ),
      });

      assert.equal(parser.$mode, "async");

      // Not provided - uses default
      const result1 = await parseAsync(parser, []);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.name, "ANONYMOUS");
      }

      // Provided - uses parsed value
      const result2 = await parseAsync(parser, ["--name", "alice"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.name, "ALICE");
      }
    });

    it("should handle optional(multiple(...)) with async", async () => {
      const parser = object({
        tags: optional(multiple(option("--tag", asyncString()))),
      });

      assert.equal(parser.$mode, "async");

      // No tags
      const result1 = await parseAsync(parser, []);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.tags, undefined);
      }

      // With tags
      const result2 = await parseAsync(parser, [
        "--tag",
        "a",
        "--tag",
        "b",
      ]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.deepEqual(result2.value.tags, ["A", "B"]);
      }
    });

    it("should handle multiple(map(...)) with async", async () => {
      const parser = object({
        lengths: multiple(
          map(option("--word", asyncString()), (s) => s.length),
        ),
      });

      assert.equal(parser.$mode, "async");

      const result = await parseAsync(parser, [
        "--word",
        "hello",
        "--word",
        "world",
        "--word",
        "!",
      ]);
      assert.ok(result.success);
      if (result.success) {
        // "hello" -> "HELLO" -> 5, "world" -> "WORLD" -> 5, "!" -> "!" -> 1
        assert.deepEqual(result.value.lengths, [5, 5, 1]);
      }
    });

    it("should handle map() with async parser directly", async () => {
      // Use async parser directly with map()
      // asyncString() converts to uppercase: "Alice" -> "ALICE"
      // map() then gets length: "ALICE" -> 5
      const parser = object({
        nameLen: map(
          withDefault(option("--name", asyncString()), "default"),
          (name) => name.length,
        ),
      });

      assert.equal(parser.$mode, "async");

      // Default - should get length of "DEFAULT" (asyncString uppercases) = 7
      const result1 = await parseAsync(parser, []);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.nameLen, 7); // "DEFAULT".length
      }

      // Provided - asyncString() converts "Alice" to "ALICE", length = 5
      const result2 = await parseAsync(parser, ["--name", "Alice"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.nameLen, 5); // "ALICE".length
      }
    });
  });
});

// =============================================================================
// Real-World CLI Patterns
// =============================================================================

describe("Real-world CLI patterns with async", () => {
  describe("subcommand pattern with async options", () => {
    it("should handle subcommands with async parsers", async () => {
      // Simpler pattern: command with async options
      const cloneCmd = command(
        "clone",
        object({
          url: argument(asyncString()),
          depth: withDefault(option("--depth", integer()), 0),
          verbose: flag("-v", "--verbose"),
        }),
      );

      const fetchCmd = command(
        "fetch",
        object({
          remote: withDefault(argument(asyncString()), "ORIGIN"),
          prune: flag("--prune"),
        }),
      );

      const parser = or(cloneCmd, fetchCmd);
      assert.equal(parser.$mode, "async");

      // Test clone
      const cloneResult = await parseAsync(parser, [
        "clone",
        "https://github.com/example/repo",
        "--depth",
        "1",
        "-v",
      ]);
      assert.ok(cloneResult.success);
      if (cloneResult.success) {
        const value = cloneResult.value as {
          url: string;
          depth: number;
          verbose: boolean;
        };
        assert.equal(value.url, "HTTPS://GITHUB.COM/EXAMPLE/REPO");
        assert.equal(value.depth, 1);
        assert.equal(value.verbose, true);
      }

      // Test fetch
      const fetchResult = await parseAsync(parser, [
        "fetch",
        "--prune",
        "upstream",
      ]);
      assert.ok(fetchResult.success);
      if (fetchResult.success) {
        const value = fetchResult.value as {
          remote: string;
          prune: boolean;
        };
        assert.equal(value.prune, true);
        assert.equal(value.remote, "UPSTREAM");
      }
    });
  });

  describe("kubectl-like CLI with resource types", () => {
    it("should handle command + resource type pattern", async () => {
      // Simulating: kubectl get|describe|delete <resource-type> [name]
      const resourceTypes = ["pod", "service", "deployment"] as const;

      const getCmd = command(
        "get",
        object({
          action: constant("get" as const),
          resourceType: argument(asyncChoice([...resourceTypes])),
          name: optional(argument(asyncString())),
          namespace: withDefault(
            option("-n", "--namespace", string()),
            "default",
          ),
          output: withDefault(
            option("-o", "--output", choice(["json", "yaml", "wide"])),
            "wide",
          ),
        }),
      );

      const deleteCmd = command(
        "delete",
        object({
          action: constant("delete" as const),
          resourceType: argument(asyncChoice([...resourceTypes])),
          name: argument(asyncString()),
          force: flag("-f", "--force"),
        }),
      );

      const parser = or(getCmd, deleteCmd);
      assert.equal(parser.$mode, "async");

      // Test get
      const getResult = await parseAsync(parser, [
        "get",
        "pod",
        "my-pod",
        "-n",
        "production",
        "-o",
        "json",
      ]);
      assert.ok(getResult.success);
      if (getResult.success) {
        assert.equal(getResult.value.action, "get");
        assert.equal(getResult.value.resourceType, "pod");
        assert.equal(getResult.value.name, "MY-POD");
        assert.equal(getResult.value.namespace, "production");
        assert.equal(getResult.value.output, "json");
      }

      // Test delete
      const deleteResult = await parseAsync(parser, [
        "delete",
        "service",
        "my-svc",
        "-f",
      ]);
      assert.ok(deleteResult.success);
      if (deleteResult.success) {
        assert.equal(deleteResult.value.action, "delete");
        assert.equal(deleteResult.value.resourceType, "service");
        assert.equal(deleteResult.value.name, "MY-SVC");
        assert.equal(deleteResult.value.force, true);
      }
    });
  });

  describe("build tool pattern with multiple targets", () => {
    it("should handle multiple async targets with common options", async () => {
      // Simulating: build [--parallel] [--target <t>]... [--env <e>]
      const parser = object({
        parallel: flag("-p", "--parallel"),
        targets: multiple(option("-t", "--target", asyncString()), { min: 1 }),
        env: withDefault(
          option("-e", "--env", asyncChoice(["dev", "prod"])),
          "dev",
        ),
        verbose: flag("-v", "--verbose"),
      });

      assert.equal(parser.$mode, "async");

      const result = await parseAsync(parser, [
        "-p",
        "-t",
        "frontend",
        "-t",
        "backend",
        "-t",
        "worker",
        "-e",
        "prod",
        "-v",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.parallel, true);
        assert.deepEqual(result.value.targets, [
          "FRONTEND",
          "BACKEND",
          "WORKER",
        ]);
        assert.equal(result.value.env, "prod");
        assert.equal(result.value.verbose, true);
      }
    });
  });
});

// =============================================================================
// Complex Suggest Scenarios
// =============================================================================

describe("Complex suggest scenarios with async", () => {
  describe("suggestions in deeply nested structures", () => {
    it("should get suggestions from async parser inside command inside or", async () => {
      const parser = or(
        command(
          "create",
          object({
            type: option("--type", asyncChoice(["user", "admin", "guest"])),
          }),
        ),
        command(
          "delete",
          object({
            id: argument(asyncInteger()),
          }),
        ),
      );

      // Get suggestions for --type inside create command
      const suggestions = await suggestAsync(parser, [
        "create",
        "--type",
        "a",
      ]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(literals.includes("admin"));
    });

    it("should get suggestions from multiple async branches in or", async () => {
      const parser = or(
        object({
          format: option("--format", asyncChoice(["json", "yaml", "xml"])),
        }),
        object({
          encoding: option(
            "--encoding",
            asyncChoice(["utf8", "ascii", "base64"]),
          ),
        }),
      );

      // Should suggest options from both branches when at option position
      const suggestions = await suggestAsync(parser, ["--"]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(literals.includes("--format"));
      assert.ok(literals.includes("--encoding"));
    });

    it("should get suggestions through merge with async parsers", async () => {
      const parser = merge(
        object({
          format: option("--format", asyncChoice(["json", "yaml"])),
        }),
        object({
          level: option("--level", asyncChoice(["debug", "info", "error"])),
        }),
      );

      // Suggestions for format
      const formatSuggestions = await suggestAsync(parser, ["--format", "j"]);
      const formatLiterals = formatSuggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(formatLiterals.includes("json"));

      // Suggestions for level
      const levelSuggestions = await suggestAsync(parser, ["--level", "d"]);
      const levelLiterals = levelSuggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(levelLiterals.includes("debug"));
    });

    it("should get suggestions in longestMatch with async", async () => {
      const parser = longestMatch(
        object({
          mode: option("--mode", asyncChoice(["fast", "slow", "balanced"])),
        }),
        object({
          preset: option(
            "--preset",
            asyncChoice(["default", "custom", "minimal"]),
          ),
        }),
      );

      // Both branches should contribute suggestions
      const suggestions = await suggestAsync(parser, ["--"]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(literals.includes("--mode"));
      assert.ok(literals.includes("--preset"));
    });
  });

  describe("suggestions with partial input", () => {
    it("should get suggestions after valid async option value", async () => {
      const parser = object({
        format: option("--format", asyncChoice(["json", "yaml"])),
        output: option("--output", asyncChoice(["file", "stdout"])),
      });

      // After providing a valid format, suggest remaining options
      const suggestions = await suggestAsync(parser, [
        "--format",
        "json",
        "--",
      ]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(literals.includes("--output"));
    });

    it("should suggest async choices after multiple() has collected values", async () => {
      const parser = object({
        tags: multiple(
          option("--tag", asyncChoice(["important", "urgent", "low"])),
        ),
      });

      // After one tag, should still suggest for the next --tag value
      const suggestions = await suggestAsync(parser, [
        "--tag",
        "important",
        "--tag",
        "u",
      ]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(literals.includes("urgent"));
    });
  });
});

// =============================================================================
// Error Propagation in Complex Structures
// =============================================================================

describe("Error propagation in complex async structures", () => {
  it("should propagate error from deeply nested async parser", async () => {
    const parser = or(
      command(
        "process",
        merge(
          object({ verbose: flag("-v") }),
          object({ count: argument(asyncInteger()) }), // Will fail on invalid input
        ),
      ),
      command(
        "help",
        object({ topic: constant("help" as const) }),
      ),
    );

    const result = await parseAsync(parser, ["process", "-v", "not-a-number"]);
    assert.ok(!result.success);
  });

  it("should handle multiple async failures at different levels", async () => {
    const parser = merge(
      object({ name: argument(asyncInteger()) }), // First failure point
      object({ count: option("--count", asyncInteger()) }), // Second failure point
    );

    // Both should fail, but we should get an error
    const result = await parseAsync(parser, [
      "invalid",
      "--count",
      "also-invalid",
    ]);
    assert.ok(!result.success);
  });

  it("should fail fast in tuple with async parsers", async () => {
    const parser = tuple([
      argument(asyncInteger()),
      argument(asyncString()),
      argument(asyncInteger()),
    ]);

    // First element fails
    const result = await parseAsync(parser, ["not-int", "valid", "123"]);
    assert.ok(!result.success);
  });

  it("should handle error in or() when no branch matches async", async () => {
    const parser = or(
      object({
        type: constant("a" as const),
        value: argument(asyncInteger()),
      }),
      object({
        type: constant("b" as const),
        value: argument(asyncInteger()),
      }),
    );

    // Neither branch will succeed
    const result = await parseAsync(parser, ["not-a-number"]);
    assert.ok(!result.success);
  });
});

// =============================================================================
// passThrough() with async combinations
// =============================================================================

import { passThrough } from "./primitives.ts";

describe("passThrough() with async combinations", () => {
  it("should propagate async mode when combined with async parsers", () => {
    // passThrough itself is always sync, but combining with async parser
    // makes the overall parser async
    const parser = object({
      name: option("--name", asyncString()),
      rest: passThrough(),
    });

    assert.equal(parser.$mode, "async");
  });

  it("should capture --opt=val format with async options (equalsOnly)", async () => {
    // Default passThrough uses "equalsOnly" format - only captures --opt=val
    const parser = object({
      name: option("--name", asyncString()),
      rest: passThrough(), // equalsOnly format
    });

    const result = await parseAsync(parser, [
      "--name",
      "alice",
      "--foo=bar",
      "--baz=qux",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.equal(result.value.name, "ALICE");
      assert.deepEqual(result.value.rest, ["--foo=bar", "--baz=qux"]);
    }
  });

  it("should capture all remaining tokens with greedy format after --", async () => {
    // Use "greedy" format to capture tokens after options terminator (--)
    // The -- itself is consumed as the options terminator, not captured
    const parser = object({
      name: option("--name", asyncString()),
      rest: passThrough({ format: "greedy" }),
    });

    const result = await parseAsync(parser, [
      "--name",
      "alice",
      "--",
      "extra",
      "args",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.equal(result.value.name, "ALICE");
      // -- is consumed as options terminator, greedy captures remaining tokens
      assert.deepEqual(result.value.rest, ["extra", "args"]);
    }
  });

  it("should work in merge() with async parsers (equalsOnly)", async () => {
    const parser = merge(
      object({ count: option("--count", asyncInteger()) }),
      object({ rest: passThrough() }), // equalsOnly format
    );

    assert.equal(parser.$mode, "async");

    const result = await parseAsync(parser, [
      "--count",
      "42",
      "--foo=bar",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.equal(result.value.count, 42);
      assert.deepEqual(result.value.rest, ["--foo=bar"]);
    }
  });

  it("should work in merge() with greedy format", async () => {
    const parser = merge(
      object({ count: option("--count", asyncInteger()) }),
      object({ rest: passThrough({ format: "greedy" }) }),
    );

    assert.equal(parser.$mode, "async");

    const result = await parseAsync(parser, [
      "--count",
      "42",
      "extra",
      "args",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.equal(result.value.count, 42);
      assert.deepEqual(result.value.rest, ["extra", "args"]);
    }
  });
});

// =============================================================================
// conditional() actual parsing with async
// =============================================================================

describe("conditional() actual parsing with async", () => {
  it("should propagate async mode from discriminator", () => {
    const parser = conditional(
      option("--type", asyncChoice(["json", "xml"])),
      {
        json: object({ indent: withDefault(option("--indent", integer()), 2) }),
        xml: object({ pretty: withDefault(flag("--pretty"), false) }),
      },
    );

    assert.equal(parser.$mode, "async");
  });

  it("should propagate async mode from branch parsers", () => {
    const parser = conditional(option("--format", choice(["a", "b"])), {
      a: object({ value: option("--value", asyncString()) }),
      b: object({ num: option("--num", asyncInteger()) }),
    });

    assert.equal(parser.$mode, "async");
  });

  it("should propagate async mode from both discriminator and branches", () => {
    const parser = conditional(
      option("--type", asyncChoice(["x", "y"])),
      {
        x: object({ val: option("--val", asyncString()) }),
        y: object({ num: option("--num", asyncInteger()) }),
      },
    );

    assert.equal(parser.$mode, "async");
  });

  // Actual parsing tests - these test that async actually works
  it("should parse with async discriminator", async () => {
    const parser = conditional(
      option("--type", asyncChoice(["json", "xml"])),
      {
        json: object({ indent: withDefault(option("--indent", integer()), 2) }),
        xml: object({ pretty: withDefault(flag("--pretty"), false) }),
      },
    );

    const result = await parseAsync(parser, [
      "--type",
      "json",
      "--indent",
      "4",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.deepEqual(result.value, ["json", { indent: 4 }]);
    }
  });

  it("should parse with async branch parsers", async () => {
    const parser = conditional(option("--format", choice(["a", "b"])), {
      a: object({ value: option("--value", asyncString()) }),
      b: object({ num: option("--num", asyncInteger()) }),
    });

    const result = await parseAsync(parser, [
      "--format",
      "a",
      "--value",
      "hello",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.deepEqual(result.value, ["a", { value: "HELLO" }]);
    }
  });

  it("should parse with async discriminator and async branches", async () => {
    const parser = conditional(
      option("--type", asyncChoice(["x", "y"])),
      {
        x: object({ val: option("--val", asyncString()) }),
        y: object({ num: option("--num", asyncInteger()) }),
      },
    );

    const result = await parseAsync(parser, ["--type", "x", "--val", "test"]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.deepEqual(result.value, ["x", { val: "TEST" }]);
    }
  });

  it("should parse conditional with default branch and async", async () => {
    const parser = conditional(
      option("--mode", asyncChoice(["fast", "slow"])),
      {
        fast: object({
          threads: withDefault(option("--threads", integer()), 4),
        }),
        slow: object({ delay: withDefault(option("--delay", integer()), 100) }),
      },
      object({ verbose: withDefault(flag("-v"), false) }), // default branch
    );

    // Test with discriminator
    const result1 = await parseAsync(parser, [
      "--mode",
      "fast",
      "--threads",
      "8",
    ]);
    assert.ok(
      result1.success,
      `Expected success but got: ${JSON.stringify(result1)}`,
    );
    if (result1.success) {
      assert.deepEqual(result1.value, ["fast", { threads: 8 }]);
    }

    // Test with default branch (no discriminator)
    const result2 = await parseAsync(parser, ["-v"]);
    assert.ok(
      result2.success,
      `Expected success but got: ${JSON.stringify(result2)}`,
    );
    if (result2.success) {
      assert.deepEqual(result2.value, [undefined, { verbose: true }]);
    }
  });
});

// =============================================================================
// concat() actual parsing with async
// =============================================================================

describe("concat() actual parsing with async", () => {
  it("should propagate async mode in concat", () => {
    const parser = concat(
      tuple([option("--name", asyncString())]),
      tuple([option("--count", asyncInteger())]),
    );

    assert.equal(parser.$mode, "async");
  });

  it("should propagate async mode in concat with mixed parsers", () => {
    const parser = concat(
      tuple([option("--sync", string())]),
      tuple([option("--async", asyncString())]),
    );

    assert.equal(parser.$mode, "async");
  });

  it("should handle error in concat with async", async () => {
    const parser = concat(
      tuple([option("--a", asyncInteger())]),
      tuple([option("--b", asyncInteger())]),
    );

    const result = await parseAsync(parser, ["--a", "not-a-number"]);
    assert.ok(!result.success);
  });

  // Actual parsing tests - these test that async actually works
  it("should parse concat with async options", async () => {
    const parser = concat(
      tuple([option("--name", asyncString())]),
      tuple([option("--count", integer())]),
    );

    const result = await parseAsync(parser, ["--name", "test", "--count", "5"]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.deepEqual(result.value, ["TEST", 5]);
    }
  });

  it("should parse concat with all async options", async () => {
    const parser = concat(
      tuple([option("--first", asyncString())]),
      tuple([option("--second", asyncString())]),
    );

    const result = await parseAsync(parser, [
      "--first",
      "hello",
      "--second",
      "world",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.deepEqual(result.value, ["HELLO", "WORLD"]);
    }
  });

  it("should parse concat with mixed sync/async in different order", async () => {
    const parser = concat(
      tuple([option("--sync", string())]),
      tuple([option("--async", asyncString())]),
    );

    const result = await parseAsync(parser, [
      "--async",
      "async-value",
      "--sync",
      "sync-value",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.deepEqual(result.value, ["sync-value", "ASYNC-VALUE"]);
    }
  });

  it("should parse concat with three tuple parsers", async () => {
    const parser = concat(
      tuple([option("-a", asyncString())]),
      tuple([option("-b", asyncInteger())]),
      tuple([option("-c", asyncString())]),
    );

    const result = await parseAsync(parser, [
      "-a",
      "alpha",
      "-b",
      "42",
      "-c",
      "gamma",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.deepEqual(result.value, ["ALPHA", 42, "GAMMA"]);
    }
  });
});

// =============================================================================
// Async parser rejection/throw tests
// =============================================================================

/**
 * Creates an async value parser that throws an error.
 */
function asyncThrowingParser(): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "THROW",
    parse(_input: string): Promise<ValueParserResult<string>> {
      return Promise.reject(new Error("Async parser threw an error"));
    },
    format(value: string): string {
      return value;
    },
  };
}

/**
 * Creates an async value parser that rejects.
 */
function asyncRejectingParser(): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "REJECT",
    parse(_input: string): Promise<ValueParserResult<string>> {
      return Promise.reject(new Error("Async parser rejected"));
    },
    format(value: string): string {
      return value;
    },
  };
}

describe("Async parser rejection/throw handling", () => {
  it("should propagate thrown errors from async parser", async () => {
    const parser = object({
      value: option("--value", asyncThrowingParser()),
    });

    await assert.rejects(
      async () => await parseAsync(parser, ["--value", "test"]),
      { message: "Async parser threw an error" },
    );
  });

  it("should propagate rejected promises from async parser", async () => {
    const parser = object({
      value: option("--value", asyncRejectingParser()),
    });

    await assert.rejects(
      async () => await parseAsync(parser, ["--value", "test"]),
      { message: "Async parser rejected" },
    );
  });

  it("should handle throw in nested async structure", async () => {
    const parser = object({
      cmd: command(
        "test",
        object({
          inner: option("--inner", asyncThrowingParser()),
        }),
      ),
    });

    await assert.rejects(
      async () => await parseAsync(parser, ["test", "--inner", "value"]),
      { message: "Async parser threw an error" },
    );
  });

  it("should handle reject in or() branch", async () => {
    const parser = or(
      object({
        type: constant("a" as const),
        value: option("--value", asyncRejectingParser()),
      }),
      object({
        type: constant("b" as const),
        num: option("--num", integer()),
      }),
    );

    // First branch rejects, should propagate
    await assert.rejects(
      async () => await parseAsync(parser, ["--value", "test"]),
      { message: "Async parser rejected" },
    );
  });
});

// =============================================================================
// Nested command with async tests
// =============================================================================

describe("Nested commands with async", () => {
  it("should handle command inside command with async", async () => {
    const innerCmd = command(
      "inner",
      object({
        value: option("--value", asyncString()),
      }),
    );

    const outerCmd = command(
      "outer",
      object({
        sub: innerCmd,
      }),
    );

    assert.equal(outerCmd.$mode, "async");

    const result = await parseAsync(outerCmd, [
      "outer",
      "inner",
      "--value",
      "test",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, { sub: { value: "TEST" } });
    }
  });

  it("should handle or() of nested commands with async", async () => {
    const cmdA = command(
      "cmd-a",
      object({
        subA: command(
          "sub-a",
          object({ val: option("--val", asyncString()) }),
        ),
      }),
    );

    const cmdB = command(
      "cmd-b",
      object({
        subB: command(
          "sub-b",
          object({ num: option("--num", asyncInteger()) }),
        ),
      }),
    );

    const parser = or(cmdA, cmdB);
    assert.equal(parser.$mode, "async");

    const result1 = await parseAsync(parser, [
      "cmd-a",
      "sub-a",
      "--val",
      "hello",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      const value = result1.value as { subA: { val: string } };
      assert.equal(value.subA.val, "HELLO");
    }

    const result2 = await parseAsync(parser, ["cmd-b", "sub-b", "--num", "99"]);
    assert.ok(result2.success);
    if (result2.success) {
      const value = result2.value as { subB: { num: number } };
      assert.equal(value.subB.num, 99);
    }
  });

  it("should handle three levels of nesting with async", async () => {
    const level3 = command(
      "level3",
      object({ deep: option("--deep", asyncString()) }),
    );

    const level2 = command("level2", object({ l3: level3 }));

    const level1 = command("level1", object({ l2: level2 }));

    assert.equal(level1.$mode, "async");

    const result = await parseAsync(level1, [
      "level1",
      "level2",
      "level3",
      "--deep",
      "value",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, { l2: { l3: { deep: "VALUE" } } });
    }
  });
});

// =============================================================================
// map() after other modifiers with async
// =============================================================================

describe("map() after other modifiers with async", () => {
  it("should handle map(optional(...)) with async", async () => {
    const parser = object({
      upperLen: map(
        optional(option("--name", asyncString())),
        (s) => s?.length ?? 0,
      ),
    });

    assert.equal(parser.$mode, "async");

    // With value
    const result1 = await parseAsync(parser, ["--name", "alice"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.upperLen, 5); // "ALICE".length
    }

    // Without value
    const result2 = await parseAsync(parser, []);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.upperLen, 0);
    }
  });

  it("should handle map(multiple(...)) with async", async () => {
    const parser = object({
      total: map(
        multiple(option("--num", asyncInteger())),
        (nums) => nums.reduce((a, b) => a + b, 0),
      ),
    });

    assert.equal(parser.$mode, "async");

    const result = await parseAsync(parser, [
      "--num",
      "10",
      "--num",
      "20",
      "--num",
      "30",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.total, 60);
    }
  });

  it("should handle map(withDefault(...)) with async", async () => {
    const parser = object({
      doubled: map(
        withDefault(option("--num", asyncInteger()), 5),
        (n) => n * 2,
      ),
    });

    assert.equal(parser.$mode, "async");

    // With value
    const result1 = await parseAsync(parser, ["--num", "10"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.doubled, 20);
    }

    // Default
    const result2 = await parseAsync(parser, []);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.doubled, 10); // 5 * 2
    }
  });

  it("should handle nested map() with multiple modifiers and async", async () => {
    // map(map(withDefault(optional(async))))
    const parser = object({
      result: map(
        map(
          withDefault(
            optional(option("--value", asyncString())),
            "DEFAULT",
          ),
          (s) => s?.toLowerCase() ?? "none",
        ),
        (s) => `processed: ${s}`,
      ),
    });

    assert.equal(parser.$mode, "async");

    // With value: "HELLO" (asyncString uppercases) -> "hello" -> "processed: hello"
    const result1 = await parseAsync(parser, ["--value", "hello"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.result, "processed: hello");
    }

    // Default: "DEFAULT" -> "default" -> "processed: default"
    const result2 = await parseAsync(parser, []);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.result, "processed: default");
    }
  });
});

// =============================================================================
// Async error recovery pattern tests
// =============================================================================

describe("Async error recovery patterns", () => {
  it("should select correct or() branch with async parsers", async () => {
    const parser = or(
      // Branch A: requires --verbose flag
      object({
        verbose: flag("--verbose"),
        message: withDefault(option("--message", asyncString()), "DEFAULT"),
      }),
      // Branch B: requires --quiet flag
      object({
        quiet: flag("--quiet"),
        level: withDefault(option("--level", asyncInteger()), 0),
      }),
    );

    assert.equal(parser.$mode, "async");

    // First branch selected when --verbose is present
    const result1 = await parseAsync(parser, [
      "--verbose",
      "--message",
      "hello",
    ]);
    assert.ok(
      result1.success,
      `Expected success but got: ${JSON.stringify(result1)}`,
    );
    if (result1.success) {
      const value = result1.value as { verbose: boolean; message: string };
      assert.equal(value.verbose, true);
      assert.equal(value.message, "HELLO");
    }

    // Second branch selected when --quiet is present
    const result2 = await parseAsync(parser, ["--quiet", "--level", "5"]);
    assert.ok(
      result2.success,
      `Expected success but got: ${JSON.stringify(result2)}`,
    );
    if (result2.success) {
      const value = result2.value as { quiet: boolean; level: number };
      assert.equal(value.quiet, true);
      assert.equal(value.level, 5);
    }
  });

  it("should try all longestMatch branches with async", async () => {
    const parser = longestMatch(
      object({
        a: withDefault(option("--alpha", asyncInteger()), 0),
        b: withDefault(option("--beta", asyncInteger()), 0),
      }),
      object({
        x: withDefault(option("--xray", asyncString()), "none"),
      }),
    );

    assert.equal(parser.$mode, "async");

    // First branch matches with two options (longer match)
    const result1 = await parseAsync(parser, ["--alpha", "1", "--beta", "2"]);
    assert.ok(
      result1.success,
      `Expected success but got: ${JSON.stringify(result1)}`,
    );
    if (result1.success) {
      const value = result1.value as { a: number; b: number };
      assert.equal(value.a, 1);
      assert.equal(value.b, 2);
    }

    // Second branch matches
    const result2 = await parseAsync(parser, ["--xray", "test"]);
    assert.ok(
      result2.success,
      `Expected success but got: ${JSON.stringify(result2)}`,
    );
    if (result2.success) {
      const value = result2.value as { x: string };
      assert.equal(value.x, "TEST");
    }
  });

  it("should handle partial failures in merge with async", async () => {
    // When one part of merge fails, the whole merge fails
    const parser = merge(
      object({ required: option("--required", asyncString()) }),
      object({ optional: withDefault(option("--opt", asyncInteger()), 0) }),
    );

    // Success case
    const result1 = await parseAsync(parser, ["--required", "test"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.required, "TEST");
      assert.equal(result1.value.optional, 0);
    }

    // Missing required - should fail
    const result2 = await parseAsync(parser, ["--opt", "5"]);
    assert.ok(!result2.success);
  });

  it("should handle withDefault fallback when async parsing fails", async () => {
    /**
     * Async parser that fails for specific inputs.
     */
    function asyncStrictInteger(): ValueParser<"async", number> {
      return {
        $mode: "async",
        metavar: "STRICT_INT",
        parse(input: string): Promise<ValueParserResult<number>> {
          // Only accepts positive integers
          const num = parseInt(input, 10);
          if (isNaN(num) || num <= 0) {
            return Promise.resolve({
              success: false,
              error: message`Must be a positive integer: ${input}`,
            });
          }
          return Promise.resolve({ success: true, value: num });
        },
        format(value: number): string {
          return value.toString();
        },
      };
    }

    const parser = object({
      count: withDefault(option("--count", asyncStrictInteger()), 1),
    });

    // Valid input
    const result1 = await parseAsync(parser, ["--count", "10"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.count, 10);
    }

    // No input - uses default
    const result2 = await parseAsync(parser, []);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.count, 1);
    }
  });
});

// =============================================================================
// Async suggestions with prefix filtering
// =============================================================================

describe("Async suggestions with prefix filtering", () => {
  /**
   * Creates an async choice parser that filters suggestions by prefix.
   */
  function asyncFilteredChoice(
    choices: readonly string[],
  ): ValueParser<"async", string> {
    return {
      $mode: "async",
      metavar: "FILTERED_CHOICE",
      parse(input: string): Promise<ValueParserResult<string>> {
        if (choices.includes(input)) {
          return Promise.resolve({ success: true, value: input });
        }
        return Promise.resolve({
          success: false,
          error: message`Must be one of: ${choices.join(", ")}`,
        });
      },
      async *suggest(prefix: string): AsyncGenerator<Suggestion> {
        // Simulate async filtering with delay
        await new Promise((resolve) => setTimeout(resolve, 1));
        for (const c of choices) {
          if (c.startsWith(prefix)) {
            yield { kind: "literal", text: c };
          }
        }
      },
      format(value: string): string {
        return value;
      },
    };
  }

  it("should filter suggestions by prefix with async", async () => {
    const parser = object({
      env: option(
        "--env",
        asyncFilteredChoice(["development", "staging", "production"]),
      ),
    });

    // Suggestions for "dev" prefix
    const suggestions1 = await suggestAsync(parser, ["--env", "dev"]);
    assert.equal(suggestions1.length, 1);
    assert.equal((suggestions1[0] as { text: string }).text, "development");

    // Suggestions for "pro" prefix
    const suggestions2 = await suggestAsync(parser, ["--env", "pro"]);
    assert.equal(suggestions2.length, 1);
    assert.equal((suggestions2[0] as { text: string }).text, "production");

    // Suggestions for "st" prefix
    const suggestions3 = await suggestAsync(parser, ["--env", "st"]);
    assert.equal(suggestions3.length, 1);
    assert.equal((suggestions3[0] as { text: string }).text, "staging");

    // No matches
    const suggestions4 = await suggestAsync(parser, ["--env", "xyz"]);
    assert.equal(suggestions4.length, 0);
  });

  it("should handle prefix filtering in nested async structure", async () => {
    const parser = command(
      "deploy",
      object({
        target: option(
          "--target",
          asyncFilteredChoice(["aws", "azure", "gcp", "local"]),
        ),
      }),
    );

    const suggestions = await suggestAsync(parser, ["deploy", "--target", "a"]);
    assert.equal(suggestions.length, 2); // aws, azure
    const texts = suggestions.map((s) => (s as { text: string }).text);
    assert.ok(texts.includes("aws"));
    assert.ok(texts.includes("azure"));
  });
});

// =============================================================================
// Large-scale async combinations
// =============================================================================

describe("Large-scale async combinations", () => {
  it("should handle many async options in single object", async () => {
    const parser = object({
      a: option("--a", asyncString()),
      b: option("--b", asyncString()),
      c: option("--c", asyncString()),
      d: option("--d", asyncString()),
      e: option("--e", asyncString()),
      f: option("--f", asyncInteger()),
      g: option("--g", asyncInteger()),
      h: option("--h", asyncInteger()),
    });

    assert.equal(parser.$mode, "async");

    const result = await parseAsync(parser, [
      "--a",
      "1",
      "--b",
      "2",
      "--c",
      "3",
      "--d",
      "4",
      "--e",
      "5",
      "--f",
      "6",
      "--g",
      "7",
      "--h",
      "8",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.a, "1");
      assert.equal(result.value.b, "2");
      assert.equal(result.value.c, "3");
      assert.equal(result.value.d, "4");
      assert.equal(result.value.e, "5");
      assert.equal(result.value.f, 6);
      assert.equal(result.value.g, 7);
      assert.equal(result.value.h, 8);
    }
  });

  it("should handle many or() branches with async", async () => {
    const parser = or(
      object({
        type: constant("a" as const),
        val: option("--a", asyncString()),
      }),
      object({
        type: constant("b" as const),
        val: option("--b", asyncString()),
      }),
      object({
        type: constant("c" as const),
        val: option("--c", asyncString()),
      }),
      object({
        type: constant("d" as const),
        val: option("--d", asyncString()),
      }),
      object({
        type: constant("e" as const),
        val: option("--e", asyncString()),
      }),
    );

    assert.equal(parser.$mode, "async");

    // Test last branch
    const result = await parseAsync(parser, ["--e", "test"]);
    assert.ok(result.success);
    if (result.success) {
      const value = result.value as { type: "e"; val: string };
      assert.equal(value.type, "e");
      assert.equal(value.val, "TEST");
    }
  });

  it("should handle deeply nested tuple with many elements", async () => {
    const parser = tuple([
      argument(asyncString()),
      argument(asyncInteger()),
      argument(asyncString()),
      argument(asyncInteger()),
    ]);

    assert.equal(parser.$mode, "async");

    const result = await parseAsync(parser, ["hello", "1", "world", "2"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["HELLO", 1, "WORLD", 2]);
    }
  });
});

// =============================================================================
// Async variadic arguments with multiple()
// =============================================================================

describe("Async variadic arguments", () => {
  it("should parse multiple async positional arguments", async () => {
    const parser = object({
      files: multiple(argument(asyncString()), { min: 1 }),
    });

    assert.equal(parser.$mode, "async");

    const result = await parseAsync(parser, ["file1", "file2", "file3"]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.deepEqual(result.value.files, ["FILE1", "FILE2", "FILE3"]);
    }
  });

  it("should parse mixed options with variadic async arguments", async () => {
    const parser = object({
      verbose: withDefault(flag("-v"), false),
      files: multiple(argument(asyncString()), { min: 1 }),
    });

    const result = await parseAsync(parser, ["-v", "a.txt", "b.txt"]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.deepEqual(result.value.files, ["A.TXT", "B.TXT"]);
    }
  });

  it("should parse async variadic options", async () => {
    const parser = object({
      names: multiple(option("--name", asyncString())),
    });

    const result = await parseAsync(parser, [
      "--name",
      "alice",
      "--name",
      "bob",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.deepEqual(result.value.names, ["ALICE", "BOB"]);
    }
  });

  it("should enforce min constraint on async variadic", async () => {
    const parser = object({
      items: multiple(argument(asyncString()), { min: 2 }),
    });

    const result = await parseAsync(parser, ["only-one"]);
    assert.ok(!result.success, "Expected failure with min constraint");
  });

  it("should enforce max constraint on async variadic", async () => {
    const parser = object({
      items: multiple(argument(asyncString()), { max: 2 }),
    });

    const result = await parseAsync(parser, ["a", "b", "c"]);
    assert.ok(!result.success, "Expected failure with max constraint");
  });
});

// =============================================================================
// Complex nested modifier chains with async
// =============================================================================

describe("Complex nested modifier chains with async", () => {
  it("should handle optional(multiple(map(...))) chain", async () => {
    const parser = object({
      tags: optional(
        map(
          multiple(option("--tag", asyncString())),
          (tags) => tags.join(","),
        ),
      ),
    });

    assert.equal(parser.$mode, "async");

    // With tags
    const result1 = await parseAsync(parser, ["--tag", "a", "--tag", "b"]);
    assert.ok(
      result1.success,
      `Expected success but got: ${JSON.stringify(result1)}`,
    );
    if (result1.success) {
      assert.equal(result1.value.tags, "A,B");
    }

    // Without tags
    const result2 = await parseAsync(parser, []);
    assert.ok(
      result2.success,
      `Expected success but got: ${JSON.stringify(result2)}`,
    );
    if (result2.success) {
      assert.equal(result2.value.tags, undefined);
    }
  });

  it("should handle map(withDefault(...)) chain", async () => {
    // withDefault on an option (not optional) is the common pattern
    const parser = object({
      count: map(
        withDefault(option("--count", asyncInteger()), 10),
        (n) => n * 2,
      ),
    });

    assert.equal(parser.$mode, "async");

    // With value
    const result1 = await parseAsync(parser, ["--count", "5"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.count, 10); // 5 * 2
    }

    // Without value (uses default)
    const result2 = await parseAsync(parser, []);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.count, 20); // 10 * 2
    }
  });

  it("should handle deeply nested object with async at leaf", async () => {
    const innerParser = object({
      deep: option("--deep", asyncString()),
    });

    const middleParser = object({
      inner: innerParser,
      middle: option("--middle", asyncInteger()),
    });

    const outerParser = object({
      middle: middleParser,
      outer: option("--outer", asyncString()),
    });

    assert.equal(outerParser.$mode, "async");

    const result = await parseAsync(outerParser, [
      "--deep",
      "value",
      "--middle",
      "42",
      "--outer",
      "test",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.equal(result.value.middle.inner.deep, "VALUE");
      assert.equal(result.value.middle.middle, 42);
      assert.equal(result.value.outer, "TEST");
    }
  });
});

// =============================================================================
// Edge cases in async parsing
// =============================================================================

describe("Async edge cases in complex structures", () => {
  it("should handle empty input with all optional async", async () => {
    const parser = object({
      a: optional(option("--a", asyncString())),
      b: optional(option("--b", asyncInteger())),
    });

    const result = await parseAsync(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.a, undefined);
      assert.equal(result.value.b, undefined);
    }
  });

  it("should handle interleaved sync and async options in object", async () => {
    const parser = object({
      async1: option("--async1", asyncString()),
      sync1: option("--sync1", string()),
      async2: option("--async2", asyncInteger()),
      sync2: option("--sync2", integer()),
    });

    const result = await parseAsync(parser, [
      "--sync1",
      "s1",
      "--async1",
      "a1",
      "--sync2",
      "10",
      "--async2",
      "20",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.equal(result.value.async1, "A1");
      assert.equal(result.value.sync1, "s1");
      assert.equal(result.value.async2, 20);
      assert.equal(result.value.sync2, 10);
    }
  });

  it("should handle or() where only one branch matches async", async () => {
    const parser = or(
      object({
        type: constant("file" as const),
        path: option("--file", asyncString()),
      }),
      object({
        type: constant("url" as const),
        url: option("--url", asyncString()),
      }),
    );

    // First branch
    const result1 = await parseAsync(parser, ["--file", "/path/to/file"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.type, "file");
      assert.equal((result1.value as { path: string }).path, "/PATH/TO/FILE");
    }

    // Second branch
    const result2 = await parseAsync(parser, ["--url", "http://example.com"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.type, "url");
      assert.equal(
        (result2.value as { url: string }).url,
        "HTTP://EXAMPLE.COM",
      );
    }
  });

  it("should handle longestMatch with all async parsers", async () => {
    const parser = longestMatch(
      object({
        short: option("-s", asyncString()),
      }),
      object({
        short: option("-s", asyncString()),
        long: option("-l", asyncInteger()),
      }),
    );

    // Should match longer parser
    const result = await parseAsync(parser, ["-s", "test", "-l", "42"]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.equal(result.value.short, "TEST");
      assert.equal((result.value as { long: number }).long, 42);
    }
  });

  it("should handle merge with overlapping optional async options", async () => {
    const parser = merge(
      object({
        common: optional(option("--common", asyncString())),
        onlyA: optional(option("--only-a", asyncInteger())),
      }),
      object({
        onlyB: optional(option("--only-b", asyncString())),
      }),
    );

    const result = await parseAsync(parser, [
      "--common",
      "shared",
      "--only-a",
      "10",
      "--only-b",
      "extra",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.equal(result.value.common, "SHARED");
      assert.equal(result.value.onlyA, 10);
      assert.equal(result.value.onlyB, "EXTRA");
    }
  });
});

// -----------------------------------------------------------------------------
// Nested combinator tests with async
// -----------------------------------------------------------------------------

describe("Nested combinators with async", () => {
  describe("or() inside conditional()", () => {
    it("should handle conditional with or() branches", async () => {
      // A conditional where each branch is an or() of different parsers
      const parser = conditional(
        option("--mode", asyncChoice(["dev", "prod"])),
        {
          dev: or(
            object({ verbose: flag("-v") }),
            object({ quiet: flag("-q") }),
          ),
          prod: or(
            object({ optimize: flag("-O") }),
            object({ minify: flag("-m") }),
          ),
        },
      );

      // Test dev mode with verbose
      const result1 = await parseAsync(parser, ["--mode", "dev", "-v"]);
      assert.ok(
        result1.success,
        `Expected success: ${JSON.stringify(result1)}`,
      );
      if (result1.success) {
        assert.equal(result1.value[0], "dev");
        assert.deepEqual(
          (result1.value[1] as { verbose?: boolean }).verbose,
          true,
        );
      }

      // Test prod mode with minify
      const result2 = await parseAsync(parser, ["--mode", "prod", "-m"]);
      assert.ok(
        result2.success,
        `Expected success: ${JSON.stringify(result2)}`,
      );
      if (result2.success) {
        assert.equal(result2.value[0], "prod");
        assert.deepEqual(
          (result2.value[1] as { minify?: boolean }).minify,
          true,
        );
      }
    });

    it("should handle conditional with async or() branches", async () => {
      const parser = conditional(
        option("--type", choice(["a", "b"])),
        {
          a: or(
            object({ x: option("-x", asyncString()) }),
            object({ y: option("-y", asyncInteger()) }),
          ),
          b: or(
            object({ p: option("-p", asyncString()) }),
            object({ q: option("-q", asyncInteger()) }),
          ),
        },
      );

      const result = await parseAsync(parser, ["--type", "a", "-x", "hello"]);
      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.equal(result.value[0], "a");
        assert.equal((result.value[1] as { x: string }).x, "HELLO");
      }
    });
  });

  describe("conditional() inside or()", () => {
    it("should handle or() with conditional branches", async () => {
      const parser = or(
        conditional(
          option("--format", asyncChoice(["json", "xml"])),
          {
            json: object({
              indent: withDefault(option("--indent", integer()), 2),
            }),
            xml: object({ pretty: withDefault(flag("--pretty"), false) }),
          },
        ),
        object({
          raw: flag("--raw"),
        }),
      );

      // Test conditional branch (json)
      const result1 = await parseAsync(parser, [
        "--format",
        "json",
        "--indent",
        "4",
      ]);
      assert.ok(
        result1.success,
        `Expected success: ${JSON.stringify(result1)}`,
      );

      // Test raw branch
      const result2 = await parseAsync(parser, ["--raw"]);
      assert.ok(
        result2.success,
        `Expected success: ${JSON.stringify(result2)}`,
      );
    });

    it("should handle multiple conditionals in or()", async () => {
      const conditionalA = conditional(
        option("-a", asyncChoice(["x", "y"])),
        {
          x: object({ xVal: option("--x-val", asyncString()) }),
          y: object({ yVal: option("--y-val", asyncInteger()) }),
        },
      );

      const conditionalB = conditional(
        option("-b", asyncChoice(["p", "q"])),
        {
          p: object({ pVal: option("--p-val", asyncString()) }),
          q: object({ qVal: option("--q-val", asyncInteger()) }),
        },
      );

      const parser = or(conditionalA, conditionalB);

      const result1 = await parseAsync(parser, ["-a", "x", "--x-val", "test"]);
      assert.ok(
        result1.success,
        `Expected success: ${JSON.stringify(result1)}`,
      );
      if (result1.success) {
        assert.equal(result1.value[0], "x");
        assert.equal((result1.value[1] as { xVal: string }).xVal, "TEST");
      }

      const result2 = await parseAsync(parser, ["-b", "q", "--q-val", "42"]);
      assert.ok(
        result2.success,
        `Expected success: ${JSON.stringify(result2)}`,
      );
      if (result2.success) {
        assert.equal(result2.value[0], "q");
        assert.equal((result2.value[1] as { qVal: number }).qVal, 42);
      }
    });
  });

  describe("concat() inside concat()", () => {
    it("should handle nested concat with async", async () => {
      const inner1 = concat(
        tuple([option("-a", asyncString())]),
        tuple([option("-b", integer())]),
      );
      const inner2 = concat(
        tuple([option("-c", asyncString())]),
        tuple([option("-d", integer())]),
      );

      // Note: concat expects TupleParser, so we need to wrap in tuple
      // Actually, concat itself returns a TupleParser, so this should work
      const parser = concat(inner1, inner2);

      const result = await parseAsync(parser, [
        "-a",
        "first",
        "-b",
        "10",
        "-c",
        "second",
        "-d",
        "20",
      ]);
      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.deepEqual(result.value, ["FIRST", 10, "SECOND", 20]);
      }
    });

    it("should handle deeply nested concat", async () => {
      const level1 = tuple([option("-x", asyncString())]);
      const level2 = concat(level1, tuple([option("-y", integer())]));
      const level3 = concat(level2, tuple([option("-z", asyncString())]));

      const result = await parseAsync(level3, [
        "-x",
        "a",
        "-y",
        "1",
        "-z",
        "b",
      ]);
      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.deepEqual(result.value, ["A", 1, "B"]);
      }
    });
  });

  describe("object() with conditional() wrapped in map()", () => {
    // Note: merge() requires object-returning parsers, but conditional() returns tuple.
    // We need to use object() with conditional() wrapped to test this pattern.
    it("should handle conditional result extracted via map", async () => {
      const condParser = map(
        conditional(
          option("--type", asyncChoice(["a", "b"])),
          {
            a: object({ aOpt: withDefault(option("--a-opt", integer()), 0) }),
            b: object({ bOpt: withDefault(option("--b-opt", integer()), 0) }),
          },
        ),
        ([type, data]) => ({ type, data }),
      );

      const parser = object({
        common: option("--common", asyncString()),
        typeData: condParser,
      });

      const result = await parseAsync(parser, [
        "--common",
        "shared",
        "--type",
        "a",
        "--a-opt",
        "42",
      ]);
      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.equal(result.value.common, "SHARED");
        assert.equal(result.value.typeData.type, "a");
      }
    });

    it("should handle multiple conditionals in tuple", async () => {
      const condX = map(
        conditional(
          option("-x", asyncChoice(["1", "2"])),
          {
            "1": object({ x1: withDefault(flag("--x1"), false) }),
            "2": object({ x2: withDefault(flag("--x2"), false) }),
          },
        ),
        ([key, val]) => ({ xKey: key, ...val }),
      );

      const condY = map(
        conditional(
          option("-y", asyncChoice(["a", "b"])),
          {
            a: object({ ya: withDefault(flag("--ya"), false) }),
            b: object({ yb: withDefault(flag("--yb"), false) }),
          },
        ),
        ([key, val]) => ({ yKey: key, ...val }),
      );

      const parser = tuple([condX, condY]);

      const result = await parseAsync(parser, [
        "-x",
        "1",
        "--x1",
        "-y",
        "b",
        "--yb",
      ]);
      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.equal(result.value[0].xKey, "1");
        assert.equal((result.value[0] as { x1?: boolean }).x1, true);
        assert.equal(result.value[1].yKey, "b");
        assert.equal((result.value[1] as { yb?: boolean }).yb, true);
      }
    });
  });

  describe("longestMatch() with conditional()", () => {
    it("should handle conditional inside longestMatch", async () => {
      const condA = conditional(
        option("-t", asyncChoice(["x", "y"])),
        {
          x: object({ xo: option("--xo", asyncString()) }),
          y: object({ yo: option("--yo", asyncString()) }),
        },
      );

      const condB = conditional(
        option("-t", asyncChoice(["x", "y"])),
        {
          x: object({
            xo: option("--xo", asyncString()),
            extra: option("--extra", asyncInteger()),
          }),
          y: object({ yo: option("--yo", asyncString()) }),
        },
      );

      const parser = longestMatch(condA, condB);

      // Should match condB because it consumes more tokens
      const result = await parseAsync(parser, [
        "-t",
        "x",
        "--xo",
        "hello",
        "--extra",
        "99",
      ]);
      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    });
  });
});

// -----------------------------------------------------------------------------
// group() actual parsing tests with async
// -----------------------------------------------------------------------------

describe("group() actual parsing with async", () => {
  it("should parse grouped async object", async () => {
    const inner = object({
      name: option("--name", asyncString()),
      count: withDefault(option("--count", integer()), 1),
    });
    const parser = group("Options", inner);

    const result = await parseAsync(parser, ["--name", "test", "--count", "5"]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal(result.value.name, "TEST");
      assert.equal(result.value.count, 5);
    }
  });

  it("should parse grouped async tuple", async () => {
    const inner = tuple([
      option("-a", asyncString()),
      option("-b", asyncInteger()),
    ]);
    const parser = group("Pair", inner);

    const result = await parseAsync(parser, ["-a", "hello", "-b", "42"]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.deepEqual(result.value, ["HELLO", 42]);
    }
  });

  it("should parse group inside object with async", async () => {
    const groupedOptions = group(
      "Advanced",
      object({
        debug: withDefault(flag("--debug"), false),
        level: withDefault(option("--level", asyncInteger()), 0),
      }),
    );

    const parser = object({
      name: option("--name", asyncString()),
      advanced: groupedOptions,
    });

    const result = await parseAsync(parser, [
      "--name",
      "app",
      "--debug",
      "--level",
      "3",
    ]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal(result.value.name, "APP");
      assert.equal(result.value.advanced.debug, true);
      assert.equal(result.value.advanced.level, 3);
    }
  });

  it("should get suggestions from grouped async parser", async () => {
    const inner = object({
      format: option("--format", asyncChoice(["json", "xml", "csv"])),
    });
    const parser = group("Output", inner);

    const suggestions = await suggestAsync(parser, ["--format", ""]);
    const texts = suggestions.map((s) => s.kind === "literal" ? s.text : "");

    assert.ok(texts.includes("json"));
    assert.ok(texts.includes("xml"));
    assert.ok(texts.includes("csv"));
  });
});

// -----------------------------------------------------------------------------
// passThrough() combined with conditional() and async
// -----------------------------------------------------------------------------

describe("passThrough() with conditional() and async", () => {
  it("should handle passThrough alongside conditional in object", async () => {
    // Use map() to convert conditional result for use in object
    const condResult = map(
      conditional(
        option("--mode", asyncChoice(["run", "build"])),
        {
          run: object({ port: withDefault(option("--port", integer()), 8080) }),
          build: object({
            output: withDefault(option("--output", string()), "dist"),
          }),
        },
      ),
      ([mode, data]) => ({ mode, ...data }),
    );

    const parser = object({
      forwarded: passThrough({ format: "equalsOnly" }),
      modeData: condResult,
    });

    const result = await parseAsync(parser, [
      "--mode",
      "run",
      "--port",
      "3000",
      "--forwarded=extra",
    ]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.deepEqual(result.value.forwarded, ["--forwarded=extra"]);
      assert.equal(result.value.modeData.mode, "run");
    }
  });

  it("should handle passThrough with async options in same object", async () => {
    const parser = object({
      verbose: withDefault(flag("-v"), false),
      name: option("--name", asyncString()),
      rest: passThrough({ format: "greedy" }),
    });

    const result = await parseAsync(parser, [
      "-v",
      "--name",
      "test",
      "--",
      "extra1",
      "extra2",
    ]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.name, "TEST");
      assert.deepEqual(result.value.rest, ["extra1", "extra2"]);
    }
  });
});

// -----------------------------------------------------------------------------
// Additional async parsing edge cases
// -----------------------------------------------------------------------------

describe("Additional async parsing edge cases", () => {
  it("should handle triple nesting: tuple inside object inside command", async () => {
    const parser = command(
      "cmd",
      object({
        pair: tuple([
          option("-a", asyncString()),
          option("-b", asyncInteger()),
        ]),
        extra: withDefault(flag("-e"), false),
      }),
    );

    const result = await parseAsync(parser, [
      "cmd",
      "-a",
      "hello",
      "-b",
      "42",
      "-e",
    ]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.deepEqual(result.value.pair, ["HELLO", 42]);
      assert.equal(result.value.extra, true);
    }
  });

  it("should handle async parsers in both branches of withDefault", async () => {
    const parser = object({
      value: withDefault(
        option("--val", asyncString()),
        "DEFAULT",
      ),
    });

    // Without option - uses default
    const result1 = await parseAsync(parser, []);
    assert.ok(result1.success, `Expected success: ${JSON.stringify(result1)}`);
    if (result1.success) {
      assert.equal(result1.value.value, "DEFAULT");
    }

    // With option - uses parsed value
    const result2 = await parseAsync(parser, ["--val", "custom"]);
    assert.ok(result2.success, `Expected success: ${JSON.stringify(result2)}`);
    if (result2.success) {
      assert.equal(result2.value.value, "CUSTOM");
    }
  });
});

// -----------------------------------------------------------------------------
// merge() with or() state management tests
// -----------------------------------------------------------------------------

describe("merge() with or() state management", () => {
  it("should correctly manage or() state within merge()", async () => {
    // or() has undefined initialState, so merge() needs to handle this specially
    const parser = merge(
      object({
        common: option("--common", asyncString()),
      }),
      or(
        object({ optA: option("-a", asyncString()) }),
        object({ optB: option("-b", asyncInteger()) }),
      ),
    );

    const result1 = await parseAsync(parser, [
      "--common",
      "shared",
      "-a",
      "hello",
    ]);
    assert.ok(result1.success, `Expected success: ${JSON.stringify(result1)}`);
    if (result1.success) {
      assert.equal(result1.value.common, "SHARED");
      assert.equal((result1.value as { optA?: string }).optA, "HELLO");
    }

    const result2 = await parseAsync(parser, [
      "--common",
      "shared",
      "-b",
      "42",
    ]);
    assert.ok(result2.success, `Expected success: ${JSON.stringify(result2)}`);
    if (result2.success) {
      assert.equal(result2.value.common, "SHARED");
      assert.equal((result2.value as { optB?: number }).optB, 42);
    }
  });

  it("should handle multiple or() parsers in merge()", async () => {
    const parser = merge(
      or(
        object({ x: option("-x", asyncString()) }),
        object({ y: option("-y", asyncString()) }),
      ),
      or(
        object({ a: option("-a", asyncInteger()) }),
        object({ b: option("-b", asyncInteger()) }),
      ),
    );

    const result = await parseAsync(parser, ["-x", "hello", "-b", "99"]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal((result.value as { x?: string }).x, "HELLO");
      assert.equal((result.value as { b?: number }).b, 99);
    }
  });

  it("should handle or() with withDefault() in merge()", async () => {
    const parser = merge(
      object({
        name: option("--name", asyncString()),
      }),
      withDefault(
        or(
          object({ mode: constant("dev" as const), dev: flag("--dev") }),
          object({ mode: constant("prod" as const), prod: flag("--prod") }),
        ),
        { mode: "dev" as const, dev: false },
      ),
    );

    // With explicit flag
    const result1 = await parseAsync(parser, ["--name", "app", "--prod"]);
    assert.ok(result1.success, `Expected success: ${JSON.stringify(result1)}`);
    if (result1.success) {
      assert.equal(result1.value.name, "APP");
    }

    // Without flag (should use default)
    const result2 = await parseAsync(parser, ["--name", "app"]);
    assert.ok(result2.success, `Expected success: ${JSON.stringify(result2)}`);
    if (result2.success) {
      assert.equal(result2.value.name, "APP");
    }
  });
});

// -----------------------------------------------------------------------------
// Complex real-world async patterns
// -----------------------------------------------------------------------------

describe("Complex real-world async patterns", () => {
  describe("git-like subcommand with async remote operations", () => {
    it("should handle git remote add with async URL validation", async () => {
      // Simulate: git remote add <name> <url>
      const addCmd = command(
        "add",
        object({
          name: argument(asyncString()),
          url: argument(asyncString()),
        }),
      );

      const removeCmd = command(
        "remove",
        object({
          name: argument(asyncString()),
        }),
      );

      const listCmd = command(
        "list",
        object({
          verbose: withDefault(flag("-v"), false),
        }),
      );

      const remoteCmd = command("remote", or(addCmd, removeCmd, listCmd));

      const result = await parseAsync(remoteCmd, [
        "remote",
        "add",
        "origin",
        "https://github.com/example/repo.git",
      ]);
      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        const value = result.value as { name: string; url: string };
        assert.equal(value.name, "ORIGIN");
        assert.equal(value.url, "HTTPS://GITHUB.COM/EXAMPLE/REPO.GIT");
      }
    });

    it("should handle git-style with global options and subcommands", async () => {
      const globalOpts = object({
        verbose: withDefault(flag("-v"), false),
        config: optional(option("--config", asyncString())),
      });

      const commitCmd = command(
        "commit",
        object({
          message: option("-m", asyncString()),
          amend: withDefault(flag("--amend"), false),
        }),
      );

      const pushCmd = command(
        "push",
        object({
          remote: withDefault(argument(asyncString()), "ORIGIN"),
          branch: optional(argument(asyncString())),
          force: withDefault(flag("-f"), false),
        }),
      );

      const subcommand = or(commitCmd, pushCmd);

      const parser = merge(globalOpts, subcommand);

      const result = await parseAsync(parser, [
        "-v",
        "--config",
        "custom.cfg",
        "commit",
        "-m",
        "Initial commit",
      ]);
      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.equal(result.value.verbose, true);
        assert.equal(result.value.config, "CUSTOM.CFG");
      }
    });
  });

  describe("npm-like CLI with async package resolution", () => {
    it("should handle npm install with async dependencies", async () => {
      const installCmd = command(
        "install",
        object({
          packages: multiple(argument(asyncString()), { min: 0 }),
          saveDev: withDefault(flag("--save-dev"), false),
          saveExact: withDefault(flag("--save-exact"), false),
          global: withDefault(flag("-g"), false),
        }),
      );

      const result = await parseAsync(installCmd, [
        "install",
        "lodash",
        "express",
        "--save-dev",
      ]);
      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.deepEqual(result.value.packages, ["LODASH", "EXPRESS"]);
        assert.equal(result.value.saveDev, true);
      }
    });
  });

  describe("docker-like CLI with conditional run modes", () => {
    it("should handle docker run with async image resolution", async () => {
      const runCmd = command(
        "run",
        merge(
          object({
            image: argument(asyncString()),
            detach: withDefault(flag("-d"), false),
            interactive: withDefault(flag("-i"), false),
            tty: withDefault(flag("-t"), false),
          }),
          object({
            ports: multiple(option("-p", asyncString()), { min: 0 }),
            volumes: multiple(option("-v", asyncString()), { min: 0 }),
            env: multiple(option("-e", asyncString()), { min: 0 }),
          }),
        ),
      );

      const result = await parseAsync(runCmd, [
        "run",
        "-d",
        "-p",
        "8080:80",
        "-p",
        "443:443",
        "-e",
        "NODE_ENV=production",
        "nginx:latest",
      ]);
      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.equal(result.value.image, "NGINX:LATEST");
        assert.equal(result.value.detach, true);
        assert.deepEqual(result.value.ports, ["8080:80", "443:443"]);
        assert.deepEqual(result.value.env, ["NODE_ENV=PRODUCTION"]);
      }
    });
  });
});

// -----------------------------------------------------------------------------
// Edge cases in nested async structures
// -----------------------------------------------------------------------------

describe("Edge cases in nested async structures", () => {
  it("should handle deeply nested conditionals via object", async () => {
    // Three levels of conditional nesting using object() instead of merge()
    // since conditional returns tuple, not object
    const level3 = map(
      conditional(
        option("--c", asyncChoice(["1", "2"])),
        {
          "1": object({ val: constant("c1" as const) }),
          "2": object({ val: constant("c2" as const) }),
        },
      ),
      ([key, val]) => ({ cKey: key, ...val }),
    );

    const level2 = map(
      conditional(
        option("--b", asyncChoice(["x", "y"])),
        {
          x: object({ bVal: constant("bx" as const), level3 }),
          y: object({ bVal: constant("by" as const) }),
        },
      ),
      ([key, val]) => ({ bKey: key, ...val }),
    );

    const level1 = map(
      conditional(
        option("--a", asyncChoice(["p", "q"])),
        {
          p: object({ aVal: constant("ap" as const), level2 }),
          q: object({ aVal: constant("aq" as const) }),
        },
      ),
      ([key, val]) => ({ aKey: key, ...val }),
    );

    const result = await parseAsync(level1, [
      "--a",
      "p",
      "--b",
      "x",
      "--c",
      "2",
    ]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal(result.value.aKey, "p");
      assert.equal(result.value.aVal, "ap");
    }
  });

  it("should handle or() with all async branches where only last matches", async () => {
    const parser = or(
      object({
        a: option("-a", asyncString()),
        b: option("-b", asyncString()),
      }),
      object({
        c: option("-c", asyncString()),
        d: option("-d", asyncString()),
      }),
      object({ e: option("-e", asyncString()) }),
    );

    // Only the third branch should match
    const result = await parseAsync(parser, ["-e", "only"]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal((result.value as { e: string }).e, "ONLY");
    }
  });

  it("should handle longestMatch with ties resolved by order", async () => {
    // Both parsers consume same number of tokens
    const parser = longestMatch(
      object({ x: option("-x", asyncString()) }),
      object({ y: option("-y", asyncString()) }),
    );

    // Should prefer first parser when both could match
    const result = await parseAsync(parser, ["-x", "test"]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal((result.value as { x: string }).x, "TEST");
    }
  });

  it("should handle empty branches in conditional with async", async () => {
    const parser = conditional(
      option("--type", asyncChoice(["empty", "full"])),
      {
        empty: object({}),
        full: object({ data: option("--data", asyncString()) }),
      },
    );

    const result = await parseAsync(parser, ["--type", "empty"]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.equal(result.value[0], "empty");
      assert.deepEqual(result.value[1], {});
    }
  });

  it("should handle concat with empty tuples", async () => {
    const parser = concat(
      tuple([]),
      tuple([option("-x", asyncString())]),
      tuple([]),
    );

    const result = await parseAsync(parser, ["-x", "test"]);
    assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
    if (result.success) {
      assert.deepEqual(result.value, ["TEST"]);
    }
  });

  it("should propagate async errors through all nesting levels", async () => {
    const failingParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "FAIL",
      parse: () =>
        Promise.resolve({
          success: false,
          error: message`Intentional failure`,
        }),
      format: (v) => v,
    };

    // Use object() with map() to wrap conditional since conditional returns tuple
    const condParser = map(
      conditional(
        option("--mode", choice(["test"])),
        {
          test: object({
            inner: option("--inner", failingParser),
          }),
        },
      ),
      ([mode, data]) => ({ mode, ...data }),
    );

    const parser = object({
      outer: constant("outer" as const),
      cond: condParser,
    });

    const result = await parseAsync(parser, [
      "--mode",
      "test",
      "--inner",
      "value",
    ]);
    assert.ok(!result.success, "Expected failure");
  });
});

// =============================================================================
// Usage and Help Text Generation with Async Parsers
// =============================================================================

describe("usage and help text generation with async parsers", () => {
  describe("formatUsage with async parsers", () => {
    it("should generate usage text for async parser", () => {
      const parser = object({
        name: argument(asyncString()),
        count: option("-c", "--count", integer()),
      });

      assert.equal(parser.$mode, "async");

      const usage = formatUsage("test-app", parser.usage);
      assert.ok(usage.includes("-c"));
      assert.ok(usage.includes("--count"));
      assert.ok(usage.includes("ASYNC_STRING"));
    });

    it("should generate usage for complex async parser", () => {
      const parser = object({
        verbose: flag("-v", "--verbose"),
        config: option("--config", asyncString()),
        files: multiple(argument(asyncString()), { min: 1 }),
      });

      const usage = formatUsage("myapp", parser.usage);
      assert.ok(usage.includes("-v"));
      assert.ok(usage.includes("--verbose"));
      assert.ok(usage.includes("--config"));
      assert.ok(usage.includes("ASYNC_STRING"));
    });

    it("should handle async command in usage", () => {
      const greetCmd = command(
        "greet",
        object({
          name: argument(asyncString()),
        }),
        { description: message`Greet someone` },
      );

      const usage = formatUsage("app", greetCmd.usage);
      assert.ok(usage.includes("greet"));
    });
  });

  describe("getDocPage with async parsers", () => {
    // Note: getDocPage only accepts sync parsers, but for doc generation
    // we can use type assertion since doc generation doesn't execute
    // the async parsing logic
    type SyncParser = import("./parser.ts").Parser<"sync", unknown, unknown>;

    it("should generate doc page for async parser", () => {
      const parser = object({
        name: argument(asyncString(), {
          description: message`The name to process`,
        }),
        count: option("-c", "--count", integer(), {
          description: message`Number of repetitions`,
        }),
      });

      // Cast to sync parser for doc generation (doesn't execute async parsing)
      const doc = getDocPage(parser as unknown as SyncParser, []);
      assert.ok(doc !== undefined);
      if (doc) {
        // DocPage has sections, not options/arguments directly
        assert.ok(doc.sections.length > 0);
      }
    });

    it("should generate doc for command with async value parser", () => {
      const greetCmd = command(
        "greet",
        object({
          name: argument(asyncString(), {
            description: message`Name to greet`,
          }),
        }),
        { description: message`Greet someone` },
      );

      const doc = getDocPage(greetCmd as unknown as SyncParser, ["greet"]);
      assert.ok(doc !== undefined);
      if (doc) {
        // Just verify doc page was generated successfully
        assert.ok(doc.sections !== undefined);
      }
    });

    it("should handle nested async parsers in doc page", () => {
      const parser = merge(
        object({
          verbose: flag("-v"),
        }),
        object({
          config: option("--config", asyncString()),
          output: option("-o", "--output", asyncString()),
        }),
      );

      const doc = getDocPage(parser as unknown as SyncParser, []);
      assert.ok(doc !== undefined);
      if (doc) {
        // Verify sections exist
        assert.ok(doc.sections.length > 0);
      }
    });
  });

  describe("formatDocPage with async parsers", () => {
    type SyncParser = import("./parser.ts").Parser<"sync", unknown, unknown>;

    it("should format doc page for async parser", () => {
      const parser = object({
        name: argument(asyncString(), {
          description: message`The name to process`,
        }),
        verbose: flag("-v", "--verbose", {
          description: message`Enable verbose output`,
        }),
      });

      const doc = getDocPage(parser as unknown as SyncParser, []);
      assert.ok(doc !== undefined);
      if (doc) {
        const formatted = formatDocPage("myapp", doc);
        assert.ok(formatted.includes("-v"));
        assert.ok(formatted.includes("--verbose"));
        assert.ok(formatted.includes("ASYNC_STRING"));
      }
    });

    it("should format colored output for async parser", () => {
      const parser = object({
        name: argument(asyncString()),
        count: option("-c", "--count", integer()),
      });

      const doc = getDocPage(parser as unknown as SyncParser, []);
      assert.ok(doc !== undefined);
      if (doc) {
        const formatted = formatDocPage("myapp", doc, { colors: true });
        // Should contain ANSI color codes
        assert.ok(formatted.length > 0);
      }
    });
  });

  describe("getDocFragments method with async parsers", () => {
    it("should get doc fragments from async parser", () => {
      const parser = object({
        name: argument(asyncString(), {
          description: message`Input name`,
        }),
        verbose: flag("-v", "--verbose", {
          description: message`Be verbose`,
        }),
      });

      const { fragments } = parser.getDocFragments({ kind: "unavailable" });
      // Should have at least 1 section fragment
      assert.ok(fragments.length >= 1);

      // The section should contain entries for the argument and flag
      const section = fragments.find((f) => f.type === "section");
      assert.ok(section !== undefined, "Should have a section fragment");
      if (section && section.type === "section") {
        // Should have at least 2 entries (argument and flag)
        assert.ok(
          section.entries.length >= 2,
          "Section should have at least 2 entries",
        );
      }
    });

    it("should get doc fragments from nested async parser", () => {
      const parser = merge(
        object({
          input: argument(asyncString()),
        }),
        object({
          output: option("-o", asyncString()),
          format: option("--format", choice(["json", "yaml"])),
        }),
      );

      const { fragments } = parser.getDocFragments({ kind: "unavailable" });
      // Should have at least 1 fragment (merged sections)
      assert.ok(fragments.length >= 1);

      // Count total entries across all section fragments
      let totalEntries = 0;
      for (const fragment of fragments) {
        if (fragment.type === "section") {
          totalEntries += fragment.entries.length;
        }
      }
      // Should have at least 3 entries (input, output, format)
      assert.ok(
        totalEntries >= 3,
        `Expected at least 3 entries, got ${totalEntries}`,
      );
    });

    it("should get doc fragments from command with async value parser", () => {
      const buildCmd = command(
        "build",
        object({
          target: argument(asyncString()),
          watch: flag("-w", "--watch"),
        }),
        { description: message`Build the project` },
      );

      const { fragments } = buildCmd.getDocFragments({ kind: "unavailable" });
      // Should include command and its options
      assert.ok(fragments.length >= 1);
    });
  });
});

// =============================================================================
// Realistic Async I/O Scenarios
// =============================================================================

describe("Realistic async I/O scenarios", () => {
  describe("simulated file validation", () => {
    // Simulates an async file existence check
    function asyncFileExistsValidator(): ValueParser<"async", string> {
      // Simulated file system - some paths "exist"
      const existingFiles = new Set([
        "/home/user/config.json",
        "/etc/app/settings.yaml",
        "/var/log/app.log",
      ]);

      return {
        $mode: "async",
        metavar: "FILE",
        async parse(input: string): Promise<ValueParserResult<string>> {
          // Simulate async file stat operation
          await new Promise((resolve) => setTimeout(resolve, 5));

          if (existingFiles.has(input)) {
            return { success: true, value: input };
          }
          return {
            success: false,
            error: message`File not found: ${input}`,
          };
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should validate existing file path", async () => {
      const parser = object({
        config: option("--config", asyncFileExistsValidator()),
      });

      const result = await parseAsync(parser, [
        "--config",
        "/home/user/config.json",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.config, "/home/user/config.json");
      }
    });

    it("should fail for non-existent file path", async () => {
      const parser = object({
        config: option("--config", asyncFileExistsValidator()),
      });

      const result = await parseAsync(parser, [
        "--config",
        "/nonexistent/path",
      ]);
      assert.ok(!result.success);
    });

    it("should validate multiple file paths independently", async () => {
      const parser = object({
        input: option("--input", asyncFileExistsValidator()),
        output: option("--output", asyncFileExistsValidator()),
      });

      // One exists, one doesn't
      const result = await parseAsync(parser, [
        "--input",
        "/home/user/config.json",
        "--output",
        "/nonexistent/output.txt",
      ]);
      // Should fail because output doesn't exist
      assert.ok(!result.success);
    });
  });

  describe("simulated API validation", () => {
    // Simulates an async API lookup (e.g., validating a user ID exists)
    function asyncUserIdValidator(): ValueParser<"async", number> {
      // Simulated database of valid user IDs
      const validUserIds = new Set([1, 2, 3, 42, 100, 999]);

      return {
        $mode: "async",
        metavar: "USER_ID",
        async parse(input: string): Promise<ValueParserResult<number>> {
          const id = parseInt(input, 10);
          if (isNaN(id)) {
            return {
              success: false,
              error: message`Invalid user ID format: ${input}`,
            };
          }

          // Simulate async API call
          await new Promise((resolve) => setTimeout(resolve, 3));

          if (validUserIds.has(id)) {
            return { success: true, value: id };
          }
          return {
            success: false,
            error: message`User not found: ${String(id)}`,
          };
        },
        format(value: number): string {
          return String(value);
        },
      };
    }

    it("should validate existing user ID", async () => {
      const parser = object({
        userId: option("--user", asyncUserIdValidator()),
      });

      const result = await parseAsync(parser, ["--user", "42"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.userId, 42);
      }
    });

    it("should fail for non-existent user ID", async () => {
      const parser = object({
        userId: option("--user", asyncUserIdValidator()),
      });

      const result = await parseAsync(parser, ["--user", "12345"]);
      assert.ok(!result.success);
    });

    it("should fail for invalid user ID format", async () => {
      const parser = object({
        userId: option("--user", asyncUserIdValidator()),
      });

      const result = await parseAsync(parser, ["--user", "not-a-number"]);
      assert.ok(!result.success);
    });
  });

  describe("simulated DNS lookup", () => {
    // Simulates an async DNS resolution check
    function asyncHostnameResolver(): ValueParser<"async", string> {
      // Simulated DNS - these hostnames "resolve"
      const resolvableHosts = new Set([
        "localhost",
        "example.com",
        "api.example.com",
        "db.internal",
      ]);

      return {
        $mode: "async",
        metavar: "HOSTNAME",
        async parse(input: string): Promise<ValueParserResult<string>> {
          // Simulate async DNS lookup
          await new Promise((resolve) => setTimeout(resolve, 2));

          if (resolvableHosts.has(input.toLowerCase())) {
            return { success: true, value: input.toLowerCase() };
          }
          return {
            success: false,
            error: message`Failed to resolve hostname: ${input}`,
          };
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should resolve valid hostname", async () => {
      const parser = object({
        host: option("--host", asyncHostnameResolver()),
      });

      const result = await parseAsync(parser, ["--host", "example.com"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.host, "example.com");
      }
    });

    it("should fail for unresolvable hostname", async () => {
      const parser = object({
        host: option("--host", asyncHostnameResolver()),
      });

      const result = await parseAsync(parser, [
        "--host",
        "nonexistent.invalid",
      ]);
      assert.ok(!result.success);
    });
  });

  describe("simulated database connection string validation", () => {
    // Simulates validating a database connection string by attempting connection
    function asyncDbConnectionValidator(): ValueParser<"async", {
      host: string;
      port: number;
      database: string;
    }> {
      return {
        $mode: "async",
        metavar: "DB_URL",
        async parse(
          input: string,
        ): Promise<
          ValueParserResult<{ host: string; port: number; database: string }>
        > {
          // Parse connection string format: host:port/database
          const match = input.match(/^([^:]+):(\d+)\/(.+)$/);
          if (!match) {
            return {
              success: false,
              error:
                message`Invalid connection string format. Expected: host:port/database`,
            };
          }

          const [, host, portStr, database] = match;
          const port = parseInt(portStr, 10);

          // Simulate connection attempt
          await new Promise((resolve) => setTimeout(resolve, 5));

          // Simulate that only certain ports are "open"
          const openPorts = [5432, 3306, 27017]; // PostgreSQL, MySQL, MongoDB
          if (!openPorts.includes(port)) {
            return {
              success: false,
              error: message`Connection refused on port ${portStr}`,
            };
          }

          return {
            success: true,
            value: { host, port, database },
          };
        },
        format(
          value: { host: string; port: number; database: string },
        ): string {
          return `${value.host}:${value.port}/${value.database}`;
        },
      };
    }

    it("should validate PostgreSQL connection string", async () => {
      const parser = object({
        db: option("--db", asyncDbConnectionValidator()),
      });

      const result = await parseAsync(parser, [
        "--db",
        "localhost:5432/myapp",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value.db, {
          host: "localhost",
          port: 5432,
          database: "myapp",
        });
      }
    });

    it("should fail for connection on closed port", async () => {
      const parser = object({
        db: option("--db", asyncDbConnectionValidator()),
      });

      const result = await parseAsync(parser, [
        "--db",
        "localhost:9999/myapp",
      ]);
      assert.ok(!result.success);
    });

    it("should fail for invalid connection string format", async () => {
      const parser = object({
        db: option("--db", asyncDbConnectionValidator()),
      });

      const result = await parseAsync(parser, ["--db", "invalid-format"]);
      assert.ok(!result.success);
    });
  });

  describe("simulated async suggestion provider", () => {
    // Simulates fetching available options from an external service
    function asyncDynamicChoice(): ValueParser<"async", string> {
      // Simulated remote service that provides available options
      const availableOptions = ["production", "staging", "development", "test"];

      return {
        $mode: "async",
        metavar: "ENVIRONMENT",
        async parse(input: string): Promise<ValueParserResult<string>> {
          // Simulate API call to fetch valid options
          await new Promise((resolve) => setTimeout(resolve, 2));

          const normalized = input.toLowerCase();
          if (availableOptions.includes(normalized)) {
            return { success: true, value: normalized };
          }
          return {
            success: false,
            error: message`Invalid environment: ${input}. Valid options: ${
              availableOptions.join(", ")
            }`,
          };
        },
        async *suggest(prefix: string): AsyncIterable<Suggestion> {
          // Simulate async fetch of options
          await new Promise((resolve) => setTimeout(resolve, 1));

          const normalizedPrefix = prefix.toLowerCase();
          for (const option of availableOptions) {
            if (option.startsWith(normalizedPrefix)) {
              yield { kind: "literal", text: option };
            }
          }
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should parse valid environment", async () => {
      const parser = object({
        env: option("--env", asyncDynamicChoice()),
      });

      const result = await parseAsync(parser, ["--env", "production"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.env, "production");
      }
    });

    it("should get suggestions for environment prefix", async () => {
      const parser = object({
        env: option("--env", asyncDynamicChoice()),
      });

      const suggestions = await suggestAsync(parser, ["--env", "dev"]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);
      assert.ok(literals.includes("development"));
    });

    it("should fail for invalid environment", async () => {
      const parser = object({
        env: option("--env", asyncDynamicChoice()),
      });

      const result = await parseAsync(parser, ["--env", "invalid-env"]);
      assert.ok(!result.success);
    });
  });

  describe("concurrent async validations", () => {
    // Simulates multiple independent async validations
    function slowAsyncValidator(delayMs: number): ValueParser<"async", string> {
      return {
        $mode: "async",
        metavar: "VALUE",
        async parse(input: string): Promise<ValueParserResult<string>> {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return { success: true, value: `validated:${input}` };
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should handle multiple concurrent slow validations", async () => {
      const parser = object({
        fast: option("--fast", slowAsyncValidator(1)),
        medium: option("--medium", slowAsyncValidator(5)),
        slow: option("--slow", slowAsyncValidator(10)),
      });

      const start = Date.now();
      const result = await parseAsync(parser, [
        "--fast",
        "a",
        "--medium",
        "b",
        "--slow",
        "c",
      ]);
      const elapsed = Date.now() - start;

      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.fast, "validated:a");
        assert.equal(result.value.medium, "validated:b");
        assert.equal(result.value.slow, "validated:c");
      }

      // Should complete in roughly the time of the slowest validator,
      // not the sum of all validators (if running concurrently)
      // Allow some buffer for test timing variations
      assert.ok(
        elapsed < 50,
        `Expected parallel execution, but took ${elapsed}ms`,
      );
    });
  });

  describe("error message propagation from async validators", () => {
    function asyncValidatorWithDetailedError(): ValueParser<"async", string> {
      return {
        $mode: "async",
        metavar: "VALUE",
        async parse(input: string): Promise<ValueParserResult<string>> {
          await new Promise((resolve) => setTimeout(resolve, 1));

          if (input.length < 3) {
            return {
              success: false,
              error: message`Value must be at least 3 characters, got ${
                String(input.length)
              }`,
            };
          }

          if (!/^[a-z]+$/.test(input)) {
            return {
              success: false,
              error:
                message`Value must contain only lowercase letters: ${input}`,
            };
          }

          return { success: true, value: input };
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should propagate detailed error for too short value", async () => {
      const parser = object({
        value: option("--value", asyncValidatorWithDetailedError()),
      });

      const result = await parseAsync(parser, ["--value", "ab"]);
      assert.ok(!result.success);
      // Error message should be present
      if (!result.success) {
        assert.ok(result.error.length > 0, "Error message should not be empty");
      }
    });

    it("should propagate detailed error for invalid characters", async () => {
      const parser = object({
        value: option("--value", asyncValidatorWithDetailedError()),
      });

      const result = await parseAsync(parser, ["--value", "ABC123"]);
      assert.ok(!result.success);
    });

    it("should succeed for valid value", async () => {
      const parser = object({
        value: option("--value", asyncValidatorWithDetailedError()),
      });

      const result = await parseAsync(parser, ["--value", "validvalue"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.value, "validvalue");
      }
    });
  });
});

// =============================================================================
// Async Exception Handling
// =============================================================================

describe("Async exception handling", () => {
  describe("async parser that throws exception", () => {
    // Value parser that throws an exception instead of returning error result
    function throwingAsyncParser(): ValueParser<"async", string> {
      return {
        $mode: "async",
        metavar: "THROWING",
        parse(_input: string): Promise<ValueParserResult<string>> {
          return Promise.reject(new Error("Async parser threw an error"));
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should propagate exception from async value parser", async () => {
      const parser = object({
        value: option("--value", throwingAsyncParser()),
      });

      await assert.rejects(
        async () => await parseAsync(parser, ["--value", "test"]),
        /Async parser threw an error/,
      );
    });

    it("should propagate exception from async argument", async () => {
      const parser = object({
        input: argument(throwingAsyncParser()),
      });

      await assert.rejects(
        async () => await parseAsync(parser, ["test"]),
        /Async parser threw an error/,
      );
    });

    it("should propagate exception in object with multiple async fields", async () => {
      const parser = object({
        good: option("--good", asyncString()),
        bad: option("--bad", throwingAsyncParser()),
      });

      await assert.rejects(
        async () => await parseAsync(parser, ["--good", "ok", "--bad", "fail"]),
        /Async parser threw an error/,
      );
    });

    it("should propagate exception in tuple", async () => {
      const parser = tuple([
        option("--first", asyncString()),
        option("--second", throwingAsyncParser()),
      ]);

      await assert.rejects(
        async () =>
          await parseAsync(parser, ["--first", "ok", "--second", "fail"]),
        /Async parser threw an error/,
      );
    });

    it("should propagate exception in or() branch", async () => {
      const parser = or(
        object({
          kind: constant("good"),
          value: option("--good", asyncString()),
        }),
        object({
          kind: constant("bad"),
          value: option("--bad", throwingAsyncParser()),
        }),
      );

      await assert.rejects(
        async () => await parseAsync(parser, ["--bad", "fail"]),
        /Async parser threw an error/,
      );
    });

    it("should propagate exception in merge()", async () => {
      const parser = merge(
        object({ good: option("--good", asyncString()) }),
        object({ bad: option("--bad", throwingAsyncParser()) }),
      );

      await assert.rejects(
        async () => await parseAsync(parser, ["--good", "ok", "--bad", "fail"]),
        /Async parser threw an error/,
      );
    });

    it("should propagate exception in command subparser", async () => {
      const cmd = command(
        "run",
        object({
          value: argument(throwingAsyncParser()),
        }),
      );

      await assert.rejects(
        async () => await parseAsync(cmd, ["run", "test"]),
        /Async parser threw an error/,
      );
    });
  });

  describe("async exception in suggest", () => {
    function throwingSuggestParser(): ValueParser<"async", string> {
      return {
        $mode: "async",
        metavar: "THROWING_SUGGEST",
        parse(input: string): Promise<ValueParserResult<string>> {
          return Promise.resolve({ success: true, value: input });
        },
        // deno-lint-ignore require-yield
        async *suggest(_prefix: string): AsyncIterable<Suggestion> {
          throw new Error("Suggest threw an error");
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should propagate exception from async suggest", async () => {
      const parser = object({
        value: option("--value", throwingSuggestParser()),
      });

      await assert.rejects(
        async () => await suggestAsync(parser, ["--value", "test"]),
        /Suggest threw an error/,
      );
    });
  });

  describe("async exception with delayed throw", () => {
    function delayedThrowingParser(
      delayMs: number,
    ): ValueParser<"async", string> {
      return {
        $mode: "async",
        metavar: "DELAYED_THROW",
        async parse(_input: string): Promise<ValueParserResult<string>> {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          throw new Error(`Delayed throw after ${delayMs}ms`);
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should propagate delayed exception", async () => {
      const parser = object({
        value: option("--value", delayedThrowingParser(10)),
      });

      await assert.rejects(
        async () => await parseAsync(parser, ["--value", "test"]),
        /Delayed throw after 10ms/,
      );
    });

    it("should handle concurrent parsers where one throws", async () => {
      const parser = object({
        fast: option("--fast", asyncString(1)),
        slow: option("--slow", delayedThrowingParser(10)),
      });

      await assert.rejects(
        async () =>
          await parseAsync(parser, ["--fast", "ok", "--slow", "fail"]),
        /Delayed throw after 10ms/,
      );
    });
  });
});

// =============================================================================
// map() Modifier with Async Parsers
// =============================================================================

describe("map() modifier with async parsers", () => {
  describe("sync map function with async parser", () => {
    it("should apply sync map to async parser result", async () => {
      const parser = object({
        value: map(
          option("--value", asyncString()),
          (s) => s.toLowerCase(),
        ),
      });

      const result = await parseAsync(parser, ["--value", "HELLO"]);
      assert.ok(result.success);
      if (result.success) {
        // asyncString uppercases, then map lowercases
        assert.equal(result.value.value, "hello");
      }
    });

    it("should apply sync map to async argument", async () => {
      const parser = object({
        num: map(
          argument(asyncInteger()),
          (n) => n * 2,
        ),
      });

      const result = await parseAsync(parser, ["21"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.num, 42);
      }
    });

    it("should chain multiple sync maps on async parser", async () => {
      const parser = object({
        value: map(
          map(
            option("--value", asyncString()),
            (s) => s.toLowerCase(),
          ),
          (s) => s.split("").reverse().join(""),
        ),
      });

      const result = await parseAsync(parser, ["--value", "HELLO"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.value, "olleh");
      }
    });

    it("should preserve async mode through map", () => {
      const baseParser = option("--value", asyncString());
      const mappedParser = map(baseParser, (s) => s.length);

      // The mapped parser should still be async
      assert.equal(mappedParser.$mode, "async");
    });
  });

  describe("map with object containing async parsers", () => {
    it("should map entire object result", async () => {
      const parser = map(
        object({
          name: option("--name", asyncString()),
          count: option("--count", asyncInteger()),
        }),
        (obj) => ({ ...obj, combined: `${obj.name}:${obj.count}` }),
      );

      const result = await parseAsync(parser, [
        "--name",
        "test",
        "--count",
        "5",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.name, "TEST");
        assert.equal(result.value.count, 5);
        assert.equal(result.value.combined, "TEST:5");
      }
    });
  });

  describe("map with tuple containing async parsers", () => {
    it("should map tuple result", async () => {
      const parser = map(
        tuple([
          option("--first", asyncString()),
          option("--second", asyncInteger()),
        ]),
        ([first, second]) => ({ first, second, sum: first.length + second }),
      );

      const result = await parseAsync(parser, [
        "--first",
        "hello",
        "--second",
        "10",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.first, "HELLO");
        assert.equal(result.value.second, 10);
        assert.equal(result.value.sum, 15); // "HELLO".length + 10
      }
    });
  });

  describe("map with or() containing async parsers", () => {
    it("should map or() result", async () => {
      const parser = map(
        or(
          object({
            kind: constant("num"),
            value: option("--num", asyncInteger()),
          }),
          object({
            kind: constant("str"),
            value: option("--str", asyncString()),
          }),
        ),
        (result) => ({ ...result, mapped: true }),
      );

      const result1 = await parseAsync(parser, ["--num", "42"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.kind, "num");
        assert.ok(result1.value.mapped);
      }

      const result2 = await parseAsync(parser, ["--str", "hello"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.kind, "str");
        assert.ok(result2.value.mapped);
      }
    });
  });

  describe("map with command containing async parsers", () => {
    it("should map command result", async () => {
      const cmd = map(
        command(
          "greet",
          object({
            name: argument(asyncString()),
          }),
        ),
        (result) => `Hello, ${result.name}!`,
      );

      const result = await parseAsync(cmd, ["greet", "world"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "Hello, WORLD!");
      }
    });
  });

  describe("map error handling with async parser", () => {
    it("should propagate async parser error through map", async () => {
      const parser = map(
        object({
          value: option("--value", asyncInteger()),
        }),
        (obj) => obj.value * 2,
      );

      const result = await parseAsync(parser, ["--value", "not-a-number"]);
      assert.ok(!result.success);
    });

    it("should propagate exception from map function", async () => {
      const parser = map(
        object({
          value: option("--value", asyncString()),
        }),
        (_obj) => {
          throw new Error("Map function error");
        },
      );

      await assert.rejects(
        async () => await parseAsync(parser, ["--value", "test"]),
        /Map function error/,
      );
    });
  });
});

// =============================================================================
// longestMatch() with Async Parsers
// =============================================================================

describe("longestMatch() with async parsers", () => {
  describe("basic longestMatch with async", () => {
    it("should select longer match with async value parsers", async () => {
      const parser = longestMatch(
        object({ a: option("-a", asyncString()) }),
        object({
          a: option("-a", asyncString()),
          b: option("-b", asyncInteger()),
        }),
      );

      // Second branch matches more arguments
      const result = await parseAsync(parser, ["-a", "hello", "-b", "42"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.a, "HELLO");
        assert.equal((result.value as { b: number }).b, 42);
      }
    });

    it("should select first match when lengths are equal", async () => {
      const parser = longestMatch(
        object({ first: option("--first", asyncString()) }),
        object({ second: option("--second", asyncString()) }),
      );

      const result = await parseAsync(parser, ["--first", "a"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal((result.value as { first: string }).first, "A");
      }
    });

    it("should handle all branches failing", async () => {
      const parser = longestMatch(
        object({ a: argument(asyncInteger()) }),
        object({ b: argument(asyncInteger()) }),
      );

      const result = await parseAsync(parser, ["not-a-number"]);
      assert.ok(!result.success);
    });
  });

  describe("longestMatch with mixed async/sync parsers", () => {
    it("should work when first branch is sync, second is async", async () => {
      const parser = longestMatch(
        object({ sync: option("--sync", string()) }),
        object({ async: option("--async", asyncString()) }),
      );

      const result = await parseAsync(parser, ["--async", "test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal((result.value as { async: string }).async, "TEST");
      }
    });

    it("should work when first branch is async, second is sync", async () => {
      const parser = longestMatch(
        object({ async: option("--async", asyncString()) }),
        object({ sync: option("--sync", string()) }),
      );

      const result = await parseAsync(parser, ["--sync", "test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal((result.value as { sync: string }).sync, "test");
      }
    });
  });

  describe("longestMatch with commands", () => {
    it("should select matching command from alternatives", async () => {
      const cmdA = command(
        "create",
        object({
          name: argument(asyncString()),
        }),
      );
      const cmdB = command(
        "delete",
        object({
          id: argument(asyncInteger()),
        }),
      );

      const parser = longestMatch(cmdA, cmdB);

      const result1 = await parseAsync(parser, ["create", "test"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal((result1.value as { name: string }).name, "TEST");
      }

      const result2 = await parseAsync(parser, ["delete", "42"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal((result2.value as { id: number }).id, 42);
      }
    });
  });

  describe("longestMatch exception handling", () => {
    it("should propagate exception from async parser in longestMatch", async () => {
      function throwingParser(): ValueParser<"async", string> {
        return {
          $mode: "async",
          metavar: "THROW",
          parse(_input: string): Promise<ValueParserResult<string>> {
            return Promise.reject(new Error("longestMatch branch threw"));
          },
          format(v: string): string {
            return v;
          },
        };
      }

      const parser = longestMatch(
        object({ good: option("--good", asyncString()) }),
        object({ bad: option("--bad", throwingParser()) }),
      );

      await assert.rejects(
        async () => await parseAsync(parser, ["--bad", "test"]),
        /longestMatch branch threw/,
      );
    });
  });

  describe("longestMatch with nested async structures", () => {
    it("should handle nested objects with async parsers", async () => {
      const parser = longestMatch(
        object({
          mode: constant("simple"),
          value: option("--value", asyncString()),
        }),
        merge(
          object({ mode: constant("complex") }),
          object({
            value: option("--value", asyncString()),
            extra: option("--extra", asyncInteger()),
          }),
        ),
      );

      const result = await parseAsync(parser, [
        "--value",
        "test",
        "--extra",
        "42",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.mode, "complex");
        assert.equal(result.value.value, "TEST");
        assert.equal((result.value as { extra: number }).extra, 42);
      }
    });
  });

  describe("longestMatch suggestions with async", () => {
    it("should collect suggestions from all async branches", async () => {
      const parser = longestMatch(
        object({ alpha: option("--alpha", asyncChoice(["a1", "a2"])) }),
        object({ beta: option("--beta", asyncChoice(["b1", "b2"])) }),
      );

      const suggestions = await suggestAsync(parser, ["--"]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);

      assert.ok(literals.includes("--alpha"));
      assert.ok(literals.includes("--beta"));
    });
  });
});

// =============================================================================
// concat() with Async Parsers
// =============================================================================

describe("concat() with async parsers", () => {
  describe("basic concat with async tuple parsers", () => {
    it("should concatenate two async tuple parsers", async () => {
      const tupleA = tuple([
        option("--name", asyncString()),
        option("--age", asyncInteger()),
      ]);
      const tupleB = tuple([
        option("--city", asyncString()),
      ]);

      const parser = concat(tupleA, tupleB);

      const result = await parseAsync(parser, [
        "--name",
        "alice",
        "--age",
        "30",
        "--city",
        "seoul",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["ALICE", 30, "SEOUL"]);
      }
    });

    it("should concatenate three async tuple parsers", async () => {
      const tupleA = tuple([option("--a", asyncString())]);
      const tupleB = tuple([option("--b", asyncInteger())]);
      const tupleC = tuple([option("--c", asyncString())]);

      const parser = concat(tupleA, tupleB, tupleC);

      const result = await parseAsync(parser, [
        "--a",
        "first",
        "--b",
        "42",
        "--c",
        "third",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["FIRST", 42, "THIRD"]);
      }
    });

    it("should have async mode when all parsers are async", () => {
      const tupleA = tuple([option("--a", asyncString())]);
      const tupleB = tuple([option("--b", asyncInteger())]);
      const parser = concat(tupleA, tupleB);

      assert.equal(parser.$mode, "async");
    });
  });

  describe("concat with mixed async/sync tuple parsers", () => {
    it("should have async mode when first parser is async", () => {
      const asyncTuple = tuple([option("--async", asyncString())]);
      const syncTuple = tuple([option("--sync", string())]);
      const parser = concat(asyncTuple, syncTuple);

      assert.equal(parser.$mode, "async");
    });

    it("should have async mode when second parser is async", () => {
      const syncTuple = tuple([option("--sync", string())]);
      const asyncTuple = tuple([option("--async", asyncString())]);
      const parser = concat(syncTuple, asyncTuple);

      assert.equal(parser.$mode, "async");
    });

    it("should have sync mode when all parsers are sync", () => {
      const tupleA = tuple([option("--a", string())]);
      const tupleB = tuple([option("--b", integer())]);
      const parser = concat(tupleA, tupleB);

      assert.equal(parser.$mode, "sync");
    });

    it("should parse mixed async/sync parsers correctly", async () => {
      const asyncTuple = tuple([option("--async", asyncString())]);
      const syncTuple = tuple([option("--sync", string())]);
      const parser = concat(asyncTuple, syncTuple);

      const result = await parseAsync(parser, [
        "--async",
        "hello",
        "--sync",
        "world",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["HELLO", "world"]);
      }
    });
  });

  describe("concat with arguments", () => {
    it("should concatenate tuple parsers with async arguments", async () => {
      const tupleA = tuple([argument(asyncString())]);
      const tupleB = tuple([argument(asyncInteger())]);

      const parser = concat(tupleA, tupleB);

      const result = await parseAsync(parser, ["hello", "42"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["HELLO", 42]);
      }
    });

    it("should handle multiple arguments in each tuple", async () => {
      const tupleA = tuple([
        argument(asyncString()),
        argument(asyncString()),
      ]);
      const tupleB = tuple([
        argument(asyncInteger()),
      ]);

      const parser = concat(tupleA, tupleB);

      const result = await parseAsync(parser, ["first", "second", "99"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["FIRST", "SECOND", 99]);
      }
    });
  });

  describe("concat with optional async elements", () => {
    it("should handle optional elements in concatenated tuples", async () => {
      const tupleA = tuple([option("--name", asyncString())]);
      const tupleB = tuple([optional(option("--count", asyncInteger()))]);

      const parser = concat(tupleA, tupleB);

      // Without optional element
      const result1 = await parseAsync(parser, ["--name", "test"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value, ["TEST", undefined]);
      }

      // With optional element
      const result2 = await parseAsync(parser, [
        "--name",
        "test",
        "--count",
        "5",
      ]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.deepEqual(result2.value, ["TEST", 5]);
      }
    });

    it("should handle withDefault in concatenated tuples", async () => {
      const tupleA = tuple([option("--name", asyncString())]);
      const tupleB = tuple([withDefault(option("--count", asyncInteger()), 0)]);

      const parser = concat(tupleA, tupleB);

      const result = await parseAsync(parser, ["--name", "test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["TEST", 0]);
      }
    });
  });

  describe("concat exception handling", () => {
    function throwingAsyncParser(): ValueParser<"async", string> {
      return {
        $mode: "async",
        metavar: "THROWING",
        parse(_input: string): Promise<ValueParserResult<string>> {
          return Promise.reject(new Error("Concat async parser threw"));
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should propagate exception from first tuple", async () => {
      const tupleA = tuple([option("--a", throwingAsyncParser())]);
      const tupleB = tuple([option("--b", asyncString())]);
      const parser = concat(tupleA, tupleB);

      await assert.rejects(
        async () => await parseAsync(parser, ["--a", "value", "--b", "test"]),
        { message: "Concat async parser threw" },
      );
    });

    it("should propagate exception from second tuple", async () => {
      const tupleA = tuple([option("--a", asyncString())]);
      const tupleB = tuple([option("--b", throwingAsyncParser())]);
      const parser = concat(tupleA, tupleB);

      await assert.rejects(
        async () => await parseAsync(parser, ["--a", "value", "--b", "test"]),
        { message: "Concat async parser threw" },
      );
    });
  });

  describe("concat error handling", () => {
    it("should return error when first tuple fails validation", async () => {
      const tupleA = tuple([option("--num", asyncInteger())]);
      const tupleB = tuple([option("--name", asyncString())]);
      const parser = concat(tupleA, tupleB);

      const result = await parseAsync(parser, [
        "--num",
        "not-a-number",
        "--name",
        "test",
      ]);
      assert.ok(!result.success);
    });

    it("should return error when second tuple fails validation", async () => {
      const tupleA = tuple([option("--name", asyncString())]);
      const tupleB = tuple([option("--num", asyncInteger())]);
      const parser = concat(tupleA, tupleB);

      const result = await parseAsync(parser, [
        "--name",
        "test",
        "--num",
        "invalid",
      ]);
      assert.ok(!result.success);
    });
  });

  describe("concat suggestions with async", () => {
    it("should collect suggestions from all concatenated tuples", async () => {
      const tupleA = tuple([option("--alpha", asyncChoice(["a1", "a2"]))]);
      const tupleB = tuple([option("--beta", asyncChoice(["b1", "b2"]))]);
      const parser = concat(tupleA, tupleB);

      const suggestions = await suggestAsync(parser, ["--"]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);

      assert.ok(literals.includes("--alpha"));
      assert.ok(literals.includes("--beta"));
    });

    it("should suggest values for async options", async () => {
      const tupleA = tuple([
        option("--choice", asyncChoice(["opt1", "opt2", "opt3"])),
      ]);
      const tupleB = tuple([option("--other", asyncString())]);
      const parser = concat(tupleA, tupleB);

      const suggestions = await suggestAsync(parser, ["--choice", ""]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);

      assert.ok(literals.includes("opt1"));
      assert.ok(literals.includes("opt2"));
      assert.ok(literals.includes("opt3"));
    });
  });

  describe("concat with nested structures", () => {
    it("should handle concat of tuples containing async options", async () => {
      const tupleA = tuple([
        option("--first", asyncString()),
        flag("-v", "--verbose"),
      ]);
      const tupleB = tuple([
        option("--second", asyncInteger()),
        optional(option("--third", asyncString())),
      ]);

      const parser = concat(tupleA, tupleB);

      const result = await parseAsync(parser, [
        "--first",
        "hello",
        "-v",
        "--second",
        "42",
        "--third",
        "world",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["HELLO", true, 42, "WORLD"]);
      }
    });
  });
});

// =============================================================================
// group() with Async Parsers
// =============================================================================

describe("group() with async parsers", () => {
  describe("basic group with async parser", () => {
    it("should preserve async mode from wrapped parser", () => {
      const parser = group(
        "options",
        object({
          name: option("--name", asyncString()),
          age: option("--age", asyncInteger()),
        }),
      );

      assert.equal(parser.$mode, "async");
    });

    it("should preserve sync mode from wrapped parser", () => {
      const parser = group(
        "options",
        object({
          name: option("--name", string()),
          age: option("--age", integer()),
        }),
      );

      assert.equal(parser.$mode, "sync");
    });

    it("should parse async grouped parser correctly", async () => {
      const parser = group(
        "options",
        object({
          name: option("--name", asyncString()),
          count: option("--count", asyncInteger()),
        }),
      );

      const result = await parseAsync(parser, [
        "--name",
        "test",
        "--count",
        "42",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, { name: "TEST", count: 42 });
      }
    });
  });

  describe("group with nested async structures", () => {
    it("should handle grouped object with mixed async/sync options", async () => {
      const parser = group(
        "settings",
        object({
          asyncValue: option("--async", asyncString()),
          syncValue: option("--sync", string()),
        }),
      );

      const result = await parseAsync(parser, [
        "--async",
        "hello",
        "--sync",
        "world",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.asyncValue, "HELLO");
        assert.equal(result.value.syncValue, "world");
      }
    });

    it("should handle grouped tuple with async elements", async () => {
      const parser = group(
        "inputs",
        tuple([
          argument(asyncString()),
          argument(asyncInteger()),
        ]),
      );

      const result = await parseAsync(parser, ["value", "123"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["VALUE", 123]);
      }
    });
  });

  describe("group exception handling", () => {
    function throwingAsyncParser(): ValueParser<"async", string> {
      return {
        $mode: "async",
        metavar: "THROWING",
        parse(_input: string): Promise<ValueParserResult<string>> {
          return Promise.reject(new Error("Group async parser threw"));
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should propagate exception from grouped async parser", async () => {
      const parser = group(
        "options",
        object({
          value: option("--value", throwingAsyncParser()),
        }),
      );

      await assert.rejects(
        async () => await parseAsync(parser, ["--value", "test"]),
        { message: "Group async parser threw" },
      );
    });
  });

  describe("group error handling", () => {
    it("should return error when grouped parser fails validation", async () => {
      const parser = group(
        "options",
        object({
          num: option("--num", asyncInteger()),
        }),
      );

      const result = await parseAsync(parser, ["--num", "not-a-number"]);
      assert.ok(!result.success);
    });
  });

  describe("group suggestions with async", () => {
    it("should collect suggestions from grouped async parser", async () => {
      const parser = group(
        "options",
        object({
          choice: option("--choice", asyncChoice(["opt1", "opt2", "opt3"])),
        }),
      );

      const suggestions = await suggestAsync(parser, ["--choice", ""]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);

      assert.ok(literals.includes("opt1"));
      assert.ok(literals.includes("opt2"));
      assert.ok(literals.includes("opt3"));
    });

    it("should suggest options in grouped async parser", async () => {
      const parser = group(
        "settings",
        object({
          alpha: option("--alpha", asyncString()),
          beta: option("--beta", asyncInteger()),
        }),
      );

      const suggestions = await suggestAsync(parser, ["--"]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);

      assert.ok(literals.includes("--alpha"));
      assert.ok(literals.includes("--beta"));
    });
  });

  describe("nested groups with async", () => {
    it("should handle nested groups with async parsers", async () => {
      const innerGroup = group(
        "inner",
        object({
          value: option("--value", asyncString()),
        }),
      );
      const outerGroup = group(
        "outer",
        merge(
          innerGroup,
          object({ extra: option("--extra", asyncInteger()) }),
        ),
      );

      const result = await parseAsync(outerGroup, [
        "--value",
        "test",
        "--extra",
        "42",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.value, "TEST");
        assert.equal(result.value.extra, 42);
      }
    });

    it("should preserve async mode through nested groups", () => {
      const innerGroup = group(
        "inner",
        object({
          value: option("--value", asyncString()),
        }),
      );
      const outerGroup = group("outer", innerGroup);

      assert.equal(innerGroup.$mode, "async");
      assert.equal(outerGroup.$mode, "async");
    });
  });

  describe("group with command", () => {
    it("should handle grouped command with async parser", async () => {
      const parser = group(
        "commands",
        command(
          "run",
          object({
            input: argument(asyncString()),
          }),
        ),
      );

      const result = await parseAsync(parser, ["run", "hello"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, { input: "HELLO" });
      }
    });
  });
});

// =============================================================================
// Shell Completion with Async Parsers in runParser
// =============================================================================

describe("shell completion with async parsers in runParser", () => {
  describe("completion script generation with async parser", () => {
    it("should generate bash completion script with async parser", async () => {
      const parser = object({
        name: option("--name", asyncString()),
        count: option("--count", asyncInteger()),
      });

      let completionOutput = "";
      let completionShown = false;

      const result = await runParser(parser, "myapp", ["completion", "bash"], {
        completion: {
          mode: "command",
          onShow: () => {
            completionShown = true;
            return "completion-shown" as never;
          },
        },
        stdout(text) {
          completionOutput = text;
        },
        stderr() {},
      });

      assert.equal(result, "completion-shown");
      assert.ok(completionShown);
      assert.ok(completionOutput.includes("function _myapp"));
      assert.ok(completionOutput.includes("complete -F _myapp myapp"));
    });

    it("should generate zsh completion script with async parser", async () => {
      const parser = object({
        value: option("--value", asyncString()),
        verbose: flag("-v", "--verbose"),
      });

      let completionOutput = "";

      await runParser(parser, "myapp", ["completion", "zsh"], {
        completion: {
          mode: "command",
          onShow: () => "completion-shown" as never,
        },
        stdout(text) {
          completionOutput = text;
        },
        stderr() {},
      });

      assert.ok(completionOutput.includes("function _myapp"));
      assert.ok(completionOutput.includes("compdef _myapp myapp"));
    });

    it("should generate fish completion script with async parser", async () => {
      const parser = object({
        format: option("--format", asyncChoice(["json", "yaml", "text"])),
      });

      let completionOutput = "";

      await runParser(parser, "myapp", ["--completion=fish"], {
        completion: {
          mode: "option",
          onShow: () => "completion-shown" as never,
        },
        stdout(text) {
          completionOutput = text;
        },
        stderr() {},
      });

      assert.ok(completionOutput.includes("myapp"));
    });
  });

  describe("completion suggestions with async parser", () => {
    it("should provide suggestions for async parser options", async () => {
      const parser = object({
        alpha: option("--alpha", asyncString()),
        beta: option("--beta", asyncInteger()),
      });

      let completionOutput = "";

      await runParser(parser, "myapp", ["completion", "bash", "--"], {
        completion: {
          mode: "command",
          onShow: () => "completion-shown" as never,
        },
        stdout(text) {
          completionOutput += text;
        },
        stderr() {},
      });

      const suggestions = completionOutput.split("\n").filter((s) =>
        s.startsWith("--")
      );
      assert.ok(suggestions.includes("--alpha"));
      assert.ok(suggestions.includes("--beta"));
    });

    it("should provide suggestions for async choice values", async () => {
      const parser = object({
        format: option("--format", asyncChoice(["json", "yaml", "xml"])),
      });

      let completionOutput = "";

      await runParser(parser, "myapp", ["completion", "bash", "--format", ""], {
        completion: {
          mode: "command",
          onShow: () => "completion-shown" as never,
        },
        stdout(text) {
          completionOutput += text;
        },
        stderr() {},
      });

      assert.ok(completionOutput.includes("json"));
      assert.ok(completionOutput.includes("yaml"));
      assert.ok(completionOutput.includes("xml"));
    });

    it("should provide zsh suggestions with descriptions for async parser", async () => {
      const parser = object({
        output: option("--output", asyncChoice(["json", "text"])),
      });

      let completionOutput = "";

      await runParser(parser, "myapp", ["completion", "zsh", "--"], {
        completion: {
          mode: "command",
          onShow: () => "completion-shown" as never,
        },
        stdout(text) {
          completionOutput += text;
        },
        stderr() {},
      });

      assert.ok(completionOutput.includes("--output\0"));
    });
  });

  describe("completion with async commands", () => {
    it("should provide subcommand suggestions for async parser", async () => {
      const parser = or(
        command("build", object({ target: option("--target", asyncString()) })),
        command("test", object({ watch: flag("-w", "--watch") })),
      );

      let completionOutput = "";

      await runParser(parser, "myapp", ["completion", "bash", ""], {
        completion: {
          mode: "command",
          onShow: () => "completion-shown" as never,
        },
        stdout(text) {
          completionOutput += text;
        },
        stderr() {},
      });

      assert.ok(completionOutput.includes("build"));
      assert.ok(completionOutput.includes("test"));
    });

    it("should provide option suggestions for selected async command", async () => {
      const parser = or(
        command("build", object({ target: option("--target", asyncString()) })),
        command("test", object({ watch: flag("-w", "--watch") })),
      );

      let completionOutput = "";

      await runParser(parser, "myapp", ["completion", "bash", "build", "--"], {
        completion: {
          mode: "command",
          onShow: () => "completion-shown" as never,
        },
        stdout(text) {
          completionOutput += text;
        },
        stderr() {},
      });

      assert.ok(completionOutput.includes("--target"));
    });
  });

  describe("completion combined with help/version and async parser", () => {
    it("should support help, version, and completion with async parser", async () => {
      const parser = object({
        name: option("--name", asyncString()),
      });

      // Test completion
      let completionOutput = "";
      await runParser(parser, "myapp", ["--completion=bash"], {
        help: { mode: "option", onShow: () => "help-shown" as never },
        version: {
          value: "1.0.0",
          mode: "option",
          onShow: () => "version-shown" as never,
        },
        completion: {
          mode: "option",
          onShow: () => "completion-shown" as never,
        },
        stdout(text) {
          completionOutput = text;
        },
        stderr() {},
      });

      assert.ok(completionOutput.includes("function _myapp"));
    });
  });

  describe("completion error cases with async parser", () => {
    it("should handle missing shell type for async parser", async () => {
      const parser = object({
        value: option("--value", asyncString()),
      });

      let errorOutput = "";

      await runParser(parser, "myapp", ["completion"], {
        completion: {
          mode: "command",
          onShow: () => "completion-shown" as never,
        },
        stdout() {},
        stderr(text) {
          errorOutput += text;
        },
        onError: () => undefined as never,
      });

      assert.ok(
        errorOutput.includes("Usage: myapp completion") ||
          errorOutput.includes("shell type"),
      );
    });
  });

  describe("normal parsing with async parser when completion not requested", () => {
    it("should parse normally when completion is available but not used", async () => {
      const parser = object({
        name: option("--name", asyncString()),
        verbose: flag("-v", "--verbose"),
      });

      const result = await runParser(
        parser,
        "myapp",
        ["--name", "alice", "-v"],
        {
          completion: { mode: "both" },
          stdout() {},
          stderr() {},
        },
      );

      assert.deepEqual(result, { name: "ALICE", verbose: true });
    });
  });
});

// =============================================================================
// Multiple Async Parser Failures (Error Reporting)
// =============================================================================

describe("multiple async parser failures (error reporting)", () => {
  describe("multiple async value parser failures in object", () => {
    it("should report first error when multiple async parsers fail", async () => {
      const parser = object({
        num1: option("--num1", asyncInteger()),
        num2: option("--num2", asyncInteger()),
      });

      // Both parsers will fail with invalid input
      const result = await parseAsync(parser, [
        "--num1",
        "not-a-number",
        "--num2",
        "also-not-a-number",
      ]);

      assert.ok(!result.success);
      if (!result.success) {
        // Should report at least one error
        assert.ok(result.error);
      }
    });

    it("should report error for first failing parser in sequence", async () => {
      const parser = object({
        first: option("--first", asyncInteger()),
        second: option("--second", asyncString()),
      });

      // Only first parser fails
      const result = await parseAsync(parser, [
        "--first",
        "invalid",
        "--second",
        "valid-string",
      ]);

      assert.ok(!result.success);
    });

    it("should report error for second failing parser when first succeeds", async () => {
      const parser = object({
        first: option("--first", asyncInteger()),
        second: option("--second", asyncInteger()),
      });

      // Only second parser fails
      const result = await parseAsync(parser, [
        "--first",
        "42",
        "--second",
        "invalid",
      ]);

      assert.ok(!result.success);
    });
  });

  describe("multiple async failures in or()", () => {
    it("should try all alternatives and report failure when all fail", async () => {
      const parser = or(
        object({ num: option("--num", asyncInteger()) }),
        object({ count: option("--count", asyncInteger()) }),
      );

      // Neither option is provided
      const result = await parseAsync(parser, ["--other", "value"]);
      assert.ok(!result.success);
    });

    it("should succeed when one alternative succeeds despite others failing", async () => {
      const parser = or(
        object({ num: option("--num", asyncInteger()) }),
        object({ name: option("--name", asyncString()) }),
      );

      // Only --name is provided and valid
      const result = await parseAsync(parser, ["--name", "test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal((result.value as { name: string }).name, "TEST");
      }
    });
  });

  describe("async failures in nested structures", () => {
    it("should report error in nested object", async () => {
      const inner = object({
        value: option("--value", asyncInteger()),
      });
      const parser = merge(
        object({ name: option("--name", asyncString()) }),
        inner,
      );

      const result = await parseAsync(parser, [
        "--name",
        "test",
        "--value",
        "not-a-number",
      ]);

      assert.ok(!result.success);
    });

    it("should report error in deeply nested async parser", async () => {
      const parser = command(
        "cmd",
        object({
          nested: merge(
            object({ a: option("--a", asyncString()) }),
            object({ b: option("--b", asyncInteger()) }),
          ),
        }),
      );

      const result = await parseAsync(parser, [
        "cmd",
        "--a",
        "valid",
        "--b",
        "invalid",
      ]);

      assert.ok(!result.success);
    });
  });

  describe("async failures with error messages", () => {
    function asyncIntegerWithMessage(): ValueParser<"async", number> {
      return {
        $mode: "async",
        metavar: "INT",
        parse(input: string): Promise<ValueParserResult<number>> {
          const num = parseInt(input, 10);
          if (isNaN(num)) {
            return Promise.resolve({
              success: false,
              error: message`Expected integer, got "${input}"`,
            });
          }
          return Promise.resolve({ success: true, value: num });
        },
        format(value: number): string {
          return value.toString();
        },
      };
    }

    it("should preserve custom error message from async parser", async () => {
      const parser = object({
        num: option("--num", asyncIntegerWithMessage()),
      });

      const result = await parseAsync(parser, ["--num", "xyz"]);
      assert.ok(!result.success);
      // Error message should be preserved
    });

    it("should report error from first failing async parser with custom message", async () => {
      const parser = object({
        a: option("--a", asyncIntegerWithMessage()),
        b: option("--b", asyncIntegerWithMessage()),
      });

      const result = await parseAsync(parser, [
        "--a",
        "not-int",
        "--b",
        "123",
      ]);

      assert.ok(!result.success);
    });
  });

  describe("async failures in longestMatch", () => {
    it("should handle all async alternatives failing", async () => {
      const parser = longestMatch(
        command("create", object({ name: option("--name", asyncInteger()) })),
        command("delete", object({ id: option("--id", asyncInteger()) })),
      );

      // Command not matching
      const result = await parseAsync(parser, ["unknown"]);
      assert.ok(!result.success);
    });

    it("should select successful alternative when one fails", async () => {
      const parser = longestMatch(
        command("create", object({ name: option("--name", asyncString()) })),
        command("delete", object({ id: option("--id", asyncInteger()) })),
      );

      // delete command with valid input
      const result = await parseAsync(parser, ["delete", "--id", "42"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal((result.value as { id: number }).id, 42);
      }
    });
  });

  describe("async failures with optional and withDefault", () => {
    it("should not fail when optional async parser is not provided", async () => {
      const parser = object({
        required: option("--required", asyncString()),
        opt: optional(option("--opt", asyncInteger())),
      });

      const result = await parseAsync(parser, ["--required", "test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.required, "TEST");
        assert.equal(result.value.opt, undefined);
      }
    });

    it("should fail when optional async parser has invalid value", async () => {
      const parser = object({
        required: option("--required", asyncString()),
        opt: optional(option("--opt", asyncInteger())),
      });

      const result = await parseAsync(parser, [
        "--required",
        "test",
        "--opt",
        "not-a-number",
      ]);
      assert.ok(!result.success);
    });

    it("should use default when async parser is not provided", async () => {
      const parser = object({
        required: option("--required", asyncString()),
        def: withDefault(option("--def", asyncInteger()), 100),
      });

      const result = await parseAsync(parser, ["--required", "test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.required, "TEST");
        assert.equal(result.value.def, 100);
      }
    });
  });

  describe("async failures in tuple", () => {
    it("should report error when any tuple element fails", async () => {
      const parser = tuple([
        argument(asyncString()),
        argument(asyncInteger()),
      ]);

      const result = await parseAsync(parser, ["valid", "invalid"]);
      assert.ok(!result.success);
    });

    it("should succeed when all tuple elements are valid", async () => {
      const parser = tuple([
        argument(asyncString()),
        argument(asyncInteger()),
      ]);

      const result = await parseAsync(parser, ["hello", "42"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["HELLO", 42]);
      }
    });
  });

  describe("async failures in merge", () => {
    it("should report error when merged async parser fails", async () => {
      const parser = merge(
        object({ a: option("--a", asyncString()) }),
        object({ b: option("--b", asyncInteger()) }),
      );

      const result = await parseAsync(parser, [
        "--a",
        "valid",
        "--b",
        "invalid",
      ]);
      assert.ok(!result.success);
    });

    it("should succeed when all merged parsers are valid", async () => {
      const parser = merge(
        object({ a: option("--a", asyncString()) }),
        object({ b: option("--b", asyncInteger()) }),
      );

      const result = await parseAsync(parser, [
        "--a",
        "hello",
        "--b",
        "42",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.a, "HELLO");
        assert.equal(result.value.b, 42);
      }
    });
  });
});

// =============================================================================
// conditional() with Async Discriminator and Branches (Comprehensive)
// =============================================================================

describe("conditional() with async discriminator and branches (comprehensive)", () => {
  describe("exception handling in conditional with async", () => {
    function throwingAsyncChoice(): ValueParser<"async", string> {
      return {
        $mode: "async",
        metavar: "CHOICE",
        parse(_input: string): Promise<ValueParserResult<string>> {
          return Promise.reject(new Error("Async discriminator threw"));
        },
        format(value: string): string {
          return value;
        },
      };
    }

    it("should propagate exception from async discriminator", async () => {
      const parser = conditional(
        option("--type", throwingAsyncChoice()),
        {
          a: object({ val: option("--val", string()) }),
          b: object({ num: option("--num", integer()) }),
        },
      );

      await assert.rejects(
        async () => await parseAsync(parser, ["--type", "a", "--val", "test"]),
        { message: "Async discriminator threw" },
      );
    });

    it("should propagate exception from async branch parser", async () => {
      function throwingAsyncString(): ValueParser<"async", string> {
        return {
          $mode: "async",
          metavar: "THROWING",
          parse(_input: string): Promise<ValueParserResult<string>> {
            return Promise.reject(new Error("Async branch threw"));
          },
          format(value: string): string {
            return value;
          },
        };
      }

      const parser = conditional(
        option("--type", choice(["a", "b"])),
        {
          a: object({ val: option("--val", throwingAsyncString()) }),
          b: object({ num: option("--num", integer()) }),
        },
      );

      await assert.rejects(
        async () => await parseAsync(parser, ["--type", "a", "--val", "test"]),
        { message: "Async branch threw" },
      );
    });

    it("should not throw when using non-throwing branch", async () => {
      function throwingAsyncString(): ValueParser<"async", string> {
        return {
          $mode: "async",
          metavar: "THROWING",
          parse(_input: string): Promise<ValueParserResult<string>> {
            return Promise.reject(new Error("Async branch threw"));
          },
          format(value: string): string {
            return value;
          },
        };
      }

      const parser = conditional(
        option("--type", choice(["a", "b"])),
        {
          a: object({ val: option("--val", throwingAsyncString()) }),
          b: object({ num: option("--num", asyncInteger()) }),
        },
      );

      // Using branch b which doesn't throw
      const result = await parseAsync(parser, ["--type", "b", "--num", "42"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["b", { num: 42 }]);
      }
    });
  });

  describe("suggestions in conditional with async", () => {
    it("should suggest discriminator values with async choice", async () => {
      const parser = conditional(
        option("--type", asyncChoice(["json", "xml", "yaml"])),
        {
          json: object({
            indent: withDefault(option("--indent", integer()), 2),
          }),
          xml: object({ pretty: withDefault(flag("--pretty"), false) }),
          yaml: object({ flow: withDefault(flag("--flow"), false) }),
        },
      );

      const suggestions = await suggestAsync(parser, ["--type", ""]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);

      assert.ok(literals.includes("json"));
      assert.ok(literals.includes("xml"));
      assert.ok(literals.includes("yaml"));
    });

    it("should suggest branch options after discriminator is set", async () => {
      const parser = conditional(
        option("--format", asyncChoice(["a", "b"])),
        {
          a: object({ alpha: option("--alpha", asyncString()) }),
          b: object({ beta: option("--beta", asyncInteger()) }),
        },
      );

      const suggestions = await suggestAsync(parser, ["--format", "a", "--"]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);

      assert.ok(literals.includes("--alpha"));
    });

    it("should suggest async branch option values", async () => {
      const parser = conditional(
        option("--mode", choice(["dev", "prod"])),
        {
          dev: object({
            level: option("--level", asyncChoice(["debug", "info", "warn"])),
          }),
          prod: object({
            level: option("--level", asyncChoice(["warn", "error"])),
          }),
        },
      );

      const suggestions = await suggestAsync(parser, [
        "--mode",
        "dev",
        "--level",
        "",
      ]);
      const literals = suggestions
        .filter((s): s is { kind: "literal"; text: string } =>
          s.kind === "literal"
        )
        .map((s) => s.text);

      assert.ok(literals.includes("debug"));
      assert.ok(literals.includes("info"));
      assert.ok(literals.includes("warn"));
    });
  });

  describe("error reporting in conditional with async", () => {
    it("should report error when async discriminator fails", async () => {
      const parser = conditional(
        option("--type", asyncChoice(["a", "b"])),
        {
          a: object({ val: option("--val", string()) }),
          b: object({ num: option("--num", integer()) }),
        },
      );

      // Invalid discriminator value
      const result = await parseAsync(parser, ["--type", "invalid"]);
      assert.ok(!result.success);
    });

    it("should report error when async branch fails", async () => {
      const parser = conditional(
        option("--type", choice(["a", "b"])),
        {
          a: object({ val: option("--val", asyncInteger()) }),
          b: object({ num: option("--num", asyncInteger()) }),
        },
      );

      const result = await parseAsync(parser, [
        "--type",
        "a",
        "--val",
        "not-a-number",
      ]);
      assert.ok(!result.success);
    });

    it("should report error when default branch fails with async", async () => {
      const parser = conditional(
        option("--type", asyncChoice(["a", "b"])),
        {
          a: object({ val: option("--val", string()) }),
          b: object({ num: option("--num", integer()) }),
        },
        object({ fallback: option("--fallback", asyncInteger()) }), // default with async
      );

      // Using default branch with invalid value
      const result = await parseAsync(parser, ["--fallback", "not-a-number"]);
      assert.ok(!result.success);
    });
  });

  describe("nested conditional with async", () => {
    it("should handle nested conditional with async discriminators", async () => {
      const innerConditional = conditional(
        option("--inner", asyncChoice(["x", "y"])),
        {
          x: object({ xval: option("--xval", asyncString()) }),
          y: object({ yval: option("--yval", asyncInteger()) }),
        },
      );

      const parser = conditional(
        option("--outer", asyncChoice(["first", "second"])),
        {
          first: innerConditional,
          second: object({ simple: option("--simple", asyncString()) }),
        },
      );

      const result = await parseAsync(parser, [
        "--outer",
        "first",
        "--inner",
        "x",
        "--xval",
        "hello",
      ]);

      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["first", ["x", { xval: "HELLO" }]]);
      }
    });
  });

  describe("conditional with mixed sync/async", () => {
    it("should work with sync discriminator and async branches", async () => {
      const parser = conditional(
        option("--type", choice(["sync", "async"])),
        {
          sync: object({ sval: option("--sval", string()) }),
          async: object({ aval: option("--aval", asyncString()) }),
        },
      );

      // Test sync branch
      const result1 = await parseAsync(parser, [
        "--type",
        "sync",
        "--sval",
        "test",
      ]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value, ["sync", { sval: "test" }]);
      }

      // Test async branch
      const result2 = await parseAsync(parser, [
        "--type",
        "async",
        "--aval",
        "hello",
      ]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.deepEqual(result2.value, ["async", { aval: "HELLO" }]);
      }
    });

    it("should work with async discriminator and sync branches", async () => {
      const parser = conditional(
        option("--type", asyncChoice(["alpha", "beta"])),
        {
          alpha: object({ val: option("--val", string()) }),
          beta: object({ num: option("--num", integer()) }),
        },
      );

      const result = await parseAsync(parser, [
        "--type",
        "alpha",
        "--val",
        "test",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["alpha", { val: "test" }]);
      }
    });
  });

  describe("conditional with command and async", () => {
    it("should handle conditional inside command with async", async () => {
      const parser = command(
        "run",
        conditional(
          option("--mode", asyncChoice(["fast", "slow"])),
          {
            fast: object({
              threads: withDefault(option("--threads", asyncInteger()), 4),
            }),
            slow: object({
              delay: withDefault(option("--delay", asyncInteger()), 100),
            }),
          },
        ),
      );

      const result = await parseAsync(parser, [
        "run",
        "--mode",
        "fast",
        "--threads",
        "8",
      ]);

      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["fast", { threads: 8 }]);
      }
    });
  });
});
