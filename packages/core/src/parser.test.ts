import type { ErrorMessage } from "@optique/core/error";
import { constant, object, option, or, parse } from "@optique/core/parser";
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
});
