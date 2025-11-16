import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  command,
  flag,
  longestMatch,
  object,
  option,
  or,
  type ParserContext,
} from "./index.ts";
import { formatMessage } from "./message.ts";
import { string } from "./valueparser.ts";

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
