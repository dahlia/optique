import {
  longestMatch,
  merge,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import {
  formatMessage,
  type Message,
  message,
  text,
} from "@optique/core/message";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { getDocPage, parse } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function assertErrorIncludes(error: Message, text: string): void {
  const formatted = formatMessage(error);
  assert.ok(formatted.includes(text));
}

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
            usage: [],
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
            usage: [],
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

  it("should show subcommand option descriptions with getDocPage", () => {
    const targetDesc = message`Target language code`;
    const sourceDesc = message`Source language code`;
    const subParser = object({
      target: option("-t", "--target", string({ metavar: "LANG" }), {
        description: targetDesc,
      }),
      source: option("-s", "--source", string({ metavar: "LANG" }), {
        description: sourceDesc,
      }),
    });
    const translateCmd = command("translate", subParser);
    const configCmd = command("config", object({}));
    const parser = or(translateCmd, configCmd);

    const doc = getDocPage(parser, ["translate"]);
    assert.ok(doc);

    // Sections should include option descriptions
    const allEntries = doc.sections.flatMap((s) => s.entries);
    const targetEntry = allEntries.find(
      (e) => e.term.type === "option" && e.term.names.includes("--target"),
    );
    const sourceEntry = allEntries.find(
      (e) => e.term.type === "option" && e.term.names.includes("--source"),
    );

    assert.ok(targetEntry, "Should have --target option entry");
    assert.ok(sourceEntry, "Should have --source option entry");
    assert.deepEqual(targetEntry?.description, targetDesc);
    assert.deepEqual(sourceEntry?.description, sourceDesc);
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

  it("should resolve nested exclusive usage when using longestMatch with subcommands", () => {
    // This test reproduces the bug where `help add` shows full usage instead of
    // subcommand-specific usage when the parser is combined with longestMatch()
    const addCommand = command(
      "add",
      object({
        name: option("-n", "--name", string()),
      }),
    );

    const listCommand = command(
      "list",
      object({
        pattern: argument(string()),
      }),
    );

    const globalOptions = object({
      verbose: optional(option("--verbose")),
    });

    const parser = merge(globalOptions, or(addCommand, listCommand));

    // Simulate what facade.ts does - combine with help command via longestMatch
    const helpCommand = command(
      "help",
      multiple(argument(string())),
    );

    const combinedParser = longestMatch(parser, helpCommand);

    // Get doc page for "add" subcommand
    const doc = getDocPage(combinedParser, ["add"]);
    assert.ok(doc);
    assert.ok(doc.usage && doc.usage.length > 0);

    // The usage should show only the "add" command usage, not all alternatives
    // Expected: [command "add", option "-n/--name", optional "--verbose"]
    // NOT: [exclusive [...add/list...], optional [...], exclusive [...help...]]
    if (doc.usage) {
      // First term should be the "add" command, not an exclusive
      const firstTerm = doc.usage[0];
      assert.equal(
        firstTerm.type,
        "command",
        `Expected first usage term to be 'command', got '${firstTerm.type}'`,
      );
      if (firstTerm.type === "command") {
        assert.equal(firstTerm.name, "add");
      }
    }
  });
});

describe("Error message customization", () => {
  it("should use custom noMatch error in or() combinator", () => {
    const parser = or(
      command("add", constant("add")),
      command("remove", constant("remove")),
      {
        errors: {
          noMatch: message`Please use either 'add' or 'remove' command.`,
        },
      },
    );

    const result = parse(parser, []);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Please use either 'add' or 'remove' command.",
      );
    }
  });

  it("should use custom unexpectedInput error in or() combinator", () => {
    const parser = or(
      command("add", constant("add")),
      command("remove", constant("remove")),
      {
        errors: {
          unexpectedInput: (token) =>
            message`Unknown command '${text(token)}'. Use 'add' or 'remove'.`,
        },
      },
    );

    const result = parse(parser, ["unknown"]);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Unknown command 'unknown'. Use 'add' or 'remove'.",
      );
    }
  });

  it("should use custom noMatch error in longestMatch() combinator", () => {
    const parser = longestMatch(
      command("add", constant("add")),
      command("remove", constant("remove")),
      {
        errors: {
          noMatch: message`Please specify a valid command: add or remove.`,
        },
      },
    );

    const result = parse(parser, []);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Please specify a valid command: add or remove.",
      );
    }
  });

  it("should use static unexpectedInput error in longestMatch() combinator", () => {
    const parser = longestMatch(
      command("add", constant("add")),
      command("remove", constant("remove")),
      {
        errors: {
          unexpectedInput: message`Invalid command. Supported: add, remove.`,
        },
      },
    );

    const result = parse(parser, ["invalid"]);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Invalid command. Supported: add, remove.",
      );
    }
  });

  it("should use default messages when no custom errors are provided", () => {
    const parser = or(
      command("add", constant("add")),
      command("remove", constant("remove")),
    );

    const result = parse(parser, []);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "No matching command found.",
      );
    }
  });
});

describe("merge() should propagate brief/description/footer from inner parsers", () => {
  it("should propagate brief, description, and footer from command via merge(or(...), ...)", () => {
    const syncCommand = command(
      "sync",
      object({
        verbose: option("-v", "--verbose"),
      }),
      {
        brief: message`Synchronize data.`,
        description: message`Synchronize data between local and remote.`,
        footer: message`Example: myapp sync -v`,
      },
    );

    const buildCommand = command(
      "build",
      object({
        output: option("-o", "--output", string()),
      }),
      {
        brief: message`Build the project.`,
        description: message`Build the project from source.`,
      },
    );

    const globalOptions = object({
      debug: option("-d", "--debug"),
    });

    const parser = merge(or(syncCommand, buildCommand), globalOptions);

    // When a subcommand is selected, getDocPage should include its
    // brief (shown at top of help page), description (shown below Usage),
    // and footer.
    const syncDoc = getDocPage(parser, ["sync"]);
    assert.ok(syncDoc, "syncDoc should not be undefined");
    assert.deepEqual(syncDoc!.brief, message`Synchronize data.`);
    assert.deepEqual(
      syncDoc!.description,
      message`Synchronize data between local and remote.`,
    );
    assert.deepEqual(syncDoc!.footer, message`Example: myapp sync -v`);

    const buildDoc = getDocPage(parser, ["build"]);
    assert.ok(buildDoc, "buildDoc should not be undefined");
    assert.deepEqual(buildDoc!.brief, message`Build the project.`);
    assert.deepEqual(
      buildDoc!.description,
      message`Build the project from source.`,
    );
  });
});
