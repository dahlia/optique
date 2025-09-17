import {
  formatMessage,
  type Message,
  message,
  text,
} from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import {
  concat,
  getDocPage,
  group,
  type InferValue,
  longestMatch,
  merge,
  object,
  or,
  parse,
  type ParserResult,
  tuple,
} from "@optique/core/parser";
import {
  argument,
  command,
  constant,
  flag,
  option,
} from "@optique/core/primitives";
import type { DocEntry, DocFragment } from "@optique/core/doc";
import { integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function assertErrorIncludes(error: Message, text: string): void {
  const formatted = formatMessage(error);
  assert.ok(formatted.includes(text));
}

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
      assertErrorIncludes(result.error, "No matching option or argument found");
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
      assertErrorIncludes(result.error, "No matching option or argument found");
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
        "No matching option or command found.",
      );
    }
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
});

describe("object() error customization", () => {
  it("should use custom unexpectedInput error", () => {
    const parser = object({
      verbose: flag("-v", "--verbose"),
      output: option("-o", string()),
    }, {
      errors: {
        unexpectedInput:
          message`Unknown option detected. Check your command syntax.`,
      },
    });

    const context = {
      buffer: ["--unknown"],
      state: {
        verbose: undefined,
        output: undefined,
      },
      optionsTerminated: false,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Unknown option detected. Check your command syntax.",
      );
    }
  });

  it("should use custom unexpectedInput error with function", () => {
    const parser = object({
      verbose: flag("-v", "--verbose"),
    }, {
      errors: {
        unexpectedInput: (token) =>
          message`Invalid option: ${token}. Use --help for available options.`,
      },
    });

    const context = {
      buffer: ["--invalid"],
      state: {
        verbose: undefined,
      },
      optionsTerminated: false,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        'Invalid option: "--invalid". Use --help for available options.',
      );
    }
  });

  it("should use custom endOfInput error", () => {
    const parser = object({
      file: argument(string()),
      verbose: flag("-v", "--verbose"),
    }, {
      errors: {
        endOfInput:
          message`Please provide more arguments to complete the command.`,
      },
    });

    // This test is tricky because endOfInput occurs when buffer is empty
    // and parsers cannot be completed. Let me create a scenario where this happens.
    const context = {
      buffer: [],
      state: {
        file: undefined,
        verbose: undefined,
      },
      optionsTerminated: false,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Please provide more arguments to complete the command.",
      );
    }
  });

  it("should use custom error in labeled object", () => {
    const parser = object("CLI Options", {
      help: flag("-h", "--help"),
      version: flag("--version"),
    }, {
      errors: {
        unexpectedInput: message`Unrecognized CLI option.`,
      },
    });

    const context = {
      buffer: ["--invalid"],
      state: {
        help: undefined,
        version: undefined,
      },
      optionsTerminated: false,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Unrecognized CLI option.",
      );
    }
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
    });
    assert.ok(firstResult.success);

    // Second call should fail with custom error
    const secondResult = parser.parse({
      buffer: ["second"],
      state: firstResult.success ? firstResult.next.state : undefined,
      optionsTerminated: false,
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
