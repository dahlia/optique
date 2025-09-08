import {
  envVar,
  formatMessage,
  type Message,
  message,
  text,
} from "@optique/core/message";
import {
  argument,
  command,
  concat,
  constant,
  flag,
  getDocPage,
  group,
  type InferValue,
  longestMatch,
  map,
  merge,
  multiple,
  object,
  option,
  optional,
  or,
  parse,
  type ParserResult,
  tuple,
  withDefault,
  WithDefaultError,
} from "@optique/core/parser";
import type { DocEntry, DocFragment } from "@optique/core/doc";
import { integer, string } from "@optique/core/valueparser";
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

describe("flag", () => {
  describe("basic functionality", () => {
    it("should parse single short flag", () => {
      const parser = flag("-f");
      const context = {
        buffer: ["-f"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
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
      };
      let result = parser.parse(context);
      assert.ok(result.success);

      // Test with long form
      context = {
        buffer: ["--force"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
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

describe("object", () => {
  it("should combine multiple parsers into an object", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      port: option("-p", "--port", integer()),
    });

    assert.ok(parser.priority >= 10);
    assert.ok("verbose" in parser.initialState);
    assert.ok("port" in parser.initialState);
  });

  it("should parse multiple options in sequence", () => {
    const parser = object({
      verbose: option("-v"),
      port: option("-p", integer()),
    });

    const result = parse(parser, ["-v", "-p", "8080"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.port, 8080);
    }
  });

  it("should work with labeled objects", () => {
    const parser = object("Test Group", {
      flag: option("-f"),
    });

    assert.ok("flag" in parser.initialState);
  });

  it("should handle parsing failure in nested parser", () => {
    const parser = object({
      port: option("-p", integer({ min: 1 })),
    });

    const result = parse(parser, ["-p", "0"]);
    assert.ok(!result.success);
  });

  it("should fail when no option matches", () => {
    const parser = object({
      verbose: option("-v"),
    });

    const context = {
      buffer: ["--help"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
    };

    const result = parser.parse(context);
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(result.consumed, 0);
      assertErrorIncludes(result.error, "Unexpected option");
    }
  });

  it("should handle empty arguments gracefully when required options are present", () => {
    const parser = object({
      verbose: option("-v"),
      port: option("-p", integer()),
    });

    const result = parse(parser, []);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Expected an option");
    }
  });

  it("should succeed with empty input when only Boolean flags are present", () => {
    const parser = object({
      watch: option("--watch"),
    });

    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.watch, false);
    }
  });

  it("should succeed with empty input when multiple Boolean flags are present", () => {
    const parser = object({
      watch: option("--watch"),
      verbose: option("--verbose"),
      debug: option("--debug"),
    });

    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.watch, false);
      assert.equal(result.value.verbose, false);
      assert.equal(result.value.debug, false);
    }
  });

  it("should parse Boolean flags correctly when provided", () => {
    const parser = object({
      watch: option("--watch"),
      verbose: option("--verbose"),
    });

    const result = parse(parser, ["--watch"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.watch, true);
      assert.equal(result.value.verbose, false);
    }
  });

  describe("getDocFragments", () => {
    it("should return fragments from all child parsers without label", () => {
      const parser = object({
        verbose: option("-v", "--verbose"),
        port: option("-p", "--port", integer()),
        file: argument(string({ metavar: "FILE" })),
      });

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      // Should have a section containing all entries
      assert.ok(fragments.fragments.length > 0);
      assert.ok(fragments.fragments.some((f) => f.type === "section"));

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const mainSection = sections.find((s) => s.title === undefined);
      assert.ok(mainSection);
      assert.equal(mainSection.entries.length, 3);
    });

    it("should return labeled section when label is provided", () => {
      const parser = object("Configuration", {
        verbose: option("-v", "--verbose"),
        port: option("-p", "--port", integer()),
      });

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const labeledSection = sections.find((s) => s.title === "Configuration");
      assert.ok(labeledSection);
      assert.equal(labeledSection.entries.length, 2);
    });

    it("should pass default values to child parsers", () => {
      const parser = object({
        verbose: option("-v", "--verbose"),
        port: option("-p", "--port", integer()),
      });

      const defaultValues = { verbose: true, port: 8080 };
      const fragments = parser.getDocFragments(
        { kind: "available", state: parser.initialState },
        defaultValues,
      );

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const mainSection = sections.find((s) => s.title === undefined);
      assert.ok(mainSection);

      const portEntry = mainSection.entries.find((e: DocEntry) =>
        e.term.type === "option" && e.term.names.includes("--port")
      );
      assert.ok(portEntry);
      assert.deepEqual(portEntry.default, message`${"8080"}`);

      // Boolean flags should not have default values shown
      const verboseEntry = mainSection.entries.find((e: DocEntry) =>
        e.term.type === "option" && e.term.names.includes("--verbose")
      );
      assert.ok(verboseEntry);
      assert.equal(verboseEntry.default, undefined);
    });

    it("should handle nested sections properly", () => {
      const nestedParser = object("Nested", {
        flag: option("-f"),
      });

      const parser = object({
        simple: option("-s"),
        nested: nestedParser,
      });

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      // Should have sections for both the main object and the nested one
      assert.ok(sections.length >= 1);
    });

    it("should work with empty object", () => {
      const parser = object({});
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const mainSection = sections.find((s) => s.title === undefined);
      assert.ok(mainSection);
      assert.equal(mainSection.entries.length, 0);
    });

    it("should preserve child parser options and descriptions", () => {
      const description = message`Enable verbose output`;
      const parser = object({
        verbose: option("-v", "--verbose", { description }),
        port: option("-p", "--port", integer()),
      });

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const mainSection = sections.find((s) => s.title === undefined);
      assert.ok(mainSection);

      const verboseEntry = mainSection.entries.find((e: DocEntry) =>
        e.term.type === "option" && e.term.names.includes("--verbose")
      );
      assert.ok(verboseEntry);
      assert.deepEqual(verboseEntry.description, description);
    });
  });
});

describe("tuple", () => {
  it("should create a parser with array-based API", () => {
    const parser = tuple([
      option("-v", "--verbose"),
      option("-p", "--port", integer()),
    ]);

    assert.ok(parser.priority >= 10);
    assert.ok(Array.isArray(parser.initialState));
    assert.equal(parser.initialState.length, 2);
  });

  it("should parse parsers sequentially in array order", () => {
    const parser = tuple([
      option("-n", "--name", string()),
      option("-v", "--verbose"),
    ]);

    const result = parse(parser, ["-n", "Alice", "-v"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["Alice", true]);
    }
  });

  it("should work with labeled tuples", () => {
    const parser = tuple("User Data", [
      option("-n", "--name", string()),
      option("-v", "--verbose"),
    ]);

    const result = parse(parser, ["-n", "Bob", "-v"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["Bob", true]);
    }
  });

  it("should handle empty tuple", () => {
    const parser = tuple([]);

    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 0);
    }
  });

  it("should work with optional parsers", () => {
    const parser = tuple([
      option("-n", "--name", string()),
      optional(option("-a", "--age", integer())),
      option("-v", "--verbose"),
    ]);

    const result1 = parse(parser, ["-n", "Alice", "-a", "30", "-v"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.deepEqual(result1.value, ["Alice", 30, true]);
    }

    const result2 = parse(parser, ["-n", "Bob", "-v"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.deepEqual(result2.value, ["Bob", undefined, true]);
    }
  });

  it("should work with arguments first, then options", () => {
    const parser = tuple([
      argument(string()),
      option("-v", "--verbose"),
      option("-o", "--output", string()),
    ]);

    const result = parse(parser, ["input.txt", "-v", "-o", "output.txt"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["input.txt", true, "output.txt"]);
    }
  });

  it("should work with multiple arguments and options mixed", () => {
    const parser = tuple([
      argument(string()),
      argument(string()),
      option("-v", "--verbose"),
    ]);

    const result = parse(parser, ["file1.txt", "file2.txt", "-v"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["file1.txt", "file2.txt", true]);
    }
  });

  it("should handle argument-option-argument pattern", () => {
    const parser = tuple([
      argument(string()),
      option("-t", "--type", string()),
      argument(string()),
    ]);

    const result = parse(parser, ["input.txt", "-t", "json", "output.txt"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["input.txt", "json", "output.txt"]);
    }
  });

  it("should fail when argument parser cannot find expected argument", () => {
    const parser = tuple([
      argument(string()),
      option("-v", "--verbose"),
    ]);

    // No arguments provided, should fail on first argument parser
    const result = parse(parser, ["-v"]);
    assert.ok(!result.success);
  });

  it("should work with complex argument and option combinations", () => {
    // CLI pattern: command input_file --format json --verbose output_file
    const parser = tuple([
      argument(string({ metavar: "COMMAND" })),
      argument(string({ metavar: "INPUT" })),
      option("-f", "--format", string()),
      option("-v", "--verbose"),
      argument(string({ metavar: "OUTPUT" })),
    ]);

    const result = parse(parser, [
      "convert",
      "input.md",
      "-f",
      "json",
      "-v",
      "output.json",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, [
        "convert",
        "input.md",
        "json",
        true,
        "output.json",
      ]);
    }
  });

  describe("getDocFragments", () => {
    it("should return fragments from all child parsers", () => {
      const parser = tuple([
        option("-v", "--verbose"),
        option("-p", "--port", integer()),
        argument(string({ metavar: "FILE" })),
      ]);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      // Should have a section containing all entries
      assert.ok(fragments.fragments.length > 0);
      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const mainSection = sections.find((s) => s.title === undefined);
      assert.ok(mainSection);
      assert.equal(mainSection.entries.length, 3);
    });

    it("should return labeled section when label is provided", () => {
      const parser = tuple("Command Args", [
        option("-v", "--verbose"),
        argument(string({ metavar: "FILE" })),
      ]);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const labeledSection = sections.find((s) => s.title === "Command Args");
      assert.ok(labeledSection);
      assert.equal(labeledSection.entries.length, 2);
    });

    it("should pass default values to child parsers", () => {
      const parser = tuple([
        option("-v", "--verbose"),
        option("-p", "--port", integer()),
        argument(string({ metavar: "FILE" })),
      ]);

      const defaultValues = [true, 8080, "input.txt"] as const;
      const fragments = parser.getDocFragments(
        parser.initialState === undefined
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: parser.initialState },
        defaultValues,
      );

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const mainSection = sections.find((s) => s.title === undefined);
      assert.ok(mainSection);

      const portEntry = mainSection.entries.find((e: DocEntry) =>
        e.term.type === "option" && e.term.names.includes("--port")
      );
      const fileEntry = mainSection.entries.find((e: DocEntry) =>
        e.term.type === "argument"
      );

      assert.ok(portEntry);
      assert.ok(fileEntry);
      assert.deepEqual(portEntry.default, message`${"8080"}`);
      assert.deepEqual(fileEntry.default, message`${"input.txt"}`);
    });

    it("should handle empty tuple", () => {
      const parser = tuple([]);
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const mainSection = sections.find((s) => s.title === undefined);
      assert.ok(mainSection);
      assert.equal(mainSection.entries.length, 0);
    });

    it("should handle nested sections properly", () => {
      const nestedParser = object("Nested Options", {
        flag: option("-f"),
      });

      const parser = tuple([
        option("-v", "--verbose"),
        nestedParser,
      ]);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      // Should have sections for both the main tuple and the nested object
      assert.ok(sections.length >= 1);
    });

    it("should preserve child parser options and descriptions", () => {
      const description = message`Enable verbose output`;
      const parser = tuple([
        option("-v", "--verbose", { description }),
        option("-p", "--port", integer()),
      ]);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const mainSection = sections.find((s) => s.title === undefined);
      assert.ok(mainSection);

      const verboseEntry = mainSection.entries.find((e: DocEntry) =>
        e.term.type === "option" && e.term.names.includes("--verbose")
      );
      assert.ok(verboseEntry);
      assert.deepEqual(verboseEntry.description, description);
    });

    it("should work with mixed parser types", () => {
      const parser = tuple([
        argument(string({ metavar: "COMMAND" })),
        option("-f", "--format", string()),
        argument(string({ metavar: "INPUT" })),
        option("-v", "--verbose"),
        argument(string({ metavar: "OUTPUT" })),
      ]);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const mainSection = sections.find((s) => s.title === undefined);
      assert.ok(mainSection);
      assert.equal(mainSection.entries.length, 5);

      // Check that we have both options and arguments
      const hasOptions = mainSection.entries.some((e: DocEntry) =>
        e.term.type === "option"
      );
      const hasArguments = mainSection.entries.some((e: DocEntry) =>
        e.term.type === "argument"
      );
      assert.ok(hasOptions && hasArguments);
    });
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

  it("should propagate failed parse results correctly", () => {
    const baseParser = option("-v", "--verbose");
    const optionalParser = optional(baseParser);

    const context = {
      buffer: ["--help"] as readonly string[],
      state: optionalParser.initialState,
      optionsTerminated: false,
    };

    const parseResult = optionalParser.parse(context);
    assert.ok(!parseResult.success);
    if (!parseResult.success) {
      assert.equal(parseResult.consumed, 0);
      assertErrorIncludes(parseResult.error, "No matched option");
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
    };

    const parseResult = optionalParser.parse(context);
    assert.ok(!parseResult.success);
    if (!parseResult.success) {
      assert.equal(parseResult.consumed, 0);
      assertErrorIncludes(parseResult.error, "No more options can be parsed");
    }
  });

  it("should work with bundled short options through wrapped parser", () => {
    const baseParser = option("-v");
    const optionalParser = optional(baseParser);

    const context = {
      buffer: ["-vd"] as readonly string[],
      state: optionalParser.initialState,
      optionsTerminated: false,
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

  it("should propagate failed parse results correctly", () => {
    const baseParser = option("-v", "--verbose");
    const defaultParser = withDefault(baseParser, false);

    const context = {
      buffer: ["--help"] as readonly string[],
      state: defaultParser.initialState,
      optionsTerminated: false,
    };

    const parseResult = defaultParser.parse(context);
    assert.ok(!parseResult.success);
    if (!parseResult.success) {
      assert.equal(parseResult.consumed, 0);
      assertErrorIncludes(parseResult.error, "No matched option");
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

describe("or", () => {
  it("should try parsers in order", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const orParser = or(parser1, parser2);

    assert.equal(orParser.initialState, undefined);
    assert.equal(
      orParser.priority,
      Math.max(parser1.priority, parser2.priority),
    );
  });

  it("should succeed with first matching parser", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const orParser = or(parser1, parser2);

    const result = parse(orParser, ["-a"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, true);
    }
  });

  it("should succeed with second parser when first fails", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const orParser = or(parser1, parser2);

    const result = parse(orParser, ["-b"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, true);
    }
  });

  it("should fail when no parser matches", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const orParser = or(parser1, parser2);

    const result = parse(orParser, ["-c"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Unexpected option or subcommand");
    }
  });

  it("should detect mutually exclusive options", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const orParser = or(parser1, parser2);

    const result = parse(orParser, ["-a", "-b"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "cannot be used together");
    }
  });

  it("should complete with successful parser result", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const orParser = or(parser1, parser2);

    const result = parse(orParser, ["-a"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, true);
    }
  });

  it("should work with more than two parsers", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const parser3 = option("-c");
    const orParser = or(parser1, parser2, parser3);

    const resultA = parse(orParser, ["-a"]);
    assert.ok(resultA.success);

    const resultB = parse(orParser, ["-b"]);
    assert.ok(resultB.success);

    const resultC = parse(orParser, ["-c"]);
    assert.ok(resultC.success);
  });

  describe("getDocFragments", () => {
    it("should return fragments from all parsers when state is undefined", () => {
      const parser1 = option("-a", "--apple");
      const parser2 = option("-b", "--banana");
      const orParser = or(parser1, parser2);

      const fragments = orParser.getDocFragments({
        kind: "unavailable" as const,
      });

      // Should return sections with entries from all parsers
      assert.ok(fragments.fragments.length > 0);
      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      assert.ok(sections.length > 0);

      // Check that entries from multiple parsers are included
      const allEntries = sections.flatMap((s) => s.entries);
      assert.ok(allEntries.length >= 2);
    });

    it("should return fragments from matched parser when state is defined", () => {
      const parser1 = option("-a", "--apple");
      const parser2 = option("-b", "--banana");
      const orParser = or(parser1, parser2);

      // Simulate state where first parser (index 0) matched
      const state = [0, {
        success: true,
        next: { state: { success: true, value: true } },
        consumed: ["-a"],
      }] as const;
      const fragments = orParser.getDocFragments(
        state as unknown as Parameters<typeof orParser.getDocFragments>[0],
      );

      // Should return fragments from the matched parser
      assert.ok(fragments.fragments.length > 0);
      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      assert.ok(sections.length > 0);
    });

    it("should work with different parser types", () => {
      const parser1 = option("-v", "--verbose");
      const parser2 = argument(string({ metavar: "FILE" }));
      const orParser = or(parser1, parser2);

      const fragments = orParser.getDocFragments({
        kind: "unavailable" as const,
      });

      assert.ok(fragments.fragments.length > 0);
      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      assert.ok(sections.length > 0);

      const allEntries = sections.flatMap((s) => s.entries);
      // Should have entries from both option and argument parsers
      const hasOption = allEntries.some((e: DocEntry) =>
        e.term.type === "option"
      );
      const hasArgument = allEntries.some((e: DocEntry) =>
        e.term.type === "argument"
      );
      assert.ok(hasOption && hasArgument);
    });

    it("should preserve descriptions from child parsers", () => {
      const description1 = message`Enable verbose mode`;
      const description2 = message`Run in quiet mode`;
      const parser1 = option("-v", "--verbose", { description: description1 });
      const parser2 = option("-q", "--quiet", { description: description2 });
      const orParser = or(parser1, parser2);

      const fragments = orParser.getDocFragments({
        kind: "unavailable" as const,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const allEntries = sections.flatMap((s) => s.entries);

      const verboseEntry = allEntries.find((e: DocEntry) =>
        e.term.type === "option" && e.term.names.includes("--verbose")
      );
      const quietEntry = allEntries.find((e: DocEntry) =>
        e.term.type === "option" && e.term.names.includes("--quiet")
      );

      assert.ok(verboseEntry);
      assert.ok(quietEntry);
      assert.deepEqual(verboseEntry.description, description1);
      assert.deepEqual(quietEntry.description, description2);
    });

    it("should work with three or more parsers", () => {
      const parser1 = option("-a");
      const parser2 = option("-b");
      const parser3 = option("-c");
      const orParser = or(parser1, parser2, parser3);

      const fragments = orParser.getDocFragments({
        kind: "unavailable" as const,
      });

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const allEntries = sections.flatMap((s) => s.entries);

      // Should have entries from all three parsers
      assert.ok(allEntries.length >= 3);
      assert.ok(
        allEntries.some((e: DocEntry) =>
          e.term.type === "option" && e.term.names?.includes("-a")
        ),
      );
      assert.ok(
        allEntries.some((e: DocEntry) =>
          e.term.type === "option" && e.term.names?.includes("-b")
        ),
      );
      assert.ok(
        allEntries.some((e: DocEntry) =>
          e.term.type === "option" && e.term.names?.includes("-c")
        ),
      );
    });

    it("should handle nested sections properly", () => {
      const nestedParser1 = object("Group A", { flag: option("-a") });
      const nestedParser2 = object("Group B", { flag: option("-b") });
      const orParser = or(nestedParser1, nestedParser2);

      const fragments = orParser.getDocFragments({
        kind: "unavailable" as const,
      });

      // Should have sections from nested parsers
      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      assert.ok(sections.length > 0);
    });
  });
});

describe("parse", () => {
  it("should parse simple option successfully", () => {
    const parser = option("-v");
    const result = parse(parser, ["-v"]);

    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, true);
    }
  });

  it("should parse option with value", () => {
    const parser = option("--port", integer());
    const result = parse(parser, ["--port", "8080"]);

    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, 8080);
    }
  });

  it("should fail on invalid input", () => {
    const parser = option("-v");
    const result = parse(parser, ["--help"]);

    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "No matched option");
    }
  });

  it("should fail when parser completion fails", () => {
    const parser = option("--port", integer({ min: 1 }));
    const result = parse(parser, ["--port", "0"]);

    assert.ok(!result.success);
  });

  it("should handle empty arguments", () => {
    const parser = option("-v");
    const result = parse(parser, []);

    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Expected an option");
    }
  });

  it("should process all arguments", () => {
    const parser = object({
      verbose: option("-v"),
      port: option("-p", integer()),
    });

    const result = parse(parser, ["-v", "-p", "8080"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.port, 8080);
    }
  });

  it("should handle options terminator", () => {
    const parser = object({
      verbose: option("-v"),
    });

    const result = parse(parser, ["-v", "--"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
    }
  });
});

describe("merge", () => {
  it("should create a parser that combines multiple object parsers", () => {
    const parser1 = object({
      verbose: option("-v", "--verbose"),
      port: option("-p", "--port", integer()),
    });

    const parser2 = object({
      host: option("-h", "--host", string()),
      debug: option("-d", "--debug"),
    });

    const mergedParser = merge(parser1, parser2);

    assert.ok(mergedParser.priority >= 10);
    assert.ok("verbose" in mergedParser.initialState);
    assert.ok("port" in mergedParser.initialState);
    assert.ok("host" in mergedParser.initialState);
    assert.ok("debug" in mergedParser.initialState);
  });

  it("should merge two object parsers successfully", () => {
    const basicOptions = object({
      verbose: option("-v", "--verbose"),
      quiet: option("-q", "--quiet"),
    });

    const serverOptions = object({
      port: option("-p", "--port", integer()),
      host: option("-h", "--host", string()),
    });

    const parser = merge(basicOptions, serverOptions);

    const result = parse(parser, ["-v", "-p", "8080", "-h", "localhost"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.quiet, false);
      assert.equal(result.value.port, 8080);
      assert.equal(result.value.host, "localhost");
    }
  });

  it("should merge three object parsers", () => {
    const group1 = object({
      option1: option("-1", string()),
    });

    const group2 = object({
      option2: option("-2", integer()),
    });

    const group3 = object({
      option3: option("-3"),
    });

    const parser = merge(group1, group2, group3);

    const result = parse(parser, ["-1", "test", "-2", "42", "-3"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.option1, "test");
      assert.equal(result.value.option2, 42);
      assert.equal(result.value.option3, true);
    }
  });

  it("should merge four object parsers", () => {
    const a = object({ a: option("-a") });
    const b = object({ b: option("-b") });
    const c = object({ c: option("-c") });
    const d = object({ d: option("-d") });

    const parser = merge(a, b, c, d);

    const result = parse(parser, ["-a", "-b", "-c", "-d"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.a, true);
      assert.equal(result.value.b, true);
      assert.equal(result.value.c, true);
      assert.equal(result.value.d, true);
    }
  });

  it("should merge five object parsers", () => {
    const a = object({ a: option("-a") });
    const b = object({ b: option("-b") });
    const c = object({ c: option("-c") });
    const d = object({ d: option("-d") });
    const e = object({ e: option("-e") });

    const parser = merge(a, b, c, d, e);

    const result = parse(parser, ["-a", "-b", "-c", "-d", "-e"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.a, true);
      assert.equal(result.value.b, true);
      assert.equal(result.value.c, true);
      assert.equal(result.value.d, true);
      assert.equal(result.value.e, true);
    }
  });

  it("should handle empty initial states correctly", () => {
    const parser1 = object({
      flag1: option("-1"),
    });

    const parser2 = object({
      flag2: option("-2"),
    });

    const mergedParser = merge(parser1, parser2);

    const result = parse(mergedParser, ["-1"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.flag1, true);
      assert.equal(result.value.flag2, false);
    }
  });

  it("should propagate parser errors correctly", () => {
    const parser1 = object({
      port: option("-p", "--port", integer({ min: 1, max: 0xffff })),
    });

    const parser2 = object({
      host: option("-h", "--host", string()),
    });

    const parser = merge(parser1, parser2);

    const result = parse(parser, ["-p", "0", "-h", "localhost"]);
    assert.ok(!result.success);
  });

  it("should handle value parser failures in merged parsers", () => {
    const parser1 = object({
      number: option("-n", integer({ min: 10 })),
    });

    const parser2 = object({
      text: option("-t", string({ pattern: /^[A-Z]+$/ })),
    });

    const parser = merge(parser1, parser2);

    const invalidNumberResult = parse(parser, ["-n", "5"]);
    assert.ok(!invalidNumberResult.success);

    const invalidTextResult = parse(parser, ["-t", "lowercase"]);
    assert.ok(!invalidTextResult.success);
  });

  it("should handle parsers with different priorities", () => {
    const lowPriority = object({
      arg: argument(string()),
    });

    const highPriority = object({
      option: option("-o", string()),
    });

    const parser = merge(lowPriority, highPriority);

    assert.equal(
      parser.priority,
      Math.max(lowPriority.priority, highPriority.priority),
    );

    const result = parse(parser, ["-o", "value", "argument"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.option, "value");
      assert.equal(result.value.arg, "argument");
    }
  });

  it("should work with different value types", () => {
    const stringOptions = object({
      name: option("-n", "--name", string()),
      title: option("-t", "--title", string()),
    });

    const numberOptions = object({
      port: option("-p", "--port", integer()),
      count: option("-c", "--count", integer()),
    });

    const booleanOptions = object({
      verbose: option("-v", "--verbose"),
      debug: option("-d", "--debug"),
    });

    const parser = merge(stringOptions, numberOptions, booleanOptions);

    const result = parse(parser, [
      "-n",
      "test",
      "-p",
      "8080",
      "-v",
      "-c",
      "5",
      "-t",
      "My Title",
      "-d",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.name, "test");
      assert.equal(result.value.title, "My Title");
      assert.equal(result.value.port, 8080);
      assert.equal(result.value.count, 5);
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.debug, true);
    }
  });

  it("should handle mixed option and argument parsers", () => {
    const options = object({
      verbose: option("-v"),
      output: option("-o", string()),
    });

    const args = object({
      input: argument(string()),
    });

    const parser = merge(options, args);

    const result = parse(parser, ["-v", "-o", "out.txt", "input.txt"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.output, "out.txt");
      assert.equal(result.value.input, "input.txt");
    }
  });

  it("should handle overlapping field names by using last parser's state", () => {
    const parser1 = object({
      value: option("-1", string()),
    });

    const parser2 = object({
      value: option("-2", integer()),
    });

    const parser = merge(parser1, parser2);

    const result1 = parse(parser, ["-1", "hello"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.value, "hello");
    }

    const result2 = parse(parser, ["-2", "42"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.value, 42);
    }
  });

  it("should handle parsing when no input matches", () => {
    const parser1 = object({
      flag1: option("-1"),
    });

    const parser2 = object({
      flag2: option("-2"),
    });

    const parser = merge(parser1, parser2);

    const context = {
      buffer: ["-3"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
    };

    const result = parser.parse(context);
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(result.consumed, 0);
      assertErrorIncludes(result.error, "No parser matched the input");
    }
  });

  it("should complete successfully when all parsers complete", () => {
    const parser1 = object({
      flag1: option("-1"),
    });

    const parser2 = object({
      port: option("-p", integer()),
    });

    const parser = merge(parser1, parser2);

    // First test with actual parsing
    const result = parse(parser, ["-1", "-p", "8080"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.flag1, true);
      assert.equal(result.value.port, 8080);
    }
  });

  it("should fail completion when any parser fails", () => {
    const parser1 = object({
      flag1: option("-1"),
    });

    const parser2 = object({
      port: option("-p", integer({ min: 1 })),
    });

    const parser = merge(parser1, parser2);

    // Test with actual invalid parsing
    const result = parse(parser, ["-1", "-p", "0"]);
    assert.ok(!result.success);
  });

  it("should work in or() combinations", () => {
    const basicMode = merge(
      object({ basic: constant("basic") }),
      object({ flag: option("-f") }),
    );

    const advancedMode = merge(
      object({ advanced: constant("advanced") }),
      object({ value: option("-v", integer()) }),
    );

    const parser = or(basicMode, advancedMode);

    const basicResult = parse(parser, ["-f"]);
    assert.ok(basicResult.success);
    if (basicResult.success) {
      if ("basic" in basicResult.value) {
        assert.equal(basicResult.value.basic, "basic");
        assert.equal(basicResult.value.flag, true);
      }
    }

    const advancedResult = parse(parser, ["-v", "42"]);
    assert.ok(advancedResult.success);
    if (advancedResult.success) {
      if ("advanced" in advancedResult.value) {
        assert.equal(advancedResult.value.advanced, "advanced");
        assert.equal(advancedResult.value.value, 42);
      }
    }
  });

  it("should handle complex nested scenarios", () => {
    const serverOptions = object({
      port: option("-p", "--port", integer()),
      host: option("-h", "--host", string()),
    });

    const logOptions = object({
      verbose: option("-v", "--verbose"),
      logFile: option("-l", "--log-file", string()),
    });

    const authOptions = object({
      token: option("-t", "--token", string()),
      user: option("-u", "--user", string()),
    });

    const parser = merge(serverOptions, logOptions, authOptions);

    const result = parse(parser, [
      "-p",
      "8080",
      "-h",
      "localhost",
      "-v",
      "-l",
      "app.log",
      "-t",
      "secret123",
      "-u",
      "admin",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.port, 8080);
      assert.equal(result.value.host, "localhost");
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.logFile, "app.log");
      assert.equal(result.value.token, "secret123");
      assert.equal(result.value.user, "admin");
    }
  });

  it("should handle options terminator correctly", () => {
    const options1 = object({
      flag: option("-f"),
    });

    const options2 = object({
      args: multiple(argument(string())),
    });

    const parser = merge(options1, options2);

    const result = parse(parser, ["-f", "--", "-not-an-option"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.flag, true);
      assert.deepEqual(result.value.args, ["-not-an-option"]);
    }
  });

  it("should reproduce example.ts usage pattern", () => {
    const group3 = object("Group 3", {
      type: constant("group34"),
      deny: option("-d", "--deny"),
      test: option("-t", "--test", integer()),
    });

    const group4 = object("Group 4", {
      baz: option("-z", "--baz"),
      qux: option("-q", "--qux", string({ metavar: "QUX" })),
    });

    const parser = merge(group3, group4);

    const result = parse(parser, ["-d", "-t", "42", "-z", "-q", "value"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.type, "group34");
      assert.equal(result.value.deny, true);
      assert.equal(result.value.test, 42);
      assert.equal(result.value.baz, true);
      assert.equal(result.value.qux, "value");
    }
  });

  it("should handle state updates and transitions correctly", () => {
    const parser1 = object({
      opt1: option("-1", string()),
    });

    const parser2 = object({
      opt2: option("-2", integer()),
    });

    const parser = merge(parser1, parser2);

    // Test sequential parsing
    const result = parse(parser, ["-1", "hello", "-2", "42"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.opt1, "hello");
      assert.equal(result.value.opt2, 42);
    }
  });

  it("should handle parsing failures with proper error propagation", () => {
    const parser1 = object({
      required: option("-r", string()),
    });

    const parser2 = object({
      number: option("-n", integer()),
    });

    const parser = merge(parser1, parser2);

    const context = {
      buffer: ["--unknown"] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
    };

    const result = parser.parse(context);
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(result.consumed, 0);
      assertErrorIncludes(result.error, "No parser matched the input");
    }
  });

  it("should handle empty parsers gracefully", () => {
    const empty1 = object({});
    const empty2 = object({});

    const parser = merge(empty1, empty2);

    // Empty parsers succeed when there is no input since all parsers can complete
    const result = parse(parser, []);
    assert.ok(result.success);
  });

  it("should work with optional parsers in merged objects", () => {
    const required = object({
      name: option("-n", string()),
    });

    const optionalFields = object({
      age: optional(option("-a", integer())),
      email: optional(option("-e", string())),
    });

    const parser = merge(required, optionalFields);

    const withOptionalResult = parse(parser, ["-n", "John", "-a", "30"]);
    assert.ok(withOptionalResult.success);
    if (withOptionalResult.success) {
      assert.equal(withOptionalResult.value.name, "John");
      assert.equal(withOptionalResult.value.age, 30);
      assert.equal(withOptionalResult.value.email, undefined);
    }

    const withoutOptionalResult = parse(parser, ["-n", "Jane"]);
    assert.ok(withoutOptionalResult.success);
    if (withoutOptionalResult.success) {
      assert.equal(withoutOptionalResult.value.name, "Jane");
      assert.equal(withoutOptionalResult.value.age, undefined);
      assert.equal(withoutOptionalResult.value.email, undefined);
    }
  });

  it("should work with multiple parsers in merged objects", () => {
    const single = object({
      name: option("-n", string()),
    });

    const multipleFields = object({
      tags: multiple(option("-t", string())),
      files: multiple(argument(string())),
    });

    const parser = merge(single, multipleFields);

    const result = parse(parser, [
      "-n",
      "MyApp",
      "-t",
      "dev",
      "-t",
      "webapp",
      "file1.txt",
      "file2.txt",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.name, "MyApp");
      assert.deepEqual(result.value.tags, ["dev", "webapp"]);
      assert.deepEqual(result.value.files, ["file1.txt", "file2.txt"]);
    }
  });

  it("should handle type safety correctly", () => {
    const stringParser = object({
      text: option("-t", string()),
    });

    const numberParser = object({
      count: option("-c", integer()),
    });

    const booleanParser = object({
      flag: option("-f"),
    });

    const parser = merge(stringParser, numberParser, booleanParser);

    const result = parse(parser, ["-t", "hello", "-c", "42", "-f"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(typeof result.value.text, "string");
      assert.equal(result.value.text, "hello");
      assert.equal(typeof result.value.count, "number");
      assert.equal(result.value.count, 42);
      assert.equal(typeof result.value.flag, "boolean");
      assert.equal(result.value.flag, true);
    }
  });

  describe("getDocFragments", () => {
    it("should delegate to constituent parsers and organize fragments", () => {
      const parser1 = object({
        flag: option("-f", "--flag"),
      });
      const parser2 = object({
        value: option("-v", "--value", string()),
      });
      const parser = merge(parser1, parser2);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      const section = fragments.fragments[0];
      assert.equal(section.type, "section");
      assert.equal(section.title, undefined);
      assert.equal(section.entries.length, 2);

      // Check that both parsers' entries are included
      const flagEntry = section.entries.find((e) =>
        e.term.type === "option" && e.term.names.includes("-f")
      );
      const valueEntry = section.entries.find((e) =>
        e.term.type === "option" && e.term.names.includes("-v")
      );
      assert.ok(flagEntry);
      assert.ok(valueEntry);
    });

    it("should handle parsers with titled sections", () => {
      const parser1 = object({
        flag: option("-f", "--flag", { description: message`A flag option` }),
      });
      const parser2 = object({
        value: option("-v", "--value", string(), {
          description: message`A value option`,
        }),
      });
      const parser = merge(parser1, parser2);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      const section = fragments.fragments[0];
      assert.equal(section.type, "section");
      assert.equal(section.title, undefined);
      assert.equal(section.entries.length, 2);
    });

    it("should merge entries from sections without titles", () => {
      const parser1 = object({
        flag1: option("-1", "--flag1"),
        flag2: option("-2", "--flag2"),
      });
      const parser2 = object({
        value1: option("-v", "--value1", string()),
        value2: option("-w", "--value2", string()),
      });
      const parser = merge(parser1, parser2);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      const section = fragments.fragments[0];
      assert.equal(section.type, "section");
      assert.equal(section.title, undefined);
      assert.equal(section.entries.length, 4);
    });

    it("should handle complex state with proper initial state", () => {
      const parser1 = object({
        flag: option("-f", "--flag"),
      });
      const parser2 = object({
        value: option("-v", "--value", string()),
      });
      const parser = merge(parser1, parser2);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      const section = fragments.fragments[0];
      assert.equal(section.type, "section");
      assert.equal(section.title, undefined);
      assert.equal(section.entries.length, 2);
    });

    it("should handle simple case with two parsers", () => {
      const parser1 = object({ flag1: option("-1") });
      const parser2 = object({ flag2: option("-2") });
      const parser = merge(parser1, parser2);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      const section = fragments.fragments[0];
      assert.equal(section.type, "section");
      assert.equal(section.title, undefined);
      assert.equal(section.entries.length, 2);
    });

    it("should handle parsers with mixed documentation patterns", () => {
      const simpleParser = object({
        simple: option("-s", "--simple"),
      });
      const detailedParser = object({
        detailed: option("-d", "--detailed", string(), {
          description: message`A detailed option with description`,
        }),
      });
      const argumentParser = object({
        arg: argument(string()),
      });
      const parser = merge(simpleParser, detailedParser, argumentParser);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      const section = fragments.fragments[0];
      assert.equal(section.type, "section");
      assert.equal(section.title, undefined);
      assert.equal(section.entries.length, 3);

      // Check that all different types of entries are present
      const simpleEntry = section.entries.find((e) =>
        e.term.type === "option" && e.term.names.includes("-s")
      );
      const detailedEntry = section.entries.find((e) =>
        e.term.type === "option" && e.term.names.includes("-d")
      );
      const argEntry = section.entries.find((e) => e.term.type === "argument");

      assert.ok(simpleEntry);
      assert.ok(detailedEntry);
      assert.ok(argEntry);
    });
  });

  describe("labeled merge", () => {
    it("should support label as first parameter for merge()", () => {
      const parser1 = object({
        verbose: option("-v", "--verbose"),
        port: option("-p", "--port", integer()),
      });
      const parser2 = object({
        host: option("-h", "--host", string()),
        debug: option("-d", "--debug"),
      });
      const mergedParser = merge("Server Options", parser1, parser2);

      assert.ok(mergedParser.priority >= 10);
      assert.ok("verbose" in mergedParser.initialState);
      assert.ok("port" in mergedParser.initialState);
      assert.ok("host" in mergedParser.initialState);
      assert.ok("debug" in mergedParser.initialState);
    });

    it("should parse correctly with labeled merge", () => {
      const basicOptions = object({
        verbose: option("-v", "--verbose"),
        quiet: option("-q", "--quiet"),
      });
      const serverOptions = object({
        port: option("-p", "--port", integer()),
        host: option("-h", "--host", string()),
      });
      const parser = merge("Configuration", basicOptions, serverOptions);

      const result = parse(parser, ["-v", "-p", "8080", "-h", "localhost"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.verbose, true);
        assert.equal(result.value.quiet, false);
        assert.equal(result.value.port, 8080);
        assert.equal(result.value.host, "localhost");
      }
    });

    it("should include label in documentation fragments", () => {
      const group1 = object({
        option1: option("-1", "--opt1", string()),
        option2: option("-2", "--opt2"),
      });
      const group2 = object({
        option3: option("-3", "--opt3", integer()),
        option4: option("-4", "--opt4"),
      });

      const parser = merge("Combined Options", group1, group2);
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      // Should have at least one section with the label
      const labeledSection = fragments.fragments.find(
        (f) => f.type === "section" && f.title === "Combined Options",
      );
      assert.ok(labeledSection);

      // The labeled section should contain entries from both parsers
      if (labeledSection && labeledSection.type === "section") {
        const hasOpt1 = labeledSection.entries.some(
          (e) => e.term.type === "option" && e.term.names.includes("--opt1"),
        );
        const hasOpt3 = labeledSection.entries.some(
          (e) => e.term.type === "option" && e.term.names.includes("--opt3"),
        );
        assert.ok(
          hasOpt1 ||
            fragments.fragments.some((f) =>
              f.type === "section" && f.entries.some(
                (e) =>
                  e.term.type === "option" && e.term.names.includes("--opt1"),
              )
            ),
        );
        assert.ok(
          hasOpt3 ||
            fragments.fragments.some((f) =>
              f.type === "section" && f.entries.some(
                (e) =>
                  e.term.type === "option" && e.term.names.includes("--opt3"),
              )
            ),
        );
      }
    });

    it("should work with three parsers and a label", () => {
      const p1 = object({ a: option("-a", string()) });
      const p2 = object({ b: option("-b", integer()) });
      const p3 = object({ c: option("-c") });

      const parser = merge("All Options", p1, p2, p3);
      const result = parse(parser, ["-a", "test", "-b", "42", "-c"]);

      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.a, "test");
        assert.equal(result.value.b, 42);
        assert.equal(result.value.c, true);
      }
    });

    it("should work with up to 10 parsers with label", () => {
      const p0 = object({ opt0: option("-0") });
      const p1 = object({ opt1: option("-1") });
      const p2 = object({ opt2: option("-2") });
      const p3 = object({ opt3: option("-3") });
      const p4 = object({ opt4: option("-4") });
      const p5 = object({ opt5: option("-5") });
      const p6 = object({ opt6: option("-6") });
      const p7 = object({ opt7: option("-7") });
      const p8 = object({ opt8: option("-8") });
      const p9 = object({ opt9: option("-9") });

      const merged = merge(
        "Many Options",
        p0,
        p1,
        p2,
        p3,
        p4,
        p5,
        p6,
        p7,
        p8,
        p9,
      );
      const args = ["-0", "-1", "-2", "-3", "-4", "-5", "-6", "-7", "-8", "-9"];
      const result = parse(merged, args);

      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.opt0, true);
        assert.equal(result.value.opt1, true);
        assert.equal(result.value.opt2, true);
        assert.equal(result.value.opt3, true);
        assert.equal(result.value.opt4, true);
        assert.equal(result.value.opt5, true);
        assert.equal(result.value.opt6, true);
        assert.equal(result.value.opt7, true);
        assert.equal(result.value.opt8, true);
        assert.equal(result.value.opt9, true);
      }
    });

    it("should preserve existing section labels from object parsers", () => {
      const group1 = object("Database", {
        dbHost: option("--db-host", string()),
        dbPort: option("--db-port", integer()),
      });
      const group2 = object("Server", {
        serverHost: option("--server-host", string()),
        serverPort: option("--server-port", integer()),
      });

      const parser = merge("Application Settings", group1, group2);
      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      // Should have the merge label section
      const appSection = fragments.fragments.find(
        (f) => f.type === "section" && f.title === "Application Settings",
      );
      assert.ok(appSection);

      // Should also preserve the original sections
      const dbSection = fragments.fragments.find(
        (f) => f.type === "section" && f.title === "Database",
      );
      const serverSection = fragments.fragments.find(
        (f) => f.type === "section" && f.title === "Server",
      );
      assert.ok(dbSection);
      assert.ok(serverSection);
    });
  });
});

describe("Integration tests", () => {
  it("should handle complex nested parser combinations", () => {
    const serverParser = object("Server", {
      port: option("-p", "--port", integer({ min: 1, max: 0xffff })),
      host: option("-h", "--host", string({ metavar: "HOST" })),
      verbose: option("-v", "--verbose"),
    });

    const clientParser = object("Client", {
      connect: option("-c", "--connect", string({ metavar: "URL" })),
      timeout: option("-t", "--timeout", integer({ min: 0 })),
      retry: option("-r", "--retry"),
    });

    const mainParser = or(serverParser, clientParser);

    const serverResult = parse(mainParser, [
      "--port",
      "8080",
      "--host",
      "localhost",
      "-v",
    ]);
    assert.ok(serverResult.success);
    if (serverResult.success) {
      if ("port" in serverResult.value) {
        assert.equal(serverResult.value.port, 8080);
        assert.equal(serverResult.value.host, "localhost");
        assert.equal(serverResult.value.verbose, true);
      } else {
        throw new Error("Expected server result");
      }
    }

    const clientResult = parse(mainParser, [
      "--connect",
      "ws://example.com",
      "--timeout",
      "5000",
    ]);
    assert.ok(clientResult.success);
    if (clientResult.success) {
      if ("connect" in clientResult.value) {
        assert.equal(clientResult.value.connect, "ws://example.com");
        assert.equal(clientResult.value.timeout, 5000);
        assert.equal(clientResult.value.retry, false);
      } else {
        throw new Error("Expected client result");
      }
    }
  });

  it("should enforce mutual exclusivity in complex scenarios", () => {
    const group1 = object("Group 1", {
      allow: option("-a", "--allow"),
      value: option("-v", "--value", integer()),
    });

    const group2 = object("Group 2", {
      foo: option("-f", "--foo"),
      bar: option("-b", "--bar", string({ metavar: "VALUE" })),
    });

    const parser = or(group1, group2);

    const conflictResult = parse(parser, ["--allow", "--foo"]);
    assert.ok(!conflictResult.success);
    if (!conflictResult.success) {
      assertErrorIncludes(conflictResult.error, "cannot be used together");
    }
  });

  it("should handle mixed option styles", () => {
    const parser = object({
      unixShort: option("-u"),
      unixLong: option("--unix-long"),
      dosStyle: option("/D"),
      plusStyle: option("+p"),
    });

    const result1 = parse(parser, ["-u", "--unix-long"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.unixShort, true);
      assert.equal(result1.value.unixLong, true);
      assert.equal(result1.value.dosStyle, false);
      assert.equal(result1.value.plusStyle, false);
    }

    const result2 = parse(parser, ["/D", "+p"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.dosStyle, true);
      assert.equal(result2.value.plusStyle, true);
      assert.equal(result2.value.unixShort, false);
      assert.equal(result2.value.unixLong, false);
    }
  });

  it("should handle bundled short options correctly", () => {
    const parser = object({
      verbose: option("-v"),
      debug: option("-d"),
      force: option("-f"),
    });

    const result = parse(parser, ["-vdf"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.debug, true);
      assert.equal(result.value.force, true);
    }
  });

  it("should validate value constraints in complex scenarios", () => {
    const parser = object({
      port: option("-p", integer({ min: 1024, max: 0xffff })),
      workers: option("-w", integer({ min: 1, max: 16 })),
      name: option("-n", string({ pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/ })),
    });

    const validResult = parse(parser, [
      "-p",
      "8080",
      "-w",
      "4",
      "-n",
      "myServer",
    ]);
    assert.ok(validResult.success);
    if (validResult.success) {
      assert.equal(validResult.value.port, 8080);
      assert.equal(validResult.value.workers, 4);
      assert.equal(validResult.value.name, "myServer");
    }

    const invalidPortResult = parse(parser, ["-p", "100"]);
    assert.ok(!invalidPortResult.success);

    const invalidNameResult = parse(parser, ["-n", "123invalid"]);
    assert.ok(!invalidNameResult.success);
  });

  it("should handle three-way mutually exclusive options", () => {
    const modeA = object("Mode A", { optionA: option("-a") });
    const modeB = object("Mode B", { optionB: option("-b") });
    const modeC = object("Mode C", { optionC: option("-c") });

    const parser = or(modeA, modeB, modeC);

    const resultA = parse(parser, ["-a"]);
    assert.ok(resultA.success);
    if (resultA.success && "optionA" in resultA.value) {
      assert.equal(resultA.value.optionA, true);
    }

    const resultB = parse(parser, ["-b"]);
    assert.ok(resultB.success);
    if (resultB.success && "optionB" in resultB.value) {
      assert.equal(resultB.value.optionB, true);
    }

    const resultC = parse(parser, ["-c"]);
    assert.ok(resultC.success);
    if (resultC.success && "optionC" in resultC.value) {
      assert.equal(resultC.value.optionC, true);
    }

    const conflictResult = parse(parser, ["-a", "-b"]);
    assert.ok(!conflictResult.success);
    if (!conflictResult.success) {
      assertErrorIncludes(conflictResult.error, "cannot be used together");
    }
  });

  it("should handle nested or combinations", () => {
    const innerOr = or(
      option("-a"),
      option("-b"),
    );

    const outerOr = or(
      innerOr,
      option("-c"),
    );

    const resultA = parse(outerOr, ["-a"]);
    assert.ok(resultA.success);

    const resultB = parse(outerOr, ["-b"]);
    assert.ok(resultB.success);

    const resultC = parse(outerOr, ["-c"]);
    assert.ok(resultC.success);
  });

  it("should handle complex real-world CLI scenario", () => {
    const buildParser = object("Build", {
      output: option("-o", "--output", string({ metavar: "DIR" })),
      minify: option("--minify"),
      sourcemap: option("--sourcemap"),
    });

    const serveParser = object("Serve", {
      port: option("-p", "--port", integer({ min: 1, max: 0xffff })),
      host: option("-h", "--host", string({ metavar: "HOST" })),
      open: option("--open"),
    });

    const testParser = object("Test", {
      watch: option("-w", "--watch"),
      coverage: option("--coverage"),
      filter: option("--filter", string({ metavar: "PATTERN" })),
    });

    const mainParser = or(buildParser, serveParser, testParser);

    const buildResult = parse(mainParser, [
      "--output",
      "dist",
      "--minify",
      "--sourcemap",
    ]);
    assert.ok(buildResult.success);
    if (buildResult.success && "output" in buildResult.value) {
      assert.equal(buildResult.value.output, "dist");
      assert.equal(buildResult.value.minify, true);
      assert.equal(buildResult.value.sourcemap, true);
    }

    const serveResult = parse(mainParser, [
      "-p",
      "3000",
      "-h",
      "0.0.0.0",
      "--open",
    ]);
    assert.ok(serveResult.success);
    if (serveResult.success && "port" in serveResult.value) {
      assert.equal(serveResult.value.port, 3000);
      assert.equal(serveResult.value.host, "0.0.0.0");
      assert.equal(serveResult.value.open, true);
    }

    const testResult = parse(mainParser, [
      "--watch",
      "--coverage",
      "--filter",
      "unit",
    ]);
    assert.ok(testResult.success);
    if (testResult.success && "watch" in testResult.value) {
      assert.equal(testResult.value.watch, true);
      assert.equal(testResult.value.coverage, true);
      assert.equal(testResult.value.filter, "unit");
    }

    const mixedResult = parse(mainParser, [
      "--output",
      "dist",
      "--port",
      "3000",
    ]);
    assert.ok(!mixedResult.success);
    if (!mixedResult.success) {
      assertErrorIncludes(mixedResult.error, "cannot be used together");
    }
  });

  it("should reproduce example.ts behavior", () => {
    const group1 = object("Group 1", {
      allow: option("-a", "--allow"),
      value: option("-v", "--value", integer()),
    });

    const group2 = object("Group 2", {
      foo: option("-f", "--foo"),
      bar: option("-b", "--bar", string({ metavar: "VALUE" })),
    });

    const parser = or(group1, group2);

    const allowResult = parse(parser, ["--allow"]);
    assert.ok(!allowResult.success);
    if (!allowResult.success) {
      assertErrorIncludes(allowResult.error, "Missing option");
    }

    const fooBarResult = parse(parser, ["--foo", "--bar", "hello"]);
    assert.ok(fooBarResult.success);
    if (fooBarResult.success && "foo" in fooBarResult.value) {
      assert.equal(fooBarResult.value.foo, true);
      assert.equal(fooBarResult.value.bar, "hello");
    }

    const conflictResult = parse(parser, ["--allow", "--foo"]);
    assert.ok(!conflictResult.success);
    if (!conflictResult.success) {
      assertErrorIncludes(conflictResult.error, "cannot be used together");
    }
  });

  it("should handle edge cases with options terminator", () => {
    const parser = object({
      verbose: option("-v"),
    });

    const result1 = parse(parser, ["-v", "--"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.verbose, true);
    }

    const result2 = parse(parser, ["--"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.verbose, false);
    }
  });

  it("should handle various option value formats", () => {
    const parser = object({
      port: option("--port", integer()),
      name: option("--name", string({ metavar: "NAME" })),
    });

    const result1 = parse(parser, ["--port=8080", "--name", "test"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.port, 8080);
      assert.equal(result1.value.name, "test");
    }

    const dosParser = object({
      dosPort: option("/P", integer()),
    });

    const result2 = parse(dosParser, ["/P:9000"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.dosPort, 9000);
    }
  });

  it("should handle argument parsers in object combinations", () => {
    const parser = object({
      verbose: option("-v"),
      output: option("-o", string({ metavar: "FILE" })),
      input: argument(string({ metavar: "INPUT" })),
    });

    const result = parse(parser, ["-v", "-o", "output.txt", "input.txt"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.output, "output.txt");
      assert.equal(result.value.input, "input.txt");
    }
  });

  it("should reproduce example.ts behavior with arguments", () => {
    const group1 = object("Group 1", {
      type: constant("group1"),
      allow: option("-a", "--allow"),
      value: option("-v", "--value", integer()),
      arg: argument(string({ metavar: "ARG" })),
    });

    const group2 = object("Group 2", {
      type: constant("group2"),
      foo: option("-f", "--foo"),
      bar: option("-b", "--bar", string({ metavar: "VALUE" })),
    });

    const parser = or(group1, group2);

    const group1Result = parse(parser, ["-a", "-v", "123", "myfile.txt"]);
    assert.ok(group1Result.success);
    if (
      group1Result.success && "type" in group1Result.value &&
      group1Result.value.type === "group1"
    ) {
      assert.equal(group1Result.value.allow, true);
      assert.equal(group1Result.value.value, 123);
      assert.equal(group1Result.value.arg, "myfile.txt");
    }

    const group2Result = parse(parser, ["-f", "-b", "hello"]);
    assert.ok(group2Result.success);
    if (
      group2Result.success && "type" in group2Result.value &&
      group2Result.value.type === "group2"
    ) {
      assert.equal(group2Result.value.foo, true);
      assert.equal(group2Result.value.bar, "hello");
    }
  });

  it("should handle argument parsing bug regression", () => {
    // Regression test for bug where first parser incorrectly consumed arguments as options
    // Before fix: first parser would consume '-t' as argument, preventing second parser from matching
    // After fix: second parser correctly matches '-t title' as option with value

    const firstParser = object({
      name: option("-n", "--name", string()),
      id: argument(string()),
    });

    const secondParser = object({
      title: option("-t", "--title", string()),
    });

    const parser = or(firstParser, secondParser);

    // This should succeed with the second parser, not fail because first parser consumed '-t' as argument
    const result = parse(parser, ["-t", "title"]);
    assert.ok(result.success);
    if (result.success && "title" in result.value) {
      assert.equal(result.value.title, "title");
    }

    // Verify that the first parser fails because it doesn't recognize the -t option
    const firstParserResult = parse(firstParser, ["-t", "title"]);
    assert.ok(!firstParserResult.success);
    if (!firstParserResult.success) {
      assertErrorIncludes(
        firstParserResult.error,
        "Unexpected option or argument",
      );
    }
  });

  it("should handle or() with arguments on both sides regression", () => {
    // Regression test for bug where or() parser with arguments on both sides
    // wouldn't work properly - first parser consuming arguments would prevent
    // second parser from getting a chance to match properly

    const parserA = object({
      name: option("-n", "--name", string()),
      file: argument(string()),
    });

    const parserB = object({
      title: option("-t", "--title", string()),
      input: argument(string()),
    });

    const parser = or(parserA, parserB);

    // First case: should match parserB
    const result1 = parse(parser, ["-t", "My Title", "input.txt"]);
    assert.ok(result1.success);
    if (result1.success && "title" in result1.value) {
      assert.equal(result1.value.title, "My Title");
      assert.equal(result1.value.input, "input.txt");
    }

    // Second case: should match parserA
    const result2 = parse(parser, ["-n", "John", "output.txt"]);
    assert.ok(result2.success);
    if (result2.success && "name" in result2.value) {
      assert.equal(result2.value.name, "John");
      assert.equal(result2.value.file, "output.txt");
    }

    // Edge case: test that arguments don't interfere with option parsing across parsers
    const result3 = parse(parser, ["-t", "Title"]);
    assert.ok(!result3.success);
    // This should fail because parserB requires both -t option AND an argument
    // but we're only providing the option
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
});

describe("Parser usage field", () => {
  describe("constant parser", () => {
    it("should have empty usage", () => {
      const parser = constant(42);
      assert.deepEqual(parser.usage, []);
    });
  });

  describe("option parser", () => {
    it("should have correct usage for boolean flag", () => {
      const parser = option("-v", "--verbose");
      const expected = [{
        type: "optional",
        terms: [{
          type: "option",
          names: ["-v", "--verbose"],
        }],
      }];
      assert.deepEqual(parser.usage, expected);
    });

    it("should have correct usage for option with value", () => {
      const parser = option("-p", "--port", integer());
      const expected = [{
        type: "option",
        names: ["-p", "--port"],
        metavar: "INTEGER",
      }];
      assert.deepEqual(parser.usage, expected);
    });

    it("should have correct usage for single option name", () => {
      const parser = option("--debug");
      const expected = [{
        type: "optional",
        terms: [{
          type: "option",
          names: ["--debug"],
        }],
      }];
      assert.deepEqual(parser.usage, expected);
    });

    it("should have correct usage for multiple option names", () => {
      const parser = option("-o", "--output", "--out", string());
      const expected = [{
        type: "option",
        names: ["-o", "--output", "--out"],
        metavar: "STRING",
      }];
      assert.deepEqual(parser.usage, expected);
    });
  });

  describe("argument parser", () => {
    it("should have correct usage", () => {
      const parser = argument(string());
      const expected = [{
        type: "argument",
        metavar: "STRING",
      }];
      assert.deepEqual(parser.usage, expected);
    });

    it("should have correct usage with integer", () => {
      const parser = argument(integer());
      const expected = [{
        type: "argument",
        metavar: "INTEGER",
      }];
      assert.deepEqual(parser.usage, expected);
    });
  });

  describe("optional parser", () => {
    it("should wrap inner parser usage in optional term", () => {
      const innerParser = option("-v", "--verbose");
      const parser = optional(innerParser);
      const expected = [{
        type: "optional",
        terms: [{
          type: "optional",
          terms: [{
            type: "option",
            names: ["-v", "--verbose"],
          }],
        }],
      }];
      assert.deepEqual(parser.usage, expected);
    });

    it("should work with argument parser", () => {
      const innerParser = argument(string());
      const parser = optional(innerParser);
      const expected = [{
        type: "optional",
        terms: [{
          type: "argument",
          metavar: "STRING",
        }],
      }];
      assert.deepEqual(parser.usage, expected);
    });

    it("should work with nested optional", () => {
      const baseParser = option("-d", "--debug");
      const innerOptional = optional(baseParser);
      const outerOptional = optional(innerOptional);
      const expected = [{
        type: "optional",
        terms: [{
          type: "optional",
          terms: [{
            type: "optional",
            terms: [{
              type: "option",
              names: ["-d", "--debug"],
            }],
          }],
        }],
      }];
      assert.deepEqual(outerOptional.usage, expected);
    });
  });

  describe("withDefault parser", () => {
    it("should wrap inner parser usage in optional term", () => {
      const innerParser = option("-p", "--port", integer());
      const parser = withDefault(innerParser, 3000);
      const expected = [{
        type: "optional",
        terms: [{
          type: "option",
          names: ["-p", "--port"],
          metavar: "INTEGER",
        }],
      }];
      assert.deepEqual(parser.usage, expected);
    });
  });

  describe("multiple parser", () => {
    it("should wrap inner parser usage in multiple term with min 0", () => {
      const innerParser = argument(string());
      const parser = multiple(innerParser);
      const expected = [{
        type: "multiple",
        terms: [{
          type: "argument",
          metavar: "STRING",
        }],
        min: 0,
      }];
      assert.deepEqual(parser.usage, expected);
    });

    it("should wrap inner parser usage in multiple term with custom min", () => {
      const innerParser = argument(string());
      const parser = multiple(innerParser, { min: 2 });
      const expected = [{
        type: "multiple",
        terms: [{
          type: "argument",
          metavar: "STRING",
        }],
        min: 2,
      }];
      assert.deepEqual(parser.usage, expected);
    });

    it("should work with option parser", () => {
      const innerParser = option("-I", "--include", string());
      const parser = multiple(innerParser, { min: 1 });
      const expected = [{
        type: "multiple",
        terms: [{
          type: "option",
          names: ["-I", "--include"],
          metavar: "STRING",
        }],
        min: 1,
      }];
      assert.deepEqual(parser.usage, expected);
    });
  });

  describe("object parser", () => {
    it("should combine usage from all parsers", () => {
      const parser = object({
        verbose: option("-v", "--verbose"),
        output: option("-o", "--output", string()),
        port: argument(integer()),
      });

      // Usage should be flattened and include all terms
      assert.equal(parser.usage.length, 3);

      // Check that all expected terms are present
      const usageTypes = parser.usage.map((u) => u.type);
      assert.ok(usageTypes.includes("optional")); // verbose flag is now optional
      assert.ok(usageTypes.includes("option")); // output option with value
      assert.ok(usageTypes.includes("argument"));

      // Find the optional term (verbose flag)
      const optionalTerm = parser.usage.find((u) => u.type === "optional");
      assert.ok(optionalTerm);
      assert.equal(optionalTerm.terms.length, 1);
      const verboseOption = optionalTerm.terms[0];
      assert.equal(verboseOption.type, "option");
      assert.deepEqual(verboseOption.names, ["-v", "--verbose"]);

      // Find the option term (output option with value)
      const outputOption = parser.usage.find((u) =>
        u.type === "option" && "names" in u && u.names.includes("-o")
      );
      assert.ok(outputOption);
      if (outputOption?.type === "option") {
        assert.deepEqual(outputOption.names, ["-o", "--output"]);
        assert.equal(outputOption.metavar, "STRING");
      }

      // Find the argument term
      const argTerm = parser.usage.find((u) => u.type === "argument");
      assert.ok(argTerm);
      assert.equal(argTerm?.type, "argument");
      if (argTerm?.type === "argument") {
        assert.equal(argTerm.metavar, "INTEGER");
      }
    });

    it("should handle empty object", () => {
      const parser = object({});
      assert.deepEqual(parser.usage, []);
    });

    it("should work with labeled object", () => {
      const parser = object("main options", {
        verbose: option("-v", "--verbose"),
        output: option("-o", "--output", string()),
      });

      assert.equal(parser.usage.length, 2);
      const optionalTerms = parser.usage.filter((u) => u.type === "optional");
      const optionTerms = parser.usage.filter((u) => u.type === "option");
      assert.equal(optionalTerms.length, 1); // verbose flag is optional
      assert.equal(optionTerms.length, 1); // output option with value
    });
  });

  describe("tuple parser", () => {
    it("should combine usage from all parsers", () => {
      const parser = tuple([
        option("-v", "--verbose"),
        argument(string()),
        option("-o", "--output", string()),
      ]);

      assert.equal(parser.usage.length, 3);

      const optionalTerms = parser.usage.filter((u) => u.type === "optional");
      const optionTerms = parser.usage.filter((u) => u.type === "option");
      assert.equal(optionalTerms.length, 1); // verbose flag is optional
      assert.equal(optionTerms.length, 1); // output option with value

      const argTerms = parser.usage.filter((u) => u.type === "argument");
      assert.equal(argTerms.length, 1);
    });

    it("should handle empty tuple", () => {
      const parser = tuple([]);
      assert.deepEqual(parser.usage, []);
    });

    it("should work with labeled tuple", () => {
      const parser = tuple("command line args", [
        option("-v", "--verbose"),
        argument(string()),
      ]);

      assert.equal(parser.usage.length, 2);
    });
  });

  describe("or parser", () => {
    it("should create exclusive usage term", () => {
      const parserA = option("-v", "--verbose");
      const parserB = option("-q", "--quiet");
      const parser = or(parserA, parserB);

      const expected = [{
        type: "exclusive",
        terms: [
          [{
            type: "optional",
            terms: [{
              type: "option",
              names: ["-v", "--verbose"],
            }],
          }],
          [{
            type: "optional",
            terms: [{
              type: "option",
              names: ["-q", "--quiet"],
            }],
          }],
        ],
      }];
      assert.deepEqual(parser.usage, expected);
    });

    it("should work with three parsers", () => {
      const parserA = option("-v", "--verbose");
      const parserB = option("-q", "--quiet");
      const parserC = argument(string());
      const parser = or(parserA, parserB, parserC);

      assert.equal(parser.usage.length, 1);
      assert.equal(parser.usage[0].type, "exclusive");

      if (parser.usage[0].type === "exclusive") {
        assert.equal(parser.usage[0].terms.length, 3);
        assert.deepEqual(parser.usage[0].terms[0], [{
          type: "optional",
          terms: [{
            type: "option",
            names: ["-v", "--verbose"],
          }],
        }]);
        assert.deepEqual(parser.usage[0].terms[1], [{
          type: "optional",
          terms: [{
            type: "option",
            names: ["-q", "--quiet"],
          }],
        }]);
        assert.deepEqual(parser.usage[0].terms[2], [{
          type: "argument",
          metavar: "STRING",
        }]);
      }
    });

    it("should work with complex parser combinations", () => {
      const objectParser = object({
        count: option("-c", "--count", integer()),
        input: argument(string()),
      });
      const optionParser = option("-h", "--help");
      const parser = or(objectParser, optionParser);

      assert.equal(parser.usage.length, 1);
      assert.equal(parser.usage[0].type, "exclusive");

      if (parser.usage[0].type === "exclusive") {
        assert.equal(parser.usage[0].terms.length, 2);
        // First term should have the object parser's usage
        assert.equal(parser.usage[0].terms[0].length, 2);
        // Second term should have the option parser's usage (now optional)
        assert.equal(parser.usage[0].terms[1].length, 1);
        assert.equal(parser.usage[0].terms[1][0].type, "optional");
      }
    });
  });

  describe("merge parser", () => {
    it("should combine usage from merged parsers", () => {
      const parserA = object({
        verbose: option("-v", "--verbose"),
        input: argument(string()),
      });
      const parserB = object({
        output: option("-o", "--output", string()),
        count: option("-c", "--count", integer()),
      });
      const parser = merge(parserA, parserB);

      assert.equal(parser.usage.length, 4);

      const optionalTerms = parser.usage.filter((u) => u.type === "optional");
      const optionTerms = parser.usage.filter((u) => u.type === "option");
      assert.equal(optionalTerms.length, 1); // verbose flag is optional
      assert.equal(optionTerms.length, 2); // output and count options with values

      const argTerms = parser.usage.filter((u) => u.type === "argument");
      assert.equal(argTerms.length, 1);
    });

    it("should work with three merged parsers", () => {
      const parserA = object({ verbose: option("-v", "--verbose") });
      const parserB = object({ quiet: option("-q", "--quiet") });
      const parserC = object({ debug: option("-d", "--debug") });
      const parser = merge(parserA, parserB, parserC);

      assert.equal(parser.usage.length, 3);
      const optionalTerms = parser.usage.filter((u) => u.type === "optional");
      assert.equal(optionalTerms.length, 3); // all are boolean flags, now optional
    });
  });

  describe("command parser", () => {
    it("should include command term and inner parser usage", () => {
      const innerParser = object({
        verbose: option("-v", "--verbose"),
        input: argument(string()),
      });
      const parser = command("init", innerParser);

      assert.equal(parser.usage.length, 3);
      assert.equal(parser.usage[0].type, "command");

      if (parser.usage[0].type === "command") {
        assert.equal(parser.usage[0].name, "init");
      }

      // Rest should be from inner parser
      const optionalTerms = parser.usage.filter((u) => u.type === "optional");
      const argTerms = parser.usage.filter((u) => u.type === "argument");
      assert.equal(optionalTerms.length, 1); // verbose flag is now optional
      assert.equal(argTerms.length, 1);
    });

    it("should work with simple inner parser", () => {
      const innerParser = constant("done");
      const parser = command("test", innerParser);

      assert.equal(parser.usage.length, 1);
      assert.equal(parser.usage[0].type, "command");

      if (parser.usage[0].type === "command") {
        assert.equal(parser.usage[0].name, "test");
      }
    });

    it("should work with nested commands", () => {
      const subCommand = command("subcommand", argument(string()));
      const mainCommand = command("main", subCommand);

      assert.equal(mainCommand.usage.length, 3);
      assert.equal(mainCommand.usage[0].type, "command");
      assert.equal(mainCommand.usage[1].type, "command");
      assert.equal(mainCommand.usage[2].type, "argument");

      if (mainCommand.usage[0].type === "command") {
        assert.equal(mainCommand.usage[0].name, "main");
      }
      if (mainCommand.usage[1].type === "command") {
        assert.equal(mainCommand.usage[1].name, "subcommand");
      }
    });
  });
});

describe("Parser usage field integration", () => {
  it("should work with complex real-world example", () => {
    // Simulate a git-like CLI: git [--verbose] (commit [-m MSG] | add FILE...)
    const commitCommand = command(
      "commit",
      object({
        message: optional(option("-m", "--message", string())),
      }),
    );

    const addCommand = command(
      "add",
      object({
        files: multiple(argument(string()), { min: 1 }),
      }),
    );

    const gitParser = object({
      global: optional(option("--verbose")),
      subcommand: or(commitCommand, addCommand),
    });

    // Check that usage is properly structured
    assert.equal(gitParser.usage.length, 2); // exclusive subcommands + optional global option

    // Find optional verbose option
    const optionalTerms = gitParser.usage.filter((u) => u.type === "optional");
    assert.equal(optionalTerms.length, 1);

    // Find exclusive subcommands
    const exclusiveTerms = gitParser.usage.filter((u) =>
      u.type === "exclusive"
    );
    assert.equal(exclusiveTerms.length, 1);

    if (exclusiveTerms[0].type === "exclusive") {
      assert.equal(exclusiveTerms[0].terms.length, 2);
      // Each subcommand should start with a command term
      assert.ok(
        exclusiveTerms[0].terms[0].some((term) =>
          term.type === "command" && term.name === "commit"
        ),
      );
      assert.ok(
        exclusiveTerms[0].terms[1].some((term) =>
          term.type === "command" && term.name === "add"
        ),
      );
    }
  });

  it("should maintain usage consistency across parser combinations", () => {
    const baseOption = option("-v", "--verbose");
    const baseArg = argument(string());

    // Test that wrapping parsers preserve inner usage correctly
    const optionalWrapped = optional(baseOption);
    const multipleWrapped = multiple(baseArg);
    const defaultWrapped = withDefault(baseOption, false);

    // Optional should wrap the original usage
    assert.equal(optionalWrapped.usage[0].type, "optional");
    if (optionalWrapped.usage[0].type === "optional") {
      assert.deepEqual(optionalWrapped.usage[0].terms, baseOption.usage);
    }

    // Multiple should wrap the original usage
    assert.equal(multipleWrapped.usage[0].type, "multiple");
    if (multipleWrapped.usage[0].type === "multiple") {
      assert.deepEqual(multipleWrapped.usage[0].terms, baseArg.usage);
    }

    // WithDefault should wrap like optional
    assert.equal(defaultWrapped.usage[0].type, "optional");
    if (defaultWrapped.usage[0].type === "optional") {
      assert.deepEqual(defaultWrapped.usage[0].terms, baseOption.usage);
    }
  });
});

describe("nested command help", () => {
  it("should show correct help for nested subcommands", () => {
    const parser = command(
      "nest",
      or(
        command(
          "foo",
          object("Foo Options", {
            type: constant("foo"),
            allow: option("-a", "--allow", {
              description: message`Allow something in foo.`,
            }),
            value: option("-v", "--value", integer(), {
              description: message`Set a foo value.`,
            }),
            arg: argument(string({ metavar: "ARG" }), {
              description: message`A foo argument.`,
            }),
          }),
          { description: message`Foo subcommand description.` },
        ),
        command(
          "bar",
          object("Bar Options", {
            type: constant("bar"),
            foo: option("-f", "--foo", {
              description: message`Foo option in bar.`,
            }),
            bar: option("-b", "--bar", string({ metavar: "VALUE" }), {
              description: message`Bar option in bar.`,
            }),
          }),
          { description: message`Bar subcommand description.` },
        ),
      ),
      { description: message`Nested command description.` },
    );

    // Test help for "nest" shows subcommands
    const nestDocFragments = parser.getDocFragments(
      { kind: "available" as const, state: ["matched", "nest"] },
      undefined,
    );
    assert.equal(
      formatMessage(nestDocFragments.description!),
      "Nested command description.",
    );
    const nestEntries = nestDocFragments.fragments
      .flatMap((f) => f.type === "section" ? f.entries : [])
      .filter((e) => e.term.type === "command");
    assert.equal(nestEntries.length, 2);
    assert.ok(
      nestEntries.some((e) =>
        e.term.type === "command" && e.term.name === "foo"
      ),
    );
    assert.ok(
      nestEntries.some((e) =>
        e.term.type === "command" && e.term.name === "bar"
      ),
    );

    // Test help for "nest foo" shows foo options
    const fooDocFragments = parser.getDocFragments(
      {
        kind: "available" as const,
        state: ["parsing", [0, {
          success: true,
          next: {
            buffer: [],
            optionsTerminated: false,
            state: ["matched", "foo"],
          },
          consumed: ["foo"],
        }]],
      },
      undefined,
    );
    assert.equal(
      formatMessage(fooDocFragments.description!),
      "Foo subcommand description.",
    );
    const fooEntries = fooDocFragments.fragments
      .flatMap((f) => f.type === "section" ? f.entries : []);
    assert.ok(fooEntries.some((e) =>
      e.term.type === "option" &&
      e.term.names.includes("-a") &&
      e.description &&
      formatMessage(e.description).includes("Allow something in foo")
    ));

    // Test help for "nest bar" shows bar options
    const barDocFragments = parser.getDocFragments(
      {
        kind: "available" as const,
        state: ["parsing", [1, {
          success: true,
          next: {
            buffer: [],
            optionsTerminated: false,
            state: ["matched", "bar"],
          },
          consumed: ["bar"],
        }]],
      },
      undefined,
    );
    assert.equal(
      formatMessage(barDocFragments.description!),
      "Bar subcommand description.",
    );
    const barEntries = barDocFragments.fragments
      .flatMap((f) => f.type === "section" ? f.entries : []);
    assert.ok(barEntries.some((e) =>
      e.term.type === "option" &&
      e.term.names.includes("-f") &&
      e.description &&
      formatMessage(e.description).includes("Foo option in bar")
    ));
  });
});

describe("getDocPage", () => {
  it("should return documentation page for simple parser", () => {
    const parser = option("-v", "--verbose");

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    assert.ok(Array.isArray(docPage.usage));
    assert.ok(Array.isArray(docPage.sections));
    assert.equal(docPage.usage.length, 1);
    assert.equal(docPage.usage[0].type, "optional");
  });

  it("should return documentation page for object parser", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      port: option("-p", "--port", integer()),
      file: argument(string({ metavar: "FILE" })),
    });

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    assert.ok(Array.isArray(docPage.usage));
    assert.ok(Array.isArray(docPage.sections));
    assert.ok(docPage.sections.length > 0);

    // Should have entries for all parsers
    const allEntries = docPage.sections.flatMap((s) => s.entries);
    assert.equal(allEntries.length, 3);

    // Check for option entries
    const optionEntries = allEntries.filter((e) => e.term.type === "option");
    assert.equal(optionEntries.length, 2);

    // Check for argument entry
    const argumentEntries = allEntries.filter((e) =>
      e.term.type === "argument"
    );
    assert.equal(argumentEntries.length, 1);
    assert.equal(argumentEntries[0].term.metavar, "FILE");
  });

  it("should return documentation page with description when parser has description", () => {
    const parser = object("Test Parser", {
      verbose: option("-v", "--verbose", {
        description: message`Enable verbose output`,
      }),
    });

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    assert.ok(docPage.sections.length > 0);

    // Should have section with title
    const labeledSection = docPage.sections.find((s) =>
      s.title === "Test Parser"
    );
    assert.ok(labeledSection);
    assert.equal(labeledSection.entries.length, 1);

    const entry = labeledSection.entries[0];
    assert.equal(entry.term.type, "option");
    if (entry.term.type === "option") {
      assert.deepEqual(entry.term.names, ["-v", "--verbose"]);
    }
    assert.deepEqual(entry.description, message`Enable verbose output`);
  });

  it("should handle empty arguments array", () => {
    const parser = option("-v", "--verbose");

    const docPage = getDocPage(parser, []);

    assert.ok(docPage);
    assert.ok(Array.isArray(docPage.usage));
    assert.ok(Array.isArray(docPage.sections));
  });

  it("should return contextual documentation based on parsed arguments", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      port: option("-p", "--port", integer()),
    });

    // Documentation with no arguments
    const emptyDoc = getDocPage(parser, []);
    assert.ok(emptyDoc);

    // Documentation after parsing some arguments
    const contextDoc = getDocPage(parser, ["-v"]);
    assert.ok(contextDoc);

    // Both should have the same structure but potentially different state
    assert.equal(emptyDoc.sections.length, contextDoc.sections.length);
  });

  it("should work with command parsers", () => {
    const subParser = object({
      file: argument(string({ metavar: "FILE" })),
      verbose: option("-v", "--verbose"),
    });

    const parser = or(
      command("add", subParser, { description: message`Add a new item` }),
      command(
        "remove",
        object({
          id: argument(string({ metavar: "ID" })),
        }),
        { description: message`Remove an item` },
      ),
    );

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    assert.ok(docPage.usage && docPage.usage.length > 0);
    assert.ok(docPage.sections.length > 0);
  });

  it("should handle command context correctly", () => {
    const subParser = object({
      file: argument(string({ metavar: "FILE" })),
      verbose: option("-v", "--verbose"),
    });

    const parser = command("process", subParser, {
      description: message`Process files`,
    });

    // Documentation without command
    const rootDoc = getDocPage(parser);
    assert.ok(rootDoc);

    // Documentation after command is matched
    const commandDoc = getDocPage(parser, ["process"]);
    assert.ok(commandDoc);

    // Usage should be updated to reflect command context
    assert.ok(rootDoc.usage && rootDoc.usage.length > 0);
    assert.ok(commandDoc.usage && commandDoc.usage.length > 0);
  });

  it("should handle exclusive (or) parsers correctly", () => {
    const parser = or(
      option("-v", "--verbose"),
      option("-q", "--quiet"),
      option("-d", "--debug"),
    );

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    assert.ok(docPage.usage && docPage.usage.length > 0);
    if (docPage.usage) {
      assert.equal(docPage.usage[0].type, "exclusive");
      if (docPage.usage[0].type === "exclusive") {
        assert.equal(docPage.usage[0].terms.length, 3);
      }
    }
  });

  it("should handle multiple parser correctly", () => {
    const parser = object({
      files: multiple(argument(string({ metavar: "FILE" }))),
      verbose: option("-v", "--verbose"),
    });

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    const allEntries = docPage.sections.flatMap((s) => s.entries);

    // Should have entries for both multiple files and verbose option
    assert.ok(allEntries.length >= 2);

    const fileEntry = allEntries.find((e) =>
      e.term.type === "argument" && e.term.metavar === "FILE"
    );
    assert.ok(fileEntry);
  });

  it("should handle optional parser correctly", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      output: optional(option("-o", "--output", string({ metavar: "FILE" }))),
    });

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    const allEntries = docPage.sections.flatMap((s) => s.entries);

    // Should have entries for both verbose and optional output
    assert.ok(allEntries.length >= 2);

    const outputEntry = allEntries.find((e) =>
      e.term.type === "option" &&
      e.term.names && e.term.names.includes("--output")
    );
    assert.ok(outputEntry);
  });

  it("should handle withDefault parser correctly", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      port: withDefault(option("-p", "--port", integer()), 8080),
    });

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    const allEntries = docPage.sections.flatMap((s) => s.entries);

    const portEntry = allEntries.find((e) =>
      e.term.type === "option" &&
      e.term.names && e.term.names.includes("--port")
    );
    assert.ok(portEntry);
    assert.deepEqual(portEntry.default, message`${"8080"}`);
  });

  it("should handle tuple parser correctly", () => {
    const parser = tuple([
      argument(string({ metavar: "INPUT" })),
      option("-v", "--verbose"),
      argument(string({ metavar: "OUTPUT" })),
    ]);

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    const allEntries = docPage.sections.flatMap((s) => s.entries);

    // Should have entries for all tuple elements
    assert.ok(allEntries.length >= 3);

    const inputEntry = allEntries.find((e) =>
      e.term.type === "argument" && e.term.metavar === "INPUT"
    );
    const outputEntry = allEntries.find((e) =>
      e.term.type === "argument" && e.term.metavar === "OUTPUT"
    );
    const verboseEntry = allEntries.find((e) =>
      e.term.type === "option" &&
      e.term.names && e.term.names.includes("--verbose")
    );

    assert.ok(inputEntry);
    assert.ok(outputEntry);
    assert.ok(verboseEntry);
  });

  it("should work with constant parser", () => {
    const parser = constant("test-value");

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    // Constant parsers typically don't contribute to documentation
    assert.ok(Array.isArray(docPage.usage));
    assert.ok(Array.isArray(docPage.sections));
  });

  it("should handle parser that fails to parse arguments", () => {
    const parser = option("-v", "--verbose");

    // Try to get documentation with invalid arguments
    const docPage = getDocPage(parser, ["--invalid-option"]);

    assert.ok(docPage);
    // Should still return documentation even if parsing fails
    assert.ok(Array.isArray(docPage.usage));
    assert.ok(Array.isArray(docPage.sections));
  });

  it("should handle complex nested parser structures", () => {
    const parser = object("CLI Tool", {
      verbose: option("-v", "--verbose", {
        description: message`Enable verbose output`,
      }),
      config: option("-c", "--config", string({ metavar: "FILE" }), {
        description: message`Configuration file`,
      }),
      file: argument(string({ metavar: "INPUT" })),
    });

    const docPage = getDocPage(parser);

    assert.ok(docPage);
    assert.ok(docPage.sections.length > 0);

    // Should have sections from the structure
    const cliSection = docPage.sections.find((s) => s.title === "CLI Tool");
    assert.ok(cliSection);
    assert.ok(cliSection.entries.length >= 3);
  });
});

describe("concat", () => {
  it("should create a parser that combines multiple tuple parsers", () => {
    const parser1 = tuple([
      option("-v", "--verbose"),
      option("-p", "--port", integer()),
    ]);

    const parser2 = tuple([
      option("-h", "--host", string()),
      option("-d", "--debug"),
    ]);

    const concatParser = concat(parser1, parser2);

    assert.ok(concatParser.priority >= 10);
    assert.ok(Array.isArray(concatParser.initialState));
    assert.equal(concatParser.initialState.length, 2);
    assert.ok(Array.isArray(concatParser.initialState[0]));
    assert.ok(Array.isArray(concatParser.initialState[1]));
  });

  it("should concat two tuple parsers successfully", () => {
    const basicOptions = tuple([
      option("-v", "--verbose"),
      option("-q", "--quiet"),
    ]);

    const serverOptions = tuple([
      option("-p", "--port", integer()),
      option("-h", "--host", string()),
    ]);

    const parser = concat(basicOptions, serverOptions);

    const result = parse(parser, ["-v", "-p", "8080", "-h", "localhost"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 4);
      assert.equal(result.value[0], true); // verbose
      assert.equal(result.value[1], false); // quiet
      assert.equal(result.value[2], 8080); // port
      assert.equal(result.value[3], "localhost"); // host
    }
  });

  it("should concat three tuple parsers", () => {
    const group1 = tuple([
      option("-1", string()),
    ]);

    const group2 = tuple([
      option("-2", integer()),
    ]);

    const group3 = tuple([
      option("-3"),
    ]);

    const parser = concat(group1, group2, group3);

    const result = parse(parser, ["-1", "test", "-2", "42", "-3"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 3);
      assert.equal(result.value[0], "test");
      assert.equal(result.value[1], 42);
      assert.equal(result.value[2], true);
    }
  });

  it("should concat four tuple parsers", () => {
    const a = tuple([option("-a")]);
    const b = tuple([option("-b")]);
    const c = tuple([option("-c")]);
    const d = tuple([option("-d")]);

    const parser = concat(a, b, c, d);

    const result = parse(parser, ["-a", "-b", "-c", "-d"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 4);
      assert.equal(result.value[0], true);
      assert.equal(result.value[1], true);
      assert.equal(result.value[2], true);
      assert.equal(result.value[3], true);
    }
  });

  it("should concat five tuple parsers", () => {
    const a = tuple([option("-a")]);
    const b = tuple([option("-b")]);
    const c = tuple([option("-c")]);
    const d = tuple([option("-d")]);
    const e = tuple([option("-e")]);

    const parser = concat(a, b, c, d, e);

    const result = parse(parser, ["-a", "-b", "-c", "-d", "-e"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 5);
      assert.equal(result.value[0], true);
      assert.equal(result.value[1], true);
      assert.equal(result.value[2], true);
      assert.equal(result.value[3], true);
      assert.equal(result.value[4], true);
    }
  });

  it("should handle empty tuples correctly", () => {
    const empty1 = tuple([]);
    const empty2 = tuple([]);
    const nonEmpty = tuple([option("-v", "--verbose")]);

    const parser = concat(empty1, empty2, nonEmpty);

    const result = parse(parser, ["-v"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 1);
      assert.equal(result.value[0], true);
    }
  });

  it("should handle tuples with different lengths", () => {
    const short = tuple([option("-s")]);
    const long = tuple([
      option("-a", string()),
      option("-b", integer()),
      option("-c"),
    ]);

    const parser = concat(short, long);

    const result = parse(parser, ["-s", "-a", "test", "-b", "42", "-c"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 4);
      assert.equal(result.value[0], true); // -s
      assert.equal(result.value[1], "test"); // -a
      assert.equal(result.value[2], 42); // -b
      assert.equal(result.value[3], true); // -c
    }
  });

  it("should work with optional parsers", () => {
    const required = tuple([
      option("-n", "--name", string()),
    ]);

    const optionalFields = tuple([
      optional(option("-a", "--age", integer())),
      optional(option("-e", "--email", string())),
    ]);

    const parser = concat(required, optionalFields);

    const withOptionalResult = parse(parser, ["-n", "John", "-a", "30"]);
    assert.ok(withOptionalResult.success);
    if (withOptionalResult.success) {
      assert.equal(withOptionalResult.value.length, 3);
      assert.equal(withOptionalResult.value[0], "John");
      assert.equal(withOptionalResult.value[1], 30);
      assert.equal(withOptionalResult.value[2], undefined);
    }

    const withoutOptionalResult = parse(parser, ["-n", "Jane"]);
    assert.ok(withoutOptionalResult.success);
    if (withoutOptionalResult.success) {
      assert.equal(withoutOptionalResult.value.length, 3);
      assert.equal(withoutOptionalResult.value[0], "Jane");
      assert.equal(withoutOptionalResult.value[1], undefined);
      assert.equal(withoutOptionalResult.value[2], undefined);
    }
  });

  it("should work with multiple parsers", () => {
    const single = tuple([
      option("-n", "--name", string()),
    ]);

    const multipleFields = tuple([
      multiple(option("-t", "--tag", string())),
      argument(string()),
    ]);

    const parser = concat(single, multipleFields);

    const result = parse(parser, [
      "-n",
      "MyApp",
      "-t",
      "dev",
      "-t",
      "webapp",
      "input.txt",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 3);
      assert.equal(result.value[0], "MyApp");
      assert.deepEqual(result.value[1], ["dev", "webapp"]);
      assert.equal(result.value[2], "input.txt");
    }
  });

  it("should work with mixed argument and option tuples", () => {
    const args = tuple([
      argument(string()),
      argument(string()),
    ]);

    const options = tuple([
      option("-v", "--verbose"),
      option("-o", "--output", string()),
    ]);

    const parser = concat(args, options);

    const result = parse(parser, [
      "input.txt",
      "output.txt",
      "-v",
      "-o",
      "result.txt",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 4);
      assert.equal(result.value[0], "input.txt");
      assert.equal(result.value[1], "output.txt");
      assert.equal(result.value[2], true);
      assert.equal(result.value[3], "result.txt");
    }
  });

  it("should handle parser priorities correctly", () => {
    const lowPriority = tuple([
      argument(string()),
    ]);

    const highPriority = tuple([
      option("-o", string()),
    ]);

    const parser = concat(lowPriority, highPriority);

    assert.equal(
      parser.priority,
      Math.max(lowPriority.priority, highPriority.priority),
    );

    const result = parse(parser, ["-o", "value", "argument"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 2);
      assert.equal(result.value[0], "argument");
      assert.equal(result.value[1], "value");
    }
  });

  it("should propagate parser errors correctly", () => {
    const parser1 = tuple([
      option("-p", "--port", integer({ min: 1, max: 0xffff })),
    ]);

    const parser2 = tuple([
      option("-h", "--host", string()),
    ]);

    const parser = concat(parser1, parser2);

    const result = parse(parser, ["-p", "0", "-h", "localhost"]);
    assert.ok(!result.success);
  });

  it("should handle value parser failures", () => {
    const parser1 = tuple([
      option("-n", integer({ min: 10 })),
    ]);

    const parser2 = tuple([
      option("-t", string({ pattern: /^[A-Z]+$/ })),
    ]);

    const parser = concat(parser1, parser2);

    const invalidNumberResult = parse(parser, ["-n", "5"]);
    assert.ok(!invalidNumberResult.success);

    const invalidTextResult = parse(parser, ["-t", "lowercase"]);
    assert.ok(!invalidTextResult.success);
  });

  it("should work with different value types", () => {
    const stringTuple = tuple([
      option("-n", "--name", string()),
      option("-t", "--title", string()),
    ]);

    const numberTuple = tuple([
      option("-p", "--port", integer()),
      option("-c", "--count", integer()),
    ]);

    const booleanTuple = tuple([
      option("-v", "--verbose"),
      option("-d", "--debug"),
    ]);

    const parser = concat(stringTuple, numberTuple, booleanTuple);

    const result = parse(parser, [
      "-n",
      "test",
      "-p",
      "8080",
      "-v",
      "-c",
      "5",
      "-t",
      "My Title",
      "-d",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 6);
      assert.equal(result.value[0], "test"); // name
      assert.equal(result.value[1], "My Title"); // title
      assert.equal(result.value[2], 8080); // port
      assert.equal(result.value[3], 5); // count
      assert.equal(result.value[4], true); // verbose
      assert.equal(result.value[5], true); // debug
    }
  });

  it("should handle parsing when no parser can consume input", () => {
    const parser1 = tuple([
      option("-1"),
    ]);

    const parser2 = tuple([
      option("-2"),
    ]);

    const parser = concat(parser1, parser2);

    // Test case where invalid option is provided - should fail
    const result1 = parse(parser, ["-3"]);
    assert.ok(!result1.success);

    // Test case where valid empty input is provided - should succeed with defaults
    const result2 = parse(parser, []);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.length, 2);
      assert.equal(result2.value[0], false); // option "-1" defaults to false
      assert.equal(result2.value[1], false); // option "-2" defaults to false
    }

    // Test case where one parser consumes input
    const result3 = parse(parser, ["-1"]);
    assert.ok(result3.success);
    if (result3.success) {
      assert.equal(result3.value.length, 2);
      assert.equal(result3.value[0], true); // option "-1" is true
      assert.equal(result3.value[1], false); // option "-2" defaults to false
    }
  });

  it("should work in or() combinations", () => {
    const basicMode = concat(
      tuple([constant("basic")]),
      tuple([option("-f")]),
    );

    const advancedMode = concat(
      tuple([constant("advanced")]),
      tuple([option("-v", integer())]),
    );

    const parser = or(basicMode, advancedMode);

    const basicResult = parse(parser, ["-f"]);
    assert.ok(basicResult.success);
    if (basicResult.success) {
      assert.equal(basicResult.value.length, 2);
      assert.equal(basicResult.value[0], "basic");
      assert.equal(basicResult.value[1], true);
    }

    const advancedResult = parse(parser, ["-v", "42"]);
    assert.ok(advancedResult.success);
    if (advancedResult.success) {
      assert.equal(advancedResult.value.length, 2);
      assert.equal(advancedResult.value[0], "advanced");
      assert.equal(advancedResult.value[1], 42);
    }
  });

  it("should handle complex real-world scenario", () => {
    const authTuple = tuple([
      option("-u", "--user", string()),
      option("-p", "--pass", string()),
    ]);

    const serverTuple = tuple([
      option("--host", string()),
      option("--port", integer()),
    ]);

    const flagsTuple = tuple([
      option("-v", "--verbose"),
      option("--ssl"),
    ]);

    const parser = concat(authTuple, serverTuple, flagsTuple);

    const result = parse(parser, [
      "-u",
      "admin",
      "-p",
      "secret123",
      "--host",
      "localhost",
      "--port",
      "8080",
      "-v",
      "--ssl",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 6);
      assert.equal(result.value[0], "admin");
      assert.equal(result.value[1], "secret123");
      assert.equal(result.value[2], "localhost");
      assert.equal(result.value[3], 8080);
      assert.equal(result.value[4], true);
      assert.equal(result.value[5], true);
    }
  });

  it("should handle options terminator correctly", () => {
    const options = tuple([
      option("-f"),
    ]);

    const args = tuple([
      multiple(argument(string())),
    ]);

    const parser = concat(options, args);

    const result = parse(parser, ["-f", "--", "-not-an-option"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 2);
      assert.equal(result.value[0], true);
      assert.deepEqual(result.value[1], ["-not-an-option"]);
    }
  });

  it("should handle state updates and transitions correctly", () => {
    const parser1 = tuple([
      option("-1", string()),
    ]);

    const parser2 = tuple([
      option("-2", integer()),
    ]);

    const parser = concat(parser1, parser2);

    // Test sequential parsing
    const result = parse(parser, ["-1", "hello", "-2", "42"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 2);
      assert.equal(result.value[0], "hello");
      assert.equal(result.value[1], 42);
    }
  });

  it("should handle value parser failures during completion", () => {
    const parser1 = tuple([
      option("-p", "--port", integer({ min: 1, max: 0xffff })),
    ]);

    const parser2 = tuple([
      option("-h", "--host", string()),
    ]);

    const parser = concat(parser1, parser2);

    // Test with invalid port value
    const result = parse(parser, ["-p", "0", "-h", "localhost"]);
    assert.ok(!result.success); // Should fail during completion due to port validation
  });

  it("should handle empty parsers gracefully", () => {
    const empty1 = tuple([]);
    const empty2 = tuple([]);

    const parser = concat(empty1, empty2);

    // Empty parsers succeed when there is no input
    const result = parse(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 0);
    }
  });

  it("should work with labeled tuples", () => {
    const userInfo = tuple("User Info", [
      option("-n", "--name", string()),
      option("-a", "--age", integer()),
    ]);

    const preferences = tuple("Preferences", [
      option("-t", "--theme", string()),
      option("-l", "--lang", string()),
    ]);

    const parser = concat(userInfo, preferences);

    const result = parse(parser, [
      "-n",
      "Alice",
      "-a",
      "30",
      "-t",
      "dark",
      "-l",
      "en",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.length, 4);
      assert.equal(result.value[0], "Alice");
      assert.equal(result.value[1], 30);
      assert.equal(result.value[2], "dark");
      assert.equal(result.value[3], "en");
    }
  });

  describe("getDocFragments", () => {
    it("should delegate to constituent parsers and organize fragments", () => {
      const parser1 = tuple([
        option("-f", "--flag"),
      ]);
      const parser2 = tuple([
        option("-v", "--value", string()),
      ]);
      const parser = concat(parser1, parser2);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 1);
      const section = fragments.fragments[0];
      assert.equal(section.type, "section");
      assert.equal(section.title, undefined);
      assert.equal(section.entries.length, 2);

      // Check that both parsers' entries are included
      const flagEntry = section.entries.find((e) =>
        e.term.type === "option" && e.term.names.includes("-f")
      );
      const valueEntry = section.entries.find((e) =>
        e.term.type === "option" && e.term.names.includes("-v")
      );
      assert.ok(flagEntry);
      assert.ok(valueEntry);
    });

    it("should handle labeled tuples in documentation", () => {
      const parser1 = tuple("Group 1", [
        option("-1", "--one"),
      ]);
      const parser2 = tuple("Group 2", [
        option("-2", "--two"),
      ]);
      const parser = concat(parser1, parser2);

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      assert.equal(fragments.fragments.length, 2);

      const group1Section = fragments.fragments.find((f) =>
        f.type === "section" && f.title === "Group 1"
      );
      const group2Section = fragments.fragments.find((f) =>
        f.type === "section" && f.title === "Group 2"
      );

      assert.ok(group1Section);
      assert.ok(group2Section);
      if (group1Section.type === "section") {
        assert.equal(group1Section.entries.length, 1);
      }
      if (group2Section.type === "section") {
        assert.equal(group2Section.entries.length, 1);
      }
    });
  });

  describe("longestMatch()", () => {
    it("should select parser that consumes more tokens", () => {
      const shortParser = object({
        type: constant("short"),
        help: flag("--help"),
      });

      const longParser = object({
        type: constant("long"),
        cmd: argument(string({ metavar: "COMMAND" })),
        help: flag("--help"),
      });

      const parser = longestMatch(shortParser, longParser);

      // Short parser consumes 1 token (--help)
      const shortResult = parse(parser, ["--help"]);
      assert.ok(shortResult.success);
      assert.equal((shortResult.value as { type: string }).type, "short");

      // Long parser consumes 2 tokens (list --help)
      const longResult = parse(parser, ["list", "--help"]);
      assert.ok(longResult.success);
      assert.equal((longResult.value as { type: string }).type, "long");
      assert.equal((longResult.value as { cmd: string }).cmd, "list");
    });

    it("should handle multiple parsers correctly", () => {
      const parser1 = object({
        type: constant("one"),
        flag: flag("-a"),
      });

      const parser2 = object({
        type: constant("two"),
        flag1: flag("-a"),
        flag2: flag("-b"),
      });

      const parser3 = object({
        type: constant("three"),
        flag1: flag("-a"),
        flag2: flag("-b"),
        flag3: flag("-c"),
      });

      const parser = longestMatch(parser1, parser2, parser3);

      // All consume 1 token, first match wins
      const result1 = parse(parser, ["-a"]);
      assert.ok(result1.success);
      assert.equal((result1.value as { type: string }).type, "one");

      // parser2 consumes 2 tokens
      const result2 = parse(parser, ["-a", "-b"]);
      assert.ok(result2.success);
      assert.equal((result2.value as { type: string }).type, "two");

      // parser3 consumes 3 tokens
      const result3 = parse(parser, ["-a", "-b", "-c"]);
      assert.ok(result3.success);
      assert.equal((result3.value as { type: string }).type, "three");
    });

    it("should handle command parsing with context-aware help", () => {
      const addCommand = command(
        "add",
        object({
          action: constant("add"),
          key: argument(string({ metavar: "KEY" })),
          value: argument(string({ metavar: "VALUE" })),
        }),
      );

      const listCommand = command(
        "list",
        object({
          action: constant("list"),
          pattern: optional(
            option("-p", "--pattern", string({ metavar: "PATTERN" })),
          ),
        }),
      );

      const contextualHelpParser = object({
        help: constant(true),
        commands: multiple(argument(string({ metavar: "COMMAND" }))),
        __help: flag("--help"),
      });

      const normalParser = object({
        help: constant(false),
        result: or(addCommand, listCommand),
      });

      const parser = longestMatch(normalParser, contextualHelpParser);

      // Normal command parsing: add key value
      const addResult = parse(parser, ["add", "key1", "value1"]);
      assert.ok(addResult.success);
      assert.equal((addResult.value as { help: boolean }).help, false);
      assert.equal(
        (addResult.value as { result: { action: string } }).result.action,
        "add",
      );

      // Context-aware help: list --help
      const helpResult = parse(parser, ["list", "--help"]);
      assert.ok(helpResult.success);
      assert.equal((helpResult.value as { help: boolean }).help, true);
      assert.deepStrictEqual(
        (helpResult.value as { commands: readonly string[] }).commands,
        ["list"],
      );
    });

    it("should handle failure cases correctly", () => {
      const parser1 = object({
        type: constant("one"),
        required: option("-r", string()),
      });

      const parser2 = object({
        type: constant("two"),
        required: option("-s", string()),
      });

      const parser = longestMatch(parser1, parser2);

      // Neither parser can handle this input
      const result = parse(parser, ["-t", "value"]);
      assert.ok(!result.success);
    });

    it("should handle empty parser list", () => {
      // longestMatch requires at least 2 parsers, so test with minimal parsers that fail
      const parser1 = object({
        type: constant("fail1"),
        req: option("-x", string()),
      });
      const parser2 = object({
        type: constant("fail2"),
        req: option("-y", string()),
      });
      const parser = longestMatch(parser1, parser2);
      const result = parse(parser, ["anything"]);
      assert.ok(!result.success);
    });

    it("should preserve type information correctly", () => {
      const stringParser = object({
        type: constant("string" as const),
        value: argument(string()),
      });

      const numberParser = object({
        type: constant("number" as const),
        value: argument(integer()),
      });

      const parser = longestMatch(stringParser, numberParser);

      const stringResult = parse(parser, ["hello"]);
      assert.ok(stringResult.success);
      assert.equal((stringResult.value as { type: string }).type, "string");
      assert.equal((stringResult.value as { value: string }).value, "hello");

      // For "42", both parsers could match (string and integer), but string parser
      // comes first and both consume same number of tokens, so string parser wins
      const ambiguousResult = parse(parser, ["42"]);
      assert.ok(ambiguousResult.success);
      assert.equal((ambiguousResult.value as { type: string }).type, "string");
      assert.equal((ambiguousResult.value as { value: string }).value, "42");

      // Test with input that only integer parser can handle (non-string that parses as int)
      // Actually, let's test with more specific parsers to demonstrate type preservation
      const numberOnlyResult = parse(parser, ["123"]);
      assert.ok(numberOnlyResult.success);
      // Both could parse "123", but stringParser comes first, so it wins
      assert.equal((numberOnlyResult.value as { type: string }).type, "string");
    });

    it("should handle documentation correctly", () => {
      const parser1 = object("Group A", {
        flag1: flag("-a", "--first"),
      });

      const parser2 = object("Group B", {
        flag2: flag("-b", "--second"),
      });

      const parser = longestMatch(parser1, parser2);

      // When no specific state, should show all options
      const fragments = parser.getDocFragments({ kind: "unavailable" });
      assert.equal(fragments.fragments.length, 2);

      const groupA = fragments.fragments.find((f: DocFragment) =>
        f.type === "section" && f.title === "Group A"
      );
      const groupB = fragments.fragments.find((f: DocFragment) =>
        f.type === "section" && f.title === "Group B"
      );

      assert.ok(groupA);
      assert.ok(groupB);
    });

    it("should handle priority correctly", () => {
      const lowPriorityParser = object({
        type: constant("low"),
        arg: argument(string()),
      });

      const highPriorityParser = command(
        "cmd",
        object({
          type: constant("high"),
        }),
      );

      const parser = longestMatch(lowPriorityParser, highPriorityParser);

      // longestMatch should use the highest priority among constituent parsers
      assert.equal(
        parser.priority,
        Math.max(
          lowPriorityParser.priority,
          highPriorityParser.priority,
        ),
      );
    });

    it("should handle state management correctly", () => {
      const parser1 = object({
        type: constant("first"),
        opt: option("-a", string()),
      });

      const parser2 = object({
        type: constant("second"),
        opt1: option("-a", string()),
        opt2: option("-b", string()),
      });

      const parser = longestMatch(parser1, parser2);

      // Parse incomplete input for parser2
      const context = {
        buffer: ["-a", "value1", "-b", "value2"],
        optionsTerminated: false,
        state: parser.initialState,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      assert.equal(result.next.buffer.length, 0); // All tokens consumed
      assert.equal(
        (result.next.state as [number, ParserResult<unknown>])[0],
        1,
      ); // Second parser selected

      // Complete the parsing
      const completedResult = parser.complete(result.next.state);
      assert.ok(completedResult.success);
      assert.equal((completedResult.value as { type: string }).type, "second");
    });

    it("should maintain consistent behavior with complex nested structures", () => {
      const simpleHelp = object({
        help: constant(true),
        global: flag("--help"),
      });

      const contextualHelp = object({
        help: constant(true),
        commands: multiple(argument(string({ metavar: "COMMAND" }))),
        flag: flag("--help"),
      });

      const normalCommand = object({
        help: constant(false),
        result: command(
          "test",
          object({
            action: constant("test"),
          }),
        ),
      });

      const parser = longestMatch(normalCommand, simpleHelp, contextualHelp);

      // Normal command
      const testResult = parse(parser, ["test"]);
      assert.ok(testResult.success);
      assert.equal((testResult.value as { help: boolean }).help, false);

      // Global help
      const globalHelpResult = parse(parser, ["--help"]);
      assert.ok(globalHelpResult.success);
      assert.equal((globalHelpResult.value as { help: boolean }).help, true);

      // Contextual help (longer match)
      const contextualHelpResult = parse(parser, ["test", "--help"]);
      assert.ok(contextualHelpResult.success);
      assert.equal(
        (contextualHelpResult.value as { help: boolean }).help,
        true,
      );
      assert.deepStrictEqual(
        (contextualHelpResult.value as { commands: readonly string[] })
          .commands,
        ["test"],
      );
    });
  });
});

describe("group", () => {
  it("should wrap a parser with identical parsing behavior", () => {
    const baseParser = object({
      verbose: flag("-v", "--verbose"),
      port: option("-p", "--port", integer()),
    });

    const groupedParser = group("Server Options", baseParser);

    // Should have same parsing behavior
    const result1 = parse(baseParser, ["-v", "-p", "8080"]);
    const result2 = parse(groupedParser, ["-v", "-p", "8080"]);

    assert.ok(result1.success);
    assert.ok(result2.success);
    assert.deepStrictEqual(result1.value, result2.value);
  });

  it("should preserve parser metadata", () => {
    const baseParser = object({
      verbose: flag("-v", "--verbose"),
    });

    const groupedParser = group("Options", baseParser);

    assert.equal(groupedParser.priority, baseParser.priority);
    assert.deepStrictEqual(groupedParser.usage, baseParser.usage);
    assert.deepStrictEqual(groupedParser.initialState, baseParser.initialState);
  });

  it("should wrap documentation in a labeled section", () => {
    const baseParser = object({
      verbose: flag("-v", "--verbose"),
      port: option("-p", "--port", integer()),
    });

    const groupedParser = group("Server Configuration", baseParser);

    const docs = groupedParser.getDocFragments(
      { kind: "available", state: groupedParser.initialState },
      undefined,
    );

    assert.ok(docs.fragments.length > 0);

    // Should have at least one labeled section
    const labeledSections = docs.fragments.filter(
      (f): f is DocFragment & { type: "section"; title: string } =>
        f.type === "section" && "title" in f && typeof f.title === "string",
    );

    assert.ok(labeledSections.length > 0);
    assert.ok(labeledSections.some((s) => s.title === "Server Configuration"));
  });

  it("should work with or() parser - realistic use case", () => {
    const outputFormat = or(
      map(flag("--json"), () => "json" as const),
      map(flag("--yaml"), () => "yaml" as const),
      map(flag("--xml"), () => "xml" as const),
    );

    const groupedFormat = group("Output Format", outputFormat);

    // Test parsing behavior
    const result = parse(groupedFormat, ["--json"]);
    assert.ok(result.success);
    assert.equal(result.value, "json");

    // Test documentation contains the group label
    const docs = groupedFormat.getDocFragments(
      { kind: "available", state: groupedFormat.initialState },
      undefined,
    );

    const labeledSections = docs.fragments.filter(
      (f): f is DocFragment & { type: "section"; title: string } =>
        f.type === "section" && "title" in f && typeof f.title === "string",
    );

    assert.ok(labeledSections.some((s) => s.title === "Output Format"));
  });

  it("should work with single flag() parser", () => {
    const debugOption = flag("--debug");
    const groupedDebug = group("Debug Options", debugOption);

    // Test parsing behavior
    const result = parse(groupedDebug, ["--debug"]);
    assert.ok(result.success);
    assert.equal(result.value, true);

    // Test documentation contains the group label
    const docs = groupedDebug.getDocFragments(
      { kind: "available", state: groupedDebug.initialState },
      undefined,
    );

    const labeledSections = docs.fragments.filter(
      (f): f is DocFragment & { type: "section"; title: string } =>
        f.type === "section" && "title" in f && typeof f.title === "string",
    );

    assert.ok(labeledSections.some((s) => s.title === "Debug Options"));
  });

  it("should work with multiple() parser", () => {
    const filesParser = multiple(argument(string({ metavar: "FILE" })));
    const groupedFiles = group("Input Files", filesParser);

    // Test parsing behavior
    const result = parse(groupedFiles, ["file1.txt", "file2.txt", "file3.txt"]);
    assert.ok(result.success);
    assert.deepStrictEqual(result.value, [
      "file1.txt",
      "file2.txt",
      "file3.txt",
    ]);

    // Test documentation contains the group label
    const docs = groupedFiles.getDocFragments(
      { kind: "available", state: groupedFiles.initialState },
      undefined,
    );

    const labeledSections = docs.fragments.filter(
      (f): f is DocFragment & { type: "section"; title: string } =>
        f.type === "section" && "title" in f && typeof f.title === "string",
    );

    assert.ok(labeledSections.some((s) => s.title === "Input Files"));
  });

  it("should handle nested groups", () => {
    const innerParser = group(
      "Inner Group",
      object({
        debug: flag("--debug"),
      }),
    );

    const outerParser = group("Outer Group", innerParser);

    const result = parse(outerParser, ["--debug"]);
    assert.ok(result.success);
    assert.deepStrictEqual(result.value, { debug: true });

    // Should have nested section structure
    const docs = outerParser.getDocFragments(
      { kind: "available", state: outerParser.initialState },
      undefined,
    );

    const labeledSections = docs.fragments.filter(
      (f): f is DocFragment & { type: "section"; title: string } =>
        f.type === "section" && "title" in f && typeof f.title === "string",
    );

    assert.ok(labeledSections.some((s) => s.title === "Outer Group"));
    assert.ok(labeledSections.some((s) => s.title === "Inner Group"));
  });

  it("should preserve type information", () => {
    const baseParser = object({
      count: option("-c", "--count", integer()),
      name: option("-n", "--name", string()),
    });

    const groupedParser = group("Test Options", baseParser);

    // Type should be inferred correctly
    type ParsedType = InferValue<typeof groupedParser>;
    const result = parse(groupedParser, ["-c", "42", "-n", "test"]);

    assert.ok(result.success);
    const value: ParsedType = result.value;
    assert.equal(value.count, 42);
    assert.equal(value.name, "test");
  });

  it("should work with optional() parser in object context", () => {
    // optional() is typically used within object parsers
    const appOptions = object({
      verbose: optional(flag("--verbose")),
    });
    const groupedOptions = group("Verbosity Control", appOptions);

    // Test parsing behavior - with flag
    const result1 = parse(groupedOptions, ["--verbose"]);
    assert.ok(result1.success);
    assert.deepStrictEqual(result1.value, { verbose: true });

    // Test parsing behavior - without flag
    const result2 = parse(groupedOptions, []);
    assert.ok(result2.success);
    assert.deepStrictEqual(result2.value, { verbose: undefined });

    // Test documentation
    const docs = groupedOptions.getDocFragments(
      { kind: "available", state: groupedOptions.initialState },
      undefined,
    );

    const labeledSections = docs.fragments.filter(
      (f): f is DocFragment & { type: "section"; title: string } =>
        f.type === "section" && "title" in f && typeof f.title === "string",
    );

    assert.ok(labeledSections.some((s) => s.title === "Verbosity Control"));
  });

  it("should work with withDefault() parser in object context", () => {
    // withDefault() is typically used within object parsers
    const serverOptions = object({
      port: withDefault(option("--port", integer()), 3000),
    });
    const groupedServer = group("Server Configuration", serverOptions);

    // Test parsing behavior - with option
    const result1 = parse(groupedServer, ["--port", "8080"]);
    assert.ok(result1.success);
    assert.deepStrictEqual(result1.value, { port: 8080 });

    // Test parsing behavior - without option (uses default)
    const result2 = parse(groupedServer, []);
    assert.ok(result2.success);
    assert.deepStrictEqual(result2.value, { port: 3000 });

    // Test documentation
    const docs = groupedServer.getDocFragments(
      { kind: "available", state: groupedServer.initialState },
      undefined,
    );

    const labeledSections = docs.fragments.filter(
      (f): f is DocFragment & { type: "section"; title: string } =>
        f.type === "section" && "title" in f && typeof f.title === "string",
    );

    assert.ok(labeledSections.some((s) => s.title === "Server Configuration"));
  });

  it("should demonstrate realistic CLI grouping scenario", () => {
    // This shows how group() would be used in a real CLI app
    const logLevel = or(
      map(flag("--debug"), () => "debug" as const),
      map(flag("--verbose"), () => "verbose" as const),
      map(flag("--quiet"), () => "quiet" as const),
    );

    const inputSource = multiple(
      argument(string({ metavar: "FILE" })),
      { min: 1 },
    );

    const outputOptions = optional(
      option("--output", string({ metavar: "PATH" })),
    );

    // Group them with meaningful labels
    const groupedLogLevel = group("Logging Options", logLevel);
    const groupedInputSource = group("Input Files", inputSource);
    const groupedOutputOptions = group("Output Options", outputOptions);

    // These would typically be combined in an object() parser in a real app
    const logResult = parse(groupedLogLevel, ["--debug"]);
    assert.ok(logResult.success);
    assert.equal(logResult.value, "debug");

    const inputResult = parse(groupedInputSource, ["file1.txt", "file2.txt"]);
    assert.ok(inputResult.success);
    assert.deepStrictEqual(inputResult.value, ["file1.txt", "file2.txt"]);

    const outputResult = parse(groupedOutputOptions, [
      "--output",
      "result.txt",
    ]);
    assert.ok(outputResult.success);
    assert.equal(outputResult.value, "result.txt");

    // Test that each has proper documentation grouping
    const logDocs = groupedLogLevel.getDocFragments(
      { kind: "available", state: groupedLogLevel.initialState },
      undefined,
    );
    const logSections = logDocs.fragments.filter(
      (f): f is DocFragment & { type: "section"; title: string } =>
        f.type === "section" && "title" in f && typeof f.title === "string",
    );
    assert.ok(logSections.some((s) => s.title === "Logging Options"));

    const inputDocs = groupedInputSource.getDocFragments(
      { kind: "available", state: groupedInputSource.initialState },
      undefined,
    );
    const inputSections = inputDocs.fragments.filter(
      (f): f is DocFragment & { type: "section"; title: string } =>
        f.type === "section" && "title" in f && typeof f.title === "string",
    );
    assert.ok(inputSections.some((s) => s.title === "Input Files"));

    const outputDocs = groupedOutputOptions.getDocFragments(
      { kind: "available", state: groupedOutputOptions.initialState },
      undefined,
    );
    const outputSections = outputDocs.fragments.filter(
      (f): f is DocFragment & { type: "section"; title: string } =>
        f.type === "section" && "title" in f && typeof f.title === "string",
    );
    assert.ok(outputSections.some((s) => s.title === "Output Options"));
  });
});
