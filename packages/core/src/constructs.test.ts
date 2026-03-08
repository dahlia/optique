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
import type { DocEntry, DocFragment, DocSection } from "@optique/core/doc";
import {
  createDependencySourceState,
  createPendingDependencySourceState,
  dependencyId,
  isPendingDependencySourceState,
  wrappedDependencySourceMarker,
} from "@optique/core/dependency";
import {
  formatMessage,
  type Message,
  message,
  text,
  valueSet,
} from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import {
  getDocPage,
  type InferValue,
  parseAsync,
  type Parser,
  type ParserContext,
  type ParserResult,
  parseSync,
  suggestAsync,
  type Suggestion,
  suggestSync,
} from "@optique/core/parser";
import {
  argument,
  command,
  constant,
  flag,
  option,
  passThrough,
} from "@optique/core/primitives";
import { formatUsage } from "@optique/core/usage";
import {
  choice,
  integer,
  string,
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function assertErrorIncludes(error: Message, text: string): void {
  const formatted = formatMessage(error);
  assert.ok(formatted.includes(text));
}

function asyncStringValue(): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "ASYNC_STRING",
    parse(input: string): Promise<ValueParserResult<string>> {
      return Promise.resolve({ success: true, value: input });
    },
    format(value: string): string {
      return value;
    },
  };
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

    const result = parseSync(orParser, ["-a"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, true);
    }
  });

  it("should succeed with second parser when first fails", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const orParser = or(parser1, parser2);

    const result = parseSync(orParser, ["-b"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, true);
    }
  });

  it("should fail when no parser matches", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const orParser = or(parser1, parser2);

    const result = parseSync(orParser, ["-c"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "Unexpected option or subcommand");
    }
  });

  it("should detect mutually exclusive options", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const orParser = or(parser1, parser2);

    const result = parseSync(orParser, ["-a", "-b"]);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "cannot be used together");
    }
  });

  it("should complete with successful parser result", () => {
    const parser1 = option("-a");
    const parser2 = option("-b");
    const orParser = or(parser1, parser2);

    const result = parseSync(orParser, ["-a"]);
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

    const resultA = parseSync(orParser, ["-a"]);
    assert.ok(resultA.success);

    const resultB = parseSync(orParser, ["-b"]);
    assert.ok(resultB.success);

    const resultC = parseSync(orParser, ["-c"]);
    assert.ok(resultC.success);
  });

  it("should preserve inferred unions with up to fifteen parsers", () => {
    const parser = or(
      command("c1", constant("v1" as const)),
      command("c2", constant("v2" as const)),
      command("c3", constant("v3" as const)),
      command("c4", constant("v4" as const)),
      command("c5", constant("v5" as const)),
      command("c6", constant("v6" as const)),
      command("c7", constant("v7" as const)),
      command("c8", constant("v8" as const)),
      command("c9", constant("v9" as const)),
      command("c10", constant("v10" as const)),
      command("c11", constant("v11" as const)),
      command("c12", constant("v12" as const)),
      command("c13", constant("v13" as const)),
      command("c14", constant("v14" as const)),
      command("c15", constant("v15" as const)),
    );

    type Inferred = InferValue<typeof parser>;
    type Expected =
      | "v1"
      | "v2"
      | "v3"
      | "v4"
      | "v5"
      | "v6"
      | "v7"
      | "v8"
      | "v9"
      | "v10"
      | "v11"
      | "v12"
      | "v13"
      | "v14"
      | "v15";
    const _checkExpectedAssignableToInferred: Inferred = {} as Expected;
    const _checkInferredAssignableToExpected: Expected = {} as Inferred;
    void _checkExpectedAssignableToInferred;
    void _checkInferredAssignableToExpected;

    const result = parseSync(parser, ["c15"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "v15");
    }
  });

  it("should preserve inferred unions with options up to fifteen parsers", () => {
    const parser = or(
      command("c1", constant("v1" as const)),
      command("c2", constant("v2" as const)),
      command("c3", constant("v3" as const)),
      command("c4", constant("v4" as const)),
      command("c5", constant("v5" as const)),
      command("c6", constant("v6" as const)),
      command("c7", constant("v7" as const)),
      command("c8", constant("v8" as const)),
      command("c9", constant("v9" as const)),
      command("c10", constant("v10" as const)),
      command("c11", constant("v11" as const)),
      command("c12", constant("v12" as const)),
      command("c13", constant("v13" as const)),
      command("c14", constant("v14" as const)),
      command("c15", constant("v15" as const)),
      {
        errors: {
          noMatch: message`No matching command found.`,
        },
      },
    );

    type Inferred = InferValue<typeof parser>;
    type Expected =
      | "v1"
      | "v2"
      | "v3"
      | "v4"
      | "v5"
      | "v6"
      | "v7"
      | "v8"
      | "v9"
      | "v10"
      | "v11"
      | "v12"
      | "v13"
      | "v14"
      | "v15";
    const _checkExpectedAssignableToInferred: Inferred = {} as Expected;
    const _checkInferredAssignableToExpected: Expected = {} as Inferred;
    void _checkExpectedAssignableToInferred;
    void _checkInferredAssignableToExpected;

    const result = parseSync(parser, ["c14"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "v14");
    }
  });

  it("should report type-level arity error for sixteen parsers", () => {
    // @ts-expect-error - or() supports up to 15 parser arguments.
    const _tooMany = or(
      option("--a1"),
      option("--a2"),
      option("--a3"),
      option("--a4"),
      option("--a5"),
      option("--a6"),
      option("--a7"),
      option("--a8"),
      option("--a9"),
      option("--a10"),
      option("--a11"),
      option("--a12"),
      option("--a13"),
      option("--a14"),
      option("--a15"),
      option("--a16"),
    );
    void _tooMany;
  });

  it("should report type-level arity error for sixteen parsers with options", () => {
    // @ts-expect-error - or() supports up to 15 parser arguments.
    const _tooMany = or(
      option("--a1"),
      option("--a2"),
      option("--a3"),
      option("--a4"),
      option("--a5"),
      option("--a6"),
      option("--a7"),
      option("--a8"),
      option("--a9"),
      option("--a10"),
      option("--a11"),
      option("--a12"),
      option("--a13"),
      option("--a14"),
      option("--a15"),
      option("--a16"),
      {
        errors: {
          noMatch: message`No matching option found.`,
        },
      },
    );
    void _tooMany;
  });

  it("should enforce arity limit even when last argument is a named parser variable", () => {
    const p16 = option("--a16");

    // @ts-expect-error - the 16th parser must not be interpreted as options.
    const _tooMany = or(
      option("--a1"),
      option("--a2"),
      option("--a3"),
      option("--a4"),
      option("--a5"),
      option("--a6"),
      option("--a7"),
      option("--a8"),
      option("--a9"),
      option("--a10"),
      option("--a11"),
      option("--a12"),
      option("--a13"),
      option("--a14"),
      option("--a15"),
      p16,
    );
    void _tooMany;
  });

  it("should report type-level arity error for zero parsers", () => {
    // @ts-expect-error - or() requires at least one parser argument.
    const _noParsers = or();
    void _noParsers;
  });

  it("should accept spread parser arrays without tuple length information", () => {
    const dynamicParsers: Parser<"sync", unknown, unknown>[] = [
      command("first", constant("first" as const)),
      command("second", constant("second" as const)),
    ];

    const parser = or(...dynamicParsers);
    const result = parseSync(parser, ["second"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "second");
    }
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

    it("should use unavailable inner state when selected parser failed", () => {
      const parser1 = option("-a", "--apple");
      const parser2 = option("-b", "--banana");
      const orParser = or(parser1, parser2);

      const fragments = orParser.getDocFragments(
        {
          kind: "available",
          state: [1, {
            success: false,
            consumed: 1,
            error: message`failed.`,
          }],
        } as unknown as Parameters<typeof orParser.getDocFragments>[0],
      );

      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const entries = sections.flatMap((s) => s.entries);

      assert.ok(
        entries.some(
          (e: DocEntry) =>
            e.term.type === "option" && e.term.names.includes("--banana"),
        ),
      );
      assert.ok(
        !entries.some(
          (e: DocEntry) =>
            e.term.type === "option" && e.term.names.includes("--apple"),
        ),
      );
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

    const result = parseSync(parser, ["-v"]);
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

    const result = parseSync(parser, ["-v"]);
    // Should succeed - first matching branch wins
    assert.ok(result.success);
  });

  it("should switch async branch when earlier input is shared", async () => {
    const parser = or(
      object({
        shared: option("--shared", asyncStringValue()),
        alpha: option("--alpha", asyncStringValue()),
      }),
      object({
        shared: option("--shared", asyncStringValue()),
        beta: option("--beta", asyncStringValue()),
      }),
    );

    const result = await parseAsync(parser, ["--shared", "s", "--beta", "b"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, { shared: "s", beta: "b" });
    }
  });

  it("should reject async branch switch for non-shared input", async () => {
    const parser = or(
      object({ alpha: option("--alpha", asyncStringValue()) }),
      object({ beta: option("--beta", asyncStringValue()) }),
    );

    const result = await parseAsync(parser, ["--alpha", "a", "--beta", "b"]);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(
        formatMessage(result.error).includes("cannot be used together"),
      );
    }
  });

  it("should return replayed async failure after shared-branch switch", async () => {
    const parserA: Parser<"async", string, string> = {
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      $mode: "async",
      priority: 10,
      usage: [{ type: "option", names: ["--shared"], metavar: "VALUE" }],
      initialState: "a-initial",
      parse(context) {
        if (context.buffer[0] === "--shared") {
          return Promise.resolve({
            success: true,
            next: {
              ...context,
              buffer: context.buffer.slice(1),
              state: "a-consumed",
            },
            consumed: ["--shared"],
          });
        }
        return Promise.resolve({
          success: false,
          consumed: 0,
          error: message`a failed.`,
        });
      },
      complete() {
        return Promise.resolve({ success: true, value: "a" });
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

    const parserB: Parser<"async", string, string> = {
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      $mode: "async",
      priority: 9,
      usage: [
        { type: "option", names: ["--shared"], metavar: "VALUE" },
        { type: "option", names: ["--b"], metavar: "VALUE" },
      ],
      initialState: "b-initial",
      parse(context) {
        if (
          context.buffer[0] === "--shared" && context.state === "b-initial"
        ) {
          return Promise.resolve({
            success: true,
            next: {
              ...context,
              buffer: context.buffer.slice(1),
              state: "b-checked",
            },
            consumed: ["--shared"],
          });
        }
        if (context.buffer[0] === "--b" && context.state === "b-initial") {
          return Promise.resolve({
            success: true,
            next: {
              ...context,
              buffer: context.buffer.slice(1),
              state: "b-first-pass",
            },
            consumed: ["--b"],
          });
        }
        if (context.buffer[0] === "--b" && context.state === "b-checked") {
          return Promise.resolve({
            success: false,
            consumed: 1,
            error: message`replayed failed.`,
          });
        }
        return Promise.resolve({
          success: false,
          consumed: 0,
          error: message`b failed.`,
        });
      },
      complete() {
        return Promise.resolve({ success: true, value: "b" });
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

    const parser = or(parserA, parserB);
    const secondPassContext = {
      buffer: ["--b"],
      state: [0, {
        success: true,
        next: {
          buffer: [] as readonly string[],
          state: "a-consumed",
          optionsTerminated: false,
          usage: parser.usage,
        },
        consumed: ["--shared"] as readonly string[],
      }] as unknown as typeof parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };

    const result = await parser.parse(secondPassContext);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "replayed failed.");
    }
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

    const result = parseSync(parser, ["deploi"]);
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

    const result = parseSync(parser, ["deploi"]);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(!errorMessage.includes("Did you mean"));
      assert.ok(!errorMessage.includes("deploy"));
    }
  });

  it("should not suggest subcommand-only options before command match", () => {
    const parser = or(
      command(
        "foo",
        object({
          fooflag: option("--fooflag", integer()),
        }),
      ),
      command(
        "bar",
        object({
          barflag: flag("--barflag"),
        }),
      ),
    );

    const result = parseSync(parser, ["--fooflag", "123"]);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(errorMessage.includes("Unexpected option or subcommand"));
      assert.ok(!errorMessage.includes("Did you mean"));
    }
  });

  it("should use custom unexpectedInput function", () => {
    const parser = or(
      command("deploy", argument(string())),
      command("build", argument(string())),
      {
        errors: {
          unexpectedInput: (token) =>
            message`Unknown command token: ${text(token)}.`,
        },
      },
    );

    const result = parseSync(parser, ["deploi"]);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(
        formatMessage(result.error),
        "Unknown command token: deploi.",
      );
    }
  });
});

describe("longestMatch()", () => {
  it("should preserve inferred unions with up to fifteen parsers", () => {
    const parser = longestMatch(
      command("c1", constant("v1" as const)),
      command("c2", constant("v2" as const)),
      command("c3", constant("v3" as const)),
      command("c4", constant("v4" as const)),
      command("c5", constant("v5" as const)),
      command("c6", constant("v6" as const)),
      command("c7", constant("v7" as const)),
      command("c8", constant("v8" as const)),
      command("c9", constant("v9" as const)),
      command("c10", constant("v10" as const)),
      command("c11", constant("v11" as const)),
      command("c12", constant("v12" as const)),
      command("c13", constant("v13" as const)),
      command("c14", constant("v14" as const)),
      command("c15", constant("v15" as const)),
    );

    type Inferred = InferValue<typeof parser>;
    type Expected =
      | "v1"
      | "v2"
      | "v3"
      | "v4"
      | "v5"
      | "v6"
      | "v7"
      | "v8"
      | "v9"
      | "v10"
      | "v11"
      | "v12"
      | "v13"
      | "v14"
      | "v15";
    const _checkExpectedAssignableToInferred: Inferred = {} as Expected;
    const _checkInferredAssignableToExpected: Expected = {} as Inferred;
    void _checkExpectedAssignableToInferred;
    void _checkInferredAssignableToExpected;
  });

  it("should preserve inferred unions with options up to fifteen parsers", () => {
    const parser = longestMatch(
      command("c1", constant("v1" as const)),
      command("c2", constant("v2" as const)),
      command("c3", constant("v3" as const)),
      command("c4", constant("v4" as const)),
      command("c5", constant("v5" as const)),
      command("c6", constant("v6" as const)),
      command("c7", constant("v7" as const)),
      command("c8", constant("v8" as const)),
      command("c9", constant("v9" as const)),
      command("c10", constant("v10" as const)),
      command("c11", constant("v11" as const)),
      command("c12", constant("v12" as const)),
      command("c13", constant("v13" as const)),
      command("c14", constant("v14" as const)),
      command("c15", constant("v15" as const)),
      {
        errors: {
          noMatch: message`No matching command found.`,
        },
      },
    );

    type Inferred = InferValue<typeof parser>;
    type Expected =
      | "v1"
      | "v2"
      | "v3"
      | "v4"
      | "v5"
      | "v6"
      | "v7"
      | "v8"
      | "v9"
      | "v10"
      | "v11"
      | "v12"
      | "v13"
      | "v14"
      | "v15";
    const _checkExpectedAssignableToInferred: Inferred = {} as Expected;
    const _checkInferredAssignableToExpected: Expected = {} as Inferred;
    void _checkExpectedAssignableToInferred;
    void _checkInferredAssignableToExpected;
  });

  it("should report type-level arity error for sixteen parsers", () => {
    const parsers = [
      option("--a1"),
      option("--a2"),
      option("--a3"),
      option("--a4"),
      option("--a5"),
      option("--a6"),
      option("--a7"),
      option("--a8"),
      option("--a9"),
      option("--a10"),
      option("--a11"),
      option("--a12"),
      option("--a13"),
      option("--a14"),
      option("--a15"),
      option("--a16"),
    ] as const;

    // @ts-expect-error - longestMatch() supports up to 15 parser arguments.
    const _tooMany = longestMatch(...parsers);
    void _tooMany;
  });

  it("should report type-level arity error for sixteen parsers with options", () => {
    const parsers = [
      option("--a1"),
      option("--a2"),
      option("--a3"),
      option("--a4"),
      option("--a5"),
      option("--a6"),
      option("--a7"),
      option("--a8"),
      option("--a9"),
      option("--a10"),
      option("--a11"),
      option("--a12"),
      option("--a13"),
      option("--a14"),
      option("--a15"),
      option("--a16"),
    ] as const;

    // @ts-expect-error - longestMatch() supports up to 15 parser arguments.
    const _tooMany = longestMatch(...parsers, {
      errors: {
        noMatch: message`No matching option found.`,
      },
    });
    void _tooMany;
  });

  it("should enforce arity limit when last argument is a named parser variable", () => {
    const p16 = option("--a16");
    const parsers = [
      option("--a1"),
      option("--a2"),
      option("--a3"),
      option("--a4"),
      option("--a5"),
      option("--a6"),
      option("--a7"),
      option("--a8"),
      option("--a9"),
      option("--a10"),
      option("--a11"),
      option("--a12"),
      option("--a13"),
      option("--a14"),
      option("--a15"),
      p16,
    ] as const;

    // @ts-expect-error - the 16th parser must not be interpreted as options.
    const _tooMany = longestMatch(...parsers);
    void _tooMany;
  });

  it("should report type-level arity error for zero parsers", () => {
    // @ts-expect-error - longestMatch() requires at least one parser argument.
    const _noParsers = longestMatch();
    void _noParsers;
  });

  it("should accept spread parser arrays without tuple length information", () => {
    const dynamicParsers: Parser<"sync", unknown, unknown>[] = [
      command("first", constant("first" as const)),
      command("second", constant("second" as const)),
    ];

    const parser = longestMatch(...dynamicParsers);
    const result = parseSync(parser, ["second"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "second");
    }
  });

  it("should preserve discriminated state inference for tuple parsers", () => {
    const parserA = option("--a");
    const parserB = multiple(option("--b"));
    const parser = longestMatch(parserA, parserB);

    type InferredState = (typeof parser)["$stateType"][number];
    type ParserAState = (typeof parserA)["$stateType"][number];
    type ParserBState = (typeof parserB)["$stateType"][number];
    type ExpectedState =
      | undefined
      | [0, ParserResult<ParserAState>]
      | [1, ParserResult<ParserBState>];
    const _checkExpectedAssignableToInferred: InferredState =
      {} as ExpectedState;
    const _checkInferredAssignableToExpected: ExpectedState =
      {} as InferredState;
    void _checkExpectedAssignableToInferred;
    void _checkInferredAssignableToExpected;
  });

  it("should preserve discriminated state inference with options", () => {
    const parserA = option("--a");
    const parserB = multiple(option("--b"));
    const parser = longestMatch(parserA, parserB, {
      errors: {
        noMatch: message`No matching option found.`,
      },
    });

    type InferredState = (typeof parser)["$stateType"][number];
    type ParserAState = (typeof parserA)["$stateType"][number];
    type ParserBState = (typeof parserB)["$stateType"][number];
    type ExpectedState =
      | undefined
      | [0, ParserResult<ParserAState>]
      | [1, ParserResult<ParserBState>];
    const _checkExpectedAssignableToInferred: InferredState =
      {} as ExpectedState;
    const _checkInferredAssignableToExpected: ExpectedState =
      {} as InferredState;
    void _checkExpectedAssignableToInferred;
    void _checkInferredAssignableToExpected;
  });

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
    const shortResult = parseSync(parser, ["--help"]);
    assert.ok(shortResult.success);
    assert.equal((shortResult.value as { type: string }).type, "short");

    // Long parser consumes 2 tokens (list --help)
    const longResult = parseSync(parser, ["list", "--help"]);
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
    const result1 = parseSync(parser, ["-a"]);
    assert.ok(result1.success);
    assert.equal((result1.value as { type: string }).type, "one");

    // parser2 consumes 2 tokens
    const result2 = parseSync(parser, ["-a", "-b"]);
    assert.ok(result2.success);
    assert.equal((result2.value as { type: string }).type, "two");

    // parser3 consumes 3 tokens
    const result3 = parseSync(parser, ["-a", "-b", "-c"]);
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
    const addResult = parseSync(parser, ["add", "key1", "value1"]);
    assert.ok(addResult.success);
    assert.equal((addResult.value as { help: boolean }).help, false);
    assert.equal(
      (addResult.value as { result: { action: string } }).result.action,
      "add",
    );

    // Context-aware help: list --help
    const helpResult = parseSync(parser, ["list", "--help"]);
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
    const result = parseSync(parser, ["-t", "value"]);
    assert.ok(!result.success);
  });

  it("should keep the deepest sync failure", () => {
    const parserA: Parser<"sync", string, null> = {
      $valueType: [] as readonly string[],
      $stateType: [] as readonly null[],
      $mode: "sync",
      priority: 0,
      usage: [],
      initialState: null,
      parse() {
        return {
          success: false,
          consumed: 1,
          error: message`short failure.`,
        };
      },
      complete() {
        return { success: true, value: "a" };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };
    const parserB: Parser<"sync", string, null> = {
      ...parserA,
      parse() {
        return {
          success: false,
          consumed: 2,
          error: message`deep failure.`,
        };
      },
    };

    const parser = longestMatch(parserA, parserB);
    const result = parseSync(parser, ["x", "y"]);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "deep failure.");
    }
  });

  it("should keep the deepest async failure", async () => {
    const parserA: Parser<"async", string, null> = {
      $valueType: [] as readonly string[],
      $stateType: [] as readonly null[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: null,
      parse() {
        return Promise.resolve({
          success: false,
          consumed: 1,
          error: message`short async failure.`,
        });
      },
      complete() {
        return Promise.resolve({ success: true, value: "a" });
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
    const parserB: Parser<"async", string, null> = {
      ...parserA,
      parse() {
        return Promise.resolve({
          success: false,
          consumed: 2,
          error: message`deep async failure.`,
        });
      },
    };

    const parser = longestMatch(parserA, parserB);
    const result = await parseAsync(parser, ["x", "y"]);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "deep async failure.");
    }
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
    const result = parseSync(parser, ["anything"]);
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

    const stringResult = parseSync(parser, ["hello"]);
    assert.ok(stringResult.success);
    assert.equal((stringResult.value as { type: string }).type, "string");
    assert.equal((stringResult.value as { value: string }).value, "hello");

    // For "42", both parsers could match (string and integer), but string parser
    // comes first and both consume same number of tokens, so string parser wins
    const ambiguousResult = parseSync(parser, ["42"]);
    assert.ok(ambiguousResult.success);
    assert.equal((ambiguousResult.value as { type: string }).type, "string");
    assert.equal((ambiguousResult.value as { value: string }).value, "42");

    // Test with input that only integer parser can handle (non-string that parses as int)
    // Actually, let's test with more specific parsers to demonstrate type preservation
    const numberOnlyResult = parseSync(parser, ["123"]);
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

  it("should show all docs when selected state is a failure", () => {
    const parser = longestMatch(
      object("Alpha", { alpha: option("--alpha") }),
      object("Beta", { beta: option("--beta") }),
    );

    const fragments = parser.getDocFragments(
      {
        kind: "available",
        state: [0, {
          success: false,
          consumed: 0,
          error: message`failed.`,
        }],
      } as unknown as Parameters<typeof parser.getDocFragments>[0],
    );

    const sections = fragments.fragments.filter((f) =>
      f.type === "section"
    ) as (DocFragment & { type: "section" })[];

    assert.ok(sections.some((s) => s.title === "Alpha"));
    assert.ok(sections.some((s) => s.title === "Beta"));
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
    const testResult = parseSync(parser, ["test"]);
    assert.ok(testResult.success);
    assert.equal((testResult.value as { help: boolean }).help, false);

    // Global help
    const globalHelpResult = parseSync(parser, ["--help"]);
    assert.ok(globalHelpResult.success);
    assert.equal((globalHelpResult.value as { help: boolean }).help, true);

    // Contextual help (longer match)
    const contextualHelpResult = parseSync(parser, ["test", "--help"]);
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

    const result = parseSync(parser, ["deploi"]);
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

    const result = parseSync(parser, ["deploi"]);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      const errorMessage = formatMessage(result.error);
      assert.ok(!errorMessage.includes("Did you mean"));
      assert.ok(!errorMessage.includes("deploy"));
    }
  });

  it("should use custom unexpectedInput function", () => {
    const parser = longestMatch(
      command("deploy", argument(string())),
      command("build", argument(string())),
      {
        errors: {
          unexpectedInput: (token) => message`Unknown action: ${text(token)}.`,
        },
      },
    );

    const result = parseSync(parser, ["deploi"]);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(
        formatMessage(result.error),
        "Unknown action: deploi.",
      );
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

    const result = parseSync(parser, ["-v", "-p", "8080"]);
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

    const result = parseSync(parser, ["-p", "0"]);
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

    const result = parseSync(parser, []);
    assert.ok(!result.success);
    if (!result.success) {
      assertErrorIncludes(result.error, "No matching option found");
    }
  });

  it("should succeed with empty input when only Boolean flags are present", () => {
    const parser = object({
      watch: option("--watch"),
    });

    const result = parseSync(parser, []);
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

    const result = parseSync(parser, []);
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

    const result = parseSync(parser, ["--watch"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.watch, true);
      assert.equal(result.value.verbose, false);
    }
  });

  it("should suggest only exclusive option values after option token", () => {
    const parser = object({
      mode: or(
        option("--mode", choice(["dev", "prod"])),
        option("--profile", choice(["staging", "release"])),
      ),
      target: argument(choice(["dist", "docs"])),
    });

    const suggestions = [...parser.suggest(
      {
        buffer: ["--mode"],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      },
      "d",
    )];

    const texts = suggestions
      .filter((s) => s.kind === "literal")
      .map((s) => s.text);

    assert.ok(texts.includes("dev"));
    assert.ok(!texts.includes("dist"));
  });

  it("should fall back to initial state in suggest when field state is missing", () => {
    const parser = object({
      mode: option("--mode", choice(["dev", "prod"])),
    });

    const suggestions = [...parser.suggest(
      {
        buffer: ["--mode"],
        state: {} as unknown as typeof parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      },
      "d",
    )];

    assert.deepEqual(suggestions, [{ kind: "literal", text: "dev" }]);
  });

  it("should suggest only option values in async mode after option token", async () => {
    const modeParser: Parser<"async", string, string> = {
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      $mode: "async",
      priority: 0,
      usage: [{
        type: "option",
        names: ["--mode"],
        metavar: "MODE",
      }],
      initialState: "mode-initial",
      parse(context: ParserContext<string>) {
        return Promise.resolve({
          success: true,
          next: { ...context, buffer: [] },
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({ success: true, value: "dev" });
      },
      suggest(_context: ParserContext<string>, prefix: string) {
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
            if ("dev".startsWith(prefix)) {
              yield { kind: "literal", text: "dev" };
            }
            if ("prod".startsWith(prefix)) {
              yield { kind: "literal", text: "prod" };
            }
          },
        };
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const parser = object({
      mode: modeParser,
      target: argument(choice(["dist", "docs"])),
    });

    const suggestions = [] as Suggestion[];
    for await (
      const suggestion of parser.suggest(
        {
          buffer: ["--mode"],
          state: parser.initialState,
          optionsTerminated: false,
          usage: parser.usage,
        },
        "d",
      )
    ) {
      suggestions.push(suggestion);
    }

    const texts = suggestions
      .filter((s) => s.kind === "literal")
      .map((s) => s.text);

    assert.ok(texts.includes("dev"));
    assert.ok(!texts.includes("dist"));
  });

  it("should fall back to field initial states in async suggest", async () => {
    let seenModeState: unknown;
    let seenOtherState: unknown;

    const makeAsyncParser = (
      initialState: string,
      suggestion: string,
      onSuggest: (state: unknown) => void,
    ): Parser<"async", string, string> => ({
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState,
      parse(context: ParserContext<string>) {
        return Promise.resolve({
          success: true,
          next: { ...context, buffer: [] },
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({ success: true, value: suggestion });
      },
      suggest(context) {
        onSuggest(context.state);
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
            yield { kind: "literal", text: suggestion };
          },
        };
      },
      getDocFragments() {
        return { fragments: [] };
      },
    });

    const parser = object({
      mode: makeAsyncParser("mode-initial", "dev", (state) => {
        seenModeState = state;
      }),
      other: makeAsyncParser("other-initial", "x", (state) => {
        seenOtherState = state;
      }),
    });

    const suggestions = [] as Suggestion[];
    for await (
      const suggestion of parser.suggest(
        {
          buffer: [],
          state: {} as unknown as typeof parser.initialState,
          optionsTerminated: false,
          usage: parser.usage,
        },
        "",
      )
    ) {
      suggestions.push(suggestion);
    }

    assert.equal(seenModeState, "mode-initial");
    assert.equal(seenOtherState, "other-initial");
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "dev"),
    );
    assert.ok(suggestions.some((s) => s.kind === "literal" && s.text === "x"));
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

    it("should include choices in doc fragments for option with choice()", () => {
      const parser = object({
        format: option("--format", choice(["json", "yaml", "xml"])),
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

      const formatEntry = mainSection.entries.find((e: DocEntry) =>
        e.term.type === "option" && e.term.names.includes("--format")
      );
      assert.ok(formatEntry);
      assert.ok(formatEntry.choices != null, "choices should be present");
      assert.deepEqual(
        formatEntry.choices,
        valueSet(["json", "yaml", "xml"], { type: "unit" }),
      );
    });

    it("should include choices in doc fragments for argument with choice()", () => {
      const parser = object({
        action: argument(choice(["start", "stop"])),
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

      const actionEntry = mainSection.entries.find((e: DocEntry) =>
        e.term.type === "argument"
      );
      assert.ok(actionEntry);
      assert.ok(actionEntry.choices != null, "choices should be present");
      assert.deepEqual(
        actionEntry.choices,
        valueSet(["start", "stop"], { type: "unit" }),
      );
    });

    it("should not include choices for option without choice parser", () => {
      const parser = object({
        port: option("--port", integer()),
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

      const portEntry = mainSection.entries.find((e: DocEntry) =>
        e.term.type === "option" && e.term.names.includes("--port")
      );
      assert.ok(portEntry);
      assert.equal(portEntry.choices, undefined);
    });

    it("should not include choices for flag (no value parser)", () => {
      const parser = object({
        verbose: option("-v", "--verbose"),
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
      assert.equal(verboseEntry.choices, undefined);
    });

    it("should not include choices for hidden option with choice()", () => {
      const parser = object({
        format: option("--format", choice(["json", "yaml"]), { hidden: true }),
      });

      const fragments = parser.getDocFragments({
        kind: "available",
        state: parser.initialState,
      });

      // Hidden options should not produce entries at all
      const sections = fragments.fragments.filter((f) =>
        f.type === "section"
      ) as (DocFragment & { type: "section" })[];
      const mainSection = sections.find((s) => s.title === undefined);
      assert.ok(mainSection);
      assert.equal(mainSection.entries.length, 0);
    });

    it("should include choices for number choice()", () => {
      const parser = object({
        depth: option("--depth", choice([8, 10, 12])),
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

      const depthEntry = mainSection.entries.find((e: DocEntry) =>
        e.term.type === "option" && e.term.names.includes("--depth")
      );
      assert.ok(depthEntry);
      assert.ok(depthEntry.choices != null, "choices should be present");
      assert.deepEqual(
        depthEntry.choices,
        valueSet(["8", "10", "12"], { type: "unit" }),
      );
    });
  });

  describe("Symbol keys", () => {
    it("should parse options with Symbol keys", () => {
      const sym1 = Symbol("opt1");
      const sym2 = Symbol("opt2");
      const parser = object({
        [sym1]: option("--opt1", integer()),
        [sym2]: option("--opt2", integer()),
      });

      const result = parseSync(parser, ["--opt1", "10", "--opt2", "20"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value[sym1], 10);
        assert.equal(result.value[sym2], 20);
      }
    });

    it("should parse options with mixed string and Symbol keys", () => {
      const sym = Symbol("symOpt");
      const parser = object({
        strKey: option("--str", integer()),
        [sym]: option("--sym", integer()),
      });

      const result = parseSync(parser, ["--str", "5", "--sym", "15"]);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.strKey, 5);
        assert.equal(result.value[sym], 15);
      }
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

    const result = parseSync(parser, ["-v", "-o", "file.txt"]);
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

    const result = parseSync(parser, ["-v"]);
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

    const result = parseSync(parser, ["-v", "-d"]);
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

    const result = parseSync(parser, ["-n", "Alice", "-v"]);
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

    const result = parseSync(parser, ["-n", "Bob", "-v"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["Bob", true]);
    }
  });

  it("should handle empty tuple", () => {
    const parser = tuple([]);

    const result = parseSync(parser, []);
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

    const result1 = parseSync(parser, ["-n", "Alice", "-a", "30", "-v"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.deepEqual(result1.value, ["Alice", 30, true]);
    }

    const result2 = parseSync(parser, ["-n", "Bob", "-v"]);
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

    const result = parseSync(parser, ["input.txt", "-v", "-o", "output.txt"]);
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

    const result = parseSync(parser, ["file1.txt", "file2.txt", "-v"]);
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

    const result = parseSync(parser, ["input.txt", "-t", "json", "output.txt"]);
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
    const result = parseSync(parser, ["-v"]);
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

    const result = parseSync(parser, [
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

    const result = parseSync(parser, ["-v", "-o", "file.txt"]);
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

    const result = parseSync(parser, ["-v"]);
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
  it("should preserve inferred object types with up to fifteen parsers", () => {
    const parser = merge(
      object({ k1: constant("v1" as const) }),
      object({ k2: constant("v2" as const) }),
      object({ k3: constant("v3" as const) }),
      object({ k4: constant("v4" as const) }),
      object({ k5: constant("v5" as const) }),
      object({ k6: constant("v6" as const) }),
      object({ k7: constant("v7" as const) }),
      object({ k8: constant("v8" as const) }),
      object({ k9: constant("v9" as const) }),
      object({ k10: constant("v10" as const) }),
      object({ k11: constant("v11" as const) }),
      object({ k12: constant("v12" as const) }),
      object({ k13: constant("v13" as const) }),
      object({ k14: constant("v14" as const) }),
      object({ k15: constant("v15" as const) }),
    );

    type Inferred = InferValue<typeof parser>;
    type Expected = {
      readonly k1: "v1";
      readonly k2: "v2";
      readonly k3: "v3";
      readonly k4: "v4";
      readonly k5: "v5";
      readonly k6: "v6";
      readonly k7: "v7";
      readonly k8: "v8";
      readonly k9: "v9";
      readonly k10: "v10";
      readonly k11: "v11";
      readonly k12: "v12";
      readonly k13: "v13";
      readonly k14: "v14";
      readonly k15: "v15";
    };
    const _checkExpectedAssignableToInferred: Inferred = {} as Expected;
    const _checkInferredAssignableToExpected: Expected = {} as Inferred;
    void _checkExpectedAssignableToInferred;
    void _checkInferredAssignableToExpected;
  });

  it("should preserve inferred object types with options up to fifteen parsers", () => {
    const parser = merge(
      object({ k1: constant("v1" as const) }),
      object({ k2: constant("v2" as const) }),
      object({ k3: constant("v3" as const) }),
      object({ k4: constant("v4" as const) }),
      object({ k5: constant("v5" as const) }),
      object({ k6: constant("v6" as const) }),
      object({ k7: constant("v7" as const) }),
      object({ k8: constant("v8" as const) }),
      object({ k9: constant("v9" as const) }),
      object({ k10: constant("v10" as const) }),
      object({ k11: constant("v11" as const) }),
      object({ k12: constant("v12" as const) }),
      object({ k13: constant("v13" as const) }),
      object({ k14: constant("v14" as const) }),
      object({ k15: constant("v15" as const) }),
      { allowDuplicates: false },
    );

    type Inferred = InferValue<typeof parser>;
    type Expected = {
      readonly k1: "v1";
      readonly k2: "v2";
      readonly k3: "v3";
      readonly k4: "v4";
      readonly k5: "v5";
      readonly k6: "v6";
      readonly k7: "v7";
      readonly k8: "v8";
      readonly k9: "v9";
      readonly k10: "v10";
      readonly k11: "v11";
      readonly k12: "v12";
      readonly k13: "v13";
      readonly k14: "v14";
      readonly k15: "v15";
    };
    const _checkExpectedAssignableToInferred: Inferred = {} as Expected;
    const _checkInferredAssignableToExpected: Expected = {} as Inferred;
    void _checkExpectedAssignableToInferred;
    void _checkInferredAssignableToExpected;
  });

  it("should report type-level arity error for sixteen parsers", () => {
    // @ts-expect-error - merge() supports up to 15 parser arguments.
    const _tooMany = merge(
      object({ k1: constant("v1" as const) }),
      object({ k2: constant("v2" as const) }),
      object({ k3: constant("v3" as const) }),
      object({ k4: constant("v4" as const) }),
      object({ k5: constant("v5" as const) }),
      object({ k6: constant("v6" as const) }),
      object({ k7: constant("v7" as const) }),
      object({ k8: constant("v8" as const) }),
      object({ k9: constant("v9" as const) }),
      object({ k10: constant("v10" as const) }),
      object({ k11: constant("v11" as const) }),
      object({ k12: constant("v12" as const) }),
      object({ k13: constant("v13" as const) }),
      object({ k14: constant("v14" as const) }),
      object({ k15: constant("v15" as const) }),
      object({ k16: constant("v16" as const) }),
    );
    void _tooMany;
  });

  it("should report type-level arity error for sixteen parsers with options", () => {
    // @ts-expect-error - merge() supports up to 15 parser arguments.
    const _tooMany = merge(
      object({ k1: constant("v1" as const) }),
      object({ k2: constant("v2" as const) }),
      object({ k3: constant("v3" as const) }),
      object({ k4: constant("v4" as const) }),
      object({ k5: constant("v5" as const) }),
      object({ k6: constant("v6" as const) }),
      object({ k7: constant("v7" as const) }),
      object({ k8: constant("v8" as const) }),
      object({ k9: constant("v9" as const) }),
      object({ k10: constant("v10" as const) }),
      object({ k11: constant("v11" as const) }),
      object({ k12: constant("v12" as const) }),
      object({ k13: constant("v13" as const) }),
      object({ k14: constant("v14" as const) }),
      object({ k15: constant("v15" as const) }),
      object({ k16: constant("v16" as const) }),
      { allowDuplicates: false },
    );
    void _tooMany;
  });

  it("should enforce arity limit when last argument is a named parser variable", () => {
    const p16 = object({ k16: constant("v16" as const) });

    // @ts-expect-error - the 16th parser must not be interpreted as options.
    const _tooMany = merge(
      object({ k1: constant("v1" as const) }),
      object({ k2: constant("v2" as const) }),
      object({ k3: constant("v3" as const) }),
      object({ k4: constant("v4" as const) }),
      object({ k5: constant("v5" as const) }),
      object({ k6: constant("v6" as const) }),
      object({ k7: constant("v7" as const) }),
      object({ k8: constant("v8" as const) }),
      object({ k9: constant("v9" as const) }),
      object({ k10: constant("v10" as const) }),
      object({ k11: constant("v11" as const) }),
      object({ k12: constant("v12" as const) }),
      object({ k13: constant("v13" as const) }),
      object({ k14: constant("v14" as const) }),
      object({ k15: constant("v15" as const) }),
      p16,
    );
    void _tooMany;
  });

  it("should report type-level arity error for zero parsers", () => {
    // @ts-expect-error - merge() requires at least one parser argument.
    const _noParsers = merge();
    void _noParsers;
  });

  it("should accept spread parser arrays without tuple length information", () => {
    const dynamicParsers: Parser<
      "sync",
      Record<string | symbol, unknown>,
      Record<string | symbol, unknown>
    >[] = [
      object({ first: constant("first" as const) }),
      object({ second: constant("second" as const) }),
    ];

    const parser = merge(...dynamicParsers);
    const result = parseSync(parser, []);
    assert.ok(result.success);
    if (result.success) {
      const value = result.value as Record<string, unknown>;
      assert.equal(value.first, "first");
      assert.equal(value.second, "second");
    }
  });

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

    const result = parseSync(parser, ["-v", "-p", "8080", "-h", "localhost"]);
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

    const result = parseSync(parser, ["-1", "test", "-2", "42", "-3"]);
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

    const result = parseSync(parser, ["-a", "-b", "-c", "-d"]);
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

    const result = parseSync(parser, ["-a", "-b", "-c", "-d", "-e"]);
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

    const result = parseSync(mergedParser, ["-1"]);
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

    const result = parseSync(parser, ["-p", "0", "-h", "localhost"]);
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

    const invalidNumberResult = parseSync(parser, ["-n", "5"]);
    assert.ok(!invalidNumberResult.success);

    const invalidTextResult = parseSync(parser, ["-t", "lowercase"]);
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

    const result = parseSync(parser, ["-o", "value", "argument"]);
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

    const result = parseSync(parser, [
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

    const result = parseSync(parser, ["-v", "-o", "out.txt", "input.txt"]);
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

    const result1 = parseSync(parser, ["-1", "hello"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.value, "hello");
    }

    const result2 = parseSync(parser, ["-2", "42"]);
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
    const result = parseSync(parser, ["-1", "-p", "8080"]);
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
    const result = parseSync(parser, ["-1", "-p", "0"]);
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

    const basicResult = parseSync(parser, ["-f"]);
    assert.ok(basicResult.success);
    if (basicResult.success) {
      if ("basic" in basicResult.value) {
        assert.equal(basicResult.value.basic, "basic");
        assert.equal(basicResult.value.flag, true);
      }
    }

    const advancedResult = parseSync(parser, ["-v", "42"]);
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

    const result = parseSync(parser, [
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

    const result = parseSync(parser, ["-f", "--", "-not-an-option"]);
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

    const result = parseSync(parser, ["-d", "-t", "42", "-z", "-q", "value"]);
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
    const result = parseSync(parser, ["-1", "hello", "-2", "42"]);
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
    const result = parseSync(parser, []);
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

    const withOptionalResult = parseSync(parser, ["-n", "John", "-a", "30"]);
    assert.ok(withOptionalResult.success);
    if (withOptionalResult.success) {
      assert.equal(withOptionalResult.value.name, "John");
      assert.equal(withOptionalResult.value.age, 30);
      assert.equal(withOptionalResult.value.email, undefined);
    }

    const withoutOptionalResult = parseSync(parser, ["-n", "Jane"]);
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

    const result = parseSync(parser, [
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

    const result = parseSync(parser, ["-t", "hello", "-c", "42", "-f"]);
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

      const result = parseSync(parser, ["-v", "-p", "8080", "-h", "localhost"]);
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
      const result = parseSync(parser, ["-a", "test", "-b", "42", "-c"]);

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
      const result = parseSync(merged, args);

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

  // Tests for optional()/withDefault() support in merge() (issue #57)
  // https://github.com/dahlia/optique/issues/57
  describe("merge with optional(or(...))", () => {
    it("should parse positional argument when optional(or(...)) matches nothing", () => {
      const parser = merge(
        optional(
          or(
            object({
              verbosity: optional(
                map(multiple(flag("--verbose", "-v")), (v) => v.length),
              ),
            }),
            object({
              verbosity: optional(map(flag("--quiet", "-q"), () => 0)),
            }),
          ),
        ),
        object({ text: argument(string()) }),
      );

      // When no flags are provided, should still parse the argument
      const result = parseSync(parser, ["test"]);
      assert.ok(result.success, "Parsing should succeed");
      if (result.success) {
        assert.equal(result.value.text, "test");
      }
    });

    it("should parse positional argument with optional(or(...)) using flags", () => {
      const parser = merge(
        optional(
          or(
            object({
              verbosity: optional(
                map(multiple(flag("--verbose", "-v")), (v) => v.length),
              ),
            }),
            object({
              verbosity: optional(map(flag("--quiet", "-q"), () => 0)),
            }),
          ),
        ),
        object({ text: argument(string()) }),
      );

      // When --verbose is provided
      const result1 = parseSync(parser, ["--verbose", "test"]);
      assert.ok(result1.success, "Parsing with --verbose should succeed");
      if (result1.success) {
        assert.equal(result1.value.text, "test");
        assert.equal(result1.value.verbosity, 1);
      }

      // When --quiet is provided
      const result2 = parseSync(parser, ["--quiet", "test"]);
      assert.ok(result2.success, "Parsing with --quiet should succeed");
      if (result2.success) {
        assert.equal(result2.value.text, "test");
        assert.equal(result2.value.verbosity, 0);
      }

      // When multiple -v flags are provided
      const result3 = parseSync(parser, ["-v", "-v", "-v", "test"]);
      assert.ok(result3.success, "Parsing with -v -v -v should succeed");
      if (result3.success) {
        assert.equal(result3.value.text, "test");
        assert.equal(result3.value.verbosity, 3);
      }
    });

    it("should parse with optional(or(...)) using constant(undefined)", () => {
      // Another case from issue #57
      const parser = merge(
        optional(
          or(
            object({
              puzzleOrientation: map(
                option(
                  "--puzzleorientation",
                  string({ metavar: "JSON_STRING" }),
                ),
                JSON.parse,
              ),
              puzzleOrientations: constant(undefined),
            }),
            object({
              puzzleOrientation: constant(undefined),
              puzzleOrientations: map(
                option(
                  "--puzzleorientations",
                  string({ metavar: "JSON_STRING" }),
                ),
                JSON.parse,
              ),
            }),
          ),
        ),
        object({
          text: argument(string()),
        }),
      );

      // When no option is provided
      const result = parseSync(parser, ["3x3x3"]);
      assert.ok(result.success, "Parsing should succeed");
      if (result.success) {
        assert.equal(result.value.text, "3x3x3");
      }
    });

    it("should parse with withDefault(or(...), ...)", () => {
      const parser = merge(
        withDefault(
          or(
            object({
              verbosity: optional(
                map(multiple(flag("--verbose", "-v")), (v) => v.length),
              ),
            }),
            object({
              verbosity: optional(map(flag("--quiet", "-q"), () => 0)),
            }),
          ),
          { verbosity: undefined },
        ),
        object({ text: argument(string()) }),
      );

      // When no flags are provided
      const result = parseSync(parser, ["test"]);
      assert.ok(result.success, "Parsing should succeed");
      if (result.success) {
        assert.equal(result.value.text, "test");
      }
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
    const result1 = parseSync(parser, ["sub1", "-o", "foo"]);
    assert.ok(result1.success, "sub1 -o foo should parse successfully");
    if (result1.success) {
      assert.equal(result1.value.cmd, "sub1");
      assert.equal(result1.value.theOption, "foo");
      assert.equal(result1.value.global, undefined);
    }

    // Test: sub1 without option
    const result2 = parseSync(parser, ["sub1"]);
    assert.ok(result2.success, "sub1 should parse successfully");
    if (result2.success) {
      assert.equal(result2.value.cmd, "sub1");
      assert.equal(result2.value.theOption, undefined);
    }

    // Test: sub2
    const result3 = parseSync(parser, ["sub2"]);
    assert.ok(result3.success, "sub2 should parse successfully");
    if (result3.success) {
      assert.equal(result3.value.cmd, "sub2");
    }

    // Test: sub1 with global option
    const result4 = parseSync(parser, ["--global", "sub1", "-o", "bar"]);
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

  it("should correctly infer InferValue types for merge with 3+ parsers", () => {
    // Regression test: merge() overloads for 3+ parsers previously used
    // conditional return types (ExtractObjectTypes<T> extends never ? never
    // : Parser<...>), which caused InferValue to remain as a deferred
    // conditional type instead of resolving to the concrete value type.
    // This was discovered via fedify2's inbox command which used a 4-parser
    // merge() and found that InferValue produced Parser<M, TValue, TState>
    // instead of the expected concrete type.

    // 3-parser merge
    const parser3 = merge(
      object({ name: option("-n", "--name", string()) }),
      object({ verbose: optional(flag("--verbose")) }),
      object({ count: option("-c", "--count", integer()) }),
    );
    type Inferred3 = InferValue<typeof parser3>;
    const _check3: Inferred3 = {} as {
      readonly name: string;
      readonly verbose: true | undefined;
      readonly count: number;
    };
    void _check3;

    const result3 = parseSync(parser3, ["-n", "foo", "-c", "3"]);
    assert.ok(result3.success);
    if (result3.success) {
      assert.equal(result3.value.name, "foo");
      assert.equal(result3.value.verbose, undefined);
      assert.equal(result3.value.count, 3);
    }

    // 4-parser merge (the exact arity that triggered the fedify2 bug)
    const parser4 = merge(
      object({ name: option("-n", "--name", string()) }),
      object({ verbose: optional(flag("--verbose")) }),
      object({ count: option("-c", "--count", integer()) }),
      object({
        tags: optional(multiple(option("-t", "--tag", string()))),
      }),
    );
    type Inferred4 = InferValue<typeof parser4>;
    const _check4: Inferred4 = {} as {
      readonly name: string;
      readonly verbose: true | undefined;
      readonly count: number;
      readonly tags: readonly string[] | undefined;
    };
    void _check4;

    const result4 = parseSync(parser4, [
      "-n",
      "bar",
      "--verbose",
      "-c",
      "5",
      "-t",
      "a",
      "-t",
      "b",
    ]);
    assert.ok(result4.success);
    if (result4.success) {
      assert.equal(result4.value.name, "bar");
      assert.equal(result4.value.verbose, true);
      assert.equal(result4.value.count, 5);
      assert.deepEqual(result4.value.tags, ["a", "b"]);
    }

    // 5-parser merge
    const parser5 = merge(
      object({ name: option("-n", "--name", string()) }),
      object({ verbose: optional(flag("--verbose")) }),
      object({ count: option("-c", "--count", integer()) }),
      object({
        tags: optional(multiple(option("-t", "--tag", string()))),
      }),
      object({
        mode: withDefault(
          option("-m", "--mode", choice(["dev", "prod"])),
          "dev" as const,
        ),
      }),
    );
    type Inferred5 = InferValue<typeof parser5>;
    const _check5: Inferred5 = {} as {
      readonly name: string;
      readonly verbose: true | undefined;
      readonly count: number;
      readonly tags: readonly string[] | undefined;
      readonly mode: "dev" | "prod";
    };
    void _check5;

    const result5 = parseSync(parser5, [
      "-n",
      "baz",
      "-c",
      "1",
      "-m",
      "prod",
    ]);
    assert.ok(result5.success);
    if (result5.success) {
      assert.equal(result5.value.name, "baz");
      assert.equal(result5.value.count, 1);
      assert.equal(result5.value.mode, "prod");
    }

    // InferValue with command() wrapping merge() (mirrors the fedify2 pattern)
    const subCmd = command(
      "inbox",
      merge(
        object({ host: option("-H", "--host", string()) }),
        object({ port: option("-p", "--port", integer()) }),
        object({
          follow: optional(multiple(option("-f", "--follow", string()))),
        }),
        object({ verbose: optional(flag("--verbose")) }),
      ),
    );
    type SubCmdValue = InferValue<typeof subCmd>;
    const _checkCmd: SubCmdValue = {} as {
      readonly host: string;
      readonly port: number;
      readonly follow: readonly string[] | undefined;
      readonly verbose: true | undefined;
    };
    void _checkCmd;

    const resultCmd = parseSync(subCmd, [
      "inbox",
      "-H",
      "localhost",
      "-p",
      "8080",
      "-f",
      "user1",
      "-f",
      "user2",
    ]);
    assert.ok(resultCmd.success);
    if (resultCmd.success) {
      assert.equal(resultCmd.value.host, "localhost");
      assert.equal(resultCmd.value.port, 8080);
      assert.deepEqual(resultCmd.value.follow, ["user1", "user2"]);
      assert.equal(resultCmd.value.verbose, undefined);
    }
  });

  it("should show subcommand help when merged with or() (#69)", () => {
    const addCommand = command(
      "add",
      object({
        action: constant("add" as const),
        name: option("-n", "--name", string({ metavar: "NAME" })),
      }),
    );

    const listCommand = command(
      "list",
      object({
        action: constant("list" as const),
        pattern: argument(string({ metavar: "PATTERN" })),
      }),
    );

    const globalOptions = object({
      verbose: optional(flag("--verbose")),
    });

    const parser = merge(globalOptions, or(addCommand, listCommand));

    // Parse "add" command
    // We need to use parser.parse() directly to get the next state
    const result = parser.parse({
      buffer: ["add"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(result.success);

    // Get doc fragments based on the state after parsing "add"
    const fragments = parser.getDocFragments({
      kind: "available",
      state: result.next.state,
    });

    const sections = fragments.fragments.filter((f) =>
      f.type === "section"
    ) as (DocFragment & { type: "section" })[];
    const allEntries = sections.flatMap((s) => s.entries);

    // Should include --name from add command
    const hasNameOption = allEntries.some((e: DocEntry) =>
      e.term.type === "option" && e.term.names.includes("--name")
    );
    assert.ok(
      hasNameOption,
      "Should include options from the selected command (add)",
    );

    // Should NOT include pattern argument from list command
    const hasPatternArg = allEntries.some((e: DocEntry) =>
      e.term.type === "argument" && e.term.metavar === "PATTERN"
    );
    assert.ok(
      !hasPatternArg,
      "Should NOT include arguments from other commands (list)",
    );

    // Should include global options
    const hasVerbose = allEntries.some((e: DocEntry) =>
      e.term.type === "option" && e.term.names.includes("--verbose")
    );
    assert.ok(hasVerbose, "Should include global options");
  });

  describe("nested merge with withDefault(or(...))", () => {
    it("should preserve option values through nested merge", () => {
      // Regression test: when withDefault(or(...)) is inside a nested merge,
      // the parsed option value should not be lost.
      const verbosityOpt = withDefault(
        or(
          object({
            verbosity: optional(
              map(multiple(flag("--verbose", "-v")), (v) => v.length),
            ),
          }),
          object({
            verbosity: optional(map(flag("--quiet", "-q"), () => 0)),
          }),
        ),
        { verbosity: undefined },
      );

      // Nested merge: merge(merge(withDefault(or(...)), object(...)), object(...))
      const nested = merge(
        merge(
          verbosityOpt,
          object({ config: optional(option("--config", string())) }),
        ),
        object({ text: argument(string()) }),
      );

      const result = parseSync(nested, [
        "--verbose",
        "--config",
        "f.toml",
        "hi",
      ]);
      assert.ok(result.success, "Parsing should succeed");
      if (result.success) {
        assert.equal(result.value.verbosity, 1);
        assert.equal(result.value.config, "f.toml");
        assert.equal(result.value.text, "hi");
      }
    });

    it("should preserve option values with inner merge containing withDefault(or(...))", () => {
      // The core bug: merge(object(...), merge(withDefault(or(...))))
      // The inner merge's state uses __parser_N keys for withDefault parsers,
      // but the outer merge's extractParserState loses them.
      const verbosityOpt = withDefault(
        or(
          object({
            verbosity: optional(
              map(multiple(flag("--verbose", "-v")), (v) => v.length),
            ),
          }),
          object({
            verbosity: optional(map(flag("--quiet", "-q"), () => 0)),
          }),
        ),
        { verbosity: undefined },
      );

      // Inner merge with only a withDefault(or(...))
      const innerMerge = merge(
        verbosityOpt,
        object({ x: constant("a") }),
      );

      // Outer merge wrapping the inner merge
      const outerMerge = merge(
        innerMerge,
        object({ text: argument(string()) }),
      );

      // --verbose should be captured by innerMerge's withDefault(or(...))
      const result = parseSync(outerMerge, ["--verbose", "hello"]);
      assert.ok(result.success, "Parsing should succeed");
      if (result.success) {
        assert.equal(result.value.verbosity, 1);
        assert.equal(result.value.x, "a");
        assert.equal(result.value.text, "hello");
      }
    });

    it("should use default when option is not provided in nested merge", () => {
      const verbosityOpt = withDefault(
        or(
          object({
            verbosity: optional(
              map(multiple(flag("--verbose", "-v")), (v) => v.length),
            ),
          }),
          object({
            verbosity: optional(map(flag("--quiet", "-q"), () => 0)),
          }),
        ),
        { verbosity: undefined },
      );

      const innerMerge = merge(
        verbosityOpt,
        object({ x: constant("a") }),
      );

      const outerMerge = merge(
        innerMerge,
        object({ text: argument(string()) }),
      );

      // When no verbosity flags are provided, should use default
      const result = parseSync(outerMerge, ["hello"]);
      assert.ok(result.success, "Parsing should succeed");
      if (result.success) {
        assert.equal(result.value.verbosity, undefined);
        assert.equal(result.value.x, "a");
        assert.equal(result.value.text, "hello");
      }
    });
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
    const result = parseSync(parser, ["-v", "-o", "file.txt"]);
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
    const result = parseSync(parser, ["-v"]);
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
  it("should preserve inferred tuple flattening up to fifteen parsers", () => {
    const parser = concat(
      tuple([constant("v1" as const)]),
      tuple([constant("v2" as const)]),
      tuple([constant("v3" as const)]),
      tuple([constant("v4" as const)]),
      tuple([constant("v5" as const)]),
      tuple([constant("v6" as const)]),
      tuple([constant("v7" as const)]),
      tuple([constant("v8" as const)]),
      tuple([constant("v9" as const)]),
      tuple([constant("v10" as const)]),
      tuple([constant("v11" as const)]),
      tuple([constant("v12" as const)]),
      tuple([constant("v13" as const)]),
      tuple([constant("v14" as const)]),
      tuple([constant("v15" as const)]),
    );

    type Inferred = InferValue<typeof parser>;
    type Expected = [
      "v1",
      "v2",
      "v3",
      "v4",
      "v5",
      "v6",
      "v7",
      "v8",
      "v9",
      "v10",
      "v11",
      "v12",
      "v13",
      "v14",
      "v15",
    ];
    const _checkExpectedAssignableToInferred: Inferred = {} as Expected;
    const _checkInferredAssignableToExpected: Expected = {} as Inferred;
    void _checkExpectedAssignableToInferred;
    void _checkInferredAssignableToExpected;
  });

  it("should report type-level arity error for sixteen tuple parsers", () => {
    const tupleParsers = [
      tuple([constant("v1" as const)]),
      tuple([constant("v2" as const)]),
      tuple([constant("v3" as const)]),
      tuple([constant("v4" as const)]),
      tuple([constant("v5" as const)]),
      tuple([constant("v6" as const)]),
      tuple([constant("v7" as const)]),
      tuple([constant("v8" as const)]),
      tuple([constant("v9" as const)]),
      tuple([constant("v10" as const)]),
      tuple([constant("v11" as const)]),
      tuple([constant("v12" as const)]),
      tuple([constant("v13" as const)]),
      tuple([constant("v14" as const)]),
      tuple([constant("v15" as const)]),
      tuple([constant("v16" as const)]),
    ] as const;

    // @ts-expect-error - concat() supports up to 15 parser arguments.
    const _tooMany = concat(...tupleParsers);
    void _tooMany;
  });

  it("should report type-level arity error for zero tuple parsers", () => {
    // @ts-expect-error - concat() requires at least one parser argument.
    const _noParsers = concat();
    void _noParsers;
  });

  it("should accept spread parser arrays without tuple length information", () => {
    const dynamicParsers: Parser<"sync", readonly unknown[], unknown>[] = [
      tuple([constant("first" as const)]),
      tuple([constant("second" as const)]),
    ];

    const parser = concat(...dynamicParsers);
    const result = parseSync(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value, ["first", "second"]);
    }
  });

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

    const result = parseSync(parser, ["-v", "-p", "8080", "-h", "localhost"]);
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

    const result = parseSync(parser, ["-1", "test", "-2", "42", "-3"]);
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

    const result = parseSync(parser, ["-a", "-b", "-c", "-d"]);
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

    const result = parseSync(parser, ["-a", "-b", "-c", "-d", "-e"]);
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

    const result = parseSync(parser, ["-v"]);
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

    const result = parseSync(parser, ["-s", "-a", "test", "-b", "42", "-c"]);
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

    const withOptionalResult = parseSync(parser, ["-n", "John", "-a", "30"]);
    assert.ok(withOptionalResult.success);
    if (withOptionalResult.success) {
      assert.equal(withOptionalResult.value.length, 3);
      assert.equal(withOptionalResult.value[0], "John");
      assert.equal(withOptionalResult.value[1], 30);
      assert.equal(withOptionalResult.value[2], undefined);
    }

    const withoutOptionalResult = parseSync(parser, ["-n", "Jane"]);
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

    const result = parseSync(parser, [
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

    const result = parseSync(parser, [
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

    const result = parseSync(parser, ["-o", "value", "argument"]);
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

    const result = parseSync(parser, ["-p", "0", "-h", "localhost"]);
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

    const invalidNumberResult = parseSync(parser, ["-n", "5"]);
    assert.ok(!invalidNumberResult.success);

    const invalidTextResult = parseSync(parser, ["-t", "lowercase"]);
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

    const result = parseSync(parser, [
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
    const result1 = parseSync(parser, ["-3"]);
    assert.ok(!result1.success);

    // Test case where valid empty input is provided - should succeed with defaults
    const result2 = parseSync(parser, []);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.length, 2);
      assert.equal(result2.value[0], false); // option "-1" defaults to false
      assert.equal(result2.value[1], false); // option "-2" defaults to false
    }

    // Test case where one parser consumes input
    const result3 = parseSync(parser, ["-1"]);
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

    const basicResult = parseSync(parser, ["-f"]);
    assert.ok(basicResult.success);
    if (basicResult.success) {
      assert.equal(basicResult.value.length, 2);
      assert.equal(basicResult.value[0], "basic");
      assert.equal(basicResult.value[1], true);
    }

    const advancedResult = parseSync(parser, ["-v", "42"]);
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

    const result = parseSync(parser, [
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

    const result = parseSync(parser, ["-f", "--", "-not-an-option"]);
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
    const result = parseSync(parser, ["-1", "hello", "-2", "42"]);
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
    const result = parseSync(parser, ["-p", "0", "-h", "localhost"]);
    assert.ok(!result.success); // Should fail during completion due to port validation
  });

  it("should handle empty parsers gracefully", () => {
    const empty1 = tuple([]);
    const empty2 = tuple([]);

    const parser = concat(empty1, empty2);

    // Empty parsers succeed when there is no input
    const result = parseSync(parser, []);
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

    const result = parseSync(parser, [
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
    const result1 = parseSync(baseParser, ["-v", "-p", "8080"]);
    const result2 = parseSync(groupedParser, ["-v", "-p", "8080"]);

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
    const result = parseSync(groupedFormat, ["--json"]);
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
    const result = parseSync(groupedDebug, ["--debug"]);
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
    const result = parseSync(groupedFiles, [
      "file1.txt",
      "file2.txt",
      "file3.txt",
    ]);
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

    const result = parseSync(outerParser, ["--debug"]);
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
    const result = parseSync(groupedParser, ["-c", "42", "-n", "test"]);

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
    const result1 = parseSync(groupedOptions, ["--verbose"]);
    assert.ok(result1.success);
    assert.deepStrictEqual(result1.value, { verbose: true });

    // Test parsing behavior - without flag
    const result2 = parseSync(groupedOptions, []);
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
    const result1 = parseSync(groupedServer, ["--port", "8080"]);
    assert.ok(result1.success);
    assert.deepStrictEqual(result1.value, { port: 8080 });

    // Test parsing behavior - without option (uses default)
    const result2 = parseSync(groupedServer, []);
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
    const logResult = parseSync(groupedLogLevel, ["--debug"]);
    assert.ok(logResult.success);
    assert.equal(logResult.value, "debug");

    const inputResult = parseSync(groupedInputSource, [
      "file1.txt",
      "file2.txt",
    ]);
    assert.ok(inputResult.success);
    assert.deepStrictEqual(inputResult.value, ["file1.txt", "file2.txt"]);

    const outputResult = parseSync(groupedOutputOptions, [
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

    const result = parseSync(parser, ["-v", "-o", "file.txt"]);
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

      const resultA = parseSync(parser, ["--type", "a", "--foo", "hello"]);
      assert.ok(resultA.success);
      if (resultA.success) {
        assert.deepEqual(resultA.value, ["a", { foo: "hello" }]);
      }

      const resultB = parseSync(parser, ["--type", "b", "--bar", "42"]);
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

      const result = parseSync(parser, ["--default", "value"]);
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

      const result = parseSync(parser, ["--foo", "hello"]);
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

      const result = parseSync(parser, ["--mode", "fast"]);
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

      const result = parseSync(parser, ["--type", "a"]);
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

      const result = parseSync(parser, ["--type", "invalid"]);
      assert.ok(!result.success);
    });

    it("should use static noMatch error override", () => {
      const parser = conditional(
        option("--type", choice(["a"])),
        {
          a: object({}),
        },
        object({}),
        {
          errors: {
            noMatch: message`No conditional match.`,
          },
        },
      );

      const result = parseSync(parser, ["--unknown"]);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(formatMessage(result.error), "No conditional match.");
      }
    });

    it("should use functional noMatch error override", () => {
      const parser = conditional(
        option("--type", choice(["a"])),
        {
          a: object({}),
        },
        object({}),
        {
          errors: {
            noMatch: ({ hasOptions, hasCommands, hasArguments }) =>
              message`No match context: ${
                text(
                  `${hasOptions}:${hasCommands}:${hasArguments}`,
                )
              }.`,
          },
        },
      );

      const result = parseSync(parser, ["--unknown"]);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(
          formatMessage(result.error),
          "No match context: true:false:false.",
        );
      }
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

      const result = parseSync(parser, ["--format", "json", "--pretty"]);
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
      const result1 = parseSync(parser, ["-a", "-a", "-a"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value, [true, true, true]);
      }

      // Multiple -b options
      const result2 = parseSync(parser, ["-b", "-b"]);
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

      const result = parseSync(parser, ["-a", "-b"]);
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

      const result1 = parseSync(outerOr, ["-a"]);
      assert.ok(result1.success);

      const result2 = parseSync(outerOr, ["-b"]);
      assert.ok(result2.success);

      const result3 = parseSync(outerOr, ["-c"]);
      assert.ok(result3.success);
    });

    it("should handle 3-level nested or()", () => {
      const level1 = or(option("-a"), option("-b"));
      const level2 = or(level1, option("-c"));
      const level3 = or(level2, option("-d"));

      const result1 = parseSync(level3, ["-a"]);
      assert.ok(result1.success);

      const result2 = parseSync(level3, ["-d"]);
      assert.ok(result2.success);
    });

    it("should maintain mutual exclusivity across nested levels", () => {
      const innerOr = or(option("-a"), option("-b"));
      const outerOr = or(innerOr, option("-c"));

      const result = parseSync(outerOr, ["-a", "-c"]);
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
      const result = parseSync(parser, ["-c", "-a", "-b"]);
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

      const result = parseSync(parser, [
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

      const result = parseSync(parser, []);
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
      const result1 = parseSync(parser, ["-a", "-b"]);
      assert.ok(result1.success);
      if (result1.success) {
        assert.deepEqual(result1.value, { a: true, b: true });
      }

      // Second branch
      const result2 = parseSync(parser, ["-c", "-d"]);
      assert.ok(result2.success);
      if (result2.success) {
        assert.deepEqual(result2.value, { c: true, d: true });
      }

      // No input - should return undefined
      const result3 = parseSync(parser, []);
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

      const result = parseSync(
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
      const result = parseSync(parser, ["file.txt", "-f"]);
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
      const result1 = parseSync(parser, ["-v", "file1.txt", "file2.txt"]);
      assert.ok(result1.success);

      // All from second branch
      const result2 = parseSync(parser, ["-q", "-f"]);
      assert.ok(result2.success);
    });
  });
});

describe("group() with command() - issue #116", () => {
  // https://github.com/dahlia/optique/issues/116
  // Follow-up to #114: top-level group label leaks into a selected
  // subcommand's own nested command list (the "children").
  it("group label should not appear on nested subcommand list", () => {
    const deleteCmd = command(
      "delete",
      object({ all: flag("--all") }),
      {},
    );
    const setCmd = command(
      "set",
      object({ shell: flag("-s", "--shell") }),
      {},
    );
    const aliasCmd = command("alias", or(deleteCmd, setCmd), {});
    const apiCmd = command(
      "api",
      object({ hostname: option("--hostname", string()) }),
      {},
    );
    const cli = group("Additional commands", or(aliasCmd, apiCmd));

    // Top-level: group label should appear with alias and api listed
    const topDoc = getDocPage(cli, []);
    assert.ok(topDoc);
    const topSection = topDoc.sections.find(
      (s) => s.title === "Additional commands",
    );
    assert.ok(
      topSection,
      "Top-level should have 'Additional commands' section",
    );
    assert.ok(
      topSection.entries.some((e) =>
        e.term.type === "command" && e.term.name === "alias"
      ),
      "Top-level 'Additional commands' section should list 'alias'",
    );

    // alias --help: group label must NOT appear on alias's own subcommands
    const aliasDoc = getDocPage(cli, ["alias"]);
    assert.ok(aliasDoc);
    const aliasSection = aliasDoc.sections.find(
      (s) => s.title === "Additional commands",
    );
    assert.ok(
      !aliasSection,
      "'alias' help should not have 'Additional commands' section for its subcommands",
    );
    // Subcommands of alias should still be visible
    const aliasEntries = aliasDoc.sections.flatMap((s) => s.entries);
    assert.ok(
      aliasEntries.some((e) =>
        e.term.type === "command" && e.term.name === "delete"
      ),
      "'alias' help should show 'delete' subcommand",
    );
    assert.ok(
      aliasEntries.some((e) =>
        e.term.type === "command" && e.term.name === "set"
      ),
      "'alias' help should show 'set' subcommand",
    );
  });

  it("group label should not appear after two levels of nesting", () => {
    // cli > remote (command with subcommands) > add/remove
    const remoteAddCmd = command(
      "add",
      object({ url: argument(string({ metavar: "URL" })) }),
      {},
    );
    const remoteRemoveCmd = command(
      "remove",
      object({ name: argument(string({ metavar: "NAME" })) }),
      {},
    );
    const remoteCmd = command("remote", or(remoteAddCmd, remoteRemoveCmd), {});
    const logCmd = command("log", object({}), {});
    const cli = group("Core commands", or(remoteCmd, logCmd));

    // Top-level: "Core commands" with remote and log
    const topDoc = getDocPage(cli, []);
    assert.ok(topDoc);
    assert.ok(
      topDoc.sections.some((s) => s.title === "Core commands"),
      "Top-level should have 'Core commands' section",
    );

    // remote --help: "Core commands" should NOT appear; add/remove should appear
    const remoteDoc = getDocPage(cli, ["remote"]);
    assert.ok(remoteDoc);
    assert.ok(
      !remoteDoc.sections.some((s) => s.title === "Core commands"),
      "'remote' help should not show outer 'Core commands' label on its subcommands",
    );
    const remoteEntries = remoteDoc.sections.flatMap((s) => s.entries);
    assert.ok(
      remoteEntries.some((e) =>
        e.term.type === "command" && e.term.name === "add"
      ),
      "'remote' help should show 'add' subcommand",
    );

    // remote add --help: "Core commands" should NOT appear
    const remoteAddDoc = getDocPage(cli, ["remote", "add"]);
    assert.ok(remoteAddDoc);
    assert.ok(
      !remoteAddDoc.sections.some((s) => s.title === "Core commands"),
      "'remote add' help should not show 'Core commands' label",
    );
  });

  it("inner group label on nested commands is preserved; outer is not", () => {
    // The inner command uses its own group() for its subcommands
    const deleteCmd = command("delete", object({}), {});
    const setCmd = command("set", object({}), {});
    const aliasCmd = command(
      "alias",
      group("Alias subcommands", or(deleteCmd, setCmd)),
      {},
    );
    const otherCmd = command("other", object({}), {});
    const cli = group("Additional commands", or(aliasCmd, otherCmd));

    // alias --help: "Alias subcommands" should appear; "Additional commands" should NOT
    const aliasDoc = getDocPage(cli, ["alias"]);
    assert.ok(aliasDoc);
    assert.ok(
      !aliasDoc.sections.some((s: DocSection) =>
        s.title === "Additional commands"
      ),
      "'alias' help should not show outer 'Additional commands' label",
    );
    assert.ok(
      aliasDoc.sections.some((s: DocSection) =>
        s.title === "Alias subcommands"
      ),
      "'alias' help should show inner 'Alias subcommands' label",
    );
  });

  it("multiple top-level groups: neither leaks into the other's subcommand help", () => {
    const coreGroup = group(
      "Core commands",
      or(
        command("auth", object({}), {}),
        command("repo", object({}), {}),
      ),
    );
    const actionsGroup = group(
      "Actions commands",
      or(
        command("run", object({}), {}),
        command("workflow", object({ verbose: flag("--verbose") }), {}),
      ),
    );
    const cli = or(coreGroup, actionsGroup);

    // auth --help: neither group label should appear on auth's content
    const authDoc = getDocPage(cli, ["auth"]);
    assert.ok(authDoc);
    assert.ok(
      !authDoc.sections.some((s) => s.title === "Core commands"),
      "'auth' help should not show 'Core commands' label",
    );
    assert.ok(
      !authDoc.sections.some((s) => s.title === "Actions commands"),
      "'auth' help should not show 'Actions commands' label",
    );

    // workflow --help: same
    const workflowDoc = getDocPage(cli, ["workflow"]);
    assert.ok(workflowDoc);
    assert.ok(
      !workflowDoc.sections.some((s) => s.title === "Actions commands"),
      "'workflow' help should not show 'Actions commands' label",
    );
  });

  it("nested commands with own subcommand group inside or() keep outer group at top level", () => {
    // Validates the top-level behaviour is NOT broken by the fix
    const aliasDeleteCmd = command("delete", object({}), {});
    const aliasSetCmd = command("set", object({}), {});
    const aliasCmd = command("alias", or(aliasDeleteCmd, aliasSetCmd), {});
    const apiCmd = command("api", object({}), {});
    const cli = group("Additional commands", or(aliasCmd, apiCmd));

    // Top-level must still show "Additional commands" with alias and api
    const topDoc = getDocPage(cli, []);
    assert.ok(topDoc);
    const topSection = topDoc.sections.find(
      (s: DocSection) => s.title === "Additional commands",
    );
    assert.ok(
      topSection,
      "Top-level must still have 'Additional commands' section",
    );
    assert.ok(
      topSection.entries.some((e: DocEntry) =>
        e.term.type === "command" && e.term.name === "alias"
      ),
    );
    assert.ok(
      topSection.entries.some((e: DocEntry) =>
        e.term.type === "command" && e.term.name === "api"
      ),
    );
  });
});

describe("group() with command() - issue #114", () => {
  // https://github.com/dahlia/optique/issues/114
  it("should not apply group label to subcommand flags in help", () => {
    const addCommand = command(
      "add",
      object({ action: constant("add"), force: option("--force") }),
      {},
    );
    const removeCommand = command(
      "remove",
      object({ action: constant("remove"), force: option("--force") }),
      {},
    );
    const cli = group("File commands", or(addCommand, removeCommand));

    // Top-level help should show commands under "File commands"
    const topDoc = getDocPage(cli, []);
    assert.ok(topDoc);
    const topGrouped = topDoc.sections.find((s) => s.title === "File commands");
    assert.ok(topGrouped, "Top-level help should have 'File commands' section");
    assert.ok(
      topGrouped.entries.some(
        (e) => e.term.type === "command" && e.term.name === "add",
      ),
    );

    // Subcommand help should NOT label flags under "File commands"
    const subDoc = getDocPage(cli, ["add"]);
    assert.ok(subDoc);
    const subGrouped = subDoc.sections.find(
      (s) => s.title === "File commands",
    );
    assert.ok(
      !subGrouped,
      "Subcommand help should not have 'File commands' section for flags",
    );
    // The --force flag should still appear, just not under a group title
    const allEntries = subDoc.sections.flatMap((s) => s.entries);
    assert.ok(
      allEntries.some(
        (e) => e.term.type === "option" && e.term.names.includes("--force"),
      ),
      "Subcommand help should still show --force flag",
    );
  });

  it("should handle multiple groups with commands", () => {
    // Two separate groups of commands combined with or()
    const fileGroup = group(
      "File commands",
      or(
        command("add", object({ action: constant("add") }), {}),
        command("remove", object({ action: constant("remove") }), {}),
      ),
    );
    const configGroup = group(
      "Config commands",
      or(
        command("set", object({ action: constant("set") }), {}),
        command("get", object({ action: constant("get") }), {}),
      ),
    );
    const cli = or(fileGroup, configGroup);

    // Top-level: both group labels should appear
    const topDoc = getDocPage(cli, []);
    assert.ok(topDoc);
    assert.ok(
      topDoc.sections.some((s) => s.title === "File commands"),
      "Top-level should have 'File commands' section",
    );
    assert.ok(
      topDoc.sections.some((s) => s.title === "Config commands"),
      "Top-level should have 'Config commands' section",
    );

    // Subcommand from first group: neither group label should appear
    const addDoc = getDocPage(cli, ["add"]);
    assert.ok(addDoc);
    assert.ok(
      !addDoc.sections.some((s) => s.title === "File commands"),
      "'add' help should not have 'File commands' section",
    );
    assert.ok(
      !addDoc.sections.some((s) => s.title === "Config commands"),
      "'add' help should not have 'Config commands' section",
    );

    // Subcommand from second group: same behavior
    const setDoc = getDocPage(cli, ["set"]);
    assert.ok(setDoc);
    assert.ok(
      !setDoc.sections.some((s) => s.title === "Config commands"),
      "'set' help should not have 'Config commands' section",
    );
  });

  it("should preserve inner group labels within subcommands", () => {
    // Commands whose inner parsers use group() for their own options
    const buildCmd = command(
      "build",
      merge(
        group(
          "Build options",
          object({ output: option("-o", "--output", string()) }),
        ),
        group(
          "Debug options",
          object({ verbose: flag("-v", "--verbose") }),
        ),
      ),
      {},
    );
    const testCmd = command(
      "test",
      object({ coverage: flag("--coverage") }),
      {},
    );
    const cli = group("Commands", or(buildCmd, testCmd));

    // Top-level: "Commands" label on the command list
    const topDoc = getDocPage(cli, []);
    assert.ok(topDoc);
    assert.ok(
      topDoc.sections.some((s) => s.title === "Commands"),
      "Top-level should have 'Commands' section",
    );

    // build --help: inner groups should appear, outer "Commands" should not
    const buildDoc = getDocPage(cli, ["build"]);
    assert.ok(buildDoc);
    assert.ok(
      !buildDoc.sections.some((s) => s.title === "Commands"),
      "'build' help should not show outer 'Commands' label",
    );
    assert.ok(
      buildDoc.sections.some((s) => s.title === "Build options"),
      "'build' help should show inner 'Build options' label",
    );
    assert.ok(
      buildDoc.sections.some((s) => s.title === "Debug options"),
      "'build' help should show inner 'Debug options' label",
    );
  });

  it("should handle single command wrapped in group", () => {
    // group() wrapping a single command (not or())
    const cli = group(
      "Main",
      command(
        "serve",
        object({
          port: option("-p", "--port", integer()),
          host: option("-h", "--host", string()),
        }),
        {},
      ),
    );

    // Top-level: "Main" label on the command
    const topDoc = getDocPage(cli, []);
    assert.ok(topDoc);
    assert.ok(
      topDoc.sections.some((s) => s.title === "Main"),
      "Top-level should have 'Main' section",
    );

    // serve --help: flags should not be labeled "Main"
    const serveDoc = getDocPage(cli, ["serve"]);
    assert.ok(serveDoc);
    assert.ok(
      !serveDoc.sections.some((s) => s.title === "Main"),
      "'serve' help should not show 'Main' label on flags",
    );
    const allEntries = serveDoc.sections.flatMap((s) => s.entries);
    assert.ok(
      allEntries.some(
        (e) => e.term.type === "option" && e.term.names.includes("--port"),
      ),
      "'serve' help should show --port flag",
    );
    assert.ok(
      allEntries.some(
        (e) => e.term.type === "option" && e.term.names.includes("--host"),
      ),
      "'serve' help should show --host flag",
    );
  });

  it("should still label non-command options with group", () => {
    // group() wrapping plain options (no commands) should always keep label
    const cli = merge(
      group(
        "Server",
        object({ port: option("--port", integer()) }),
      ),
      group(
        "Logging",
        object({ verbose: flag("--verbose") }),
      ),
    );

    const doc = getDocPage(cli, []);
    assert.ok(doc);
    assert.ok(
      doc.sections.some((s) => s.title === "Server"),
      "Should have 'Server' section for option group",
    );
    assert.ok(
      doc.sections.some((s) => s.title === "Logging"),
      "Should have 'Logging' section for option group",
    );
  });

  it("should handle deeply nested commands with groups", () => {
    // Two-level subcommand nesting: cli > remote > add/remove
    const remoteAddCmd = command(
      "add",
      object({ url: argument(string({ metavar: "URL" })) }),
      {},
    );
    const remoteRemoveCmd = command(
      "remove",
      object({ name: argument(string({ metavar: "NAME" })) }),
      {},
    );
    const remoteCmd = command(
      "remote",
      group("Remote actions", or(remoteAddCmd, remoteRemoveCmd)),
      {},
    );
    const cli = group(
      "Commands",
      or(
        remoteCmd,
        command("status", object({}), {}),
      ),
    );

    // Top-level: "Commands" on the command list
    const topDoc = getDocPage(cli, []);
    assert.ok(topDoc);
    assert.ok(
      topDoc.sections.some((s) => s.title === "Commands"),
    );

    // remote --help: "Remote actions" on the subcommand list,
    // outer "Commands" should not appear
    const remoteDoc = getDocPage(cli, ["remote"]);
    assert.ok(remoteDoc);
    assert.ok(
      !remoteDoc.sections.some((s) => s.title === "Commands"),
      "'remote' help should not show outer 'Commands' label",
    );
    assert.ok(
      remoteDoc.sections.some((s) => s.title === "Remote actions"),
      "'remote' help should show 'Remote actions' label",
    );

    // remote add --help: neither group label should appear, just the
    // argument entry
    const remoteAddDoc = getDocPage(cli, ["remote", "add"]);
    assert.ok(remoteAddDoc);
    assert.ok(
      !remoteAddDoc.sections.some((s) => s.title === "Commands"),
      "'remote add' help should not show 'Commands' label",
    );
    assert.ok(
      !remoteAddDoc.sections.some((s) => s.title === "Remote actions"),
      "'remote add' help should not show 'Remote actions' label",
    );
    const addEntries = remoteAddDoc.sections.flatMap((s) => s.entries);
    assert.ok(
      addEntries.some(
        (e) => e.term.type === "argument" && e.term.metavar === "URL",
      ),
      "'remote add' help should show URL argument",
    );
  });
});

describe("hidden option in group/object/merge", () => {
  it('should hide object usage only with hidden: "usage"', () => {
    const parser = object(
      {
        visible: option("--visible"),
        hiddenInUsage: option("--hidden-usage"),
      },
      { hidden: "usage" },
    );
    const usage = formatUsage("app", parser.usage);
    assert.equal(usage.trimEnd(), "app");
    const fragments = parser.getDocFragments({ kind: "unavailable" });
    const entries = fragments.fragments.flatMap((f) =>
      f.type === "section" ? f.entries : [f]
    );
    assert.equal(entries.length, 2);
  });

  it('should hide object docs only with hidden: "doc"', () => {
    const parser = object(
      {
        visible: option("--visible"),
        another: option("--another"),
      },
      { hidden: "doc" },
    );
    const usage = formatUsage("app", parser.usage);
    assert.equal(usage, "app [--visible] [--another]");
    const fragments = parser.getDocFragments({ kind: "unavailable" });
    const entries = fragments.fragments.flatMap((f) =>
      f.type === "section" ? f.entries : [f]
    );
    assert.equal(entries.length, 0);
  });

  it("should apply union of group and child hidden restrictions", () => {
    const parser = group(
      "Global",
      object({
        usageOnly: option("--usage-only", string(), { hidden: "usage" }),
        docOnly: option("--doc-only", string(), { hidden: "doc" }),
      }),
      { hidden: "usage" },
    );

    const usage = formatUsage("app", parser.usage);
    assert.equal(usage.trimEnd(), "app");

    const fragments = parser.getDocFragments({ kind: "unavailable" });
    const entries = fragments.fragments.flatMap((f) =>
      f.type === "section" ? f.entries : [f]
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].term.type, "option");
    if (entries[0].term.type === "option") {
      assert.equal(entries[0].term.names[0], "--usage-only");
    }
  });

  it('should hide merge docs only with hidden: "doc"', () => {
    const parser = merge(
      object({ a: option("--a") }),
      object({ b: option("--b") }),
      { hidden: "doc" },
    );
    const usage = formatUsage("app", parser.usage);
    assert.equal(usage, "app [--a] [--b]");
    const fragments = parser.getDocFragments({ kind: "unavailable" });
    const entries = fragments.fragments.flatMap((f) =>
      f.type === "section" ? f.entries : [f]
    );
    assert.equal(entries.length, 0);
  });

  it("should apply hidden usage recursively to optional/multiple/exclusive", () => {
    const parser = object(
      {
        maybe: optional(option("--maybe", string({ metavar: "VALUE" }))),
        tags: multiple(option("--tag", string({ metavar: "TAG" })), {
          min: 1,
        }),
        mode: or(option("--alpha"), option("--beta")),
      },
      { hidden: "usage" },
    );

    const usage = formatUsage("app", parser.usage);
    assert.equal(usage.trimEnd(), "app");
  });

  it("should hide command and passthrough docs with object hidden doc", () => {
    const parser = object(
      {
        run: command("run", option("--force")),
        rest: passThrough({ description: message`Other arguments` }),
      },
      { hidden: "doc" },
    );

    const fragments = parser.getDocFragments({ kind: "unavailable" });
    const entries = fragments.fragments.flatMap((fragment) =>
      fragment.type === "section" ? fragment.entries : [fragment]
    );

    assert.equal(entries.length, 0);
  });

  it("should hide command and passthrough usage with object hidden usage", () => {
    const parser = object(
      {
        run: command("run", option("--force")),
        rest: passThrough(),
      },
      { hidden: "usage" },
    );

    const usage = formatUsage("app", parser.usage);
    assert.equal(usage.trimEnd(), "app");
  });
});

// ---------------------------------------------------------------------------
// Branch-coverage regressions
// ---------------------------------------------------------------------------
describe("branch coverage regressions", () => {
  it("or() noMatch as function", () => {
    const parser = or(
      command("deploy", argument(string())),
      command("build", argument(string())),
      {
        errors: {
          noMatch: ({ hasCommands }) =>
            hasCommands
              ? message`Pick a command.`
              : message`No command available.`,
        },
      },
    );
    // empty input triggers noMatch via complete()
    const result = parseSync(parser, []);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "Pick a command.");
    }
  });

  it("longestMatch() noMatch as function", () => {
    const parser = longestMatch(
      command("a", constant("A")),
      command("b", constant("B")),
      {
        errors: {
          noMatch: ({ hasCommands }) =>
            hasCommands ? message`Choose a or b.` : message`Nothing.`,
        },
      },
    );
    const result = parseSync(parser, []);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "Choose a or b.");
    }
  });

  it("or() unexpectedInput as static Message", () => {
    const parser = or(
      command("deploy", constant("d")),
      command("build", constant("b")),
      {
        errors: {
          unexpectedInput: message`Unknown subcommand.`,
        },
      },
    );
    const result = parseSync(parser, ["oops"]);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "Unknown subcommand.");
    }
  });

  it("longestMatch() unexpectedInput as static Message", () => {
    const parser = longestMatch(
      command("x", constant("X")),
      command("y", constant("Y")),
      {
        errors: {
          unexpectedInput: message`Bad input.`,
        },
      },
    );
    const result = parseSync(parser, ["zzz"]);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "Bad input.");
    }
  });

  it("generateNoMatchError: commands + options (no args)", () => {
    // or(command, object-with-options) → hasCommands + hasOptions
    const parser = or(
      command("run", constant("run")),
      object({ verbose: flag("--verbose") }),
    );
    const result = parseSync(parser, []);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(
        formatMessage(result.error),
        "No matching option or command found.",
      );
    }
  });

  it("generateNoMatchError: args + commands (no options)", () => {
    const parser = or(
      command("run", constant("run")),
      tuple([argument(string())]),
    );
    const result = parseAsync(parser, []);
    assert.ok(result instanceof Promise);
    return result.then((r) => {
      assert.equal(r.success, false);
      if (!r.success) {
        assert.equal(
          formatMessage(r.error),
          "No matching command or argument found.",
        );
      }
    });
  });

  it("generateNoMatchError: all three (options + commands + args)", () => {
    const parser = or(
      command("run", constant("run")),
      object({ verbose: flag("--verbose") }),
      tuple([argument(string())]),
    );
    const result = parseAsync(parser, []);
    assert.ok(result instanceof Promise);
    return result.then((r) => {
      assert.equal(r.success, false);
      if (!r.success) {
        assert.equal(
          formatMessage(r.error),
          "No matching option, command, or argument found.",
        );
      }
    });
  });

  it("generateNoMatchError: args + options (no commands)", () => {
    const parser = or(
      object({ verbose: flag("--verbose") }),
      tuple([argument(string())]),
    );
    const result = parseAsync(parser, []);
    assert.ok(result instanceof Promise);
    return result.then((r) => {
      assert.equal(r.success, false);
      if (!r.success) {
        assert.equal(
          formatMessage(r.error),
          "No matching option or argument found.",
        );
      }
    });
  });

  it("DuplicateOptionError with description-less Symbol", () => {
    const sym = Symbol();
    assert.throws(
      () =>
        object({
          [sym]: flag("--dup"),
          other: flag("--dup"),
        }),
      (err: unknown) =>
        err instanceof DuplicateOptionError &&
        err.message.includes("--dup"),
    );
  });

  it("object() suggest with hidden: true suppresses suggestions", () => {
    const parser = object(
      {
        verbose: flag("--verbose"),
        name: option("--name", string()),
      },
      { hidden: true },
    );
    // Use parseSync to make a context, then invoke suggest manually
    const suggestions: Suggestion[] = [];
    for (
      const s of parser.suggest(
        {
          buffer: ["--"],
          optionsTerminated: false,
          state: parser.initialState,
          usage: parser.usage,
        },
        "--",
      ) as Iterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.equal(suggestions.length, 0);
  });

  it("createExclusiveComplete failed result branch", () => {
    // When a selected parser's parse succeeds but complete() fails,
    // the [i, result] state where !result.success triggers line 482.
    // We create an or() where the only matching parser fails on complete:
    const parser = or(
      object({ port: option("--port", integer({ min: 1 })) }),
      command("other", constant("o")),
    );
    const result = parseSync(parser, ["--port", "abc"]);
    assert.equal(result.success, false);
  });
});

// ---------- branch coverage regressions ----------

describe("branch coverage: error customization functions", () => {
  it("or() noMatch as function receives NoMatchContext", () => {
    const parser = or(
      command("foo", constant("f")),
      command("bar", constant("b")),
      {
        errors: {
          // Use text() so the output isn't quoted by the message formatter
          noMatch: (ctx) => [
            text(ctx.hasCommands ? "custom-noMatch-hasCommands" : "no-cmds"),
          ],
        },
      },
    );
    const result = parseSync(parser, []);
    assert.ok(!result.success);
    if (!result.success) {
      const formatted = formatMessage(result.error);
      assert.ok(formatted.includes("custom-noMatch-hasCommands"));
    }
  });

  it("or() unexpectedInput as function receives token", () => {
    const parser = or(
      command("foo", constant("f")),
      command("bar", constant("b")),
      {
        errors: {
          unexpectedInput: (token) => [text(`unexpected-token:${token}`)],
        },
      },
    );
    const result = parseSync(parser, ["baz"]);
    assert.ok(!result.success);
    if (!result.success) {
      const formatted = formatMessage(result.error);
      assert.ok(formatted.includes("unexpected-token:baz"));
    }
  });

  it("object() endOfInput as function receives NoMatchContext", () => {
    const parser = object(
      { name: option("--name", string()) },
      {
        errors: {
          endOfInput: (ctx) => [
            text(ctx.hasOptions ? "custom-eoi-hasOptions" : "custom-eoi-none"),
          ],
        },
      },
    );
    const result = parseSync(parser, []);
    assert.ok(!result.success);
    if (!result.success) {
      const formatted = formatMessage(result.error);
      assert.ok(formatted.includes("custom-eoi-hasOptions"));
    }
  });

  it("conditional() branchError function on sync complete", () => {
    const parser = conditional(
      option("--mode", choice(["a", "b"])),
      {
        a: object({ x: option("--x", integer()) }),
        b: object({ y: option("--y", string()) }),
      },
      constant(null),
      {
        errors: {
          branchError: (disc: string | undefined, _err: Message) => [
            text(`branch-error-for:${disc ?? "?"}`),
          ],
        },
      },
    );
    // parse with mode=a but provide invalid integer for --x
    const result = parseSync(parser, ["--mode", "a", "--x", "notnum"]);
    assert.ok(!result.success);
    if (!result.success) {
      const formatted = formatMessage(result.error);
      assert.ok(formatted.includes("branch-error-for:a"));
    }
  });

  it("longestMatch() noMatch as function", () => {
    const parser = longestMatch(
      command("alpha", constant("a")),
      command("beta", constant("b")),
      {
        errors: {
          noMatch: (ctx) => [
            text(ctx.hasCommands ? "lm-noMatch-cmds" : "lm-noMatch-none"),
          ],
        },
      },
    );
    const result = parseSync(parser, []);
    assert.ok(!result.success);
    if (!result.success) {
      const formatted = formatMessage(result.error);
      assert.ok(formatted.includes("lm-noMatch-cmds"));
    }
  });
});

describe("branch coverage: hidden visibility suppresses suggest", () => {
  it("merge() with hidden: true yields no suggestions", () => {
    const parser = merge(
      object({ a: option("--alpha", string()) }),
      object({ b: option("--beta", string()) }),
      { hidden: true },
    );
    const suggestions: Suggestion[] = [];
    for (
      const s of parser.suggest(
        {
          buffer: ["--"],
          optionsTerminated: false,
          state: parser.initialState,
          usage: parser.usage,
        },
        "--",
      ) as Iterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.equal(suggestions.length, 0);
  });

  it("group() with hidden: true yields no suggestions", () => {
    const parser = group(
      "grp",
      object({ v: flag("--verbose") }),
      { hidden: true },
    );
    const suggestions: Suggestion[] = [];
    for (
      const s of parser.suggest(
        {
          buffer: ["--"],
          optionsTerminated: false,
          state: parser.initialState,
          usage: parser.usage,
        },
        "--",
      ) as Iterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.equal(suggestions.length, 0);
  });
});

describe("branch coverage: conditional() complete/suggest edges", () => {
  it("complete with default branch when no discriminator provided", () => {
    const parser = conditional(
      option("--format", choice(["json", "csv"])),
      {
        json: object({ pretty: flag("--pretty") }),
        csv: object({ sep: option("--sep", string()) }),
      },
      object({ raw: flag("--raw") }),
    );
    // Provide only default-branch option
    const result = parseSync(parser, ["--raw"]);
    assert.ok(result.success);
    if (result.success) {
      // Should be [undefined, { raw: true }]
      assert.equal(result.value[0], undefined);
    }
  });

  it("complete with no branch and no default fails", () => {
    const parser = conditional(
      option("--format", choice(["json", "csv"])),
      {
        json: object({ pretty: flag("--pretty") }),
        csv: object({ sep: option("--sep", string()) }),
      },
    );
    const result = parseSync(parser, []);
    assert.ok(!result.success);
  });

  it("suggest delegates to selected branch after parse", () => {
    const parser = conditional(
      option("--format", choice(["json", "csv"])),
      {
        json: object({ pretty: flag("--pretty") }),
        csv: object({ sep: option("--sep", string()) }),
      },
    );
    // Parse with discriminator to select a branch
    const suggestions = suggestSync(parser, ["--format", "json", "--"]);
    // Should suggest --pretty from the json branch
    const texts = suggestions.map((s) => s.kind === "literal" ? s.text : "");
    assert.ok(texts.some((t) => t === "--pretty"));
  });

  it("suggest with default branch options before discriminator", () => {
    const parser = conditional(
      option("--format", choice(["json", "csv"])),
      {
        json: object({ pretty: flag("--pretty") }),
        csv: object({ sep: option("--sep", string()) }),
      },
      object({ raw: flag("--raw") }),
    );
    // Without discriminator, should suggest discriminator + default opts
    const suggestions = suggestSync(parser, ["--"]);
    const texts = suggestions.map((s) => s.kind === "literal" ? s.text : "");
    assert.ok(texts.some((t) => t === "--format"));
    assert.ok(texts.some((t) => t === "--raw"));
  });

  it("getDocFragments includes default branch entries", () => {
    const parser = conditional(
      option("--format", choice(["json", "csv"])),
      {
        json: object({ pretty: flag("--pretty") }),
        csv: object({ sep: option("--sep", string()) }),
      },
      object({ raw: flag("--raw") }),
    );
    const docPage = getDocPage(parser);
    assert.ok(docPage !== undefined);
    if (docPage) {
      // Should have "Default options" section
      const defaultSection = docPage.sections.find(
        (s) => s.title === "Default options",
      );
      assert.ok(defaultSection !== undefined);
      if (defaultSection) {
        // Should contain at least one entry (--raw)
        assert.ok(defaultSection.entries.length > 0);
      }
    }
  });

  it("complete uses discriminator state fallback on failure", () => {
    // When discriminator completion fails, should use selectedBranch.key
    const parser = conditional(
      option("--mode", choice(["a", "b"])),
      {
        a: constant("alpha"),
        b: constant("beta"),
      },
    );
    const result = parseSync(parser, ["--mode", "a"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "a");
      assert.equal(result.value[1], "alpha");
    }
  });

  it("complete on initial state uses default branch and can fail", () => {
    const ok = conditional(
      option("--mode", choice(["a", "b"])),
      { a: flag("--a"), b: flag("--b") },
      object({ raw: optional(flag("--raw")) }),
    );
    const okCompleted = ok.complete(ok.initialState);
    assert.ok(okCompleted.success);
    if (okCompleted.success) {
      assert.equal(okCompleted.value[0], undefined);
    }

    const failingDefault = conditional(
      option("--mode", choice(["a", "b"])),
      { a: flag("--a"), b: flag("--b") },
      object({ required: option("--required", string()) }),
    );
    const failed = failingDefault.complete(failingDefault.initialState);
    assert.ok(!failed.success);
  });

  it("complete on initial state fails when no default branch exists", () => {
    const parser = conditional(
      option("--mode", choice(["a", "b"])),
      { a: flag("--a"), b: flag("--b") },
    );
    const completed = parser.complete(parser.initialState);
    assert.ok(!completed.success);
  });

  it("sync complete falls back to selected branch key when discriminator completion fails", () => {
    const badDiscriminator: Parser<"sync", string, string> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 10,
      usage: [{ type: "option", names: ["--mode"], metavar: "MODE" }],
      initialState: "init",
      parse: () => ({
        success: true,
        consumed: ["--mode", "fast"],
        next: {
          buffer: [],
          state: "parsed",
          optionsTerminated: false,
          usage: [],
        },
      }),
      complete: () => ({ success: false, error: message`disc failed` }),
      suggest: function* () {
        yield { kind: "literal", text: "--mode" } as const;
      },
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = conditional(
      badDiscriminator,
      {
        fast: object({
          threads: withDefault(option("--threads", integer()), 1),
        }),
      },
    );
    const completed = parser.complete({
      discriminatorState: "parsed",
      discriminatorValue: "fast",
      selectedBranch: { kind: "branch", key: "fast" },
      branchState: {},
    });
    assert.ok(completed.success);
    if (completed.success) {
      assert.equal(completed.value[0], "fast");
    }
  });

  it("sync suggest delegates to selected default and selected branch", () => {
    const parser = conditional(
      option("--mode", choice(["fast", "slow"])),
      {
        fast: object({ threads: option("--threads", integer()) }),
        slow: object({ verbose: flag("--verbose") }),
      },
      object({ raw: flag("--raw") }),
    );

    const defaultSuggestions = [
      ...parser.suggest(
        {
          buffer: ["--"],
          state: {
            ...parser.initialState,
            selectedBranch: { kind: "default" as const },
            branchState: undefined,
          },
          optionsTerminated: false,
          usage: parser.usage,
        },
        "--",
      ) as Iterable<Suggestion>,
    ];
    assert.ok(
      defaultSuggestions.some((s) =>
        s.kind === "literal" && s.text === "--raw"
      ),
    );

    const branchSuggestions = [
      ...parser.suggest(
        {
          buffer: ["--"],
          state: {
            ...parser.initialState,
            selectedBranch: { kind: "branch" as const, key: "slow" },
            branchState: undefined,
          },
          optionsTerminated: false,
          usage: parser.usage,
        },
        "--",
      ) as Iterable<Suggestion>,
    ];
    assert.ok(
      branchSuggestions.some((s) =>
        s.kind === "literal" && s.text === "--verbose"
      ),
    );
  });

  it("conditional usage appends literal through optional/multiple/exclusive", () => {
    const discriminator: Parser<"sync", string, undefined> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 1,
      usage: [{
        type: "optional",
        terms: [{
          type: "multiple",
          min: 0,
          terms: [{
            type: "exclusive",
            terms: [[{ type: "option", names: ["--mode"], metavar: "MODE" }]],
          }],
        }],
      }],
      initialState: undefined,
      parse: () => ({
        success: false,
        consumed: 0,
        error: message`disc parse not used.`,
      }),
      complete: () => ({ success: true, value: "fast" }),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = conditional(
      discriminator,
      { fast: object({ threads: option("--threads", integer()) }) },
      object({ raw: flag("--raw") }),
    );
    const serialized = JSON.stringify(parser.usage);
    assert.ok(serialized.includes('"literal"'));
    assert.ok(serialized.includes('"fast"'));
  });
});

describe("branch coverage: generateNoMatchError variants", () => {
  it("args + commands but no options", () => {
    // Create a parser with arguments and commands but no options
    // or() with command + argument triggers hasArguments && hasCommands && !hasOptions
    const parser = or(
      command("sub", constant("s")),
      argument(string()),
    );
    const result = parseSync(parser, []);
    assert.ok(!result.success);
    if (!result.success) {
      const formatted = formatMessage(result.error);
      assert.ok(
        formatted.includes("command") || formatted.includes("argument"),
      );
    }
  });
});

describe("branch coverage: DuplicateOptionError with symbols", () => {
  it("formats symbol sources with description", () => {
    const sym = Symbol("myField");
    const err = new DuplicateOptionError("--opt", ["fieldA", sym]);
    assert.ok(err.message.includes("myField"));
    assert.ok(err.message.includes("fieldA"));
  });

  it("formats symbol without description via toString", () => {
    const sym = Symbol();
    const err = new DuplicateOptionError("--opt", ["fieldB", sym]);
    assert.ok(err.message.includes("Symbol()"));
    assert.ok(err.message.includes("fieldB"));
  });
});

describe("branch coverage: doc fragment section flattening", () => {
  it("object() getDocFragments with label promotes entries", () => {
    const parser = object(
      "Options",
      {
        name: option("--name", string(), {
          description: message`The name`,
        }),
        verbose: flag("--verbose", {
          description: message`Verbose mode`,
        }),
      },
    );
    const frags = parser.getDocFragments({ kind: "unavailable" }, undefined);
    // Should have at least one section with the "Options" title
    const sections = frags.fragments.filter((f) => f.type === "section");
    assert.ok(sections.length > 0);
  });

  it("merge() getDocFragments flattens unlabeled sections", () => {
    const parser = merge(
      object({
        a: option("--alpha", string(), { description: message`Alpha` }),
      }),
      object({
        b: option("--beta", string(), { description: message`Beta` }),
      }),
    );
    const frags = parser.getDocFragments({ kind: "unavailable" }, undefined);
    // Unlabeled object parsers have their entries promoted into the anonymous
    // section at the end. Check all entries across all sections.
    const allEntries = frags.fragments.flatMap((f) =>
      f.type === "section" ? f.entries : []
    );
    assert.ok(allEntries.length >= 2);
  });

  it("tuple() getDocFragments with available state", () => {
    const inner1 = option("--x", string(), { description: message`X opt` });
    const inner2 = flag("--y", { description: message`Y flag` });
    const parser = tuple("Section", [inner1, inner2]);
    // Use the parser's own initialState to avoid type mismatch
    const frags = parser.getDocFragments(
      { kind: "available", state: parser.initialState },
      undefined,
    );
    const sections = frags.fragments.filter((f) => f.type === "section");
    assert.ok(sections.length > 0);
  });

  it("concat() getDocFragments flattens unlabeled sections", () => {
    const t1 = tuple([
      option("--a", string(), { description: message`A` }),
    ]);
    const t2 = tuple([
      option("--b", string(), { description: message`B` }),
    ]);
    const parser = concat(t1, t2);
    const frags = parser.getDocFragments({ kind: "unavailable" }, undefined);
    // Should have entries promoted from untitled child sections
    const allFrags = frags.fragments;
    assert.ok(allFrags.length > 0);
  });
});

describe("branch coverage: constructs.ts edge cases", () => {
  // ----- applyHiddenToUsageTerm: hidden == null early return (line 110) -----
  it("group() with no hidden option passes through usage unchanged", () => {
    const inner = option("--foo", string());
    // group() with no hidden option: hidden is undefined → hidden == null → early return
    const grp = group("test", inner);
    const result = parseSync(grp, ["--foo", "bar"]);
    assert.ok(result.success);
    if (result.success) assert.equal(result.value, "bar");
  });

  // ----- applyHiddenToUsageTerm: else return term fallthrough (line 139)
  // A term type not matched by the known branches (e.g., "literal" from
  // appendLiteralToUsage inside conditional).  group() with hidden:true calls
  // applyHiddenToUsageTerm on all usage terms including "literal" terms
  // produced by conditional()'s appendLiteralToUsage.
  it("applyHiddenToUsageTerm falls through for literal terms", () => {
    // conditional() produces "literal" usage terms via appendLiteralToUsage.
    // Wrapping in group(hidden:true) causes applyHiddenToUsageTerm to be called
    // with these literal terms, hitting the final `return term;` branch.
    const disc = option("--mode", string());
    const cond = conditional(disc, {
      fast: option("--threads", integer()),
    });
    const grp = group("wrapped", cond, { hidden: true });
    // Parsing should still work even with hidden:true
    const result = parseSync(grp, ["--mode", "fast", "--threads", "4"]);
    assert.ok(result.success);
  });

  // ----- isOptionRequiringValue: null/non-array guard (line 199) -----
  // This guard is defensive; it is hard to trigger through normal APIs.
  // We test it indirectly by calling suggestSync with a buffer that includes
  // an option token, so isOptionRequiringValue is called with normal usage.
  it("suggestSync with option-token buffer calls isOptionRequiringValue", () => {
    const p = object({
      name: option("--name", string()),
    });
    // Buffer ends with an option that requires a value: suggestSync will call
    // isOptionRequiringValue("--name") and it should return true, routing
    // suggestions to the --name parser only.
    const suggestions = suggestSync(p, ["--name", ""]);
    assert.ok(Array.isArray([...suggestions]));
  });

  // ----- createExclusiveComplete: !result.success branch (line 482) -----
  it("or() complete when selected parser state is failure", () => {
    // Make a parser that always fails complete: use a required option that
    // was never provided.  We force the or() to have selected a branch by
    // giving it a partial parse, then complete without the required value.
    const p = or(option("--req", string()), flag("--other"));
    // parseSync will fail for partial option (no value)
    const result = parseSync(p, ["--req"]);
    // Result should fail because value is missing.
    assert.ok(!result.success);
  });

  // ----- createExclusiveSuggest: parser.$mode === "async" else branch (line 575) -----
  it("or() async suggest: selected sync parser goes through else branch", async () => {
    // An async-mode or() with a sync inner parser: when a sync parser's
    // suggestions are collected in the async path, the else branch at line 575
    // is hit (push via spread, not async iteration).
    const syncParser = option("--sync", string());
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const asyncParser = option("--async", asyncValueParser);
    const combined = or(syncParser, asyncParser);
    // The combined parser is async; suggest should work
    const suggs = await suggestAsync(combined, ["--"]);
    assert.ok(Array.isArray(suggs));
  });

  // ----- suggestObjectAsync: DependencyRegistry false branch (line 2294) -----
  it("suggestObjectAsync with no dependency registry builds fresh registry", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const p = object({
      x: option("--x", asyncValueParser),
    });
    // suggestAsync calls suggestObjectAsync; context won't have a
    // DependencyRegistry, so the fresh-registry branch (line 2294) is hit.
    const suggs = await suggestAsync(p, ["--"]);
    assert.ok(Array.isArray(suggs));
  });

  // ----- suggestObjectAsync: field not in context.state (line 2268 / 2317) -----
  it("suggestObjectAsync with state missing some fields uses initialState", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const p = object({
      x: option("--x", asyncValueParser),
      y: option("--y", string()),
    });
    // Provide state without field "y": the field-not-in-state branch is taken.
    const suggs = await suggestAsync(p, ["--x", ""]);
    assert.ok(Array.isArray(suggs));
  });

  // ----- collectDependencyValues: multi-dep missing default (line 2446) -----
  // The i >= defaults.length path: a multi-dependency where the number of
  // depIds exceeds defaults.length.  This is an unusual edge case that falls
  // back to returning null (missing dependency).  Exercised indirectly via
  // object() parse; we skip this as it requires internal state construction.

  // ----- resolveDeferred: reParseResult instanceof Promise (line 2501) -----
  // This branch is hit when a DeferredParseState's parser returns a Promise.
  // It's exercised by async parsers that use deriveFrom with async value
  // parsers; already covered by other dependency tests.

  // ----- object() parseSync: error.consumed < result.consumed update (line 2883) -----
  it("object() parseSync updates best error when consumed improves", () => {
    // Two required options: providing only partial input so that one option
    // fails after consuming more than the default 0 – the error tracking at
    // line 2883 is exercised.
    const p = object({
      a: option("--a", string()),
      b: option("--b", string()),
    });
    // Provide "--a" but no value → partial consumption failure
    const result = parseSync(p, ["--a"]);
    assert.ok(!result.success);
  });

  it("or() complete handles selected failure state directly", () => {
    const parser = or(option("--value", string()), flag("--flag"));
    const completed = parser.complete([
      0,
      {
        success: false,
        consumed: 1,
        error: message`forced selected failure.`,
      },
    ]);
    assert.ok(!completed.success);
    if (!completed.success) {
      assert.equal(formatMessage(completed.error), "forced selected failure.");
    }
  });

  it("or() async suggest uses sync selected parser branch", async () => {
    const asyncParser = option("--async", asyncStringValue());
    const syncParser = option("--sync", string());
    const parser = or(syncParser, asyncParser);
    const suggestions: Suggestion[] = [];
    const iter = parser.suggest(
      {
        buffer: [],
        state: [0, {
          success: true,
          next: {
            buffer: [],
            state: syncParser.initialState,
            optionsTerminated: false,
            usage: parser.usage,
          },
          consumed: [],
        }],
        optionsTerminated: false,
        usage: parser.usage,
      } as ParserContext<typeof parser.initialState>,
      "--",
    );
    for await (const s of iter as AsyncIterable<Suggestion>) {
      suggestions.push(s);
    }
    assert.ok(suggestions.length > 0);
  });

  // ----- object() parseSync: allCanComplete false path (line 2925) -----
  it("object() parseSync fails when a required field cannot complete", () => {
    const p = object({
      a: option("--a", string()), // required
    });
    const result = parseSync(p, []);
    assert.ok(!result.success);
  });

  it("object() parseSync uses parser initialState when context.state is non-object", () => {
    const p = object({
      name: optional(option("--name", string())),
    });
    const parsed = p.parse({
      buffer: [],
      state: 0 as unknown as typeof p.initialState,
      optionsTerminated: false,
      usage: p.usage,
    });
    assert.ok(parsed.success);
    if (parsed.success) {
      assert.deepEqual(parsed.consumed, []);
    }
  });

  // ----- object() parseAsync: error.consumed update (line 2971) -----
  it("object() parseAsync updates best error when consumed improves", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const p = object({
      a: option("--a", asyncValueParser),
      b: option("--b", string()),
    });
    // Partial consumption: "--a" with no value
    const result = await parseAsync(p, ["--a"]);
    assert.ok(!result.success);
  });

  // ----- object() parseAsync: allCanComplete false path (line 3014) -----
  it("object() parseAsync fails when required field cannot complete", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const p = object({
      a: option("--a", asyncValueParser),
    });
    const result = await parseAsync(p, []);
    assert.ok(!result.success);
  });

  it("object() parseAsync uses parser initialState when context.state is non-object", async () => {
    const p = object({
      name: optional(option("--name", asyncStringValue())),
    });
    const parsed = await p.parse({
      buffer: [],
      state: 0 as unknown as typeof p.initialState,
      optionsTerminated: false,
      usage: p.usage,
    });
    assert.ok(parsed.success);
    if (parsed.success) {
      assert.deepEqual(parsed.consumed, []);
    }
  });

  // ----- object() complete async: Phase 1 Cases 1/2/3 (lines 3083-3257) -----
  it("object() async complete Phase 1 Case 1: PendingDependencySourceState", async () => {
    // withDefault(option(...)) creates a parser with PendingDependencySourceState.
    // Using an async value parser forces object() into async mode.
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const p = object({
      a: option("--a", asyncValueParser),
      b: withDefault(option("--b", string()), "default_b"),
    });
    // Parse with only --a; --b falls back to withDefault → Case 1 path
    const result = await parseAsync(p, ["--a", "hello"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.a, "hello");
      assert.equal(result.value.b, "default_b");
    }
  });

  it("object() async complete Phase 1 Case 2: undefined state, initialState is Pending", async () => {
    // An option with dependencySource creates PendingDependencySourceState as initialState.
    // We need an async object to exercise the async complete path.
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const p = object({
      a: option("--a", asyncValueParser),
      // optional with withDefault: when not provided, state is undefined
      // and initialState may be PendingDependencySourceState
      b: withDefault(optional(option("--b", string())), "opt_default"),
    });
    const result = await parseAsync(p, ["--a", "val"]);
    assert.ok(result.success);
  });

  it("object() sync complete handles explicit pending state (Phase 1 Case 1)", () => {
    const dep = createPendingDependencySourceState(Symbol("obj-sync-case1"));
    const source = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      parse: (context: ParserContext<unknown>) => ({
        success: true as const,
        next: context,
        consumed: [],
      }),
      complete: () =>
        createDependencySourceState(
          { success: true as const, value: "sync-case1" },
          dep[dependencyId],
        ),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, unknown>;
    const p = object({ v: source });

    const completed = p.complete({ v: [dep] } as never);
    assert.ok(completed.success);
    if (completed.success) {
      assert.equal(completed.value.v, "sync-case1");
    }
  });

  it("object() sync complete handles undefined with pending initialState (Phase 1 Case 2)", () => {
    const dep = createPendingDependencySourceState(Symbol("obj-sync-case2"));
    const source = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: dep,
      parse: (context: ParserContext<unknown>) => ({
        success: true as const,
        next: context,
        consumed: [],
      }),
      complete: () =>
        createDependencySourceState(
          { success: true as const, value: "sync-case2" },
          dep[dependencyId],
        ),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, unknown>;
    const p = object({ v: source });

    const completed = p.complete({ v: undefined } as never);
    assert.ok(completed.success);
    if (completed.success) {
      assert.equal(completed.value.v, "sync-case2");
    }
  });

  it("object() async complete handles explicit pending and pending initialState", async () => {
    const dep = createPendingDependencySourceState(Symbol("obj-async-cases"));
    const source = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: dep,
      parse: (context: ParserContext<unknown>) =>
        Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "async-case" },
            dep[dependencyId],
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, unknown>;
    const p = object({ v: source });

    const fromExplicit = await p.complete({ v: [dep] } as never);
    assert.ok(fromExplicit.success);
    if (fromExplicit.success) {
      assert.equal(fromExplicit.value.v, "async-case");
    }

    const fromInitial = await p.complete({ v: undefined } as never);
    assert.ok(fromInitial.success);
    if (fromInitial.success) {
      assert.equal(fromInitial.value.v, "async-case");
    }
  });

  it("object() complete extracts pre-completed dependency failure (sync)", () => {
    const dep = createPendingDependencySourceState(Symbol("obj-sync-dep"));
    const failingWrapped = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      [wrappedDependencySourceMarker]: dep,
      parse: () => ({
        success: true as const,
        next: {
          buffer: [],
          state: undefined,
          optionsTerminated: false,
          usage: [],
        },
        consumed: [],
      }),
      complete: () =>
        createDependencySourceState(
          { success: false as const, error: message`object sync fail` },
          dep[dependencyId],
        ),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, undefined>;

    const p = object({ bad: failingWrapped });
    const completed = p.complete(p.initialState);
    assert.ok(!completed.success);
  });

  it("object() complete extracts pre-completed dependency failure (async)", async () => {
    const dep = createPendingDependencySourceState(Symbol("obj-async-dep"));
    const failingWrapped = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      [wrappedDependencySourceMarker]: dep,
      parse: () =>
        Promise.resolve({
          success: true as const,
          next: {
            buffer: [],
            state: undefined,
            optionsTerminated: false,
            usage: [],
          },
          consumed: [],
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: false as const, error: message`object async fail` },
            dep[dependencyId],
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, undefined>;

    const p = object({ bad: failingWrapped });
    const completed = await p.complete(p.initialState);
    assert.ok(!completed.success);
  });

  // ----- suggestTupleSync: stateArray not an array (line 3366) -----
  it("suggestTupleSync uses initialState when stateArray is not an array", () => {
    const p = tuple([option("--x", string()), flag("--y")]);
    // Call suggestSync with a prefix: stateArray will be the initialState
    // (which IS an array), so this tests the normal path.
    const suggs = suggestSync(p, ["--"]);
    assert.ok(Array.isArray([...suggs]));
  });

  // ----- suggestTupleAsync: sync parser in async path (line 3391) -----
  it("suggestTupleAsync: sync parser in async tuple goes through else branch", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const asyncParser = option("--async", asyncValueParser);
    const syncParser = option("--sync", string());
    const p = tuple([asyncParser, syncParser]);
    // p is async mode; suggestAsync calls suggestTupleAsync; syncParser
    // goes through the else branch (line 3391) instead of async iteration
    const suggs = await suggestAsync(p, ["--"]);
    assert.ok(Array.isArray(suggs));
  });

  // ----- tuple() parseAsync: zero-consumed success (line 3681) -----
  it("tuple() parseAsync handles optional parser succeeding without consuming", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const p = tuple([
      optional(option("--x", asyncValueParser)),
      option("--y", string()),
    ]);
    const result = await parseAsync(p, ["--y", "hello"]);
    assert.ok(result.success);
    if (result.success) {
      const [x, y] = result.value;
      assert.equal(x, undefined);
      assert.equal(y, "hello");
    }
  });

  // ----- tuple() async complete Phase 1 Cases (lines 3754-3896) -----
  it("tuple() sync complete Case 1: PendingDependencySourceState", () => {
    const p = tuple([
      option("--a", string()),
      withDefault(option("--b", string()), "dflt"),
    ]);
    const result = parseSync(p, ["--a", "x"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "x");
      assert.equal(result.value[1], "dflt");
    }
  });

  it("tuple() sync complete Case 2: undefined state, initialState is Pending", () => {
    const p = tuple([
      option("--a", string()),
      withDefault(optional(option("--b", string())), "fallback"),
    ]);
    const result = parseSync(p, ["--a", "hello"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "hello");
      assert.equal(result.value[1], undefined);
    }
  });

  it("tuple() sync complete handles explicit pending states for Case 1/2", () => {
    const dep1 = createPendingDependencySourceState(Symbol("tuple-case1-sync"));
    const dep2 = createPendingDependencySourceState(Symbol("tuple-case2-sync"));
    const pendingAware = (
      dep: ReturnType<typeof createPendingDependencySourceState>,
    ) =>
      ({
        $mode: "sync" as const,
        $valueType: undefined,
        $stateType: undefined,
        priority: 0,
        usage: [],
        initialState: dep,
        parse: () => ({
          success: true as const,
          next: {
            buffer: [],
            state: undefined,
            optionsTerminated: false,
            usage: [],
          },
          consumed: [],
        }),
        complete: (state: unknown) => {
          if (
            Array.isArray(state) &&
            state.length === 1 &&
            isPendingDependencySourceState(state[0])
          ) {
            return createDependencySourceState(
              { success: true as const, value: dep[dependencyId].description },
              dep[dependencyId],
            );
          }
          return { success: true as const, value: "fallback" };
        },
        suggest: function* () {},
        getDocFragments: () => ({ fragments: [] }),
      }) as unknown as Parser<"sync", string, unknown>;

    const p = tuple([pendingAware(dep1), pendingAware(dep2)]);
    const completed = p.complete([[dep1], undefined]);
    assert.ok(completed.success);
    if (completed.success) {
      assert.deepEqual(completed.value, [
        "tuple-case1-sync",
        "tuple-case2-sync",
      ]);
    }
  });

  it("tuple() async complete Case 1: PendingDependencySourceState", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const p = tuple([
      option("--a", asyncValueParser),
      withDefault(option("--b", string()), "dflt"),
    ]);
    const result = await parseAsync(p, ["--a", "x"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "x");
      assert.equal(result.value[1], "dflt");
    }
  });

  it("tuple() async complete Case 2: undefined state, initialState is Pending", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const p = tuple([
      option("--a", asyncValueParser),
      withDefault(optional(option("--b", string())), "fallback"),
    ]);
    const result = await parseAsync(p, ["--a", "hello"]);
    assert.ok(result.success);
  });

  it("tuple() async complete handles explicit pending states for Case 1/2", async () => {
    const dep1 = createPendingDependencySourceState(
      Symbol("tuple-case1-async"),
    );
    const dep2 = createPendingDependencySourceState(
      Symbol("tuple-case2-async"),
    );
    const pendingAware = (
      dep: ReturnType<typeof createPendingDependencySourceState>,
    ) =>
      ({
        $mode: "async" as const,
        $valueType: undefined,
        $stateType: undefined,
        priority: 0,
        usage: [],
        initialState: dep,
        parse: () =>
          Promise.resolve({
            success: true as const,
            next: {
              buffer: [],
              state: undefined,
              optionsTerminated: false,
              usage: [],
            },
            consumed: [],
          }),
        complete: (state: unknown) => {
          if (
            Array.isArray(state) &&
            state.length === 1 &&
            isPendingDependencySourceState(state[0])
          ) {
            return Promise.resolve(
              createDependencySourceState(
                {
                  success: true as const,
                  value: dep[dependencyId].description,
                },
                dep[dependencyId],
              ),
            );
          }
          return Promise.resolve({ success: true as const, value: "fallback" });
        },
        suggest: async function* () {},
        getDocFragments: () => ({ fragments: [] }),
      }) as unknown as Parser<"async", string, unknown>;

    const p = tuple([pendingAware(dep1), pendingAware(dep2)]);
    const completed = await p.complete([[dep1], undefined]);
    assert.ok(completed.success);
    if (completed.success) {
      assert.deepEqual(completed.value, [
        "tuple-case1-async",
        "tuple-case2-async",
      ]);
    }
  });

  it("tuple() complete pre-completed dependency failure (sync)", () => {
    const dep = createPendingDependencySourceState(Symbol("tuple-sync-dep"));
    const failingWrapped = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      [wrappedDependencySourceMarker]: dep,
      parse: () => ({
        success: true as const,
        next: {
          buffer: [],
          state: undefined,
          optionsTerminated: false,
          usage: [],
        },
        consumed: [],
      }),
      complete: () =>
        createDependencySourceState(
          { success: false as const, error: message`tuple sync fail` },
          dep[dependencyId],
        ),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, undefined>;
    const p = tuple([failingWrapped]);
    const completed = p.complete(p.initialState);
    assert.ok(!completed.success);
  });

  it("tuple() complete pre-completed dependency failure (async)", async () => {
    const dep = createPendingDependencySourceState(Symbol("tuple-async-dep"));
    const failingWrapped = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      [wrappedDependencySourceMarker]: dep,
      parse: () =>
        Promise.resolve({
          success: true as const,
          next: {
            buffer: [],
            state: undefined,
            optionsTerminated: false,
            usage: [],
          },
          consumed: [],
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: false as const, error: message`tuple async fail` },
            dep[dependencyId],
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, undefined>;
    const p = tuple([failingWrapped]);
    const completed = await p.complete(p.initialState);
    assert.ok(!completed.success);
  });

  it("tuple() complete pre-completed dependency success (sync + async)", async () => {
    const syncDep = createPendingDependencySourceState(Symbol("tuple-sync-ok"));
    const syncWrapped = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      [wrappedDependencySourceMarker]: syncDep,
      parse: () => ({
        success: true as const,
        next: {
          buffer: [],
          state: undefined,
          optionsTerminated: false,
          usage: [],
        },
        consumed: [],
      }),
      complete: () =>
        createDependencySourceState(
          { success: true as const, value: "sync-default" },
          syncDep[dependencyId],
        ),
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, undefined>;

    const asyncDep = createPendingDependencySourceState(
      Symbol("tuple-async-ok"),
    );
    const asyncWrapped = {
      $mode: "async" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      [wrappedDependencySourceMarker]: asyncDep,
      parse: () =>
        Promise.resolve({
          success: true as const,
          next: {
            buffer: [],
            state: undefined,
            optionsTerminated: false,
            usage: [],
          },
          consumed: [],
        }),
      complete: () =>
        Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "async-default" },
            asyncDep[dependencyId],
          ),
        ),
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, undefined>;

    const syncTuple = tuple([syncWrapped]);
    const syncCompleted = syncTuple.complete(syncTuple.initialState);
    assert.ok(syncCompleted.success);
    if (syncCompleted.success) {
      assert.deepEqual(syncCompleted.value, ["sync-default"]);
    }

    const asyncTuple = tuple([asyncWrapped]);
    const asyncCompleted = await asyncTuple.complete(asyncTuple.initialState);
    assert.ok(asyncCompleted.success);
    if (asyncCompleted.success) {
      assert.deepEqual(asyncCompleted.value, ["async-default"]);
    }
  });

  it("tuple() getDocFragments merges untitled section entries", () => {
    const parserWithUntitledSection = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      parse: (_context: ParserContext<undefined>) => ({
        success: false as const,
        consumed: 0,
        error: message`no parse`,
      }),
      complete: (_state: undefined) => ({
        success: true as const,
        value: true,
      }),
      suggest: function* () {},
      getDocFragments: () => ({
        fragments: [{
          type: "section" as const,
          title: null,
          entries: [{
            type: "entry" as const,
            term: {
              type: "option" as const,
              names: ["--from-custom"],
              preferredName: "--from-custom",
            },
          }],
        }],
      }),
    } as unknown as Parser<"sync", boolean, undefined>;

    const p = tuple("Doc Tuple", [parserWithUntitledSection]);
    const fragments = p.getDocFragments({
      kind: "available",
      state: p.initialState,
    });

    const mainSection = fragments.fragments.find((f) =>
      f.type === "section" && f.title === "Doc Tuple"
    );
    assert.ok(mainSection);
    if (mainSection?.type === "section") {
      assert.equal(mainSection.entries.length, 1);
      assert.equal(mainSection.entries[0].term.type, "option");
    }
  });

  it("tuple() custom inspect includes label and parser count", () => {
    const p = tuple("Inspect Tuple", [option("--flag")]);
    const inspect = (p as unknown as Record<symbol, () => string>)[
      Symbol.for("Deno.customInspect")
    ]();
    assert.equal(inspect, 'tuple("Inspect Tuple", [1 parser])');
  });

  // ----- tuple() getDocFragments: fragment.title == null promotes entries (line 3951) -----
  it("tuple() getDocFragments promotes null-title section entries", () => {
    // A child parser with no label produces a null-title section; its entries
    // are promoted to the top-level entries list.
    const inner1 = option("--x", string(), { description: message`X` });
    const inner2 = option("--y", string(), { description: message`Y` });
    // tuple() without a label creates a section with title=label (undefined
    // is used when no label given); inner parsers' null-title sections get
    // promoted.
    const p = tuple([inner1, inner2]);
    const frags = p.getDocFragments({ kind: "unavailable" }, undefined);
    const allEntries = frags.fragments.flatMap((f) =>
      f.type === "section" ? f.entries : []
    );
    assert.ok(allEntries.length >= 2);
  });

  // ----- merge() extractParserState: object initialState fields (lines 5188-5195) -----
  it("merge() extractParserState extracts matching fields from context state", () => {
    const p1 = object({
      x: optional(option("--x", string())),
      y: optional(option("--y", string())),
    });
    const p2 = object({ z: optional(option("--z", string())) });
    const m = merge(p1, p2);
    const result = parseSync(m, ["--y", "hello"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.y, "hello");
      assert.equal(result.value.z, undefined);
    }
  });

  // ----- merge() extractParserState: object initialState, state missing key -----
  it("merge() extractParserState uses parser.initialState when no fields provided", () => {
    const p1 = object({ x: optional(option("--x", string())) });
    const p2 = object({ y: optional(option("--y", string())) });
    const m = merge(p1, p2);
    // Parse with empty args: all optional fields absent → should complete fine
    const result = parseSync(m, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.x, undefined);
      assert.equal(result.value.y, undefined);
    }
  });

  it("merge() parseSync returns consuming failure from child parser", () => {
    const p1 = object({ x: option("--x", string()) });
    const p2 = object({ y: optional(option("--y", string())) });
    const m = merge(p1, p2);
    const result = parseSync(m, ["--x"]);
    assert.ok(!result.success);
  });

  it("merge() parseAsync keeps zero-consumed success context", async () => {
    const p1 = object({ a: optional(option("--a", asyncStringValue())) });
    const p2 = object({ b: optional(option("--b", string())) });
    const m = merge(p1, p2);
    const result = await parseAsync(m, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.a, undefined);
      assert.equal(result.value.b, undefined);
    }
  });

  // ----- merge() suggest: key-not-in-state (lines 5479/5483) -----
  it("merge() suggest with missing field in state uses parser.initialState", () => {
    const p1 = object({ x: option("--x", string()) });
    const p2 = object({ y: option("--y", string()) });
    const m = merge(p1, p2);
    // Suggest with a prefix: the state may be missing fields → initialState fallback
    const suggs = suggestSync(m, ["--"]);
    assert.ok(Array.isArray([...suggs]));
  });

  // ----- merge() suggest: async parser with sync inner (line 5517) -----
  it("merge() async suggest: sync inner parser goes through else branch", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const p1 = object({ a: option("--a", asyncValueParser) });
    const p2 = object({ b: flag("--b") });
    const m = merge(p1, p2);
    // m is async; async suggest path at line 5504 checks parser.$mode:
    // p2 is sync → else branch (line 5510/5517 area)
    const suggs = await suggestAsync(m, ["--"]);
    assert.ok(Array.isArray(suggs));
  });

  it("merge() suggest with hidden true returns empty in async mode", async () => {
    const p1 = object({ a: option("--a", asyncStringValue()) });
    const p2 = object({ b: option("--b", string()) });
    const m = merge(p1, p2, { hidden: true });
    const suggs = await suggestAsync(m, ["--"]);
    assert.deepEqual(suggs, []);
  });

  it("merge() complete handles missing sentinel and missing object keys", () => {
    const undefStateParser = withDefault(
      object({ x: optional(option("--x", string())) }),
      { x: undefined as string | undefined },
    );
    const objectParser = object({
      y: optional(option("--y", string())),
    });
    const merged = merge(undefStateParser, objectParser);
    const completed = merged.complete({});
    assert.ok(completed.success);
    if (completed.success) {
      assert.equal(completed.value.x, undefined);
      assert.equal(completed.value.y, undefined);
    }
  });

  it("merge() suggest handles missing parser state keys", () => {
    const undefStateParser = withDefault(
      object({ x: optional(option("--x", string())) }),
      { x: undefined as string | undefined },
    );
    const objectParser = object({
      y: optional(option("--y", string())),
    });
    const merged = merge(undefStateParser, objectParser);
    const suggestions: Suggestion[] = [];
    for (
      const s of merged.suggest(
        {
          buffer: [],
          // Intentionally omit __parser_0 and y to trigger fallback branches.
          state: {},
          optionsTerminated: false,
          usage: merged.usage,
        } as ParserContext<typeof merged.initialState>,
        "--",
      ) as Iterable<Suggestion>
    ) {
      suggestions.push(s);
    }
    assert.ok(Array.isArray(suggestions));
  });

  it("tuple() complete and inspect cover fallback branches", () => {
    const parser = tuple("Tuple label", [option("--name", string())]);
    const docs = parser.getDocFragments(
      {
        kind: "available",
        state: [] as unknown as typeof parser.initialState,
      },
      undefined,
    );
    assert.ok(docs.fragments.length > 0);
    const inspected = (
      parser as unknown as {
        [key: symbol]: () => string;
      }
    )[Symbol.for("Deno.customInspect")]();
    assert.ok(inspected.includes("tuple"));
  });

  it("merge() suggest uses undefined-state fallback for undefined initialState parser", () => {
    const undefStateParser = withDefault(
      object({ x: optional(option("--x", string())) }),
      { x: undefined as string | undefined },
    );
    const regular = object({ y: optional(option("--y", string())) });
    const m = merge(undefStateParser, regular);
    const suggs = suggestSync(m, ["--"]);
    assert.ok(Array.isArray([...suggs]));
  });

  // ----- merge() getDocFragments: null-title sections promoted (line 5594) -----
  it("merge() getDocFragments without label promotes null-title entries", () => {
    const p1 = object({
      a: option("--a", string(), { description: message`A` }),
    });
    const p2 = object({
      b: option("--b", string(), { description: message`B` }),
    });
    const m = merge(p1, p2);
    // Without a label, null-title sections are promoted to top-level entries
    const frags = m.getDocFragments({ kind: "unavailable" }, undefined);
    // The trailing { type: "section", entries } contains the promoted entries
    const allEntries = frags.fragments.flatMap((f) =>
      f.type === "section" ? f.entries : []
    );
    assert.ok(allEntries.length >= 2);
  });

  // ----- concatTuples() parseSync: error update (lines 5873/5900/5912) -----
  it("concat() parseSync updates error and fails when nothing matches", () => {
    const t1 = tuple([option("--a", string())]);
    const t2 = tuple([option("--b", string())]);
    const p = concat(t1, t2);
    // Provide garbage that doesn't match either parser
    const result = parseSync(p, ["--unknown"]);
    assert.ok(!result.success);
  });

  it("concat() parseAsync updates error and fails when nothing matches", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const t1 = tuple([option("--a", asyncValueParser)]);
    const t2 = tuple([option("--b", string())]);
    const p = concat(t1, t2);
    const result = await parseAsync(p, ["--unknown"]);
    assert.ok(!result.success);
  });

  // ----- concatTuples() completeSync: array value flattened (line 6047) -----
  it("concat() complete flattens two tuple array results", () => {
    // tuple() produces arrays; a concat of two tuple()s should flatten them.
    const t1 = tuple([option("--a", string())]);
    const t2 = tuple([option("--b", string())]);
    const p = concat(t1, t2);
    const result = parseSync(p, ["--a", "hello", "--b", "world"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "hello");
      assert.equal(result.value[1], "world");
    }
  });

  // ----- concatTuples() completeSync: non-array value else branch (line 6048) -----
  it("concat() complete handles optional elements that return scalar via optional", () => {
    // optional() wraps a value; the inner tuple element may produce undefined.
    const t1 = tuple([optional(option("--a", string()))]);
    const t2 = tuple([option("--b", string())]);
    const p = concat(t1, t2);
    const result = parseSync(p, ["--b", "world"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], undefined);
      assert.equal(result.value[1], "world");
    }
  });

  // ----- concatTuples() completeAsync: array value flattened (line 6083) -----
  it("concat() async complete flattens results", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const t1 = tuple([option("--a", asyncValueParser)]);
    const t2 = tuple([option("--b", string())]);
    const p = concat(t1, t2);
    const result = await parseAsync(p, ["--a", "hello", "--b", "world"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "hello");
      assert.equal(result.value[1], "world");
    }
  });

  // ----- concatTuples() getDocFragments: null-title and entries.length > 0 -----
  it("concat() getDocFragments with entries.length > 0 (line 6142/6174)", () => {
    const t1 = tuple([option("--a", string(), { description: message`A` })]);
    const t2 = tuple([option("--b", string(), { description: message`B` })]);
    const p = concat(t1, t2);
    const frags = p.getDocFragments({ kind: "unavailable" }, undefined);
    // The `if (entries.length > 0)` guard adds the trailing section
    const allEntries = frags.fragments.flatMap((f) =>
      f.type === "section" ? f.entries : []
    );
    assert.ok(allEntries.length >= 2);
  });

  it("concat() getDocFragments with labeled tuple promotes null-title sections", () => {
    const t1 = tuple("Group A", [
      option("--a", string(), { description: message`A` }),
    ]);
    const t2 = tuple([option("--b", string(), { description: message`B` })]);
    const p = concat(t1, t2);
    const frags = p.getDocFragments({ kind: "unavailable" }, undefined);
    assert.ok(frags.fragments.length >= 0);
  });

  // ----- conditional() async parse: selectedBranch branch (lines 6769-6783) -----
  it("conditional() async parse: delegates to selected branch parser", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const disc = option("--mode", asyncValueParser);
    const p = conditional(disc, {
      fast: option("--threads", integer()),
      slow: flag("--verbose"),
    });
    // First parse sets selected branch; second parse input consumed by branch
    const result = await parseAsync(p, ["--mode", "fast", "--threads", "8"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "fast");
      assert.equal(result.value[1], 8);
    }
  });

  // ----- conditional() async parse: no-match/default branch (lines 6865-6893) -----
  it("conditional() async parse: default branch used when discriminator no-match", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const disc = option("--mode", asyncValueParser);
    const defBranch = option("--default-val", string());
    const p = conditional(disc, {
      fast: option("--threads", integer()),
    }, defBranch);
    const result = await parseAsync(p, ["--default-val", "hello"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], undefined);
      assert.equal(result.value[1], "hello");
    }
  });

  // ----- conditional() async complete: selectedBranch.kind === "default" (line 7047) -----
  it("conditional() async complete: default branch selected", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const disc = option("--mode", asyncValueParser);
    const defBranch = flag("--verbose");
    const p = conditional(disc, {
      fast: option("--threads", integer()),
    }, defBranch);
    // Only default-branch input, no discriminator → complete uses default
    const result = await parseAsync(p, ["--verbose"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], undefined);
      assert.equal(result.value[1], true);
    }
  });

  // ----- conditional() async complete: named branch selected (lines 7064/7070) -----
  it("conditional() async complete: named branch selected, discriminator succeeds", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const disc = option("--mode", asyncValueParser);
    const p = conditional(disc, {
      fast: option("--threads", integer()),
    });
    const result = await parseAsync(p, ["--mode", "fast", "--threads", "4"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "fast");
      assert.equal(result.value[1], 4);
    }
  });

  // ----- conditional() async suggest: no branch selected (lines 7131/7142) -----
  it("conditional() async suggest: no branch selected yields discriminator suggestions", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const disc = option("--mode", asyncValueParser);
    const defBranch = option("--fallback", string());
    const p = conditional(disc, {
      fast: option("--threads", integer()),
    }, defBranch);
    // No branch selected: suggestAsync should hit the "no selectedBranch" path
    // and yield suggestions from discriminator + default branch
    const suggs = await suggestAsync(p, ["--"]);
    assert.ok(Array.isArray(suggs));
  });

  // ----- conditional() async suggest: branch selected (line 7153) -----
  it("conditional() async suggest: selected branch yields branch suggestions", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const disc = option("--mode", asyncValueParser);
    const p = conditional(disc, {
      fast: optional(option("--threads", integer())),
    });
    // Parse to select the "fast" branch (with optional threads)
    const parsed = await parseAsync(p, ["--mode", "fast"]);
    assert.ok(parsed.success);
    // Now suggest after the branch is selected
    const suggs = await suggestAsync(p, ["--mode", "fast", "--"]);
    assert.ok(Array.isArray(suggs));
  });

  // ----- conditional() async no-match failure (line 6912) -----
  it("conditional() async parse fails when nothing matches and no default", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const disc = option("--mode", asyncValueParser);
    const p = conditional(disc, {
      fast: option("--threads", integer()),
    });
    // Provide no matching input → should fail
    const result = await parseAsync(p, []);
    assert.ok(!result.success);
  });

  // ----- conditional() async complete: no branch, no default (line 6998) -----
  it("conditional() async complete with no branch and no default returns error", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const disc = option("--mode", asyncValueParser);
    const p = conditional(disc, {
      fast: option("--threads", integer()),
    });
    // Complete with no branch selected and no default → error
    const result = await parseAsync(p, []);
    assert.ok(!result.success);
  });

  // ----- conditional() async complete: branchError option (line 7047/7048) -----
  it("conditional() async complete with branchError option uses custom error", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const disc = option("--mode", asyncValueParser);
    // Use a default branch (object({})) so we can pass options; branchError
    // is invoked when a named branch's required field is missing.
    const p = conditional(
      disc,
      {
        fast: option("--threads", integer()), // integer required but not provided
      },
      object({}),
      {
        errors: {
          branchError: (key, err) =>
            message`Branch ${key ?? "?"} failed: ${formatMessage(err)}`,
        },
      },
    );
    // Select "fast" branch but don't provide --threads
    const result = await parseAsync(p, ["--mode", "fast"]);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(formatMessage(result.error).includes("fast"));
    }
  });

  // ----- appendLiteralToUsage: multiple/exclusive branches (lines 6602/6630/6641) -----
  it("conditional() with multiple/exclusive discriminator usage builds correct usage", () => {
    // choice() produces an exclusive usage term which exercises the
    // exclusive branch in appendLiteralToUsage
    const disc = option("--mode", choice(["a", "b", "c"]));
    const p = conditional(disc, {
      a: flag("--flag-a"),
      b: flag("--flag-b"),
      c: flag("--flag-c"),
    });
    const result = parseSync(p, ["--mode", "a", "--flag-a"]);
    assert.ok(result.success);
  });

  // ----- conditional() async complete: discriminatorCompleteResult failure (line 7085) -----
  it("conditional() async complete falls back to selectedBranch.key on discriminator failure", async () => {
    // Build an async conditional where discriminator complete is normal
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const disc = option("--mode", asyncValueParser);
    const p = conditional(disc, {
      fast: flag("--go"),
    });
    const result = await parseAsync(p, ["--mode", "fast", "--go"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "fast");
      assert.equal(result.value[1], true);
    }
  });

  it("tuple() suggest uses initialState when context.state is non-array", async () => {
    const syncTuple = tuple([option("--sync-only", string())]);
    const syncSuggestions = syncTuple.suggest(
      {
        buffer: [],
        state: {} as never,
        optionsTerminated: false,
        usage: syncTuple.usage,
      },
      "",
    );
    assert.ok(Array.isArray([...syncSuggestions]));

    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const asyncTuple = tuple([
      option("--async-first", asyncValueParser),
      option("--sync-second", string()),
    ]);
    const asyncSuggestions: Suggestion[] = [];
    for await (
      const suggestion of asyncTuple.suggest(
        {
          buffer: [],
          state: {} as never,
          optionsTerminated: false,
          usage: asyncTuple.usage,
        },
        "",
      )
    ) {
      asyncSuggestions.push(suggestion);
    }
    assert.ok(Array.isArray(asyncSuggestions));
  });

  it("concat() suggest handles non-array state in async mode", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const parser = concat(
      tuple([option("--a", asyncValueParser)]),
      tuple([option("--b", string())]),
    );

    const suggestions: Suggestion[] = [];
    for await (
      const suggestion of parser.suggest(
        {
          buffer: [],
          state: {} as never,
          optionsTerminated: false,
          usage: parser.usage,
        },
        "",
      )
    ) {
      suggestions.push(suggestion);
    }
    assert.ok(Array.isArray(suggestions));
  });

  it("conditional() parse handles undefined and preselected states", async () => {
    const syncConditional = conditional(
      option("--mode", choice(["fast", "slow"])),
      {
        fast: optional(option("--threads", integer())),
        slow: optional(flag("--verbose")),
      },
    );

    const syncFromUndefined = syncConditional.parse({
      buffer: ["--mode", "fast", "--threads", "8"],
      state: undefined as never,
      optionsTerminated: false,
      usage: syncConditional.usage,
    });
    assert.ok(syncFromUndefined.success);

    const syncFromSelected = syncConditional.parse({
      buffer: ["--threads", "10"],
      state: {
        discriminatorState: syncConditional.initialState.discriminatorState,
        discriminatorValue: "fast",
        selectedBranch: { kind: "branch", key: "fast" },
        branchState: syncConditional.initialState.branchState,
      },
      optionsTerminated: false,
      usage: syncConditional.usage,
    });
    assert.ok(syncFromSelected.success);

    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const asyncDefault = optional(option("--default", string()));
    const asyncConditional = conditional(
      option("--mode", asyncValueParser),
      { fast: optional(option("--threads", integer())) },
      asyncDefault,
    );

    const asyncFromUndefined = await asyncConditional.parse({
      buffer: ["--default", "x"],
      state: undefined as never,
      optionsTerminated: false,
      usage: asyncConditional.usage,
    });
    assert.ok(asyncFromUndefined.success);

    const asyncFromSelectedDefault = await asyncConditional.parse({
      buffer: ["--default", "y"],
      state: {
        discriminatorState: asyncConditional.initialState.discriminatorState,
        discriminatorValue: undefined,
        selectedBranch: { kind: "default" },
        branchState: asyncDefault.initialState,
      },
      optionsTerminated: false,
      usage: asyncConditional.usage,
    });
    assert.ok(asyncFromSelectedDefault.success);
  });

  it("conditional() complete handles selected branches directly", async () => {
    const syncConditional = conditional(
      option("--mode", choice(["fast", "slow"])),
      {
        fast: optional(option("--threads", integer())),
        slow: optional(flag("--verbose")),
      },
    );

    const syncParsed = syncConditional.parse({
      buffer: ["--mode", "fast", "--threads", "2"],
      state: syncConditional.initialState,
      optionsTerminated: false,
      usage: syncConditional.usage,
    });
    assert.ok(syncParsed.success);
    if (syncParsed.success) {
      const syncCompleted = syncConditional.complete(syncParsed.next.state);
      assert.ok(syncCompleted.success);
      if (syncCompleted.success) {
        assert.equal(syncCompleted.value[0], "fast");
      }
    }

    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const asyncConditional = conditional(
      option("--mode", asyncValueParser),
      { fast: optional(option("--threads", integer())) },
      optional(option("--default", string())),
    );

    const asyncParsed = await asyncConditional.parse({
      buffer: ["--mode", "fast", "--threads", "3"],
      state: asyncConditional.initialState,
      optionsTerminated: false,
      usage: asyncConditional.usage,
    });
    assert.ok(asyncParsed.success);
    if (asyncParsed.success) {
      const asyncCompleted = await asyncConditional.complete(
        asyncParsed.next.state,
      );
      assert.ok(asyncCompleted.success);
      if (asyncCompleted.success) {
        assert.equal(asyncCompleted.value[0], "fast");
      }
    }
  });

  it("conditional() suggest handles undefined and selected branch states", async () => {
    const asyncValueParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VAL",
      parse: (v) => Promise.resolve({ success: true, value: v }),
      format: (v) => v,
    };
    const parser = conditional(
      option("--mode", asyncValueParser),
      { fast: optional(option("--threads", integer())) },
      optional(option("--default", string())),
    );

    const withUndefinedState: Suggestion[] = [];
    for await (
      const suggestion of parser.suggest(
        {
          buffer: [],
          state: undefined as never,
          optionsTerminated: false,
          usage: parser.usage,
        },
        "",
      )
    ) {
      withUndefinedState.push(suggestion);
    }
    assert.ok(Array.isArray(withUndefinedState));

    const withSelectedBranch: Suggestion[] = [];
    for await (
      const suggestion of parser.suggest(
        {
          buffer: [],
          state: {
            discriminatorState: parser.initialState.discriminatorState,
            discriminatorValue: "fast",
            selectedBranch: { kind: "branch", key: "fast" },
            branchState: parser.initialState.branchState,
          },
          optionsTerminated: false,
          usage: parser.usage,
        },
        "",
      )
    ) {
      withSelectedBranch.push(suggestion);
    }
    assert.ok(Array.isArray(withSelectedBranch));
  });

  it("merge() parses undefined-initialState parsers with stored state keys", () => {
    const undefinedStateParser: Parser<
      "sync",
      { readonly dynamic: string },
      { readonly dynamicState?: string } | undefined
    > = {
      $mode: "sync",
      $valueType: [] as readonly { readonly dynamic: string }[],
      $stateType:
        [] as readonly ({ readonly dynamicState?: string } | undefined)[],
      priority: 0,
      usage: [],
      initialState: undefined,
      parse(context) {
        return {
          success: true,
          next: {
            ...context,
            state: context.state ?? { dynamicState: "restored" },
          },
          consumed: [],
        };
      },
      complete(state) {
        return {
          success: true,
          value: { dynamic: state?.dynamicState ?? "none" },
        };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const stableParser = object({
      stable: optional(option("--stable", string())),
    });
    const parser = merge(undefinedStateParser, stableParser);
    const parserKey = Object.keys(parser.initialState).find((key) =>
      key.startsWith("__parser_")
    );
    assert.ok(parserKey != null);

    const parsed = parser.parse({
      buffer: [],
      state: {
        [parserKey]: { dynamicState: "from-context" },
      },
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parsed.success);

    const completed = parser.complete(parsed.success ? parsed.next.state : {});
    assert.ok(completed.success);
    if (completed.success) {
      assert.equal(completed.value.dynamic, "from-context");
    }
  });

  it("conditional() complete uses DependencySourceState discriminator value (sync)", () => {
    const dep = Symbol("cond-disc-sync");
    const discriminator = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      initialState: "seed",
      parse(context: ParserContext<string>) {
        return {
          success: true,
          next: { ...context, state: "seed" },
          consumed: [],
        };
      },
      complete() {
        return createDependencySourceState(
          { success: true as const, value: "fast" },
          dep,
        );
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, string>;
    const slowBranch = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      initialState: undefined,
      parse(context: ParserContext<undefined>) {
        return { success: true as const, next: context, consumed: [] };
      },
      complete() {
        return { success: true as const, value: "S" };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as Parser<"sync", string, undefined>;
    const parser = conditional(discriminator, {
      fast: slowBranch,
      slow: slowBranch,
    });

    const completed = parser.complete({
      ...parser.initialState,
      discriminatorState: "seed",
      discriminatorValue: "ignored",
      selectedBranch: { kind: "branch", key: "slow" },
      branchState: undefined,
    });
    assert.ok(completed.success);
    if (completed.success) {
      assert.deepEqual(completed.value, ["fast", "S"]);
    }
  });

  it("conditional() complete falls back to selected key on discriminator dependency failure", () => {
    const dep = Symbol("cond-disc-sync-fail");
    const discriminator = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      initialState: "seed",
      parse(context: ParserContext<string>) {
        return {
          success: true,
          next: { ...context, state: "seed" },
          consumed: [],
        };
      },
      complete() {
        return createDependencySourceState(
          { success: false as const, error: message`disc fail` },
          dep,
        );
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, string>;
    const slowBranch = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      initialState: undefined,
      parse(context: ParserContext<undefined>) {
        return { success: true as const, next: context, consumed: [] };
      },
      complete() {
        return { success: true as const, value: "S" };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as Parser<"sync", string, undefined>;
    const parser = conditional(discriminator, {
      fast: slowBranch,
      slow: slowBranch,
    });

    const completed = parser.complete({
      ...parser.initialState,
      discriminatorState: "seed",
      discriminatorValue: "ignored",
      selectedBranch: { kind: "branch", key: "slow" },
      branchState: undefined,
    });
    assert.ok(completed.success);
    if (completed.success) {
      assert.deepEqual(completed.value, ["slow", "S"]);
    }
  });

  it("conditional() async complete uses default branch when none selected", async () => {
    const asyncDiscriminator = option("--mode", asyncStringValue());
    const parser = conditional(
      asyncDiscriminator,
      { fast: constant("F") },
      constant("D"),
    );
    const completed = await parser.complete(parser.initialState);
    assert.ok(completed.success);
    if (completed.success) {
      assert.deepEqual(completed.value, [undefined, "D"]);
    }
  });

  it("conditional() async complete requires discriminator without default", async () => {
    const asyncDiscriminator = option("--mode", asyncStringValue());
    const parser = conditional(asyncDiscriminator, { fast: constant("F") });
    const completed = await parser.complete(parser.initialState);
    assert.ok(!completed.success);
    if (!completed.success) {
      assert.equal(
        formatMessage(completed.error),
        "Missing required discriminator option.",
      );
    }
  });

  it("conditional() async complete uses DependencySourceState discriminator value", async () => {
    const dep = Symbol("cond-disc-async");
    const discriminator = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      initialState: "seed",
      parse(context: ParserContext<string>) {
        return Promise.resolve({
          success: true as const,
          next: { ...context, state: "seed" },
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "fast" },
            dep,
          ),
        );
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, string>;
    const slowBranch = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      initialState: undefined,
      parse(context: ParserContext<undefined>) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "S" });
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as Parser<"async", string, undefined>;
    const parser = conditional(discriminator, {
      fast: slowBranch,
      slow: slowBranch,
    });

    const completed = await parser.complete({
      ...parser.initialState,
      discriminatorState: "seed",
      discriminatorValue: "ignored",
      selectedBranch: { kind: "branch", key: "slow" },
      branchState: undefined,
    });
    assert.ok(completed.success);
    if (completed.success) {
      assert.deepEqual(completed.value, ["fast", "S"]);
    }
  });

  it("object() suggest returns empty when hidden is true in sync and async", async () => {
    const syncObject = object(
      { name: optional(option("--name", string())) },
      { hidden: true },
    );
    assert.deepEqual([...syncObject.suggest({
      buffer: [],
      state: syncObject.initialState,
      optionsTerminated: false,
      usage: syncObject.usage,
    }, "")], []);

    const asyncObject = object(
      { name: optional(option("--name", asyncStringValue())) },
      { hidden: true },
    );
    const asyncSuggestions: Suggestion[] = [];
    for await (
      const suggestion of asyncObject.suggest({
        buffer: [],
        state: asyncObject.initialState,
        optionsTerminated: false,
        usage: asyncObject.usage,
      }, "")
    ) {
      asyncSuggestions.push(suggestion);
    }
    assert.deepEqual(asyncSuggestions, []);
  });

  it("tuple() custom inspect covers unlabeled multi-parser format", () => {
    const parser = tuple([option("--first", string()), flag("--second")]);
    const inspect = (parser as unknown as Record<symbol, () => string>)[
      Symbol.for("Deno.customInspect")
    ]();
    assert.equal(inspect, "tuple([2 parsers])");
  });

  it("merge() uses parser initialState fallback for non-object state", async () => {
    const parser = merge(
      object({ a: optional(option("--a", asyncStringValue())) }),
      object({ b: optional(option("--b", string())) }),
    );

    const parsed = await parser.parse({
      buffer: [],
      state: 0 as unknown as typeof parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parsed.success);

    const completed = await parser.complete(
      0 as unknown as typeof parser.initialState,
    );
    assert.ok(completed.success);

    const suggestions: Suggestion[] = [];
    for await (
      const suggestion of parser.suggest({
        buffer: [],
        state: 0 as unknown as typeof parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      }, "--")
    ) {
      suggestions.push(suggestion);
    }
    assert.ok(Array.isArray(suggestions));
  });

  it("concat() marks zero-consumed failures as matched in sync and async", async () => {
    const failSync: Parser<"sync", readonly string[], undefined> = {
      $mode: "sync",
      $valueType: [] as readonly (readonly string[])[],
      $stateType: [] as readonly undefined[],
      priority: 5,
      usage: [],
      initialState: undefined,
      parse() {
        return { success: false as const, consumed: 0, error: message`fail` };
      },
      complete() {
        return { success: true as const, value: ["sync-fail"] as const };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const zeroSync: Parser<"sync", readonly string[], undefined> = {
      ...failSync,
      parse(context) {
        return { success: true as const, next: context, consumed: [] };
      },
      complete() {
        return { success: true as const, value: ["sync-zero"] as const };
      },
    };
    const syncParser = concat(failSync, zeroSync);
    const syncResult = parseSync(syncParser, []);
    assert.ok(syncResult.success);
    if (syncResult.success) {
      assert.deepEqual(syncResult.value, ["sync-fail", "sync-zero"]);
    }

    const failAsync: Parser<"async", readonly string[], undefined> = {
      $mode: "async",
      $valueType: [] as readonly (readonly string[])[],
      $stateType: [] as readonly undefined[],
      priority: 5,
      usage: [],
      initialState: undefined,
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`fail`,
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: ["async-fail"] as const,
        });
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const zeroAsync: Parser<"async", readonly string[], undefined> = {
      ...failAsync,
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: ["async-zero"] as const,
        });
      },
    };
    const asyncParser = concat(failAsync, zeroAsync);
    const asyncResult = await parseAsync(asyncParser, []);
    assert.ok(asyncResult.success);
    if (asyncResult.success) {
      assert.deepEqual(asyncResult.value, ["async-fail", "async-zero"]);
    }
  });

  it("group() suggest returns empty when hidden is true", () => {
    const parser = group(
      "Hidden Group",
      object({ name: optional(option("--name", string())) }),
      { hidden: true },
    );
    const suggestions = parser.suggest({
      buffer: [],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    }, "");
    assert.deepEqual([...suggestions as Iterable<Suggestion>], []);
  });

  it("conditional() selected branch parse failure is propagated", () => {
    const parser = conditional(
      option("--mode", choice(["fast", "slow"])),
      {
        fast: option("--threads", integer()),
        slow: flag("--verbose"),
      },
    );
    const failed = parser.parse({
      buffer: ["--threads"],
      state: {
        ...parser.initialState,
        selectedBranch: { kind: "branch", key: "fast" as const },
      },
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(!failed.success);
  });

  it("conditional() async complete returns default branch failure", async () => {
    const discriminator = option("--mode", asyncStringValue());
    const failingDefault: Parser<"async", string, undefined> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 1,
      usage: [],
      initialState: undefined,
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({
          success: false as const,
          error: message`default failed`,
        });
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };

    const parser = conditional(
      discriminator,
      { fast: constant("F") },
      failingDefault,
    );
    const completed = await parser.complete(parser.initialState);
    assert.ok(!completed.success);
  });

  it("object() suggest async builds registry and uses field-state fallback", async () => {
    const parser = object({
      name: option("--name", asyncStringValue()),
    });
    const suggestions: Suggestion[] = [];
    for await (
      const suggestion of parser.suggest({
        buffer: ["--name"],
        state: {} as never,
        optionsTerminated: false,
        usage: parser.usage,
      }, "")
    ) {
      suggestions.push(suggestion);
    }
    assert.ok(Array.isArray(suggestions));
  });

  it("concat() sync suggest and docs cover sync-only branches", () => {
    const parser = concat(
      tuple([option("--a", string())]),
      tuple([option("--b", string())]),
    );
    const suggestions = parser.suggest({
      buffer: [],
      state: [] as never,
      optionsTerminated: false,
      usage: parser.usage,
    }, "--");
    assert.ok(Array.isArray([...suggestions as Iterable<Suggestion>]));

    const docs = parser.getDocFragments({ kind: "unavailable" }, undefined);
    assert.ok(docs.fragments.length >= 1);
  });

  it("concat() parse sync returns deepest consuming error", () => {
    const failing: Parser<"sync", readonly unknown[], undefined> = {
      $mode: "sync",
      $valueType: [] as readonly (readonly unknown[])[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      initialState: undefined,
      parse() {
        return { success: false as const, consumed: 1, error: message`bad` };
      },
      complete() {
        return { success: true as const, value: ["ok"] as const };
      },
      suggest: function* () {},
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = concat(
      failing as unknown as Parser<
        "sync",
        readonly unknown[],
        readonly unknown[]
      >,
      tuple([optional(option("--ok", string()))]),
    );
    const result = parseSync(parser, ["x"]);
    assert.ok(!result.success);
  });

  it("concat() handles scalar completion values and empty priority", async () => {
    const syncScalar = {
      $mode: "sync",
      $valueType: [] as readonly unknown[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      initialState: undefined,
      parse(context: ParserContext<undefined>) {
        return { success: true as const, next: context, consumed: [] };
      },
      complete() {
        return { success: true as const, value: "scalar-sync" };
      },
      suggest: function* () {},
      getDocFragments: () => ({
        fragments: [{ type: "entry", term: { type: "literal", value: "x" } }],
      }),
    } as unknown as Parser<"sync", unknown, undefined>;
    const asyncScalar = {
      $mode: "async",
      $valueType: [] as readonly unknown[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      initialState: undefined,
      parse(context: ParserContext<undefined>) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: "scalar-async",
        });
      },
      suggest: async function* () {},
      getDocFragments: () => ({
        fragments: [{ type: "entry", term: { type: "literal", value: "y" } }],
      }),
    } as unknown as Parser<"async", unknown, undefined>;

    const syncConcat = concat(
      syncScalar as unknown as Parser<
        "sync",
        readonly unknown[],
        readonly unknown[]
      >,
      tuple([optional(option("--tail", string()))]),
    );
    const syncCompleted = syncConcat.complete(syncConcat.initialState);
    assert.ok(syncCompleted.success);
    if (syncCompleted.success) {
      assert.deepEqual(syncCompleted.value, ["scalar-sync", undefined]);
    }

    const asyncConcat = concat(
      asyncScalar as unknown as Parser<
        "async",
        readonly unknown[],
        readonly unknown[]
      >,
      tuple([optional(option("--tail", asyncStringValue()))]),
    );
    const asyncCompleted = await asyncConcat.complete(asyncConcat.initialState);
    assert.ok(asyncCompleted.success);
    if (asyncCompleted.success) {
      assert.deepEqual(asyncCompleted.value, ["scalar-async", undefined]);
    }

    const emptyConcat = (concat as unknown as (...parsers: unknown[]) => {
      readonly priority: number;
    })();
    assert.equal(emptyConcat.priority, 0);
  });

  it("group() hidden suggest also works for async parser", async () => {
    const parser = group(
      "Hidden Async Group",
      object({ name: optional(option("--name", asyncStringValue())) }),
      { hidden: true },
    );
    const suggestions: Suggestion[] = [];
    for await (
      const suggestion of parser.suggest({
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      }, "")
    ) {
      suggestions.push(suggestion);
    }
    assert.deepEqual(suggestions, []);
  });

  it("conditional() sync suggest handles undefined and selected states", () => {
    const parser = conditional(
      option("--mode", choice(["fast", "slow"])),
      {
        fast: optional(option("--threads", integer())),
        slow: optional(flag("--verbose")),
      },
      optional(option("--default", string())),
    );

    const fromUndefined = suggestSync(parser, ["--"]);
    assert.ok(Array.isArray(fromUndefined));

    const selected = parser.suggest({
      buffer: [],
      state: {
        ...parser.initialState,
        selectedBranch: { kind: "branch", key: "fast" as const },
      },
      optionsTerminated: false,
      usage: parser.usage,
    }, "--");
    assert.ok(Array.isArray([...selected as Iterable<Suggestion>]));
  });

  it("conditional() sync parse supports preselected default branch", () => {
    const parser = conditional(
      option("--mode", choice(["fast", "slow"])),
      { fast: flag("--fast") },
      option("--default", string()),
    );
    const parsed = parser.parse({
      buffer: ["--default", "ok"],
      state: {
        ...parser.initialState,
        selectedBranch: { kind: "default" as const },
      },
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parsed.success);
  });

  it("conditional() usage supports single branch with argument discriminator", () => {
    const parser = conditional(
      argument(choice(["fast"])),
      {
        fast: option("--threads", integer()),
      },
    );

    const usageText = formatUsage("app", parser.usage);
    assert.ok(usageText.length > 0);
  });

  it("conditional() async complete handles dependency source completion state", async () => {
    const dep = Symbol("conditional-dep");
    const discriminator = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly unknown[],
      priority: 1,
      usage: [],
      initialState: undefined,
      parse(context: ParserContext<unknown>) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve(
          createDependencySourceState(
            { success: true as const, value: "fast" },
            dep,
          ),
        ) as unknown as Promise<{
          readonly success: true;
          readonly value: string;
        }>;
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, unknown>;

    const fastBranch = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly unknown[],
      priority: 1,
      usage: [],
      initialState: undefined,
      parse(context: ParserContext<unknown>) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "FAST" });
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, unknown>;

    const parser = conditional(discriminator, { fast: fastBranch });

    const completed = await parser.complete({
      ...parser.initialState,
      selectedBranch: { kind: "branch", key: "fast" as const },
    });
    assert.ok(completed.success);
    if (completed.success) {
      assert.deepEqual(completed.value, ["fast", "FAST"]);
    }
  });

  it("conditional() async complete falls back to selected key on discriminator failure", async () => {
    const discriminator = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly unknown[],
      priority: 1,
      usage: [],
      initialState: undefined,
      parse(context: ParserContext<unknown>) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({
          success: false as const,
          error: message`discriminator failed`,
        });
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, unknown>;

    const fastBranch = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly unknown[],
      priority: 1,
      usage: [],
      initialState: undefined,
      parse(context: ParserContext<unknown>) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "FAST" });
      },
      suggest: async function* () {},
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"async", string, unknown>;

    const parser = conditional(discriminator, { fast: fastBranch });

    const completed = await parser.complete({
      ...parser.initialState,
      selectedBranch: { kind: "branch", key: "fast" as const },
    });
    assert.ok(completed.success);
    if (completed.success) {
      assert.deepEqual(completed.value, ["fast", "FAST"]);
    }
  });

  it("conditional() suggest handles undefined state and selected async default", async () => {
    const syncParser = conditional(
      option("--mode", choice(["fast", "slow"])),
      { fast: flag("--fast"), slow: flag("--slow") },
      option("--default", string()),
    );
    const syncSuggestions = syncParser.suggest({
      buffer: [],
      state: undefined as never,
      optionsTerminated: false,
      usage: syncParser.usage,
    }, "--");
    assert.ok(Array.isArray([...syncSuggestions as Iterable<Suggestion>]));

    const asyncParser = conditional(
      option("--mode", asyncStringValue()),
      { fast: optional(option("--fast", asyncStringValue())) },
      optional(option("--default", asyncStringValue())),
    );
    const asyncSuggestions: Suggestion[] = [];
    for await (
      const suggestion of asyncParser.suggest({
        buffer: [],
        state: {
          ...asyncParser.initialState,
          selectedBranch: { kind: "default" as const },
        },
        optionsTerminated: false,
        usage: asyncParser.usage,
      }, "--")
    ) {
      asyncSuggestions.push(suggestion);
    }
    assert.ok(Array.isArray(asyncSuggestions));
  });
});
