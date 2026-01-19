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
  flag,
  option,
  passThrough,
} from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { type InferValue, parse } from "@optique/core/parser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function assertErrorIncludes(error: Message, text: string): void {
  const formatted = formatMessage(error);
  assert.ok(formatted.includes(text));
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
      const parser = option("--port", integer());
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
        assertErrorIncludes(result.error, "requires a value");
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

      const result = parse(parser, ["-f"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, true);
      }
    });

    it("should fail when flag is not provided", () => {
      const parser = flag("-f", "--force");

      const result = parse(parser, []);
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
      let result = parse(parser, ["-f", "-v"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.force, true);
        assert.equal(result.value.verbose, true);
      }

      // Without flag
      result = parse(parser, ["-v"]);
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
      let result = parse(parser, ["-f", "test"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.force, true);
        assert.equal(result.value.name, "test");
      }

      // Without flag
      result = parse(parser, ["test"]);
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

    const validFileResult = parse(fileParser, ["readme.txt"]);
    assert.ok(validFileResult.success);
    if (validFileResult.success) {
      assert.equal(validFileResult.value, "readme.txt");
    }

    const invalidFileResult = parse(fileParser, ["script.js"]);
    assert.ok(!invalidFileResult.success);

    const validPortResult = parse(portParser, ["8080"]);
    assert.ok(validPortResult.success);
    if (validPortResult.success) {
      assert.equal(validPortResult.value, 8080);
    }

    const invalidPortResult = parse(portParser, ["80"]);
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

    const result = parse(showParser, ["show", "--progress", "item123"]);
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

    const result = parse(showParser, ["edit", "item123"]);
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

    const result = parse(editParser, ["edit"]);
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
    const result1 = parse(editParser, ["edit", "-e", "vim", "item123"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.type, "edit");
      assert.equal(result1.value.editor, "vim");
      assert.equal(result1.value.id, "item123");
    }

    // Test without optional option
    const result2 = parse(editParser, ["edit", "item456"]);
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
    const showResult = parse(parser, ["show", "--progress", "item123"]);
    assert.ok(showResult.success);
    if (showResult.success) {
      assert.equal(showResult.value.type, "show");
      assert.equal(showResult.value.progress, true);
      assert.equal(showResult.value.id, "item123");
    }

    // Test edit command
    const editResult = parse(parser, ["edit", "-e", "vim", "item456"]);
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

    const result = parse(parser, ["delete", "item123"]);
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

    const result = parse(showParser, []);
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
    const showResult = parse(parser, ["show", "--progress", "item123"]);
    const editResult = parse(parser, ["edit", "-e", "vim", "item456"]);

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

    const result = parse(complexParser, [
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
    const result1 = parse(parser, ["test", "item123"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.type, "test");
    }

    // Should match "testing" exactly
    const result2 = parse(parser, ["testing", "item456"]);
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

    const result = parse(parser, ["--help"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.type, "help");
    }
  });

  it("should handle command with array-like TState (state type safety test)", () => {
    // Test our CommandState type safety with arrays
    const multiParser = command("multi", multiple(option("-v", "--verbose")));

    const result1 = parse(multiParser, ["multi", "-v", "-v"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.deepEqual(result1.value, [true, true]);
    }

    const result2 = parse(multiParser, ["multi"]);
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

    const result = parse(nestedParser, ["--global", "run", "build"]);
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

    const result = parse(tupleParser, ["start"]);
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
    const result = parse(parser, ["exec", "--", "--not-an-option", "arg1"]);
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

    const result1 = parse(parser, ["v1"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value, "version1");
    }

    const result2 = parse(parser, ["v2"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value, "version2");
    }
  });

  it("should handle empty command name gracefully", () => {
    // This is a bit of an edge case, but should not crash
    const parser = command("", constant("empty" as const));

    const result = parse(parser, [""]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "empty");
    }
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
    const result = parse(parser, ["dev"]);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.mode, "active");
      assert.strictEqual(result.value.cwd, "./");
      assert.strictEqual(result.value.key, undefined);
    }

    // With additional options should also work
    const resultWithOptions = parse(parser, ["dev", "--key", "foo"]);
    assert.strictEqual(resultWithOptions.success, true);
    if (resultWithOptions.success) {
      assert.strictEqual(resultWithOptions.value.mode, "active");
      assert.strictEqual(resultWithOptions.value.cwd, "./");
      assert.strictEqual(resultWithOptions.value.key, "foo");
    }
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

    // or() combinator organizes entries into sections
    assert.ok(fragments.fragments.length > 0);
    const sectionFragment = fragments.fragments.find((f) =>
      f.type === "section"
    );
    assert.ok(sectionFragment);
    if (sectionFragment && sectionFragment.type === "section") {
      assert.equal(sectionFragment.entries.length, 2);

      // Check first command (show)
      const showEntry = sectionFragment.entries[0];
      assert.deepEqual(
        showEntry.description,
        message`Show an item`,
      );
      assert.equal(showEntry.term.type, "command");
      if (showEntry.term.type === "command") {
        assert.equal(showEntry.term.name, "show");
      }

      // Check second command (edit)
      const editEntry = sectionFragment.entries[1];
      assert.deepEqual(
        editEntry.description,
        message`Edit an item`,
      );
      assert.equal(editEntry.term.type, "command");
      if (editEntry.term.type === "command") {
        assert.equal(editEntry.term.name, "edit");
      }
    }
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
});

describe("passThrough", () => {
  describe("equalsOnly format (default)", () => {
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

      const result = parse(parser, ["--debug", "--foo=bar", "--baz=qux"]);
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

      const result = parse(parser, ["--debug", "--foo", "bar"]);
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

      const result = parse(parser, [
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

      const suggestions = parser.suggest(context, "--");
      assert.deepEqual([...suggestions], []);
    });
  });

  describe("with optional() modifier", () => {
    it("should return undefined when no pass-through options provided", () => {
      const parser = object({
        debug: option("--debug"),
        extra: optional(passThrough()),
      });

      const result = parse(parser, ["--debug"]);
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

      const result = parse(parser, ["--debug", "--foo=bar"]);
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

      const result = parse(parser, ["mycommand"]);
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

      const result = parse(parser, ["--debug"]);
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

      const result = parse(parser, ["--debug", "--foo=bar"]);
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

      const result = parse(parser, []);
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

      const result = parse(parser, ["--debug", "--foo=bar", "--baz=qux"]);
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

      const result = parse(parser, ["--foo=bar", "--baz=qux"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value.extra, { foo: "bar", baz: "qux" });
      }
    });

    it("should work with greedy format transformation", () => {
      const parser = object({
        args: map(passThrough({ format: "greedy" }), (args) => args.join(" ")),
      });

      const result = parse(parser, ["--verbose", "-it", "bash"]);
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

      const result = parse(parser, ["--debug", "--foo=bar"]);
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

      const result = parse(parser, [
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

      const result = parse(parser, ["--debug", "--foo=bar", "--baz=qux"]);
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

      const result = parse(parser, ["mycommand", "--verbose", "-it"]);
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

      const result1 = parse(parser, ["--foo=bar", "--baz=qux"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.mode, "wrapper");
        if (result1.value.mode === "wrapper") {
          assert.deepEqual(result1.value.extra, ["--foo=bar", "--baz=qux"]);
        }
      }

      const result2 = parse(parser, ["myfile.txt"]);
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
      const result = parse(parser, ["--debug"]);
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
      const result1 = parse(parser, ["-p", "8080"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.mode, "local");
      }

      // --unknown value should match proxy mode
      const result2 = parse(parser, ["--unknown", "value"]);
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

      const result1 = parse(parser, ["--mode", "local", "-p", "8080"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value, ["local", { port: 8080 }]);
      }

      const result2 = parse(parser, ["--mode", "proxy", "--foo", "bar"]);
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

      const result = parse(parser, ["--debug", "--foo=bar"]);
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
      const result1 = parse(parser, ["run", "-v", "file.txt", "--foo=bar"]);
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
      const result2 = parse(parser, ["--unknown", "args"]);
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

      const result = parse(parser, [
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

      const result = parse(parser, []);
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

      const result = parse(parser, ["--", "--not-an-option"]);
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

      const result = parse(parser, ["--foo", "bar", "--baz"]);
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

      const result1 = parse(parser, ["build", "--optimize=true"]);
      assert.ok(result1.success);
      if (result1.success && result1.value.action === "build") {
        assert.deepEqual(result1.value.buildArgs, ["--optimize=true"]);
      }

      const result2 = parse(parser, ["test", "--coverage=true"]);
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

      const result = parse(parser, ["--foo=bar", "--baz=qux", "--third=one"]);
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
