import type { ErrorMessage } from "@optique/core/error";
import {
  argument,
  constant,
  multiple,
  object,
  option,
  optional,
  or,
  parse,
  tuple,
} from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function assertErrorIncludes(error: ErrorMessage, text: string): void {
  if (typeof error === "string") {
    assert.ok(error.includes(text));
  } else {
    const combined = error.message.join("");
    assert.ok(combined.includes(text));
  }
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
        assert.ok(result.next.state.success);
        if (result.next.state.success) {
          assert.equal(result.next.state.value, true);
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
        assert.ok(result.next.state.success);
        if (result.next.state.success) {
          assert.equal(result.next.state.value, true);
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
      if (result1.success && result1.next.state.success) {
        assert.equal(result1.next.state.value, true);
      }

      const context2 = {
        buffer: ["--verbose"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
      };
      const result2 = parser.parse(context2);
      assert.ok(result2.success);
      if (result2.success && result2.next.state.success) {
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
        assert.ok(result.next.state.success);
        if (result.next.state.success) {
          assert.equal(result.next.state.value, true);
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
        assert.equal(result.error, "No more options can be parsed.");
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
        assert.ok(result.next.state.success);
        if (result.next.state.success) {
          assert.equal(result.next.state.value, 8080);
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
        assert.ok(result.next.state.success);
        if (result.next.state.success) {
          assert.equal(result.next.state.value, 8080);
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
        assert.ok(result.next.state.success);
        if (result.next.state.success) {
          assert.equal(result.next.state.value, 8080);
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
        assert.ok(result.next.state.success);
        if (result.next.state.success) {
          assert.equal(result.next.state.value, "Alice");
        }
      }
    });

    it("should propagate value parser failures", () => {
      const parser = option("--port", integer({ min: 1, max: 65535 }));
      const context = {
        buffer: ["--port", "invalid"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
      };

      const result = parser.parse(context);
      assert.ok(result.success);
      if (result.success) {
        assert.ok(!result.next.state.success);
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

  it("should handle empty arguments gracefully", () => {
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
      assert.equal(result.value.length, 2);
      assert.equal(result.value[0], "Alice");
      assert.equal(result.value[1], true);
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
      assert.equal(result.value[0], "Bob");
      assert.equal(result.value[1], true);
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
      assert.equal(result1.value[0], "Alice");
      assert.equal(result1.value[1], 30);
      assert.equal(result1.value[2], true);
    }

    const result2 = parse(parser, ["-n", "Bob", "-v"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value[0], "Bob");
      assert.equal(result2.value[1], undefined);
      assert.equal(result2.value[2], true);
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
      assert.equal(result.value[0], "input.txt");
      assert.equal(result.value[1], true);
      assert.equal(result.value[2], "output.txt");
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
      assert.equal(result.value[0], "file1.txt");
      assert.equal(result.value[1], "file2.txt");
      assert.equal(result.value[2], true);
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
      assert.equal(result.value[0], "input.txt");
      assert.equal(result.value[1], "json");
      assert.equal(result.value[2], "output.txt");
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
      assert.equal(result.value[0], "convert");
      assert.equal(result.value[1], "input.md");
      assert.equal(result.value[2], "json");
      assert.equal(result.value[3], true);
      assert.equal(result.value[4], "output.json");
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
    const invalidState = { success: false as const, error: "Missing argument" };

    const result = parser.complete(invalidState);
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(result.error, "Missing argument");
    }
  });

  it("should work with different value parser constraints", () => {
    const fileParser = argument(string({ pattern: /\.(txt|md)$/ }));
    const portParser = argument(integer({ min: 1024, max: 65535 }));

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

    const failedState = { success: false as const, error: "Port must be >= 1" };
    const completeResult = optionalParser.complete([failedState]);
    assert.ok(!completeResult.success);
    if (!completeResult.success) {
      assert.equal(completeResult.error, "Port must be >= 1");
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
        assert.ok(parseResult.next.state[0].success);
        if (parseResult.next.state[0].success) {
          assert.equal(parseResult.next.state[0].value, "test");
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
        option("-p", "--port", integer({ min: 1024, max: 65535 })),
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
    const baseParser = option("-p", "--port", integer({ min: 1, max: 65535 }));
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
      { success: false as const, error: "Invalid number" },
      { success: true as const, value: 7 },
    ];

    const completeResult = multipleParser.complete(mockStates);
    assert.ok(!completeResult.success);
    if (!completeResult.success) {
      assert.equal(completeResult.error, "Invalid number");
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
      integer({ min: 1024, max: 65535 }),
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
      assert.equal(stringResult.value[0], "hello");
      assert.equal(stringResult.value[1], "world");
    }

    const integerResult = parse(integerMultiple, ["-i", "42", "-i", "100"]);
    assert.ok(integerResult.success);
    if (integerResult.success) {
      assert.equal(integerResult.value.length, 2);
      assert.equal(typeof integerResult.value[0], "number");
      assert.equal(integerResult.value[0], 42);
      assert.equal(integerResult.value[1], 100);
    }

    const booleanResult = parse(booleanMultiple, ["-b", "-b"]);
    assert.ok(booleanResult.success);
    if (booleanResult.success) {
      assert.equal(booleanResult.value.length, 2);
      assert.equal(typeof booleanResult.value[0], "boolean");
      assert.equal(booleanResult.value[0], true);
      assert.equal(booleanResult.value[1], true);
    }
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
      assertErrorIncludes(result.error, "No parser matched");
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

describe("Integration tests", () => {
  it("should handle complex nested parser combinations", () => {
    const serverParser = object("Server", {
      port: option("-p", "--port", integer({ min: 1, max: 65535 })),
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
      port: option("-p", integer({ min: 1024, max: 65535 })),
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
      port: option("-p", "--port", integer({ min: 1, max: 65535 })),
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
