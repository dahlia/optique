import {
  concat,
  conditional,
  DuplicateOptionError,
  group,
  longestMatch,
  merge,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import type { DocEntry, DocFragment } from "@optique/core/doc";
import {
  formatMessage,
  type Message,
  message,
  text,
} from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import {
  type InferValue,
  parse,
  type ParserResult,
} from "@optique/core/parser";
import {
  argument,
  command,
  constant,
  flag,
  option,
} from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function assertErrorIncludes(error: Message, text: string): void {
  const formatted = formatMessage(error);
  assert.ok(formatted.includes(text));
}

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

describe("or() - duplicate option handling", () => {
  it("should allow duplicate option names in different branches", () => {
    // or() allows duplicates because branches are mutually exclusive
    const parser = or(
      option("-v", "--verbose"),
      option("-v", "--version"),
    );

    const result = parse(parser, ["-v"]);
    // Should succeed - first parser wins
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, true);
    }
  });

  it("should allow same options in nested or branches", () => {
    const parser = or(
      object({ verbose: option("-v") }),
      object({ version: option("-v") }),
      object({ verify: option("-v") }),
    );

    const result = parse(parser, ["-v"]);
    // Should succeed - first matching branch wins
    assert.ok(result.success);
  });
});

describe("or() error customization", () => {
  it("should use custom suggestions formatter", () => {
    const parser = or(
      command("deploy", argument(string())),
      command("build", argument(string())),
      {
        errors: {
          suggestions: (suggestions) => {
            if (suggestions.length === 0) return [];
            return message`Available commands: ${text(suggestions.join(", "))}`;
          },
        },
      },
    );

    const result = parse(parser, ["deploi"]);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(errorMessage.includes("Available commands"));
      assert.ok(errorMessage.includes("deploy"));
    }
  });

  it("should use custom suggestions formatter to disable suggestions", () => {
    const parser = or(
      command("deploy", argument(string())),
      command("build", argument(string())),
      {
        errors: {
          suggestions: () => [],
        },
      },
    );

    const result = parse(parser, ["deploi"]);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(!errorMessage.includes("Did you mean"));
      assert.ok(!errorMessage.includes("deploy"));
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
      usage: parser.usage,
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

describe("longestMatch() error customization", () => {
  it("should use custom suggestions formatter", () => {
    const parser = longestMatch(
      command("deploy", argument(string())),
      command("build", argument(string())),
      {
        errors: {
          suggestions: (suggestions) => {
            if (suggestions.length === 0) return [];
            return message`Try one of: ${text(suggestions.join(" | "))}`;
          },
        },
      },
    );

    const result = parse(parser, ["deploi"]);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(errorMessage.includes("Try one of"));
      assert.ok(errorMessage.includes("deploy"));
    }
  });

  it("should use custom suggestions formatter to disable suggestions", () => {
    const parser = longestMatch(
      command("deploy", argument(string())),
      command("build", argument(string())),
      {
        errors: {
          suggestions: () => [],
        },
      },
    );

    const result = parse(parser, ["deploi"]);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(!errorMessage.includes("Did you mean"));
      assert.ok(!errorMessage.includes("deploy"));
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
      usage: parser.usage,
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
      assertErrorIncludes(result.error, "No matching option found");
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
      usage: parser.usage,
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
      usage: parser.usage,
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
      usage: parser.usage,
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
      usage: parser.usage,
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

  it("should use custom suggestions formatter", () => {
    const parser = object({
      verbose: flag("-v", "--verbose"),
      output: option("-o", "--output", string()),
    }, {
      errors: {
        suggestions: (suggestions) => {
          if (suggestions.length === 0) return [];
          return message`Perhaps you meant: ${
            text(suggestions.map((s) => `"${s}"`).join(", "))
          }?`;
        },
      },
    });

    const context = {
      buffer: ["--verbos"],
      state: {
        verbose: undefined,
        output: undefined,
      },
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(errorMessage.includes("Perhaps you meant"));
      assert.ok(errorMessage.includes("--verbose"));
    }
  });

  it("should use custom suggestions formatter to disable suggestions", () => {
    const parser = object({
      verbose: flag("-v", "--verbose"),
      output: option("-o", "--output", string()),
    }, {
      errors: {
        suggestions: () => [],
      },
    });

    const context = {
      buffer: ["--verbos"],
      state: {
        verbose: undefined,
        output: undefined,
      },
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = parser.parse(context);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(!errorMessage.includes("Did you mean"));
      assert.ok(!errorMessage.includes("--verbose"));
    }
  });
});

describe("object() - duplicate option detection", () => {
  // Note: Duplicate option detection now happens at construction time,
  // not at parse time. This is a programmer error, not a user error.

  it("should throw at construction time for duplicate short options", () => {
    assert.throws(
      () =>
        object({
          verbose: option("-v", "--verbose"),
          version: option("-v", "--version"),
        }),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "-v");
        assert.ok(error.sources.includes("verbose"));
        assert.ok(error.sources.includes("version"));
        return true;
      },
    );
  });

  it("should throw at construction time for duplicate long options", () => {
    assert.throws(
      () =>
        object({
          foo: option("--opt", "-f"),
          bar: option("--opt", "-b"),
        }),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "--opt");
        assert.ok(error.sources.includes("foo"));
        assert.ok(error.sources.includes("bar"));
        return true;
      },
    );
  });

  it("should throw at construction time for duplicates across 3+ fields", () => {
    assert.throws(
      () =>
        object({
          alpha: option("-x"),
          beta: option("-x"),
          gamma: option("-x"),
        }),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "-x");
        // At least 2 of the 3 sources should be in the error
        // (order of detection may vary)
        assert.ok(error.sources.length >= 2);
        return true;
      },
    );
  });

  it("should allow non-conflicting options", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      output: option("-o", "--output", string()),
    });

    const result = parse(parser, ["-v", "-o", "file.txt"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.output, "file.txt");
    }
  });

  it("should throw at construction time for duplicates in nested objects", () => {
    assert.throws(
      () =>
        object({
          opts: object({
            verbose: option("-v"),
          }),
          flags: object({
            version: option("-v"),
          }),
        }),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "-v");
        return true;
      },
    );
  });

  it("should allow opt-out with allowDuplicates option", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      version: option("-v", "--version"),
    }, { allowDuplicates: true });

    const result = parse(parser, ["-v"]);
    // Should succeed - first parser wins
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.version, false);
    }
  });

  it("should not throw for flags with different option names", () => {
    const parser = object({
      verbose: option("-v", "--verbose"),
      quiet: option("-q", "--quiet"),
      debug: option("-d", "--debug"),
    });

    const result = parse(parser, ["-v", "-d"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.quiet, false);
      assert.equal(result.value.debug, true);
    }
  });

  it("should throw at construction time for duplicate aliases", () => {
    assert.throws(
      () =>
        object({
          foo: option("-f", "--foo", "--file"),
          bar: option("-b", "--bar", "--file"),
        }),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "--file");
        return true;
      },
    );
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

describe("tuple() - duplicate option detection", () => {
  it("should throw at construction time for duplicate short options", () => {
    assert.throws(
      () =>
        tuple([
          option("-v", "--verbose"),
          option("-v", "--version"),
        ]),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "-v");
        assert.ok(error.sources.includes("0"));
        assert.ok(error.sources.includes("1"));
        return true;
      },
    );
  });

  it("should allow non-conflicting options", () => {
    const parser = tuple([
      option("-v", "--verbose"),
      option("-o", "--output", string()),
    ]);

    const result = parse(parser, ["-v", "-o", "file.txt"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], true);
      assert.equal(result.value[1], "file.txt");
    }
  });

  it("should allow opt-out with allowDuplicates option", () => {
    const parser = tuple([
      option("-v", "--verbose"),
      option("-v", "--version"),
    ], { allowDuplicates: true });

    const result = parse(parser, ["-v"]);
    // Should succeed - first parser wins
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], true);
      assert.equal(result.value[1], false);
    }
  });

  it("should throw at construction time for duplicates in deeply nested structures", () => {
    assert.throws(
      () =>
        object({
          a: optional(object({
            x: option("--opt", "-x"),
          })),
          b: multiple(
            object({
              y: option("--opt", "-y"),
            }),
            { min: 0 },
          ),
        }),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "--opt");
        assert.ok(error.sources.includes("a"));
        assert.ok(error.sources.includes("b"));
        return true;
      },
    );
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
      usage: parser.usage,
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
      usage: parser.usage,
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

  it("should parse options inside subcommands when merged with or() (#67)", () => {
    // Regression test for https://github.com/dahlia/optique/issues/67
    const globalOptions = object({
      global: optional(flag("--global")),
    });

    const sub1Command = command(
      "sub1",
      object({
        cmd: constant("sub1" as const),
        theOption: optional(option("-o", "--option", string())),
      }),
    );

    const sub2Command = command(
      "sub2",
      object({
        cmd: constant("sub2" as const),
      }),
    );

    const parser = merge(globalOptions, or(sub1Command, sub2Command));

    // Test: sub1 with its option
    const result1 = parse(parser, ["sub1", "-o", "foo"]);
    assert.ok(result1.success, "sub1 -o foo should parse successfully");
    if (result1.success) {
      assert.equal(result1.value.cmd, "sub1");
      assert.equal(result1.value.theOption, "foo");
      assert.equal(result1.value.global, undefined);
    }

    // Test: sub1 without option
    const result2 = parse(parser, ["sub1"]);
    assert.ok(result2.success, "sub1 should parse successfully");
    if (result2.success) {
      assert.equal(result2.value.cmd, "sub1");
      assert.equal(result2.value.theOption, undefined);
    }

    // Test: sub2
    const result3 = parse(parser, ["sub2"]);
    assert.ok(result3.success, "sub2 should parse successfully");
    if (result3.success) {
      assert.equal(result3.value.cmd, "sub2");
    }

    // Test: sub1 with global option
    const result4 = parse(parser, ["--global", "sub1", "-o", "bar"]);
    assert.ok(
      result4.success,
      "--global sub1 -o bar should parse successfully",
    );
    if (result4.success) {
      assert.equal(result4.value.global, true);
      assert.equal(result4.value.cmd, "sub1");
      assert.equal(result4.value.theOption, "bar");
    }
  });
});

describe("merge() - duplicate option detection", () => {
  it("should throw at construction time for duplicate options", () => {
    const parser1 = object({
      verbose: option("-v", "--verbose"),
    });
    const parser2 = object({
      version: option("-v", "--version"),
    });

    assert.throws(
      () => merge(parser1, parser2),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "-v");
        return true;
      },
    );
  });

  it("should allow non-conflicting merged parsers", () => {
    const parser1 = object({
      verbose: option("-v", "--verbose"),
    });
    const parser2 = object({
      output: option("-o", "--output", string()),
    });

    const parser = merge(parser1, parser2);
    const result = parse(parser, ["-v", "-o", "file.txt"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.output, "file.txt");
    }
  });

  it("should throw at construction time for duplicates across 3+ merged parsers", () => {
    const parser1 = object({
      verbose: option("-v", "--verbose"),
    });
    const parser2 = object({
      debug: option("-d", "--debug"),
    });
    const parser3 = object({
      version: option("-v", "--version"),
    });

    assert.throws(
      () => merge(parser1, parser2, parser3),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "-v");
        return true;
      },
    );
  });

  it("should allow opt-out with allowDuplicates option (2 parsers)", () => {
    const parser1 = object({
      verbose: option("-v", "--verbose"),
    });
    const parser2 = object({
      version: option("-v", "--version"),
    });

    const parser = merge(parser1, parser2, { allowDuplicates: true });
    const result = parse(parser, ["-v"]);
    // Should succeed - first parser wins
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.version, false);
    }
  });

  it("should report source parsers in original argument order", () => {
    const parser1 = object({
      verbose: option("-v", "--verbose"),
    });
    const parser2 = object({
      debug: option("-d", "--debug"),
    });
    const parser3 = object({
      version: option("-v", "--version"),
    });

    assert.throws(
      () => merge(parser1, parser2, parser3),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "-v");
        // Should report positions 0 and 2 (original argument order)
        assert.ok(error.sources.includes("0"));
        assert.ok(error.sources.includes("2"));
        return true;
      },
    );
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

describe("group() - duplicate option detection", () => {
  it("should throw at construction time for duplicates in grouped object parsers", () => {
    assert.throws(
      () =>
        group(
          "Options",
          object({
            verbose: option("-v", "--verbose"),
            version: option("-v", "--version"),
          }),
        ),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "-v");
        return true;
      },
    );
  });

  it("should allow non-conflicting options in grouped parsers", () => {
    const parser = group(
      "Options",
      object({
        verbose: option("-v", "--verbose"),
        output: option("-o", "--output", string()),
      }),
    );

    const result = parse(parser, ["-v", "-o", "file.txt"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.output, "file.txt");
    }
  });

  it("should throw at construction time for duplicates in grouped tuple parsers", () => {
    assert.throws(
      () =>
        group(
          "Flags",
          tuple([
            option("-v", "--verbose"),
            option("-v", "--version"),
          ]),
        ),
      (error: DuplicateOptionError) => {
        assert.ok(error instanceof DuplicateOptionError);
        assert.equal(error.optionName, "-v");
        return true;
      },
    );
  });
});

describe("conditional", () => {
  describe("basic parsing", () => {
    it("should select correct branch based on discriminator value", () => {
      const parser = conditional(
        option("--type", choice(["a", "b"])),
        {
          a: object({ foo: option("--foo", string()) }),
          b: object({ bar: option("--bar", integer()) }),
        },
        object({}),
      );

      const resultA = parse(parser, ["--type", "a", "--foo", "hello"]);
      assert.ok(resultA.success);
      if (resultA.success) {
        assert.deepEqual(resultA.value, ["a", { foo: "hello" }]);
      }

      const resultB = parse(parser, ["--type", "b", "--bar", "42"]);
      assert.ok(resultB.success);
      if (resultB.success) {
        assert.deepEqual(resultB.value, ["b", { bar: 42 }]);
      }
    });

    it("should use default branch when discriminator not provided", () => {
      const parser = conditional(
        option("--type", choice(["a", "b"])),
        {
          a: object({ foo: option("--foo", string()) }),
          b: object({ bar: option("--bar", integer()) }),
        },
        object({ defaultOpt: option("--default", string()) }),
      );

      const result = parse(parser, ["--default", "value"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, [undefined, { defaultOpt: "value" }]);
      }
    });

    it("should fail when discriminator missing and no default branch", () => {
      const parser = conditional(
        option("--type", choice(["a", "b"])),
        {
          a: object({ foo: option("--foo", string()) }),
          b: object({ bar: option("--bar", integer()) }),
        },
      );

      const result = parse(parser, ["--foo", "hello"]);
      assert.ok(!result.success);
    });

    it("should work with empty branch parsers", () => {
      const parser = conditional(
        option("--mode", choice(["fast", "slow"])),
        {
          fast: object({}),
          slow: object({}),
        },
        object({}),
      );

      const result = parse(parser, ["--mode", "fast"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, ["fast", {}]);
      }
    });
  });

  describe("error handling", () => {
    it("should provide contextual error when branch option missing", () => {
      const parser = conditional(
        option("--type", choice(["a"])),
        {
          a: object({ required: option("--required", string()) }),
        },
        object({}),
      );

      const result = parse(parser, ["--type", "a"]);
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "--required");
      }
    });

    it("should fail when invalid discriminator value provided", () => {
      const parser = conditional(
        option("--type", choice(["a", "b"])),
        {
          a: object({}),
          b: object({}),
        },
        object({}),
      );

      const result = parse(parser, ["--type", "invalid"]);
      assert.ok(!result.success);
    });
  });

  describe("type inference", () => {
    it("should infer correct tuple union type", () => {
      const parser = conditional(
        option("--format", choice(["json", "xml"])),
        {
          json: object({ pretty: option("--pretty") }),
          xml: object({ indent: option("--indent", integer()) }),
        },
        object({}),
      );

      type ParsedType = InferValue<typeof parser>;

      const result = parse(parser, ["--format", "json", "--pretty"]);
      assert.ok(result.success);

      if (result.success) {
        const [discriminator, value] = result.value;
        if (discriminator === "json") {
          // TypeScript should know value has 'pretty' property
          const pretty: boolean = (value as { pretty: boolean }).pretty;
          assert.equal(pretty, true);
        }
      }
    });
  });

  describe("getDocFragments", () => {
    it("should document discriminator and branch options", () => {
      const parser = conditional(
        option("--mode", choice(["fast", "slow"])),
        {
          fast: object({ threads: option("--threads", integer()) }),
          slow: object({ verbose: option("--verbose") }),
        },
        object({}),
      );

      const fragments = parser.getDocFragments({ kind: "unavailable" });
      assert.ok(fragments.fragments.length > 0);
    });
  });

  describe("suggest", () => {
    it("should suggest discriminator values before selection", () => {
      const parser = conditional(
        option("--type", choice(["alpha", "beta"])),
        {
          alpha: object({}),
          beta: object({}),
        },
        object({}),
      );

      const suggestions = [...parser.suggest(
        {
          buffer: [],
          state: parser.initialState,
          optionsTerminated: false,
          usage: parser.usage,
        },
        "--type",
      )];
      assert.ok(
        suggestions.some((s) => s.kind === "literal" && s.text === "--type"),
      );
    });
  });
});

describe("complex combinator interactions", () => {
  describe("or() with multiple()", () => {
    it("should handle multiple values in or() branches", () => {
      const parser = or(
        multiple(option("-a")),
        multiple(option("-b")),
      );

      // Multiple -a options
      const result1 = parse(parser, ["-a", "-a", "-a"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value, [true, true, true]);
      }

      // Multiple -b options
      const result2 = parse(parser, ["-b", "-b"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.deepEqual(result2.value, [true, true]);
      }
    });

    it("should detect mixed options from different branches", () => {
      const parser = or(
        multiple(option("-a")),
        multiple(option("-b")),
      );

      const result = parse(parser, ["-a", "-b"]);
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "cannot be used together");
      }
    });
  });

  describe("nested or() combinators", () => {
    it("should handle 2-level nested or()", () => {
      const innerOr = or(option("-a"), option("-b"));
      const outerOr = or(innerOr, option("-c"));

      const result1 = parse(outerOr, ["-a"]);
      assert.ok(result1.success);

      const result2 = parse(outerOr, ["-b"]);
      assert.ok(result2.success);

      const result3 = parse(outerOr, ["-c"]);
      assert.ok(result3.success);
    });

    it("should handle 3-level nested or()", () => {
      const level1 = or(option("-a"), option("-b"));
      const level2 = or(level1, option("-c"));
      const level3 = or(level2, option("-d"));

      const result1 = parse(level3, ["-a"]);
      assert.ok(result1.success);

      const result2 = parse(level3, ["-d"]);
      assert.ok(result2.success);
    });

    it("should maintain mutual exclusivity across nested levels", () => {
      const innerOr = or(option("-a"), option("-b"));
      const outerOr = or(innerOr, option("-c"));

      const result = parse(outerOr, ["-a", "-c"]);
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "cannot be used together");
      }
    });
  });

  describe("object() with same priority fields", () => {
    it("should handle multiple fields with same priority", () => {
      const parser = object({
        alpha: option("-a"),
        beta: option("-b"),
        gamma: option("-c"),
      });

      // All three parsers have the same default priority
      const result = parse(parser, ["-c", "-a", "-b"]);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, {
          alpha: true,
          beta: true,
          gamma: true,
        });
      }
    });

    it("should handle many fields in object (stress test)", () => {
      // Create an object with 15 fields
      const parser = object({
        f1: option("-1"),
        f2: option("-2"),
        f3: option("-3"),
        f4: option("-4"),
        f5: option("-5"),
        f6: option("-6"),
        f7: option("-7"),
        f8: option("-8"),
        f9: option("-9"),
        f10: option("--ten"),
        f11: option("--eleven"),
        f12: option("--twelve"),
        f13: option("--thirteen"),
        f14: option("--fourteen"),
        f15: option("--fifteen"),
      });

      const result = parse(parser, [
        "-1",
        "-3",
        "-5",
        "-7",
        "-9",
        "--eleven",
        "--thirteen",
        "--fifteen",
      ]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.f1, true);
        assert.equal(result.value.f3, true);
        assert.equal(result.value.f5, true);
        assert.equal(result.value.f11, true);
        assert.equal(result.value.f2, false);
        assert.equal(result.value.f4, false);
      }
    });

    it("should handle all optional fields with empty input", () => {
      const parser = object({
        a: optional(option("-a")),
        b: optional(option("-b")),
        c: optional(option("-c")),
      });

      const result = parse(parser, []);
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, {
          a: undefined,
          b: undefined,
          c: undefined,
        });
      }
    });
  });

  describe("deeply nested structures", () => {
    it("should handle optional(or(object()))", () => {
      const parser = optional(
        or(
          object({
            a: option("-a"),
            b: option("-b"),
          }),
          object({
            c: option("-c"),
            d: option("-d"),
          }),
        ),
      );

      // First branch
      const result1 = parse(parser, ["-a", "-b"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value, { a: true, b: true });
      }

      // Second branch
      const result2 = parse(parser, ["-c", "-d"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.deepEqual(result2.value, { c: true, d: true });
      }

      // No input - should return undefined
      const result3 = parse(parser, []);
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, undefined);
      }
    });

    it("should handle 5+ levels of command nesting", () => {
      const level5 = command("level5", object({ flag: flag("-f") }));
      const level4 = command("level4", object({ sub: level5 }));
      const level3 = command("level3", object({ sub: level4 }));
      const level2 = command("level2", object({ sub: level3 }));
      const level1 = command("level1", object({ sub: level2 }));

      const result = parse(
        level1,
        ["level1", "level2", "level3", "level4", "level5", "-f"],
      );
      assert.ok(result.success);
      if (result.success) {
        assert.deepEqual(result.value, {
          sub: {
            sub: {
              sub: {
                sub: {
                  flag: true,
                },
              },
            },
          },
        });
      }
    });
  });

  describe("or() branch mixing with 'cannot be used together'", () => {
    it("should detect when options from different branches are mixed", () => {
      const branchA = object({
        mode: constant("add" as const),
        files: multiple(argument(string({ metavar: "FILE" }))),
      });
      const branchB = object({
        mode: constant("remove" as const),
        force: flag("-f", "--force"),
      });
      const parser = or(branchA, branchB);

      // Using options from both branches
      const result = parse(parser, ["file.txt", "-f"]);
      assert.ok(!result.success);
      if (!result.success) {
        assertErrorIncludes(result.error, "cannot be used together");
      }
    });

    it("should allow valid usage within single branch", () => {
      const branchA = object({
        verbose: flag("-v"),
        files: multiple(argument(string({ metavar: "FILE" }))),
      });
      const branchB = object({
        quiet: flag("-q"),
        force: flag("-f"),
      });
      const parser = or(branchA, branchB);

      // All from first branch
      const result1 = parse(parser, ["-v", "file1.txt", "file2.txt"]);
      assert.ok(result1.success);

      // All from second branch
      const result2 = parse(parser, ["-q", "-f"]);
      assert.ok(result2.success);
    });
  });
});
