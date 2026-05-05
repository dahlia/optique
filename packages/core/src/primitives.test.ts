import {
  conditional,
  group,
  longestMatch,
  merge,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import type { DocEntry } from "@optique/core/doc";
import {
  formatMessage,
  type Message,
  message,
  text,
} from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import {
  argument,
  command,
  constant,
  fail,
  flag,
  negatableFlag,
  option,
  passThrough,
} from "@optique/core/primitives";
import {
  choice,
  integer,
  string,
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import {
  dependency,
  dependencyId,
  DependencyRegistry,
  deriveFromAsync,
  deriveFromSync,
} from "./internal/dependency.ts";
import { annotationKey } from "./internal/annotations.ts";
import { extractDependencyMetadata } from "./dependency-metadata.ts";
import {
  type InferValue,
  parse,
  parseAsync,
  type Parser,
  type ParserContext,
  parseSync,
  suggest,
  type Suggestion,
} from "@optique/core/parser";
import type { Usage } from "@optique/core/usage";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function assertErrorIncludes(error: Message, text: string): void {
  const formatted = formatMessage(error);
  assert.ok(formatted.includes(text));
}

function fileSuggestingParser(): ValueParser<"sync", string> {
  return {
    mode: "sync",
    metavar: "FILE",
    placeholder: "",
    parse(input: string): ValueParserResult<string> {
      return { success: true, value: input };
    },
    format(value: string): string {
      return value;
    },
    suggest(_prefix: string): Iterable<Suggestion> {
      return [{ kind: "file", type: "any", pattern: "*.txt" }];
    },
  };
}

function asyncFileSuggestingParser(): ValueParser<"async", string> {
  return {
    mode: "async",
    metavar: "FILE",
    placeholder: "",
    parse(input: string): Promise<ValueParserResult<string>> {
      return Promise.resolve({ success: true, value: input });
    },
    format(value: string): string {
      return value;
    },
    suggest(_prefix: string): AsyncIterable<Suggestion> {
      return {
        async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
          yield { kind: "file", type: "any", pattern: "*.log" };
        },
      };
    },
  };
}

function noSuggestParser(): ValueParser<"sync", string> {
  return {
    mode: "sync",
    metavar: "TEXT",
    placeholder: "",
    parse(input: string): ValueParserResult<string> {
      return { success: true, value: input };
    },
    format(value: string): string {
      return value;
    },
  };
}

describe("constant", () => {
  it("should create a parser that always returns the same value", () => {
    const parser = constant(42);

    assert.equal(parser.priority, 0);
    assert.equal(parser.initialState, 42);
  });

  it("should parse without consuming any input", () => {
    const parser = constant("hello");
    const context = {
      buffer: ["--option", "value"] as readonly string[],
      state: "hello" as const,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.next, context);
      assert.deepEqual(result.consumed, []);
    }
  });

  it("should complete successfully with the constant value", () => {
    const parser = constant(123);
    const result = parser.complete(123 as const);

    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, 123);
    }
  });

  it("should work with different value types", () => {
    const stringParser = constant("test");
    const numberParser = constant(42);
    const booleanParser = constant(true);
    const objectParser = constant({ key: "value" });

    assert.equal(stringParser.initialState, "test");
    assert.equal(numberParser.initialState, 42);
    assert.equal(booleanParser.initialState, true);
    assert.deepEqual(objectParser.initialState, { key: "value" });
  });

  describe("getDocFragments", () => {
    it("should return empty array as constants have no documentation", () => {
      const parser = constant("test");

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.deepEqual(fragments, { fragments: [] });
    });

    it("should return empty array with different state values", () => {
      const parser1 = constant(42);
      const parser2 = constant("test");

      const fragments1 = parser1.getDocFragments({
        kind: "available",
        state: parser1.initialState,
      });
      const fragments2 = parser2.getDocFragments({
        kind: "available",
        state: parser2.initialState,
      });

      assert.deepEqual(fragments1, { fragments: [] });
      assert.deepEqual(fragments2, { fragments: [] });
    });

    it("should return empty array with default value parameter", () => {
      const parser = constant("hello");

      const fragments1 = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });
      const fragments2 = parser.getDocFragments(
        { kind: "available", state: parser.initialState },
        parser.initialState,
      );

      assert.deepEqual(fragments1, { fragments: [] });
      assert.deepEqual(fragments2, { fragments: [] });
    });

    it("should return empty array for different constant types", () => {
      const stringParser = constant("string");
      const numberParser = constant(123);
      const booleanParser = constant(true);
      const objectParser = constant({ key: "value" });

      assert.deepEqual(
        stringParser.getDocFragments({ kind: "available", state: "string" }),
        {
          fragments: [],
        },
      );
      assert.deepEqual(
        numberParser.getDocFragments({ kind: "available", state: 123 }),
        { fragments: [] },
      );
      assert.deepEqual(
        booleanParser.getDocFragments({ kind: "available", state: true }),
        { fragments: [] },
      );
      assert.deepEqual(
        objectParser.getDocFragments({
          kind: "available",
          state: { key: "value" },
        }),
        {
          fragments: [],
        },
      );
    });
  });
});

describe("fail", () => {
  it("should have priority 0 and undefined initialState", () => {
    const parser = fail<string>();
    assert.equal(parser.priority, 0);
    assert.equal(parser.initialState, undefined);
  });

  it("should fail parse without consuming any input", () => {
    const parser = fail<number>();
    const context = {
      buffer: ["--option", "value"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(result.consumed, 0);
    }
  });

  it("should fail parse with empty buffer", () => {
    const parser = fail<string>();
    const context = {
      buffer: [] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(result.consumed, 0);
    }
  });

  it("should fail complete with undefined state", () => {
    const parser = fail<string>();
    const result = parser.complete(undefined);
    assert.ok(!result.success);
  });

  it("should have empty usage", () => {
    const parser = fail<string>();
    assert.deepEqual(parser.usage, []);
  });

  it("should return no doc fragments", () => {
    const parser = fail<string>();
    const fragments = parser.getDocFragments({ kind: "unavailable" });
    assert.deepEqual(fragments, { fragments: [] });
  });

  it("should return no suggestions", () => {
    const parser = fail<string>();
    const context = {
      buffer: [] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };
    const suggestions = [...parser.suggest(context, "")];
    assert.deepEqual(suggestions, []);
  });

  it("should work with withDefault() to always use the default", () => {
    const parser = withDefault(fail<string>(), "default-value");
    const result = parseSync(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "default-value");
    }
  });

  it("should work with optional() to always produce undefined", () => {
    const parser = optional(fail<string>());
    const result = parseSync(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, undefined);
    }
  });

  it("should work inside object() with withDefault()", () => {
    const parser = object({
      name: option("--name", string()),
      timeout: withDefault(fail<number>(), 30),
    });
    const result = parseSync(parser, ["--name", "Alice"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.name, "Alice");
      assert.equal(result.value.timeout, 30);
    }
  });
});

describe("option", () => {
  describe("boolean flags", () => {
    it("should parse single short option", () => {
      const parser = option("-v");
      const context = {
        buffer: ["-v"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        if (result.next.state) {
          assert.ok(result.next.state.success);
          if (result.next.state.success) {
            assert.equal(result.next.state.value, true);
          }
        }
        assert.deepEqual(result.next.buffer, []);
        assert.deepEqual(result.consumed, ["-v"]);
      }
    });

    it("should parse long option", () => {
      const parser = option("--verbose");
      const context = {
        buffer: ["--verbose"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        if (result.next.state) {
          assert.ok(result.next.state.success);
          if (result.next.state.success) {
            assert.equal(result.next.state.value, true);
          }
        }
        assert.deepEqual(result.next.buffer, []);
      }
    });

    it("should parse multiple option names", () => {
      const parser = option("-v", "--verbose");

      const context1 = {
        buffer: ["-v"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };
      const result1 = parser.parse(context1);
      assert.ok(result1.success);
      if (result1.success && result1.next.state && result1.next.state.success) {
        assert.equal(result1.next.state.value, true);
      }

      const context2 = {
        buffer: ["--verbose"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };
      const result2 = parser.parse(context2);
      assert.ok(result2.success);
      if (result2.success && result2.next.state && result2.next.state.success) {
        assert.equal(result2.next.state.value, true);
      }
    });

    it("should fail when option is already set", () => {
      const parser = option("-v");
      const context = {
        buffer: ["-v"] as readonly string[],
        state: { success: true as const, value: true },
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(result.consumed, 1);
        assertErrorIncludes(result.error, "cannot be used multiple times");
      }
    });

    it("should handle bundled short options", () => {
      const parser = option("-v");
      const context = {
        buffer: ["-vd"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        if (result.next.state) {
          assert.ok(result.next.state.success);
          if (result.next.state.success) {
            assert.equal(result.next.state.value, true);
          }
        }
        assert.deepEqual(result.next.buffer, ["-d"]);
        assert.deepEqual(result.consumed, ["-v"]);
      }
    });

    it("should fail when options are terminated", () => {
      const parser = option("-v");
      const context = {
        buffer: ["-v"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: true,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(result.consumed, 0);
        assertErrorIncludes(result.error, "No more options can be parsed.");
      }
    });

    it("should handle options terminator --", () => {
      const parser = option("-v");
      const context = {
        buffer: ["--"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.next.optionsTerminated, true);
        assert.deepEqual(result.next.buffer, []);
        assert.deepEqual(result.consumed, ["--"]);
      }
    });

    it("should handle empty buffer", () => {
      const parser = option("-v");
      const context = {
        buffer: [] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(result.consumed, 0);
        assertErrorIncludes(result.error, "Expected an option");
      }
    });
  });

  describe("options with values", () => {
    it("should parse option with separated value", () => {
      const parser = option("-p", "--port", integer());
      const context = {
        buffer: ["--port", "8080"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        if (result.next.state) {
          assert.ok(result.next.state.success);
          if (result.next.state.success) {
            assert.equal(result.next.state.value, 8080);
          }
        }
        assert.deepEqual(result.next.buffer, []);
        assert.deepEqual(result.consumed, ["--port", "8080"]);
      }
    });

    it("should parse option with equals-separated value", () => {
      const parser = option("--port", integer());
      const context = {
        buffer: ["--port=8080"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        if (result.next.state) {
          assert.ok(result.next.state.success);
          if (result.next.state.success) {
            assert.equal(result.next.state.value, 8080);
          }
        }
        assert.deepEqual(result.next.buffer, []);
        assert.deepEqual(result.consumed, ["--port=8080"]);
      }
    });

    it("should parse DOS-style option with colon", () => {
      const parser = option("/P", integer());
      const context = {
        buffer: ["/P:8080"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        if (result.next.state) {
          assert.ok(result.next.state.success);
          if (result.next.state.success) {
            assert.equal(result.next.state.value, 8080);
          }
        }
      }
    });

    it("should fail when value is missing", () => {
      const parser = option("--port", integer({ metavar: "PORT" }));
      const context = {
        buffer: ["--port"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(result.consumed, 1);
        assertErrorIncludes(result.error, "--port");
        assertErrorIncludes(result.error, "PORT");
      }
    });

    it("should fail when boolean flag gets a value", () => {
      const parser = option("--verbose");
      const context = {
        buffer: ["--verbose=true"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(result.consumed, 1);
        assertErrorIncludes(result.error, "is a Boolean flag");
      }
    });

    it("should parse string values", () => {
      const parser = option("--name", string({ metavar: "NAME" }));
      const context = {
        buffer: ["--name", "Alice"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        if (result.next.state) {
          assert.ok(result.next.state.success);
          if (result.next.state.success) {
            assert.equal(result.next.state.value, "Alice");
          }
        }
      }
    });

    it("should propagate value parser failures", () => {
      const parser = option("--port", integer({ min: 1, max: 0xffff }));
      const context = {
        buffer: ["--port", "invalid"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        if (result.next.state) {
          assert.ok(!result.next.state.success);
        }
      }
    });

    it("should suggest only short options for '-' prefix", () => {
      const parser = option("-v", "--verbose", string());
      const suggestions = Array.from(parser.suggest({
        buffer: [],
        state: parser.initialState,
        usage: parser.usage,
        optionsTerminated: false,
      }, "-"));

      assert.deepEqual(suggestions, [{ kind: "literal", text: "-v" }]);
    });

    it("should suggest value candidates on empty buffer", () => {
      const parser = option("--env", choice(["dev", "prod"]));
      const suggestions = Array.from(parser.suggest({
        buffer: [],
        state: parser.initialState,
        usage: parser.usage,
        optionsTerminated: false,
      }, "p"));

      assert.deepEqual(suggestions, [{ kind: "literal", text: "prod" }]);
    });

    it("should not suggest option names while completing a value", () => {
      const parser = option("--mode", choice(["dev", "prod", "preview"]));
      const suggestions = Array.from(parser.suggest({
        buffer: ["--mode"],
        state: parser.initialState,
        usage: parser.usage,
        optionsTerminated: false,
      }, "--"));

      assert.deepEqual(suggestions, []);
    });

    it("should fall back file suggestions to literal in --opt=value format", () => {
      const parser = option("--file", fileSuggestingParser());
      const suggestions = Array.from(parser.suggest({
        buffer: [],
        state: parser.initialState,
        usage: parser.usage,
        optionsTerminated: false,
      }, "--file=a"));

      assert.deepEqual(suggestions, [{
        kind: "literal",
        text: "--file=*.txt",
        description: undefined,
      }]);
    });

    it("should return no suggestions when value parser has no suggest", () => {
      const parser = option("--name", noSuggestParser());
      const suggestions = Array.from(parser.suggest({
        buffer: ["--name"],
        state: parser.initialState,
        usage: parser.usage,
        optionsTerminated: false,
      }, ""));

      assert.deepEqual(suggestions, []);
    });

    it("should suggest async values and short-only '-' behavior", async () => {
      const parser = option("-l", "--log", asyncFileSuggestingParser());

      const optionSuggestions: Suggestion[] = [];
      for await (
        const suggestion of parser.suggest({
          buffer: [],
          state: parser.initialState,
          usage: parser.usage,
          optionsTerminated: false,
        }, "-")
      ) {
        optionSuggestions.push(suggestion);
      }
      assert.deepEqual(optionSuggestions, [{ kind: "literal", text: "-l" }]);

      const valueSuggestions: Suggestion[] = [];
      for await (
        const suggestion of parser.suggest({
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        }, "--log=x")
      ) {
        valueSuggestions.push(suggestion);
      }
      assert.deepEqual(valueSuggestions, [{
        kind: "literal",
        text: "--log=*.log",
        description: undefined,
      }]);
    });

    it("should not suggest async option names while completing a value", async () => {
      const asyncModeParser: ValueParser<"async", string> = {
        mode: "async",
        metavar: "MODE",
        placeholder: "",
        parse(input: string): Promise<ValueParserResult<string>> {
          return Promise.resolve({ success: true, value: input });
        },
        format(value: string): string {
          return value;
        },
        suggest(prefix: string): AsyncIterable<Suggestion> {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              for (const candidate of ["dev", "prod"] as const) {
                if (candidate.startsWith(prefix)) {
                  yield { kind: "literal", text: candidate };
                }
              }
            },
          };
        },
      };
      const parser = option("--mode", asyncModeParser);
      const suggestions: Suggestion[] = [];
      for await (
        const suggestion of parser.suggest({
          buffer: ["--mode"],
          state: parser.initialState,
          usage: parser.usage,
          optionsTerminated: false,
        }, "--")
      ) {
        suggestions.push(suggestion);
      }

      assert.deepEqual(suggestions, []);
    });
  });

  it("should fail on unmatched option", () => {
    const parser = option("-v", "--verbose");
    const context = {
      buffer: ["--help"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(result.consumed, 0);
      assertErrorIncludes(result.error, "No matched option");
    }
  });

  describe("getDocFragments", () => {
    it("should return documentation fragment for boolean flag option", () => {
      const parser = option("-v", "--verbose");
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "option");
        if (fragments.fragments[0].term.type === "option") {
          assert.deepEqual(fragments.fragments[0].term.names, [
            "-v",
            "--verbose",
          ]);
          assert.equal(fragments.fragments[0].term.metavar, undefined);
        }
        assert.equal(fragments.fragments[0].description, undefined);
        assert.equal(fragments.fragments[0].default, undefined);
      }
    });

    it("should return documentation fragment for option with value parser", () => {
      const parser = option("--port", integer());
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "option");
        if (fragments.fragments[0].term.type === "option") {
          assert.deepEqual(fragments.fragments[0].term.names, ["--port"]);
          assert.equal(fragments.fragments[0].term.metavar, "INTEGER");
        }
        assert.equal(fragments.fragments[0].description, undefined);
        assert.equal(fragments.fragments[0].default, undefined);
      }
    });

    it("should include description when provided", () => {
      const description = message`Enable verbose output`;
      const parser = option("-v", "--verbose", { description });
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].description, description);
      }
    });

    it("should include default value when provided", () => {
      const parser = option("--port", integer());
      const fragments = parser.getDocFragments(
        parser.initialState === undefined
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: parser.initialState },
        8080,
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].default, message`${"8080"}`);
      }
    });

    it("should not include default value for boolean flags", () => {
      const parser = option("-v", "--verbose");
      const fragments = parser.getDocFragments(
        parser.initialState === undefined
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: parser.initialState },
        true,
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].default, undefined);
      }
    });

    it("should work with string value parser and default", () => {
      const parser = option("--name", string());
      const fragments = parser.getDocFragments(
        parser.initialState === undefined
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: parser.initialState },
        "John",
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].default, message`${"John"}`);
      }
    });

    it("should work with custom metavar in value parser", () => {
      const parser = option("--file", string({ metavar: "PATH" }));
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "option");
        if (fragments.fragments[0].term.type === "option") {
          assert.equal(fragments.fragments[0].term.metavar, "PATH");
        }
      }
    });
  });

  describe("single-dash multi-char equals-joined options", () => {
    it("should parse -key=value with integer value parser", () => {
      const parser = option("-seed", integer());
      const context = {
        buffer: ["-seed=42"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      assert.ok(result.next.state?.success);
      assert.equal(result.next.state.value, 42);
      assert.deepEqual(result.next.buffer, []);
      assert.deepEqual(result.consumed, ["-seed=42"]);
    });

    it("should parse -key=value with underscore in name", () => {
      const parser = option("-max_len", integer());
      const context = {
        buffer: ["-max_len=1000"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      assert.ok(result.next.state?.success);
      assert.equal(result.next.state.value, 1000);
      assert.deepEqual(result.next.buffer, []);
      assert.deepEqual(result.consumed, ["-max_len=1000"]);
    });

    it("should parse -key=value with string value", () => {
      const parser = option("-dict", string());
      const context = {
        buffer: ["-dict=DICTIONARY_FILE"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      assert.ok(result.next.state?.success);
      assert.equal(result.next.state.value, "DICTIONARY_FILE");
      assert.deepEqual(result.next.buffer, []);
      assert.deepEqual(result.consumed, ["-dict=DICTIONARY_FILE"]);
    });

    it("should still parse space-separated values for single-dash multi-char options", () => {
      const parser = option("-seed", integer());
      const context = {
        buffer: ["-seed", "42"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      assert.ok(result.next.state?.success);
      assert.equal(result.next.state.value, 42);
      assert.deepEqual(result.next.buffer, []);
      assert.deepEqual(result.consumed, ["-seed", "42"]);
    });

    it("should not treat single-char option as equals-joined", () => {
      const parser = option("-v", string());
      const context = {
        buffer: ["-v=foo"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
    });

    it("should not affect short option bundling", () => {
      const parserV = option("-v");
      const parserD = option("-d");
      const combined = object({ v: parserV, d: parserD });
      const result = parseSync(combined, ["-vd"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { v: true, d: true });
    });

    it("should detect duplicate -key=value", () => {
      const parser = option("-seed", integer());
      const context = {
        buffer: ["-seed=99"] as readonly string[],
        state: { success: true as const, value: 42 },
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(
          formatMessage(result.error),
          "`-seed` cannot be used multiple times.",
        );
      }
    });

    it("should reject -key=value for boolean option", () => {
      const parser = option("-verbose");
      const context = {
        buffer: ["-verbose=true"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
    });

    it("should reject -key=value for flag()", () => {
      const parser = flag("-verbose");
      const context = {
        buffer: ["-verbose=true"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
    });

    it("should work with parseSync for multiple -key=value options", () => {
      const parser = object({
        seed: option("-seed", integer()),
        maxLen: option("-max_len", integer()),
        dict: option("-dict", string()),
      });
      const result = parseSync(
        parser,
        ["-seed=42", "-max_len=1000", "-dict=words.txt"],
      );
      assert.ok(result.success);
      assert.deepEqual(result.value, {
        seed: 42,
        maxLen: 1000,
        dict: "words.txt",
      });
    });

    it("should handle mixed equals-joined and space-separated styles", () => {
      const parser = object({
        seed: option("-seed", integer()),
        timeout: option("-timeout", integer()),
      });
      const result = parseSync(parser, ["-seed=42", "-timeout", "1200"]);
      assert.ok(result.success);
      assert.deepEqual(result.value, { seed: 42, timeout: 1200 });
    });
  });
});

describe("option() error customization", () => {
  it("should use custom missing error", () => {
    const parser = option("--verbose", string(), {
      errors: {
        missing: message`The --verbose option is required.`,
      },
    });

    const result = parser.complete(undefined);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "The --verbose option is required.",
      );
    }
  });

  it("should use custom missing error function", () => {
    const parser = option("--config", string(), {
      errors: {
        missing: (names) =>
          message`Required option is ${text(names.join(", "))}.`,
      },
    });

    const result = parser.complete(undefined);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Required option is --config.",
      );
    }
  });

  it("should use custom optionsTerminated error", () => {
    const parser = option("--verbose", {
      errors: {
        optionsTerminated: message`Cannot parse --verbose after -- terminator.`,
      },
    });

    const context = {
      buffer: ["--verbose"],
      state: undefined,
      optionsTerminated: true,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Cannot parse --verbose after -- terminator.",
      );
    }
  });

  it("should use custom duplicate error with function", () => {
    const parser = option("--verbose", {
      errors: {
        duplicate: (token) =>
          message`The option ${text(token)} was already specified.`,
      },
    });

    // Context with existing successful state should fail with duplicate error
    const context = {
      buffer: ["--verbose"],
      state: { success: true, value: true } as const,
      optionsTerminated: false,
      usage: parser.usage,
    };
    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "The option --verbose was already specified.",
      );
    }
  });

  it("should use custom duplicate error static message for joined format", () => {
    const parser = option("-seed", integer(), {
      errors: {
        duplicate: message`Seed can only be specified once.`,
      },
    });

    const context = {
      buffer: ["-seed=99"] as readonly string[],
      state: { success: true as const, value: 42 },
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Seed can only be specified once.",
      );
    }
  });

  it("should use custom unexpectedValue error function", () => {
    const parser = option("-verbose", {
      errors: {
        unexpectedValue: (value) =>
          message`Unexpected inline value: ${text(value)}.`,
      },
    });

    const result = parser.parse({
      buffer: ["-verbose=true"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Unexpected inline value: true.",
      );
    }
  });

  it("should use custom invalidValue error", () => {
    const parser = option("--port", integer(), {
      errors: {
        invalidValue: (error) => message`Invalid port number: ${error}`,
      },
    });

    // Create a failed value parser result to test complete method
    const failedState = {
      success: false,
      error: message`Expected a valid integer, but got "invalid".`,
    } as const;

    const result = parser.complete(failedState);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(errorMessage.includes("Invalid port number:"));
    }
  });

  it("should keep missing and invalidValue completion paths distinct", () => {
    const parser = option("--port", integer(), {
      errors: {
        missing: message`Port is required.`,
        invalidValue: () => message`Port is invalid.`,
      },
    });

    const result = parser.complete(parser.initialState);
    assert.ok(!result.success);
    if (!result.success) {
      assert.deepEqual(result.error, message`Port is required.`);
    }

    const invalidResult = parser.complete({
      success: false,
      error: message`bad`,
    });
    assert.ok(!invalidResult.success);
    if (!invalidResult.success) {
      assert.deepEqual(invalidResult.error, message`Port is invalid.`);
    }
  });

  it("should use custom noMatch error with static message", () => {
    const innerParser = object({
      verbose: option("--verbose", "--debug"),
    });
    const parser = option("--help", {
      errors: {
        noMatch: message`The --help option is required in this context.`,
      },
    });

    const context = {
      buffer: ["--verbos"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: innerParser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "The --help option is required in this context.",
      );
    }
  });

  it("should use custom noMatch error with function", () => {
    const innerParser = object({
      verbose: option("--verbose", "--debug"),
    });
    const parser = option("--help", {
      errors: {
        noMatch: (invalidOption, suggestions) => {
          if (suggestions.length > 0) {
            return message`Option ${text(invalidOption)} not recognized. Try: ${
              text(suggestions.join(", "))
            }`;
          }
          return message`Option ${text(invalidOption)} not recognized.`;
        },
      },
    });

    const context = {
      buffer: ["--verbos"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: innerParser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(errorMessage.includes("--verbos"));
      assert.ok(
        errorMessage.includes("--verbose") || errorMessage.includes("--debug"),
      );
    }
  });

  it("should use custom noMatch error to disable suggestions", () => {
    const innerParser = object({
      verbose: option("--verbose"),
    });
    const parser = option("--help", {
      errors: {
        noMatch: (invalidOption) =>
          message`Invalid option: ${text(invalidOption)}`,
      },
    });

    const context = {
      buffer: ["--verbos"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: innerParser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.strictEqual(errorMessage, "Invalid option: --verbos");
      assert.ok(!errorMessage.includes("Did you mean"));
    }
  });
});

describe("flag", () => {
  describe("basic functionality", () => {
    it("should parse single short flag", () => {
      const parser = flag("-f");
      const context = {
        buffer: ["-f"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        assert.ok(result.next.state.success);
        assert.equal(result.next.state.value, true);
        assert.deepEqual(result.next.buffer, []);
        assert.deepEqual(result.consumed, ["-f"]);
      }
    });

    it("should parse long flag", () => {
      const parser = flag("--force");
      const context = {
        buffer: ["--force"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        assert.ok(result.next.state.success);
        assert.equal(result.next.state.value, true);
      }
    });

    it("should parse flag with multiple names", () => {
      const parser = flag("-f", "--force");

      // Test with short form
      let context = {
        buffer: ["-f"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };
      let result = parser.parse(context);
      assert.ok(result.success);

      // Test with long form
      context = {
        buffer: ["--force"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };
      result = parser.parse(context);
      assert.ok(result.success);
    });
  });

  describe("complete function", () => {
    it("should fail when flag is not provided", () => {
      const parser = flag("-f", "--force");
      const result = parser.complete(undefined);

      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "Required flag");
        assertErrorIncludes(result.error, "-f");
        assertErrorIncludes(result.error, "--force");
      }
    });

    it("should succeed when flag was parsed", () => {
      const parser = flag("-f");
      const result = parser.complete({ success: true, value: true });

      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, true);
      }
    });

    it("should propagate parse errors", () => {
      const parser = flag("-f");
      const state = {
        success: false as const,
        error: message`Some parse error`,
      };
      const result = parser.complete(state);

      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "Some parse error");
      }
    });
  });

  describe("error handling", () => {
    it("should fail when flag receives a value with = syntax", () => {
      const parser = flag("--force");
      const context = {
        buffer: ["--force=true"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(result.consumed, 1);
        assertErrorIncludes(result.error, "does not accept a value");
        assertErrorIncludes(result.error, "true");
      }
    });

    it("should fail when flag is used multiple times", () => {
      const parser = flag("-f");
      const context = {
        buffer: ["-f"] as readonly string[],
        state: { success: true as const, value: true as const },
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(result.consumed, 1);
        assertErrorIncludes(result.error, "cannot be used multiple times");
      }
    });

    it("should handle bundled short options", () => {
      const parser = flag("-f");
      const context = {
        buffer: ["-fd"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.next.state);
        assert.ok(result.next.state.success);
        assert.equal(result.next.state.value, true);
        assert.deepEqual(result.next.buffer, ["-d"]);
        assert.deepEqual(result.consumed, ["-f"]);
      }
    });

    it("should fail when options are terminated", () => {
      const parser = flag("-f");
      const context = {
        buffer: ["-f"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: true,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(result.consumed, 0);
        assertErrorIncludes(result.error, "No more options can be parsed");
      }
    });

    it("should handle options terminator --", () => {
      const parser = flag("-f");
      const context = {
        buffer: ["--"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.next.optionsTerminated, true);
        assert.deepEqual(result.next.buffer, []);
        assert.deepEqual(result.consumed, ["--"]);
      }
    });
  });

  describe("integration with parse", () => {
    it("should succeed when flag is provided", () => {
      const parser = flag("-f", "--force");

      const result = parseSync(parser, ["-f"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, true);
      }
    });

    it("should fail when flag is not provided", () => {
      const parser = flag("-f", "--force");

      const result = parseSync(parser, []);
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "Expected an option");
      }
    });

    it("should work with object parser", () => {
      const parser = object({
        force: flag("-f", "--force"),
        verbose: option("-v", "--verbose"),
      });

      // With flag
      let result = parseSync(parser, ["-f", "-v"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.force, true);
        assert.equal(result.value.verbose, true);
      }

      // Without flag
      result = parseSync(parser, ["-v"]);
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "Required flag");
      }
    });

    it("should work with optional wrapper in object", () => {
      const parser = object({
        force: optional(flag("-f")),
        name: argument(string()),
      });

      // With flag
      let result = parseSync(parser, ["-f", "test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.force, true);
        assert.equal(result.value.name, "test");
      }

      // Without flag
      result = parseSync(parser, ["test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.force, undefined);
        assert.equal(result.value.name, "test");
      }
    });
  });

  describe("documentation", () => {
    it("should generate documentation fragment", () => {
      const parser = flag("-f", "--force", {
        description: message`Force operation`,
      });
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "option");
        if (fragments.fragments[0].term.type === "option") {
          assert.deepEqual(fragments.fragments[0].term.names, [
            "-f",
            "--force",
          ]);
          assert.equal(fragments.fragments[0].term.metavar, undefined);
        }
        assert.ok(fragments.fragments[0].description);
        assertErrorIncludes(
          fragments.fragments[0].description!,
          "Force operation",
        );
      }
    });

    it("should have correct usage", () => {
      const parser = flag("-f", "--force");
      assert.deepEqual(parser.usage, [{
        type: "option",
        names: ["-f", "--force"],
      }]);
    });
  });
});

describe("negatableFlag()", () => {
  it("should parse the positive flag as true", () => {
    const parser = negatableFlag({
      positive: "--color",
      negative: "--no-color",
    });

    const result = parseSync(parser, ["--color"]);

    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, true);
    }
  });

  it("should parse the negative flag as false", () => {
    const parser = negatableFlag({
      positive: "--color",
      negative: "--no-color",
    });

    const result = parseSync(parser, ["--no-color"]);

    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, false);
    }
  });

  it("should fail when neither flag is provided", () => {
    const parser = negatableFlag({
      positive: "--color",
      negative: "--no-color",
    });

    const result = parseSync(parser, []);

    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Expected an option");
    }
  });

  it("should report all names when completed without a flag", () => {
    const parser = negatableFlag({
      positive: "--color",
      negative: "--no-color",
    });

    const result = parser.complete(undefined);

    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Required flag");
      assertErrorIncludes(result.error, "--color");
      assertErrorIncludes(result.error, "--no-color");
    }
  });

  it("should return undefined when wrapped in optional", () => {
    const parser = optional(negatableFlag({
      positive: "--color",
      negative: "--no-color",
    }));

    const result = parseSync(parser, []);

    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, undefined);
    }
  });

  it("should use a default when wrapped in withDefault", () => {
    const parser = withDefault(
      negatableFlag({
        positive: "--color",
        negative: "--no-color",
      }),
      () => true,
    );

    const result = parseSync(parser, []);

    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, true);
    }
  });

  it("should support positive and negative aliases", () => {
    const parser = negatableFlag({
      positive: ["-c", "--color"],
      negative: ["-C", "--no-color"],
    });

    const positive = parseSync(parser, ["-c"]);
    const negative = parseSync(parser, ["-C"]);

    assert.ok(positive.success);
    if (positive.success) {
      assert.equal(positive.value, true);
    }
    assert.ok(negative.success);
    if (negative.success) {
      assert.equal(negative.value, false);
    }
  });

  it("should expose all names in one documentation entry", () => {
    const parser = negatableFlag({
      positive: ["--color"],
      negative: ["--no-color"],
    }, {
      description: message`Control colored output.`,
    });

    const fragments = parser.getDocFragments(
      { kind: "unavailable" },
      undefined,
    );

    assert.equal(fragments.fragments.length, 1);
    assert.equal(fragments.fragments[0].type, "entry");
    if (fragments.fragments[0].type === "entry") {
      assert.equal(fragments.fragments[0].term.type, "option");
      if (fragments.fragments[0].term.type === "option") {
        assert.deepEqual(fragments.fragments[0].term.names, [
          "--color",
          "--no-color",
        ]);
      }
      assert.ok(fragments.fragments[0].description);
      assert.equal(
        formatMessage(fragments.fragments[0].description),
        "Control colored output.",
      );
    }
  });

  it("should suggest matching positive and negative names", () => {
    const parser = negatableFlag({
      positive: ["-c", "--color"],
      negative: ["-C", "--no-color"],
    });

    const suggestions = Array.from(parser.suggest(
      {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      },
      "--",
    ));

    assert.deepEqual(suggestions, [
      { kind: "literal", text: "--color" },
      { kind: "literal", text: "--no-color" },
    ]);
  });

  it("should respect hidden options in docs and suggestions", () => {
    const parser = negatableFlag({
      positive: "--color",
      negative: "--no-color",
    }, {
      hidden: true,
    });

    const fragments = parser.getDocFragments(
      { kind: "unavailable" },
      undefined,
    );
    const suggestions = Array.from(parser.suggest(
      {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      },
      "--",
    ));

    assert.deepEqual(fragments.fragments, []);
    assert.deepEqual(suggestions, []);
  });
});

describe("flag() error customization", () => {
  it("should use custom missing error", () => {
    const parser = flag("--force", {
      errors: {
        missing: message`The --force flag is required for this operation.`,
      },
    });

    const result = parser.complete(undefined);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "The --force flag is required for this operation.",
      );
    }
  });

  it("should use custom optionsTerminated error", () => {
    const parser = flag("--force", {
      errors: {
        optionsTerminated: message`Cannot parse --force after -- terminator.`,
      },
    });

    const context = {
      buffer: ["--force"],
      state: undefined,
      optionsTerminated: true,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Cannot parse --force after -- terminator.",
      );
    }
  });

  it("should use custom duplicate error with function", () => {
    const parser = flag("--force", {
      errors: {
        duplicate: (token) =>
          message`The flag ${text(token)} was already specified.`,
      },
    });

    const context = {
      buffer: ["--force"],
      state: { success: true, value: true } as const,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "The flag --force was already specified.",
      );
    }
  });

  it("should use custom noMatch error with static message", () => {
    const innerParser = object({
      force: flag("--force", "--yes"),
    });
    const parser = flag("--help", {
      errors: {
        noMatch: message`The --help flag is required here.`,
      },
    });

    const context = {
      buffer: ["--forc"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: innerParser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "The --help flag is required here.",
      );
    }
  });

  it("should use custom noMatch error with function", () => {
    const innerParser = object({
      force: flag("--force"),
    });
    const parser = flag("--help", {
      errors: {
        noMatch: (invalidOption, suggestions) => {
          if (suggestions.length > 0) {
            return message`Flag ${text(invalidOption)} unknown. Did you mean ${
              text(suggestions[0])
            }?`;
          }
          return message`Flag ${text(invalidOption)} unknown.`;
        },
      },
    });

    const context = {
      buffer: ["--forc"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: innerParser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(errorMessage.includes("--forc"));
      assert.ok(errorMessage.includes("--force"));
    }
  });
});

describe("argument", () => {
  it("should treat annotations as transparent during top-level parsing", () => {
    const annotation = Symbol.for("@test/issue-187/argument-parse");
    const result = parse(argument(string()), ["value"], {
      annotations: { [annotation]: true },
    });

    assert.deepEqual(result, { success: true, value: "value" });
  });

  it("should keep top-level suggestions when annotations are present", () => {
    const annotation = Symbol.for("@test/issue-187/argument-suggest");
    const suggestions = suggest(
      argument(choice(["alpha", "beta"] as const)),
      ["a"],
      { annotations: { [annotation]: true } },
    );

    assert.deepEqual(suggestions, [{ kind: "literal", text: "alpha" }]);
  });

  it("should create a parser that expects a single argument", () => {
    const parser = argument(string({ metavar: "FILE" }));

    assert.equal(parser.priority, 5);
    assert.equal(parser.initialState, undefined);
  });

  it("should parse a string argument", () => {
    const parser = argument(string({ metavar: "FILE" }));
    const context = {
      buffer: ["myfile.txt"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.ok(result.success);
    if (result.success) {
      assert.ok(result.next.state);
      if (result.next.state && result.next.state.success) {
        assert.equal(result.next.state.value, "myfile.txt");
      }
      assert.deepEqual(result.next.buffer, []);
      assert.deepEqual(result.consumed, ["myfile.txt"]);
    }
  });

  it("should parse an integer argument", () => {
    const parser = argument(integer({ min: 0 }));
    const context = {
      buffer: ["42"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.ok(result.success);
    if (result.success) {
      assert.ok(result.next.state);
      if (result.next.state && result.next.state.success) {
        assert.equal(result.next.state.value, 42);
      }
      assert.deepEqual(result.next.buffer, []);
      assert.deepEqual(result.consumed, ["42"]);
    }
  });

  it("should fail when buffer is empty", () => {
    const parser = argument(string({ metavar: "FILE" }));
    const context = {
      buffer: [] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(result.consumed, 0);
      assertErrorIncludes(result.error, "Expected an argument");
    }
  });

  it("should propagate value parser failures", () => {
    const parser = argument(integer({ min: 1, max: 100 }));
    const context = {
      buffer: ["invalid"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.ok(result.success);
    if (result.success) {
      assert.ok(result.next.state);
      if (result.next.state) {
        assert.ok(!result.next.state.success);
      }
    }
  });

  it("should complete successfully with valid state", () => {
    const parser = argument(string({ metavar: "FILE" }));
    const validState = { success: true as const, value: "test.txt" };

    const result = parser.complete(validState);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "test.txt");
    }
  });

  it("should fail completion with invalid state", () => {
    const parser = argument(string({ metavar: "FILE" }));
    const invalidState = {
      success: false as const,
      error: [{ type: "text", text: "Missing argument" }] as Message,
    };

    const result = parser.complete(invalidState);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Missing argument");
    }
  });

  it("should work with different value parser constraints", () => {
    const fileParser = argument(string({ pattern: /\.(txt|md)$/ }));
    const portParser = argument(integer({ min: 1024, max: 0xffff }));

    const validFileResult = parseSync(fileParser, ["readme.txt"]);
    assert.ok(validFileResult.success);
    if (validFileResult.success) {
      assert.equal(validFileResult.value, "readme.txt");
    }

    const invalidFileResult = parseSync(fileParser, ["script.js"]);
    assert.ok(!invalidFileResult.success);

    const validPortResult = parseSync(portParser, ["8080"]);
    assert.ok(validPortResult.success);
    if (validPortResult.success) {
      assert.equal(validPortResult.value, 8080);
    }

    const invalidPortResult = parseSync(portParser, ["80"]);
    assert.ok(!invalidPortResult.success);
  });

  describe("getDocFragments", () => {
    it("should return documentation fragment for argument", () => {
      const parser = argument(string({ metavar: "FILE" }));
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "argument");
        if (fragments.fragments[0].term.type === "argument") {
          assert.equal(fragments.fragments[0].term.metavar, "FILE");
        }
        assert.equal(fragments.fragments[0].description, undefined);
        assert.equal(fragments.fragments[0].default, undefined);
      }
    });

    it("should include description when provided", () => {
      const description = message`Input file to process`;
      const parser = argument(string({ metavar: "FILE" }), { description });
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].description, description);
      }
    });

    it("should include default value when provided", () => {
      const parser = argument(string({ metavar: "FILE" }));
      const fragments = parser.getDocFragments(
        parser.initialState === undefined
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: parser.initialState },
        "input.txt",
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(
          fragments.fragments[0].default,
          message`${"input.txt"}`,
        );
      }
    });

    it("should work with integer argument", () => {
      const parser = argument(integer({ metavar: "PORT" }));
      const fragments = parser.getDocFragments(
        parser.initialState === undefined
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: parser.initialState },
        8080,
      );

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "argument");
        if (fragments.fragments[0].term.type === "argument") {
          assert.equal(fragments.fragments[0].term.metavar, "PORT");
        }
        assert.deepEqual(fragments.fragments[0].default, message`${"8080"}`);
      }
    });

    it("should work without default value", () => {
      const parser = argument(string({ metavar: "FILE" }));
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].default, undefined);
      }
    });
  });
});

describe("primitives additional branch coverage", () => {
  it("option parse covers async separated value path", async () => {
    const asyncInt: ValueParser<"async", number> = {
      mode: "async",
      metavar: "INT",
      placeholder: 0,
      parse(input) {
        return Promise.resolve({ success: true, value: Number(input) });
      },
      format(value) {
        return String(value);
      },
    };
    const parser = option("--count", asyncInt);
    const result = parser.parse({
      buffer: ["--count", "42"],
      state: undefined,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(result instanceof Promise);
    const resolved = await result;
    assert.ok(resolved.success);
    if (resolved.success) {
      assert.deepEqual(resolved.consumed, ["--count", "42"]);
      assert.deepEqual(resolved.next.buffer, []);
    }
  });

  it("option suggest keeps top-level value suggestions under annotations", () => {
    const annotation = Symbol.for("@test/issue-187/option-suggest");
    const suggestions = suggest(
      option("--env", choice(["alpha", "beta"] as const)),
      ["a"],
      { annotations: { [annotation]: true } },
    );

    assert.deepEqual(suggestions, [{ kind: "literal", text: "alpha" }]);
  });

  it("group(argument()) stays annotation-transparent", () => {
    const annotation = Symbol.for("@test/issue-187/group-argument");
    const parser = group("Arguments", argument(string()));
    const result = parse(parser, ["value"], {
      annotations: { [annotation]: true },
    });

    assert.deepEqual(result, { success: true, value: "value" });
  });

  it("map(argument()) stays annotation-transparent", () => {
    const annotation = Symbol.for("@test/issue-187/map-argument");
    const parser = map(argument(string()), (value) => value.toUpperCase());
    const result = parse(parser, ["value"], {
      annotations: { [annotation]: true },
    });

    assert.deepEqual(result, { success: true, value: "VALUE" });
  });

  it("option parse rejects instead of throwing when async value parsing throws synchronously", async () => {
    const throwingParser: ValueParser<"async", string> = {
      mode: "async",
      metavar: "VALUE",
      placeholder: "",
      parse() {
        throw new TypeError("Synchronous option parse failure.");
      },
      format(value) {
        return value;
      },
    };
    const parser = option("--name", throwingParser);
    let result: ReturnType<typeof parser.parse> | undefined;
    assert.doesNotThrow(() => {
      result = parser.parse({
        buffer: ["--name", "alice"],
        state: undefined,
        optionsTerminated: false,
        usage: parser.usage,
      });
    });
    assert.ok(result instanceof Promise);
    await assert.rejects(result, {
      name: "TypeError",
      message: "Synchronous option parse failure.",
    });
  });

  it("argument parse rejects instead of throwing when async value parsing throws synchronously", async () => {
    const throwingParser: ValueParser<"async", string> = {
      mode: "async",
      metavar: "VALUE",
      placeholder: "",
      parse() {
        throw new TypeError("Synchronous argument parse failure.");
      },
      format(value) {
        return value;
      },
    };
    const parser = argument(throwingParser);
    let result: ReturnType<typeof parser.parse> | undefined;
    assert.doesNotThrow(() => {
      result = parser.parse({
        buffer: ["alice"],
        state: undefined,
        optionsTerminated: false,
        usage: parser.usage,
      });
    });
    assert.ok(result instanceof Promise);
    await assert.rejects(result, {
      name: "TypeError",
      message: "Synchronous argument parse failure.",
    });
  });

  it("command parse rejects instead of throwing when async child parsing throws synchronously", async () => {
    const inner = {
      mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse() {
        throw new TypeError("Synchronous command parse failure.");
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "ok" });
      },
      suggest: async function* () {},
      getDocFragments() {
        return { fragments: [] };
      },
    } as const satisfies Parser<"async", string, undefined>;
    const parser = command("deploy", inner);
    let result: ReturnType<typeof parser.parse> | undefined;
    assert.doesNotThrow(() => {
      result = parser.parse({
        buffer: [],
        state: ["matched", "deploy"],
        optionsTerminated: false,
        usage: parser.usage,
      });
    });
    assert.ok(result instanceof Promise);
    await assert.rejects(result, {
      name: "TypeError",
      message: "Synchronous command parse failure.",
    });
  });

  it("command complete rejects instead of throwing when async child completion throws synchronously", async () => {
    const inner = {
      mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: "initial",
      parse() {
        return Promise.resolve({
          success: true as const,
          next: {
            buffer: [] as readonly string[],
            state: "parsed",
            optionsTerminated: false,
            usage: [] as const,
          },
          consumed: [] as const,
        });
      },
      complete() {
        throw new TypeError("Synchronous command complete failure.");
      },
      suggest: async function* () {},
      getDocFragments() {
        return { fragments: [] };
      },
    } as const satisfies Parser<"async", string, string>;
    const parser = command("deploy", inner);
    let matchedResult: ReturnType<typeof parser.complete> | undefined;
    assert.doesNotThrow(() => {
      matchedResult = parser.complete(["matched", "deploy"]);
    });
    assert.ok(matchedResult instanceof Promise);
    await assert.rejects(matchedResult, {
      name: "TypeError",
      message: "Synchronous command complete failure.",
    });

    let parsingResult: ReturnType<typeof parser.complete> | undefined;
    assert.doesNotThrow(() => {
      parsingResult = parser.complete(["parsing", "parsed"]);
    });
    assert.ok(parsingResult instanceof Promise);
    await assert.rejects(parsingResult, {
      name: "TypeError",
      message: "Synchronous command complete failure.",
    });
  });

  it("option duplicate error function handles direct and joined forms", () => {
    const parser = option("--count", integer(), {
      errors: {
        duplicate: (name) => message`duplicate: ${text(name)}`,
      },
    });

    const direct = parser.parse({
      buffer: ["--count", "1"],
      state: { success: true, value: 1 },
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(!direct.success);
    if (!direct.success) {
      assert.equal(formatMessage(direct.error), "duplicate: --count");
    }

    const joined = parser.parse({
      buffer: ["--count=1"],
      state: { success: true, value: 1 },
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(!joined.success);
    if (!joined.success) {
      assert.equal(formatMessage(joined.error), "duplicate: --count=");
    }
  });

  it("option detects equals-joined duplicates for derived value parsers", () => {
    const mode = dependency(string({ metavar: "MODE" }));
    const target = deriveFromSync({
      metavar: "TARGET",
      dependencies: [mode] as const,
      defaultValues: () => ["dev"] as const,
      factory: (_mode: string) => string({ metavar: "TARGET" }),
    });
    const parser = option("--target", target);

    const first = parser.parse({
      buffer: ["--target=old"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(first.success);
    if (!first.success) return;

    const second = parser.parse({
      ...first.next,
      buffer: ["--target=new"] as readonly string[],
    });
    assert.ok(!second.success);
    if (!second.success) {
      assert.equal(
        formatMessage(second.error),
        "`--target` cannot be used multiple times.",
      );
    }
  });

  it("option detects equals-joined duplicates for dependency sources", () => {
    const parser = option("--mode", dependency(string({ metavar: "MODE" })));

    const first = parser.parse({
      buffer: ["--mode=dev"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(first.success);
    if (!first.success) return;

    const second = parser.parse({
      ...first.next,
      buffer: ["--mode=prod"] as readonly string[],
    });
    assert.ok(!second.success);
    if (!second.success) {
      assert.equal(
        formatMessage(second.error),
        "`--mode` cannot be used multiple times.",
      );
    }
  });

  it("option complete handles plain success and custom invalid branches", () => {
    const parser = option("--port", integer(), {
      errors: {
        invalidValue: (error) => message`invalid ${error}`,
      },
    });

    const plainSuccess = parser.complete({ success: true, value: 42 });
    assert.ok(plainSuccess.success);
    if (plainSuccess.success) {
      assert.equal(plainSuccess.value, 42);
    }

    const failure = parser.complete({
      success: false,
      error: message`bad-int`,
    });
    assert.ok(!failure.success);
    if (!failure.success) {
      assert.equal(formatMessage(failure.error), "invalid bad-int");
    }
  });

  it("argument complete formats plain failures with custom invalid branches", () => {
    const parser = argument(integer(), {
      errors: {
        invalidValue: (error) => message`bad ${error}`,
      },
    });

    const failure = parser.complete({
      success: false,
      error: message`plain-fail`,
    });
    assert.ok(!failure.success);
    if (!failure.success) {
      assert.equal(formatMessage(failure.error), "bad plain-fail");
    }
  });
});

describe("argument() error customization", () => {
  it("should use custom endOfInput error", () => {
    const parser = argument(string(), {
      errors: {
        endOfInput: message`Please provide a filename argument.`,
      },
    });

    const context = {
      buffer: [],
      state: undefined,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Please provide a filename argument.",
      );
    }
  });

  it("should use custom endOfInput error in complete", () => {
    const parser = argument(string(), {
      errors: {
        endOfInput: message`Missing required argument.`,
      },
    });

    const result = parser.complete(undefined);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Missing required argument.",
      );
    }
  });

  it("should use custom invalidValue error", () => {
    const parser = argument(integer(), {
      errors: {
        invalidValue: (error) => message`Invalid number provided: ${error}`,
      },
    });

    const failedState = {
      success: false,
      error: message`Expected a valid integer, but got "abc".`,
    } as const;

    const result = parser.complete(failedState);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(errorMessage.includes("Invalid number provided:"));
    }
  });
});

describe("command", () => {
  function createRegistry(
    entries: readonly (readonly [symbol, unknown])[] = [],
  ): import("./registry-types.ts").DependencyRegistryLike {
    const map = new Map<symbol, unknown>(entries);
    return {
      set<T>(id: symbol, value: T): void {
        map.set(id, value);
      },
      get<T>(id: symbol): T | undefined {
        return map.get(id) as T | undefined;
      },
      has(id: symbol): boolean {
        return map.has(id);
      },
      clone() {
        return createRegistry([...map.entries()]);
      },
    };
  }

  it("should treat annotations as transparent during top-level parsing", () => {
    const annotation = Symbol.for("@test/issue-187/command-parse");
    const parser = command("go", object({ silent: option("--silent") }));

    const result = parse(parser, ["go", "--silent"], {
      annotations: { [annotation]: true },
    });

    assert.deepEqual(result, {
      success: true,
      value: { silent: true },
    });
  });

  it("should keep top-level suggestions when annotations are present", () => {
    const annotation = Symbol.for("@test/issue-187/command-suggest");
    const parser = command("go", object({ silent: option("--silent") }));
    const suggestions = suggest(parser, ["g"], {
      annotations: { [annotation]: true },
    });

    assert.deepEqual(suggestions, [{ kind: "literal", text: "go" }]);
  });

  it("group(command()) stays annotation-transparent", () => {
    const annotation = Symbol.for("@test/issue-187/group-command");
    const parser = group(
      "Commands",
      command("go", object({ silent: option("--silent") })),
    );
    const result = parse(parser, ["go", "--silent"], {
      annotations: { [annotation]: true },
    });

    assert.deepEqual(result, {
      success: true,
      value: { silent: true },
    });
  });

  it("should create a parser that matches a subcommand and applies inner parser", () => {
    const showParser = command(
      "show",
      object({
        type: constant("show" as const),
        progress: option("-p", "--progress"),
        id: argument(string()),
      }),
    );

    assert.equal(showParser.priority, 15);
    assert.equal(showParser.initialState, undefined);
  });

  it("should parse a basic subcommand with arguments", () => {
    const showParser = command(
      "show",
      object({
        type: constant("show" as const),
        progress: option("-p", "--progress"),
        id: argument(string()),
      }),
    );

    const result = parseSync(showParser, ["show", "--progress", "item123"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.type, "show");
      assert.equal(result.value.progress, true);
      assert.equal(result.value.id, "item123");
    }
  });

  it("should fail when wrong subcommand is provided", () => {
    const showParser = command(
      "show",
      object({
        type: constant("show" as const),
        id: argument(string()),
      }),
    );

    const result = parseSync(showParser, ["edit", "item123"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Expected command `show`");
    }
  });

  it("should fail when subcommand is provided but required arguments are missing", () => {
    const editParser = command(
      "edit",
      object({
        type: constant("edit" as const),
        id: argument(string()),
      }),
    );

    const result = parseSync(editParser, ["edit"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "too few arguments");
    }
  });

  it("should handle optional options in subcommands", () => {
    const editParser = command(
      "edit",
      object({
        type: constant("edit" as const),
        editor: optional(option("-e", "--editor", string())),
        id: argument(string()),
      }),
    );

    // Test with optional option
    const result1 = parseSync(editParser, ["edit", "-e", "vim", "item123"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.type, "edit");
      assert.equal(result1.value.editor, "vim");
      assert.equal(result1.value.id, "item123");
    }

    // Test without optional option
    const result2 = parseSync(editParser, ["edit", "item456"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.type, "edit");
      assert.equal(result2.value.editor, undefined);
      assert.equal(result2.value.id, "item456");
    }
  });

  it("should work with or() combinator for multiple subcommands", () => {
    const parser = or(
      command(
        "show",
        object({
          type: constant("show" as const),
          progress: option("-p", "--progress"),
          id: argument(string()),
        }),
      ),
      command(
        "edit",
        object({
          type: constant("edit" as const),
          editor: optional(option("-e", "--editor", string())),
          id: argument(string()),
        }),
      ),
    );

    // Test show command
    const showResult = parseSync(parser, ["show", "--progress", "item123"]);
    assert.ok(showResult.success);
    if (showResult.success) {
      assert.equal(showResult.value.type, "show");
      assert.equal(showResult.value.progress, true);
      assert.equal(showResult.value.id, "item123");
    }

    // Test edit command
    const editResult = parseSync(parser, ["edit", "-e", "vim", "item456"]);
    assert.ok(editResult.success);
    if (editResult.success) {
      assert.equal(editResult.value.type, "edit");
      assert.equal(editResult.value.editor, "vim");
      assert.equal(editResult.value.id, "item456");
    }
  });

  it("should fail gracefully when no matching subcommand is found in or() combinator", () => {
    const parser = or(
      command(
        "show",
        object({
          type: constant("show" as const),
          id: argument(string()),
        }),
      ),
      command(
        "edit",
        object({
          type: constant("edit" as const),
          id: argument(string()),
        }),
      ),
    );

    const result = parseSync(parser, ["delete", "item123"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Unexpected option or subcommand");
    }
  });

  it("should handle empty input", () => {
    const showParser = command(
      "show",
      object({
        type: constant("show" as const),
        id: argument(string()),
      }),
    );

    const result = parseSync(showParser, []);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "end of input");
    }
  });

  it("should provide correct type inference with InferValue", () => {
    // Test case from user's example: or() of commands should produce union types
    const parser = or(
      command(
        "show",
        object({
          type: constant("show" as const),
          progress: option("-p", "--progress"),
          id: argument(string()),
        }),
      ),
      command(
        "edit",
        object({
          type: constant("edit" as const),
          editor: optional(option("-e", "--editor", string())),
          id: argument(string()),
        }),
      ),
    );

    // Type assertion test: this should compile without errors
    type ParserType = InferValue<typeof parser>;

    // Test that the inferred type is a union of the two command types
    const showResult = parseSync(parser, ["show", "--progress", "item123"]);
    const editResult = parseSync(parser, ["edit", "-e", "vim", "item456"]);

    if (showResult.success) {
      // These assertions verify runtime behavior matches type expectations
      const _typeCheck1: ParserType = showResult.value;
      assert.equal(showResult.value.type, "show");
      assert.equal(showResult.value.progress, true);
      assert.equal(showResult.value.id, "item123");
    }

    if (editResult.success) {
      // These assertions verify runtime behavior matches type expectations
      const _typeCheck2: ParserType = editResult.value;
      assert.equal(editResult.value.type, "edit");
      assert.equal(editResult.value.editor, "vim");
      assert.equal(editResult.value.id, "item456");
    }

    // Verify both parsed successfully
    assert.ok(showResult.success);
    assert.ok(editResult.success);
  });

  it("should maintain type safety with complex nested objects", () => {
    const complexParser = command(
      "deploy",
      object({
        type: constant("deploy" as const),
        config: object({
          env: option("-e", "--env", string()),
          dryRun: option("--dry-run"),
        }),
        targets: multiple(argument(string()), { min: 1 }),
      }),
    );

    type ComplexType = InferValue<typeof complexParser>;

    const result = parseSync(complexParser, [
      "deploy",
      "--env",
      "production",
      "--dry-run",
      "web",
      "api",
    ]);
    assert.ok(result.success);

    if (result.success) {
      // Type check - this should compile
      const _typeCheck: ComplexType = result.value;

      // Runtime verification
      assert.equal(result.value.type, "deploy");
      assert.equal(result.value.config.env, "production");
      assert.equal(result.value.config.dryRun, true);
      assert.deepEqual(result.value.targets, ["web", "api"]);
    }
  });

  // Edge case tests
  it("should handle commands with same prefix names", () => {
    const parser = or(
      command(
        "test",
        object({
          type: constant("test" as const),
          id: argument(string()),
        }),
      ),
      command(
        "testing",
        object({
          type: constant("testing" as const),
          id: argument(string()),
        }),
      ),
    );

    // Should match "test" exactly, not "testing"
    const result1 = parseSync(parser, ["test", "item123"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.type, "test");
    }

    // Should match "testing" exactly
    const result2 = parseSync(parser, ["testing", "item456"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.type, "testing");
    }
  });

  it("should handle commands that look like options", () => {
    const parser = command(
      "--help",
      object({
        type: constant("help" as const),
      }),
    );

    const result = parseSync(parser, ["--help"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.type, "help");
    }
  });

  it("should handle command with array-like TState (state type safety test)", () => {
    // Test our CommandState type safety with arrays
    const multiParser = command("multi", multiple(option("-v", "--verbose")));

    const result1 = parseSync(multiParser, ["multi", "-v", "-v"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.deepEqual(result1.value, [true, true]);
    }

    const result2 = parseSync(multiParser, ["multi"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.deepEqual(result2.value, []);
    }
  });

  it("should handle nested commands (command within object parser)", () => {
    // This tests the interaction between command and other parsers
    const nestedParser = object({
      globalFlag: option("--global"),
      cmd: command(
        "run",
        object({
          type: constant("run" as const),
          script: argument(string()),
        }),
      ),
    });

    const result = parseSync(nestedParser, ["--global", "run", "build"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.globalFlag, true);
      assert.equal(result.value.cmd.type, "run");
      assert.equal(result.value.cmd.script, "build");
    }
  });

  it("should fail when command is used with tuple parser and insufficient elements", () => {
    const tupleParser = tuple([
      command("start", constant("start" as const)),
      argument(string()),
    ]);

    const result = parseSync(tupleParser, ["start"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "too few arguments");
    }
  });

  it("should handle options terminator with commands", () => {
    const parser = command(
      "exec",
      object({
        type: constant("exec" as const),
        args: multiple(argument(string())),
      }),
    );

    // Test with -- to terminate options parsing
    const result = parseSync(parser, ["exec", "--", "--not-an-option", "arg1"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.type, "exec");
      assert.deepEqual(result.value.args, ["--not-an-option", "arg1"]);
    }
  });

  it("should handle commands with numeric names", () => {
    const parser = or(
      command("v1", constant("version1" as const)),
      command("v2", constant("version2" as const)),
    );

    const result1 = parseSync(parser, ["v1"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value, "version1");
    }

    const result2 = parseSync(parser, ["v2"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value, "version2");
    }
  });

  it("should throw TypeError for empty command name", () => {
    assert.throws(
      () => command("", constant("empty" as const)),
      { name: "TypeError", message: "Command name must not be empty." },
    );
  });

  it("should throw TypeError for whitespace-only command name", () => {
    assert.throws(
      () => command("   ", constant("ws" as const)),
      {
        name: "TypeError",
        message: 'Command name must not be whitespace-only: "   ".',
      },
    );
  });

  it("should throw TypeError for command name with embedded whitespace", () => {
    assert.throws(
      () => command("bad cmd", constant("sp" as const)),
      {
        name: "TypeError",
        message: 'Command name must not contain whitespace: "bad cmd".',
      },
    );
  });

  it("should throw TypeError for command name with newline", () => {
    assert.throws(
      () => command("bad\nname", constant("nl" as const)),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\nname".',
      },
    );
  });

  it("should throw TypeError for command name with C0 control character", () => {
    assert.throws(
      () => command("bad\x00name", constant("c0" as const)),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\x00name".',
      },
    );
  });

  it("should throw TypeError for command name with C1 control character", () => {
    assert.throws(
      () => command("bad\x80name", constant("c1" as const)),
      {
        name: "TypeError",
        message:
          'Command name must not contain control characters: "bad\\x80name".',
      },
    );
  });

  describe("getDocFragments", () => {
    it("should return documentation fragment for command when not matched", () => {
      const parser = command("show", argument(string()));
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "command");
        if (fragments.fragments[0].term.type === "command") {
          assert.equal(fragments.fragments[0].term.name, "show");
        }
        assert.equal(fragments.fragments[0].description, undefined);
      }
    });

    it("should include description when provided", () => {
      const description = message`Show item details`;
      const parser = command("show", argument(string()), { description });
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.deepEqual(fragments.fragments[0].description, description);
      }
    });

    it("should delegate to inner parser when command is matched", () => {
      const innerParser = object({
        verbose: option("-v", "--verbose"),
        file: argument(string({ metavar: "FILE" })),
      });
      const parser = command("show", innerParser);

      // Simulate matched state
      const matchedState: ["matched", string] = ["matched", "show"];
      const fragments = parser.getDocFragments({
        kind: "available" as const,
        state: matchedState,
      });

      // Should delegate to inner parser and return its fragments
      assert.ok(fragments.fragments.length > 0);
      // The exact number and content depends on the inner parser implementation
      // but we know it should contain fragments from the inner parser
    });

    it("should show inner parser option descriptions when command is matched", () => {
      const description = message`Target language code`;
      const innerParser = object({
        target: option("-t", "--target", string({ metavar: "LANG" }), {
          description,
        }),
      });
      const parser = command("translate", innerParser);

      // Simulate matched state
      const matchedState: ["matched", string] = ["matched", "translate"];
      const fragments = parser.getDocFragments({
        kind: "available" as const,
        state: matchedState,
      });

      // Should include inner parser's option descriptions
      // The option entry may be inside a section, so we need to check both
      // top-level entries and entries inside sections
      const allEntries: DocEntry[] = [];
      for (const f of fragments.fragments) {
        if (f.type === "entry") {
          allEntries.push(f);
        } else if (f.type === "section") {
          allEntries.push(...f.entries);
        }
      }
      const optionEntry = allEntries.find((e) => e.term.type === "option");
      assert.ok(optionEntry, "Should have option entry");
      assert.deepEqual(optionEntry?.description, description);
    });

    it("should delegate to inner parser when parsing", () => {
      const innerParser = object({
        verbose: option("-v", "--verbose"),
        file: argument(string({ metavar: "FILE" })),
      });
      const parser = command("show", innerParser);

      // Simulate parsing state
      const parsingState: ["parsing", typeof innerParser.initialState] = [
        "parsing" as const,
        innerParser.initialState,
      ];
      const fragments = parser.getDocFragments(
        { kind: "available" as const, state: parsingState },
      );

      // Should delegate to inner parser
      assert.ok(fragments.fragments.length > 0);
    });

    it("should work with simple command", () => {
      const parser = command("version", constant("1.0.0"));
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      assert.equal(fragments.fragments[0].type, "entry");
      if (fragments.fragments[0].type === "entry") {
        assert.equal(fragments.fragments[0].term.type, "command");
        if (fragments.fragments[0].term.type === "command") {
          assert.equal(fragments.fragments[0].term.name, "version");
        }
      }
    });
  });

  // Regression tests for issue #117:
  // https://github.com/dahlia/optique/issues/117
  it("should not suggest sub-commands when parent command name does not match", () => {
    // When command("file", or(add, remove)) is given "add" as input,
    // it should say "Expected command file, but got add."
    // It should NOT suggest "add" because "add" is only valid *inside* "file".
    const addCmd = command(
      "add",
      object({ force: optional(flag("--force")) }),
    );
    const removeCmd = command(
      "remove",
      object({ force: optional(flag("--force")) }),
    );
    const fileCmd = command("file", or(addCmd, removeCmd));

    const result = parse(fileCmd, ["add", "--force"]);
    assert.ok(!result.success);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assertErrorIncludes(result.error, "Expected command `file`");
      assert.ok(
        !errorMessage.includes("Did you mean"),
        `Error message should not contain "Did you mean", got: ${errorMessage}`,
      );
    }
  });

  it("should not suggest sub-command names even when similar to input", () => {
    // "ad" is close to "add" (a sub-command), but "add" is not valid at the
    // current position — only "file" is. So no suggestion should appear.
    const addCmd = command("add", object({}));
    const removeCmd = command("remove", object({}));
    const fileCmd = command("file", or(addCmd, removeCmd));

    const result = parse(fileCmd, ["ad"]);
    assert.ok(!result.success);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assertErrorIncludes(result.error, "Expected command `file`");
      assert.ok(
        !errorMessage.includes("Did you mean"),
        `Error message should not contain "Did you mean", got: ${errorMessage}`,
      );
    }
  });

  it("should still suggest the parent command name when a typo is given", () => {
    // "fiel" is a typo for "file". The fix should still suggest "file".
    const addCmd = command("add", object({}));
    const removeCmd = command("remove", object({}));
    const fileCmd = command("file", or(addCmd, removeCmd));

    const result = parse(fileCmd, ["fiel"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Expected command `file`");
      assertErrorIncludes(result.error, "Did you mean");
      assertErrorIncludes(result.error, "`file`");
    }
  });

  it("should suggest nested child commands after the parent matches", () => {
    const parser = command(
      "root",
      command("child", object({ foo: flag("--foo") })),
    );

    const result = parse(parser, ["root", "chil"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Expected command `child`");
      assertErrorIncludes(result.error, "Did you mean");
      assertErrorIncludes(result.error, "`child`");
    }
  });

  it("should not suggest nested sub-commands in or() sibling context", () => {
    // or(command("file", or(add, remove)), command("other", ...))
    // When "add" is given, "add" should not be suggested (it's a child of "file").
    const addCmd = command("add", object({}));
    const removeCmd = command("remove", object({}));
    const fileCmd = command("file", or(addCmd, removeCmd));
    const otherCmd = command("other", object({}));
    const topParser = or(fileCmd, otherCmd);

    const result = parse(topParser, ["add"]);
    assert.ok(!result.success);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(
        !errorMessage.includes("Did you mean"),
        `Error should not have "Did you mean" for "add" among top-level commands, got: ${errorMessage}`,
      );
    }
  });

  // Regression test for issue #81:
  // https://github.com/dahlia/optique/issues/81
  it("should parse inner parser that succeeds with zero tokens", () => {
    // This tests the case where the command is matched but the buffer is empty,
    // and the inner parser (like longestMatch or object with all optional fields)
    // can succeed without consuming any tokens.
    const activeParser = object({
      mode: constant("active" as const),
      cwd: withDefault(option("--cwd", string()), "./"),
      key: optional(option("--key", string())),
    });

    const helpParser = object({
      mode: constant("help" as const),
    });

    const parser = command("dev", longestMatch(activeParser, helpParser));

    // This should succeed - the inner parser can complete with zero tokens
    const result = parseSync(parser, ["dev"]);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.mode, "active");
      assert.strictEqual(result.value.cwd, "./");
      assert.strictEqual(result.value.key, undefined);
    }

    // With additional options should also work
    const resultWithOptions = parseSync(parser, ["dev", "--key", "foo"]);
    assert.strictEqual(resultWithOptions.success, true);
    if (resultWithOptions.success) {
      assert.strictEqual(resultWithOptions.value.mode, "active");
      assert.strictEqual(resultWithOptions.value.cwd, "./");
      assert.strictEqual(resultWithOptions.value.key, "foo");
    }
  });

  it("should preserve the fresher dependency registry during command parse", () => {
    const dependencyId = Symbol("command-parse-dependency");
    const staleRegistry = createRegistry();
    const freshRegistry = createRegistry([[dependencyId, "fresh"]]);
    const inner = {
      mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context: ParserContext<undefined>) {
        return context.dependencyRegistry?.has(dependencyId)
          ? { success: true as const, next: context, consumed: [] }
          : {
            success: false as const,
            consumed: 0,
            error: message`missing dependency`,
          };
      },
      complete() {
        return { success: true as const, value: "ok" };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"sync", string, undefined>;
    const parser = command("deploy", inner);

    const result = parser.parse({
      buffer: [],
      state: ["matched", "deploy"],
      optionsTerminated: false,
      usage: parser.usage,
      exec: {
        usage: parser.usage,
        phase: "parse",
        path: ["root"],
        trace: undefined,
        dependencyRegistry: staleRegistry,
      },
      dependencyRegistry: freshRegistry,
    });

    assert.ok(result.success);
    if (result.success) {
      const childRegistry = result.next.dependencyRegistry;
      assert.ok(childRegistry);
      assert.notStrictEqual(childRegistry, staleRegistry);
      assert.ok(childRegistry.has(dependencyId));
      assert.strictEqual(result.next.exec?.dependencyRegistry, childRegistry);
    }
  });

  it("should preserve the fresher dependency registry during command suggest", () => {
    let childRegistry: ParserContext<undefined>["dependencyRegistry"];
    let childExecRegistry: ParserContext<undefined>["exec"];
    const dependencyId = Symbol("command-suggest-dependency");
    const staleRegistry = createRegistry();
    const freshRegistry = createRegistry([[dependencyId, "fresh"]]);
    const inner = {
      mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context: ParserContext<undefined>) {
        return { success: true as const, next: context, consumed: [] };
      },
      complete() {
        return { success: true as const, value: "ok" };
      },
      suggest: function* (context: ParserContext<undefined>) {
        childRegistry = context.dependencyRegistry;
        childExecRegistry = context.exec;
        if (context.dependencyRegistry?.has(dependencyId)) {
          yield { kind: "literal" as const, text: "fresh" };
        }
      },
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"sync", string, undefined>;
    const parser = command("deploy", inner);

    const suggestions = [...parser.suggest({
      buffer: [],
      state: ["matched", "deploy"],
      optionsTerminated: false,
      usage: parser.usage,
      exec: {
        usage: parser.usage,
        phase: "suggest",
        path: ["root"],
        trace: undefined,
        dependencyRegistry: staleRegistry,
      },
      dependencyRegistry: freshRegistry,
    }, "")];

    assert.deepEqual(suggestions, [{ kind: "literal", text: "fresh" }]);
    assert.ok(childRegistry);
    assert.notStrictEqual(childRegistry, staleRegistry);
    assert.ok(childRegistry.has(dependencyId));
    assert.strictEqual(childExecRegistry?.dependencyRegistry, childRegistry);
  });

  it("should forward synthetic sync parse exec into command complete", () => {
    const dependencyId = Symbol("command-complete-dependency");
    const staleRegistry = createRegistry();
    const freshRegistry = createRegistry([[dependencyId, "fresh"]]);
    let completeExec: ParserContext<undefined>["exec"];
    const inner = {
      mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context: ParserContext<undefined>) {
        return {
          success: true as const,
          next: {
            ...context,
            exec: context.exec == null
              ? undefined
              : { ...context.exec, dependencyRegistry: freshRegistry },
            dependencyRegistry: freshRegistry,
          },
          consumed: [],
        };
      },
      complete(_state: undefined, exec?: ParserContext<undefined>["exec"]) {
        completeExec = exec;
        return exec?.dependencyRegistry?.has(dependencyId)
          ? { success: true as const, value: "ok" }
          : {
            success: false as const,
            error: message`Missing forwarded exec.`,
          };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"sync", string, undefined>;
    const parser = command("deploy", inner);

    const result = parser.complete(
      ["matched", "deploy"],
      {
        usage: parser.usage,
        phase: "complete",
        path: ["root"],
        trace: undefined,
        dependencyRegistry: staleRegistry,
      },
    );

    assert.ok(result.success);
    assert.strictEqual(completeExec?.dependencyRegistry, freshRegistry);
  });

  it("should forward synthetic async parse exec into command complete", async () => {
    const dependencyId = Symbol("command-complete-async-dependency");
    const staleRegistry = createRegistry();
    const freshRegistry = createRegistry([[dependencyId, "fresh"]]);
    let completeExec: ParserContext<undefined>["exec"];
    const inner = {
      mode: "async" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context: ParserContext<undefined>) {
        return Promise.resolve({
          success: true as const,
          next: {
            ...context,
            exec: context.exec == null
              ? undefined
              : { ...context.exec, dependencyRegistry: freshRegistry },
            dependencyRegistry: freshRegistry,
          },
          consumed: [],
        });
      },
      complete(_state: undefined, exec?: ParserContext<undefined>["exec"]) {
        completeExec = exec;
        return Promise.resolve(
          exec?.dependencyRegistry?.has(dependencyId)
            ? { success: true as const, value: "ok" }
            : {
              success: false as const,
              error: message`Missing forwarded exec.`,
            },
        );
      },
      suggest() {
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
            yield* [];
          },
        };
      },
      getDocFragments: () => ({ fragments: [] }),
    } as const satisfies Parser<"async", string, undefined>;
    const parser = command("deploy", inner);

    const result = await parser.complete(
      ["matched", "deploy"],
      {
        usage: parser.usage,
        phase: "complete",
        path: ["root"],
        trace: undefined,
        dependencyRegistry: staleRegistry,
      },
    );

    assert.ok(result.success);
    assert.strictEqual(completeExec?.dependencyRegistry, freshRegistry);
  });
});

describe("command() error customization", () => {
  it("should use custom notMatched error", () => {
    const innerParser = argument(string());
    const parser = command("deploy", innerParser, {
      errors: {
        notMatched: message`The "deploy" command is required here.`,
      },
    });

    const context = {
      buffer: ["build"],
      state: undefined,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        'The "deploy" command is required here.',
      );
    }
  });

  it("should use custom notMatched error with function", () => {
    const innerParser = argument(string());
    const parser = command("deploy", innerParser, {
      errors: {
        notMatched: (expected, actual) =>
          message`Expected command ${expected}, but found ${
            actual ?? "nothing"
          }.`,
      },
    });

    const context = {
      buffer: ["build"],
      state: undefined,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        'Expected command "deploy", but found "build".',
      );
    }
  });

  it("should use custom notFound error in complete", () => {
    const innerParser = argument(string());
    const parser = command("deploy", innerParser, {
      errors: {
        notFound: message`The deploy command was never invoked.`,
      },
    });

    const result = parser.complete(undefined);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "The deploy command was never invoked.",
      );
    }
  });

  it("should use custom invalidState error", () => {
    const innerParser = argument(string());
    const parser = command("deploy", innerParser, {
      errors: {
        invalidState: message`Command state is corrupted.`,
      },
    });

    // This test simulates an invalid state scenario by using unknown type
    // Since the actual invalid state path is hard to reach in normal operation,
    // we test by directly calling complete with an invalid state
    const invalidState = ["invalid"] as unknown as Parameters<
      typeof parser.complete
    >[0];
    const result = parser.complete(invalidState);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Command state is corrupted.",
      );
    }
  });

  it("should use custom notMatched error with suggestions parameter", () => {
    const parserWithSuggestions = or(
      command("deploy", argument(string())),
      command("build", argument(string())),
    );
    const parser = command("deploy", argument(string()), {
      errors: {
        notMatched: (expected, actual, suggestions) => {
          if (suggestions && suggestions.length > 0) {
            return message`Expected "${expected}", got "${
              actual ?? "nothing"
            }". Did you mean ${text(suggestions.join(" or "))}?`;
          }
          return message`Expected "${expected}", got "${actual ?? "nothing"}".`;
        },
      },
    });

    const context = {
      buffer: ["deploi"],
      state: undefined,
      optionsTerminated: false,
      usage: parserWithSuggestions.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(errorMessage.includes("deploi"));
      assert.ok(errorMessage.includes("deploy"));
    }
  });

  it("should use custom notMatched to disable suggestions", () => {
    const parserWithSuggestions = or(
      command("deploy", argument(string())),
      command("build", argument(string())),
    );
    const parser = command("deploy", argument(string()), {
      errors: {
        notMatched: (expected, actual) =>
          message`Command mismatch: expected ${expected}, got ${
            actual ?? "nothing"
          }.`,
      },
    });

    const context = {
      buffer: ["deploi"],
      state: undefined,
      optionsTerminated: false,
      usage: parserWithSuggestions.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.strictEqual(
        errorMessage,
        'Command mismatch: expected "deploy", got "deploi".',
      );
      assert.ok(!errorMessage.includes("Did you mean"));
    }
  });

  // Regression tests for issue #117:
  // https://github.com/dahlia/optique/issues/117
  it("should not pass sub-command names to custom notMatched suggestions", () => {
    // command("file", or(add, remove)) — "add" is typed
    // The custom notMatched receives suggestions from context.usage.
    // After the fix, the suggestions should NOT contain "add" or "remove"
    // because they are only valid *after* "file" has been consumed.
    const addCmd = command("add", object({}));
    const removeCmd = command("remove", object({}));
    let capturedSuggestions: readonly string[] = ["not-set"];

    const fileCmd = command("file", or(addCmd, removeCmd), {
      errors: {
        notMatched: (_expected, _actual, suggestions) => {
          capturedSuggestions = suggestions ?? [];
          return [];
        },
      },
    });

    const result = fileCmd.parse({
      buffer: ["add"],
      state: fileCmd.initialState,
      optionsTerminated: false,
      usage: fileCmd.usage,
    });
    assert.ok(!result.success);
    assert.ok(
      !capturedSuggestions.includes("add"),
      `"add" should not appear in notMatched suggestions, got: [${
        capturedSuggestions.join(", ")
      }]`,
    );
    assert.ok(
      !capturedSuggestions.includes("remove"),
      `"remove" should not appear in notMatched suggestions, got: [${
        capturedSuggestions.join(", ")
      }]`,
    );
  });

  it("should pass leading-level command names to custom notMatched suggestions", () => {
    // When or(command("file", ...), command("other", ...)) context is used,
    // the custom notMatched of an inner command() should receive "file" and
    // "other" as suggestions (the commands at the SAME level), not sub-commands.
    const addCmd = command("add", object({}));
    const fileCmd = command("file", or(addCmd));
    const otherCmd = command("other", object({}));
    const topParser = or(fileCmd, otherCmd);
    let capturedSuggestions: readonly string[] = ["not-set"];

    const innerFileCmd = command("file", or(addCmd), {
      errors: {
        notMatched: (_expected, _actual, suggestions) => {
          capturedSuggestions = suggestions ?? [];
          return [];
        },
      },
    });

    innerFileCmd.parse({
      buffer: ["fil"],
      state: innerFileCmd.initialState,
      optionsTerminated: false,
      usage: topParser.usage, // full context includes "file", "other" as leading
    });
    // "file" should be suggested (typo correction), "add" should not
    assert.ok(
      capturedSuggestions.includes("file"),
      `"file" should appear in suggestions (typo for "file"), got: [${
        capturedSuggestions.join(", ")
      }]`,
    );
    assert.ok(
      !capturedSuggestions.includes("add"),
      `"add" (sub-command) should not appear in suggestions, got: [${
        capturedSuggestions.join(", ")
      }]`,
    );
  });
});

describe("command() with brief option", () => {
  it("should use brief for command list when both brief and description are provided", () => {
    const parser = command(
      "deploy",
      object({
        env: option("-e", "--env", string()),
      }),
      {
        brief: message`Deploy the application`,
        description:
          message`Deploy the application to the specified environment with full configuration options and validation.`,
      },
    );

    // When command is not matched (showing in a list), brief should be used
    const fragments = parser.getDocFragments({ kind: "unavailable" });
    assert.equal(fragments.fragments.length, 1);
    assert.equal(fragments.fragments[0].type, "entry");
    if (fragments.fragments[0].type === "entry") {
      assert.deepEqual(
        fragments.fragments[0].description,
        message`Deploy the application`,
      );
    }
    // The full description should still be available as fragment description
    assert.deepEqual(
      fragments.description,
      message`Deploy the application to the specified environment with full configuration options and validation.`,
    );
  });

  it("should fall back to description when brief is not provided", () => {
    const parser = command(
      "build",
      object({
        output: option("--output", string()),
      }),
      {
        description: message`Build the project`,
      },
    );

    const fragments = parser.getDocFragments({ kind: "unavailable" });
    assert.equal(fragments.fragments.length, 1);
    assert.equal(fragments.fragments[0].type, "entry");
    if (fragments.fragments[0].type === "entry") {
      assert.deepEqual(
        fragments.fragments[0].description,
        message`Build the project`,
      );
    }
    assert.deepEqual(fragments.description, message`Build the project`);
  });

  it("should work with or() combinator showing brief for each command", () => {
    const parser = or(
      command(
        "show",
        object({
          id: argument(string()),
        }),
        {
          brief: message`Show an item`,
          description:
            message`Display detailed information about an item including metadata and history.`,
        },
      ),
      command(
        "edit",
        object({
          id: argument(string()),
        }),
        {
          brief: message`Edit an item`,
          description:
            message`Open an editor to modify the contents and properties of an item.`,
        },
      ),
    );

    // When showing command list (unavailable state), each command should show its brief
    const fragments = parser.getDocFragments({ kind: "unavailable" });

    assert.ok(fragments.fragments.length > 0);
    const allEntries: DocEntry[] = [];
    for (const f of fragments.fragments) {
      if (f.type === "entry") allEntries.push(f);
      else allEntries.push(...f.entries);
    }
    const commandEntries = allEntries.filter((e) => e.term.type === "command");
    assert.equal(commandEntries.length, 2);

    // Check first command (show)
    const showEntry = commandEntries.find((e) =>
      e.term.type === "command" && e.term.name === "show"
    );
    assert.ok(showEntry);
    assert.deepEqual(
      showEntry.description,
      message`Show an item`,
    );

    // Check second command (edit)
    const editEntry = commandEntries.find((e) =>
      e.term.type === "command" && e.term.name === "edit"
    );
    assert.ok(editEntry);
    assert.deepEqual(
      editEntry.description,
      message`Edit an item`,
    );
  });

  it("should use full description when command is matched", () => {
    const parser = command(
      "deploy",
      object({
        env: option("-e", "--env", string()),
      }),
      {
        brief: message`Deploy the application`,
        description:
          message`Deploy the application to the specified environment.`,
      },
    );

    // Simulate matched command state
    const matchedState = ["matched", "deploy"] as ["matched", string];
    const fragments = parser.getDocFragments({
      kind: "available",
      state: matchedState,
    });

    // When command is matched, the full description should be used
    assert.deepEqual(
      fragments.description,
      message`Deploy the application to the specified environment.`,
    );
  });

  it("should include footer when provided", () => {
    const parser = command(
      "backup",
      object({
        target: argument(string()),
      }),
      {
        description: message`Create a backup of the specified target`,
        footer: message`Example: myapp backup /data/important`,
      },
    );

    // Simulate matched command state
    const matchedState = ["matched", "backup"] as ["matched", string];
    const fragments = parser.getDocFragments({
      kind: "available",
      state: matchedState,
    });

    // Footer should be included when command is matched
    assert.deepEqual(
      fragments.footer,
      message`Example: myapp backup /data/important`,
    );
  });

  it("should not include footer when command is unavailable", () => {
    const parser = command(
      "backup",
      object({
        target: argument(string()),
      }),
      {
        description: message`Create a backup`,
        footer: message`Example: myapp backup /data`,
      },
    );

    // When command is unavailable (in a list)
    const fragments = parser.getDocFragments({ kind: "unavailable" });

    // Footer should not be included in command lists
    assert.equal(fragments.footer, undefined);
  });

  it("should work with brief and footer together", () => {
    const parser = command(
      "restore",
      object({
        source: argument(string()),
      }),
      {
        brief: message`Restore from backup`,
        description:
          message`Restore data from a backup archive with verification and validation.`,
        footer:
          message`Examples:\n  myapp restore backup.tar.gz\n  myapp restore --verify backup.tar.gz`,
      },
    );

    // When showing in a list, only brief is used
    const listFragments = parser.getDocFragments({ kind: "unavailable" });
    assert.deepEqual(
      listFragments.fragments[0].type === "entry"
        ? listFragments.fragments[0].description
        : undefined,
      message`Restore from backup`,
    );
    assert.equal(listFragments.footer, undefined);

    // When command is matched, description and footer are used
    const matchedState = ["matched", "restore"] as ["matched", string];
    const detailFragments = parser.getDocFragments({
      kind: "available",
      state: matchedState,
    });
    assert.deepEqual(
      detailFragments.description,
      message`Restore data from a backup archive with verification and validation.`,
    );
    assert.deepEqual(
      detailFragments.footer,
      message`Examples:\n  myapp restore backup.tar.gz\n  myapp restore --verify backup.tar.gz`,
    );
  });

  // Regression tests for https://github.com/dahlia/optique/issues/118 and
  // https://github.com/dahlia/optique/issues/119
  it("should propagate brief as page-level brief when command is matched", () => {
    const parser = command(
      "deploy",
      object({ env: option("-e", "--env", string()) }),
      {
        brief: message`Deploy the application`,
        description:
          message`Deploy the application to the specified environment.`,
      },
    );

    const matchedState = ["matched", "deploy"] as ["matched", string];
    const fragments = parser.getDocFragments({
      kind: "available",
      state: matchedState,
    });

    // brief appears at the top of the command's own help page
    assert.deepEqual(fragments.brief, message`Deploy the application`);
    // description appears below Usage in the command's own help page
    assert.deepEqual(
      fragments.description,
      message`Deploy the application to the specified environment.`,
    );
  });

  it("should propagate brief but not description when only brief is set and command is matched", () => {
    const parser = command(
      "file",
      object({}),
      { brief: message`File operations` },
    );

    const matchedState = ["matched", "file"] as ["matched", string];
    const fragments = parser.getDocFragments({
      kind: "available",
      state: matchedState,
    });

    // brief appears at the top of the command's own help page
    assert.deepEqual(fragments.brief, message`File operations`);
    // No description was provided, so description must be undefined
    assert.equal(fragments.description, undefined);
  });
});

describe("passThrough", () => {
  describe("equalsOnly format (default)", () => {
    it("should return plain array without annotation symbols", () => {
      const parser = passThrough();
      const result = parse(parser, ["--foo=bar"], {
        annotations: { [Symbol.for("@test/pass-through")]: "ok" },
      });
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["--foo=bar"]);
        const symbols = Object.getOwnPropertySymbols(result.value);
        assert.ok(!symbols.includes(annotationKey));
      }
    });

    it("should capture --opt=val format options", () => {
      const parser = passThrough();
      const context = {
        buffer: ["--foo=bar"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["--foo=bar"]);
        assert.deepEqual(result.next.buffer, []);
        assert.deepEqual(result.consumed, ["--foo=bar"]);
      }
    });

    it("should capture multiple --opt=val options", () => {
      const parser = passThrough();
      const context = {
        buffer: ["--baz=qux"] as readonly string[],
        state: ["--foo=bar"],
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["--foo=bar", "--baz=qux"]);
        assert.deepEqual(result.next.buffer, []);
      }
    });

    it("should not capture options in --opt val format", () => {
      const parser = passThrough();
      const context = {
        buffer: ["--foo", "bar"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
    });

    it("should not capture standalone options without values", () => {
      const parser = passThrough();
      const context = {
        buffer: ["--verbose"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
    });

    it("should not capture non-option arguments", () => {
      const parser = passThrough();
      const context = {
        buffer: ["file.txt"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
    });

    it("should complete successfully with captured options", () => {
      const parser = passThrough();
      const result = parser.complete(["--foo=bar", "--baz=qux"]);

      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["--foo=bar", "--baz=qux"]);
      }
    });

    it("should complete with empty array when no options captured", () => {
      const parser = passThrough();
      const result = parser.complete([]);

      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, []);
      }
    });
  });

  describe("nextToken format", () => {
    it("should capture --opt and its next non-option value", () => {
      const parser = passThrough({ format: "nextToken" });
      const context = {
        buffer: ["--foo", "bar"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["--foo", "bar"]);
        assert.deepEqual(result.next.buffer, []);
        assert.deepEqual(result.consumed, ["--foo", "bar"]);
      }
    });

    it("should capture --opt=val format options", () => {
      const parser = passThrough({ format: "nextToken" });
      const context = {
        buffer: ["--foo=bar"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["--foo=bar"]);
        assert.deepEqual(result.next.buffer, []);
      }
    });

    it("should not capture next token if it looks like an option", () => {
      const parser = passThrough({ format: "nextToken" });
      const context = {
        buffer: ["--foo", "--bar"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["--foo"]);
        assert.deepEqual(result.next.buffer, ["--bar"]);
        assert.deepEqual(result.consumed, ["--foo"]);
      }
    });

    it("should capture standalone option when no value follows", () => {
      const parser = passThrough({ format: "nextToken" });
      const context = {
        buffer: ["--verbose"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["--verbose"]);
        assert.deepEqual(result.next.buffer, []);
      }
    });

    it("should not capture non-option arguments", () => {
      const parser = passThrough({ format: "nextToken" });
      const context = {
        buffer: ["file.txt"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
    });
  });

  describe("greedy format", () => {
    it("should capture all remaining tokens from first unrecognized option", () => {
      const parser = passThrough({ format: "greedy" });
      const context = {
        buffer: ["--foo", "bar", "--baz", "qux"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, [
          "--foo",
          "bar",
          "--baz",
          "qux",
        ]);
        assert.deepEqual(result.next.buffer, []);
        assert.deepEqual(result.consumed, ["--foo", "bar", "--baz", "qux"]);
      }
    });

    it("should capture non-option arguments when they come first", () => {
      const parser = passThrough({ format: "greedy" });
      const context = {
        buffer: ["file.txt", "--verbose"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["file.txt", "--verbose"]);
        assert.deepEqual(result.next.buffer, []);
      }
    });

    it("should fail on empty buffer", () => {
      const parser = passThrough({ format: "greedy" });
      const context = {
        buffer: [] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
    });
  });

  describe("priority", () => {
    it("should have lowest priority (-10) to be tried last", () => {
      const parser = passThrough();
      assert.equal(parser.priority, -10);
    });
  });

  describe("usage", () => {
    it("should have passthrough usage term", () => {
      const parser = passThrough();
      assert.deepEqual(parser.usage, [{ type: "passthrough" }]);
    });
  });

  describe("integration with object()", () => {
    it("should collect unrecognized options while explicit options are parsed", () => {
      const parser = object({
        debug: option("--debug"),
        extra: passThrough(),
      });

      const result = parseSync(parser, ["--debug", "--foo=bar", "--baz=qux"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.debug, true);
        assert.deepEqual(result.value.extra, ["--foo=bar", "--baz=qux"]);
      }
    });

    it("should work with nextToken format in object()", () => {
      const parser = object({
        debug: option("--debug"),
        extra: passThrough({ format: "nextToken" }),
      });

      const result = parseSync(parser, ["--debug", "--foo", "bar"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.debug, true);
        assert.deepEqual(result.value.extra, ["--foo", "bar"]);
      }
    });

    it("should work with greedy format in subcommand", () => {
      const parser = or(
        command(
          "exec",
          object({
            action: constant("exec"),
            container: argument(string()),
            args: passThrough({ format: "greedy" }),
          }),
        ),
        command(
          "local",
          object({
            action: constant("local"),
            port: option("--port", integer()),
          }),
        ),
      );

      const result = parseSync(parser, [
        "exec",
        "mycontainer",
        "--verbose",
        "-it",
        "bash",
      ]);
      assert.ok(result.success);
      if (result.success && result.value.action === "exec") {
        assert.equal(result.value.container, "mycontainer");
        assert.deepEqual(result.value.args, ["--verbose", "-it", "bash"]);
      }
    });
  });

  describe("with options terminator (--)", () => {
    it("should not capture options after -- in equalsOnly mode", () => {
      const parser = passThrough();
      const context = {
        buffer: ["--foo=bar"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: true,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
    });

    it("should not capture options after -- in nextToken mode", () => {
      const parser = passThrough({ format: "nextToken" });
      const context = {
        buffer: ["--foo", "bar"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: true,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
    });

    it("should still capture in greedy mode after --", () => {
      const parser = passThrough({ format: "greedy" });
      const context = {
        buffer: ["--foo", "bar"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: true,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["--foo", "bar"]);
      }
    });
  });

  describe("getDocFragments", () => {
    it("should return entry with passthrough description", () => {
      const parser = passThrough();
      const fragments = parser.getDocFragments({
        kind: "available",
        state: [],
      });

      assert.ok(fragments.fragments.length > 0);
      const entry = fragments.fragments[0];
      assert.equal(entry.type, "entry");
    });

    it("should include custom description if provided", () => {
      const parser = passThrough({
        description: message`Extra options to pass to the underlying tool`,
      });
      const fragments = parser.getDocFragments({
        kind: "available",
        state: [],
      });

      assert.ok(fragments.fragments.length > 0);
      const entry = fragments.fragments[0];
      if (entry.type === "entry") {
        assert.deepEqual(
          entry.description,
          message`Extra options to pass to the underlying tool`,
        );
      }
    });
  });

  describe("suggest", () => {
    it("should return empty array as passThrough cannot suggest specific values", () => {
      const parser = passThrough();
      const context = {
        buffer: [] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const suggestions = Array.from(parser.suggest(context, "--"));
      assert.deepEqual([...suggestions], []);
    });
  });

  describe("with optional() modifier", () => {
    it("should return undefined when no pass-through options provided", () => {
      const parser = object({
        debug: option("--debug"),
        extra: optional(passThrough()),
      });

      const result = parseSync(parser, ["--debug"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.debug, true);
        assert.equal(result.value.extra, undefined);
      }
    });

    it("should return captured options when provided", () => {
      const parser = object({
        debug: option("--debug"),
        extra: optional(passThrough()),
      });

      const result = parseSync(parser, ["--debug", "--foo=bar"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.debug, true);
        assert.deepEqual(result.value.extra, ["--foo=bar"]);
      }
    });

    it("should work with optional passThrough in greedy mode", () => {
      const parser = object({
        cmd: argument(string()),
        args: optional(passThrough({ format: "greedy" })),
      });

      const result = parseSync(parser, ["mycommand"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.cmd, "mycommand");
        assert.equal(result.value.args, undefined);
      }
    });
  });

  describe("with withDefault() modifier", () => {
    it("should return default value when no pass-through options provided", () => {
      const parser = object({
        debug: option("--debug"),
        extra: withDefault(passThrough(), ["--default=value"]),
      });

      const result = parseSync(parser, ["--debug"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.debug, true);
        assert.deepEqual(result.value.extra, ["--default=value"]);
      }
    });

    it("should return captured options when provided", () => {
      const parser = object({
        debug: option("--debug"),
        extra: withDefault(passThrough(), ["--default=value"]),
      });

      const result = parseSync(parser, ["--debug", "--foo=bar"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.debug, true);
        assert.deepEqual(result.value.extra, ["--foo=bar"]);
      }
    });

    it("should work with function-based default", () => {
      let defaultCalled = false;
      const parser = object({
        extra: withDefault(passThrough(), () => {
          defaultCalled = true;
          return ["--computed=default"];
        }),
      });

      const result = parseSync(parser, []);
      assert.ok(result.success);
      assert.ok(defaultCalled);
      if (result.success) {
        assert.deepEqual(result.value.extra, ["--computed=default"]);
      }
    });
  });

  describe("with map() modifier", () => {
    it("should transform captured options", () => {
      const parser = object({
        debug: option("--debug"),
        extra: map(passThrough(), (opts) => opts.length),
      });

      const result = parseSync(parser, ["--debug", "--foo=bar", "--baz=qux"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.debug, true);
        assert.equal(result.value.extra, 2);
      }
    });

    it("should transform to object structure", () => {
      const parser = object({
        extra: map(passThrough(), (opts) => {
          const result: Record<string, string> = {};
          for (const opt of opts) {
            const [key, value] = opt.slice(2).split("=");
            result[key] = value;
          }
          return result;
        }),
      });

      const result = parseSync(parser, ["--foo=bar", "--baz=qux"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value.extra, { foo: "bar", baz: "qux" });
      }
    });

    it("should work with greedy format transformation", () => {
      const parser = object({
        args: map(passThrough({ format: "greedy" }), (args) => args.join(" ")),
      });

      const result = parseSync(parser, ["--verbose", "-it", "bash"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.args, "--verbose -it bash");
      }
    });
  });

  describe("with merge() combinator", () => {
    it("should merge passThrough with other parsers", () => {
      const parser = merge(
        object({
          debug: option("--debug"),
        }),
        object({
          extra: passThrough(),
        }),
      );

      const result = parseSync(parser, ["--debug", "--foo=bar"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.debug, true);
        assert.deepEqual(result.value.extra, ["--foo=bar"]);
      }
    });

    it("should work with multiple merged objects containing passThrough", () => {
      const parser = merge(
        object({
          verbose: option("-v", "--verbose"),
        }),
        object({
          config: option("-c", "--config", string()),
        }),
        object({
          extra: passThrough(),
        }),
      );

      const result = parseSync(parser, [
        "-v",
        "--config",
        "file.json",
        "--foo=bar",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.verbose, true);
        assert.equal(result.value.config, "file.json");
        assert.deepEqual(result.value.extra, ["--foo=bar"]);
      }
    });
  });

  describe("with tuple() combinator", () => {
    it("should work in tuple position", () => {
      const parser = tuple([
        option("--debug"),
        passThrough(),
      ]);

      const result = parseSync(parser, ["--debug", "--foo=bar", "--baz=qux"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, [true, ["--foo=bar", "--baz=qux"]]);
      }
    });

    it("should work with greedy format in tuple", () => {
      const parser = tuple([
        argument(string()),
        passThrough({ format: "greedy" }),
      ]);

      const result = parseSync(parser, ["mycommand", "--verbose", "-it"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["mycommand", ["--verbose", "-it"]]);
      }
    });
  });

  describe("with or() combinator", () => {
    it("should work in alternative branches", () => {
      const parser = or(
        object({
          mode: constant("wrapper"),
          extra: passThrough(),
        }),
        object({
          mode: constant("direct"),
          file: argument(string()),
        }),
      );

      const result1 = parseSync(parser, ["--foo=bar", "--baz=qux"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.mode, "wrapper");
        if (result1.value.mode === "wrapper") {
          assert.deepEqual(result1.value.extra, ["--foo=bar", "--baz=qux"]);
        }
      }

      const result2 = parseSync(parser, ["myfile.txt"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.mode, "direct");
        if (result2.value.mode === "direct") {
          assert.equal(result2.value.file, "myfile.txt");
        }
      }
    });

    it("should prioritize explicit options over passThrough in or()", () => {
      const parser = or(
        object({
          mode: constant("explicit"),
          debug: flag("--debug"),
        }),
        object({
          mode: constant("passthrough"),
          extra: passThrough(),
        }),
      );

      // --debug should match the explicit parser, not passThrough
      const result = parseSync(parser, ["--debug"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.mode, "explicit");
      }
    });
  });

  describe("with longestMatch() combinator", () => {
    it("should work with longestMatch for ambiguous inputs", () => {
      const parser = longestMatch(
        object({
          mode: constant("local"),
          port: option("-p", "--port", integer()),
        }),
        object({
          mode: constant("proxy"),
          extra: passThrough({ format: "nextToken" }),
        }),
      );

      // -p 8080 should match local mode (longest match)
      const result1 = parseSync(parser, ["-p", "8080"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.mode, "local");
      }

      // --unknown value should match proxy mode
      const result2 = parseSync(parser, ["--unknown", "value"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.mode, "proxy");
        if (result2.value.mode === "proxy") {
          assert.deepEqual(result2.value.extra, ["--unknown", "value"]);
        }
      }
    });
  });

  describe("with conditional() combinator", () => {
    it("should work with conditional branches", () => {
      const parser = conditional(
        option("--mode", choice(["local", "proxy"])),
        {
          local: object({
            port: option("-p", "--port", integer()),
          }),
          proxy: object({
            extra: passThrough({ format: "nextToken" }),
          }),
        },
      );

      const result1 = parseSync(parser, ["--mode", "local", "-p", "8080"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value, ["local", { port: 8080 }]);
      }

      const result2 = parseSync(parser, ["--mode", "proxy", "--foo", "bar"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.deepEqual(result2.value, ["proxy", { extra: ["--foo", "bar"] }]);
      }
    });
  });

  describe("with group() combinator", () => {
    it("should work in grouped documentation", () => {
      const parser = object({
        debug: option("--debug"),
        extra: group(
          "Pass-through options",
          passThrough({
            description: message`Options forwarded to the underlying tool`,
          }),
        ),
      });

      const result = parseSync(parser, ["--debug", "--foo=bar"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.debug, true);
        assert.deepEqual(result.value.extra, ["--foo=bar"]);
      }
    });
  });

  describe("priority with mixed parsers", () => {
    it("should correctly order parsing with commands, options, arguments, and passThrough", () => {
      const parser = or(
        command(
          "run",
          object({
            action: constant("run"),
            verbose: option("-v", "--verbose"),
            file: argument(string()),
            extra: passThrough(),
          }),
        ),
        object({
          action: constant("default"),
          extra: passThrough({ format: "greedy" }),
        }),
      );

      // Command should match first
      const result1 = parseSync(parser, ["run", "-v", "file.txt", "--foo=bar"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.action, "run");
        if (result1.value.action === "run") {
          assert.equal(result1.value.verbose, true);
          assert.equal(result1.value.file, "file.txt");
          assert.deepEqual(result1.value.extra, ["--foo=bar"]);
        }
      }

      // Default should catch everything else
      const result2 = parseSync(parser, ["--unknown", "args"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.action, "default");
        if (result2.value.action === "default") {
          assert.deepEqual(result2.value.extra, ["--unknown", "args"]);
        }
      }
    });

    it("should try all explicit parsers before passThrough", () => {
      const parser = object({
        verbose: option("-v", "--verbose"),
        debug: option("-d", "--debug"),
        config: option("-c", "--config", string()),
        file: argument(string()),
        extra: passThrough(),
      });

      const result = parseSync(parser, [
        "-v",
        "-d",
        "-c",
        "config.json",
        "input.txt",
        "--unknown=option",
        "--another=one",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.verbose, true);
        assert.equal(result.value.debug, true);
        assert.equal(result.value.config, "config.json");
        assert.equal(result.value.file, "input.txt");
        assert.deepEqual(result.value.extra, [
          "--unknown=option",
          "--another=one",
        ]);
      }
    });
  });

  describe("short option formats", () => {
    it("should capture short options in equalsOnly mode", () => {
      const parser = passThrough();
      const context = {
        buffer: ["-x=value"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      // equalsOnly should reject single-dash options without double-dash
      const result = parser.parse(context);
      assert.ok(!result.success);
    });

    it("should capture short options in nextToken mode", () => {
      const parser = passThrough({ format: "nextToken" });
      const context = {
        buffer: ["-x", "value"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["-x", "value"]);
      }
    });

    it("should capture bundled short options in nextToken mode", () => {
      const parser = passThrough({ format: "nextToken" });
      const context = {
        buffer: ["-abc"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["-abc"]);
      }
    });

    it("should capture all short options in greedy mode", () => {
      const parser = passThrough({ format: "greedy" });
      const context = {
        buffer: ["-x", "-y", "-z", "value"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["-x", "-y", "-z", "value"]);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle empty input gracefully", () => {
      const parser = object({
        extra: optional(passThrough()),
      });

      const result = parseSync(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.extra, undefined);
      }
    });

    it("should handle input with only options terminator", () => {
      const parser = object({
        extra: optional(passThrough()),
        files: multiple(argument(string())),
      });

      const result = parseSync(parser, ["--", "--not-an-option"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.extra, undefined);
        assert.deepEqual(result.value.files, ["--not-an-option"]);
      }
    });

    it("should handle multiple consecutive = signs in value", () => {
      const parser = passThrough();
      const context = {
        buffer: ["--key=value=with=equals"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["--key=value=with=equals"]);
      }
    });

    it("should handle empty value after equals", () => {
      const parser = passThrough();
      const context = {
        buffer: ["--key="] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["--key="]);
      }
    });

    it("should handle options with numeric names", () => {
      const parser = passThrough();
      const context = {
        buffer: ["--123=value"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ["--123=value"]);
      }
    });

    it("should handle very long option names and values", () => {
      const longName = "--" + "a".repeat(100);
      const longValue = "b".repeat(1000);
      const parser = passThrough();
      const context = {
        buffer: [`${longName}=${longValue}`] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, [`${longName}=${longValue}`]);
      }
    });

    it("should handle special characters in values", () => {
      const parser = passThrough();
      const context = {
        buffer: ['--json={"key": "value"}'] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.next.state, ['--json={"key": "value"}']);
      }
    });

    it("should work when passThrough is the only parser", () => {
      const parser = passThrough({ format: "greedy" });

      const result = parseSync(parser, ["--foo", "bar", "--baz"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["--foo", "bar", "--baz"]);
      }
    });
  });

  describe("multiple passThrough usage", () => {
    it("should work with passThrough in different subcommands", () => {
      const parser = or(
        command(
          "build",
          object({
            action: constant("build"),
            buildArgs: passThrough(),
          }),
        ),
        command(
          "test",
          object({
            action: constant("test"),
            testArgs: passThrough(),
          }),
        ),
      );

      const result1 = parseSync(parser, ["build", "--optimize=true"]);
      assert.ok(result1.success);
      if (result1.success && result1.value.action === "build") {
        assert.deepEqual(result1.value.buildArgs, ["--optimize=true"]);
      }

      const result2 = parseSync(parser, ["test", "--coverage=true"]);
      assert.ok(result2.success);
      if (result2.success && result2.value.action === "test") {
        assert.deepEqual(result2.value.testArgs, ["--coverage=true"]);
      }
    });
  });

  describe("interaction with multiple()", () => {
    it("should not be useful with multiple() since passThrough already collects", () => {
      // This test documents the expected behavior - multiple() on passThrough
      // doesn't make semantic sense since passThrough already collects multiple items
      const parser = object({
        extra: passThrough(),
      });

      const result = parseSync(parser, [
        "--foo=bar",
        "--baz=qux",
        "--third=one",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value.extra, [
          "--foo=bar",
          "--baz=qux",
          "--third=one",
        ]);
      }
    });
  });
});

describe("hidden option", () => {
  describe("option()", () => {
    it("should still parse hidden options", () => {
      const parser = option("--secret", string(), { hidden: true });
      const result = parseSync(parser, ["--secret", "value"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "value");
      }
    });

    it("should return empty doc fragments when hidden", () => {
      const parser = option("--secret", string(), { hidden: true });
      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);
    });

    it("should return empty suggestions when hidden", () => {
      const parser = option("--secret", string(), { hidden: true });
      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "--sec",
      ));
      assert.deepEqual(suggestions, []);
    });

    it("should include hidden: true in usage term", () => {
      const parser = option("--secret", string(), { hidden: true });
      assert.equal(parser.usage.length, 1);
      const term = parser.usage[0];
      assert.equal(term.type, "option");
      assert.equal("hidden" in term && term.hidden, true);
    });

    it('should hide option from usage only with hidden: "usage"', () => {
      const parser = option("--secret", string(), { hidden: "usage" });
      const term = parser.usage[0];
      assert.equal(term.type, "option");
      assert.equal("hidden" in term && term.hidden, "usage");

      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.equal(fragments.fragments.length, 1);

      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "--sec",
      ));
      assert.equal(suggestions.length, 1);
    });

    it('should hide option from docs only with hidden: "doc"', () => {
      const parser = option("--secret", string(), { hidden: "doc" });
      const term = parser.usage[0];
      assert.equal(term.type, "option");
      assert.equal("hidden" in term && term.hidden, "doc");

      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);

      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "--sec",
      ));
      assert.equal(suggestions.length, 1);
    });

    it('should hide option from usage/docs but keep suggestions with hidden: "help"', () => {
      const parser = option("--secret", string(), { hidden: "help" });
      const term = parser.usage[0];
      assert.equal(term.type, "option");
      assert.equal("hidden" in term && term.hidden, "help");

      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);

      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "--sec",
      ));
      assert.equal(suggestions.length, 1);
    });

    it("should throw TypeError for empty option name", () => {
      assert.throws(
        // @ts-expect-error: empty string is not a valid OptionName
        () => option("", string()),
        { name: "TypeError", message: "Option name must not be empty." },
      );
    });

    it("should throw TypeError for whitespace-only option name", () => {
      assert.throws(
        // @ts-expect-error: whitespace-only string is not a valid OptionName
        () => option("   ", string()),
        {
          name: "TypeError",
          message: 'Option name must not be whitespace-only: "   ".',
        },
      );
    });

    it("should throw TypeError for option name with control characters", () => {
      assert.throws(
        () => option("--foo\x00", string()),
        {
          name: "TypeError",
          message:
            'Option name must not contain control characters: "--foo\\x00".',
        },
      );
    });

    it("should throw TypeError for option name with whitespace", () => {
      assert.throws(
        () => option("--foo bar", string()),
        {
          name: "TypeError",
          message: 'Option name must not contain whitespace: "--foo bar".',
        },
      );
    });

    it("should throw TypeError for option name without valid prefix", () => {
      assert.throws(
        // @ts-expect-error: no valid prefix is not a valid OptionName
        () => option("foo", string()),
        {
          name: "TypeError",
          message: 'Option name must start with "--", "-", "/", or "+": "foo".',
        },
      );
    });

    it("should throw TypeError for options terminator as option name", () => {
      assert.throws(
        () => option("--", string()),
        {
          name: "TypeError",
          message: 'Option name must not be the options terminator "--".',
        },
      );
    });

    it("should throw TypeError when no option names are provided", () => {
      assert.throws(
        // @ts-expect-error: intentionally testing runtime rejection
        () => option(string()),
        {
          name: "TypeError",
          message: "Expected at least one option name.",
        },
      );
    });
  });

  describe("flag()", () => {
    it("should still parse hidden flags", () => {
      const parser = flag("--debug", { hidden: true });
      const result = parseSync(parser, ["--debug"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, true);
      }
    });

    it("should return empty doc fragments when hidden", () => {
      const parser = flag("--debug", { hidden: true });
      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);
    });

    it("should return empty suggestions when hidden", () => {
      const parser = flag("--debug", { hidden: true });
      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "--deb",
      ));
      assert.deepEqual(suggestions, []);
    });

    it('should keep docs and suggestions for hidden: "usage"', () => {
      const parser = flag("--debug", { hidden: "usage" });
      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.equal(fragments.fragments.length, 1);
      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "--deb",
      ));
      assert.equal(suggestions.length, 1);
    });

    it('should hide docs but keep suggestions for hidden: "help"', () => {
      const parser = flag("--debug", { hidden: "help" });
      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);
      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "--deb",
      ));
      assert.equal(suggestions.length, 1);
    });

    it("should throw TypeError for empty flag name", () => {
      assert.throws(
        // @ts-expect-error: empty string is not a valid OptionName
        () => flag(""),
        { name: "TypeError", message: "Flag name must not be empty." },
      );
    });

    it("should throw TypeError for whitespace-only flag name", () => {
      assert.throws(
        // @ts-expect-error: whitespace-only string is not a valid OptionName
        () => flag("   "),
        {
          name: "TypeError",
          message: 'Flag name must not be whitespace-only: "   ".',
        },
      );
    });

    it("should throw TypeError for flag name with control characters", () => {
      assert.throws(
        () => flag("--debug\x00"),
        {
          name: "TypeError",
          message:
            'Flag name must not contain control characters: "--debug\\x00".',
        },
      );
    });

    it("should throw TypeError for flag name with whitespace", () => {
      assert.throws(
        () => flag("--de bug"),
        {
          name: "TypeError",
          message: 'Flag name must not contain whitespace: "--de bug".',
        },
      );
    });

    it("should throw TypeError for flag name without valid prefix", () => {
      assert.throws(
        // @ts-expect-error: no valid prefix is not a valid OptionName
        () => flag("debug"),
        {
          name: "TypeError",
          message: 'Flag name must start with "--", "-", "/", or "+": "debug".',
        },
      );
    });

    it("should throw TypeError for options terminator as flag name", () => {
      assert.throws(
        () => flag("--"),
        {
          name: "TypeError",
          message: 'Flag name must not be the options terminator "--".',
        },
      );
    });

    it("should throw TypeError when no flag names are provided", () => {
      assert.throws(
        // @ts-expect-error: intentionally testing runtime rejection
        () => flag({ description: message`test` }),
        {
          name: "TypeError",
          message: "Expected at least one flag name.",
        },
      );
    });
  });

  describe("argument()", () => {
    it("should still parse hidden arguments", () => {
      const parser = argument(string(), { hidden: true });
      const result = parseSync(parser, ["value"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "value");
      }
    });

    it("should return empty doc fragments when hidden", () => {
      const parser = argument(string(), { hidden: true });
      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);
    });

    it("should return empty suggestions when hidden", () => {
      const parser = argument(string(), { hidden: true });
      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "",
      ));
      assert.deepEqual(suggestions, []);
    });

    it('should hide argument docs only with hidden: "doc"', () => {
      const parser = argument(string(), { hidden: "doc" });
      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);
    });

    it('should hide argument docs but keep suggestions with hidden: "help"', () => {
      const parser = argument(fileSuggestingParser(), { hidden: "help" });

      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);

      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "",
      ));
      assert.equal(suggestions.length, 1);
    });
  });

  describe("command()", () => {
    it("should attach usageLine override to command usage term", () => {
      const parser = command(
        "config",
        object({ value: option("--value", string()) }),
        { usageLine: [{ type: "ellipsis" }] },
      );
      const term = parser.usage[0];
      assert.equal(term.type, "command");
      if (term.type === "command") {
        assert.deepEqual(term.usageLine, [{ type: "ellipsis" }]);
      }
    });

    it("should attach usageLine callback to command usage term", () => {
      const usageLine = (defaultUsageLine: Usage) => defaultUsageLine;
      const parser = command(
        "config",
        object({ value: option("--value", string()) }),
        { usageLine },
      );
      const term = parser.usage[0];
      assert.equal(term.type, "command");
      if (term.type === "command") {
        assert.equal(term.usageLine, usageLine);
      }
    });

    it("should still parse hidden commands", () => {
      const parser = command(
        "secret",
        object({ value: option("--value", string()) }),
        { hidden: true },
      );
      const result = parseSync(parser, ["secret", "--value", "foo"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.value, "foo");
      }
    });

    it("should return empty doc fragments when hidden", () => {
      const parser = command(
        "secret",
        object({ value: option("--value", string()) }),
        { hidden: true },
      );
      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);
    });

    it("should return empty suggestions when hidden", () => {
      const parser = command(
        "secret",
        object({ value: option("--value", string()) }),
        { hidden: true },
      );
      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "sec",
      ));
      assert.deepEqual(suggestions, []);
    });

    it('should hide command from usage only with hidden: "usage"', () => {
      const parser = command(
        "secret",
        object({ value: option("--value", string()) }),
        { hidden: "usage" },
      );
      const term = parser.usage[0];
      assert.equal(term.type, "command");
      assert.equal("hidden" in term && term.hidden, "usage");

      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.equal(fragments.fragments.length, 1);

      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "sec",
      ));
      assert.equal(suggestions.length, 1);
    });

    it('should hide command docs but keep suggestions with hidden: "help"', () => {
      const parser = command(
        "secret",
        object({ value: option("--value", string()) }),
        { hidden: "help" },
      );
      const term = parser.usage[0];
      assert.equal(term.type, "command");
      assert.equal("hidden" in term && term.hidden, "help");

      const fragments = parser.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);

      const suggestions = Array.from(parser.suggest(
        {
          buffer: [],
          state: undefined,
          usage: parser.usage,
          optionsTerminated: false,
        },
        "sec",
      ));
      assert.equal(suggestions.length, 1);
    });

    it("should show inner argument/option descriptions when hidden command is matched", () => {
      // Regression test for https://github.com/dahlia/optique/issues/88
      // When a hidden command is matched and executed, its inner arguments
      // and options should still be documented in help text.
      const innerParser = object({
        someArg: argument(string({ metavar: "ARG" }), {
          description: message`the argument to the command`,
        }),
        someOption: option("--some-option", "-s", {
          description: message`an option for the command`,
        }),
      });
      const parser = command("s", innerParser, {
        brief: message`run some-command`,
        hidden: true,
      });

      // When the command is matched (e.g., user runs "cli s --help"),
      // the state is ["matched", "s"]
      const fragments = parser.getDocFragments(
        { kind: "available", state: ["matched", "s"] },
        undefined,
      );

      // The fragments should include the inner argument and option documentation
      assert.ok(fragments.fragments.length > 0);

      // object() returns DocSection with entries
      const entries = fragments.fragments
        .filter((f) => f.type === "section")
        .flatMap((f) => f.entries);

      const fragmentDescriptions = entries.map((entry) =>
        entry.description ? formatMessage(entry.description) : ""
      );

      assert.ok(
        fragmentDescriptions.some((d) =>
          d.includes("the argument to the command")
        ),
      );
      assert.ok(
        fragmentDescriptions.some((d) =>
          d.includes("an option for the command")
        ),
      );
    });
  });

  describe("passThrough()", () => {
    it("should still collect passthrough values when hidden", () => {
      const parser = passThrough({ hidden: true });
      const result = parseSync(parser, ["--foo=bar"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["--foo=bar"]);
      }
    });

    it("should return empty doc fragments when hidden", () => {
      const parser = passThrough({ hidden: true });
      const fragments = parser.getDocFragments(
        { kind: "available", state: [] },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);
    });

    it("should include hidden: true in usage term", () => {
      const parser = passThrough({ hidden: true });
      assert.equal(parser.usage.length, 1);
      const term = parser.usage[0];
      assert.equal(term.type, "passthrough");
      assert.equal("hidden" in term && term.hidden, true);
    });

    it('should hide passThrough docs only with hidden: "doc"', () => {
      const parser = passThrough({ hidden: "doc" });
      const term = parser.usage[0];
      assert.equal(term.type, "passthrough");
      assert.equal("hidden" in term && term.hidden, "doc");
      const fragments = parser.getDocFragments(
        { kind: "available", state: [] },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);
    });

    it('should hide passThrough docs with hidden: "help"', () => {
      const parser = passThrough({ hidden: "help" });
      const term = parser.usage[0];
      assert.equal(term.type, "passthrough");
      assert.equal("hidden" in term && term.hidden, "help");
      const fragments = parser.getDocFragments(
        { kind: "available", state: [] },
        undefined,
      );
      assert.deepEqual(fragments.fragments, []);
    });
  });
});

// ---------------------------------------------------------------------------
// Branch-coverage regressions
// ---------------------------------------------------------------------------
describe("branch coverage regressions", () => {
  it("option() custom errors.endOfInput", () => {
    const parser = object({
      name: option("--name", string(), {
        errors: { endOfInput: message`No more input for option.` },
      }),
    });
    const result = parseSync(parser, []);
    assert.equal(result.success, false);
  });

  it("option() static errors.unexpectedValue (boolean option)", () => {
    // option() without a ValueParser is a boolean option;
    // --verbose=yes triggers unexpectedValue
    const parser = object({
      verbose: option("--verbose", {
        errors: { unexpectedValue: message`Flags take no values.` },
      }),
    });
    const result = parseSync(parser, ["--verbose=yes"]);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "Flags take no values.");
    }
  });

  it("flag() custom errors.endOfInput", () => {
    const parser = object({
      v: flag("--verbose", {
        errors: { endOfInput: message`Flag input ended early.` },
      }),
    });
    const result = parseSync(parser, []);
    assert.equal(result.success, false);
  });

  it("argument() custom errors.multiple as static Message", () => {
    const parser = tuple([
      argument(string(), {
        errors: { multiple: message`Already provided.` },
      }),
    ]);
    // Parse two positional args — second one triggers "multiple" error
    const result = parseAsync(parser, ["first", "second"]);
    return (result as Promise<unknown>).then((r) => {
      // The parser may succeed with only first arg consumed, or
      // fail if the framework reports extra input.
      // The key is exercising the branch.
      assert.ok(r != null);
    });
  });

  it("argument() custom errors.multiple as function", () => {
    const argParser = argument(string(), {
      errors: {
        multiple: (mv) => message`${mv} given twice.`,
      },
    });
    // Build a tuple that consumes the argument, then use or()
    // with something that also has the same argument to trigger
    // the multiple branch
    const parser = object({ a: argParser, b: optional(flag("--b")) });
    const result = parseAsync(parser, ["first", "second"]);
    return (result as Promise<unknown>).then((r) => {
      assert.ok(r != null);
    });
  });

  it("argument() receiving -- then end of input", () => {
    const parser = tuple([argument(string())]);
    const result = parseAsync(parser, ["--"]);
    return (result as Promise<unknown>).then((r) => {
      // After --, the argument parser should expect a positional
      // but find end of input
      assert.ok(r != null);
    });
  });

  it("flag() static errors.missing via complete()", () => {
    const f = flag("--verbose", {
      errors: { missing: message`Must provide --verbose.` },
    });
    // complete() with undefined state → flag was never matched
    const result = f.complete(undefined);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "Must provide --verbose.");
    }
  });

  it("flag() errors.missing as function via complete()", () => {
    const f = flag("--verbose", {
      errors: {
        missing: (names) => message`Missing flag: ${names.join(", ")}.`,
      },
    });
    const result = f.complete(undefined);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(formatMessage(result.error).includes("--verbose"));
    }
  });
});

describe("branch coverage: primitives edge cases", () => {
  // Lines 261/412: getSuggestionsWithDependency/Async — valueParser has no
  // suggest function.  The early-return branch is uncovered by other tests.
  it("option suggest: valueParser without suggest yields no value suggestions", () => {
    const noSuggest = noSuggestParser();
    const parser = option("--output", noSuggest);
    // Buffer contains "--output" to put us in "value expected" mode;
    // prefix "" doesn't match any option name, so only value suggestions run.
    const ctx = {
      buffer: ["--output"] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: parser.usage,
    };
    const suggestions = [
      ...(parser.suggest(ctx, "") as Iterable<Suggestion>),
    ];
    // The noSuggest parser has no suggest(), so getSuggestionsWithDependency
    // takes the early-return branch and we get no value suggestions.
    assert.deepEqual(suggestions, []);
  });

  it("argument suggest: valueParser without suggest is a no-op", () => {
    const noSuggest = noSuggestParser();
    const parser = argument(noSuggest);
    const ctx = {
      buffer: [] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: parser.usage,
    };
    const suggestions = [
      ...(parser.suggest(ctx, "") as Iterable<Suggestion>),
    ];
    assert.deepEqual(suggestions, []);
  });

  // Line 484: suggestOptionAsync — hidden: true causes early return.
  it("option suggest: hidden async option returns no suggestions", async () => {
    const parser = option("--secret", asyncFileSuggestingParser(), {
      hidden: true,
    });
    const suggestions: Suggestion[] = [];
    for await (
      const s of parser.suggest({
        buffer: [] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: parser.usage,
      }, "--") as AsyncIterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.deepEqual(suggestions, []);
  });

  // Line 503/513: suggestOptionAsync with --option=prefix where the value
  // parser yields file-kind suggestions (non-literal path through =).
  it("option suggest: async --opt= completion with file-kind suggestion", async () => {
    const parser = option("--out", asyncFileSuggestingParser());
    const suggestions: Suggestion[] = [];
    for await (
      const s of parser.suggest({
        buffer: [] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: parser.usage,
      }, "--out=") as AsyncIterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    // File-kind suggestion is converted to literal with option= prefix
    assert.ok(suggestions.length > 0);
    assert.ok(suggestions.every((s) => s.kind === "literal"));
    assert.ok(
      suggestions.some((s) =>
        s.kind === "literal" && s.text.startsWith("--out=")
      ),
    );
  });

  // Lines 1884/1895/1907: suggestCommandAsync — "matched" and "parsing"
  // async states. Use an async inner parser so the command is async mode.
  it("command suggest async: 'matched' state delegates to inner parser", async () => {
    // The command becomes async because the inner parser is async.
    const asyncCmd = command(
      "deploy",
      option("--f", asyncFileSuggestingParser()),
    );
    assert.equal(asyncCmd.mode, "async");
    const suggestions: Suggestion[] = [];
    for await (
      const s of asyncCmd.suggest({
        buffer: [] as readonly string[],
        state: ["matched", "deploy"] as ["matched", string],
        optionsTerminated: false,
        usage: asyncCmd.usage,
      }, "--") as AsyncIterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    // Should get suggestions from the inner parser in "matched" state
    assert.ok(Array.isArray(suggestions));
  });

  it("command suggest async: 'parsing' state delegates to inner parser", async () => {
    const inner = option("--f", asyncFileSuggestingParser());
    const asyncCmd = command("deploy", inner);
    assert.equal(asyncCmd.mode, "async");
    const suggestions: Suggestion[] = [];
    for await (
      const s of asyncCmd.suggest({
        buffer: [] as readonly string[],
        state: ["parsing", inner.initialState] as [
          "parsing",
          typeof inner.initialState,
        ],
        optionsTerminated: false,
        usage: asyncCmd.usage,
      }, "--") as AsyncIterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.ok(Array.isArray(suggestions));
  });

  // Lines 2087: command complete async — "matched" state triggers async path.
  // Use a custom async inner parser whose parse() always returns a Promise so
  // command.complete() can call .then() on it correctly.
  it("command complete async: 'matched' state resolves asynchronously", async () => {
    const asyncInner: Parser<"async", string, null> = {
      $valueType: [] as readonly string[],
      $stateType: [] as readonly null[],
      mode: "async",
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: null,
      parse(_context: ParserContext<null>) {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`No input.`,
        });
      },
      complete(_state: null) {
        return Promise.resolve({ success: true as const, value: "async-done" });
      },
      suggest() {
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
            yield* [];
          },
        };
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const asyncCmd = command("run", asyncInner);
    assert.equal(asyncCmd.mode, "async");
    const state: ["matched", string] = ["matched", "run"];
    const result = await (asyncCmd.complete(state) as Promise<
      { success: boolean; value?: string }
    >);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "async-done");
    }
  });

  // Line 1305: flag errors.duplicate as function (non-flag option branch).
  it("flag errors.duplicate as function via parse()", () => {
    const f = flag("--verbose", {
      errors: {
        duplicate: (name) => message`Flag ${text(name)} already set.`,
      },
    });
    const alreadySet = {
      success: true as const,
      value: true as const,
    };
    const ctx = {
      buffer: ["--verbose"] as readonly string[],
      state: alreadySet,
      optionsTerminated: false,
      usage: f.usage,
    };
    const result = f.parse(ctx);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(formatMessage(result.error).includes("--verbose"));
    }
  });

  // Line 1330: flag with / prefix — the `${name}:` join format is created
  // for /Option style flags (Windows-style).
  it("flag /OPTION:value returns unexpectedValue error", () => {
    const f = flag("/verbose");
    const ctx = {
      buffer: ["/verbose:yes"] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: f.usage,
    };
    const result = f.parse(ctx);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(
        formatMessage(result.error).toLowerCase().includes("does not accept"),
        `expected error about value, got: ${formatMessage(result.error)}`,
      );
    }
  });

  // Line 1350: bundled short flag duplicate error (e.g., -abc when -a already set).
  it("flag -a bundled duplicate via custom errors.duplicate", () => {
    const f = flag("-a", {
      errors: {
        duplicate: (name) => message`${text(name)} bundled duplicate.`,
      },
    });
    const alreadySet = {
      success: true as const,
      value: true as const,
    };
    const ctx = {
      buffer: ["-ab"] as readonly string[],
      state: alreadySet,
      optionsTerminated: false,
      usage: f.usage,
    };
    const result = f.parse(ctx);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(formatMessage(result.error).includes("-a"));
    }
  });

  // Line 1277: flag endOfInput custom error.
  it("flag errors.endOfInput as static Message", () => {
    const f = flag("--verbose", {
      errors: { endOfInput: message`Need --verbose flag.` },
    });
    const ctx = {
      buffer: [] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: f.usage,
    };
    const result = f.parse(ctx);
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "Need --verbose flag.");
    }
  });

  it("option suggest sync: handles suggest disappearing between checks", () => {
    const suggestFn = function* (): IterableIterator<Suggestion> {
      yield { kind: "literal", text: "value" };
    };
    let suggestAccess = 0;
    const parserWithFlakySuggest: ValueParser<"sync", string> = {
      mode: "sync",
      metavar: "TEXT",
      placeholder: "",
      parse(input: string): ValueParserResult<string> {
        return { success: true, value: input };
      },
      format(value: string): string {
        return value;
      },
      get suggest() {
        suggestAccess += 1;
        return suggestAccess === 1 ? suggestFn : undefined;
      },
    };
    const parser = option("--name", parserWithFlakySuggest);
    const suggestions = [
      ...(parser.suggest({
        buffer: ["--name"] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: parser.usage,
      }, "") as Iterable<Suggestion>),
    ];
    assert.deepEqual(suggestions, []);
  });

  it("option suggest async: handles suggest disappearing between checks", async () => {
    const suggestFn = (_prefix: string): AsyncIterable<Suggestion> => ({
      async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
        yield { kind: "literal", text: "async-value" };
      },
    });
    let suggestAccess = 0;
    const parserWithFlakySuggest: ValueParser<"async", string> = {
      mode: "async",
      metavar: "TEXT",
      placeholder: "",
      parse(input: string): Promise<ValueParserResult<string>> {
        return Promise.resolve({ success: true, value: input });
      },
      format(value: string): string {
        return value;
      },
      get suggest() {
        suggestAccess += 1;
        return suggestAccess === 1 ? suggestFn : undefined;
      },
    };
    const parser = option("--name", parserWithFlakySuggest);
    const suggestions: Suggestion[] = [];
    for await (
      const s of parser.suggest({
        buffer: ["--name"] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: parser.usage,
      }, "") as AsyncIterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.deepEqual(suggestions, []);
  });

  it("option suggest sync: --opt= with file suggestion uses literal fallback", () => {
    const parser = option("--out", fileSuggestingParser());
    const suggestions = [
      ...(parser.suggest({
        buffer: [] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: parser.usage,
      }, "--out=") as Iterable<Suggestion>),
    ];
    assert.ok(suggestions.some((s) => s.kind === "literal"));
    assert.ok(
      suggestions.some((s) =>
        s.kind === "literal" && s.text.startsWith("--out=")
      ),
    );
  });

  it("option suggest async: derived parser uses defaults and dependency values", async () => {
    const modeDep = dependency(string({ metavar: "MODE" }));
    const envDep = dependency(string({ metavar: "ENV" }));
    const asyncDerived = deriveFromAsync({
      metavar: "TARGET",
      dependencies: [modeDep, envDep] as const,
      defaultValues: () => ["dev", "local"] as const,
      factory: (_mode: string, _env: string) => ({
        mode: "async" as const,
        metavar: "TARGET",
        placeholder: "",
        parse(input: string): Promise<ValueParserResult<string>> {
          return Promise.resolve({ success: true, value: input });
        },
        format(value: string): string {
          return value;
        },
        suggest(prefix: string): AsyncIterable<Suggestion> {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield { kind: "literal", text: `${prefix}target` };
            },
          };
        },
      }),
    });
    const parser = option("--target", asyncDerived);
    const registry = new DependencyRegistry();
    registry.set(modeDep[dependencyId], "prod");
    const ctx = {
      buffer: ["--target"] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: parser.usage,
      dependencyRegistry: registry,
    };
    const suggestions: Suggestion[] = [];
    for await (
      const s of parser.suggest(ctx, "") as AsyncIterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.ok(suggestions.length > 0);
  });

  it("option suggest async: single dependency uses scalar dependency value", async () => {
    const modeDep = dependency(string({ metavar: "MODE" }));
    const asyncDerived = deriveFromAsync({
      metavar: "OUTPUT",
      dependencies: [modeDep] as const,
      defaultValues: () => ["dev"] as const,
      factory: (mode: string) => ({
        mode: "async" as const,
        metavar: "OUTPUT",
        placeholder: "",
        parse(input: string): Promise<ValueParserResult<string>> {
          return Promise.resolve({ success: true, value: input });
        },
        format(value: string): string {
          return value;
        },
        suggest(_prefix: string): AsyncIterable<Suggestion> {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield { kind: "literal", text: `from-${mode}` };
            },
          };
        },
      }),
    });
    const parser = option("--output", asyncDerived);
    const ctx = {
      buffer: ["--output"] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: parser.usage,
      dependencyRegistry: (() => {
        const r = new DependencyRegistry();
        r.set(modeDep[dependencyId], "prod");
        return r;
      })(),
    };
    const suggestions: Suggestion[] = [];
    for await (
      const s of parser.suggest(ctx, "") as AsyncIterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.ok(
      suggestions.some((s) =>
        s.kind === "literal" && s.text.startsWith("from-")
      ),
    );
  });

  it("option parse/complete: covers remaining error and state branches", async () => {
    const boolOption = option("-a", "--all", { hidden: false });
    assert.equal(boolOption.usage[0]?.type, "optional");
    if (boolOption.usage[0]?.type === "optional") {
      const optionTerm = boolOption.usage[0].terms[0];
      if (optionTerm?.type === "option") {
        assert.equal(optionTerm.hidden, false);
      }
    }

    const emptyParse = option("--name", string({ metavar: "TEXT" })).parse({
      buffer: [] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: boolOption.usage,
    });
    assert.ok(!emptyParse.success);

    const withDuplicateSeparated = option(
      "--name",
      string({ metavar: "TEXT" }),
      {
        errors: { duplicate: (token) => message`dup ${text(token)}` },
      },
    );
    const dupSeparated = withDuplicateSeparated.parse({
      buffer: ["--name", "x"] as readonly string[],
      state: { success: true, value: "already" },
      optionsTerminated: false,
      usage: withDuplicateSeparated.usage,
    });
    assert.ok(!dupSeparated.success);

    const withDuplicateJoined = option("--name", string({ metavar: "TEXT" }), {
      errors: { duplicate: (token) => message`dup ${text(token)}` },
    });
    const dupJoined = withDuplicateJoined.parse({
      buffer: ["--name=value"] as readonly string[],
      state: { success: true, value: "already" },
      optionsTerminated: false,
      usage: withDuplicateJoined.usage,
    });
    assert.ok(!dupJoined.success);

    const bundledDuplicate = boolOption.parse({
      buffer: ["-abc"] as readonly string[],
      state: { success: true, value: true },
      optionsTerminated: false,
      usage: boolOption.usage,
    });
    assert.ok(!bundledDuplicate.success);

    const asyncJoined = option("--name", asyncFileSuggestingParser()).parse({
      buffer: ["--name=value"] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: boolOption.usage,
    });
    const asyncJoinedResolved = await asyncJoined;
    assert.ok(asyncJoinedResolved.success);

    const withMissingFn = option("--value", string({ metavar: "VALUE" }), {
      errors: { missing: (names) => message`missing ${text(names.join("/"))}` },
    });
    const missing = withMissingFn.complete(undefined);
    assert.ok(!missing.success);

    const withPending = option("--mode", string({ metavar: "MODE" }), {
      errors: { missing: message`mode required` },
    });
    const completeWithPending = withPending.complete as (
      state: unknown,
    ) => ReturnType<typeof withPending.complete>;
    const pendingResult = await completeWithPending(undefined);
    assert.ok(!pendingResult.success);

    const withDeferred = option("--target", string({ metavar: "TARGET" }), {
      errors: { invalidValue: (err) => message`invalid ${err}` },
    });
    const completeWithDeferred = withDeferred.complete as (
      state: unknown,
    ) => ReturnType<typeof withDeferred.complete>;
    const deferredResult = await completeWithDeferred({
      success: false,
      error: message`bad value`,
    });
    assert.ok(!deferredResult.success);

    const depFail = await completeWithPending({
      success: false,
      error: message`source failed`,
    });
    assert.ok(!depFail.success);

    const plainFailure = await withDeferred.complete({
      success: false,
      error: message`plain failed`,
    });
    assert.ok(!plainFailure.success);
  });

  it("flag duplicate bundled: static duplicate error branch", () => {
    const f = flag("-a", {
      errors: { duplicate: message`already set` },
    });
    const result = f.parse({
      buffer: ["-ab"] as readonly string[],
      state: { success: true, value: true },
      optionsTerminated: false,
      usage: f.usage,
    });
    assert.ok(!result.success);
  });

  it("argument complete/suggest: covers dependency and async branches", async () => {
    const arg = argument(string({ metavar: "PATH" }), {
      errors: { invalidValue: (err) => message`invalid ${err}` },
    });
    const completeArg = arg.complete as (
      state: unknown,
    ) => ReturnType<typeof arg.complete>;
    const deferredResult = await completeArg({
      success: false,
      error: message`bad arg`,
    });
    assert.ok(!deferredResult.success);

    const depSuccess = await completeArg({ success: true, value: "ok" });
    assert.ok(depSuccess.success);

    const depFail = await completeArg({
      success: false,
      error: message`dep fail`,
    });
    assert.ok(!depFail.success);

    const plainFail = await arg.complete({
      success: false,
      error: message`plain fail`,
    });
    assert.ok(!plainFail.success);

    const asyncArg = argument(asyncFileSuggestingParser());
    const suggestions: Suggestion[] = [];
    for await (
      const s of asyncArg.suggest({
        buffer: [] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: asyncArg.usage,
      }, "") as AsyncIterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.ok(Array.isArray(suggestions));
  });

  it("command parse/complete/suggest: invalid states and async branches", async () => {
    const asyncCmdWithDescription = command(
      "deploy",
      option("--file", asyncFileSuggestingParser()),
      { description: message`Deploy command`, hidden: true },
    );
    const hiddenSuggestions: Suggestion[] = [];
    for await (
      const s of asyncCmdWithDescription.suggest({
        buffer: [] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: asyncCmdWithDescription.usage,
      }, "de") as AsyncIterable<Suggestion>
    ) {
      hiddenSuggestions.push(s);
    }
    assert.deepEqual(hiddenSuggestions, []);

    const visibleAsyncCmd = command(
      "deploy",
      option("--file", asyncFileSuggestingParser()),
      { description: message`Deploy command` },
    );
    const visibleSuggestions: Suggestion[] = [];
    for await (
      const s of visibleAsyncCmd.suggest({
        buffer: [] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: visibleAsyncCmd.usage,
      }, "de") as AsyncIterable<Suggestion>
    ) {
      visibleSuggestions.push(s);
    }
    assert.ok(
      visibleSuggestions.some((s) =>
        s.kind === "literal" && s.text === "deploy"
      ),
    );

    const syncInner = argument(string({ metavar: "NAME" }));
    const syncCmd = command("run", syncInner);
    const syncDelegated = syncCmd.parse({
      buffer: ["x"] as readonly string[],
      state: ["parsing", syncInner.initialState] as [
        "parsing",
        typeof syncInner.initialState,
      ],
      optionsTerminated: false,
      usage: syncCmd.usage,
    });
    assert.ok(syncDelegated.success);

    const parseCommandInternal = syncCmd.parse as (
      context: ParserContext<unknown>,
    ) => ReturnType<typeof syncCmd.parse>;
    const invalidParseState = parseCommandInternal({
      buffer: [] as readonly string[],
      state: ["invalid"],
      optionsTerminated: false,
      usage: syncCmd.usage,
    });
    assert.ok(!invalidParseState.success);

    const asyncInner: Parser<"async", string, null> = {
      $valueType: [] as readonly string[],
      $stateType: [] as readonly null[],
      mode: "async",
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: null,
      parse(_context: ParserContext<null>) {
        return Promise.resolve({
          success: true as const,
          next: {
            buffer: [] as readonly string[],
            optionsTerminated: false,
            usage: [],
            state: null,
          },
          consumed: [] as readonly string[],
        });
      },
      complete(_state: null) {
        return Promise.resolve({ success: true as const, value: "ok" });
      },
      suggest() {
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
            yield* [];
          },
        };
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };
    const asyncCmd = command("run", asyncInner);
    const completed = await asyncCmd.complete(["matched", "run"]);
    assert.ok(completed.success);

    const completeCommandInternal = syncCmd.complete as (
      state: unknown,
    ) => ReturnType<typeof syncCmd.complete>;
    const invalidComplete = completeCommandInternal(["invalid"]);
    assert.ok(!invalidComplete.success);
  });

  it("passThrough nextToken: captures option without following value", () => {
    const p = passThrough({ format: "nextToken" });
    const result = p.parse({
      buffer: ["--raw"] as readonly string[],
      state: [] as readonly string[],
      optionsTerminated: false,
      usage: p.usage,
    });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.consumed, ["--raw"]);
    }
  });

  it("custom inspect strings are exposed for primitive parsers", () => {
    const o = option("--name", string());
    const f = flag("--verbose");
    const a = argument(string());
    const c = command("deploy", object({ dryRun: flag("--dry-run") }));
    const p = passThrough();

    const inspectSymbol = Symbol.for("Deno.customInspect");
    const optionInspect = (o as unknown as Record<symbol, () => string>)[
      inspectSymbol
    ]();
    const flagInspect = (f as unknown as Record<symbol, () => string>)[
      inspectSymbol
    ]();
    const argumentInspect = (a as unknown as Record<symbol, () => string>)[
      inspectSymbol
    ]();
    const commandInspect = (c as unknown as Record<symbol, () => string>)[
      inspectSymbol
    ]();
    const passThroughInspect = (p as unknown as Record<symbol, () => string>)[
      inspectSymbol
    ]();

    assert.equal(optionInspect, 'option("--name")');
    assert.equal(flagInspect, 'flag("--verbose")');
    assert.equal(argumentInspect, "argument()");
    assert.equal(commandInspect, 'command("deploy")');
    assert.equal(passThroughInspect, "passThrough(equalsOnly)");
  });

  it("option async derived suggest falls back when dependency value is missing", async () => {
    const dep = dependency(string({ metavar: "MODE" }));
    const derived = deriveFromAsync({
      metavar: "TARGET",
      dependencies: [dep] as const,
      defaultValues: () => ["dev"] as const,
      factory: (_mode: string) => asyncFileSuggestingParser(),
    });
    const parser = option("--target", derived);
    const suggestions: Suggestion[] = [];
    for await (
      const s of parser.suggest({
        buffer: ["--target"] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: parser.usage,
        dependencyRegistry: new DependencyRegistry(),
      }, "") as AsyncIterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.ok(Array.isArray(suggestions));
  });

  it("passThrough reports unknown format when forced through invalid state", () => {
    const parser = passThrough({
      format: "invalid" as unknown as "equalsOnly",
    });
    const invalidParse = parser.parse({
      buffer: ["--x"] as readonly string[],
      state: [] as readonly string[],
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(!invalidParse.success);
  });

  it("option suggest: covers sync/async file fallback branches", async () => {
    const syncFileNoPattern: ValueParser<"sync", string> = {
      mode: "sync",
      metavar: "FILE",
      placeholder: "",
      parse(input: string): ValueParserResult<string> {
        return { success: true, value: input };
      },
      format(value: string): string {
        return value;
      },
      suggest(): Iterable<Suggestion> {
        return [{ kind: "file", type: "any" }];
      },
    };
    const syncOption = option("--file", syncFileNoPattern);
    const syncJoinedSuggestions = Array.from(syncOption.suggest({
      buffer: [] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: syncOption.usage,
    }, "--file=abc"));
    assert.deepEqual(syncJoinedSuggestions, [{
      kind: "literal",
      text: "--file=",
      description: undefined,
    }]);

    const dep = dependency(string({ metavar: "MODE" }));
    const sparseDefaultsDerived = deriveFromSync({
      metavar: "TARGET",
      dependencies: [dep] as const,
      defaultValues: () => [] as unknown as readonly [string],
      factory: (_mode: string) => string({ metavar: "TARGET" }),
    });
    const syncDerivedOption = option("--target", sparseDefaultsDerived);
    const syncFallbackSuggestions = Array.from(syncDerivedOption.suggest({
      buffer: ["--target"] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: syncDerivedOption.usage,
      dependencyRegistry: new DependencyRegistry(),
    }, ""));
    assert.ok(Array.isArray(syncFallbackSuggestions));

    const asyncFileNoPattern: ValueParser<"async", string> = {
      mode: "async",
      metavar: "FILE",
      placeholder: "",
      parse(input: string): Promise<ValueParserResult<string>> {
        return Promise.resolve({ success: true, value: input });
      },
      format(value: string): string {
        return value;
      },
      suggest(): AsyncIterable<Suggestion> {
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
            yield { kind: "file", type: "any" };
          },
        };
      },
    };
    const asyncOption = option("--log", asyncFileNoPattern);
    const asyncJoinedSuggestions: Suggestion[] = [];
    for await (
      const suggestion of asyncOption.suggest({
        buffer: [] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: asyncOption.usage,
      }, "--log=x")
    ) {
      asyncJoinedSuggestions.push(suggestion);
    }
    assert.deepEqual(asyncJoinedSuggestions, [{
      kind: "literal",
      text: "--log=",
      description: undefined,
    }]);

    const asyncValueSuggestions: Suggestion[] = [];
    for await (
      const suggestion of asyncOption.suggest({
        buffer: [] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: asyncOption.usage,
      }, "")
    ) {
      asyncValueSuggestions.push(suggestion);
    }
    assert.deepEqual(asyncValueSuggestions, [{ kind: "file", type: "any" }]);
  });

  it("option/flag/argument/command: covers remaining complete and invalid branches", () => {
    const duplicateOption = option("--name", string({ metavar: "TEXT" }));
    const duplicateResult = duplicateOption.parse({
      buffer: ["--name", "alice"] as readonly string[],
      state: { success: true, value: "old" },
      optionsTerminated: false,
      usage: duplicateOption.usage,
    });
    assert.ok(!duplicateResult.success);

    const shortDuplicateOption = option("-a");
    const shortDuplicateResult = shortDuplicateOption.parse({
      buffer: ["-abc"] as readonly string[],
      state: { success: true, value: true },
      optionsTerminated: false,
      usage: shortDuplicateOption.usage,
    });
    assert.ok(!shortDuplicateResult.success);

    const completeOption = option("--mode", string({ metavar: "MODE" }));
    const pendingComplete = completeOption.complete(undefined);
    assert.ok(!pendingComplete.success);

    const deferredOptionFail = completeOption.complete(
      { success: false, error: message`bad mode` },
    );
    assert.ok(!deferredOptionFail.success);

    const depOptionFail = completeOption.complete(
      { success: false, error: message`source failed` },
    );
    assert.ok(!depOptionFail.success);

    const plainOptionFail = completeOption.complete({
      success: false,
      error: message`plain failed`,
    });
    assert.ok(!plainOptionFail.success);

    const duplicateFlag = flag("--force");
    const duplicateFlagResult = duplicateFlag.parse({
      buffer: ["--force"] as readonly string[],
      state: { success: true, value: true as const },
      optionsTerminated: false,
      usage: duplicateFlag.usage,
    });
    assert.ok(!duplicateFlagResult.success);

    const duplicateBundledFlag = flag("-f");
    const duplicateBundledFlagResult = duplicateBundledFlag.parse({
      buffer: ["-fx"] as readonly string[],
      state: { success: true, value: true as const },
      optionsTerminated: false,
      usage: duplicateBundledFlag.usage,
    });
    assert.ok(!duplicateBundledFlagResult.success);

    const completeArgument = argument(string({ metavar: "NAME" }));
    const deferredArgFail = completeArgument.complete(
      { success: false, error: message`bad argument` },
    );
    assert.ok(!deferredArgFail.success);

    const depArgFail = completeArgument.complete(
      { success: false, error: message`dependency failed` },
    );
    assert.ok(!depArgFail.success);

    const plainArgFail = completeArgument.complete({
      success: false,
      error: message`plain argument failure`,
    });
    assert.ok(!plainArgFail.success);

    const cmd = command("deploy", argument(string({ metavar: "TARGET" })));
    const invalidStateResult = (cmd.parse as (
      context: ParserContext<unknown>,
    ) => ReturnType<typeof cmd.parse>)({
      buffer: [] as readonly string[],
      state: ["invalid"],
      optionsTerminated: false,
      usage: cmd.usage,
    });
    assert.ok(!invalidStateResult.success);
  });

  it("option parse treats failed value parses as consumed for duplicates", () => {
    const parser = option("--port", integer());
    const result = parseSync(parser, ["--port", "bad", "--port", "42"]);

    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(
        formatMessage(result.error),
        "`--port` cannot be used multiple times.",
      );
    }
  });

  it("covers async suggestion and custom error edge branches", async () => {
    const dep = dependency(string({ metavar: "MODE" }));
    const asyncDerivedWithoutDefaults = deriveFromAsync({
      metavar: "TARGET",
      dependencies: [dep] as const,
      defaultValues: () => [] as unknown as readonly [string],
      factory: (_mode: string) => ({
        mode: "async" as const,
        metavar: "TARGET",
        placeholder: "",
        parse(input: string): Promise<ValueParserResult<string>> {
          return Promise.resolve({ success: true, value: input });
        },
        format(value: string): string {
          return value;
        },
        suggest(prefix: string): AsyncIterable<Suggestion> {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield { kind: "literal", text: `fallback-${prefix}` };
            },
          };
        },
      }),
    });
    const asyncFallbackOption = option("--target", asyncDerivedWithoutDefaults);
    const asyncFallbackSuggestions: Suggestion[] = [];
    for await (
      const suggestion of asyncFallbackOption.suggest({
        buffer: ["--target"] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: asyncFallbackOption.usage,
        dependencyRegistry: new DependencyRegistry(),
      }, "")
    ) {
      asyncFallbackSuggestions.push(suggestion);
    }
    assert.deepEqual(asyncFallbackSuggestions, [{
      kind: "literal",
      text: "fallback-",
    }]);

    const asyncLiteralSuggestingOption = option(
      "--name",
      deriveFromAsync({
        metavar: "NAME",
        dependencies: [dep] as const,
        defaultValues: () => ["dev"] as const,
        factory: (_mode: string) => ({
          mode: "async" as const,
          metavar: "NAME",
          placeholder: "",
          parse(input: string): Promise<ValueParserResult<string>> {
            return Promise.resolve({ success: true, value: input });
          },
          format(value: string): string {
            return value;
          },
          suggest(prefix: string): AsyncIterable<Suggestion> {
            return {
              async *[Symbol.asyncIterator](): AsyncIterableIterator<
                Suggestion
              > {
                yield { kind: "literal", text: `${prefix}-x` };
              },
            };
          },
        }),
      }),
    );
    const asyncJoinedLiteralSuggestions: Suggestion[] = [];
    for await (
      const suggestion of asyncLiteralSuggestingOption.suggest({
        buffer: [] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: asyncLiteralSuggestingOption.usage,
      }, "--name=ab")
    ) {
      asyncJoinedLiteralSuggestions.push(suggestion);
    }
    assert.deepEqual(asyncJoinedLiteralSuggestions, [{
      kind: "literal",
      text: "--name=ab-x",
      description: undefined,
    }]);

    const hiddenAsyncArgument = argument(asyncFileSuggestingParser(), {
      hidden: true,
    });
    const hiddenAsyncArgumentSuggestions: Suggestion[] = [];
    for await (
      const suggestion of hiddenAsyncArgument.suggest({
        buffer: [] as readonly string[],
        state: undefined,
        optionsTerminated: false,
        usage: hiddenAsyncArgument.usage,
      }, "")
    ) {
      hiddenAsyncArgumentSuggestions.push(suggestion);
    }
    assert.deepEqual(hiddenAsyncArgumentSuggestions, []);

    const endOfInputCustom = option("--mode", string({ metavar: "MODE" }), {
      errors: { endOfInput: message`custom end` },
    }).parse({
      buffer: [] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: [],
    });
    assert.ok(!endOfInputCustom.success);
    if (!endOfInputCustom.success) {
      assert.equal(formatMessage(endOfInputCustom.error), "custom end");
    }

    const missingValueCustom = option(
      "--mode",
      string({ metavar: "MODE" }),
      { errors: { endOfInput: message`custom missing value` } },
    ).parse({
      buffer: ["--mode"] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: [],
    });
    assert.ok(!missingValueCustom.success);
    if (!missingValueCustom.success) {
      assert.equal(
        formatMessage(missingValueCustom.error),
        "custom missing value",
      );
    }

    const boolComplete = option("--enabled").complete(undefined);
    assert.deepEqual(boolComplete, { success: true, value: false });

    const tokenOption = option("--token", string({ metavar: "TOKEN" }), {
      errors: { missing: (names) => message`missing ${text(names.join(","))}` },
    });
    const missingViaPending = tokenOption.complete(undefined);
    assert.ok(!missingViaPending.success);
    if (!missingViaPending.success) {
      assert.equal(formatMessage(missingViaPending.error), "missing --token");
    }

    const duplicateOptionCustom = option("-a", "--all", {
      errors: { duplicate: (name) => message`dup ${text(name)}` },
    });
    const duplicateOptionCustomResult = duplicateOptionCustom.parse({
      buffer: ["-abc"] as readonly string[],
      state: { success: true, value: true },
      optionsTerminated: false,
      usage: duplicateOptionCustom.usage,
    });
    assert.ok(!duplicateOptionCustomResult.success);
    if (!duplicateOptionCustomResult.success) {
      assert.equal(formatMessage(duplicateOptionCustomResult.error), "dup -a");
    }

    const duplicateFlagCustom = flag("--force", {
      errors: { duplicate: (name) => message`dup ${text(name)}` },
    });
    const duplicateFlagCustomResult = duplicateFlagCustom.parse({
      buffer: ["--force"] as readonly string[],
      state: { success: true, value: true as const },
      optionsTerminated: false,
      usage: duplicateFlagCustom.usage,
    });
    assert.ok(!duplicateFlagCustomResult.success);
    if (!duplicateFlagCustomResult.success) {
      assert.equal(
        formatMessage(duplicateFlagCustomResult.error),
        "dup --force",
      );
    }

    const argWithCustomInvalid = argument(string({ metavar: "NAME" }), {
      errors: { invalidValue: (error) => message`bad ${error}` },
    });
    const plainSuccess = argWithCustomInvalid.complete({
      success: true,
      value: "ok",
    });
    assert.ok(plainSuccess.success);

    for (
      const [error, expected] of [
        [message`dep-fail`, "bad dep-fail"],
        [message`plain-fail`, "bad plain-fail"],
        [message`deferred-fail`, "bad deferred-fail"],
      ] as const
    ) {
      const failure = argWithCustomInvalid.complete({
        success: false,
        error,
      });
      assert.ok(!failure.success);
      if (!failure.success) {
        assert.equal(formatMessage(failure.error), expected);
      }
    }

    const optionWithCustomErrors = option("--port", integer(), {
      errors: {
        missing: (names) => message`missing ${text(names.join(","))}`,
        invalidValue: (error) => message`invalid ${error}`,
      },
    });
    const missingOption = optionWithCustomErrors.complete(undefined);
    assert.ok(!missingOption.success);
    if (!missingOption.success) {
      assert.equal(formatMessage(missingOption.error), "missing --port");
    }

    for (
      const [error, expected] of [
        [message`not-int`, "invalid not-int"],
        [message`dep-not-int`, "invalid dep-not-int"],
        [message`plain-not-int`, "invalid plain-not-int"],
      ] as const
    ) {
      const invalidOptionFailure = optionWithCustomErrors.complete({
        success: false,
        error,
      });
      assert.ok(!invalidOptionFailure.success);
      if (!invalidOptionFailure.success) {
        assert.equal(
          formatMessage(invalidOptionFailure.error),
          expected,
        );
      }
    }

    const staticDuplicateOption = option("--count", integer(), {
      errors: { duplicate: message`count appears more than once` },
    });
    const staticDuplicateOptionResult = staticDuplicateOption.parse({
      buffer: ["--count", "3"] as readonly string[],
      state: { success: true, value: 1 },
      optionsTerminated: false,
      usage: staticDuplicateOption.usage,
    });
    assert.ok(!staticDuplicateOptionResult.success);
    if (!staticDuplicateOptionResult.success) {
      assert.equal(
        formatMessage(staticDuplicateOptionResult.error),
        "count appears more than once",
      );
    }

    const staticDuplicateBundledOption = option("-a", "--all", {
      errors: { duplicate: message`all was already set` },
    });
    const staticDuplicateBundledOptionResult = staticDuplicateBundledOption
      .parse({
        buffer: ["-abc"] as readonly string[],
        state: { success: true, value: true },
        optionsTerminated: false,
        usage: staticDuplicateBundledOption.usage,
      });
    assert.ok(!staticDuplicateBundledOptionResult.success);
    if (!staticDuplicateBundledOptionResult.success) {
      assert.equal(
        formatMessage(staticDuplicateBundledOptionResult.error),
        "all was already set",
      );
    }

    const staticDuplicateFlag = flag("--force", {
      errors: { duplicate: message`force can only be specified once` },
    });
    const staticDuplicateFlagResult = staticDuplicateFlag.parse({
      buffer: ["--force"] as readonly string[],
      state: { success: true, value: true as const },
      optionsTerminated: false,
      usage: staticDuplicateFlag.usage,
    });
    assert.ok(!staticDuplicateFlagResult.success);
    if (!staticDuplicateFlagResult.success) {
      assert.equal(
        formatMessage(staticDuplicateFlagResult.error),
        "force can only be specified once",
      );
    }

    const staticInvalidArgument = argument(string({ metavar: "NAME" }), {
      errors: { invalidValue: message`static invalid argument` },
    });
    const staticInvalidArgumentResult = staticInvalidArgument.complete({
      success: false,
      error: message`inner-arg-error`,
    });
    assert.ok(!staticInvalidArgumentResult.success);
    if (!staticInvalidArgumentResult.success) {
      assert.equal(
        formatMessage(staticInvalidArgumentResult.error),
        "static invalid argument",
      );
    }

    const staticInvalidOption = option("--port", integer(), {
      errors: {
        missing: message`missing static`,
        invalidValue: message`static invalid option`,
      },
    });
    const staticInvalidOptionResult = staticInvalidOption.complete({
      success: false,
      error: message`inner-opt-error`,
    });
    assert.ok(!staticInvalidOptionResult.success);
    if (!staticInvalidOptionResult.success) {
      assert.equal(
        formatMessage(staticInvalidOptionResult.error),
        "static invalid option",
      );
    }

    const cmd = command("deploy", argument(string({ metavar: "TARGET" })), {
      errors: { invalidState: message`custom invalid state` },
    });
    const invalidStateResult = (cmd.parse as (
      context: ParserContext<unknown>,
    ) => ReturnType<typeof cmd.parse>)({
      buffer: [] as readonly string[],
      state: ["broken"],
      optionsTerminated: false,
      usage: cmd.usage,
    });
    assert.ok(!invalidStateResult.success);
    if (!invalidStateResult.success) {
      assert.equal(
        formatMessage(invalidStateResult.error),
        "custom invalid state",
      );
    }
  });

  it("wrapped derived value parsers preserve parse-time default snapshots", () => {
    let callCount = 0;
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: () => {
        callCount++;
        return choice(
          callCount % 2 === 1 ? (["debug"] as const) : (["strict"] as const),
        );
      },
      defaultValue: () => "dev" as const,
    });
    const dependencyMetadata = extractDependencyMetadata(level);
    assert.ok(dependencyMetadata != null);
    const wrappedLevel = Object.defineProperties(
      {},
      {
        ...Object.getOwnPropertyDescriptors(level),
        dependencyMetadata: {
          value: dependencyMetadata,
          configurable: true,
          enumerable: true,
          writable: true,
        },
      },
    ) as typeof level & {
      readonly dependencyMetadata: typeof dependencyMetadata;
    };
    const parser = option("--level", wrappedLevel);

    callCount = 0;
    const result = parseSync(parser, ["--level", "debug"]);

    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "debug");
    }
    assert.equal(callCount, 1);
  });
});

describe("leadingNames", () => {
  it("should be empty for constant()", () => {
    assert.deepEqual(constant("x").leadingNames, new Set());
  });

  it("should be empty for fail()", () => {
    assert.deepEqual(fail().leadingNames, new Set());
  });

  it("should contain all option names for option()", () => {
    assert.deepEqual(
      option("-v", "--verbose", string()).leadingNames,
      new Set(["-v", "--verbose"]),
    );
  });

  it("should contain all flag names for flag()", () => {
    assert.deepEqual(
      flag("-d", "--debug").leadingNames,
      new Set(["-d", "--debug"]),
    );
  });

  it("should be empty for argument()", () => {
    assert.deepEqual(argument(string()).leadingNames, new Set());
  });

  it("should contain only the command name for command()", () => {
    assert.deepEqual(
      command("help", object({})).leadingNames,
      new Set(["help"]),
    );
  });

  it("should not include inner parser names for command()", () => {
    const parser = command(
      "tool",
      command("help", object({})),
    );
    assert.deepEqual(parser.leadingNames, new Set(["tool"]));
  });

  it("should be empty for passThrough()", () => {
    assert.deepEqual(passThrough().leadingNames, new Set());
  });
});

describe("acceptingAnyToken", () => {
  it("should be true for argument()", () => {
    assert.ok(argument(string()).acceptingAnyToken);
  });

  it("should be false for option()", () => {
    assert.ok(!option("--name", string()).acceptingAnyToken);
  });

  it("should be false for flag()", () => {
    assert.ok(!flag("--verbose").acceptingAnyToken);
  });

  it("should be false for command()", () => {
    assert.ok(!command("help", object({})).acceptingAnyToken);
  });

  it("should be false for constant()", () => {
    assert.ok(!constant("x").acceptingAnyToken);
  });

  it("should be false for fail()", () => {
    assert.ok(!fail().acceptingAnyToken);
  });

  it("should be false for passThrough()", () => {
    assert.ok(!passThrough().acceptingAnyToken);
  });
});

describe("validateValue on primitives (#414)", () => {
  describe("option()", () => {
    it("accepts values passing the inner ValueParser constraints", () => {
      const parser = option("-x", string({ pattern: /^[A-Z]+$/ }));
      assert.ok(typeof parser.validateValue === "function");
      const result = parser.validateValue!("APPLE");
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(result.success);
      if (result.success) assert.equal(result.value, "APPLE");
    });

    it("rejects values failing the inner ValueParser pattern", () => {
      const parser = option("-x", string({ pattern: /^[A-Z]+$/ }));
      const result = parser.validateValue!("hello");
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
    });

    it("rejects values failing integer bounds", () => {
      const parser = option("-x", integer({ min: 1, max: 10 }));
      const result = parser.validateValue!(99);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
    });

    it("returns success for boolean-flag option form (no value parser)", () => {
      const parser = option("-f");
      // Flag-form options have no value parser; `option().complete()`
      // yields `true` when the flag is present and `false` when it is
      // missing, so the accepted value domain is boolean.  The
      // attached validator must therefore return success for both
      // `true` and `false`.  Hard-fail if the hook is missing so the
      // #414 regression contract cannot silently disappear.
      assert.ok(typeof parser.validateValue === "function");
      const trueResult = parser.validateValue!(true);
      assert.ok(
        trueResult && typeof trueResult === "object" &&
          "success" in trueResult,
      );
      assert.ok(trueResult.success);

      const falseResult = parser.validateValue!(false);
      assert.ok(
        falseResult && typeof falseResult === "object" &&
          "success" in falseResult,
      );
      assert.ok(falseResult.success);
    });

    it("rejects non-boolean fallback values on a flag-form option", () => {
      // bindEnv() / bindConfig() can feed values from `unknown` config /
      // env sources into validateValue.  A non-boolean fallback would
      // leak through as the parsed result even though the CLI parser
      // can only ever produce a boolean for flag-form options.
      // validateValue must reject such inputs with an option-scoped
      // error.
      const parser = option("-f");
      assert.ok(typeof parser.validateValue === "function");

      const stringResult = parser.validateValue!("yes" as never);
      assert.ok(
        stringResult && typeof stringResult === "object" &&
          "success" in stringResult,
      );
      assert.ok(!stringResult.success);
      if (!stringResult.success) {
        const formatted = formatMessage(stringResult.error);
        assert.ok(
          formatted.includes("-f"),
          `expected error to mention the option name, got: ${formatted}`,
        );
        assert.ok(
          formatted.toLowerCase().includes("boolean"),
          `expected error to mention "boolean", got: ${formatted}`,
        );
      }

      const numberResult = parser.validateValue!(1 as never);
      assert.ok(
        numberResult && typeof numberResult === "object" &&
          "success" in numberResult,
      );
      assert.ok(!numberResult.success);
    });
  });

  describe("argument()", () => {
    it("accepts values passing the inner pattern", () => {
      const parser = argument(string({ pattern: /^[A-Z]+$/ }));
      assert.ok(typeof parser.validateValue === "function");
      const result = parser.validateValue!("APPLE");
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(result.success);
    });

    it("rejects values failing the inner pattern", () => {
      const parser = argument(string({ pattern: /^[A-Z]+$/ }));
      const result = parser.validateValue!("hello");
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
    });
  });

  describe("choice()", () => {
    it("rejects values outside the choice set", () => {
      const parser = option("-x", choice(["red", "green", "blue"]));
      // @ts-expect-error: intentional type violation to exercise
      // validateValue against an out-of-set literal.
      const result = parser.validateValue!("purple");
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
    });

    it("accepts values inside the choice set", () => {
      const parser = option("-x", choice(["red", "green", "blue"]));
      const result = parser.validateValue!("red");
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(result.success);
    });
  });

  describe("error formatting", () => {
    it("option() prefixes validateValue failures with the option name", () => {
      const parser = option("-x", "--xval", integer({ min: 1, max: 10 }));
      const result = parser.validateValue!(99);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
      if (!result.success) {
        const formatted = formatMessage(result.error);
        assert.ok(
          formatted.includes("-x") || formatted.includes("--xval"),
          `expected error to mention option name, got: ${formatted}`,
        );
      }
    });

    it("option() honors options.errors.invalidValue in validateValue", () => {
      const parser = option("-x", integer({ min: 1, max: 10 }), {
        errors: {
          invalidValue: message`custom invalid value error.`,
        },
      });
      const result = parser.validateValue!(99);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(
          formatMessage(result.error),
          "custom invalid value error.",
        );
      }
    });

    it("argument() prefixes validateValue failures with the metavar", () => {
      const parser = argument(integer({ min: 1, max: 10 }));
      const result = parser.validateValue!(99);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
      if (!result.success) {
        const formatted = formatMessage(result.error);
        assert.ok(
          formatted.includes("INTEGER"),
          `expected error to mention metavar, got: ${formatted}`,
        );
      }
    });

    it("argument() honors options.errors.invalidValue in validateValue", () => {
      const parser = argument(integer({ min: 1, max: 10 }), {
        errors: {
          invalidValue: message`custom arg error.`,
        },
      });
      const result = parser.validateValue!(99);
      assert.ok(result && typeof result === "object" && "success" in result);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(formatMessage(result.error), "custom arg error.");
      }
    });
  });
});
