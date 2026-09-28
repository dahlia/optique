import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Annotations, injectAnnotations } from "./internal/annotations.ts";
import {
  argument,
  command,
  constant,
  flag,
  longestMatch,
  object,
  option,
  or,
  type ParserContext,
} from "./index.ts";
import { formatMessage, type Message, message } from "./message.ts";
import { string, type ValueParser } from "./valueparser.ts";
import { multiple, optional } from "./modifiers.ts";
import { type Mode, parseAsync, parseSync } from "./parser.ts";
import { findSimilar } from "./suggestion.ts";

const issue184Annotations = {
  [Symbol.for("@test/issue-184/error-suggestions")]: true,
} satisfies Annotations;

/**
 * Integration tests for "Did you mean?" suggestions in error messages.
 * These tests verify that when parsers fail due to invalid option/command names,
 * they provide helpful suggestions for similar valid options/commands.
 */
describe("Parser error suggestions", () => {
  describe("option() parser", () => {
    it("should suggest similar option on typo", () => {
      const parser = option("--verbose", "--version");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--verbos"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /No matched option/);
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--verbose/);
      }
    });

    it("should suggest multiple similar options", () => {
      const parser = option("--verbose", "--version", "--verify");
      const context: ParserContext<typeof parser.initialState> = {
        // Use a typo that's close enough to get multiple suggestions
        buffer: ["--versi"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        // --version should be suggested as it's closest
        assert.match(errorMsg, /--version/);
      }
    });

    it("should not suggest when no similar options exist", () => {
      const parser = option("--verbose", "--quiet");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--xyz"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /No matched option/);
        assert.doesNotMatch(errorMsg, /Did you mean/);
      }
    });

    it("should work with short option typos", () => {
      const parser = option("-v", "--verbose", "-q", "--quiet");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["-w"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        // Short options are unlikely to get suggestions due to distance threshold
        assert.match(errorMsg, /No matched option/);
      }
    });
  });

  describe("flag() parser", () => {
    it("should suggest similar flag on typo", () => {
      const parser = flag("--force", "--follow");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--forc"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /No matched option/);
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--force/);
      }
    });
  });

  describe("command() parser", () => {
    it("should suggest similar command on typo", () => {
      const commitParser = object({});
      const parser = command("commit", commitParser);
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["comit"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        // Command error message says "Expected command X, but got Y"
        assert.match(errorMsg, /Expected command/);
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /commit/);
      }
    });

    it("should suggest from multiple commands", () => {
      const buildParser = object({});
      const buildCmd = command("build", buildParser);
      const bundleParser = object({});
      const bundleCmd = command("bundle", bundleParser);
      const parser = or(buildCmd, bundleCmd);

      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["buil"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /build/);
      }
    });
  });

  describe("object() parser", () => {
    it("should suggest from all available options on typo", () => {
      const parser = object({
        verbose: option("--verbose"),
        output: option("--output", string()),
        force: flag("--force"),
      });
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--verbos"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Unexpected option or argument/);
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--verbose/);
      }
    });

    it("should suggest options when encountering invalid argument", () => {
      const parser = object({
        input: option("--input", string()),
        output: option("--output", string()),
      });
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--inpu"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--input/);
      }
    });
  });

  describe("or() parser", () => {
    it("should suggest from all branches", () => {
      const parserA = object({
        verbose: option("--verbose"),
        quiet: option("--quiet"),
      });
      const parserB = object({
        force: flag("--force"),
        follow: flag("--follow"),
      });
      const parser = or(parserA, parserB);

      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--verbos"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--verbose/);
      }
    });

    it("should keep issue 184 suggestions when annotations are present", () => {
      const parser = or(
        object({
          tag: constant("a" as const),
          silent: option("--silent"),
        }),
        object({
          tag: constant("b" as const),
          verbose: option("--verbose"),
        }),
      );

      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--silen"] as readonly string[],
        state: injectAnnotations(parser.initialState, issue184Annotations),
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--silent/);
      }
    });
  });

  describe("longestMatch() parser", () => {
    it("should suggest from all parsers", () => {
      const parserA = object({
        verbose: option("--verbose"),
        version: option("--version"),
      });
      const parserB = object({
        verify: option("--verify"),
      });
      const parser = longestMatch(parserA, parserB);

      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--verbos"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--verbose/);
      }
    });

    it("should keep issue 184 suggestions when annotations are present", () => {
      const parser = longestMatch(
        object({
          tag: constant("a" as const),
          silent: option("--silent"),
        }),
        object({
          tag: constant("b" as const),
          verbose: option("--verbose"),
        }),
      );

      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--silen"] as readonly string[],
        state: injectAnnotations(parser.initialState, issue184Annotations),
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--silent/);
      }
    });
  });

  describe("hidden options/commands in suggestions", () => {
    it("should not suggest hidden: true options", () => {
      const parser = or(
        option("--secret", string(), { hidden: true }),
        option("--verbose", string()),
      );
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--secert"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.doesNotMatch(errorMsg, /--secret/);
        assert.doesNotMatch(errorMsg, /Did you mean/);
      }
    });

    it("should not suggest hidden: true commands", () => {
      const parser = or(
        command("secret", object({}), { hidden: true }),
        command("public", object({})),
      );
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["secert"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.doesNotMatch(errorMsg, /secret/);
        assert.doesNotMatch(errorMsg, /Did you mean/);
      }
    });

    it("should still suggest hidden: 'help' options", () => {
      const parser = or(
        option("--secret", string(), { hidden: "help" }),
        option("--verbose", string()),
      );
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--secert"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--secret/);
      }
    });

    it("should still suggest hidden: 'usage' commands", () => {
      const parser = or(
        command("secret", object({}), { hidden: "usage" }),
        command("public", object({})),
      );
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["secert"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /secret/);
      }
    });

    it("should still suggest hidden: 'doc' options", () => {
      const parser = or(
        option("--secret", string(), { hidden: "doc" }),
        option("--verbose", string()),
      );
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--secert"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--secret/);
      }
    });

    it("should not suggest hidden: true commands via longestMatch()", () => {
      const parser = longestMatch(
        command("secret", object({}), { hidden: true }),
        command("public", object({})),
      );
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["secert"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.doesNotMatch(errorMsg, /secret/);
        assert.doesNotMatch(errorMsg, /Did you mean/);
      }
    });
  });

  describe("complex scenarios", () => {
    it("should suggest both options and commands", () => {
      const addCmd = command("add", object({}));
      const commitCmd = command("commit", object({}));
      const parser = object({
        verbose: option("--verbose"),
        commands: or(addCmd, commitCmd),
      });

      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["comit"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        // Should suggest "commit" command
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /commit/);
      }
    });

    it("should handle nested commands with suggestions", () => {
      const innerParser = object({
        hard: flag("--hard"),
        soft: flag("--soft"),
      });
      const resetCmd = command("reset", innerParser);

      // First parse "reset" to get into the command
      const initialContext: ParserContext<typeof resetCmd.initialState> = {
        buffer: ["reset"] as readonly string[],
        state: resetCmd.initialState,
        optionsTerminated: false,
        usage: resetCmd.usage,
      };

      const firstResult = resetCmd.parse(initialContext);
      assert.ok(firstResult.success);
      if (!firstResult.success) return;

      // Now try to parse a typo in nested option
      const secondContext: ParserContext<typeof resetCmd.initialState> = {
        buffer: ["--har"] as readonly string[],
        state: firstResult.next.state,
        optionsTerminated: false,
        usage: resetCmd.usage,
      };

      const result = resetCmd.parse(secondContext);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--hard/);
      }
    });

    it("should suggest case-insensitively", () => {
      const parser = option("--verbose", "--version");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--VERBOS"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);
        assert.match(errorMsg, /--verbose/);
      }
    });

    it("should respect distance thresholds", () => {
      const parser = option("--verbose", "--quiet");
      const context: ParserContext<typeof parser.initialState> = {
        // "xyz" is too different from both options
        buffer: ["--xyz"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /No matched option/);
        // Should NOT suggest because distance is too large
        assert.doesNotMatch(errorMsg, /Did you mean/);
      }
    });

    it("should limit suggestion count to 3", () => {
      const parser = option(
        "--verbose",
        "--version",
        "--verify",
        "--vertical",
        "--vertex",
      );
      const context: ParserContext<typeof parser.initialState> = {
        // Use a typo that will match all options
        buffer: ["--verbo"] as readonly string[],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = parser.parse(context);
      assert.ok(!result.success);
      if (!result.success) {
        const errorMsg = formatMessage(result.error, {
          quotes: false,
          colors: false,
        });
        assert.match(errorMsg, /Did you mean/);

        // Count suggestions - should be at most 3
        const lines = errorMsg.split("\n");
        const suggestionLines = lines.filter((line) =>
          line.trim().startsWith("--ver")
        );
        assert.ok(
          suggestionLines.length <= 3,
          `Expected at most 3 suggestions, got ${suggestionLines.length}`,
        );
      }
    });
  });
});

const asyncString: ValueParser<"async", string> = {
  mode: "async",
  metavar: "STRING",
  placeholder: "",
  parse: (input) => Promise.resolve({ success: true, value: input }),
  format: (value) => value,
};

describe("eager suggestion compatibility", () => {
  for (const literal of [message`No match.`, [] satisfies Message]) {
    for (
      const parser of [
        option("--verbose", { errors: { noMatch: literal } }),
        option("--verbose", string(), { errors: { noMatch: literal } }),
        option("--verbose", asyncString, { errors: { noMatch: literal } }),
        flag("--verbose", { errors: { noMatch: literal } }),
      ]
    ) {
      it(`skips candidate traversal for ${parser.mode} literal noMatch (${literal.length} terms)`, async () => {
        let traversals = 0;
        const result = await parser.parse({
          buffer: ["--verbos"],
          state: undefined,
          optionsTerminated: false,
          usage: [{
            type: "option",
            get names() {
              traversals++;
              return ["--verbose"] as const;
            },
          }],
        });
        assert.ok(!result.success);
        if (!result.success) {
          assert.equal(result.consumed, 0);
          assert.strictEqual(result.error, literal);
        }
        assert.equal(traversals, 0);
      });
    }
  }

  interface CallbackCall {
    readonly field: string;
    readonly token: string;
    readonly suggestions: readonly string[];
  }
  function pathParser<M extends Mode>(
    valueParser: ValueParser<M, string>,
    calls: CallbackCall[],
  ) {
    const errors = (field: string) => ({
      noMatch: (token: string, suggestions: readonly string[]) => {
        calls.push({ field, token, suggestions });
        return message`No match.`;
      },
    });
    return object({
      alpha: optional(
        option("--alpha", valueParser, { errors: errors("alpha") }),
      ),
      beta: optional(option("--beta", valueParser, { errors: errors("beta") })),
      verbose: optional(flag("--verbose", { errors: errors("verbose") })),
      paths: multiple(argument(valueParser)),
    });
  }

  for (const mode of ["sync", "async"] as const) {
    it(`preserves callback count, order and suggestions in ${mode} compositions`, async () => {
      const calls: CallbackCall[] = [];
      const args = ["alpha", "src/filename.ts", "alpha"];
      const result = mode === "sync"
        ? parseSync(pathParser(string(), calls), args)
        : await parseAsync(pathParser(asyncString, calls), args);
      assert.ok(result.success);
      if (result.success) assert.deepEqual(result.value.paths, args);
      const names = ["--alpha", "--beta", "--verbose"];
      assert.deepEqual(
        calls,
        args.flatMap((token) =>
          ["alpha", "beta", "verbose"].map((field) => ({
            field,
            token,
            suggestions: findSimilar(token, names),
          }))
        ),
      );
      assert.ok(calls[0].suggestions.length > 0);
      for (let i = 1; i < calls.length; i++) {
        assert.notStrictEqual(calls[i].suggestions, calls[i - 1].suggestions);
      }
    });

    it(`preserves literal errors and typo diagnostics through ${mode} multiple()`, async () => {
      const literal = message`Unknown option.`;
      const custom = mode === "sync"
        ? parseSync(
          multiple(
            option("--verbose", string(), { errors: { noMatch: literal } }),
          ),
          ["--verbos"],
        )
        : await parseAsync(
          multiple(
            option("--verbose", asyncString, { errors: { noMatch: literal } }),
          ),
          ["--verbos"],
        );
      assert.ok(!custom.success);
      if (!custom.success) assert.strictEqual(custom.error, literal);
      const defaultError = mode === "sync"
        ? parseSync(multiple(option("--verbose", string())), ["--verbos"])
        : await parseAsync(multiple(option("--verbose", asyncString)), [
          "--verbos",
        ]);
      assert.ok(!defaultError.success);
      if (!defaultError.success) {
        assert.equal(
          formatMessage(defaultError.error),
          "No matched option for `--verbos`.\n\nDid you mean `--verbose`?",
        );
      }
    });
  }
});
