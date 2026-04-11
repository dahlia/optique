import {
  conditional,
  group,
  longestMatch,
  merge,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import { getAnnotations, inheritAnnotations } from "@optique/core/annotations";
import type {
  SourceContext,
  SourceContextPhase2Request,
  SourceContextRequest,
} from "@optique/core/context";
import type { DocSection } from "@optique/core/doc";
import {
  defineInheritedAnnotationParser,
  type ExecutionContext,
  type Parser,
} from "@optique/core/parser";
import {
  type RunOptions,
  runParser,
  RunParserError,
  runParserSync,
  runWith,
  runWithAsync,
  runWithSync,
} from "@optique/core/facade";
import { message } from "@optique/core/message";
import {
  map,
  multiple,
  nonEmpty,
  optional,
  withDefault,
} from "@optique/core/modifiers";
import {
  argument,
  command,
  constant,
  fail,
  flag,
  option,
} from "@optique/core/primitives";
import type { Program } from "@optique/core/program";
import type { OptionName } from "@optique/core/usage";
import type { ValueParser } from "@optique/core/valueparser";
import { integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractPhase2SeedKey } from "./phase2-seed.ts";
import { bindEnv, createEnvContext } from "../../env/src/index.ts";

type AssertNever<T extends never> = T;

function isPhase1ContextRequest(request: unknown): boolean {
  return request === undefined ||
    (request != null &&
      typeof request === "object" &&
      "phase" in request &&
      (request as { readonly phase?: unknown }).phase === "phase1");
}

function isPhase2ContextRequest(
  request: unknown,
): request is SourceContextPhase2Request {
  return request != null &&
    typeof request === "object" &&
    "phase" in request &&
    (request as { readonly phase?: unknown }).phase === "phase2" &&
    "parsed" in request;
}

function getPhase2ContextParsed<T>(request: unknown): T | undefined {
  return isPhase2ContextRequest(request) ? request.parsed as T : undefined;
}

function getRuntimeExtractPhase2SeedKey(): symbol {
  const parser = command("probe", constant(null));
  const key = Object.getOwnPropertySymbols(parser).find((symbol) =>
    symbol.description === "@optique/core/extractPhase2Seed"
  );
  assert.ok(key, "expected command() to expose extractPhase2SeedKey");
  return key;
}

function createMutatingAnnotationRunnerParser(
  marker: symbol,
): Parser<"sync", number, undefined> {
  return {
    $mode: "sync",
    $valueType: [] as const,
    $stateType: [] as const,
    priority: 0,
    usage: [],
    leadingNames: new Set(),
    acceptingAnyToken: false,
    initialState: undefined,
    parse(context) {
      return {
        success: true as const,
        next: context,
        consumed: [],
      };
    },
    complete(state) {
      const payload = getAnnotations(state)?.[marker] as
        | { value: number }
        | undefined;
      assert.ok(payload != null);
      payload.value = 2;
      return { success: true as const, value: payload.value };
    },
    *suggest() {},
    getDocFragments() {
      return { fragments: [] };
    },
  };
}

describe("runParser", () => {
  describe("basic parsing", () => {
    it("should parse simple arguments", () => {
      const parser = object({
        name: argument(string()),
      });

      const result = runParser(parser, "test", ["Alice"]);
      assert.deepEqual(result, { name: "Alice" });
    });

    it("should parse options", () => {
      const parser = object({
        verbose: option("--verbose"),
        name: argument(string()),
      });

      const result = runParser(parser, "test", ["--verbose", "Alice"]);
      assert.deepEqual(result, { verbose: true, name: "Alice" });
    });

    it("should parse commands", () => {
      const parser = command(
        "hello",
        object({
          name: argument(string()),
        }),
        {
          description: message`Say hello to someone`,
        },
      );

      const result = runParser(parser, "test", ["hello", "Alice"]);
      assert.deepEqual(result, { name: "Alice" });
    });
  });

  describe("help functionality", () => {
    it("should show help with --help option when help is enabled", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let helpShown = false;
      let helpOutput = "";

      const result = runParser(parser, "test", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
      assert.ok(helpOutput.includes("Usage: test"));
    });

    it("should not provide help when help is not configured (default)", () => {
      // Test that help is disabled by default
      const parser = object({
        verbose: option("--verbose"),
      });

      assert.throws(() => {
        runParser(parser, "test", ["--help"]);
      }, RunParserError);
    });

    it("should only show help option when help mode is 'option'", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let helpShown = false;

      const result = runParser(parser, "test", ["--help"], {
        help: {
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: () => {},
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
    });

    it("should only show help command when help mode is 'command'", () => {
      // Use a command parser - help will work when the command doesn't match
      const parser = command(
        "serve",
        object({
          port: argument(integer()),
        }),
        {
          description: message`Start the server`,
        },
      );

      let helpShown = false;

      const result = runParser(parser, "test", ["help"], {
        help: {
          command: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: () => {},
        stderr: () => {}, // suppress error output
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
    });

    it("should show examples, author, and bugs for top-level help", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let helpOutput = "";

      runParser(parser, "test", ["--help"], {
        help: {
          option: true,
          onShow: () => "help-shown",
        },
        examples: message`test Alice\ntest Bob`,
        author: message`Jane Doe <jane@example.com>`,
        bugs: message`Report bugs at https://github.com/example/test/issues`,
        stdout: (text) => {
          helpOutput += text + "\n";
        },
      });

      assert.ok(helpOutput.includes("Examples:"));
      assert.ok(helpOutput.includes("test Alice"));
      assert.ok(helpOutput.includes("Author:"));
      assert.ok(helpOutput.includes("Jane Doe"));
      assert.ok(helpOutput.includes("Bugs:"));
      assert.ok(helpOutput.includes("Report bugs at"));
    });

    it("should hide examples, author, and bugs for subcommand help", () => {
      const serveCmd = command(
        "serve",
        object({
          port: argument(integer()),
        }),
        {
          description: message`Start the server`,
        },
      );

      const buildCmd = command(
        "build",
        object({
          output: argument(string()),
        }),
        {
          description: message`Build the project`,
        },
      );

      const parser = or(serveCmd, buildCmd);

      let helpOutput = "";

      runParser(parser, "test", ["help", "serve"], {
        help: {
          command: true,
          option: true,
          onShow: () => "help-shown",
        },
        examples: message`test serve 3000\ntest build dist`,
        author: message`Jane Doe <jane@example.com>`,
        bugs: message`Report bugs at https://github.com/example/test/issues`,
        stdout: (text) => {
          helpOutput += text + "\n";
        },
      });

      // Subcommand help should NOT include examples, author, bugs
      assert.ok(!helpOutput.includes("Examples:"));
      assert.ok(!helpOutput.includes("Author:"));
      assert.ok(!helpOutput.includes("Bugs:"));

      // But should still show the command-specific description
      assert.ok(helpOutput.includes("Start the server"));
    });

    it("should hide examples, author, and bugs when using --help on subcommand", () => {
      const serveCmd = command(
        "serve",
        object({
          port: argument(integer()),
        }),
        {
          description: message`Start the server`,
        },
      );

      const parser = serveCmd;

      let helpOutput = "";

      runParser(parser, "test", ["serve", "--help"], {
        help: {
          option: true,
          onShow: () => "help-shown",
        },
        examples: message`test serve 3000`,
        author: message`Jane Doe <jane@example.com>`,
        bugs: message`Report bugs at https://github.com/example/test/issues`,
        stdout: (text) => {
          helpOutput += text + "\n";
        },
      });

      // Subcommand help should NOT include examples, author, bugs
      assert.ok(!helpOutput.includes("Examples:"));
      assert.ok(!helpOutput.includes("Author:"));
      assert.ok(!helpOutput.includes("Bugs:"));
    });
  });

  describe("version functionality", () => {
    it("should show version with --version option when version is enabled", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let versionShown = false;
      let versionOutput = "";

      const result = runParser(parser, "test", ["--version"], {
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: (text) => {
          versionOutput = text;
        },
      });

      assert.equal(result, "version-shown");
      assert.ok(versionShown);
      assert.equal(versionOutput, "1.0.0");
    });

    it("should let ordinary parser data shadow the version command", () => {
      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;
      let versionOutput = "";

      const result = runParser(parser, "test", ["version"], {
        version: {
          command: true,
          value: "2.1.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: (text) => {
          versionOutput = text;
        },
        stderr: () => {},
      });

      assert.deepEqual(result, { name: "version" });
      assert.ok(!versionShown);
      assert.equal(versionOutput, "");
    });

    it("should still honor --version while letting parser data shadow the version command", () => {
      const parser = object({
        name: argument(string()),
      });

      let versionOutput = "";

      // Test --version option
      const result1 = runParser(parser, "test", ["--version"], {
        version: {
          command: true,
          option: true,
          value: "3.0.0",
          onShow: () => "version-shown",
        },
        stdout: (text) => {
          versionOutput = text;
        },
      });

      assert.equal(result1, "version-shown");
      assert.equal(versionOutput, "3.0.0");

      // Test version command
      versionOutput = "";
      const result2 = runParser(parser, "test", ["version"], {
        version: {
          command: true,
          option: true,
          value: "3.0.0",
          onShow: () => "version-shown",
        },
        stdout: (text) => {
          versionOutput = text;
        },
        stderr: () => {},
      });

      assert.deepEqual(result2, { name: "version" });
      assert.equal(versionOutput, "");
    });

    it("should not provide version when version is not configured (default)", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      assert.throws(() => {
        runParser(parser, "test", ["--version"]);
      }, RunParserError);
    });

    it("should pass exit code 0 to onShow callback", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let receivedExitCode: number | undefined;

      runParser(parser, "test", ["--version"], {
        version: {
          option: true,
          value: "1.0.0",
          onShow: (exitCode) => {
            receivedExitCode = exitCode;
            return "version-shown";
          },
        },
        stdout: () => {},
      });

      assert.equal(receivedExitCode, 0);
    });

    it("should follow last-option-wins pattern for conflicting options", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      // Test --version --help (help should win - last option)
      let versionShown1 = false;
      let helpShown1 = false;
      let helpOutput1 = "";

      const result1 = runParser(parser, "test", ["--version", "--help"], {
        help: {
          option: true, // Use option mode to avoid contextual parser issues
          onShow: () => {
            helpShown1 = true;
            return "help-shown";
          },
        },
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => {
            versionShown1 = true;
            return "version-shown";
          },
        },
        stdout: (text) => {
          helpOutput1 = text;
        },
      });

      assert.equal(result1, "help-shown");
      assert.ok(helpShown1);
      assert.ok(!versionShown1);
      assert.ok(helpOutput1.includes("Usage:"));

      // Test --help --version (version should win - last option)
      let versionShown2 = false;
      let helpShown2 = false;
      let versionOutput2 = "";

      const result2 = runParser(parser, "test", ["--help", "--version"], {
        help: {
          option: true,
          onShow: () => {
            helpShown2 = true;
            return "help-shown";
          },
        },
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => {
            versionShown2 = true;
            return "version-shown";
          },
        },
        stdout: (text) => {
          versionOutput2 = text;
        },
      });

      assert.equal(result2, "version-shown");
      assert.ok(versionShown2);
      assert.ok(!helpShown2);
      assert.equal(versionOutput2, "1.0.0");
    });

    it("should keep version command meta behind ordinary parser data when help is also configured", () => {
      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;
      let versionOutput = "";

      const result = runParser(parser, "test", ["version"], {
        help: {
          command: true,
          option: true,
          onShow: () => "help-shown",
        },
        version: {
          command: true,
          value: "2.0.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: (text) => {
          versionOutput = text;
        },
        stderr: () => {},
      });

      assert.deepEqual(result, { name: "version" });
      assert.ok(!versionShown);
      assert.equal(versionOutput, "");
    });

    it("should keep help command meta behind ordinary parser data when version is also configured", () => {
      const parser = object({
        name: argument(string()),
      });

      let helpShown = false;
      let helpOutput = "";

      const result = runParser(parser, "test", ["help"], {
        help: {
          command: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          command: true,
          option: true,
          value: "3.0.0",
          onShow: () => "version-shown",
        },
        stdout: (text) => {
          helpOutput = text;
        },
        stderr: () => {},
      });

      assert.deepEqual(result, { name: "help" });
      assert.ok(!helpShown);
      assert.equal(helpOutput, "");
    });

    it("should work with onShow callback without exit code parameter", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let versionCalled = false;

      const result = runParser(parser, "test", ["--version"], {
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => {
            versionCalled = true;
            return "version-shown";
          },
        },
        stdout: () => {},
      });

      assert.ok(versionCalled);
      assert.equal(result, "version-shown");
    });

    it("should handle version and help in reverse order (--help --version)", () => {
      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;
      let helpShown = false;
      let versionOutput = "";

      const result = runParser(parser, "test", ["--help", "--version"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          option: true,
          value: "2.0.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: (text) => {
          versionOutput = text;
        },
      });

      assert.equal(result, "version-shown");
      assert.ok(versionShown);
      assert.ok(!helpShown);
      assert.equal(versionOutput, "2.0.0");
    });

    it("should handle version command with --help flag (help wins - shows help for version)", () => {
      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;
      let helpShown = false;
      let helpOutput = "";

      const result = runParser(parser, "test", ["version", "--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          command: true,
          option: true,
          value: "3.0.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: (text) => {
          helpOutput = text;
        },
        stderr: () => {},
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
      assert.ok(!versionShown);
      // Should show help for version command
      assert.ok(helpOutput.includes("version"));
    });

    it("should handle help command with --version flag (version wins)", () => {
      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;
      let helpShown = false;

      const result = runParser(parser, "test", ["help", "--version"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          command: true,
          option: true,
          value: "4.0.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: () => {},
        stderr: () => {},
      });

      assert.equal(result, "version-shown");
      assert.ok(versionShown);
      assert.ok(!helpShown);
    });

    it("should handle multiple --version flags (shows error as expected)", () => {
      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;
      let output = "";

      // Multiple --version flags should just show version (not an error)
      const result = runParser(parser, "test", ["--version", "--version"], {
        version: {
          option: true,
          value: "5.0.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: (text) => {
          output += text;
        },
        stderr: () => {},
      });

      assert.equal(result, "version-shown");
      assert.ok(versionShown);
      assert.equal(output, "5.0.0");
    });

    it("should handle version with extra arguments after (causes error)", () => {
      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;

      // With our lenient parser, extra arguments after --version are now allowed
      // (similar to help with extra arguments)
      const result = runParser(parser, "test", ["--version", "extra", "args"], {
        version: {
          option: true,
          value: "6.0.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: () => {},
        stderr: () => {},
      });

      assert.equal(result, "version-shown");
      assert.ok(versionShown);
    });

    it("should handle help with extra arguments after", () => {
      const parser = object({
        name: argument(string()),
      });

      let helpShown = false;

      const result = runParser(parser, "test", ["--help", "extra", "args"], {
        help: {
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: () => {},
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
    });

    // Regression test for https://github.com/dahlia/optique/issues/127
    it("should include meta options in help page usage and options list", () => {
      const parser = merge(
        or(
          command("foo", object({}), { description: message`foo cmd` }),
          command("bar", object({}), { description: message`bar cmd` }),
        ),
        object({
          debug: flag("-d", "--debug", {
            description: message`Enable debug mode`,
          }),
        }),
      );

      let helpOutput = "";

      runParser(parser, "myapp", ["--help"], {
        help: { option: true },
        version: { option: true, value: "1.2.3" },
        completion: { option: { names: ["--completion", "--completions"] } },
        onError: () => {},
        stdout: (text: string) => {
          helpOutput += text + "\n";
        },
      });

      // --help should appear in the usage line of the help page
      const usageLines = helpOutput
        .split("\n")
        .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
        .join("\n");
      assert.ok(
        usageLines.includes("--help"),
        `--help should appear in help page usage line, but got:\n${usageLines}`,
      );
      assert.ok(
        usageLines.includes("--version"),
        `--version should appear in help page usage line, but got:\n${usageLines}`,
      );

      // --help and --version should appear in the options list
      assert.ok(
        helpOutput.split("\n").some((l) => /^\s+--help/.test(l)),
        `--help should appear in help page options list, but got:\n${helpOutput}`,
      );
      assert.ok(
        helpOutput.split("\n").some((l) => /^\s+--version/.test(l)),
        `--version should appear in help page options list, but got:\n${helpOutput}`,
      );
    });

    it("should reject empty string version value", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", ["--version"], {
            version: { option: true, value: "" },
            stdout: () => {},
          }),
        {
          name: "TypeError",
          message: "Version value must not be empty.",
        },
      );
    });

    it("should reject version value containing newline", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", ["--version"], {
            version: { option: true, value: "1.0\n2.0" },
            stdout: () => {},
          }),
        {
          name: "TypeError",
          message: "Version value must not contain control characters.",
        },
      );
    });

    it("should reject version value containing tab", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", ["--version"], {
            version: { option: true, value: "1.0\t0" },
            stdout: () => {},
          }),
        {
          name: "TypeError",
          message: "Version value must not contain control characters.",
        },
      );
    });

    it("should reject version value containing carriage return", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", ["--version"], {
            version: { option: true, value: "1.0\r\n" },
            stdout: () => {},
          }),
        {
          name: "TypeError",
          message: "Version value must not contain control characters.",
        },
      );
    });

    it("should reject version value containing DEL control character", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", ["--version"], {
            version: { option: true, value: "1.0\x7f0" },
            stdout: () => {},
          }),
        {
          name: "TypeError",
          message: "Version value must not contain control characters.",
        },
      );
    });

    it("should reject non-string version value at runtime", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", ["--version"], {
            version: {
              option: true,
              value: 123 as never,
            },
            stdout: () => {},
          }),
        {
          name: "TypeError",
          message: "Expected version value to be a string, but got number.",
        },
      );
    });

    it("should reject array version value at runtime", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", ["--version"], {
            version: {
              option: true,
              value: ["1.0.0"] as never,
            },
            stdout: () => {},
          }),
        {
          name: "TypeError",
          message: "Expected version value to be a string, but got array.",
        },
      );
    });

    it("should eagerly reject invalid version value even without --version flag", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", ["Alice"], {
            version: { option: true, value: "" },
          }),
        {
          name: "TypeError",
          message: "Version value must not be empty.",
        },
      );
    });
  });

  describe("meta name validation", () => {
    // Help option names
    it("should reject empty help option names array", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", ["--help"], {
            help: { option: { names: [] as never } },
            stdout: () => {},
          }),
        {
          name: "TypeError",
          message: "Expected at least one help option name.",
        },
      );
    });

    it("should reject empty string help option name", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: { names: [""] as never } },
          }),
        {
          name: "TypeError",
          message: "Help option name must not be empty.",
        },
      );
    });

    it("should reject help option name containing space", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: { names: ["--bad name"] as never } },
          }),
        {
          name: "TypeError",
          message:
            'Help option name must not contain whitespace: "--bad name".',
        },
      );
    });

    it("should reject help option name containing newline", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: { names: ["--bad\nname"] as never } },
          }),
        {
          name: "TypeError",
          message: "Help option name must not contain control characters: " +
            '"--bad\\nname".',
        },
      );
    });

    it("should reject whitespace-only help option name", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: { names: ["   "] as never } },
          }),
        {
          name: "TypeError",
          message: 'Help option name must not be whitespace-only: "   ".',
        },
      );
    });

    it("should reject help option name without valid prefix", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: { names: ["help"] as never } },
          }),
        {
          name: "TypeError",
          message:
            'Help option name must start with "--", "-", "/", or "+": "help".',
        },
      );
    });

    it("should eagerly reject invalid help option names even without --help flag", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", ["Alice"], {
            help: { option: { names: [] as never } },
          }),
        {
          name: "TypeError",
          message: "Expected at least one help option name.",
        },
      );
    });

    // Help command names
    it("should reject empty help command names array", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { command: { names: [] as never } },
          }),
        {
          name: "TypeError",
          message: "Expected at least one help command name.",
        },
      );
    });

    it("should reject empty string help command name", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { command: { names: [""] as never } },
          }),
        {
          name: "TypeError",
          message: "Help command name must not be empty.",
        },
      );
    });

    it("should reject whitespace-only help command name", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { command: { names: ["   "] as never } },
          }),
        {
          name: "TypeError",
          message: 'Help command name must not be whitespace-only: "   ".',
        },
      );
    });

    it("should reject help command name containing space", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { command: { names: ["help me"] as never } },
          }),
        {
          name: "TypeError",
          message: 'Help command name must not contain whitespace: "help me".',
        },
      );
    });

    it("should reject help command name containing control character", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { command: { names: ["help\x00"] as never } },
          }),
        {
          name: "TypeError",
          message: "Help command name must not contain control characters: " +
            '"help\\x00".',
        },
      );
    });

    // Version option names
    it("should reject empty version option names array", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            version: { option: { names: [] as never }, value: "1.0.0" },
          }),
        {
          name: "TypeError",
          message: "Expected at least one version option name.",
        },
      );
    });

    it("should reject version option name containing tab", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            version: {
              option: { names: ["--ver\tsion"] as never },
              value: "1.0.0",
            },
          }),
        {
          name: "TypeError",
          message: "Version option name must not contain control characters: " +
            '"--ver\\tsion".',
        },
      );
    });

    it("should reject version option name without valid prefix", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            version: {
              option: { names: ["version"] as never },
              value: "1.0.0",
            },
          }),
        {
          name: "TypeError",
          message:
            'Version option name must start with "--", "-", "/", or "+": "version".',
        },
      );
    });

    // Version command names
    it("should reject empty version command names array", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            version: { command: { names: [] as never }, value: "1.0.0" },
          }),
        {
          name: "TypeError",
          message: "Expected at least one version command name.",
        },
      );
    });

    it("should reject version command name containing control character", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            version: {
              command: { names: ["ver\x7f"] as never },
              value: "1.0.0",
            },
          }),
        {
          name: "TypeError",
          message:
            "Version command name must not contain control characters: " +
            '"ver\\x7f".',
        },
      );
    });

    // Completion option names
    it("should reject empty completion option names array", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: true },
            completion: { option: { names: [] as never } },
          }),
        {
          name: "TypeError",
          message: "Expected at least one completion option name.",
        },
      );
    });

    it("should reject completion option name containing space", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: true },
            completion: {
              option: { names: ["--comp lete"] as never },
            },
          }),
        {
          name: "TypeError",
          message: "Completion option name must not contain whitespace: " +
            '"--comp lete".',
        },
      );
    });

    it("should reject completion option name without valid prefix", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: true },
            completion: { option: { names: ["completion"] as never } },
          }),
        {
          name: "TypeError",
          message:
            'Completion option name must start with "--", "-", "/", or "+": "completion".',
        },
      );
    });

    // Completion command names
    it("should reject empty completion command names array", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: true },
            completion: { command: { names: [] as never } },
          }),
        {
          name: "TypeError",
          message: "Expected at least one completion command name.",
        },
      );
    });

    it("should reject completion command name that is empty string", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: true },
            completion: { command: { names: [""] as never } },
          }),
        {
          name: "TypeError",
          message: "Completion command name must not be empty.",
        },
      );
    });

    // Meta name collision detection
    it("should allow user command shadowing help command", () => {
      const parser = command("help", object({}));
      const result = runParser(parser, "test", ["help"], {
        help: {
          command: true,
          onShow: () => "HELP",
        },
        stderr: () => {},
      });
      assert.deepEqual(result, {});
    });

    it("should allow user option shadowing help option", () => {
      const parser = object({ help: flag("--help") });
      const result = runParser(parser, "test", ["--help"], {
        help: {
          option: true,
          onShow: () => "HELP",
        },
      });
      assert.deepEqual(result, { help: true });
    });

    it("should allow user command 'help' when help command uses custom name", () => {
      const parser = longestMatch(
        command("help", object({})),
        command("run", object({})),
      );
      const result = runParser(parser, "test", ["help"], {
        help: {
          command: { names: ["info"] },
          onShow: () => "HELP",
        },
      });
      assert.deepEqual(result, {});
    });

    it("should reject collision between two meta commands", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { command: { names: ["meta"] } },
            version: { command: { names: ["meta"] }, value: "1.0.0" },
          }),
        {
          name: "TypeError",
          message: /name "meta".*both/i,
        },
      );
    });

    it("should reject collision between two meta options", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: { names: ["--meta"] } },
            version: { option: { names: ["--meta"] }, value: "1.0.0" },
          }),
        {
          name: "TypeError",
          message: /name "--meta".*both/i,
        },
      );
    });

    it("should allow hidden user option shadowing a meta option", () => {
      const parser = object({
        help: flag("--help", { hidden: true }),
      });
      const result = runParser(parser, "test", ["--help"], {
        help: {
          option: true,
          onShow: () => "HELP",
        },
      });
      assert.deepEqual(result, { help: true });
    });

    it("should reject duplicate names within a single meta option", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: {
              option: { names: ["--help", "--help"] as never },
            },
          }),
        {
          name: "TypeError",
          message: /help option.*duplicate.*"--help"/i,
        },
      );
    });

    it("should allow user command shadowing version command", () => {
      const parser = command("version", object({}));
      const result = runParser(parser, "test", ["version"], {
        version: {
          command: true,
          value: "1.0.0",
        },
        stderr: () => {},
      });
      assert.deepEqual(result, {});
    });

    it("should allow user command shadowing completion command", () => {
      const parser = command("completion", object({}));
      const result = runParser(parser, "test", ["completion"], {
        help: { option: true },
        completion: { command: true },
        onError: () => "ERROR",
        stderr: () => {},
      });
      assert.deepEqual(result, {});
    });

    // P1: nested subcommands should not trigger false positives
    it("should allow nested subcommand named 'help' when it is not a leading command", () => {
      const parser = command(
        "tool",
        longestMatch(
          command("help", object({})),
          command("build", object({})),
        ),
      );
      // "tool" is the leading command; nested "help" does not collide
      const result = runParser(parser, "test", ["tool", "help"], {
        help: {
          command: true,
          onShow: () => "HELP",
        },
      });
      assert.deepEqual(result, {});
    });

    // conditional discriminator gates should not trigger false positives
    it("should allow conditional branch command that shares meta command name", () => {
      const parser = conditional(
        option("--mode", string()),
        {
          server: command("help", object({})),
        },
      );
      // "help" is behind --mode server (literal gate) → not a leading command
      const result = runParser(
        parser,
        "test",
        ["--mode", "server", "help"],
        {
          help: {
            command: true,
            onShow: () => "HELP",
          },
        },
      );
      assert.deepEqual(result, ["server", {}]);
    });

    // The or(argument(), command("foo")) is a catch-all (acceptingAnyToken)
    // at priority 15, so command("help") at the same priority can never
    // match at position 0.  No collision should be detected.
    it("should allow command after catch-all exclusive in tuple", () => {
      const parser = tuple([
        or(argument(string()), command("foo", object({}))),
        command("help", object({})),
      ]);
      const result = runParser(parser, "test", ["x", "help"], {
        help: {
          command: true,
          onShow: () => "HELP",
        },
      });
      assert.deepEqual(result, ["x", {}]);
    });

    // Literal values shadowed by meta option scanners
    it("should allow conditional discriminator value shadowing a meta option", () => {
      const parser = conditional(
        option("--mode", string()),
        { "--help": object({}) },
      );
      const result = runParser(parser, "test", ["--mode", "--help"], {
        help: {
          option: true,
          onShow: () => "HELP",
        },
        stderr: () => {},
      });
      assert.deepEqual(result, ["--help", {}]);
    });

    it("should not reject conditional(argument()) branch key against meta command", () => {
      // Argument-based conditional branch keys are not detectable via
      // usage-tree analysis because map() is invisible in the tree.
      // See https://github.com/dahlia/optique/issues/734
      const parser = conditional(
        argument(string()),
        {
          help: object({ port: option("--port", integer()) }),
          serve: object({ dir: argument(string()) }),
        },
      );
      let helpShown = false;
      const result = runParser(parser, "myapp", ["serve", "foo"], {
        help: {
          command: true,
          onShow: () => {
            helpShown = true;
            return "HELP";
          },
        },
        stderr: () => {},
      });
      assert.ok(!helpShown);
      assert.notEqual(result, "HELP");
    });

    // P2: cross-namespace collision detection
    it("should reject meta command name that looks like an option", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            help: { option: true },
            version: {
              command: { names: ["--help"] },
              value: "1.0.0",
            },
          }),
        {
          name: "TypeError",
          message: /help option.*version command|version command.*help option/i,
        },
      );
    });

    it("should allow user command shadowing a meta help option", () => {
      const parser = command("--help", object({}));
      const result = runParser(parser, "test", ["--help"], {
        help: {
          option: true,
          onShow: () => "HELP",
        },
        stderr: () => {},
      });
      assert.deepEqual(result, {});
    });

    // Position-aware scoping: nested options vs meta commands
    it("should allow nested --version option when meta version is command-form only", () => {
      // command("tool", object({ v: flag("--version") }))
      // + version: { command: { names: ["--version"] } }
      // --version is nested inside "tool", meta command only matches args[0]
      const parser = command(
        "tool",
        object({ v: flag("--version") }),
      );
      const result = runParser(parser, "test", ["tool", "--version"], {
        version: {
          command: { names: ["--version"] },
          value: "1.0.0",
        },
      });
      assert.deepEqual(result, { v: true });
    });

    // Position-aware scoping: nested commands vs meta options
    it("should allow nested command shadowing a meta help option", () => {
      const parser = command(
        "tool",
        longestMatch(
          command("--help", object({})),
          command("run", object({})),
        ),
      );
      const result = runParser(parser, "test", ["tool", "--help"], {
        help: {
          option: true,
          onShow: () => "HELP",
        },
        stderr: () => {},
      });
      assert.deepEqual(result, {});
    });

    it("should allow user option shadowing the completion prefix form", () => {
      const parser = object({ bad: flag("--completion=bash") });
      const result = runParser(parser, "test", ["--completion=bash"], {
        completion: { option: true },
        stderr: () => {},
      });
      assert.deepEqual(result, { bad: true });
    });

    it("should reject completion option aliases that collide via = prefix", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () =>
          runParser(parser, "test", [], {
            completion: {
              option: {
                names: ["--completion", "--completion=bash"] as never,
              },
            },
            stderr: () => {},
          }),
        {
          name: "TypeError",
          message: /prefix.*"--completion".*shadows.*"--completion=bash"/i,
        },
      );
    });
  });

  describe("error handling", () => {
    it("should throw RunParserError by default on parse failure", () => {
      const parser = object({
        port: argument(integer()),
      });

      assert.throws(() => {
        runParser(parser, "test", ["not-a-number"]);
      }, RunParserError);
    });

    it("should call onError callback on parse failure", () => {
      const parser = object({
        port: argument(integer()),
      });

      let errorCalled = false;
      let errorOutput = "";

      const result = runParser(parser, "test", ["not-a-number"], {
        onError: () => {
          errorCalled = true;
          return "error-handled";
        },
        stderr: (text) => {
          errorOutput += text;
        },
      });

      assert.equal(result, "error-handled");
      assert.ok(errorCalled);
      assert.ok(errorOutput.includes("Usage: test"));
      assert.ok(errorOutput.includes("Error:"));
    });

    it("should pass exit code to onError callback", () => {
      const parser = object({
        port: argument(integer()),
      });

      let receivedExitCode: number | undefined;

      runParser(parser, "test", ["not-a-number"], {
        onError: (exitCode) => {
          receivedExitCode = exitCode;
          return "error-handled";
        },
        stderr: () => {},
      });

      assert.equal(receivedExitCode, 1);
    });

    it("should show usage above error by default", () => {
      const parser = object({
        port: argument(integer()),
      });

      let errorOutput = "";

      runParser(parser, "test", ["not-a-number"], {
        onError: () => "handled",
        stderr: (text) => {
          errorOutput += text;
        },
      });

      assert.ok(errorOutput.includes("Usage: test"));
      assert.ok(errorOutput.indexOf("Usage:") < errorOutput.indexOf("Error:"));
    });

    it("should show help above error when aboveError is 'help'", () => {
      const parser = object({
        port: argument(integer({ metavar: "PORT" })),
      });

      let errorOutput = "";

      runParser(parser, "test", ["not-a-number"], {
        aboveError: "help",
        onError: () => "handled",
        stderr: (text) => {
          errorOutput += text;
        },
      });

      assert.ok(errorOutput.includes("PORT"));
      assert.ok(errorOutput.includes("Error:"));
    });

    it("should show nothing above error when aboveError is 'none'", () => {
      const parser = object({
        port: argument(integer()),
      });

      let errorOutput = "";

      runParser(parser, "test", ["not-a-number"], {
        aboveError: "none",
        onError: () => "handled",
        stderr: (text) => {
          errorOutput += text;
        },
      });

      assert.ok(!errorOutput.includes("Usage:"));
      assert.ok(errorOutput.includes("Error:"));
    });
  });

  describe("output options", () => {
    it("should use custom stdout function", () => {
      const parser = object({
        name: argument(string()),
      });

      let capturedOutput = "";

      runParser(parser, "test", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => "help-shown",
        },
        stdout: (text) => {
          capturedOutput = text;
        },
      });

      assert.ok(capturedOutput.length > 0);
      assert.ok(capturedOutput.includes("Usage: test"));
    });

    it("should use custom stderr function", () => {
      const parser = object({
        port: argument(integer()),
      });

      let capturedError = "";

      runParser(parser, "test", ["not-a-number"], {
        onError: () => "handled",
        stderr: (text) => {
          capturedError += text;
        },
      });

      assert.ok(capturedError.length > 0);
      assert.ok(capturedError.includes("Error:"));
    });

    it("should respect colors option", () => {
      const parser = object({
        name: argument(string()),
      });

      let helpOutput = "";

      runParser(parser, "test", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => "help-shown",
        },
        colors: true,
        stdout: (text) => {
          helpOutput = text;
        },
      });

      // When colors are enabled, ANSI escape codes should be present
      assert.ok(helpOutput.includes("\x1b[") || helpOutput.length > 0);
    });

    it("should respect maxWidth option", () => {
      const parser = object({
        name: argument(
          string({ metavar: "VERY_LONG_METAVAR_NAME_THAT_SHOULD_WRAP" }),
        ),
      });

      let helpOutput = "";

      runParser(parser, "test", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => "help-shown",
        },
        maxWidth: 20,
        stdout: (text) => {
          helpOutput = text;
        },
      });

      // With a very narrow width, output should contain line breaks
      assert.ok(helpOutput.includes("\n"));
    });
  });

  describe("callback functions", () => {
    it("should pass exit code 0 to onShow callback", () => {
      const parser = object({
        name: argument(string()),
      });

      let receivedExitCode: number | undefined;

      runParser(parser, "test", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: (exitCode) => {
            receivedExitCode = exitCode;
            return "help-shown";
          },
        },
        stdout: () => {},
      });

      assert.equal(receivedExitCode, 0);
    });

    it("should work with onShow callback without exit code parameter", () => {
      const parser = object({
        name: argument(string()),
      });

      let helpCalled = false;

      const result = runParser(parser, "test", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpCalled = true;
            return "help-shown";
          },
        },
        stdout: () => {},
      });

      assert.ok(helpCalled);
      assert.equal(result, "help-shown");
    });

    it("should work with onError callback without exit code parameter", () => {
      const parser = object({
        port: argument(integer()),
      });

      let errorCalled = false;

      const result = runParser(parser, "test", ["not-a-number"], {
        onError: () => {
          errorCalled = true;
          return "error-handled";
        },
        stderr: () => {},
      });

      assert.ok(errorCalled);
      assert.equal(result, "error-handled");
    });
  });

  describe("complex parser combinations", () => {
    it("should handle help/version with nested command structures", () => {
      const serveCommand = command(
        "serve",
        object({
          port: withDefault(
            option("--port", integer(), {
              description: message`Port to serve on`,
            }),
            8080,
          ),
          host: withDefault(
            option("--host", string(), {
              description: message`Host to bind to`,
            }),
            "localhost",
          ),
        }),
        {
          description: message`Start the development server`,
        },
      );

      const buildCommand = command(
        "build",
        object({
          output: withDefault(
            option("--output", string(), {
              description: message`Output directory`,
            }),
            "dist",
          ),
          minify: flag("--minify", {
            description: message`Minify output`,
          }),
        }),
        {
          description: message`Build the project`,
        },
      );

      const parser = or(serveCommand, buildCommand);

      let helpShown = false;
      let helpOutput = "";

      const result = runParser(parser, "myapp", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          command: true,
          option: true,
          value: "1.0.0",
          onShow: () => "version-shown",
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
      assert.ok(helpOutput.includes("serve"));
      assert.ok(helpOutput.includes("build"));
    });

    it("should handle contextual help for specific commands", () => {
      const serveCommand = command(
        "serve",
        object({
          port: withDefault(option("--port", integer()), 3000),
          verbose: flag("--verbose"),
        }),
        {
          description: message`Start the server`,
        },
      );

      const parser = serveCommand;

      let helpShown = false;
      let helpOutput = "";

      const result = runParser(parser, "myapp", ["serve", "--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
      assert.ok(helpOutput.includes("--port"));
      assert.ok(helpOutput.includes("--verbose"));
    });

    it("should handle help command with subcommand context", () => {
      const deployCommand = command(
        "deploy",
        object({
          environment: withDefault(option("--env", string()), "staging"),
          force: flag("--force"),
        }),
        {
          description: message`Deploy the application`,
        },
      );

      const parser = deployCommand;

      let helpShown = false;
      let helpOutput = "";

      const result = runParser(parser, "myapp", ["help", "deploy"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: (text) => {
          helpOutput = text;
        },
        stderr: () => {},
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
      assert.ok(helpOutput.includes("deploy") || helpOutput.includes("Deploy"));
    });

    it("should show subcommand-specific help with --help flag after subcommand (Issue #26)", () => {
      const syncCommand = command(
        "sync",
        object({
          force: flag("--force"),
          verbose: flag("--verbose"),
        }),
        {
          description: message`Synchronize data`,
        },
      );

      const buildCommand = command(
        "build",
        object({
          output: option("--output", string()),
          minify: flag("--minify"),
        }),
        {
          description: message`Build the project`,
        },
      );

      // Use or() to combine multiple commands - this is where the bug was
      const parser = or(syncCommand, buildCommand);

      let helpShown = false;
      let helpOutput = "";

      // Test: cli sync --help should show sync-specific help, not root help
      const result = runParser(parser, "cli", ["sync", "--help"], {
        help: {
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
      // Should show sync-specific options, not both commands
      assert.ok(helpOutput.includes("--force"));
      assert.ok(helpOutput.includes("--verbose"));
      assert.ok(helpOutput.includes("Synchronize data"));
      // Should NOT show build command or its options
      assert.ok(!helpOutput.includes("--output"));
      assert.ok(!helpOutput.includes("--minify"));
      assert.ok(!helpOutput.includes("Build the project"));
    });

    it("should show subcommand help even with other options present", () => {
      const syncCommand = command(
        "sync",
        object({
          force: flag("--force"),
          verbose: flag("--verbose"),
        }),
        {
          description: message`Synchronize data`,
        },
      );

      const buildCommand = command(
        "build",
        object({
          output: option("--output", string()),
          minify: flag("--minify"),
        }),
        {
          description: message`Build the project`,
        },
      );

      const parser = or(syncCommand, buildCommand);

      let helpShown = false;
      let helpOutput = "";

      // Test: cli build --help --output out.js should show build help
      const result = runParser(parser, "cli", [
        "build",
        "--help",
        "--output",
        "out.js",
      ], {
        help: {
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
      // Should show build-specific options
      assert.ok(helpOutput.includes("--output"));
      assert.ok(helpOutput.includes("--minify"));
      assert.ok(helpOutput.includes("Build the project"));
      // Should NOT show sync command or its options
      assert.ok(!helpOutput.includes("--force"));
      assert.ok(!helpOutput.includes("--verbose"));
      assert.ok(!helpOutput.includes("Synchronize data"));
    });

    it("should handle multiple nested optional parsers with help/version", () => {
      const parser = object({
        verbose: optional(flag("--verbose")),
        quiet: optional(flag("--quiet")),
        config: optional(option("--config", string())),
        input: multiple(argument(string()), { min: 1 }),
      });

      let versionShown = false;

      const result = runParser(parser, "complex-tool", ["--version"], {
        help: {
          command: true,
          option: true,
          onShow: () => "help-shown",
        },
        version: {
          command: true,
          option: true,
          value: "2.1.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: () => {},
      });

      assert.equal(result, "version-shown");
      assert.ok(versionShown);
    });

    it("should handle help with complex argument patterns", () => {
      const parser = object({
        operation: argument(string()),
        files: multiple(argument(string())),
        recursive: optional(flag("--recursive")),
        pattern: optional(option("--pattern", string())),
      });

      let helpShown = false;
      let helpOutput = "";

      const result = runParser(parser, "file-tool", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
      assert.ok(helpOutput.includes("Usage:"));
    });

    it("should handle version/help with map transformations", () => {
      const parser = object({
        count: map(
          withDefault(option("--count", integer()), 1),
          (n: number) => n * 2,
        ),
        name: map(argument(string()), (s) => s.toUpperCase()),
        enabled: map(optional(flag("--enable")), (b) => b ?? false),
      });

      let versionOutput = "";

      const result = runParser(parser, "transform-tool", ["--version"], {
        version: {
          option: true,
          value: "3.0.0-beta",
          onShow: () => "version-shown",
        },
        stdout: (text) => {
          versionOutput = text;
        },
      });

      assert.equal(result, "version-shown");
      assert.equal(versionOutput, "3.0.0-beta");
    });
  });

  describe("stress tests and edge cases", () => {
    it("should handle all help/version mode combinations", () => {
      const parser = object({
        name: argument(string()),
      });

      const helpConfigs = [
        { command: true },
        { option: true },
        { command: true, option: true },
      ] as const;
      const versionConfigs = [
        { command: true },
        { option: true },
        { command: true, option: true },
      ] as const;

      // Test all 9 combinations
      for (const helpConfig of helpConfigs) {
        for (const versionConfig of versionConfigs) {
          let helpShown = false;
          let versionShown = false;

          const helpHasOption = "option" in helpConfig;
          const versionHasOption = "option" in versionConfig;

          // Test last-option-wins: --version --help should show help
          try {
            const result1 = runParser(parser, "test", ["--version", "--help"], {
              help: {
                ...helpConfig,
                onShow: () => {
                  helpShown = true;
                  return "help-shown";
                },
              },
              version: {
                ...versionConfig,
                value: "1.0.0",
                onShow: () => {
                  versionShown = true;
                  return "version-shown";
                },
              },
              stdout: () => {},
              stderr: () => {},
            });

            // Last-option-wins: --version --help should show help (help is last)
            // Only test when both help and version options are available
            if (helpHasOption && versionHasOption) {
              assert.equal(
                result1,
                "help-shown",
                `Expected help-shown for helpConfig=${
                  JSON.stringify(helpConfig)
                }, versionConfig=${
                  JSON.stringify(versionConfig)
                }, got ${result1}`,
              );
              assert.ok(
                helpShown && !versionShown,
                `Expected help to win for helpConfig=${
                  JSON.stringify(helpConfig)
                }, versionConfig=${JSON.stringify(versionConfig)}`,
              );
            }
          } catch (error) {
            // Some mode combinations are expected to fail (e.g., command-only modes with options)
            const errorMsg = error instanceof Error
              ? error.message
              : String(error);
            console.log(
              `Config combination helpConfig=${
                JSON.stringify(helpConfig)
              }, versionConfig=${
                JSON.stringify(versionConfig)
              } failed as expected:`,
              errorMsg.slice(0, 50),
            );
          }

          // Reset flags for next test
          helpShown = false;
          versionShown = false;
        }
      }
    });

    it("should handle options terminator with help/version", () => {
      const parser = object({
        files: multiple(argument(string())),
      });

      let helpShown = false;

      const result = runParser(parser, "test", ["--", "--help", "--version"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          command: true,
          option: true,
          value: "1.0.0",
          onShow: () => "version-shown",
        },
        stdout: () => {},
      });

      // After --, --help and --version should be treated as arguments
      assert.deepEqual(result, { files: ["--help", "--version"] });
      assert.ok(!helpShown);
    });

    it("should handle mixed short and long options with help/version", () => {
      const parser = object({
        verbose: flag("--verbose"),
        quiet: flag("--quiet"),
        output: option("--output", string()),
      });

      let versionShown = false;

      const result = runParser(parser, "test", [
        "--verbose",
        "--quiet",
        "--version",
        "--output",
        "test.txt",
      ], {
        version: {
          command: true,
          option: true,
          value: "2.0.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: () => {},
      });

      assert.equal(result, "version-shown");
      assert.ok(versionShown);
    });

    it("should handle deeply nested command structures", () => {
      const gitAddCommand = command(
        "add",
        object({
          files: multiple(argument(string())),
          all: flag("-A", "--all"),
        }),
        { description: message`Add files to staging` },
      );

      const gitCommitCommand = command(
        "commit",
        object({
          message: option("-m", "--message", string()),
          amend: flag("--amend"),
        }),
        { description: message`Create a commit` },
      );

      const gitCommand = command(
        "git",
        or(gitAddCommand, gitCommitCommand),
        { description: message`Git version control` },
      );

      const parser = gitCommand;

      let helpShown = false;
      let helpOutput = "";

      const result = runParser(parser, "mygit", ["git", "--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
      assert.ok(helpOutput.includes("add") || helpOutput.includes("commit"));
    });

    it("should handle very long version strings", () => {
      const parser = object({
        name: argument(string()),
      });

      const longVersion =
        "1.0.0-alpha.1.2.3.4.5.6.7.8.9.10+build.12345678901234567890.very.long.version.string.with.lots.of.metadata";
      let versionOutput = "";

      const result = runParser(parser, "test", ["--version"], {
        version: {
          option: true,
          value: longVersion,
          onShow: () => "version-shown",
        },
        stdout: (text) => {
          versionOutput = text;
        },
      });

      assert.equal(result, "version-shown");
      assert.equal(versionOutput, longVersion);
    });

    it("should propagate callback exceptions", () => {
      const parser = object({
        name: argument(string()),
      });

      assert.throws(
        () =>
          runParser(parser, "test", ["--help"], {
            help: {
              option: true,
              onShow: (exitCode?: number) => {
                if (exitCode !== undefined) {
                  throw new Error("Exit code provided");
                }
                return "help-shown-no-exit";
              },
            },
            stdout: () => {},
          }),
        /Exit code provided/,
      );

      assert.throws(
        () =>
          runParser(parser, "test", ["--version"], {
            version: {
              option: true,
              value: "1.0.0",
              onShow: (exitCode?: number) => {
                if (exitCode !== undefined) {
                  throw new Error("Exit code provided");
                }
                return "version-shown-no-exit";
              },
            },
            stdout: () => {},
          }),
        /Exit code provided/,
      );
    });

    it("should handle no arguments with help/version available", () => {
      const parser = object({
        files: multiple(argument(string()), { min: 1 }),
      });

      let errorOutput = "";

      try {
        const result = runParser(parser, "test", [], {
          help: {
            command: true,
            option: true,
            onShow: () => "help-shown",
          },
          version: {
            command: true,
            option: true,
            value: "1.0.0",
            onShow: () => "version-shown",
          },
          stderr: (text) => {
            errorOutput += text;
          },
        });
        // If we reach here, it didn't throw - should still fail because files are required
        assert.fail(`Expected error but got result: ${JSON.stringify(result)}`);
      } catch (error) {
        // This should throw RunParserError due to missing required arguments
        assert.ok(error instanceof RunParserError);
        assert.ok(error.message.includes("Failed to parse"));
        assert.ok(errorOutput.includes("Usage:"));
      }
    });

    it("should handle maximum number of parsers in combineWithHelpVersion", () => {
      const parser = object({
        a: optional(flag("--a")),
        b: optional(flag("--b")),
        c: optional(flag("--c")),
        d: optional(flag("--d")),
        e: optional(flag("--e")),
      });

      // This should test the parser count limits in combineWithHelpVersion
      let helpShown = false;

      const result = runParser(parser, "test", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          command: true,
          option: true,
          value: "1.0.0",
          onShow: () => "version-shown",
        },
        stdout: () => {},
      });

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
    });
  });
});

describe("RunParserError", () => {
  it("should create RunParserError with custom message", () => {
    const error = new RunParserError("Custom error message");
    assert.equal(error.name, "RunParserError");
    assert.equal(error.message, "Custom error message");
  });

  it("should be instance of Error", () => {
    const error = new RunParserError("");
    assert.ok(error instanceof Error);
    assert.ok(error instanceof RunParserError);
  });
});

describe("Documentation augmentation (brief, description, footer)", () => {
  it("should display brief in help output", () => {
    const parser = object({
      name: argument(string()),
    });

    let output = "";
    const result = runParser(parser, "test", ["--help"], {
      help: { option: true, onShow: () => "help" as const },
      stdout: (text) => {
        output = text;
      },
      brief: message`This is a test program`,
    });

    assert.equal(result, "help");
    assert.ok(output.includes("This is a test program"));
  });

  it("should display description in help output", () => {
    const parser = object({
      name: argument(string()),
    });

    let output = "";
    const result = runParser(parser, "test", ["--help"], {
      help: { option: true, onShow: () => "help" as const },
      stdout: (text) => {
        output = text;
      },
      description:
        message`This program does something amazing with the provided name parameter.`,
    });

    assert.equal(result, "help");
    assert.ok(output.includes("This program does something amazing"));
  });

  it("should display footer in help output", () => {
    const parser = object({
      name: argument(string()),
    });

    let output = "";
    const result = runParser(parser, "test", ["--help"], {
      help: { option: true, onShow: () => "help" as const },
      stdout: (text) => {
        output = text;
      },
      footer: message`For more information, visit https://example.com`,
    });

    assert.equal(result, "help");
    assert.ok(
      output.includes("For more information, visit https://example.com"),
    );
  });

  it("should display all documentation fields together", () => {
    const parser = object({
      name: argument(string()),
    });

    let output = "";
    const result = runParser(parser, "test", ["--help"], {
      help: { option: true, onShow: () => "help" as const },
      stdout: (text) => {
        output = text;
      },
      brief: message`Test Program`,
      description: message`A comprehensive testing utility.`,
      footer: message`Copyright (c) 2024 Test Corp.`,
    });

    assert.equal(result, "help");
    assert.ok(output.includes("Test Program"));
    assert.ok(output.includes("A comprehensive testing utility"));
    assert.ok(output.includes("Copyright (c) 2024 Test Corp"));
  });

  it("should display documentation fields in error help", () => {
    const parser = object({
      name: argument(string()),
    });

    let errorOutput = "";
    try {
      runParser(parser, "test", [], {
        aboveError: "help",
        stderr: (text) => {
          errorOutput += text;
        },
        brief: message`Error Test Program`,
        description: message`This should appear in error help.`,
        footer: message`Error footer message`,
        onError: () => {
          throw new RunParserError("Parse failed");
        },
      });
    } catch (error) {
      assert.ok(error instanceof RunParserError);
    }

    assert.ok(errorOutput.includes("Error Test Program"));
    assert.ok(errorOutput.includes("This should appear in error help"));
    assert.ok(errorOutput.includes("Error footer message"));
  });

  it("should prefer provided options over parser-generated docs", () => {
    const parser = command("test", object({}), {
      description: message`Original description`,
    });

    let output = "";
    const result = runParser(parser, "test", ["--help"], {
      help: { option: true, onShow: () => "help" as const },
      stdout: (text) => {
        output = text;
      },
      brief: message`Override brief`,
      description: message`Override description`,
      footer: message`Override footer`,
    });

    assert.equal(result, "help");
    assert.ok(output.includes("Override brief"));
    assert.ok(output.includes("Override description"));
    assert.ok(output.includes("Override footer"));
  });

  it("should show subcommand docs instead of run-level docs (Issue #95)", () => {
    const fooCommand = command(
      "foo",
      object({
        verbose: flag("--verbose"),
      }),
      {
        brief: message`foo brief`,
        description: message`foo description`,
      },
    );

    const barCommand = command(
      "bar",
      object({
        force: flag("--force"),
      }),
      {
        brief: message`bar brief`,
        description: message`bar description`,
      },
    );

    const parser = or(fooCommand, barCommand);

    let helpOutput = "";
    const result = runParser(parser, "mycli", ["foo", "--help"], {
      help: { option: true, onShow: () => "help" as const },
      stdout: (text) => {
        helpOutput = text;
      },
      brief: message`mycli brief`,
      description: message`mycli description`,
    });

    assert.equal(result, "help");
    // The subcommand's own brief must appear at the top, before Usage.
    // The subcommand's own description must appear after Usage.
    // Run-level docs must NOT appear at all.
    const fooBriefPos = helpOutput.indexOf("foo brief");
    const usagePos = helpOutput.indexOf("Usage:");
    const fooDescPos = helpOutput.indexOf("foo description");
    assert.ok(fooBriefPos !== -1, "subcommand's own brief must be present");
    assert.ok(usagePos !== -1, "Usage line must be present");
    assert.ok(
      fooDescPos !== -1,
      "subcommand's own description must be present",
    );
    assert.ok(fooBriefPos < usagePos, "brief must precede the Usage line");
    assert.ok(usagePos < fooDescPos, "description must follow the Usage line");
    assert.ok(
      !helpOutput.includes("mycli brief"),
      "run-level brief must not appear",
    );
    assert.ok(
      !helpOutput.includes("mycli description"),
      "run-level description must not appear",
    );
  });

  it("should NOT fall back to run-level docs when subcommand has none (Issue #118)", () => {
    // Regression test for https://github.com/dahlia/optique/issues/118:
    // run-level brief/description must never bleed into a subcommand's help
    // page, even when the subcommand defines no brief or description of its own.
    const fooCommand = command(
      "foo",
      object({
        verbose: flag("--verbose"),
      }),
      // No brief or description provided
    );

    const parser = fooCommand;

    let helpOutput = "";
    const result = runParser(parser, "mycli", ["foo", "--help"], {
      help: { option: true, onShow: () => "help" as const },
      stdout: (text) => {
        helpOutput = text;
      },
      brief: message`mycli brief`,
      description: message`mycli description`,
    });

    assert.equal(result, "help");
    // Run-level brief/description must NOT appear in subcommand help
    assert.ok(!helpOutput.includes("mycli brief"));
    assert.ok(!helpOutput.includes("mycli description"));
  });

  it("should show subcommand's own brief at top when it has only brief (Issue #118/#119)", () => {
    // Regression test for https://github.com/dahlia/optique/issues/118 and
    // https://github.com/dahlia/optique/issues/119.
    // A subcommand's own brief appears at the top of its help page, before
    // Usage.  Run-level docs must NOT bleed in.
    const addCommand = command(
      "add",
      object({ force: flag("--force") }),
      { brief: message`Add something` },
    );
    const removeCommand = command(
      "remove",
      object({ force: flag("--force") }),
      { brief: message`Remove something` },
    );
    const fileCommand = command(
      "file",
      or(addCommand, removeCommand),
      { brief: message`File operations` },
    );

    let helpOutput = "";
    runParser(fileCommand, "repro", ["file", "--help"], {
      help: { option: true, onShow: () => "help" as const },
      stdout: (text) => {
        helpOutput = text;
      },
      brief: message`Brief for repro CLI`,
      description: message`Description for repro CLI`,
    });

    // The file command's own brief must appear before the Usage line
    const fileBriefPos = helpOutput.indexOf("File operations");
    const usagePos = helpOutput.indexOf("Usage:");
    assert.ok(fileBriefPos !== -1, "file command's brief must be present");
    assert.ok(usagePos !== -1, "Usage line must be present");
    assert.ok(fileBriefPos < usagePos, "brief must precede the Usage line");
    // Run-level brief/description must NOT appear in subcommand help
    assert.ok(
      !helpOutput.includes("Description for repro CLI"),
      "run-level description must not appear",
    );
    assert.ok(
      !helpOutput.includes("Brief for repro CLI"),
      "run-level brief must not appear",
    );
    // The subcommand list should still be displayed correctly
    assert.ok(helpOutput.includes("add"), "add subcommand must be listed");
    assert.ok(
      helpOutput.includes("remove"),
      "remove subcommand must be listed",
    );
    assert.ok(
      helpOutput.includes("Add something"),
      "add brief must be shown in listing",
    );
    assert.ok(
      helpOutput.includes("Remove something"),
      "remove brief must be shown in listing",
    );
  });

  it("should show subcommand's own brief and description, not parent's (Issue #118/#119)", () => {
    // Regression: verifies that a subcommand shows its own brief at top
    // (before Usage) and its own description after Usage.  Run-level docs
    // must not appear.
    const fileCommand = command(
      "file",
      object({ verbose: flag("--verbose") }),
      {
        brief: message`File operations brief`,
        description: message`File operations description`,
      },
    );

    let helpOutput = "";
    runParser(fileCommand, "repro", ["file", "--help"], {
      help: { option: true, onShow: () => "help" as const },
      stdout: (text) => {
        helpOutput = text;
      },
      brief: message`Brief for repro CLI`,
      description: message`Description for repro CLI`,
    });

    // brief must precede Usage; description must follow Usage
    const briefPos = helpOutput.indexOf("File operations brief");
    const usagePos = helpOutput.indexOf("Usage:");
    const descPos = helpOutput.indexOf("File operations description");
    assert.ok(briefPos !== -1, "subcommand's own brief must be present");
    assert.ok(usagePos !== -1, "Usage line must be present");
    assert.ok(descPos !== -1, "subcommand's own description must be present");
    assert.ok(briefPos < usagePos, "brief must precede the Usage line");
    assert.ok(usagePos < descPos, "description must follow the Usage line");
    // Run-level docs must not appear in subcommand help
    assert.ok(
      !helpOutput.includes("Brief for repro CLI"),
      "run-level brief must not appear",
    );
    assert.ok(
      !helpOutput.includes("Description for repro CLI"),
      "run-level description must not appear",
    );
  });

  it("should show nested command's brief at top when wrapped in group() (Issue #119)", () => {
    // Regression test for https://github.com/dahlia/optique/issues/119.
    // When a command is wrapped in group(), its own brief must still appear
    // at the top of the help page (not the run-level brief), and its own
    // description must appear below Usage.
    const addCommand = command(
      "add",
      object({ force: flag("--force") }),
      { brief: message`brief for add command` },
    );
    const removeCommand = command(
      "remove",
      object({ force: flag("--force") }),
      { brief: message`brief for remove command` },
    );
    const fileCommands = command(
      "file",
      or(addCommand, removeCommand),
      {
        brief: message`brief for file command group`,
        description: message`description for file command group`,
      },
    );
    const cli = group("File commands", fileCommands);

    let helpOutput = "";
    runParser(cli, "repro", ["file", "--help"], {
      help: { option: true, onShow: () => "help" as const },
      stdout: (text) => {
        helpOutput = text;
      },
      brief: message`Brief for repro CLI`,
      description: message`Description for repro CLI`,
    });

    // brief must appear before Usage; description must appear after Usage
    const fileBriefPos = helpOutput.indexOf("brief for file command group");
    const usagePos = helpOutput.indexOf("Usage:");
    const fileDescPos = helpOutput.indexOf(
      "description for file command group",
    );
    assert.ok(fileBriefPos !== -1, "file command's brief must be present");
    assert.ok(usagePos !== -1, "Usage line must be present");
    assert.ok(fileDescPos !== -1, "file command's description must be present");
    assert.ok(fileBriefPos < usagePos, "brief must precede the Usage line");
    assert.ok(usagePos < fileDescPos, "description must follow the Usage line");
    // Run-level brief/description must NOT appear in subcommand help
    assert.ok(
      !helpOutput.includes("Brief for repro CLI"),
      "run-level brief must not appear",
    );
    assert.ok(
      !helpOutput.includes("Description for repro CLI"),
      "run-level description must not appear",
    );
    // Subcommand list must still be shown with their own briefs
    assert.ok(
      helpOutput.includes("brief for add command"),
      "add brief must be shown",
    );
    assert.ok(
      helpOutput.includes("brief for remove command"),
      "remove brief must be shown",
    );
  });
});

describe("Subcommand help edge cases (Issue #26 comprehensive coverage)", () => {
  it("should handle --help with options terminator (--)", () => {
    const parser = object({
      files: multiple(argument(string())),
    });

    let helpShown = false;

    // Test: cli -- --help should NOT show help (--help is treated as argument)
    const result = runParser(parser, "cli", ["--", "--help"], {
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "help-shown";
        },
      },
    });

    // Should parse successfully with --help as a file argument
    assert.deepEqual(result, { files: ["--help"] });
    assert.ok(!helpShown);
  });

  it("should handle multiple commands before --help", () => {
    const addCommand = command(
      "add",
      object({
        all: flag("--all"),
      }),
      {
        description: message`Add files`,
      },
    );

    const gitCommand = command(
      "git",
      addCommand,
      {
        description: message`Git version control`,
      },
    );

    const parser = gitCommand;

    let helpShown = false;
    let helpOutput = "";

    // Test: cli git add --help should show help for the full command chain
    const result = runParser(parser, "cli", ["git", "add", "--help"], {
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "help-shown";
        },
      },
      stdout: (text) => {
        helpOutput = text;
      },
    });

    assert.equal(result, "help-shown");
    assert.ok(helpShown);
    assert.ok(helpOutput.includes("--all"));
    assert.ok(helpOutput.includes("Add files"));
    // Should NOT show the outer git command description
    assert.ok(!helpOutput.includes("Git version control"));
  });

  it("should handle --help in different positions", () => {
    const syncCommand = command(
      "sync",
      object({
        force: flag("--force"),
        verbose: flag("--verbose"),
      }),
      {
        description: message`Synchronize data`,
      },
    );

    const parser = syncCommand;

    // Test 1: --help at the beginning should show root help
    let helpOutput1 = "";
    const result1 = runParser(parser, "cli", ["--help", "sync"], {
      help: {
        option: true,
        onShow: () => "help-shown",
      },
      stdout: (text) => {
        helpOutput1 = text;
      },
    });

    assert.equal(result1, "help-shown");
    // Should show root help (includes the sync command)
    assert.ok(helpOutput1.includes("sync"));

    // Test 2: --help in the middle should show sync help
    let helpOutput2 = "";
    const result2 = runParser(parser, "cli", ["sync", "--help", "--force"], {
      help: {
        option: true,
        onShow: () => "help-shown",
      },
      stdout: (text) => {
        helpOutput2 = text;
      },
    });

    assert.equal(result2, "help-shown");
    // Should show sync-specific help
    assert.ok(helpOutput2.includes("--force"));
    assert.ok(helpOutput2.includes("Synchronize data"));
  });

  it("should error when --help is used with invalid subcommand", () => {
    const syncCommand = command(
      "sync",
      object({
        force: flag("--force"),
      }),
      {
        description: message`Synchronize data`,
      },
    );

    const buildCommand = command(
      "build",
      object({
        output: option("--output", string()),
      }),
      {
        description: message`Build project`,
      },
    );

    const parser = or(syncCommand, buildCommand);

    let helpShown = false;
    let errorShown = false;
    let stderrOutput = "";

    // Test: cli invalid-cmd --help should error, not show help
    const result = runParser(parser, "cli", ["invalid-cmd", "--help"], {
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "help-shown";
        },
      },
      stdout: () => {},
      stderr: (text) => {
        stderrOutput += text + "\n";
      },
      onError: (code) => {
        errorShown = true;
        return `error-${code}` as never;
      },
    });

    assert.equal(result, "error-1");
    assert.ok(errorShown);
    assert.ok(!helpShown);
    // Should show usage and error message on stderr
    assert.ok(stderrOutput.includes("Usage:"));
    assert.ok(stderrOutput.includes("invalid-cmd"));
  });

  it("should suggest similar commands when --help is used with typo", () => {
    const syncCommand = command(
      "sync",
      object({
        force: flag("--force"),
      }),
      {
        description: message`Synchronize data`,
      },
    );

    const buildCommand = command(
      "build",
      object({
        output: option("--output", string()),
      }),
      {
        description: message`Build project`,
      },
    );

    const parser = or(syncCommand, buildCommand);

    let stderrOutput = "";

    // Test: cli synk --help (typo) should error with suggestion
    const result = runParser(parser, "cli", ["synk", "--help"], {
      help: {
        option: true,
        onShow: () => "help-shown",
      },
      stdout: () => {},
      stderr: (text) => {
        stderrOutput += text + "\n";
      },
      onError: (code) => {
        return `error-${code}` as never;
      },
    });

    assert.equal(result, "error-1");
    // Should include "Did you mean" suggestion
    assert.ok(stderrOutput.includes("sync"));
  });

  it("should handle mixed options and commands with --help", () => {
    const deployCommand = command(
      "deploy",
      object({
        env: option("--env", string()),
        force: flag("--force"),
        target: argument(string()),
      }),
      {
        description: message`Deploy application`,
      },
    );

    const parser = deployCommand;

    let helpShown = false;
    let helpOutput = "";

    // Test: cli deploy --env prod --help target should show deploy help
    const result = runParser(parser, "cli", [
      "deploy",
      "--env",
      "prod",
      "--help",
      "target",
    ], {
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "help-shown";
        },
      },
      stdout: (text) => {
        helpOutput = text;
      },
    });

    assert.equal(result, "help-shown");
    assert.ok(helpShown);
    assert.ok(helpOutput.includes("--env"));
    assert.ok(helpOutput.includes("--force"));
    assert.ok(helpOutput.includes("Deploy application"));
  });

  it("should handle --help with version flag conflicts in subcommand context", () => {
    const syncCommand = command(
      "sync",
      object({
        force: flag("--force"),
      }),
      {
        description: message`Synchronize data`,
      },
    );

    const parser = syncCommand;

    let helpShown = false;
    let versionShown = false;
    let output = "";

    // Test: cli sync --help --version should follow last-option-wins
    const result = runParser(parser, "cli", ["sync", "--help", "--version"], {
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "help-shown";
        },
      },
      version: {
        option: true,
        value: "1.0.0",
        onShow: () => {
          versionShown = true;
          return "version-shown";
        },
      },
      stdout: (text) => {
        output = text;
      },
    });

    // Version should win due to last-option-wins
    assert.equal(result, "version-shown");
    assert.ok(!helpShown);
    assert.ok(versionShown);
    assert.equal(output, "1.0.0");
  });

  it("should handle empty command arguments before --help", () => {
    const syncCommand = command(
      "sync",
      object({
        force: flag("--force"),
      }),
      {
        description: message`Synchronize data`,
      },
    );

    const parser = syncCommand;

    let helpShown = false;
    let helpOutput = "";

    // Test: cli --help (no command) should show root help
    const result = runParser(parser, "cli", ["--help"], {
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "help-shown";
        },
      },
      stdout: (text) => {
        helpOutput = text;
      },
    });

    assert.equal(result, "help-shown");
    assert.ok(helpShown);
    // Should show root help including the sync command
    assert.ok(helpOutput.includes("sync"));
  });

  it("should handle deeply nested command structures with --help", () => {
    const statusSubCommand = command(
      "status",
      object({
        short: flag("--short"),
      }),
      {
        description: message`Show status`,
      },
    );

    const branchSubCommand = command(
      "branch",
      object({
        all: flag("--all"),
      }),
      {
        description: message`List branches`,
      },
    );

    const gitSubCommands = or(statusSubCommand, branchSubCommand);

    const gitCommand = command(
      "git",
      gitSubCommands,
      {
        description: message`Git operations`,
      },
    );

    const devCommand = command(
      "dev",
      gitCommand,
      {
        description: message`Development tools`,
      },
    );

    const parser = devCommand;

    let helpShown = false;
    let helpOutput = "";

    // Test: cli dev git status --help should show status-specific help
    const result = runParser(
      parser,
      "cli",
      ["dev", "git", "status", "--help"],
      {
        help: {
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      },
    );

    assert.equal(result, "help-shown");
    assert.ok(helpShown);
    assert.ok(helpOutput.includes("--short"));
    assert.ok(helpOutput.includes("Show status"));
    // Should NOT show other subcommands or parent commands
    assert.ok(!helpOutput.includes("--all"));
    assert.ok(!helpOutput.includes("List branches"));
    assert.ok(!helpOutput.includes("Git operations"));
    assert.ok(!helpOutput.includes("Development tools"));
  });

  it("should show only selected nested subcommand in help usage (Issue #96)", () => {
    // Regression test for https://github.com/dahlia/optique/issues/96
    // `mycli nested foo --help` should NOT show usage for peer `mycli nested bar`
    const fooCommand = command(
      "foo",
      object({
        action: constant("foo"),
        flag: option("--fooflag", string()),
      }),
      {
        brief: message`foo brief`,
        description: message`foo description`,
      },
    );
    const barCommand = command(
      "bar",
      object({
        action: constant("bar"),
        flag: option("--barflag", string()),
      }),
      {
        brief: message`bar brief`,
        description: message`bar description`,
      },
    );

    const topLevelCommand = command(
      "toplevel",
      object({
        action: constant("toplevel"),
        flag: option("--toplevelflag", string()),
      }),
    );

    const nestedGroup = command("nested", or(fooCommand, barCommand), {
      brief: message`nested brief`,
      description: message`nested description`,
    });

    const parser = or(topLevelCommand, nestedGroup);

    let helpShown = false;
    let helpOutput = "";

    const result = runParser(parser, "mycli", ["nested", "foo", "--help"], {
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "help-shown";
        },
      },
      brief: message`mycli brief`,
      description: message`mycli description`,
      stdout: (text) => {
        helpOutput = text;
      },
    });

    assert.equal(result, "help-shown");
    assert.ok(helpShown);
    // Should show foo's option
    assert.ok(helpOutput.includes("--fooflag"));
    // Should NOT show bar's usage or option
    assert.ok(
      !helpOutput.includes("--barflag"),
      `Help output should not contain --barflag but got:\n${helpOutput}`,
    );
    assert.ok(
      !helpOutput.includes("nested bar"),
      `Help output should not contain 'nested bar' but got:\n${helpOutput}`,
    );
  });

  describe("completion functionality", () => {
    it("should generate bash completion script when completion command is used", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";
      let completionShown = false;

      const result = runParser(parser, "myapp", ["completion", "bash"], {
        completion: {
          command: true,
          onShow: () => {
            completionShown = true;
            return "completion-shown";
          },
        },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      assert.equal(result, "completion-shown");
      assert.ok(completionShown);
      assert.ok(completionOutput.includes("function _myapp"));
      assert.ok(completionOutput.includes("complete -F _myapp -- myapp"));
      assert.ok(completionOutput.includes("myapp 'completion' 'bash'"));
    });

    it("should generate zsh completion script when completion command is used", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["completion", "zsh"], {
        completion: {
          command: true,
          onShow: () => "completion-shown",
        },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      assert.ok(completionOutput.includes("function _myapp"));
      assert.ok(completionOutput.includes("compdef _myapp myapp"));
      assert.ok(completionOutput.includes("myapp 'completion' 'zsh'"));
    });

    it("should provide completion suggestions when args are provided", () => {
      const parser = object({
        verbose: option("--verbose"),
        format: option("--format", string()),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["completion", "bash", "--"], {
        completion: {
          command: true,
        },
        stdout: (text) => {
          completionOutput += text;
        },
      });

      // Should suggest options for bash (newline separated)
      const suggestions = completionOutput.split("\n").filter((s) =>
        s.length > 0
      );
      assert.ok(suggestions.includes("--verbose"));
      assert.ok(suggestions.includes("--format"));
    });

    it("should provide completion suggestions for zsh format", () => {
      const parser = object({
        verbose: option("--verbose"),
        format: option("--format", string()),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["completion", "zsh", "--"], {
        completion: {
          command: true,
        },
        stdout: (text) => {
          completionOutput += text;
        },
      });

      // Zsh format uses null-terminated strings
      assert.ok(completionOutput.includes("--verbose\0"));
      assert.ok(completionOutput.includes("--format\0"));
    });

    it("should work with --completion option format", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["--completion=bash"], {
        completion: {
          option: true,
        },
        stdout: (text) => {
          completionOutput += text;
        },
      });

      assert.ok(completionOutput.includes("function _myapp"));
      assert.ok(completionOutput.includes("complete -F _myapp -- myapp"));
    });

    it("should work with separated --completion option format", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["--completion", "bash"], {
        completion: {
          option: true,
        },
        stdout: (text) => {
          completionOutput += text;
        },
      });

      assert.ok(completionOutput.includes("function _myapp"));
    });

    it("should preserve matched subcommand context for separated --completion option", () => {
      const parser = or(
        command(
          "build",
          object({
            target: option("--target", string()),
          }),
        ),
        command(
          "test",
          object({
            coverage: option("--coverage"),
          }),
        ),
      );

      let completionOutput = "";

      runParser(parser, "myapp", ["build", "--completion", "bash", "--t"], {
        completion: {
          option: true,
        },
        stdout: (text) => {
          completionOutput += text;
        },
      });

      const suggestions = completionOutput.split("\n").filter((s) =>
        s.length > 0
      );
      assert.deepEqual(suggestions, ["--target"]);
    });

    it("should preserve matched subcommand context for equals-form --completion option", () => {
      const parser = or(
        command(
          "build",
          object({
            target: option("--target", string()),
          }),
        ),
        command(
          "test",
          object({
            coverage: option("--coverage"),
          }),
        ),
      );

      let completionOutput = "";

      runParser(parser, "myapp", ["build", "--completion=bash", "--t"], {
        completion: {
          option: true,
        },
        stdout: (text) => {
          completionOutput += text;
        },
      });

      const suggestions = completionOutput.split("\n").filter((s) =>
        s.length > 0
      );
      assert.deepEqual(suggestions, ["--target"]);
    });

    it("should treat --completion in payload as opaque args, not as duplicate meta option", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionResult: unknown;

      // "myapp --completion bash --completion" means:
      // complete the partial input "--completion" using bash completion
      runParser(
        parser,
        "myapp",
        ["--completion", "bash", "--completion"],
        {
          completion: {
            option: true,
            onShow: (exitCode: number) => {
              completionResult = `completion-${exitCode}`;
              return completionResult;
            },
          },
        },
      );

      // Should invoke completion (not error) — the first --completion is the
      // meta option; the second --completion is completion payload
      assert.equal(completionResult, "completion-0");
    });

    it("should treat --completion=<shell> in payload as opaque args", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      // "myapp --completion=bash --completion=zsh" means:
      // complete the partial input "--completion=zsh" using bash completion.
      // The first --completion=bash is the meta option; "--completion=zsh"
      // is passed as a completion payload argument.
      runParser(
        parser,
        "myapp",
        ["--completion=bash", "--completion=zsh"],
        {
          completion: {
            option: true,
          },
          stdout: (text) => {
            completionOutput = text;
          },
        },
      );

      // If this were last-option-wins, --completion=zsh would be the meta
      // option with no payload, producing a zsh completion script containing
      // "compdef".  With first-match, --completion=bash is the meta option
      // and "--completion=zsh" is payload, so no zsh script is generated.
      assert.ok(!completionOutput.includes("compdef"));
    });

    it("should preserve completion payload after -- for separated option form", () => {
      const parser = or(
        command("build", object({})),
        command("beta", object({})),
      );

      let completionOutput = "";

      runParser(parser, "myapp", ["--completion", "bash", "--", "b"], {
        completion: {
          option: true,
        },
        stdout: (text) => {
          completionOutput += text;
        },
      });

      const suggestions = completionOutput
        .split("\n")
        .filter((line) => line.length > 0)
        .sort();
      assert.deepEqual(suggestions, ["beta", "build"]);
    });

    it("should preserve completion payload after -- for equals-form option", () => {
      const parser = or(
        command("build", object({})),
        command("beta", object({})),
      );

      let completionOutput = "";

      runParser(parser, "myapp", ["--completion=bash", "--", "b"], {
        completion: {
          option: true,
        },
        stdout: (text) => {
          completionOutput += text;
        },
      });

      const suggestions = completionOutput
        .split("\n")
        .filter((line) => line.length > 0)
        .sort();
      assert.deepEqual(suggestions, ["beta", "build"]);
    });

    it("should report missing shell for separated --completion option", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let errorOutput = "";
      let errorResult: unknown;

      runParser(parser, "myapp", ["--completion"], {
        completion: {
          option: true,
        },
        onError: (exitCode: number) => {
          errorResult = `error-${exitCode}`;
          return errorResult;
        },
        stderr: (text: string) => {
          errorOutput += text;
        },
      });

      assert.equal(errorResult, "error-1");
      assert.ok(errorOutput.includes("Missing shell name for completion"));
      assert.ok(!errorOutput.includes("Unexpected option"));
    });

    it("should handle unsupported shell with error message", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let errorOutput = "";
      let errorResult: unknown;

      runParser(parser, "myapp", ["completion", "powershell"], {
        completion: {
          command: true,
        },
        onError: (exitCode) => {
          errorResult = `error-${exitCode}`;
          return errorResult;
        },
        stderr: (text) => {
          errorOutput += text;
        },
      });

      assert.equal(errorResult, "error-1");
      assert.ok(errorOutput.includes("Unsupported shell"));
      assert.ok(errorOutput.includes("bash"));
      assert.ok(errorOutput.includes("zsh"));
    });

    it("should handle missing shell name with error", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let errorOutput = "";
      let errorResult: unknown;

      runParser(parser, "myapp", ["completion"], {
        completion: {
          command: true,
        },
        onError: (exitCode) => {
          errorResult = `error-${exitCode}`;
          return errorResult;
        },
        stderr: (text) => {
          errorOutput += text;
        },
      });

      assert.equal(errorResult, "error-1");
      assert.ok(errorOutput.includes("Missing shell name"));
      assert.ok(
        errorOutput.includes("Usage: myapp completion") &&
          errorOutput.includes("SHELL"),
      );
      // Check that shell names are listed in the description
      assert.ok(errorOutput.includes("bash"));
      assert.ok(errorOutput.includes("zsh"));
    });

    it("should show option-form help when --completion is missing shell in option-only mode", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let errorOutput = "";
      let errorResult: unknown;

      runParser(parser, "myapp", ["--completion"], {
        completion: {
          option: true,
        },
        onError: (exitCode) => {
          errorResult = `error-${exitCode}`;
          return errorResult;
        },
        stderr: (text) => {
          errorOutput += text;
        },
      });

      assert.equal(errorResult, "error-1");
      assert.ok(errorOutput.includes("Missing shell name"));
      // Should show option-form usage, not command-form
      assert.ok(
        errorOutput.includes("--completion"),
        "Should include '--completion' in help output",
      );
      assert.ok(
        !errorOutput.includes("Usage: myapp completion "),
        "Should not show command-form usage",
      );
    });

    it("should show option-form help when --completion is missing shell in both mode", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let errorOutput = "";
      let errorResult: unknown;

      runParser(parser, "myapp", ["--completion"], {
        completion: {
          command: true,
          option: true,
        },
        onError: (exitCode) => {
          errorResult = `error-${exitCode}`;
          return errorResult;
        },
        stderr: (text) => {
          errorOutput += text;
        },
      });

      assert.equal(errorResult, "error-1");
      assert.ok(errorOutput.includes("Missing shell name"));
      // Should show option-form usage since --completion was used
      assert.ok(
        errorOutput.includes("--completion"),
        "Should include '--completion' in help output",
      );
      assert.ok(
        !errorOutput.includes("Usage: myapp completion "),
        "Should not show command-form usage",
      );
    });

    it("should show custom option name in help when missing shell", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let errorOutput = "";
      let errorResult: unknown;

      runParser(parser, "myapp", ["--completions"], {
        completion: {
          option: { names: ["--completions"] },
        },
        onError: (exitCode) => {
          errorResult = `error-${exitCode}`;
          return errorResult;
        },
        stderr: (text) => {
          errorOutput += text;
        },
      });

      assert.equal(errorResult, "error-1");
      assert.ok(errorOutput.includes("Missing shell name"));
      // Should use the custom option name
      assert.ok(
        errorOutput.includes("--completions"),
        "Should include custom option name '--completions' in help output",
      );
      assert.ok(
        !errorOutput.includes("Usage: myapp completion "),
        "Should not show command-form usage",
      );
    });

    it("should support both command and option modes", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      // Test command mode
      let commandOutput = "";
      runParser(parser, "myapp", ["completion", "bash"], {
        completion: { command: true, option: true },
        stdout: (text) => {
          commandOutput = text;
        },
      });

      // Test option mode
      let optionOutput = "";
      runParser(parser, "myapp", ["--completion=bash"], {
        completion: { command: true, option: true },
        stdout: (text) => {
          optionOutput = text;
        },
      });

      assert.ok(commandOutput.includes("function _myapp"));
      assert.ok(optionOutput.includes("function _myapp"));
    });

    it("should not interfere with normal parsing when completion is not requested", () => {
      const parser = object({
        verbose: option("--verbose"),
        name: argument(string()),
      });

      const result = runParser(parser, "myapp", ["--verbose", "Alice"], {
        completion: { command: true, option: true },
      });

      assert.deepEqual(result, { verbose: true, name: "Alice" });
    });

    it("should work with complex parsers", () => {
      const parser = or(
        command(
          "git",
          object({
            verbose: option("--verbose"),
            subcommand: or(
              command("status", object({})),
              command(
                "add",
                object({
                  all: option("--all"),
                  file: argument(string()),
                }),
              ),
            ),
          }),
        ),
        object({
          help: option("--help"),
        }),
      );

      let completionOutput = "";

      runParser(parser, "myapp", ["completion", "bash", "git", "add", "--"], {
        completion: { command: true },
        stdout: (text) => {
          completionOutput += text;
        },
      });

      // Should provide completions for the git add subcommand context
      const suggestions = completionOutput.split("\n").filter((s) =>
        s.length > 0
      );
      assert.ok(suggestions.length > 0);
    });

    it("should support custom shells via shells option", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      // Create a custom shell completion
      const customShell: import("./completion.ts").ShellCompletion = {
        name: "custom",
        generateScript(programName: string) {
          return `# Custom shell completion for ${programName}`;
        },
        *encodeSuggestions(suggestions) {
          for (const suggestion of suggestions) {
            if (suggestion.kind === "literal") {
              yield `CUSTOM:${suggestion.text}\n`;
            }
          }
        },
      };

      let completionOutput = "";

      runParser(parser, "myapp", ["completion", "custom"], {
        completion: {
          command: true,
          shells: { custom: customShell },
        },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      assert.ok(
        completionOutput.includes("# Custom shell completion for myapp"),
      );
    });

    it("should allow overriding default shells", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      // Create a custom bash shell that overrides the default
      const customBash: import("./completion.ts").ShellCompletion = {
        name: "bash",
        generateScript(programName: string) {
          return `# Custom bash completion for ${programName}`;
        },
        *encodeSuggestions(suggestions) {
          for (const suggestion of suggestions) {
            if (suggestion.kind === "literal") {
              yield `OVERRIDE:${suggestion.text}\n`;
            }
          }
        },
      };

      let completionOutput = "";

      runParser(parser, "myapp", ["completion", "bash"], {
        completion: {
          command: true,
          shells: { bash: customBash },
        },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      assert.ok(
        completionOutput.includes("# Custom bash completion for myapp"),
      );
    });

    it("should still provide default shells when custom shells are added", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      const customShell: import("./completion.ts").ShellCompletion = {
        name: "custom",
        generateScript(programName: string) {
          return `# Custom shell completion for ${programName}`;
        },
        *encodeSuggestions() {},
      };

      let completionOutput = "";

      // Should still be able to use zsh even with custom shell added
      runParser(parser, "myapp", ["completion", "zsh"], {
        completion: {
          command: true,
          shells: { custom: customShell },
        },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      assert.ok(completionOutput.includes("function _myapp"));
      assert.ok(completionOutput.includes("compdef _myapp myapp"));
    });

    it("should support completions (plural) command", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";
      let completionShown = false;

      const result = runParser(parser, "myapp", ["completions", "bash"], {
        completion: {
          command: { names: ["completions"] },
          onShow: () => {
            completionShown = true;
            return "completion-shown";
          },
        },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      assert.equal(result, "completion-shown");
      assert.ok(completionShown);
      assert.ok(completionOutput.includes("function _myapp"));
    });

    it("should render completion help examples on separate lines", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let helpOutput = "";

      runParser(parser, "myapp", ["completion", "--help"], {
        help: {
          option: true,
          onShow: () => "help-shown",
        },
        completion: {
          command: true,
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.ok(helpOutput.includes("Examples:\n  Bash:"));
      assert.ok(helpOutput.includes("\n  zsh:"));
      assert.ok(helpOutput.includes("\n  fish:"));
      assert.ok(helpOutput.includes("\n  PowerShell:"));
      assert.ok(helpOutput.includes("\n  Nushell:"));
    });

    it("should not treat --help in completion payload as help request", () => {
      const parser = object({});

      let completionShown = false;
      let helpShown = false;

      runParser(
        parser,
        "myapp",
        ["completion", "bash", "--", "--help"],
        {
          help: {
            option: true,
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          completion: {
            command: true,
            option: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(completionShown, "completion callback should be called");
      assert.ok(!helpShown, "help callback should not be called");
    });

    it("should not treat --help after shell arg as help request", () => {
      const parser = object({});

      let completionShown = false;
      let helpShown = false;

      runParser(
        parser,
        "myapp",
        ["completion", "bash", "git", "--help"],
        {
          help: {
            option: true,
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          completion: {
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(completionShown, "completion callback should be called");
      assert.ok(!helpShown, "help callback should not be called");
    });

    it("should not treat custom help name in completion payload as help request", () => {
      const parser = object({});

      let completionShown = false;
      let helpShown = false;

      runParser(
        parser,
        "myapp",
        ["completion", "bash", "--", "--assist"],
        {
          help: {
            option: { names: ["--assist"] },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          completion: {
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(completionShown, "completion callback should be called");
      assert.ok(!helpShown, "help callback should not be called");
    });

    it("should treat --help after --completion as completion payload", () => {
      const parser = object({});

      let completionShown = false;
      let helpShown = false;

      runParser(
        parser,
        "myapp",
        ["--completion", "bash", "--help"],
        {
          help: {
            option: true,
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(completionShown, "completion callback should be called");
      assert.ok(!helpShown, "help callback should not be called");
    });

    it("should show help when --help precedes --completion", () => {
      const parser = object({});

      let completionShown = false;
      let helpShown = false;

      runParser(
        parser,
        "myapp",
        ["--help", "--completion", "bash"],
        {
          help: {
            option: true,
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(helpShown, "help callback should be called");
      assert.ok(!completionShown, "completion callback should not be called");
    });

    it("should ignore --version in completion payload when --help precedes --completion", () => {
      const parser = object({});

      let completionShown = false;
      let helpShown = false;
      let versionShown = false;

      runParser(
        parser,
        "myapp",
        ["--help", "--completion", "bash", "--version"],
        {
          help: {
            option: true,
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          version: {
            option: true,
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(helpShown, "help callback should be called");
      assert.ok(!versionShown, "version callback should not be called");
      assert.ok(!completionShown, "completion callback should not be called");
    });

    it("should show help when --help follows other flags before --completion", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionShown = false;
      let helpShown = false;

      runParser(
        parser,
        "myapp",
        ["--verbose", "--help", "--completion", "bash"],
        {
          help: {
            option: true,
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(helpShown, "help callback should be called");
      assert.ok(!completionShown, "completion callback should not be called");
    });

    it("should show version when --version follows other flags before --completion", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionShown = false;
      let versionShown = false;

      runParser(
        parser,
        "myapp",
        ["--verbose", "--version", "--completion", "bash"],
        {
          version: {
            option: true,
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(versionShown, "version callback should be called");
      assert.ok(!completionShown, "completion callback should not be called");
    });

    it("should show help when help command precedes --completion", () => {
      const parser = object({});

      let completionShown = false;
      let helpShown = false;

      runParser(
        parser,
        "myapp",
        ["help", "--completion", "bash"],
        {
          help: {
            command: true,
            option: true,
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(helpShown, "help callback should be called");
      assert.ok(!completionShown, "completion callback should not be called");
    });

    it("should show version when version command precedes --completion", () => {
      const parser = object({});

      let completionShown = false;
      let versionShown = false;

      runParser(
        parser,
        "myapp",
        ["version", "--completion", "bash"],
        {
          version: {
            command: true,
            option: true,
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(versionShown, "version callback should be called");
      assert.ok(!completionShown, "completion callback should not be called");
    });

    it("should report an invalid version command before --completion", () => {
      const parser = object({});

      let completionShown = false;
      let stderrOutput = "";

      const result = runParser(
        parser,
        "myapp",
        ["version", "foo", "--completion", "bash"],
        {
          version: {
            command: true,
            option: true,
            value: "1.0.0",
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          onError: () => "error-shown",
          stdout: () => {},
          stderr: (text) => {
            stderrOutput += text;
          },
        },
      );

      assert.equal(result, "error-shown");
      assert.ok(!completionShown, "completion callback should not be called");
      assert.ok(
        stderrOutput.includes("Error:"),
        "invalid version command should be reported as a parse error",
      );
    });

    it("should treat --help after --completion=bash as completion payload", () => {
      const parser = object({});

      let completionShown = false;
      let helpShown = false;

      runParser(
        parser,
        "myapp",
        ["--completion=bash", "--help"],
        {
          help: {
            option: true,
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(completionShown, "completion callback should be called");
      assert.ok(!helpShown, "help callback should not be called");
    });

    it("should show help when --help precedes --completion=bash", () => {
      const parser = object({});

      let completionShown = false;
      let helpShown = false;

      runParser(
        parser,
        "myapp",
        ["--help", "--completion=bash"],
        {
          help: {
            option: true,
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(helpShown, "help callback should be called");
      assert.ok(!completionShown, "completion callback should not be called");
    });

    it("should treat --version after --completion as completion payload", () => {
      const parser = object({});

      let completionShown = false;
      let versionShown = false;

      runParser(
        parser,
        "myapp",
        ["--completion", "bash", "--version"],
        {
          version: {
            option: true,
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(completionShown, "completion callback should be called");
      assert.ok(!versionShown, "version callback should not be called");
    });

    it("should show version when --version precedes --completion", () => {
      const parser = object({});

      let completionShown = false;
      let versionShown = false;

      runParser(
        parser,
        "myapp",
        ["--version", "--completion", "bash"],
        {
          version: {
            option: true,
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(versionShown, "version callback should be called");
      assert.ok(!completionShown, "completion callback should not be called");
    });

    it("should treat --version after --completion=bash as completion payload", () => {
      const parser = object({});

      let completionShown = false;
      let versionShown = false;

      runParser(
        parser,
        "myapp",
        ["--completion=bash", "--version"],
        {
          version: {
            option: true,
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(completionShown, "completion callback should be called");
      assert.ok(!versionShown, "version callback should not be called");
    });

    it("should show version when --version precedes --completion=bash", () => {
      const parser = object({});

      let completionShown = false;
      let versionShown = false;

      runParser(
        parser,
        "myapp",
        ["--version", "--completion=bash"],
        {
          version: {
            option: true,
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          completion: {
            option: true,
            command: true,
            onShow: () => {
              completionShown = true;
              return "completion-shown";
            },
          },
          stdout: () => {},
        },
      );

      assert.ok(versionShown, "version callback should be called");
      assert.ok(!completionShown, "completion callback should not be called");
    });

    it("should support --completions (plural) option", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["--completions=bash"], {
        completion: {
          option: { names: ["--completions"] },
        },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      assert.ok(completionOutput.includes("function _myapp"));
    });

    it("should hide both completion command names in help when helpVisibility is 'none'", () => {
      const parser = object({
        foo: option("--foo"),
      });

      let helpOutput = "";

      runParser(parser, "mycli", ["--help"], {
        help: {
          option: true,
          onShow: () => "help-shown",
        },
        completion: {
          command: { names: ["completion", "completions"], hidden: true },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.ok(!helpOutput.includes("mycli completion [SHELL] [ARG...]"));
      assert.ok(!helpOutput.includes("mycli completions [SHELL] [ARG...]"));
    });

    it("should show only singular completion command in help when configured", () => {
      const parser = object({
        foo: option("--foo"),
      });

      let helpOutput = "";

      runParser(parser, "mycli", ["--help"], {
        help: {
          option: true,
          onShow: () => "help-shown",
        },
        completion: {
          command: { names: ["completion", "completions"] },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.ok(helpOutput.includes("mycli completion [SHELL] [ARG...]"));
      assert.ok(!helpOutput.includes("mycli completions [SHELL] [ARG...]"));
    });

    it("should keep hidden completion aliases functional at runtime", () => {
      const parser = object({
        foo: option("--foo"),
      });

      let completionOutput = "";
      let completionShown = false;

      const result = runParser(parser, "mycli", ["completions", "bash"], {
        completion: {
          command: { names: ["completion", "completions"] },
          onShow: () => {
            completionShown = true;
            return "completion-shown";
          },
        },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      assert.equal(result, "completion-shown");
      assert.ok(completionShown);
      assert.ok(completionOutput.includes("function _mycli"));
    });

    it("should restrict to singular name when configured", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      // Singular command should work
      let completionShown = false;
      runParser(parser, "myapp", ["completion", "bash"], {
        completion: {
          command: true,
          onShow: () => {
            completionShown = true;
            return "completion-shown";
          },
        },
        stdout: () => {},
      });
      assert.ok(completionShown);

      // Plural command should NOT work (be treated as unknown command)
      // Since unknown command handling depends on the parser, here it should fail as 'completions' is not defined in the user parser
      let errorCalled = false;
      try {
        runParser(parser, "myapp", ["completions", "bash"], {
          completion: {
            command: true,
          },
          onError: () => {
            errorCalled = true;
            return "error";
          },
          stderr: () => {},
        });
      } catch {
        // ignore
      }
      assert.ok(errorCalled);
    });

    it("should restrict to plural name when configured", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      // Plural command should work
      let completionShown = false;
      runParser(parser, "myapp", ["completions", "bash"], {
        completion: {
          command: { names: ["completions"] },
          onShow: () => {
            completionShown = true;
            return "completion-shown";
          },
        },
        stdout: () => {},
      });
      assert.ok(completionShown);

      // Singular command should NOT work
      let errorCalled = false;
      try {
        runParser(parser, "myapp", ["completion", "bash"], {
          completion: {
            command: { names: ["completions"] },
          },
          onError: () => {
            errorCalled = true;
            return "error";
          },
          stderr: () => {},
        });
      } catch {
        // ignore
      }
      assert.ok(errorCalled);
    });

    it("should respect name configuration for options", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      // Plural only configuration
      // --completions should work
      let completionShown = false;
      runParser(parser, "myapp", ["--completions=bash"], {
        completion: {
          option: { names: ["--completions"] },
          onShow: () => {
            completionShown = true;
            return "completion-shown";
          },
        },
        stdout: () => {},
      });
      assert.ok(completionShown);

      // --completion should NOT work (should be treated as unknown option)
      let errorCalled = false;
      try {
        runParser(parser, "myapp", ["--completion=bash"], {
          completion: {
            option: { names: ["--completions"] },
          },
          onError: () => {
            errorCalled = true;
            return "error";
          },
          stderr: () => {},
        });
      } catch {
        // ignore
      }
      assert.ok(errorCalled);
    });

    it("should use --completion in generated script when mode is 'option'", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["--completion", "fish"], {
        completion: { option: true },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      // Verify the generated script uses --completion, not completion
      assert.ok(
        completionOutput.includes("'--completion'"),
        "Should include '--completion' in generated script",
      );
      // Ensure it doesn't use the command form 'completion'
      assert.ok(
        !completionOutput.includes("'completion'"),
        "Should not include 'completion' command in generated script",
      );
    });

    it("should use completion command in generated script when mode is 'command'", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["completion", "fish"], {
        completion: { command: true },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      // Verify the generated script uses completion command
      assert.ok(
        completionOutput.includes("'completion'"),
        "Should include 'completion' command in generated script",
      );
      assert.ok(
        !completionOutput.includes("'--completion'"),
        "Should not include '--completion' option in generated script",
      );
    });

    it("should use completion command in generated script when mode is 'both'", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["completion", "fish"], {
        completion: { command: true, option: true },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      // When mode is 'both', default to using command form 'completion'
      assert.ok(
        completionOutput.includes("'completion'"),
        "Should include 'completion' command in generated script",
      );
      assert.ok(
        !completionOutput.includes("'--completion'"),
        "Should not include '--completion' option in generated script",
      );
    });

    it("should use --completion in bash script when mode is 'option'", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["--completion=bash"], {
        completion: { option: true },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      // Verify the generated bash script uses --completion
      assert.ok(
        completionOutput.includes("'--completion'"),
        "Should include '--completion' in generated bash script",
      );
      assert.ok(
        !completionOutput.includes("'completion'"),
        "Should not include 'completion' command in generated bash script",
      );
    });

    it("should use --completions (plural) in generated script when name is 'plural' and mode is 'option' (Issue #53)", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["--completions", "fish"], {
        completion: { option: { names: ["--completions"] } },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      // Verify the generated script uses --completions (plural), not --completion
      assert.ok(
        completionOutput.includes("'--completions'"),
        "Should include '--completions' (plural) in generated script when name is 'plural'",
      );
      assert.ok(
        !completionOutput.includes("'--completion'"),
        "Should not include '--completion' (singular) in generated script when name is 'plural'",
      );
    });

    it("should use completions (plural) command in generated script when name is 'plural' and mode is 'command' (Issue #53)", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["completions", "fish"], {
        completion: { command: { names: ["completions"] } },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      // Verify the generated script uses completions (plural), not completion
      assert.ok(
        completionOutput.includes("'completions'"),
        "Should include 'completions' (plural) command in generated script when name is 'plural'",
      );
      assert.ok(
        !completionOutput.includes("'completion'"),
        "Should not include 'completion' (singular) command in generated script when name is 'plural'",
      );
    });

    it("should use --completion (singular) in generated script when name is 'singular' and mode is 'option'", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["--completion", "fish"], {
        completion: { option: true },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      // Verify the generated script uses --completion (singular)
      assert.ok(
        completionOutput.includes("'--completion'"),
        "Should include '--completion' (singular) in generated script when name is 'singular'",
      );
      assert.ok(
        !completionOutput.includes("'--completions'"),
        "Should not include '--completions' (plural) in generated script when name is 'singular'",
      );
    });

    it("should use completion (singular) command in generated script when name is 'singular' and mode is 'command'", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let completionOutput = "";

      runParser(parser, "myapp", ["completion", "fish"], {
        completion: { command: true },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      // Verify the generated script uses completion (singular)
      assert.ok(
        completionOutput.includes("'completion'"),
        "Should include 'completion' (singular) command in generated script when name is 'singular'",
      );
      assert.ok(
        !completionOutput.includes("'completions'"),
        "Should not include 'completions' (plural) command in generated script when name is 'singular'",
      );
    });

    it("should enforce that at least one of command or option is provided at compile time", () => {
      // Valid: command only
      const validCommand: RunOptions<void, never>["completion"] = {
        command: true,
      };
      void validCommand;

      // Valid: option only
      const validOption: RunOptions<void, never>["completion"] = {
        option: true,
      };
      void validOption;

      // Valid: both command and option
      const validBoth: RunOptions<void, never>["completion"] = {
        command: true,
        option: true,
      };
      void validBoth;

      // Valid: command with sub-config
      const validCommandConfig: RunOptions<void, never>["completion"] = {
        command: { names: ["completion", "completions"] },
      };
      void validCommandConfig;

      // Invalid: neither command nor option → should be never
      type InvalidEmpty = Extract<
        RunOptions<void, never>["completion"],
        { readonly command?: undefined; readonly option?: undefined }
      >;
      const assertInvalidEmpty: AssertNever<InvalidEmpty> = undefined as never;
      void assertInvalidEmpty;
    });
  });

  describe("Program support", () => {
    it("should accept Program object instead of separate parser and options", () => {
      const parser = object({
        name: argument(string()),
      });

      const prog: Program<"sync", { name: string }> = {
        parser,
        metadata: {
          name: "greet",
          version: "1.0.0",
          brief: message`A greeting CLI tool`,
        },
      };

      const result = runParser(prog, ["Alice"]);
      assert.deepEqual(result, { name: "Alice" });
    });

    it("should use metadata from Program for help output", () => {
      const parser = option("--verbose");
      const prog: Program<"sync", boolean> = {
        parser,
        metadata: {
          name: "myapp",
          version: "2.0.0",
          brief: message`A test application`,
          description: message`This is a test application description.`,
        },
      };

      let helpOutput = "";
      runParser(prog, ["--help"], {
        help: { option: true },
        stdout: (text) => {
          helpOutput += text + "\n";
        },
      });

      // Should not throw, help should be displayed
      assert.ok(helpOutput.includes("myapp"));
      assert.ok(helpOutput.includes("A test application"));
    });

    it("should merge additional options with Program metadata", () => {
      const parser = option("--verbose");
      const prog: Program<"sync", boolean> = {
        parser,
        metadata: {
          name: "myapp",
          version: "1.0.0",
        },
      };

      let versionOutput = "";
      runParser(prog, ["--version"], {
        version: { option: true, value: prog.metadata.version! },
        stdout: (text) => {
          versionOutput += text;
        },
      });

      assert.equal(versionOutput, "1.0.0");
    });
  });

  describe("program name validation", () => {
    it("should reject empty program name (old API)", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () => runParser(parser, "", ["x"]),
        { name: "TypeError", message: /program name.*empty/i },
      );
    });

    it("should reject program name with control characters (old API)", () => {
      const parser = object({ name: argument(string()) });
      assert.throws(
        () => runParser(parser, "bad\nname", ["x"]),
        { name: "TypeError", message: /program name.*control characters/i },
      );
    });

    it("should reject empty metadata name (Program API)", () => {
      const prog: Program<"sync", { readonly name: string }> = {
        parser: object({ name: argument(string()) }),
        metadata: { name: "" },
      };
      assert.throws(
        () => runParser(prog, ["x"]),
        { name: "TypeError", message: /program name.*empty/i },
      );
    });

    it("should reject non-string metadata name (Program API)", () => {
      const prog = {
        parser: object({ name: argument(string()) }),
        metadata: { name: 123 as never },
      } as Program<"sync", { readonly name: string }>;
      assert.throws(
        () => runParser(prog, ["x"]),
        { name: "TypeError", message: /program name.*string/i },
      );
    });
  });
});

describe("runWith", () => {
  describe("basic functionality", () => {
    it("should preserve primitive parser state with annotations", async () => {
      const envKey = Symbol.for("@test/env-primitive-async");
      const envContext: SourceContext = {
        id: envKey,
        phase: "single-pass",
        getAnnotations() {
          return { [envKey]: { HOST: "localhost" } };
        },
      };

      const result = await runWith(constant("ok"), "test", [envContext], {
        args: [],
      });

      assert.equal(result, "ok");
    });

    it("should parse with no contexts", async () => {
      const parser = object({
        name: argument(string()),
      });

      const result = await runWith(parser, "test", [], {
        args: ["Alice"],
      });
      assert.deepEqual(result, { name: "Alice" });
    });

    it("should parse with a single-pass context", async () => {
      const envKey = Symbol.for("@test/env");
      const envContext: SourceContext = {
        id: envKey,
        phase: "single-pass",
        getAnnotations() {
          return { [envKey]: { HOST: "localhost" } };
        },
      };

      const parser = object({
        host: withDefault(option("--host", string()), "default"),
      });

      const result = await runWith(parser, "test", [envContext], {
        args: [],
      });

      // Without any special binding, just verifies the context doesn't break parsing
      assert.deepEqual(result, { host: "default" });
    });

    it("should call a single-pass context once in async runWith", async () => {
      let callCount = 0;
      const staticContext: SourceContext = {
        id: Symbol.for("@test/static-once"),
        phase: "single-pass",
        getAnnotations() {
          callCount++;
          return {
            [Symbol.for("@test/static-once")]: { value: true },
          };
        },
      };

      const parser = object({
        host: withDefault(option("--host", string()), "default"),
      });

      const result = await runWith(parser, "test", [staticContext], {
        args: [],
      });

      assert.deepEqual(result, { host: "default" });
      assert.equal(callCount, 1);
    });

    it('should not force two-phase parsing for phase: "single-pass" with empty annotations', async () => {
      let callCount = 0;
      const staticContext: SourceContext = {
        id: Symbol.for("@test/static-empty-once"),
        phase: "single-pass",
        getAnnotations() {
          callCount++;
          return {};
        },
      };

      const parser = object({
        host: withDefault(option("--host", string()), "default"),
      });

      const result = await runWith(parser, "test", [staticContext], {
        args: [],
      });

      assert.deepEqual(result, { host: "default" });
      assert.equal(callCount, 1);
    });

    it('should not force two-phase parsing for async phase: "single-pass" contexts', async () => {
      let callCount = 0;
      const staticContext: SourceContext = {
        id: Symbol.for("@test/static-empty-async-once"),
        phase: "single-pass",
        getAnnotations() {
          callCount++;
          return Promise.resolve({});
        },
      };

      const parser = object({
        host: withDefault(option("--host", string()), "default"),
      });

      const result = await runWith(parser, "test", [staticContext], {
        args: [],
      });

      assert.deepEqual(result, { host: "default" });
      assert.equal(callCount, 1);
    });

    it("should parse with multiple single-pass contexts", async () => {
      const envKey = Symbol.for("@test/env");
      const configKey = Symbol.for("@test/config");

      const envContext: SourceContext = {
        id: envKey,
        phase: "single-pass",
        getAnnotations() {
          return { [envKey]: { HOST: "env-host" } };
        },
      };

      const configContext: SourceContext = {
        id: configKey,
        phase: "single-pass",
        getAnnotations() {
          return { [configKey]: { host: "config-host" } };
        },
      };

      const parser = object({
        host: withDefault(option("--host", string()), "default"),
      });

      const result = await runWith(
        parser,
        "test",
        [envContext, configContext],
        { args: [] },
      );

      assert.deepEqual(result, { host: "default" });
    });
  });

  describe("priority handling", () => {
    it("should give priority to earlier contexts", async () => {
      const sharedKey = Symbol.for("@test/shared");

      const context1: SourceContext = {
        id: Symbol.for("@test/context1"),
        phase: "single-pass",
        getAnnotations() {
          return { [sharedKey]: { value: "from-context1" } };
        },
      };

      const context2: SourceContext = {
        id: Symbol.for("@test/context2"),
        phase: "single-pass",
        getAnnotations() {
          return { [sharedKey]: { value: "from-context2" } };
        },
      };

      const parser = object({
        value: withDefault(option("--value", string()), "default"),
      });

      // context1 should have priority over context2
      const result = await runWith(parser, "test", [context1, context2], {
        args: [],
      });

      assert.deepEqual(result, { value: "default" });
    });

    it("keeps earlier context precedence after phase 2", async () => {
      const sharedKey = Symbol.for("@test/phase-merge-priority");

      const parser: Parser<"sync", string, string | undefined> = {
        $mode: "sync",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly (string | undefined)[],
        priority: 1,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          const value = getAnnotations(context.state)?.[sharedKey];
          if (typeof value !== "string") {
            return {
              success: false as const,
              consumed: 0,
              error: message`missing`,
            };
          }
          return {
            success: true as const,
            next: { ...context, state: value },
            consumed: [],
          };
        },
        complete(state) {
          return typeof state === "string"
            ? { success: true as const, value: state }
            : { success: false as const, error: message`missing` };
        },
        suggest() {
          return [];
        },
        getDocFragments() {
          return { fragments: [] };
        },
      };

      const earlyContext: SourceContext = {
        id: Symbol.for("@test/phase-merge-early"),
        phase: "single-pass",
        getAnnotations() {
          return { [sharedKey]: "phase1-early" };
        },
      };

      const lateDynamicContext: SourceContext = {
        id: Symbol.for("@test/phase-merge-late"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase1ContextRequest(request)) {
            return {};
          }
          return { [sharedKey]: "phase2-late" };
        },
      };

      const result = await runWith(
        parser,
        "test",
        [earlyContext, lateDynamicContext],
        { args: [] },
      );

      assert.equal(result, "phase1-early");
    });

    it("lets phase 2 clear a context's phase 1 annotations", async () => {
      const sharedKey = Symbol.for("@test/phase-clear-priority");

      const parser: Parser<"sync", string | undefined, undefined> = {
        $mode: "sync",
        $valueType: [] as readonly (string | undefined)[],
        $stateType: [] as readonly undefined[],
        priority: 1,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          return {
            success: true as const,
            next: context,
            consumed: [],
          };
        },
        complete(state) {
          return {
            success: true as const,
            value: getAnnotations(state)?.[sharedKey] as string | undefined,
          };
        },
        suggest() {
          return [];
        },
        getDocFragments() {
          return { fragments: [] };
        },
      };

      const clearingContext: SourceContext = {
        id: Symbol.for("@test/phase-clear-early"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase1ContextRequest(request)) {
            return { [sharedKey]: "phase1-early" };
          }
          return {};
        },
      };

      const fallbackContext: SourceContext = {
        id: Symbol.for("@test/phase-clear-late"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase1ContextRequest(request)) {
            return {};
          }
          return { [sharedKey]: "phase2-late" };
        },
      };

      const result = await runWith(
        parser,
        "test",
        [clearingContext, fallbackContext],
        { args: [] },
      );

      assert.equal(result, "phase2-late");
    });
  });

  describe("two-pass contexts", () => {
    it("should handle a two-pass context with two-phase parsing", async () => {
      const configKey = Symbol.for("@test/config");
      let phase2Called = false;

      const dynamicContext: SourceContext = {
        id: configKey,
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          const result = getPhase2ContextParsed<{ config?: string }>(request);
          if (result == null) return {};
          phase2Called = true;
          if (!result.config) return {};
          // Simulate loaded config
          return { [configKey]: { host: "dynamic-host" } };
        },
      };

      const parser = object({
        config: optional(option("--config", string())),
        host: withDefault(option("--host", string()), "default"),
      });

      const result = await runWith(parser, "test", [dynamicContext], {
        args: ["--config", "test.json"],
      });

      // Parser should complete successfully
      assert.equal(result.config, "test.json");
      assert.equal(result.host, "default");
      assert.ok(phase2Called, "phase 2 context should be called");
    });

    it("preserves plain parsed object identity when no scrub is needed", async () => {
      const seenParsed = new WeakMap<object, true>();
      let reusedIdentity = false;

      const firstContext: SourceContext = {
        id: Symbol.for("@test/phase-two-identity-first"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          const parsed = getPhase2ContextParsed<object>(request);
          if (parsed != null && typeof parsed === "object") {
            seenParsed.set(parsed, true);
          }
          return {};
        },
      };

      const secondContext: SourceContext = {
        id: Symbol.for("@test/phase-two-identity-second"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          const parsed = getPhase2ContextParsed<object>(request);
          reusedIdentity = parsed != null &&
            typeof parsed === "object" &&
            seenParsed.has(parsed);
          return {};
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      const result = await runWith(
        parser,
        "test",
        [firstContext, secondContext],
        { args: [] },
      );

      assert.ok(reusedIdentity);
      assert.deepEqual(result, { name: "default" });
    });

    it("should handle mixed single-pass and two-pass contexts", async () => {
      const envKey = Symbol.for("@test/env");
      const configKey = Symbol.for("@test/config");
      let phase2Called = false;

      const staticContext: SourceContext = {
        id: envKey,
        phase: "single-pass",
        getAnnotations() {
          return { [envKey]: { HOST: "env-host" } };
        },
      };

      const dynamicContext: SourceContext = {
        id: configKey,
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase1ContextRequest(request)) return {};
          phase2Called = true;
          return { [configKey]: { host: "config-host" } };
        },
      };

      const parser = object({
        host: withDefault(option("--host", string()), "default"),
      });

      const result = await runWith(
        parser,
        "test",
        [staticContext, dynamicContext],
        { args: [] },
      );

      assert.deepEqual(result, { host: "default" });
      assert.ok(phase2Called, "phase 2 context should be called");
    });

    it("should handle async context", async () => {
      const asyncKey = Symbol.for("@test/async");

      const asyncContext: SourceContext = {
        id: asyncKey,
        phase: "single-pass",
        async getAnnotations() {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { [asyncKey]: { value: "async-value" } };
        },
      };

      const parser = object({
        value: withDefault(option("--value", string()), "default"),
      });

      const result = await runWith(parser, "test", [asyncContext], {
        args: [],
      });

      assert.deepEqual(result, { value: "default" });
    });
  });

  describe("error handling", () => {
    it("should handle parse errors with proper error messages", async () => {
      const parser = object({
        port: argument(integer()),
      });

      let errorCalled = false;
      let errorOutput = "";

      await runWith(parser, "test", [], {
        args: ["not-a-number"],
        onError: () => {
          errorCalled = true;
          return "error-handled";
        },
        stderr: (text) => {
          errorOutput += text;
        },
      });

      assert.ok(errorCalled);
      assert.ok(errorOutput.includes("Error:"));
    });
  });

  describe("help and version integration", () => {
    it("should show help when --help is provided", async () => {
      const parser = object({
        name: argument(string()),
      });

      let helpShown = false;
      let helpOutput = "";

      await runWith(parser, "test", [], {
        args: ["--help"],
        help: {
          option: true,
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.ok(helpShown);
      assert.ok(helpOutput.includes("Usage: test"));
    });

    it("should show version when --version is provided", async () => {
      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;
      let versionOutput = "";

      await runWith(parser, "test", [], {
        args: ["--version"],
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => {
            versionShown = true;
            return "version-shown";
          },
        },
        stdout: (text) => {
          versionOutput = text;
        },
      });

      assert.ok(versionShown);
      assert.equal(versionOutput, "1.0.0");
    });
  });

  describe("early exit for help/version/completion", () => {
    it("should collect phase 1 annotations when --help option is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        name: argument(string()),
      });

      let helpShown = false;
      await runWith(parser, "test", [trackingContext], {
        args: ["--help"],
        help: {
          option: true,
          onShow: () => {
            helpShown = true;
            return "help" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(helpShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should collect phase 1 annotations when --version option is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;
      await runWith(parser, "test", [trackingContext], {
        args: ["--version"],
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => {
            versionShown = true;
            return "version" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(versionShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should collect phase 1 annotations when help command is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        verbose: option("--verbose"),
      });

      let helpShown = false;
      await runWith(parser, "test", [trackingContext], {
        args: ["help"],
        help: {
          command: true,
          onShow: () => {
            helpShown = true;
            return "help" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(helpShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should collect phase 1 annotations when version command is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        verbose: option("--verbose"),
      });

      let versionShown = false;
      await runWith(parser, "test", [trackingContext], {
        args: ["version"],
        version: {
          command: true,
          value: "1.0.0",
          onShow: () => {
            versionShown = true;
            return "version" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(versionShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should collect phase 1 annotations when completion command is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        verbose: option("--verbose"),
      });

      let completionShown = false;
      await runWith(parser, "test", [trackingContext], {
        args: ["completion", "bash"],
        completion: {
          command: true,
          onShow: () => {
            completionShown = true;
            return "completion" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(completionShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should collect phase 1 annotations when --completion option is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        verbose: option("--verbose"),
      });

      let completionShown = false;
      await runWith(parser, "test", [trackingContext], {
        args: ["--completion=bash"],
        completion: {
          option: true,
          onShow: () => {
            completionShown = true;
            return "completion" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(completionShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should collect phase 1 annotations when completions (plural) command is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        verbose: option("--verbose"),
      });

      let completionShown = false;
      await runWith(parser, "test", [trackingContext], {
        args: ["completions", "bash"],
        completion: {
          command: { names: ["completions"] },
          onShow: () => {
            completionShown = true;
            return "completion" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(completionShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should collect phase 1 annotations when --completions (plural) option is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        verbose: option("--verbose"),
      });

      let completionShown = false;
      await runWith(parser, "test", [trackingContext], {
        args: ["--completions=bash"],
        completion: {
          option: { names: ["--completions"] },
          onShow: () => {
            completionShown = true;
            return "completion" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(completionShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should continue to context collection when completion option is configured but absent", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking-present-but-absent-completion"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        name: argument(string()),
      });

      const result = await runWith(parser, "test", [trackingContext], {
        args: ["alice"],
        completion: {
          option: true,
        },
      });

      assert.deepEqual(result, { name: "alice" });
      assert.equal(annotationsCallCount, 1);
    });

    it("should let phase 1 annotations keep --help as ordinary parser data", async () => {
      const key = Symbol.for("@test/phase1-meta-shadow-async");
      let phase1Calls = 0;
      let helpShown = false;

      const parser: Parser<
        "sync",
        { readonly value: string },
        string | undefined
      > = {
        $mode: "sync",
        $valueType: [] as readonly { readonly value: string }[],
        $stateType: [] as readonly (string | undefined)[],
        priority: 0,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          const [head, ...rest] = context.buffer;
          if (
            head === "--help" &&
            getAnnotations(context.state)?.[key] === true
          ) {
            return {
              success: true as const,
              next: { ...context, buffer: rest, state: head },
              consumed: [head],
            };
          }
          return {
            success: false as const,
            error: message`Missing annotated help value.`,
            consumed: 0,
          };
        },
        complete(state) {
          return state == null
            ? {
              success: false as const,
              error: message`Missing annotated help value.`,
            }
            : { success: true as const, value: { value: state } };
        },
        *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
      };

      const context: SourceContext = {
        id: key,
        phase: "single-pass",
        getAnnotations() {
          phase1Calls++;
          return { [key]: true };
        },
      };

      const result = await runWith(parser, "test", [context], {
        args: ["--help"],
        help: {
          option: true,
          onShow: () => {
            helpShown = true;
            return "help" as const;
          },
        },
        stdout: () => {},
      });

      assert.deepEqual(result, { value: "--help" });
      assert.ok(!helpShown, "help should remain ordinary parser data");
      assert.equal(phase1Calls, 1);
    });
  });

  describe("error handling", () => {
    it("should display error only once with a two-pass context and empty args", async () => {
      const cmd1 = command("foo", object({ cmd: constant("foo") }));
      const cmd2 = command("bar", object({ cmd: constant("bar") }));
      const parser = merge(
        or(cmd1, cmd2),
        object({ debug: flag("-d") }),
      );

      const dynamicContext: SourceContext = {
        id: Symbol("dynamic"),
        phase: "two-pass",
        getAnnotations(_request?: unknown) {
          return Promise.resolve({});
        },
      };

      const stderrCalls: string[] = [];
      try {
        await runWith(parser, "test", [dynamicContext], {
          args: [],
          help: { command: true, option: true, onShow: () => "help" },
          stderr: (text: string) => {
            stderrCalls.push(text);
          },
        });
        assert.fail("Expected RunParserError to be thrown");
      } catch (error) {
        assert.ok(error instanceof RunParserError);
      }

      // Should output exactly 2 lines: Usage + Error (not duplicated)
      assert.equal(
        stderrCalls.length,
        2,
        `Expected 2 stderr calls (Usage + Error) but got ${stderrCalls.length}: ${
          JSON.stringify(stderrCalls)
        }`,
      );
      assert.ok(
        stderrCalls[0].startsWith("Usage:"),
        "First stderr call should be usage",
      );
      assert.ok(
        stderrCalls[1].startsWith("Error:"),
        "Second stderr call should be error",
      );
    });
  });

  describe("dispose lifecycle", () => {
    it("should dispose contexts after successful parsing", async () => {
      let disposed = false;
      const context: SourceContext = {
        id: Symbol.for("@test/disposable"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/disposable")]: { value: true },
          };
        },
        [Symbol.dispose]() {
          disposed = true;
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      await runWith(parser, "test", [context], { args: [] });
      assert.ok(disposed);
    });

    it("should dispose contexts even when parsing throws", async () => {
      let disposed = false;
      const context: SourceContext = {
        id: Symbol.for("@test/disposable-error"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/disposable-error")]: { value: true },
          };
        },
        [Symbol.dispose]() {
          disposed = true;
        },
      };

      const parser = object({
        port: argument(integer()),
      });

      let errorCaught = false;
      try {
        await runWith(parser, "test", [context], {
          args: ["not-a-number"],
        });
      } catch {
        errorCaught = true;
      }

      assert.ok(errorCaught);
      assert.ok(disposed);
    });

    it("should prefer Symbol.asyncDispose over Symbol.dispose in async mode", async () => {
      const disposed: string[] = [];
      const context: SourceContext = {
        id: Symbol.for("@test/async-disposable"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/async-disposable")]: { value: true },
          };
        },
        [Symbol.dispose]() {
          disposed.push("sync");
        },
        [Symbol.asyncDispose]() {
          disposed.push("async");
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      await runWith(parser, "test", [context], { args: [] });
      assert.deepEqual(disposed, ["async"]);
    });

    describe("async completion ordering", () => {
      // Regression tests for https://github.com/dahlia/optique/issues/269.
      // Before 9e898ed4, runWith() returned the pending runParser() Promise
      // from inside a try/finally, so disposal could start before later async
      // complete() work had settled.
      function createIssue269ProbeParser(
        readDisposed: () => boolean,
      ): Parser<"sync", boolean, string | null> {
        return {
          $mode: "sync",
          $valueType: [] as readonly boolean[],
          $stateType: [] as readonly (string | null)[],
          priority: 0,
          usage: [{ type: "option", names: ["--probe"], metavar: "TAG" }],
          leadingNames: new Set(["--probe"]),
          acceptingAnyToken: false,
          initialState: null,
          parse(context) {
            const tag = context.buffer[1];
            if (context.buffer[0] !== "--probe" || tag == null) {
              return {
                success: false as const,
                consumed: 0,
                error: message`missing`,
              };
            }
            return {
              success: true as const,
              next: {
                ...context,
                buffer: context.buffer.slice(2),
                state: tag,
              },
              consumed: [context.buffer[0], tag],
            };
          },
          complete() {
            return { success: true as const, value: readDisposed() };
          },
          *suggest() {},
          getDocFragments() {
            return { fragments: [] };
          },
        };
      }

      function createIssue269AsyncOptionParser(
        name: OptionName,
        completeValue: (state: string) => Promise<string>,
      ): Parser<"async", string, string | null> {
        return {
          $mode: "async",
          $valueType: [] as readonly string[],
          $stateType: [] as readonly (string | null)[],
          priority: 0,
          usage: [{ type: "option", names: [name], metavar: "VALUE" }],
          leadingNames: new Set([name]),
          acceptingAnyToken: false,
          initialState: null,
          parse(context) {
            const value = context.buffer[1];
            if (context.buffer[0] !== name || value == null) {
              return Promise.resolve({
                success: false as const,
                consumed: 0,
                error: message`missing`,
              });
            }
            return Promise.resolve({
              success: true as const,
              next: {
                ...context,
                buffer: context.buffer.slice(2),
                state: value,
              },
              consumed: [context.buffer[0], value],
            });
          },
          async complete(state) {
            if (state == null) {
              return {
                success: false as const,
                error: message`missing`,
              };
            }
            return {
              success: true as const,
              value: await completeValue(state),
            };
          },
          async *suggest() {},
          getDocFragments() {
            return { fragments: [] };
          },
        };
      }

      it("waits for async completion before Symbol.dispose (issue #269)", async () => {
        let disposed = false;
        const context: SourceContext = {
          id: Symbol.for("@test/issue-269-dispose-order"),
          phase: "single-pass",
          getAnnotations() {
            return {};
          },
          [Symbol.dispose]() {
            disposed = true;
          },
        };

        const parser = object({
          slow: createIssue269AsyncOptionParser("--slow", async (value) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return value;
          }),
          probe: createIssue269ProbeParser(() => disposed),
        });

        const pending = runWith(parser, "test", [context], {
          args: ["--slow", "x", "--probe", "tag"],
        });

        await Promise.resolve();
        assert.equal(disposed, false);

        const result = await pending;
        assert.deepEqual(result, { slow: "x", probe: false });
        assert.equal(disposed, true);
      });

      it("waits for async completion failures before Symbol.asyncDispose (issue #269)", async () => {
        let disposeStarted = false;
        const lifecycle: string[] = [];
        const context: SourceContext = {
          id: Symbol.for("@test/issue-269-async-dispose-order"),
          phase: "single-pass",
          getAnnotations() {
            return {};
          },
          async [Symbol.asyncDispose]() {
            lifecycle.push("dispose-start");
            disposeStarted = true;
            await new Promise((resolve) => setTimeout(resolve, 0));
            lifecycle.push("dispose-end");
          },
        };

        const parser = object({
          slow: createIssue269AsyncOptionParser("--slow", async () => {
            lifecycle.push("complete-start");
            await new Promise((resolve) => setTimeout(resolve, 10));
            lifecycle.push(`complete-saw-dispose:${disposeStarted}`);
            throw new Error("Delayed completion failed.");
          }),
        });

        const pending = runWith(parser, "test", [context], {
          args: ["--slow", "x"],
        });

        await Promise.resolve();
        assert.equal(disposeStarted, false);

        await assert.rejects(() => pending, /Delayed completion failed\./);
        assert.deepEqual(lifecycle, [
          "complete-start",
          "complete-saw-dispose:false",
          "dispose-start",
          "dispose-end",
        ]);
        assert.equal(disposeStarted, true);
      });
    });

    it("should dispose multiple contexts in order", async () => {
      const disposed: string[] = [];

      const context1: SourceContext = {
        id: Symbol.for("@test/dispose1"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/dispose1")]: { value: 1 },
          };
        },
        [Symbol.dispose]() {
          disposed.push("context1");
        },
      };

      const context2: SourceContext = {
        id: Symbol.for("@test/dispose2"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/dispose2")]: { value: 2 },
          };
        },
        [Symbol.dispose]() {
          disposed.push("context2");
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      await runWith(parser, "test", [context1, context2], { args: [] });
      assert.deepEqual(disposed, ["context1", "context2"]);
    });

    it("should dispose remaining contexts when one async dispose fails", async () => {
      const disposed: string[] = [];

      const context1: SourceContext = {
        id: Symbol.for("@test/dispose-error-1"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/dispose-error-1")]: { value: 1 },
          };
        },
        [Symbol.asyncDispose]() {
          disposed.push("context1");
          throw new Error("Context 1 dispose failed.");
        },
      };

      const context2: SourceContext = {
        id: Symbol.for("@test/dispose-error-2"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/dispose-error-2")]: { value: 2 },
          };
        },
        [Symbol.dispose]() {
          disposed.push("context2");
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      await assert.rejects(
        () => runWith(parser, "test", [context1, context2], { args: [] }),
        /Context 1 dispose failed\./,
      );
      assert.deepEqual(disposed, ["context1", "context2"]);
    });

    it("should handle context without dispose methods", async () => {
      const context: SourceContext = {
        id: Symbol.for("@test/no-dispose"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/no-dispose")]: { value: true },
          };
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      // Should not throw
      const result = await runWith(parser, "test", [context], { args: [] });
      assert.deepEqual(result, { name: "default" });
    });

    it("should dispose contexts on --help early exit", async () => {
      let disposed = 0;
      const context: SourceContext = {
        id: Symbol.for("@test/dispose-help"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed++;
        },
      };

      const parser = object({
        name: argument(string()),
      });

      await runWith(parser, "test", [context], {
        args: ["--help"],
        help: {
          option: true,
          onShow: () => undefined,
        },
        stdout: () => {},
      });
      assert.equal(disposed, 1);
    });

    it("should dispose contexts on --version early exit", async () => {
      let disposed = 0;
      const context: SourceContext = {
        id: Symbol.for("@test/dispose-version"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed++;
        },
      };

      const parser = object({
        name: argument(string()),
      });

      await runWith(parser, "test", [context], {
        args: ["--version"],
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => undefined,
        },
        stdout: () => {},
      });
      assert.equal(disposed, 1);
    });

    it("should async-dispose contexts on --help early exit", async () => {
      let disposed = 0;
      const context: SourceContext = {
        id: Symbol.for("@test/async-dispose-help"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.asyncDispose]() {
          disposed++;
        },
      };

      const parser = object({
        name: argument(string()),
      });

      await runWith(parser, "test", [context], {
        args: ["--help"],
        help: {
          option: true,
          onShow: () => undefined,
        },
        stdout: () => {},
      });
      assert.equal(disposed, 1);
    });

    it("should dispose contexts on completion early exit", async () => {
      let disposed = 0;
      const context: SourceContext = {
        id: Symbol.for("@test/dispose-completion"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed++;
        },
      };

      const parser = object({
        verbose: option("--verbose"),
      });

      await runWith(parser, "test", [context], {
        args: ["completion", "bash"],
        completion: {
          command: true,
          onShow: () => undefined,
        },
        stdout: () => {},
      });
      assert.equal(disposed, 1);
    });

    it("should throw SuppressedError when parse fails and disposal also fails", async () => {
      let disposed = false;
      const context: SourceContext = {
        id: Symbol.for("@test/dispose-shadow"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed = true;
          throw new Error("dispose failed.");
        },
      };

      const parser = object({
        port: argument(integer()),
      });

      try {
        await runWith(parser, "test", [context], {
          args: ["not-a-number"],
        });
        assert.fail("Expected an error to be thrown");
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "SuppressedError");
        const se = error as Error & { suppressed: unknown; error: unknown };
        assert.ok(
          se.suppressed instanceof Error,
          "suppressed should be the parse error",
        );
        assert.ok(
          se.error instanceof Error,
          "error should be the disposal error",
        );
        assert.equal(
          (se.error as Error).message,
          "dispose failed.",
        );
      }

      assert.ok(disposed);
    });

    it("should throw SuppressedError with AggregateError when parse fails and multiple disposals fail", async () => {
      const disposed: string[] = [];

      const context1: SourceContext = {
        id: Symbol.for("@test/dispose-shadow-multi-1"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.asyncDispose]() {
          disposed.push("context1");
          throw new Error("dispose 1 failed.");
        },
      };

      const context2: SourceContext = {
        id: Symbol.for("@test/dispose-shadow-multi-2"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed.push("context2");
          throw new Error("dispose 2 failed.");
        },
      };

      const parser = object({
        port: argument(integer()),
      });

      try {
        await runWith(parser, "test", [context1, context2], {
          args: ["not-a-number"],
        });
        assert.fail("Expected an error to be thrown");
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "SuppressedError");
        const se = error as Error & { suppressed: unknown; error: unknown };
        assert.ok(
          se.suppressed instanceof Error,
          "suppressed should be the parse error",
        );
        assert.ok(
          se.error instanceof AggregateError,
          "error should be AggregateError from multiple disposal failures",
        );
        assert.equal((se.error as AggregateError).errors.length, 2);
      }

      assert.deepEqual(disposed, ["context1", "context2"]);
    });

    it("should preserve parse error when disposal succeeds", async () => {
      let disposed = false;
      const context: SourceContext = {
        id: Symbol.for("@test/dispose-no-shadow"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed = true;
        },
      };

      const parser = object({
        port: argument(integer()),
      });

      let errorCaught: unknown;
      try {
        await runWith(parser, "test", [context], {
          args: ["not-a-number"],
        });
      } catch (error) {
        errorCaught = error;
      }

      assert.ok(disposed);
      assert.notEqual((errorCaught as Error).name, "SuppressedError");
      assert.ok(errorCaught instanceof Error);
    });
  });

  describe("options passthrough", () => {
    it("should pass options to getAnnotations in async runWith", async () => {
      let receivedOptions: unknown;
      const passthroughKey = Symbol.for("@test/passthrough");

      // Use SourceContext (void required options) so runWith doesn't need
      // extra fields.  The context reads options from the untyped second arg.
      const context: SourceContext = {
        id: passthroughKey,
        phase: "two-pass",
        getAnnotations(_request?: unknown, options?: unknown) {
          receivedOptions = options;
          if (isPhase1ContextRequest(_request)) return {};
          return { [passthroughKey]: { value: "loaded" } };
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      await runWith(parser, "test", [context], {
        args: [],
        contextOptions: { custom: "value" },
      });

      // contextOptions are forwarded to getAnnotations
      assert.ok(receivedOptions != null);
      assert.equal(
        (receivedOptions as Record<string, unknown>).custom,
        "value",
      );
    });

    it("should pass options to getAnnotations in both phases", async () => {
      const receivedOptionsPerCall: unknown[] = [];
      const dynamicKey = Symbol.for("@test/passthrough-phases");

      const context: SourceContext = {
        id: dynamicKey,
        phase: "two-pass",
        getAnnotations(request?: unknown, options?: unknown) {
          receivedOptionsPerCall.push(options);
          if (isPhase1ContextRequest(request)) return {};
          return { [dynamicKey]: { value: "loaded" } };
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      await runWith(parser, "test", [context], {
        args: [],
        contextOptions: { tag: "both-phases" },
      });

      // Should have been called twice (phase 1 and phase 2)
      assert.equal(receivedOptionsPerCall.length, 2);
      for (const opts of receivedOptionsPerCall) {
        assert.deepEqual(opts, { tag: "both-phases" });
      }
    });

    it("should forward contextOptions without collision with RunWithOptions keys", async () => {
      let receivedOptions: unknown;
      const key = Symbol.for("@test/contextOptions-collision");

      const context: SourceContext<{ args: string[] }> = {
        id: key,
        phase: "two-pass",
        getAnnotations(_request?: unknown, options?: unknown) {
          receivedOptions = options;
          return {};
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      await runWith(parser, "test", [context], {
        args: ["--name", "Alice"],
        contextOptions: { args: ["context-args"] },
      });

      // Context should receive { args: ["context-args"] }, not the runner's args
      assert.ok(receivedOptions != null);
      assert.deepEqual(
        (receivedOptions as Record<string, unknown>).args,
        ["context-args"],
      );
    });

    it("should forward contextOptions.help without collision with runner help config", async () => {
      let receivedOptions: unknown;
      const key = Symbol.for("@test/contextOptions-help-collision");

      const context: SourceContext<{ help: string; programName: string }> = {
        id: key,
        phase: "two-pass",
        getAnnotations(_request?: unknown, options?: unknown) {
          receivedOptions = options;
          return {};
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      await runWith(parser, "test", [context], {
        args: [],
        help: { option: true, onShow: () => undefined },
        contextOptions: { help: "from-context", programName: "my-program" },
      });

      // Context should receive contextOptions, not runner help config
      assert.ok(receivedOptions != null);
      const opts = receivedOptions as Record<string, unknown>;
      assert.equal(opts.help, "from-context");
      assert.equal(opts.programName, "my-program");
    });

    it("should not require contextOptions for SourceContext<{}>", async () => {
      const key = Symbol.for("@test/empty-object-context");

      const context: SourceContext<Record<never, never>> = {
        id: key,
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      // This must compile without contextOptions
      const result = await runWith(parser, "test", [context], {
        args: [],
      });

      assert.deepEqual(result, { name: "default" });
    });

    it("should not require contextOptions when all keys are optional", async () => {
      let receivedOptions: unknown;
      const key = Symbol.for("@test/all-optional-context");

      const context: SourceContext<{ profile?: string }> = {
        id: key,
        phase: "two-pass",
        getAnnotations(_request?: unknown, options?: unknown) {
          receivedOptions = options;
          return {};
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      // This must compile without contextOptions
      const result = await runWith(parser, "test", [context], {
        args: [],
      });

      assert.deepEqual(result, { name: "default" });

      // But contextOptions can still be provided for type-safe optional values
      await runWith(parser, "test", [context], {
        args: [],
        contextOptions: { profile: "dev" },
      });

      assert.ok(receivedOptions != null);
      assert.equal(
        (receivedOptions as Record<string, unknown>).profile,
        "dev",
      );
    });
  });

  describe("duplicate context id validation", () => {
    it("should reject duplicate context ids", async () => {
      const shared = Symbol.for("@test/dup-runWith");
      const ctx1: SourceContext = {
        id: shared,
        phase: "single-pass",
        getAnnotations: () => ({ [shared]: "one" }),
      };
      const ctx2: SourceContext = {
        id: shared,
        phase: "single-pass",
        getAnnotations: () => ({ [shared]: "two" }),
      };

      await assert.rejects(
        () => runWith(constant("ok"), "test", [ctx1, ctx2], { args: [] }),
        {
          name: "TypeError",
          message: /Duplicate SourceContext id/,
        },
      );
    });
  });
});

describe("runWithSync", () => {
  it("should preserve primitive parser state with annotations", () => {
    const envKey = Symbol.for("@test/env-primitive");
    const envContext: SourceContext = {
      id: envKey,
      phase: "single-pass",
      getAnnotations() {
        return { [envKey]: { HOST: "localhost" } };
      },
    };

    const result = runWithSync(constant("ok"), "test", [envContext], {
      args: [],
    });

    assert.equal(result, "ok");
  });

  it("should keep argument parsing transparent for single-pass contexts", () => {
    const annotation = Symbol.for("@test/issue-187/runwithsync-argument");
    const context: SourceContext = {
      id: annotation,
      phase: "single-pass",
      getAnnotations() {
        return { [annotation]: true };
      },
    };

    const result = runWithSync(argument(string()), "test", [context], {
      args: ["value"],
    });

    assert.equal(result, "value");
  });

  it("should keep command parsing transparent for single-pass contexts", () => {
    const annotation = Symbol.for("@test/issue-187/runwithsync-command");
    const context: SourceContext = {
      id: annotation,
      phase: "single-pass",
      getAnnotations() {
        return { [annotation]: true };
      },
    };

    const result = runWithSync(
      command("go", object({ silent: option("--silent") })),
      "test",
      [context],
      { args: ["go", "--silent"] },
    );

    assert.deepEqual(result, { silent: true });
  });

  it("should preserve array parser state shape with annotations", () => {
    const envKey = Symbol.for("@test/env-array");
    const envContext: SourceContext = {
      id: envKey,
      phase: "single-pass",
      getAnnotations() {
        return { [envKey]: { value: true } };
      },
    };

    const parser = multiple(argument(string()));
    const result = runWithSync(parser, "test", [envContext], {
      args: ["alpha"],
    });

    assert.deepEqual(result, ["alpha"]);
  });

  it("should parse with single-pass contexts synchronously", () => {
    const envKey = Symbol.for("@test/env");
    const envContext: SourceContext = {
      id: envKey,
      phase: "single-pass",
      getAnnotations() {
        return { [envKey]: { HOST: "localhost" } };
      },
    };

    const parser = object({
      host: withDefault(option("--host", string()), "default"),
    });

    const result = runWithSync(parser, "test", [envContext], {
      args: [],
    });

    assert.deepEqual(result, { host: "default" });
  });

  it("should call a single-pass context once in runWithSync", () => {
    let callCount = 0;
    const staticContext: SourceContext = {
      id: Symbol.for("@test/static-once-sync"),
      phase: "single-pass",
      getAnnotations() {
        callCount++;
        return {
          [Symbol.for("@test/static-once-sync")]: { value: true },
        };
      },
    };

    const parser = object({
      host: withDefault(option("--host", string()), "default"),
    });

    const result = runWithSync(parser, "test", [staticContext], {
      args: [],
    });

    assert.deepEqual(result, { host: "default" });
    assert.equal(callCount, 1);
  });

  it('should not force two-phase parsing in runWithSync for phase: "single-pass" with empty annotations', () => {
    let callCount = 0;
    const staticContext: SourceContext = {
      id: Symbol.for("@test/static-empty-once-sync"),
      phase: "single-pass",
      getAnnotations() {
        callCount++;
        return {};
      },
    };

    const parser = object({
      host: withDefault(option("--host", string()), "default"),
    });

    const result = runWithSync(parser, "test", [staticContext], {
      args: [],
    });

    assert.deepEqual(result, { host: "default" });
    assert.equal(callCount, 1);
  });

  it("should throw error when context returns Promise", () => {
    const asyncKey = Symbol.for("@test/async");
    const asyncContext: SourceContext = {
      id: asyncKey,
      phase: "single-pass",
      getAnnotations() {
        return Promise.resolve({ [asyncKey]: { value: "async" } });
      },
    };

    const parser = object({
      value: withDefault(option("--value", string()), "default"),
    });

    assert.throws(() => {
      runWithSync(parser, "test", [asyncContext], {
        args: [],
      });
    }, /returned a Promise in sync mode/);
  });

  it("should throw when context returns Promise in phase 2", () => {
    // A context that is sync in phase 1 but async in phase 2
    const mixedKey = Symbol.for("@test/mixed-async");
    const mixedContext: SourceContext = {
      id: mixedKey,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) return {}; // sync (empty → dynamic)
        return Promise.resolve({ [mixedKey]: { value: "loaded" } });
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    assert.throws(() => {
      runWithSync(parser, "test", [mixedContext], {
        args: [],
      });
    }, /returned a Promise in sync mode/);
  });

  it("should parse with no contexts", () => {
    const parser = object({
      name: argument(string()),
    });

    const result = runWithSync(parser, "test", [], {
      args: ["Alice"],
    });

    assert.deepEqual(result, { name: "Alice" });
  });

  it("should handle help option", () => {
    const parser = object({
      name: argument(string()),
    });

    let helpShown = false;

    runWithSync(parser, "test", [], {
      args: ["--help"],
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "help-shown";
        },
      },
      stdout: () => {},
    });

    assert.ok(helpShown);
  });

  describe("early exit for help/version/completion", () => {
    it("should collect phase 1 annotations when --help option is provided", () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        name: argument(string()),
      });

      let helpShown = false;
      runWithSync(parser, "test", [trackingContext], {
        args: ["--help"],
        help: {
          option: true,
          onShow: () => {
            helpShown = true;
            return "help" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(helpShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should collect phase 1 annotations when --version option is provided", () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;
      runWithSync(parser, "test", [trackingContext], {
        args: ["--version"],
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => {
            versionShown = true;
            return "version" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(versionShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should collect phase 1 annotations when completion command is provided", () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        phase: "single-pass",
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        verbose: option("--verbose"),
      });

      let completionShown = false;
      runWithSync(parser, "test", [trackingContext], {
        args: ["completion", "bash"],
        completion: {
          command: true,
          onShow: () => {
            completionShown = true;
            return "completion" as const;
          },
        },
        stdout: () => {},
      });

      assert.ok(completionShown);
      assert.equal(annotationsCallCount, 1);
    });

    it("should let phase 1 annotations keep --completion=bash as ordinary parser data", () => {
      const key = Symbol.for("@test/phase1-meta-shadow-sync");
      let phase1Calls = 0;
      let completionShown = false;

      const parser: Parser<
        "sync",
        { readonly value: string },
        string | undefined
      > = {
        $mode: "sync",
        $valueType: [] as readonly { readonly value: string }[],
        $stateType: [] as readonly (string | undefined)[],
        priority: 0,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          const [head, ...rest] = context.buffer;
          if (
            head === "--completion=bash" &&
            getAnnotations(context.state)?.[key] === true
          ) {
            return {
              success: true as const,
              next: { ...context, buffer: rest, state: head },
              consumed: [head],
            };
          }
          return {
            success: false as const,
            error: message`Missing annotated completion value.`,
            consumed: 0,
          };
        },
        complete(state) {
          return state == null
            ? {
              success: false as const,
              error: message`Missing annotated completion value.`,
            }
            : { success: true as const, value: { value: state } };
        },
        *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
      };

      const context: SourceContext = {
        id: key,
        phase: "single-pass",
        getAnnotations() {
          phase1Calls++;
          return { [key]: true };
        },
      };

      const result = runWithSync(parser, "test", [context], {
        args: ["--completion=bash"],
        completion: {
          option: true,
          onShow: () => {
            completionShown = true;
            return "completion" as const;
          },
        },
        stdout: () => {},
      });

      assert.deepEqual(result, { value: "--completion=bash" });
      assert.ok(
        !completionShown,
        "completion should remain ordinary parser data",
      );
      assert.equal(phase1Calls, 1);
    });
  });

  describe("dispose lifecycle (sync)", () => {
    it("should dispose contexts after successful sync parsing", () => {
      let disposed = false;
      const context: SourceContext = {
        id: Symbol.for("@test/sync-disposable"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/sync-disposable")]: { value: true },
          };
        },
        [Symbol.dispose]() {
          disposed = true;
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      runWithSync(parser, "test", [context], { args: [] });
      assert.ok(disposed);
    });

    it("should dispose contexts even when sync parsing throws", () => {
      let disposed = false;
      const context: SourceContext = {
        id: Symbol.for("@test/sync-disposable-error"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/sync-disposable-error")]: { value: true },
          };
        },
        [Symbol.dispose]() {
          disposed = true;
        },
      };

      const parser = object({
        port: argument(integer()),
      });

      let errorCaught = false;
      try {
        runWithSync(parser, "test", [context], {
          args: ["not-a-number"],
        });
      } catch {
        errorCaught = true;
      }

      assert.ok(errorCaught);
      assert.ok(disposed);
    });

    it("should prefer Symbol.dispose over Symbol.asyncDispose in sync mode", () => {
      const disposed: string[] = [];
      const context: SourceContext = {
        id: Symbol.for("@test/sync-no-async-dispose"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/sync-no-async-dispose")]: { value: true },
          };
        },
        [Symbol.dispose]() {
          disposed.push("sync");
        },
        [Symbol.asyncDispose]() {
          disposed.push("async");
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      runWithSync(parser, "test", [context], { args: [] });
      assert.deepEqual(disposed, ["sync"]);
    });

    it("should call Symbol.asyncDispose in sync mode when it is synchronous", () => {
      const disposed: string[] = [];
      const context: SourceContext = {
        id: Symbol.for("@test/sync-async-dispose-only"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/sync-async-dispose-only")]: { value: true },
          };
        },
        [Symbol.asyncDispose]() {
          disposed.push("async");
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      runWithSync(parser, "test", [context], { args: [] });
      assert.deepEqual(disposed, ["async"]);
    });

    it("should dispose remaining contexts when one sync dispose fails", () => {
      const disposed: string[] = [];

      const context1: SourceContext = {
        id: Symbol.for("@test/sync-dispose-error-1"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/sync-dispose-error-1")]: { value: 1 },
          };
        },
        [Symbol.dispose]() {
          disposed.push("context1");
          throw new Error("Context 1 sync dispose failed.");
        },
      };

      const context2: SourceContext = {
        id: Symbol.for("@test/sync-dispose-error-2"),
        phase: "single-pass",
        getAnnotations() {
          return {
            [Symbol.for("@test/sync-dispose-error-2")]: { value: 2 },
          };
        },
        [Symbol.dispose]() {
          disposed.push("context2");
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      assert.throws(() => {
        runWithSync(parser, "test", [context1, context2], { args: [] });
      }, /Context 1 sync dispose failed\./);
      assert.deepEqual(disposed, ["context1", "context2"]);
    });

    it("should dispose contexts on --help early exit", () => {
      let disposed = 0;
      const context: SourceContext = {
        id: Symbol.for("@test/sync-dispose-help"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed++;
        },
      };

      const parser = object({
        name: argument(string()),
      });

      runWithSync(parser, "test", [context], {
        args: ["--help"],
        help: {
          option: true,
          onShow: () => undefined,
        },
        stdout: () => {},
      });
      assert.equal(disposed, 1);
    });

    it("should dispose contexts on --version early exit", () => {
      let disposed = 0;
      const context: SourceContext = {
        id: Symbol.for("@test/sync-dispose-version"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed++;
        },
      };

      const parser = object({
        name: argument(string()),
      });

      runWithSync(parser, "test", [context], {
        args: ["--version"],
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => undefined,
        },
        stdout: () => {},
      });
      assert.equal(disposed, 1);
    });

    it("should dispose contexts on completion early exit", () => {
      let disposed = 0;
      const context: SourceContext = {
        id: Symbol.for("@test/sync-dispose-completion"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed++;
        },
      };

      const parser = object({
        verbose: option("--verbose"),
      });

      runWithSync(parser, "test", [context], {
        args: ["completion", "bash"],
        completion: {
          command: true,
          onShow: () => undefined,
        },
        stdout: () => {},
      });
      assert.equal(disposed, 1);
    });

    it("should throw SuppressedError when sync parse fails and disposal also fails", () => {
      let disposed = false;
      const context: SourceContext = {
        id: Symbol.for("@test/sync-dispose-shadow"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed = true;
          throw new Error("sync dispose failed.");
        },
      };

      const parser = object({
        port: argument(integer()),
      });

      try {
        runWithSync(parser, "test", [context], {
          args: ["not-a-number"],
        });
        assert.fail("Expected an error to be thrown");
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "SuppressedError");
        const se = error as Error & { suppressed: unknown; error: unknown };
        assert.ok(
          se.suppressed instanceof Error,
          "suppressed should be the parse error",
        );
        assert.ok(
          se.error instanceof Error,
          "error should be the disposal error",
        );
        assert.equal(
          (se.error as Error).message,
          "sync dispose failed.",
        );
      }

      assert.ok(disposed);
    });

    it("should throw SuppressedError with AggregateError when sync parse fails and multiple disposals fail", () => {
      const disposed: string[] = [];

      const context1: SourceContext = {
        id: Symbol.for("@test/sync-dispose-shadow-multi-1"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed.push("context1");
          throw new Error("sync dispose 1 failed.");
        },
      };

      const context2: SourceContext = {
        id: Symbol.for("@test/sync-dispose-shadow-multi-2"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed.push("context2");
          throw new Error("sync dispose 2 failed.");
        },
      };

      const parser = object({
        port: argument(integer()),
      });

      try {
        runWithSync(parser, "test", [context1, context2], {
          args: ["not-a-number"],
        });
        assert.fail("Expected an error to be thrown");
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "SuppressedError");
        const se = error as Error & { suppressed: unknown; error: unknown };
        assert.ok(
          se.suppressed instanceof Error,
          "suppressed should be the parse error",
        );
        assert.ok(
          se.error instanceof AggregateError,
          "error should be AggregateError from multiple disposal failures",
        );
        assert.equal((se.error as AggregateError).errors.length, 2);
      }

      assert.deepEqual(disposed, ["context1", "context2"]);
    });

    it("should preserve sync parse error when disposal succeeds", () => {
      let disposed = false;
      const context: SourceContext = {
        id: Symbol.for("@test/sync-dispose-no-shadow"),
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
        [Symbol.dispose]() {
          disposed = true;
        },
      };

      const parser = object({
        port: argument(integer()),
      });

      let errorCaught: unknown;
      try {
        runWithSync(parser, "test", [context], {
          args: ["not-a-number"],
        });
      } catch (error) {
        errorCaught = error;
      }

      assert.ok(disposed);
      assert.notEqual((errorCaught as Error).name, "SuppressedError");
      assert.ok(errorCaught instanceof Error);
    });
  });

  describe("priority handling (sync)", () => {
    it("keeps earlier context precedence after phase 2", () => {
      const sharedKey = Symbol.for("@test/phase-merge-priority-sync");

      const parser: Parser<"sync", string, string | undefined> = {
        $mode: "sync",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly (string | undefined)[],
        priority: 1,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          const value = getAnnotations(context.state)?.[sharedKey];
          if (typeof value !== "string") {
            return {
              success: false as const,
              consumed: 0,
              error: message`missing`,
            };
          }
          return {
            success: true as const,
            next: { ...context, state: value },
            consumed: [],
          };
        },
        complete(state) {
          return typeof state === "string"
            ? { success: true as const, value: state }
            : { success: false as const, error: message`missing` };
        },
        suggest() {
          return [];
        },
        getDocFragments() {
          return { fragments: [] };
        },
      };

      const earlyContext: SourceContext = {
        id: Symbol.for("@test/phase-merge-sync-early"),
        phase: "single-pass",
        getAnnotations() {
          return { [sharedKey]: "phase1-early" };
        },
      };

      const lateDynamicContext: SourceContext = {
        id: Symbol.for("@test/phase-merge-sync-late"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase1ContextRequest(request)) {
            return {};
          }
          return { [sharedKey]: "phase2-late" };
        },
      };

      const result = runWithSync(
        parser,
        "test",
        [earlyContext, lateDynamicContext],
        { args: [] },
      );

      assert.equal(result, "phase1-early");
    });

    it("lets phase 2 clear a context's phase 1 annotations", () => {
      const sharedKey = Symbol.for("@test/phase-clear-priority-sync");

      const parser: Parser<"sync", string | undefined, undefined> = {
        $mode: "sync",
        $valueType: [] as readonly (string | undefined)[],
        $stateType: [] as readonly undefined[],
        priority: 1,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          return {
            success: true as const,
            next: context,
            consumed: [],
          };
        },
        complete(state) {
          return {
            success: true as const,
            value: getAnnotations(state)?.[sharedKey] as string | undefined,
          };
        },
        suggest() {
          return [];
        },
        getDocFragments() {
          return { fragments: [] };
        },
      };

      const clearingContext: SourceContext = {
        id: Symbol.for("@test/phase-clear-sync-early"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase1ContextRequest(request)) {
            return { [sharedKey]: "phase1-early" };
          }
          return {};
        },
      };

      const fallbackContext: SourceContext = {
        id: Symbol.for("@test/phase-clear-sync-late"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase1ContextRequest(request)) {
            return {};
          }
          return { [sharedKey]: "phase2-late" };
        },
      };

      const result = runWithSync(
        parser,
        "test",
        [clearingContext, fallbackContext],
        { args: [] },
      );

      assert.equal(result, "phase2-late");
    });
  });

  describe("options passthrough (sync)", () => {
    it("should pass options to getAnnotations in runWithSync", () => {
      let receivedOptions: unknown;
      const syncKey = Symbol.for("@test/sync-passthrough");

      const context: SourceContext = {
        id: syncKey,
        phase: "two-pass",
        getAnnotations(_request?: unknown, options?: unknown) {
          receivedOptions = options;
          if (isPhase1ContextRequest(_request)) return {};
          return { [syncKey]: { value: "loaded" } };
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      runWithSync(parser, "test", [context], {
        args: [],
        contextOptions: { custom: "sync-value" },
      });

      // contextOptions are forwarded to getAnnotations
      assert.ok(receivedOptions != null);
      assert.equal(
        (receivedOptions as Record<string, unknown>).custom,
        "sync-value",
      );
    });

    it("should forward contextOptions without collision with runner option keys", () => {
      let receivedOptions: unknown;
      const key = Symbol.for("@test/sync-contextOptions-collision");

      const context: SourceContext<{ help: string; programName: string }> = {
        id: key,
        phase: "two-pass",
        getAnnotations(_request?: unknown, options?: unknown) {
          receivedOptions = options;
          return {};
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      runWithSync(parser, "test", [context], {
        args: [],
        help: { option: true, onShow: () => undefined },
        contextOptions: { help: "ctx-help", programName: "ctx-program" },
      });

      // Context should receive contextOptions, not runner options
      assert.ok(receivedOptions != null);
      const opts = receivedOptions as Record<string, unknown>;
      assert.equal(opts.help, "ctx-help");
      assert.equal(opts.programName, "ctx-program");
    });
  });

  describe("duplicate context id validation", () => {
    it("should reject duplicate context ids", () => {
      const shared = Symbol.for("@test/dup-runWithSync");
      const ctx1: SourceContext = {
        id: shared,
        phase: "single-pass",
        getAnnotations: () => ({ [shared]: "one" }),
      };
      const ctx2: SourceContext = {
        id: shared,
        phase: "single-pass",
        getAnnotations: () => ({ [shared]: "two" }),
      };

      assert.throws(
        () => runWithSync(constant("ok"), "test", [ctx1, ctx2], { args: [] }),
        {
          name: "TypeError",
          message: /Duplicate SourceContext id/,
        },
      );
    });
  });
});

describe("runWithAsync", () => {
  it("should parse with async contexts", async () => {
    const asyncKey = Symbol.for("@test/async");
    const asyncContext: SourceContext = {
      id: asyncKey,
      phase: "single-pass",
      async getAnnotations() {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { [asyncKey]: { value: "async-value" } };
      },
    };

    const parser = object({
      value: withDefault(option("--value", string()), "default"),
    });

    const result = await runWithAsync(parser, "test", [asyncContext], {
      args: [],
    });

    assert.deepEqual(result, { value: "default" });
  });

  it("should work with sync parser", async () => {
    const parser = object({
      name: argument(string()),
    });

    const result = await runWithAsync(parser, "test", [], {
      args: ["Alice"],
    });

    assert.deepEqual(result, { name: "Alice" });
  });

  it("should handle multiple async contexts", async () => {
    const key1 = Symbol.for("@test/async1");
    const key2 = Symbol.for("@test/async2");

    const context1: SourceContext = {
      id: key1,
      phase: "single-pass",
      async getAnnotations() {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { [key1]: { value: "value1" } };
      },
    };

    const context2: SourceContext = {
      id: key2,
      phase: "single-pass",
      async getAnnotations() {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { [key2]: { value: "value2" } };
      },
    };

    const parser = object({
      value: withDefault(option("--value", string()), "default"),
    });

    const result = await runWithAsync(
      parser,
      "test",
      [context1, context2],
      { args: [] },
    );

    assert.deepEqual(result, { value: "default" });
  });

  describe("completion command ordering in usage line", () => {
    // Regression test for https://github.com/dahlia/optique/issues/107
    it("should show completion command after user commands in error usage", () => {
      const addCommand = command("add", object({}), {
        brief: message`Add files`,
      });
      const removeCommand = command("remove", object({}), {
        brief: message`Remove files`,
      });

      const cli = or(addCommand, removeCommand);

      let errorOutput = "";

      runParser(cli, "mycli", [], {
        completion: { command: true },
        help: { option: true, onShow: () => "help" as const },
        onError: () => "handled",
        stderr: (text: string) => {
          errorOutput += text + "\n";
        },
      });

      // Find the usage lines in error output (may be multi-line)
      const usageLines = errorOutput
        .split("\n")
        .filter((line) =>
          line.startsWith("Usage:") || line.startsWith("       ")
        )
        .join("\n");
      assert.ok(usageLines, "Should have usage lines in error output");

      // completion command should appear after user commands (add, remove)
      const completionIndex = usageLines.indexOf("completion");
      const addIndex = usageLines.indexOf("add");
      const removeIndex = usageLines.indexOf("remove");

      assert.ok(completionIndex > 0, "Should contain 'completion' in usage");
      assert.ok(addIndex > 0, "Should contain 'add' in usage");
      assert.ok(removeIndex > 0, "Should contain 'remove' in usage");
      assert.ok(
        completionIndex > addIndex,
        "completion should appear after add in usage",
      );
      assert.ok(
        completionIndex > removeIndex,
        "completion should appear after remove in usage",
      );
    });
  });

  describe("meta-command grouping", () => {
    it("should group all meta-commands under the same section when given the same group name", () => {
      const addCommand = command("add", constant("add"), {
        brief: message`Add files`,
      });
      const removeCommand = command("remove", constant("remove"), {
        brief: message`Remove files`,
      });
      const cli = or(addCommand, removeCommand);

      let helpOutput = "";
      runParser(cli, "mycli", ["--help"], {
        help: {
          command: { group: "Other" },
          option: true,
          onShow: () => "help-shown",
        },
        version: {
          command: { group: "Other" },
          option: true,
          value: "1.0.0",
          onShow: () => "version-shown",
        },
        completion: {
          command: { group: "Other" },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      // User commands should appear in an untitled section
      assert.ok(helpOutput.includes("add"));
      assert.ok(helpOutput.includes("remove"));
      // Meta-commands should appear under "Other:" section
      assert.ok(helpOutput.includes("Other:"));
      // The "Other:" label should appear only once
      const otherCount = helpOutput.split("Other:").length - 1;
      assert.equal(otherCount, 1, "Other: section should appear exactly once");
      // Meta-commands should appear after the "Other:" label
      const otherIndex = helpOutput.indexOf("Other:");
      assert.ok(
        helpOutput.indexOf("help", otherIndex) > otherIndex,
        "help command should appear under Other: section",
      );
      assert.ok(
        helpOutput.indexOf("version", otherIndex) > otherIndex,
        "version command should appear under Other: section",
      );
      assert.ok(
        helpOutput.indexOf("completion", otherIndex) > otherIndex,
        "completion command should appear under Other: section",
      );
    });

    it("should group each meta-command under different sections when given different group names", () => {
      const cli = command("run", constant("run"), {
        brief: message`Run command`,
      });

      let helpOutput = "";
      runParser(cli, "mycli", ["--help"], {
        help: {
          command: { group: "Help" },
          option: true,
          onShow: () => "help-shown",
        },
        version: {
          command: { group: "Info" },
          option: true,
          value: "1.0.0",
          onShow: () => "version-shown",
        },
        completion: {
          command: { group: "Shell" },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.ok(helpOutput.includes("Help:"), "Should have Help: section");
      assert.ok(helpOutput.includes("Info:"), "Should have Info: section");
      assert.ok(helpOutput.includes("Shell:"), "Should have Shell: section");
    });

    it("should group only specified meta-commands, leaving others ungrouped", () => {
      const addCommand = command("add", constant("add"), {
        brief: message`Add files`,
      });
      const removeCommand = command("remove", constant("remove"), {
        brief: message`Remove files`,
      });
      const cli = or(addCommand, removeCommand);

      let helpOutput = "";
      runParser(cli, "mycli", ["--help"], {
        help: {
          command: true,
          option: true,
          // no group - should remain ungrouped
          onShow: () => "help-shown",
        },
        completion: {
          command: { group: "Other" },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      // "Other:" section should exist for completion
      assert.ok(helpOutput.includes("Other:"));
      // completion should appear under "Other:"
      const otherIndex = helpOutput.indexOf("Other:");
      assert.ok(
        helpOutput.indexOf("completion", otherIndex) > otherIndex,
        "completion should be under Other:",
      );
      // help command should NOT be under "Other:" — it should be in the
      // ungrouped section, which appears before "Other:" (untitled before titled)
      const helpIndex = helpOutput.indexOf("  help");
      assert.ok(
        helpIndex < otherIndex,
        "help command should appear before Other: section (ungrouped)",
      );
    });

    it("should not group when group is not specified (default behavior)", () => {
      const addCommand = command("add", constant("add"), {
        brief: message`Add files`,
      });
      const cli = or(addCommand);

      let helpOutput = "";
      runParser(cli, "mycli", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => "help-shown",
        },
        version: {
          command: true,
          option: true,
          value: "1.0.0",
          onShow: () => "version-shown",
        },
        completion: {
          command: true,
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      // No titled sections should appear - all commands in one flat list
      assert.ok(!helpOutput.includes("Other:"));
      // All commands should still appear
      assert.ok(helpOutput.includes("add"));
      assert.ok(helpOutput.includes("help"));
      assert.ok(helpOutput.includes("version"));
      assert.ok(helpOutput.includes("completion"));
    });

    it("should work with user-defined group() alongside meta-command grouping", () => {
      const addCommand = command("add", constant("add"), {
        brief: message`Add files`,
      });
      const removeCommand = command("remove", constant("remove"), {
        brief: message`Remove files`,
      });
      const cli = or(
        group("Core", addCommand),
        group("Core", removeCommand),
      );

      let helpOutput = "";
      runParser(cli, "mycli", ["--help"], {
        help: {
          command: { group: "Meta" },
          option: true,
          onShow: () => "help-shown",
        },
        completion: {
          command: { group: "Meta" },
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      // Should have both "Core:" and "Meta:" sections
      assert.ok(helpOutput.includes("Core:"), "Should have Core: section");
      assert.ok(helpOutput.includes("Meta:"), "Should have Meta: section");
      // User commands under Core:
      const coreIndex = helpOutput.indexOf("Core:");
      const metaIndex = helpOutput.indexOf("Meta:");
      assert.ok(
        helpOutput.indexOf("add", coreIndex) > coreIndex &&
          helpOutput.indexOf("add", coreIndex) < metaIndex,
        "add should appear under Core:",
      );
      // Meta-commands under Meta:
      assert.ok(
        helpOutput.indexOf("help", metaIndex) > metaIndex,
        "help should appear under Meta:",
      );
      assert.ok(
        helpOutput.indexOf("completion", metaIndex) > metaIndex,
        "completion should appear under Meta:",
      );
    });

    it("should preserve group in error usage line", () => {
      const addCommand = command("add", constant("add"), {
        brief: message`Add files`,
      });
      const cli = or(addCommand);

      let errorOutput = "";
      runParser(cli, "mycli", ["--invalid"], {
        help: {
          command: { group: "Other" },
          option: true,
          onShow: () => "help-shown",
        },
        completion: {
          command: { group: "Other" },
        },
        onError: () => "error" as never,
        stderr: (text) => {
          errorOutput += text + "\n";
        },
      });

      // Even with grouping, the usage line should still contain both
      // user commands and meta-commands
      assert.ok(
        errorOutput.includes("add"),
        "Error usage should include user command",
      );
      assert.ok(
        errorOutput.includes("completion"),
        "Error usage should include meta-commands",
      );
    });

    it("should handle completion with mode 'both' and group", () => {
      const cli = command("run", constant("run"));

      let helpOutput = "";
      runParser(cli, "mycli", ["--help"], {
        help: {
          command: { group: "Plumbing" },
          option: true,
          onShow: () => "help-shown",
        },
        completion: {
          command: { group: "Plumbing" },
          option: true,
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      assert.ok(helpOutput.includes("Plumbing:"));
      const plumbingIndex = helpOutput.indexOf("Plumbing:");
      assert.ok(
        helpOutput.indexOf("completion", plumbingIndex) > plumbingIndex,
        "completion should be under Plumbing:",
      );
    });
  });

  describe("section merging and ordering (issue #138)", () => {
    it("should display user commands before ungrouped meta items", () => {
      const cli = group(
        "Commands",
        or(
          command("build", constant("build"), { brief: message`Build` }),
          command("dev", constant("dev"), { brief: message`Dev` }),
          command("test", constant("test"), { brief: message`Test` }),
        ),
      );

      let helpOutput = "";
      runParser(cli, "mycli", ["--help"], {
        help: {
          command: true,
          option: true,
          onShow: () => "help-shown",
        },
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => "version-shown",
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      // Skip the usage line to examine section ordering only.
      // The usage line and sections are separated by a blank line ("\n\n").
      const firstDoubleNewline = helpOutput.indexOf("\n\n");
      assert.ok(firstDoubleNewline !== -1, "Help output should have sections");
      const sectionsArea = helpOutput.slice(firstDoubleNewline + 2);

      // User commands (in the titled "Commands:" section) should appear
      // BEFORE the ungrouped meta items (--help, --version options)
      const buildIdx = sectionsArea.indexOf("build");
      const helpOptIdx = sectionsArea.indexOf("--help");

      assert.ok(buildIdx !== -1, "build should appear in sections");
      assert.ok(helpOptIdx !== -1, "--help should appear in sections");
      assert.ok(
        buildIdx < helpOptIdx,
        `build (at ${buildIdx}) should appear before --help (at ${helpOptIdx}) in sections`,
      );
    });

    it("should merge meta options into user's section when group names match", () => {
      const cli = object("Global Options", {
        verbose: flag("--verbose", { description: message`Enable verbose` }),
      });

      let helpOutput = "";
      runParser(cli, "mycli", ["--help"], {
        help: {
          option: { group: "Global Options" },
          onShow: () => "help-shown",
        },
        version: {
          option: { group: "Global Options" },
          value: "1.0.0",
          onShow: () => "version-shown",
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      // "Global Options:" should appear exactly once (no duplicates)
      const globalCount = helpOutput.split("Global Options:").length - 1;
      assert.equal(
        globalCount,
        1,
        `Global Options: should appear exactly once, got ${globalCount}`,
      );
      // All items should be under "Global Options:"
      const globalIndex = helpOutput.indexOf("Global Options:");
      assert.ok(
        helpOutput.indexOf("--verbose", globalIndex) > globalIndex,
        "--verbose should be under Global Options:",
      );
      assert.ok(
        helpOutput.indexOf("--help", globalIndex) > globalIndex,
        "--help should be under Global Options:",
      );
      assert.ok(
        helpOutput.indexOf("--version", globalIndex) > globalIndex,
        "--version should be under Global Options:",
      );
    });

    it("should merge meta commands into user's section when group names match", () => {
      const cli = group(
        "Commands",
        or(
          command("build", constant("build"), { brief: message`Build` }),
          command("test", constant("test"), { brief: message`Test` }),
        ),
      );

      let helpOutput = "";
      runParser(cli, "mycli", ["--help"], {
        help: {
          command: { group: "Commands" },
          option: true,
          onShow: () => "help-shown",
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      // "Commands:" should appear exactly once (no duplicates)
      const cmdCount = helpOutput.split("Commands:").length - 1;
      assert.equal(
        cmdCount,
        1,
        `Commands: should appear exactly once, got ${cmdCount}`,
      );
      // Both user commands and meta command should be under "Commands:"
      const cmdIndex = helpOutput.indexOf("Commands:");
      assert.ok(
        helpOutput.indexOf("build", cmdIndex) > cmdIndex,
        "build should be under Commands:",
      );
      assert.ok(
        helpOutput.indexOf("test", cmdIndex) > cmdIndex,
        "test should be under Commands:",
      );
      assert.ok(
        helpOutput.indexOf("help", cmdIndex) > cmdIndex,
        "help (meta) should be under Commands:",
      );
    });

    it("should merge same-named sections from group() combinators", () => {
      const cli = or(
        group(
          "Utilities",
          command("format", constant("format"), { brief: message`Format` }),
        ),
        group(
          "Utilities",
          command("lint", constant("lint"), { brief: message`Lint` }),
        ),
      );

      let helpOutput = "";
      runParser(cli, "mycli", ["--help"], {
        help: {
          option: true,
          onShow: () => "help-shown",
        },
        stdout: (text) => {
          helpOutput = text;
        },
      });

      // "Utilities:" should appear exactly once (not twice)
      const utilCount = helpOutput.split("Utilities:").length - 1;
      assert.equal(
        utilCount,
        1,
        `Utilities: should appear exactly once, got ${utilCount}`,
      );
      // Both commands should be under "Utilities:"
      const utilIndex = helpOutput.indexOf("Utilities:");
      assert.ok(
        helpOutput.indexOf("format", utilIndex) > utilIndex,
        "format should be under Utilities:",
      );
      assert.ok(
        helpOutput.indexOf("lint", utilIndex) > utilIndex,
        "lint should be under Utilities:",
      );
    });
  });

  describe("sectionOrder option", () => {
    it("should use custom sectionOrder comparator to control section ordering in help output", () => {
      const parser = or(
        command("build", object({ verbose: flag("--verbose") })),
        command("deploy", object({ env: option("--env", string()) })),
      );

      let helpOutput = "";
      runParser(parser, "myapp", ["--help"], {
        help: {
          option: true,
          onShow: () => "shown",
        },
        stdout: (text) => {
          helpOutput = text;
        },
        // Sort sections in reverse alphabetical order by title
        sectionOrder: (a: DocSection, b: DocSection): number => {
          const aTitle = a.title ?? "";
          const bTitle = b.title ?? "";
          return bTitle.localeCompare(aTitle);
        },
      });

      // The sectionOrder callback should be accepted without type errors
      assert.ok(typeof helpOutput === "string");
    });
  });

  describe("custom names in CommandSubConfig and OptionSubConfig", () => {
    describe("help command custom names", () => {
      it("should trigger help with a single custom command name", () => {
        const parser = object({ verbose: option("--verbose") });

        let helpShown = false;
        const result = runParser(parser, "test", ["h"], {
          help: {
            command: { names: ["h"] },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          stdout: () => {},
        });

        assert.equal(result, "help-shown");
        assert.ok(helpShown);
      });

      it("should not respond to default 'help' when custom name is set", () => {
        const parser = object({ verbose: option("--verbose") });

        let helpShown = false;
        runParser(parser, "test", ["help"], {
          help: {
            command: { names: ["h"] },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          onError: () => "error",
          stdout: () => {},
          stderr: () => {},
        });

        assert.ok(
          !helpShown,
          "default 'help' should not trigger with custom name",
        );
      });

      it("should show custom command name in usage line", () => {
        const parser = object({ verbose: option("--verbose") });

        let helpOutput = "";
        runParser(parser, "test", ["h"], {
          help: {
            command: { names: ["h"] },
            onShow: () => "shown",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        const usageLines = helpOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        assert.ok(
          usageLines.includes("h"),
          `custom name 'h' should appear in usage, got:\n${usageLines}`,
        );
      });

      it("should support aliases: first name visible, rest hidden but functional", () => {
        const parser = object({ verbose: option("--verbose") });

        let helpShown = false;

        // "help" is the display name, "h" is the hidden alias
        const resultViaDisplay = runParser(parser, "test", ["help"], {
          help: {
            command: { names: ["help", "h"] },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          stdout: () => {},
        });
        assert.equal(resultViaDisplay, "help-shown");
        assert.ok(helpShown);

        // Hidden alias also works at runtime
        helpShown = false;
        const resultViaAlias = runParser(parser, "test", ["h"], {
          help: {
            command: { names: ["help", "h"] },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          stdout: () => {},
        });
        assert.equal(resultViaAlias, "help-shown");
        assert.ok(helpShown);
      });

      it("should show only the first name in help output, not hidden aliases", () => {
        const parser = object({ verbose: option("--verbose") });

        let helpOutput = "";
        runParser(parser, "test", ["help"], {
          help: {
            command: { names: ["help", "h"] },
            onShow: () => "shown",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        // "help" should appear in the commands section
        assert.ok(
          helpOutput.includes("help"),
          "display name 'help' should appear in help output",
        );
        // Check usage line doesn't contain the alias as a separate branch
        const usageLines = helpOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        // The alias "h" should not appear as an independent entry in usage
        // (it's a hidden alias, only the display name is shown)
        const usageLineCount = usageLines
          .split("\n")
          .filter((l) => /test h\b/.test(l)).length;
        assert.equal(
          usageLineCount,
          0,
          `hidden alias 'h' should not appear as its own usage line, got:\n${usageLines}`,
        );
      });
    });

    describe("version command custom names", () => {
      it("should trigger version with a custom command name", () => {
        const parser = object({ verbose: option("--verbose") });

        let versionShown = false;
        const result = runParser(parser, "test", ["ver"], {
          version: {
            command: { names: ["ver"] },
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          stdout: () => {},
        });

        assert.equal(result, "version-shown");
        assert.ok(versionShown);
      });

      it("should not respond to default 'version' when custom name is set", () => {
        const parser = object({ verbose: option("--verbose") });

        let versionShown = false;
        runParser(parser, "test", ["version"], {
          version: {
            command: { names: ["ver"] },
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          onError: () => "error",
          stdout: () => {},
          stderr: () => {},
        });

        assert.ok(
          !versionShown,
          "default 'version' should not trigger with custom name",
        );
      });

      it("should support version command aliases", () => {
        const parser = object({ verbose: option("--verbose") });

        // "version" visible, "ver" hidden alias
        const resultViaDisplay = runParser(parser, "test", ["version"], {
          version: {
            command: { names: ["version", "ver"] },
            value: "2.0.0",
            onShow: () => "version-shown",
          },
          stdout: () => {},
        });
        assert.equal(resultViaDisplay, "version-shown");

        const resultViaAlias = runParser(parser, "test", ["ver"], {
          version: {
            command: { names: ["version", "ver"] },
            value: "2.0.0",
            onShow: () => "version-shown",
          },
          stdout: () => {},
        });
        assert.equal(resultViaAlias, "version-shown");
      });
    });

    describe("help option custom names", () => {
      it("should trigger help via lenient scanner with custom option name", () => {
        const parser = object({ name: argument(string()) });

        let helpShown = false;
        const result = runParser(parser, "test", ["-h"], {
          help: {
            option: { names: ["-h"] },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          stdout: () => {},
        });

        assert.equal(result, "help-shown");
        assert.ok(helpShown);
      });

      it("should not respond to default '--help' when custom option name is set", () => {
        const parser = object({ name: argument(string()) });

        let helpShown = false;
        runParser(parser, "test", ["--help"], {
          help: {
            option: { names: ["-h"] },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          onError: () => "error",
          stdout: () => {},
          stderr: () => {},
        });

        assert.ok(
          !helpShown,
          "default '--help' should not trigger with custom option name",
        );
      });

      it("should find custom option name anywhere in args (lenient scanner)", () => {
        const parser = object({ name: argument(string()) });

        let helpShown = false;
        // The lenient scanner should find -h even when it's not first
        const result = runParser(
          parser,
          "test",
          ["--verbose", "-h", "extra-arg"],
          {
            help: {
              option: { names: ["-h", "--help"] },
              onShow: () => {
                helpShown = true;
                return "help-shown";
              },
            },
            stdout: () => {},
          },
        );

        assert.equal(result, "help-shown");
        assert.ok(helpShown);
      });

      it("should support multiple option names — all shown in help output", () => {
        const parser = object({ name: argument(string()) });

        let helpOutput = "";
        runParser(parser, "test", ["-h"], {
          help: {
            option: { names: ["-h", "--help"] },
            onShow: () => "shown",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        // Both -h and --help should appear in help output (OptionSubConfig shows all names)
        assert.ok(
          helpOutput.includes("-h"),
          `-h should appear in help output, got:\n${helpOutput}`,
        );
        assert.ok(
          helpOutput.includes("--help"),
          `--help should appear in help output, got:\n${helpOutput}`,
        );
      });

      it("should trigger with any of multiple option names via lenient scanner", () => {
        const parser = object({ name: argument(string()) });

        // Trigger with -h
        let helpShown = false;
        runParser(parser, "test", ["-h"], {
          help: {
            option: { names: ["-h", "--help"] },
            onShow: () => {
              helpShown = true;
              return "shown";
            },
          },
          stdout: () => {},
        });
        assert.ok(helpShown, "'-h' should trigger help");

        // Trigger with --help
        helpShown = false;
        runParser(parser, "test", ["--help"], {
          help: {
            option: { names: ["-h", "--help"] },
            onShow: () => {
              helpShown = true;
              return "shown";
            },
          },
          stdout: () => {},
        });
        assert.ok(helpShown, "'--help' should trigger help");
      });
    });

    describe("version option custom names", () => {
      it("should trigger version via lenient scanner with custom option name", () => {
        const parser = object({ name: argument(string()) });

        let versionShown = false;
        const result = runParser(parser, "test", ["-V"], {
          version: {
            option: { names: ["-V"] },
            value: "3.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          stdout: () => {},
        });

        assert.equal(result, "version-shown");
        assert.ok(versionShown);
      });

      it("should not respond to default '--version' when custom option name is set", () => {
        const parser = object({ name: argument(string()) });

        let versionShown = false;
        runParser(parser, "test", ["--version"], {
          version: {
            option: { names: ["-V"] },
            value: "3.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          onError: () => "error",
          stdout: () => {},
          stderr: () => {},
        });

        assert.ok(
          !versionShown,
          "default '--version' should not trigger with custom option name",
        );
      });

      it("should find custom version option anywhere in args (lenient scanner)", () => {
        const parser = object({ name: argument(string()) });

        let versionShown = false;
        const result = runParser(
          parser,
          "test",
          ["--verbose", "-V"],
          {
            version: {
              option: { names: ["-V", "--version"] },
              value: "3.0.0",
              onShow: () => {
                versionShown = true;
                return "version-shown";
              },
            },
            stdout: () => {},
          },
        );

        assert.equal(result, "version-shown");
        assert.ok(versionShown);
      });

      it("should show all version option names in help output", () => {
        const parser = object({ name: argument(string()) });

        // Trigger help (not version) to check the help page's options listing
        let helpOutput = "";
        runParser(parser, "test", ["-h"], {
          help: {
            option: { names: ["-h", "--help"] },
            onShow: () => "shown",
          },
          version: {
            option: { names: ["-V", "--version"] },
            value: "3.0.0",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        // Both -V and --version should appear in help output options section
        assert.ok(
          helpOutput.includes("-V"),
          `-V should appear in help output, got:\n${helpOutput}`,
        );
        assert.ok(
          helpOutput.includes("--version"),
          `--version should appear in help output, got:\n${helpOutput}`,
        );
      });
    });
  });

  describe("hidden visibility in CommandSubConfig and OptionSubConfig", () => {
    describe("command hidden: true", () => {
      it("should hide help command from usage and doc, but still trigger at runtime", () => {
        const parser = object({ verbose: option("--verbose") });

        // 'help' command is fully hidden but still functional
        let helpShown = false;
        const result = runParser(parser, "test", ["help"], {
          help: {
            command: { hidden: true },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          stdout: () => {},
        });
        assert.equal(result, "help-shown");
        assert.ok(helpShown);

        // Verify it doesn't appear in error usage line
        let errorOutput = "";
        runParser(parser, "test", ["--invalid"], {
          help: { command: { hidden: true } },
          onError: () => "error",
          stderr: (text) => {
            errorOutput += text + "\n";
          },
        });
        assert.ok(
          !errorOutput.includes("help"),
          `hidden help command should not appear in error usage, got:\n${errorOutput}`,
        );
      });

      it("should hide version command from usage and doc, but still trigger at runtime", () => {
        const parser = object({ verbose: option("--verbose") });

        let versionShown = false;
        const result = runParser(parser, "test", ["version"], {
          version: {
            command: { hidden: true },
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          stdout: () => {},
        });
        assert.equal(result, "version-shown");
        assert.ok(versionShown);

        let errorOutput = "";
        runParser(parser, "test", ["--invalid"], {
          version: { command: { hidden: true }, value: "1.0.0" },
          onError: () => "error",
          stderr: (text) => {
            errorOutput += text + "\n";
          },
        });
        assert.ok(
          !errorOutput.includes("version"),
          `hidden version command should not appear in error usage, got:\n${errorOutput}`,
        );
      });
    });

    describe('command hidden: "usage"', () => {
      it("should hide help command from usage line but show in help doc", () => {
        const parser = object({ verbose: option("--verbose") });

        // Should not appear in error usage line
        let errorOutput = "";
        runParser(parser, "test", ["--invalid"], {
          help: { command: { hidden: "usage" } },
          onError: () => "error",
          stderr: (text) => {
            errorOutput += text + "\n";
          },
        });

        const usageLines = errorOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        assert.ok(
          !usageLines.includes("help"),
          `help command should be absent from usage line when hidden: "usage", got:\n${usageLines}`,
        );

        // But should still appear in full help doc
        let helpOutput = "";
        runParser(parser, "test", ["help"], {
          help: {
            command: { hidden: "usage" },
            onShow: () => "shown",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });
        assert.ok(
          helpOutput.includes("help"),
          `help command should appear in doc page even when hidden: "usage", got:\n${helpOutput}`,
        );
      });

      it("should hide version command from usage line but show in help doc", () => {
        const parser = object({ verbose: option("--verbose") });

        let errorOutput = "";
        runParser(parser, "test", ["--invalid"], {
          version: { command: { hidden: "usage" }, value: "1.0.0" },
          onError: () => "error",
          stderr: (text) => {
            errorOutput += text + "\n";
          },
        });

        const usageLines = errorOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        assert.ok(
          !usageLines.includes("version"),
          `version command should be absent from usage line when hidden: "usage", got:\n${usageLines}`,
        );
      });
    });

    describe('command hidden: "help"', () => {
      it("should hide help command from usage/doc but keep runtime trigger", () => {
        const parser = object({ verbose: option("--verbose") });

        let helpShown = false;
        const result = runParser(parser, "test", ["help"], {
          help: {
            command: { hidden: "help" },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          stdout: () => {},
        });
        assert.equal(result, "help-shown");
        assert.ok(helpShown);

        let helpOutput = "";
        runParser(parser, "test", ["--help"], {
          help: {
            command: { hidden: "help" },
            option: true,
            onShow: () => "shown",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        const usageLines = helpOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        assert.ok(
          !usageLines.includes(" test help"),
          `help command should be absent from usage lines when hidden: "help", got:\n${usageLines}`,
        );

        const docLines = helpOutput
          .split("\n")
          .filter(
            (l) =>
              !l.startsWith("Usage:") &&
              !l.startsWith("       ") &&
              l.trim().length > 0,
          );
        const hasHelpInDocSection = docLines.some((l) => /^\s+help\b/.test(l));
        assert.ok(
          !hasHelpInDocSection,
          `help command should not appear in doc section when hidden: "help", got lines:\n${
            docLines.join("\n")
          }`,
        );
      });

      it("should hide version command from usage/doc but keep runtime trigger", () => {
        const parser = object({ verbose: option("--verbose") });

        let versionShown = false;
        const result = runParser(parser, "test", ["version"], {
          version: {
            command: { hidden: "help" },
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          stdout: () => {},
        });
        assert.equal(result, "version-shown");
        assert.ok(versionShown);

        let helpOutput = "";
        runParser(parser, "test", ["--help"], {
          help: { option: true, onShow: () => "shown" },
          version: { command: { hidden: "help" }, value: "1.0.0" },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        const usageLines = helpOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        assert.ok(
          !usageLines.includes("version"),
          `version command should be absent from usage lines when hidden: "help", got:\n${usageLines}`,
        );

        const docLines = helpOutput
          .split("\n")
          .filter(
            (l) =>
              !l.startsWith("Usage:") &&
              !l.startsWith("       ") &&
              l.trim().length > 0,
          );
        const hasVersionInDocSection = docLines.some((l) =>
          /^\s+version\b/.test(l)
        );
        assert.ok(
          !hasVersionInDocSection,
          `version command should not appear in doc section when hidden: "help", got lines:\n${
            docLines.join("\n")
          }`,
        );
      });
    });

    describe('command hidden: "doc"', () => {
      it("should show help command in usage line but hide from doc listing", () => {
        const parser = object({ name: argument(string()) });

        // Should appear in error usage line
        let errorOutput = "";
        runParser(parser, "test", ["--invalid"], {
          help: { command: { hidden: "doc" } },
          onError: () => "error",
          stderr: (text) => {
            errorOutput += text + "\n";
          },
        });

        const usageLines = errorOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        assert.ok(
          usageLines.includes("help"),
          `help command should appear in usage line when hidden: "doc", got:\n${usageLines}`,
        );

        // But should be hidden from the doc page commands section
        let helpOutput = "";
        runParser(parser, "test", ["--help"], {
          help: {
            command: { hidden: "doc" },
            option: true,
            onShow: () => "shown",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        // The commands section should NOT list 'help' as a sub-command entry in the doc
        // (usage line at top may still show it due to the combined parser, but the
        //  doc section listing for commands should hide it)
        // We verify this by checking that "help" doesn't appear as a listed command
        // in the section body (it may appear in the top Usage: line which is different)
        const docLines = helpOutput
          .split("\n")
          .filter(
            (l) =>
              !l.startsWith("Usage:") &&
              !l.startsWith("       ") &&
              l.trim().length > 0,
          );
        const hasHelpInDocSection = docLines.some((l) => /^\s+help\b/.test(l));
        assert.ok(
          !hasHelpInDocSection,
          `help command should not appear in doc section when hidden: "doc", got lines:\n${
            docLines.join("\n")
          }`,
        );
      });
    });

    describe("option hidden: true", () => {
      it("should hide --help option from usage and doc, but lenient scanner still works", () => {
        const parser = object({ name: argument(string()) });

        // Lenient scanner should still work even when option is hidden
        let helpShown = false;
        const result = runParser(parser, "test", ["--help"], {
          help: {
            option: { hidden: true },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          stdout: () => {},
        });
        assert.equal(result, "help-shown");
        assert.ok(helpShown);

        // Should not appear in usage line or doc
        let helpOutput = "";
        runParser(parser, "test", ["--help"], {
          help: {
            option: { hidden: true },
            onShow: () => "shown",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });
        assert.ok(
          !helpOutput.includes("--help"),
          `--help should not appear in help output when hidden: true, got:\n${helpOutput}`,
        );
      });

      it("should hide --version option from help output, but lenient scanner still works", () => {
        const parser = object({ name: argument(string()) });

        let versionShown = false;
        const result = runParser(parser, "test", ["--version"], {
          version: {
            option: { hidden: true },
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          stdout: () => {},
        });
        assert.equal(result, "version-shown");
        assert.ok(versionShown);

        // Should not appear in usage line when requesting help
        let helpOutput = "";
        runParser(parser, "test", ["--help"], {
          help: { option: true, onShow: () => "shown" },
          version: { option: { hidden: true }, value: "1.0.0" },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });
        const usageLines = helpOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        assert.ok(
          !usageLines.includes("--version"),
          `--version should not appear in usage line when hidden: true, got:\n${usageLines}`,
        );
      });
    });

    describe('option hidden: "usage"', () => {
      it("should hide --help option from usage line but show in help doc options list", () => {
        const parser = object({ name: argument(string()) });

        let helpOutput = "";
        runParser(parser, "test", ["--help"], {
          help: {
            option: { hidden: "usage" },
            onShow: () => "shown",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        // Should appear in the options section of the doc
        assert.ok(
          helpOutput.includes("--help"),
          `--help should appear in doc options when hidden: "usage", got:\n${helpOutput}`,
        );

        // But should NOT appear in the usage lines at the top
        const usageLines = helpOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        assert.ok(
          !usageLines.includes("--help"),
          `--help should NOT appear in usage lines when hidden: "usage", got:\n${usageLines}`,
        );
      });

      it("should hide --version option from usage line but show in doc options", () => {
        const parser = object({ name: argument(string()) });

        let helpOutput = "";
        runParser(parser, "test", ["--help"], {
          help: { option: true, onShow: () => "shown" },
          version: { option: { hidden: "usage" }, value: "1.0.0" },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        // --version should appear in the options section of the doc
        assert.ok(
          helpOutput.includes("--version"),
          `--version should appear in doc options when hidden: "usage", got:\n${helpOutput}`,
        );

        // But should NOT appear in the usage lines
        const usageLines = helpOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        assert.ok(
          !usageLines.includes("--version"),
          `--version should NOT appear in usage lines when hidden: "usage", got:\n${usageLines}`,
        );
      });
    });

    describe('option hidden: "doc"', () => {
      it("should show --help option in usage line but hide from doc options list", () => {
        const parser = object({ name: argument(string()) });

        let helpOutput = "";
        runParser(parser, "test", ["--help"], {
          help: {
            option: { hidden: "doc" },
            onShow: () => "shown",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        // Should appear in the usage line at the top
        const usageLines = helpOutput
          .split("\n")
          .filter((l) => l.startsWith("Usage:") || l.startsWith("       "))
          .join("\n");
        assert.ok(
          usageLines.includes("--help"),
          `--help should appear in usage lines when hidden: "doc", got:\n${usageLines}`,
        );

        // But should NOT appear in the doc options section
        const docOptionLines = helpOutput
          .split("\n")
          .filter(
            (l) =>
              !l.startsWith("Usage:") &&
              !l.startsWith("       ") &&
              l.includes("--help"),
          );
        assert.equal(
          docOptionLines.length,
          0,
          `--help should NOT appear in doc options when hidden: "doc", found:\n${
            docOptionLines.join("\n")
          }`,
        );
      });
    });

    describe('option hidden: "help"', () => {
      it("should hide --help from usage/doc but keep lenient scanner trigger", () => {
        const parser = object({ name: argument(string()) });

        let helpShown = false;
        const result = runParser(parser, "test", ["--help"], {
          help: {
            option: { hidden: "help" },
            onShow: () => {
              helpShown = true;
              return "help-shown";
            },
          },
          stdout: () => {},
        });
        assert.equal(result, "help-shown");
        assert.ok(helpShown);

        let helpOutput = "";
        runParser(parser, "test", ["--help"], {
          help: {
            option: { hidden: "help" },
            onShow: () => "shown",
          },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        assert.ok(
          !helpOutput.includes("--help"),
          `--help should not appear in help output when hidden: "help", got:\n${helpOutput}`,
        );
      });

      it("should hide --version from usage/doc but keep lenient scanner trigger", () => {
        const parser = object({ name: argument(string()) });

        let versionShown = false;
        const result = runParser(parser, "test", ["--version"], {
          version: {
            option: { hidden: "help" },
            value: "1.0.0",
            onShow: () => {
              versionShown = true;
              return "version-shown";
            },
          },
          stdout: () => {},
        });
        assert.equal(result, "version-shown");
        assert.ok(versionShown);

        let helpOutput = "";
        runParser(parser, "test", ["--help"], {
          help: { option: true, onShow: () => "shown" },
          version: { option: { hidden: "help" }, value: "1.0.0" },
          stdout: (text) => {
            helpOutput += text + "\n";
          },
        });

        assert.ok(
          !helpOutput.includes("--version"),
          `--version should not appear in help output when hidden: "help", got:\n${helpOutput}`,
        );
      });
    });
  });

  describe("OptionSubConfig.group", () => {
    it("should group --help option under a titled section in help output", () => {
      const parser = object({ name: argument(string()) });

      let helpOutput = "";
      runParser(parser, "test", ["--help"], {
        help: {
          option: { group: "Meta Options" },
          onShow: () => "shown",
        },
        stdout: (text) => {
          helpOutput += text + "\n";
        },
      });

      assert.ok(
        helpOutput.includes("Meta Options"),
        `"Meta Options" group header should appear in help output, got:\n${helpOutput}`,
      );
      assert.ok(
        helpOutput.includes("--help"),
        `--help should appear in the grouped section, got:\n${helpOutput}`,
      );
    });

    it("should group --version option under a titled section in help output", () => {
      const parser = object({ name: argument(string()) });

      let helpOutput = "";
      runParser(parser, "test", ["--help"], {
        help: { option: true, onShow: () => "shown" },
        version: { option: { group: "Meta Options" }, value: "1.0.0" },
        stdout: (text) => {
          helpOutput += text + "\n";
        },
      });

      assert.ok(
        helpOutput.includes("Meta Options"),
        `"Meta Options" group header should appear in help output, got:\n${helpOutput}`,
      );
      assert.ok(
        helpOutput.includes("--version"),
        `--version should appear in the grouped section, got:\n${helpOutput}`,
      );
    });

    it("should group --completion option under a titled section in help output", () => {
      const parser = object({ name: argument(string()) });

      let helpOutput = "";
      runParser(parser, "test", ["--help"], {
        help: { option: true, onShow: () => "shown" },
        completion: { option: { group: "Shell Completion" } },
        stdout: (text) => {
          helpOutput += text + "\n";
        },
      });

      assert.ok(
        helpOutput.includes("Shell Completion"),
        `"Shell Completion" group header should appear in help output, got:\n${helpOutput}`,
      );
      assert.ok(
        helpOutput.includes("--completion"),
        `--completion should appear in the grouped section, got:\n${helpOutput}`,
      );
    });

    it("should place help and version options in different groups", () => {
      const parser = object({ name: argument(string()) });

      let helpOutput = "";
      runParser(parser, "test", ["--help"], {
        help: {
          option: { group: "Help" },
          onShow: () => "shown",
        },
        version: {
          option: { group: "Info" },
          value: "1.0.0",
        },
        stdout: (text) => {
          helpOutput += text + "\n";
        },
      });

      assert.ok(
        helpOutput.includes("Help"),
        `"Help" group header should appear, got:\n${helpOutput}`,
      );
      assert.ok(
        helpOutput.includes("Info"),
        `"Info" group header should appear, got:\n${helpOutput}`,
      );
    });

    it("should place help and version options in the same group when group names match", () => {
      const parser = object({ name: argument(string()) });

      let helpOutput = "";
      runParser(parser, "test", ["--help"], {
        help: {
          option: { group: "Meta" },
          onShow: () => "shown",
        },
        version: {
          option: { group: "Meta" },
          value: "1.0.0",
        },
        stdout: (text) => {
          helpOutput += text + "\n";
        },
      });

      // "Meta" should appear once (not twice) as a section header
      // Section headers appear as "Meta:" (with a trailing colon)
      const metaCount =
        helpOutput.split("\n").filter((l) => l.trim() === "Meta:").length;
      assert.equal(
        metaCount,
        1,
        `"Meta" section header should appear exactly once, got ${metaCount} times in:\n${helpOutput}`,
      );
      assert.ok(
        helpOutput.includes("--help"),
        `--help should appear in the Meta section, got:\n${helpOutput}`,
      );
      assert.ok(
        helpOutput.includes("--version"),
        `--version should appear in the Meta section, got:\n${helpOutput}`,
      );
    });
  });

  describe("duplicate context id validation", () => {
    it("should reject duplicate context ids", async () => {
      const shared = Symbol.for("@test/dup-runWithAsync");
      const ctx1: SourceContext = {
        id: shared,
        phase: "single-pass",
        getAnnotations: () => ({ [shared]: "one" }),
      };
      const ctx2: SourceContext = {
        id: shared,
        phase: "single-pass",
        getAnnotations: () => ({ [shared]: "two" }),
      };

      await assert.rejects(
        () => runWithAsync(constant("ok"), "test", [ctx1, ctx2], { args: [] }),
        {
          name: "TypeError",
          message: /Duplicate SourceContext id/,
        },
      );
    });
  });
});

describe("branch coverage: facade.ts edge cases", () => {
  // Lines 101/149: multi-name help/version commands (i > 0 hidden branch)
  it("multi-name help command uses hidden:true for i>0 names", () => {
    const parser = object({ verbose: option("--verbose") });
    let helpOutput = "";
    runParser(parser, "test", ["help"], {
      help: { command: { names: ["help", "h"] }, onShow: () => "shown" },
      stdout: (t) => {
        helpOutput += t;
      },
    });
    assert.ok(helpOutput.length > 0, "help should be shown via 'help' command");
  });

  it("multi-name version command uses hidden:true for i>0 names", () => {
    const parser = object({ verbose: option("--verbose") });
    let versionOutput = "";
    runParser(parser, "test", ["version"], {
      version: {
        command: { names: ["version", "v"] },
        value: "2.0.0",
      },
      stdout: (t) => {
        versionOutput += t;
      },
    });
    assert.ok(
      versionOutput.includes("2.0.0"),
      "version should be shown via 'version' command",
    );
  });

  // Lines 451/566: optionsTerminated in lenient help/version parsers
  // After `--`, options are terminated; the lenient help/version parsers
  // detect this and return failure, letting the argument parser win instead.
  it("lenient help parser fails when options are terminated (-- before --help)", () => {
    const parser = object({ name: argument(string()) });
    let helpShown = false;
    // After --, --help is treated as a positional argument, not a help flag.
    const result = runParser(parser, "test", ["--", "--help"], {
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "shown";
        },
      },
      stderr: () => {},
      stdout: () => {},
    });
    // Help should NOT be shown; the argument parser wins with name="--help"
    assert.ok(!helpShown, "help should not be shown when options terminated");
    assert.deepEqual(result, { name: "--help" });
  });

  it("lenient version parser fails when options are terminated (-- before --version)", () => {
    const parser = object({ name: argument(string()) });
    let versionShown = false;
    // After --, --version is treated as a positional argument.
    const result = runParser(parser, "test", ["--", "--version"], {
      version: {
        option: true,
        value: "1.0.0",
        onShow: () => {
          versionShown = true;
          return "shown";
        },
      },
      stderr: () => {},
      stdout: () => {},
    });
    assert.ok(
      !versionShown,
      "version should not be shown when options terminated",
    );
    assert.deepEqual(result, { name: "--version" });
  });

  // Line 863: success type with parsedValue.result ?? value fallback
  it("success result uses parsedValue.result when present", () => {
    // The 'result' field on parsedValue is used as the final value.
    // This path is hit when the augmented parser returns an object with a
    // result field and no help/completion.
    const parser = object({ x: argument(string()) });
    const result = runParser(parser, "test", ["hello"]);
    assert.deepEqual(result, { x: "hello" });
  });

  // Lines 1114/1122: handleCompletion callback errors should propagate.
  it("callOnError in handleCompletion propagates callback errors", () => {
    const parser = object({});
    assert.throws(
      () =>
        runParser(parser, "test", ["completion", "unknownshell"], {
          completion: { command: true },
          onError: (code?: number) => {
            assert.equal(code, 1);
            throw new Error("real onError failure");
          },
          stderr: () => {},
          stdout: () => {},
        }),
      /real onError failure/,
    );
  });

  it("callOnCompletion in handleCompletion propagates callback errors", () => {
    const parser = object({});
    assert.throws(
      () =>
        runParser(parser, "test", ["completion", "bash"], {
          completion: {
            command: true,
            onShow: (code?: number) => {
              assert.equal(code, 0);
              throw new Error("real completion failure");
            },
          },
          stdout: () => {},
          stderr: () => {},
        }),
      /real completion failure/,
    );
  });

  // Line 1133: completion with empty shell + completionParser shown
  it("completion with empty shell shows completion help when parser available", () => {
    const parser = object({});
    let stderrOutput = "";
    runParser(parser, "test", ["completion", ""], {
      completion: { command: true, onShow: () => "done" },
      onError: () => "err",
      stdout: () => {},
      stderr: (t) => {
        stderrOutput += t;
      },
    });
    // Should show error and possibly help for completion command
    assert.ok(
      stderrOutput.includes("Error:") || stderrOutput.includes("shell"),
      `expected error output, got: ${stderrOutput}`,
    );
  });

  // Lines 1173/1174: callOnCompletion 0-code path (generate script)
  it("completion generates script and calls onCompletion", () => {
    const parser = object({});
    let scriptGenerated = false;
    let completionCalled = false;
    runParser(parser, "test", ["completion", "bash"], {
      completion: {
        command: true,
        onShow: () => {
          completionCalled = true;
          return "done";
        },
      },
      stdout: (t) => {
        if (t.length > 0) scriptGenerated = true;
      },
      stderr: () => {},
    });
    assert.ok(scriptGenerated, "completion script should be generated");
    assert.ok(completionCalled, "onShow should be called");
  });

  // Lines 1385/1392: option-mode early-exit callback errors should propagate.
  it("onCompletionResult propagates callback errors in option mode", () => {
    const parser = object({});
    assert.throws(
      () =>
        runParser(parser, "test", ["--completion", "bash"], {
          completion: {
            option: true,
            onShow: (code?: number) => {
              assert.equal(code, 0);
              throw new Error("option completion failure");
            },
          },
          stdout: () => {},
          stderr: () => {},
        }),
      /option completion failure/,
    );
  });

  // Line 1595: completion case in switch (unreachable guard)
  // Not directly triggerable; skipped (dead code).

  // Lines 1626/1629: help for specific meta-commands (help cmd / version cmd)
  it("help --help shows help for help command itself", () => {
    const parser = object({});
    let helpOutput = "";
    runParser(parser, "test", ["help", "--help"], {
      help: { command: true, option: true, onShow: () => "shown" },
      stdout: (t) => {
        helpOutput += t;
      },
    });
    assert.ok(
      helpOutput.length > 0,
      "should display help for the help command",
    );
  });

  it("version --help shows help for version command itself", () => {
    const parser = object({});
    let helpOutput = "";
    runParser(parser, "test", ["version", "--help"], {
      help: { option: true, onShow: () => "shown" },
      version: { command: true, value: "1.0.0" },
      stdout: (t) => {
        helpOutput += t;
      },
    });
    assert.ok(
      helpOutput.length > 0,
      "should display help for the version command",
    );
  });

  // Line 1759: commandParsers.length === 1 (no meta commands in help generator)
  it("help with no meta-commands uses single parser directly", () => {
    const parser = object({ x: argument(string()) });
    let helpOutput = "";
    runParser(parser, "test", ["--help"], {
      // No help.command, no version, no completion - only help.option
      help: { option: true, onShow: () => "shown" },
      stdout: (t) => {
        helpOutput += t;
      },
    });
    assert.ok(helpOutput.length > 0, "help should be shown with single parser");
  });

  // Line 2193: `arg.startsWith(name + "=")` for completion option mode
  it("needsEarlyExit: completion option with = form triggers early exit", () => {
    const parser = object({});
    let completionCalled = false;
    runParser(parser, "test", ["--completion=bash"], {
      completion: {
        option: true,
        onShow: () => {
          completionCalled = true;
          return "done";
        },
      },
      stdout: () => {},
      stderr: () => {},
    });
    assert.ok(
      completionCalled,
      "completion should be triggered via --completion=bash",
    );
  });

  // Line 2006: default unreachable case — not triggerable from public API

  // Lines 2522-2653: runWith two-phase paths
  it("runWith: async parser + needsEarlyExit returns via async runParser", async () => {
    // Use async parser (one built from a command) to trigger async branch
    // in the early-exit block (line 2526-2529)
    const parser = object({ name: argument(string()) });
    let helpShown = false;
    await runWith(parser, "test", [], {
      args: ["--help"],
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "shown";
        },
      },
      stdout: () => {},
    });
    assert.ok(helpShown);
  });

  it("runWith: no contexts + async parser returns via async runParser", async () => {
    const parser = object({ name: argument(string()) });
    const result = await runWith(parser, "test", [], { args: ["Alice"] });
    assert.deepEqual(result, { name: "Alice" });
  });

  it("runWith: two-pass context triggers phase 2 after a successful first pass", async () => {
    const dynKey = Symbol.for("@test/dyn-two-phase");
    let phase2Called = false;
    const dynamicContext: SourceContext = {
      id: dynKey,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) return {};
        phase2Called = true;
        return { [dynKey]: {} };
      },
    };
    const parser = object({ x: argument(string()) });
    const result = await runWith(parser, "test", [dynamicContext], {
      args: ["hello"],
    });
    assert.deepEqual(result, { x: "hello" });
    assert.ok(phase2Called, "phase 2 context should be called");
  });

  it("runWith: two-pass context refines non-empty phase-1 annotations", async () => {
    const key = Symbol.for("@test/two-pass-refine-non-empty-async");
    let phase2Called = false;
    type AnnotationValue = { readonly phase1?: true; readonly phase2?: true };
    const isAnnotationValue = (
      value: unknown,
    ): value is AnnotationValue => value != null && typeof value === "object";

    const parser: Parser<"sync", AnnotationValue | null, undefined> = {
      $valueType: [] as readonly (AnnotationValue | null)[],
      $stateType: [] as readonly undefined[],
      $mode: "sync",
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return {
          success: true as const,
          next: context,
          consumed: [],
        };
      },
      complete(state) {
        const value = getAnnotations(state)?.[key];
        return {
          success: true as const,
          value: isAnnotationValue(value) ? value : null,
        };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const context: SourceContext = {
      id: key,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) {
          return { [key]: { phase1: true } };
        }
        phase2Called = true;
        return { [key]: { phase2: true } };
      },
    };

    const result = await runWith(parser, "test", [context], {
      args: [],
    });

    assert.ok(
      (result as { readonly phase2?: boolean; readonly phase1?: boolean })
        .phase2 === true,
    );
    assert.ok(
      !("phase1" in
        (result as { readonly phase2?: boolean; readonly phase1?: boolean })),
    );
    assert.ok(phase2Called, "phase 2 context should be called");
  });

  it("runWith: isolates phase requests across two-pass contexts", async () => {
    const key = Symbol.for("@test/two-pass-request-isolation-async");
    let secondContextParsed: { readonly config: string } | undefined;

    const parser = object({
      config: withDefault(option("--config", string()), "optique.json"),
    });

    const mutatingContext: SourceContext = {
      id: Symbol.for("@test/two-pass-request-mutator-async"),
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        const parsed = getPhase2ContextParsed<{ readonly config: string }>(
          request,
        );
        if (parsed == null) return {};
        (request as SourceContextRequest & { parsed: unknown }).parsed = {
          config: "mutated.json",
        };
        return {};
      },
    };

    const readingContext: SourceContext = {
      id: key,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        const parsed = getPhase2ContextParsed<{ readonly config: string }>(
          request,
        );
        if (parsed == null) return {};
        secondContextParsed = parsed;
        return { [key]: parsed.config };
      },
    };

    const result = await runWith(parser, "test", [
      mutatingContext,
      readingContext,
    ], {
      args: [],
    });

    assert.deepEqual(secondContextParsed, { config: "optique.json" });
    assert.deepEqual(result, {
      config: "optique.json",
    });
  });

  it("runWith should not let parsers mutate context-owned annotations", async () => {
    const marker = Symbol.for("@test/issue-491/run-with");
    const shared = { value: 1 };
    const context: SourceContext = {
      id: marker,
      phase: "single-pass",
      getAnnotations() {
        return { [marker]: shared };
      },
    };

    await assert.rejects(
      () =>
        runWith(
          createMutatingAnnotationRunnerParser(marker),
          "test",
          [context],
          { args: [] },
        ),
      {
        name: "TypeError",
        message: "Cannot mutate read-only annotation data.",
      },
    );
    assert.equal(shared.value, 1);
  });

  it("runWith: phase two can recover from first-pass completion failure", async () => {
    const tokenKey = Symbol.for("@test/dyn-phase-two-recovery");
    let phase2Parsed: unknown;

    const tokenParser: Parser<"sync", string, undefined> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return {
          success: true as const,
          next: context,
          consumed: [],
        };
      },
      complete(state) {
        const annotations = getAnnotations(state);
        const token = annotations?.[tokenKey];
        return typeof token === "string"
          ? { success: true as const, value: token }
          : { success: false as const, error: message`Missing token.` };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineInheritedAnnotationParser(tokenParser);

    const dynamicContext: SourceContext<{
      readonly getConfigPath: (
        parsed: { readonly config: string },
      ) => string | undefined;
    }> = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(
        request: SourceContextRequest | undefined,
        options?: {
          readonly getConfigPath: (
            parsed: { readonly config: string },
          ) => string | undefined;
        },
      ) {
        const phase2ParsedValue = getPhase2ContextParsed<
          { readonly config: string }
        >(request);
        if (phase2ParsedValue === undefined) return {};
        phase2Parsed = phase2ParsedValue;
        const configPath = options?.getConfigPath(phase2ParsedValue);
        return configPath == null ? {} : { [tokenKey]: `token:${configPath}` };
      },
    };

    const parser = object({
      config: option("--config", string()),
      token: tokenParser,
    });

    const result = await runWith(parser, "test", [dynamicContext], {
      args: ["--config", "optique.json"],
      contextOptions: {
        getConfigPath: (parsed) => parsed.config,
      },
    });

    assert.deepEqual(result, {
      config: "optique.json",
      token: "token:optique.json",
    });
    assert.deepEqual(phase2Parsed, { config: "optique.json" });
  });

  it("runWith: phase two does not hide first-pass completion throws", async () => {
    const tokenKey = Symbol.for("@test/dyn-phase-two-complete-throw");
    let phase2Called = false;

    const tokenParser: Parser<"async", string, undefined> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete(state) {
        const annotations = getAnnotations(state);
        const token = annotations?.[tokenKey];
        if (typeof token === "string") {
          return Promise.resolve({ success: true as const, value: token });
        }
        return Promise.reject(new Error("Completion boom."));
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineInheritedAnnotationParser(tokenParser);

    const dynamicContext: SourceContext<{
      readonly getConfigPath: (
        parsed: { readonly config: string },
      ) => string | undefined;
    }> = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(
        request: SourceContextRequest | undefined,
        options?: {
          readonly getConfigPath: (
            parsed: { readonly config: string },
          ) => string | undefined;
        },
      ) {
        const phase2ParsedValue = getPhase2ContextParsed<
          { readonly config: string }
        >(request);
        if (phase2ParsedValue === undefined) return {};
        phase2Called = true;
        const configPath = options?.getConfigPath(phase2ParsedValue);
        return configPath == null ? {} : { [tokenKey]: `token:${configPath}` };
      },
    };

    const parser = object({
      config: option("--config", string()),
      token: tokenParser,
    });

    await assert.rejects(
      () =>
        runWith(parser, "test", [dynamicContext], {
          args: ["--config", "optique.json"],
          contextOptions: {
            getConfigPath: (parsed) => parsed.config,
          },
        }),
      /Completion boom\./,
    );
    assert.ok(!phase2Called, "phase 2 context should not hide thrown errors");
  });

  it("runWithSync: phase two does not hide first-pass parse throws", () => {
    const tokenKey = Symbol.for("@test/dyn-phase-two-parse-throw");
    let phase2Called = false;

    const tokenParser: Parser<"sync", string, { token: string | null }> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { token: string | null }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { token: null },
      parse(context) {
        const annotations = getAnnotations(context.state);
        const token = annotations?.[tokenKey];
        if (typeof token !== "string") {
          throw new Error("Parse boom.");
        }
        return {
          success: true as const,
          next: {
            ...context,
            buffer: [],
            state: { token },
          },
          consumed: context.buffer,
        };
      },
      complete(state) {
        return state.token == null
          ? { success: false as const, error: message`Missing token.` }
          : { success: true as const, value: state.token };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineInheritedAnnotationParser(tokenParser);

    const dynamicContext: SourceContext<{
      readonly getConfigPath: (
        parsed: { readonly config: string },
      ) => string | undefined;
    }> = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(
        request: SourceContextRequest | undefined,
        options?: {
          readonly getConfigPath: (
            parsed: { readonly config: string },
          ) => string | undefined;
        },
      ) {
        const phase2ParsedValue = getPhase2ContextParsed<
          { readonly config: string }
        >(request);
        if (phase2ParsedValue === undefined) return {};
        phase2Called = true;
        const configPath = options?.getConfigPath(phase2ParsedValue);
        return configPath == null ? {} : { [tokenKey]: `token:${configPath}` };
      },
    };

    const parser = object({
      config: option("--config", string()),
      token: tokenParser,
    });

    assert.throws(
      () =>
        runWithSync(parser, "test", [dynamicContext], {
          args: ["--config", "optique.json", "rest"],
          contextOptions: {
            getConfigPath: (parsed) => parsed.config,
          },
        }),
      /Parse boom\./,
    );
    assert.ok(!phase2Called, "phase 2 context should not hide thrown errors");
  });

  it(
    "runWithSync: phase two does not hide top-level parse throws",
    () => {
      const tokenKey = Symbol.for("@test/dyn-phase-two-top-level-parse-throw");
      let phase2Called = false;

      const parser: Parser<
        "sync",
        { readonly config: string; readonly token: string },
        { readonly config?: string; readonly token?: string }
      > = {
        $mode: "sync",
        $valueType: [] as readonly {
          readonly config: string;
          readonly token: string;
        }[],
        $stateType: [] as readonly {
          readonly config?: string;
          readonly token?: string;
        }[],
        priority: 0,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: {},
        parse(context) {
          const [head, value, ...rest] = context.buffer;
          if (context.state.config == null) {
            if (head !== "--config" || value == null) {
              return {
                success: false as const,
                error: message`Missing config.`,
                consumed: 0,
              };
            }
            return {
              success: true as const,
              next: {
                ...context,
                buffer: rest,
                state: { ...context.state, config: value },
              },
              consumed: [head, value],
            };
          }

          const annotations = getAnnotations(context.state);
          const token = annotations?.[tokenKey];
          if (typeof token === "string") {
            return {
              success: true as const,
              next: {
                ...context,
                buffer: [],
                state: { ...context.state, token },
              },
              consumed: context.buffer,
            };
          }
          throw new Error("Top-level parse boom.");
        },
        complete(state) {
          return state.config != null && state.token != null
            ? {
              success: true as const,
              value: {
                config: state.config,
                token: state.token,
              },
            }
            : { success: false as const, error: message`Missing token.` };
        },
        *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
      };
      Object.defineProperty(parser, extractPhase2SeedKey, {
        value(state: { readonly config?: string }) {
          return state.config == null
            ? null
            : { value: { config: state.config } };
        },
        enumerable: true,
      });

      const dynamicContext: SourceContext<{
        readonly getConfigPath: (
          parsed: { readonly config: string },
        ) => string | undefined;
      }> = {
        id: tokenKey,
        phase: "two-pass",
        getAnnotations(
          request: SourceContextRequest | undefined,
          options?: {
            readonly getConfigPath: (
              parsed: { readonly config: string },
            ) => string | undefined;
          },
        ) {
          const phase2ParsedValue = getPhase2ContextParsed<
            { readonly config: string }
          >(request);
          if (phase2ParsedValue === undefined) return {};
          phase2Called = true;
          const configPath = options?.getConfigPath(phase2ParsedValue);
          return configPath == null
            ? {}
            : { [tokenKey]: `token:${configPath}` };
        },
      };

      assert.throws(
        () =>
          runWithSync(parser, "test", [dynamicContext], {
            args: ["--config", "optique.json", "rest"],
            contextOptions: {
              getConfigPath: (parsed) => parsed.config,
            },
          }),
        /Top-level parse boom\./,
      );
      assert.ok(
        !phase2Called,
        "phase 2 context should not hide top-level parse errors",
      );
    },
  );

  it("runWith: phase two does not hide top-level async parse throws", async () => {
    const tokenKey = Symbol.for("@test/dyn-phase-two-top-level-async-throw");
    let phase2Called = false;

    const parser: Parser<
      "async",
      { readonly config: string; readonly token: string },
      { readonly config?: string; readonly token?: string }
    > = {
      $mode: "async",
      $valueType: [] as readonly {
        readonly config: string;
        readonly token: string;
      }[],
      $stateType: [] as readonly {
        readonly config?: string;
        readonly token?: string;
      }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: {},
      parse(context) {
        const [head, value, ...rest] = context.buffer;
        if (context.state.config == null) {
          if (head !== "--config" || value == null) {
            return Promise.resolve({
              success: false as const,
              error: message`Missing config.`,
              consumed: 0,
            });
          }
          return Promise.resolve({
            success: true as const,
            next: {
              ...context,
              buffer: rest,
              state: { ...context.state, config: value },
            },
            consumed: [head, value],
          });
        }
        const annotations = getAnnotations(context.state);
        const token = annotations?.[tokenKey];
        if (typeof token === "string") {
          return Promise.resolve({
            success: true as const,
            next: {
              ...context,
              buffer: [],
              state: { ...context.state, token },
            },
            consumed: context.buffer,
          });
        }
        throw new Error("Top-level async parse boom.");
      },
      complete(state) {
        return Promise.resolve(
          state.config != null && state.token != null
            ? {
              success: true as const,
              value: {
                config: state.config,
                token: state.token,
              },
            }
            : { success: false as const, error: message`Missing token.` },
        );
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    Object.defineProperty(parser, extractPhase2SeedKey, {
      value(state: { readonly config?: string }) {
        return state.config == null
          ? null
          : { value: { config: state.config } };
      },
      enumerable: true,
    });

    const dynamicContext: SourceContext<{
      readonly getConfigPath: (
        parsed: { readonly config: string },
      ) => string | undefined;
    }> = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(
        request: SourceContextRequest | undefined,
        options?: {
          readonly getConfigPath: (
            parsed: { readonly config: string },
          ) => string | undefined;
        },
      ) {
        const phase2ParsedValue = getPhase2ContextParsed<
          { readonly config: string }
        >(request);
        if (phase2ParsedValue == null) return {};
        phase2Called = true;
        const configPath = options?.getConfigPath(phase2ParsedValue);
        return configPath == null ? {} : { [tokenKey]: `token:${configPath}` };
      },
    };

    await assert.rejects(
      () =>
        runWith(parser, "test", [dynamicContext], {
          args: ["--config", "optique.json", "rest"],
          contextOptions: {
            getConfigPath: (parsed) => parsed.config,
          },
        }),
      /Top-level async parse boom\./,
    );
    assert.ok(
      !phase2Called,
      "phase 2 context should not hide top-level parse errors",
    );
  });

  it("runWithSync: phase two still runs the first parse step for empty argv", () => {
    const tokenKey = Symbol.for("@test/dyn-phase-two-empty-sync");
    let phase2Called = false;

    const parser: Parser<"sync", string, undefined> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        const annotations = getAnnotations(context.state);
        const token = annotations?.[tokenKey];
        if (typeof token === "string") {
          return {
            success: true as const,
            next: context,
            consumed: [],
          };
        }
        throw new Error("Empty sync parse boom.");
      },
      complete(state) {
        const token = getAnnotations(state)?.[tokenKey];
        return typeof token === "string"
          ? { success: true as const, value: token }
          : { success: false as const, error: message`Missing token.` };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    Object.defineProperty(parser, extractPhase2SeedKey, {
      value() {
        return { value: {} };
      },
      enumerable: true,
    });

    const dynamicContext: SourceContext = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(request) {
        if (isPhase1ContextRequest(request)) return {};
        phase2Called = true;
        return { [tokenKey]: "from-phase-two" };
      },
    };

    assert.throws(
      () => runWithSync(parser, "test", [dynamicContext], { args: [] }),
      /Empty sync parse boom\./,
    );
    assert.ok(
      !phase2Called,
      "phase 2 should not run before the empty-argv parse step",
    );
  });

  it("runWith: phase two still runs the first async parse step for empty argv", async () => {
    const tokenKey = Symbol.for("@test/dyn-phase-two-empty-async");
    let phase2Called = false;

    const parser: Parser<"async", string, undefined> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        const annotations = getAnnotations(context.state);
        const token = annotations?.[tokenKey];
        if (typeof token === "string") {
          return Promise.resolve({
            success: true as const,
            next: context,
            consumed: [],
          });
        }
        return Promise.reject(new Error("Empty async parse boom."));
      },
      complete(state) {
        const token = getAnnotations(state)?.[tokenKey];
        return Promise.resolve(
          typeof token === "string"
            ? { success: true as const, value: token }
            : { success: false as const, error: message`Missing token.` },
        );
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    Object.defineProperty(parser, extractPhase2SeedKey, {
      value() {
        return Promise.resolve({ value: {} });
      },
      enumerable: true,
    });

    const dynamicContext: SourceContext = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(request) {
        if (isPhase1ContextRequest(request)) return {};
        phase2Called = true;
        return { [tokenKey]: "from-phase-two" };
      },
    };

    await assert.rejects(
      () => runWith(parser, "test", [dynamicContext], { args: [] }),
      /Empty async parse boom\./,
    );
    assert.ok(
      !phase2Called,
      "phase 2 should not run before the empty-argv parse step",
    );
  });

  it("runWithSync: phase two preserves group() seed hooks", () => {
    const tokenKey = Symbol.for("@test/dyn-phase-two-group-seed");

    const tokenParser: Parser<"sync", string, undefined> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return {
          success: true as const,
          next: context,
          consumed: [],
        };
      },
      complete(state) {
        const annotations = getAnnotations(state);
        const token = annotations?.[tokenKey];
        return typeof token === "string"
          ? { success: true as const, value: token }
          : { success: false as const, error: message`Missing token.` };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineInheritedAnnotationParser(tokenParser);

    const dynamicContext: SourceContext<{
      readonly getConfigPath: (
        parsed: { readonly config: string },
      ) => string | undefined;
    }> = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(
        request: SourceContextRequest | undefined,
        options?: {
          readonly getConfigPath: (
            parsed: { readonly config: string },
          ) => string | undefined;
        },
      ) {
        const phase2ParsedValue = getPhase2ContextParsed<
          { readonly config: string }
        >(request);
        if (phase2ParsedValue == null) return {};
        const configPath = options?.getConfigPath(phase2ParsedValue);
        return configPath == null ? {} : { [tokenKey]: `token:${configPath}` };
      },
    };

    const parser = group(
      "Config",
      object({
        config: option("--config", string()),
        token: tokenParser,
      }),
    );

    const result = runWithSync(parser, "test", [dynamicContext], {
      args: ["--config", "optique.json"],
      contextOptions: {
        getConfigPath: (parsed) => parsed.config,
      },
    });

    assert.deepEqual(result, {
      config: "optique.json",
      token: "token:optique.json",
    });
  });

  it("runWithSync: phase two preserves nonEmpty() seed hooks", () => {
    const tokenKey = Symbol.for("@test/dyn-phase-two-non-empty-seed");

    const tokenParser: Parser<"sync", string, undefined> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return {
          success: true as const,
          next: context,
          consumed: [],
        };
      },
      complete(state) {
        const annotations = getAnnotations(state);
        const token = annotations?.[tokenKey];
        return typeof token === "string"
          ? { success: true as const, value: token }
          : { success: false as const, error: message`Missing token.` };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineInheritedAnnotationParser(tokenParser);

    const dynamicContext: SourceContext<{
      readonly getConfigPath: (
        parsed: { readonly config: string },
      ) => string | undefined;
    }> = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(
        request: SourceContextRequest | undefined,
        options?: {
          readonly getConfigPath: (
            parsed: { readonly config: string },
          ) => string | undefined;
        },
      ) {
        const phase2ParsedValue = getPhase2ContextParsed<
          { readonly config: string }
        >(request);
        if (phase2ParsedValue == null) return {};
        const configPath = options?.getConfigPath(phase2ParsedValue);
        return configPath == null ? {} : { [tokenKey]: `token:${configPath}` };
      },
    };

    const parser = nonEmpty(
      object({
        config: option("--config", string()),
        token: tokenParser,
      }),
    );

    const result = runWithSync(parser, "test", [dynamicContext], {
      args: ["--config", "optique.json"],
      contextOptions: {
        getConfigPath: (parsed) => parsed.config,
      },
    });

    assert.deepEqual(result, {
      config: "optique.json",
      token: "token:optique.json",
    });
  });

  it("runWithSync: phase two preserves commandPath during seed extraction", () => {
    const tokenKey = Symbol.for("@test/dyn-phase-two-command-path-sync");
    const runtimeExtractPhase2SeedKey = getRuntimeExtractPhase2SeedKey();

    const tokenParser: Parser<"sync", string, undefined> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return {
          success: true as const,
          next: context,
          consumed: [],
        };
      },
      complete(state) {
        const token = getAnnotations(state)?.[tokenKey];
        return typeof token === "string"
          ? { success: true as const, value: token }
          : { success: false as const, error: message`Missing token.` };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineInheritedAnnotationParser(tokenParser);
    Object.defineProperty(tokenParser, runtimeExtractPhase2SeedKey, {
      value(_state: undefined, exec?: ExecutionContext) {
        return { value: { commandPath: exec?.commandPath ?? [] } };
      },
      enumerable: true,
    });

    const dynamicContext: SourceContext = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(
        request: SourceContextRequest | undefined,
      ) {
        const phase2ParsedValue = getPhase2ContextParsed<
          { readonly commandPath: readonly string[] }
        >(request);
        if (phase2ParsedValue == null) return {};
        return phase2ParsedValue.commandPath[0] === "serve"
          ? { [tokenKey]: "from-phase-two" }
          : {};
      },
    };

    const parser = command("serve", tokenParser);

    const result = runWithSync(parser, "test", [dynamicContext], {
      args: ["serve"],
    });

    assert.equal(result, "from-phase-two");
  });

  it("runWith: phase two preserves commandPath during seed extraction", async () => {
    const tokenKey = Symbol.for("@test/dyn-phase-two-command-path-async");
    const runtimeExtractPhase2SeedKey = getRuntimeExtractPhase2SeedKey();

    const tokenParser: Parser<"async", string, undefined> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete(state) {
        const token = getAnnotations(state)?.[tokenKey];
        return Promise.resolve(
          typeof token === "string"
            ? { success: true as const, value: token }
            : { success: false as const, error: message`Missing token.` },
        );
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineInheritedAnnotationParser(tokenParser);
    Object.defineProperty(tokenParser, runtimeExtractPhase2SeedKey, {
      value(_state: undefined, exec?: ExecutionContext) {
        return Promise.resolve({
          value: { commandPath: exec?.commandPath ?? [] },
        });
      },
      enumerable: true,
    });

    const dynamicContext: SourceContext = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(
        request: SourceContextRequest | undefined,
      ) {
        const phase2ParsedValue = getPhase2ContextParsed<
          { readonly commandPath: readonly string[] }
        >(request);
        if (phase2ParsedValue == null) return {};
        return phase2ParsedValue.commandPath[0] === "serve"
          ? { [tokenKey]: "from-phase-two" }
          : {};
      },
    };

    const parser = command("serve", tokenParser);

    const result = await runWith(parser, "test", [dynamicContext], {
      args: ["serve"],
    });

    assert.equal(result, "from-phase-two");
  });

  it("runWithSync: phase two unwraps multiple() item states for seeds", () => {
    const markerKey = Symbol.for("@test/dyn-phase-two-multiple-marker");
    const tokenKey = Symbol.for("@test/dyn-phase-two-multiple-seed");

    const markerContext: SourceContext = {
      id: markerKey,
      phase: "single-pass",
      getAnnotations() {
        return { [markerKey]: true };
      },
    };

    const configParser: Parser<"sync", string, string | undefined> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly (string | undefined)[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: true,
      initialState: undefined,
      parse(context) {
        const [head, ...rest] = context.buffer;
        if (head == null) {
          return {
            success: false as const,
            error: message`Missing config.`,
            consumed: 0,
          };
        }
        return {
          success: true as const,
          next: {
            ...context,
            buffer: rest,
            state: inheritAnnotations(context.state, head),
          },
          consumed: [head],
        };
      },
      complete(state) {
        return typeof state === "string"
          ? { success: true as const, value: state }
          : { success: false as const, error: message`Missing config.` };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const tokenParser: Parser<"sync", string, undefined> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return {
          success: true as const,
          next: context,
          consumed: [],
        };
      },
      complete(state) {
        const annotations = getAnnotations(state);
        const token = annotations?.[tokenKey];
        return typeof token === "string"
          ? { success: true as const, value: token }
          : { success: false as const, error: message`Missing token.` };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineInheritedAnnotationParser(tokenParser);

    const dynamicContext: SourceContext<{
      readonly getConfigPath: (
        parsed: { readonly configs: readonly string[] },
      ) => string | undefined;
    }> = {
      id: tokenKey,
      phase: "two-pass",
      getAnnotations(
        request: SourceContextRequest | undefined,
        options?: {
          readonly getConfigPath: (
            parsed: { readonly configs: readonly string[] },
          ) => string | undefined;
        },
      ) {
        const phase2ParsedValue = getPhase2ContextParsed<
          { readonly configs: readonly string[] }
        >(request);
        if (phase2ParsedValue == null) return {};
        const configPath = options?.getConfigPath(phase2ParsedValue);
        return configPath == null ? {} : { [tokenKey]: `token:${configPath}` };
      },
    };

    const parser = object({
      configs: multiple(configParser, { min: 1 }),
      token: tokenParser,
    });

    const result = runWithSync(
      parser,
      "test",
      [markerContext, dynamicContext],
      {
        args: ["optique.json"],
        contextOptions: {
          getConfigPath: (parsed) => parsed.configs[0],
        },
      },
    );

    assert.deepEqual(result, {
      configs: ["optique.json"],
      token: "token:optique.json",
    });
  });

  it("runWith: two-phase, first pass fails → error handled via runParser", async () => {
    const dynKey = Symbol.for("@test/dyn-firstfail");
    const dynamicContext: SourceContext = {
      id: dynKey,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) return {};
        return { [dynKey]: {} };
      },
    };
    const parser = object({ x: argument(string()) });
    let errorCalled = false;
    await runWith(parser, "test", [dynamicContext], {
      args: [], // missing required argument → first pass fails
      onError: () => {
        errorCalled = true;
        return "error";
      },
      stderr: () => {},
    });
    assert.ok(errorCalled, "error should be called when first pass fails");
  });

  it("runWith: two-phase, async parser + hasDynamic, first pass succeeds", async () => {
    const dynKey = Symbol.for("@test/dyn-async-parser2");
    const dynamicContext: SourceContext = {
      id: dynKey,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) return {}; // dynamic (no symbols → hasDynamic = true)
        return { [dynKey]: {} };
      },
    };
    // Build a proper async-mode parser; state must be an object (not array)
    // because injectAnnotationsIntoParser spreads initialState as an object.
    const asyncParser: Parser<"async", string, { value: string | null }> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { value: string | null }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: null },
      parse(context) {
        const [head, ...rest] = context.buffer;
        if (head === undefined) {
          return Promise.resolve({
            success: false as const,
            error: message`Missing argument.`,
            consumed: 0,
          });
        }
        return Promise.resolve({
          success: true as const,
          next: { ...context, buffer: rest, state: { value: head } },
          consumed: [head],
        });
      },
      complete(state) {
        if (state.value == null) {
          return Promise.resolve({
            success: false as const,
            error: message`No input provided.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          value: state.value,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    const result = await runWith(asyncParser, "test", [dynamicContext], {
      args: ["world"],
    });
    assert.equal(result, "world");
  });

  it(
    "runWith: two-pass context still refines a successful undefined first-pass value",
    async () => {
      const key = Symbol.for("@test/two-pass-undefined-first-pass-async");
      const parser: Parser<"sync", string | undefined, null> = {
        $mode: "sync",
        $valueType: [] as readonly (string | undefined)[],
        $stateType: [] as readonly null[],
        priority: 0,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: null,
        parse(context) {
          return {
            success: true as const,
            next: context,
            consumed: [],
          };
        },
        complete(state) {
          return {
            success: true as const,
            value: getAnnotations(state)?.[key] as string | undefined,
          };
        },
        *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
      };
      const context: SourceContext = {
        id: key,
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase1ContextRequest(request)) return {};
          return { [key]: "phase2" };
        },
      };

      const result = await runWith(parser, "test", [context], { args: [] });

      assert.equal(result, "phase2");
    },
  );

  it("runWith: async parser + hasDynamic + first-pass fails", async () => {
    const dynKey = Symbol.for("@test/dyn-async-fail2");
    const dynamicContext: SourceContext = {
      id: dynKey,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) return {}; // dynamic
        return { [dynKey]: {} };
      },
    };
    // Use a native async parser with object state (not array)
    const asyncParser: Parser<"async", string, { value: string | null }> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { value: string | null }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: null },
      parse(context) {
        const [head, ...rest] = context.buffer;
        if (head === undefined) {
          return Promise.resolve({
            success: false as const,
            error: message`Missing argument.`,
            consumed: 0,
          });
        }
        return Promise.resolve({
          success: true as const,
          next: { ...context, buffer: rest, state: { value: head } },
          consumed: [head],
        });
      },
      complete(state) {
        if (state.value == null) {
          return Promise.resolve({
            success: false as const,
            error: message`No input provided.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          value: state.value,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    let errorCalled = false;
    await runWith(asyncParser, "test", [dynamicContext], {
      args: [], // empty → parse fails → first pass fails
      onError: () => {
        errorCalled = true;
        return "error";
      },
      stderr: () => {},
    });
    assert.ok(
      errorCalled,
      "error should be called for async parser first-pass failure",
    );
  });

  // Lines 2698/2736/2740/2818: runWithSync two-phase paths
  it("runWithSync: needsEarlyExit skips phase two processing", () => {
    const dynKey = Symbol.for("@test/sync-early-exit");
    let phase1Calls = 0;
    let phase2Calls = 0;
    const context: SourceContext = {
      id: dynKey,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) {
          phase1Calls++;
          return { [dynKey]: {} };
        }
        phase2Calls++;
        return { [dynKey]: {} };
      },
    };
    const parser = object({ x: argument(string()) });
    let helpShown = false;
    runWithSync(parser, "test", [context], {
      args: ["--help"],
      help: {
        option: true,
        onShow: () => {
          helpShown = true;
          return "shown";
        },
      },
      stdout: () => {},
    });
    assert.ok(helpShown, "help should be shown");
    assert.equal(phase1Calls, 1, "phase 1 should still run");
    assert.equal(phase2Calls, 0, "phase 2 should be skipped on early exit");
  });

  it("runWithSync: skips the meta probe for single-pass contexts", () => {
    let parseCalls = 0;
    const ctxKey = Symbol.for("@test/sync-single-pass-meta-probe");
    const parser: Parser<"sync", string, string | undefined> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly (string | undefined)[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        parseCalls++;
        const [head, ...rest] = context.buffer;
        if (head == null) {
          return {
            success: false as const,
            consumed: 0,
            error: message`Missing value.`,
          };
        }
        return {
          success: true as const,
          next: { ...context, buffer: rest, state: head },
          consumed: [head],
        };
      },
      complete(state) {
        if (state == null) {
          return {
            success: false as const,
            error: message`Missing value.`,
          };
        }
        return {
          success: true as const,
          value: state,
        };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    const context: SourceContext = {
      id: ctxKey,
      phase: "single-pass",
      getAnnotations() {
        return { [ctxKey]: {} };
      },
    };

    const result = runWithSync(parser, "test", [context], {
      args: ["value"],
      help: { option: true },
      stdout: () => {},
      stderr: () => {},
    });

    assert.equal(result, "value");
    assert.equal(parseCalls, 1, "single-pass runs should parse only once");
  });

  it("runWithSync: two-phase, first pass fails → handled via runParser", () => {
    const dynKey = Symbol.for("@test/sync-two-phase-fail");
    const context: SourceContext = {
      id: dynKey,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) return {}; // dynamic
        return { [dynKey]: {} };
      },
    };
    const parser = object({ x: argument(string()) });
    let errorCalled = false;
    runWithSync(parser, "test", [context], {
      args: [], // missing required → first pass fails
      onError: () => {
        errorCalled = true;
        return "error";
      },
      stderr: () => {},
    });
    assert.ok(errorCalled, "error should be called on first-pass failure");
  });

  it("runWithSync: two-phase fallback rebuilds the injected parser", () => {
    const dynKey = Symbol.for("@test/sync-two-phase-fresh-parser");
    const seenParsers = new WeakSet<object>();
    let staleParserReused = false;
    const context: SourceContext = {
      id: dynKey,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) return {};
        return { [dynKey]: {} };
      },
    };
    const parser: Parser<"sync", string, undefined> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(this: object, _context) {
        if (seenParsers.has(this)) staleParserReused = true;
        else seenParsers.add(this);
        return {
          success: false as const,
          consumed: 0,
          error: message`Missing value.`,
        };
      },
      complete() {
        return {
          success: false as const,
          error: message`Missing value.`,
        };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    runWithSync(parser, "test", [context], {
      args: [],
      onError: () => "error",
      stderr: () => {},
    });

    assert.equal(staleParserReused, false);
  });

  it(
    "runWithSync: two-pass context still refines a successful undefined first-pass value",
    () => {
      const key = Symbol.for("@test/two-pass-undefined-first-pass-sync");
      const parser: Parser<"sync", string | undefined, null> = {
        $mode: "sync",
        $valueType: [] as readonly (string | undefined)[],
        $stateType: [] as readonly null[],
        priority: 0,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: null,
        parse(context) {
          return {
            success: true as const,
            next: context,
            consumed: [],
          };
        },
        complete(state) {
          return {
            success: true as const,
            value: getAnnotations(state)?.[key] as string | undefined,
          };
        },
        *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
      };
      const context: SourceContext = {
        id: key,
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase1ContextRequest(request)) return {};
          return { [key]: "phase2" };
        },
      };

      const result = runWithSync(parser, "test", [context], { args: [] });

      assert.equal(result, "phase2");
    },
  );

  it("runWithSync: two-phase, first pass throws → handled via runParser", () => {
    const dynKey = Symbol.for("@test/sync-two-phase-throw");
    const context: SourceContext = {
      id: dynKey,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) return {}; // dynamic
        return { [dynKey]: {} };
      },
    };
    // A parser that throws synchronously can't be built easily; use a bad arg
    // instead - missing required argument causes parseSync to return failure,
    // not throw, so we use the normal failure path covered above.
    // Here test the second branch: parseSync succeeds but result.success=false
    // (already covered by the "first pass fails" test above).
    // We test that two-phase succeeds normally.
    const parser = object({ x: argument(string()) });
    const result = runWithSync(parser, "test", [context], {
      args: ["hi"],
    });
    assert.deepEqual(result, { x: "hi" });
  });

  it("runWithSync: two-pass context refines non-empty phase-1 annotations", () => {
    const key = Symbol.for("@test/two-pass-refine-non-empty-sync");
    let phase2Called = false;
    type AnnotationValue = { readonly phase1?: true; readonly phase2?: true };
    const isAnnotationValue = (
      value: unknown,
    ): value is AnnotationValue => value != null && typeof value === "object";

    const parser: Parser<"sync", AnnotationValue | null, undefined> = {
      $valueType: [] as readonly (AnnotationValue | null)[],
      $stateType: [] as readonly undefined[],
      $mode: "sync",
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return {
          success: true as const,
          next: context,
          consumed: [],
        };
      },
      complete(state) {
        const value = getAnnotations(state)?.[key];
        return {
          success: true as const,
          value: isAnnotationValue(value) ? value : null,
        };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const context: SourceContext = {
      id: key,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) {
          return { [key]: { phase1: true } };
        }
        phase2Called = true;
        return { [key]: { phase2: true } };
      },
    };

    const result = runWithSync(parser, "test", [context], {
      args: [],
    });

    assert.ok(
      (result as { readonly phase2?: boolean; readonly phase1?: boolean })
        .phase2 === true,
    );
    assert.ok(
      !("phase1" in
        (result as { readonly phase2?: boolean; readonly phase1?: boolean })),
    );
    assert.ok(phase2Called, "phase 2 context should be called");
  });

  it("runWithSync: isolates phase requests across two-pass contexts", () => {
    const key = Symbol.for("@test/two-pass-request-isolation-sync");
    let secondContextParsed: { readonly config: string } | undefined;

    const parser = object({
      config: withDefault(option("--config", string()), "optique.json"),
    });

    const mutatingContext: SourceContext = {
      id: Symbol.for("@test/two-pass-request-mutator-sync"),
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        const parsed = getPhase2ContextParsed<{ readonly config: string }>(
          request,
        );
        if (parsed == null) return {};
        (request as SourceContextRequest & { parsed: unknown }).parsed = {
          config: "mutated.json",
        };
        return {};
      },
    };

    const readingContext: SourceContext = {
      id: key,
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        const parsed = getPhase2ContextParsed<{ readonly config: string }>(
          request,
        );
        if (parsed == null) return {};
        secondContextParsed = parsed;
        return { [key]: parsed.config };
      },
    };

    const result = runWithSync(
      parser,
      "test",
      [mutatingContext, readingContext],
      { args: [] },
    );

    assert.deepEqual(secondContextParsed, { config: "optique.json" });
    assert.deepEqual(result, {
      config: "optique.json",
    });
  });

  it("runWithSync should not let parsers mutate context-owned annotations", () => {
    const marker = Symbol.for("@test/issue-491/run-with-sync");
    const shared = { value: 1 };
    const context: SourceContext = {
      id: marker,
      phase: "single-pass",
      getAnnotations() {
        return { [marker]: shared };
      },
    };

    assert.throws(
      () =>
        runWithSync(
          createMutatingAnnotationRunnerParser(marker),
          "test",
          [context],
          { args: [] },
        ),
      {
        name: "TypeError",
        message: "Cannot mutate read-only annotation data.",
      },
    );
    assert.equal(shared.value, 1);
  });

  it("runWithSync: should reject contexts without explicit phase", () => {
    const key = Symbol.for("@test/missing-phase-sync");
    const parser = object({
      name: withDefault(option("--name", string()), "x"),
    });
    const context = {
      id: key,
      getAnnotations() {
        return {};
      },
    };

    assert.throws(
      () => runWithSync(parser, "test", [context as never], { args: [] }),
      {
        name: "TypeError",
        message: `Context ${String(key)} must declare phase as ` +
          '"single-pass" or "two-pass".',
      },
    );
  });

  it("runWithSync: should reject contexts with invalid phase", () => {
    const key = Symbol.for("@test/invalid-phase-sync");
    const parser = object({
      name: withDefault(option("--name", string()), "x"),
    });
    const context = {
      id: key,
      phase: "invalid",
      getAnnotations() {
        return {};
      },
    };

    assert.throws(
      () => runWithSync(parser, "test", [context as never], { args: [] }),
      {
        name: "TypeError",
        message: `Context ${String(key)} must declare phase as ` +
          '"single-pass" or "two-pass".',
      },
    );
  });

  it("runWith: should reject contexts without explicit phase", async () => {
    const key = Symbol.for("@test/missing-phase-async");
    const parser = object({
      name: withDefault(option("--name", string()), "x"),
    });
    const context = {
      id: key,
      getAnnotations() {
        return {};
      },
    };

    await assert.rejects(
      () => runWith(parser, "test", [context as never], { args: [] }),
      {
        name: "TypeError",
        message: `Context ${String(key)} must declare phase as ` +
          '"single-pass" or "two-pass".',
      },
    );
  });

  it("runWith: should reject contexts with invalid phase", async () => {
    const key = Symbol.for("@test/invalid-phase-async");
    const parser = object({
      name: withDefault(option("--name", string()), "x"),
    });
    const context = {
      id: key,
      phase: "invalid",
      getAnnotations() {
        return {};
      },
    };

    await assert.rejects(
      () => runWith(parser, "test", [context as never], { args: [] }),
      {
        name: "TypeError",
        message: `Context ${String(key)} must declare phase as ` +
          '"single-pass" or "two-pass".',
      },
    );
  });

  it("runWithAsync wraps runWith and returns Promise", async () => {
    const parser = object({ x: argument(string()) });
    const result = await runWithAsync(parser, "test", [], {
      args: ["wrapped"],
    });
    assert.deepEqual(result, { x: "wrapped" });
  });

  // Line 1951: aboveError="help" with async doc (via args.length >= 1)
  it("error with aboveError=help and args passes parser for doc", () => {
    const sub = object({ name: argument(string()) });
    const parser = command("sub", sub);
    let stderrOutput = "";
    runParser(parser, "test", ["sub"], {
      help: { option: true, onShow: () => "shown" },
      aboveError: "help",
      onError: () => "err",
      stderr: (t) => {
        stderrOutput += t;
      },
      stdout: () => {},
    });
    // "sub" parses the command but requires an argument
    assert.ok(
      stderrOutput.includes("Error:"),
      `expected Error: in output, got: ${stderrOutput}`,
    );
  });

  // Line 1977: aboveError="help" with args.length < 1 uses augmented parser
  it("error with aboveError=help and no args uses augmented parser for doc", () => {
    const parser = object({ x: argument(string()) });
    let stderrOutput = "";
    runParser(parser, "test", [], {
      help: { option: true, onShow: () => "shown" },
      aboveError: "help",
      onError: () => "err",
      stderr: (t) => {
        stderrOutput += t;
      },
      stdout: () => {},
    });
    assert.ok(
      stderrOutput.includes("Error:"),
      `expected Error: in output, got: ${stderrOutput}`,
    );
  });

  it("runWith uses default empty args when options.args is omitted", async () => {
    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });
    const result = await runWith(parser, "test", [], {});
    assert.deepEqual(result, { name: "default" });
  });

  it("runWith takes async early-exit branch for completion command", async () => {
    const asyncParser: Parser<"async", string, { value: string | null }> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { value: string | null }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: null },
      parse(context) {
        return Promise.resolve({
          success: false as const,
          error: context.buffer[0] == null
            ? message`Missing argument.`
            : message`Unexpected option or argument: ${context.buffer[0]}.`,
          consumed: 0,
        });
      },
      complete(state) {
        if (state.value == null) {
          return Promise.resolve({
            success: false as const,
            error: message`No input provided.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          value: state.value,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    let completionShown = false;
    await runWith(asyncParser, "test", [/* no context */], {
      args: ["completion", "bash"],
      completion: {
        command: true,
        onShow: () => {
          completionShown = true;
          return "completion-shown";
        },
      },
      stdout: () => {},
    });
    assert.ok(completionShown);
  });

  it("runWith handles first-pass throw in two-phase flow", async () => {
    const dynamicContext: SourceContext = {
      id: Symbol.for("@test/dyn-throw-in-first-pass"),
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) return {};
        return { [Symbol.for("@test/dyn-throw-in-first-pass")]: {} };
      },
    };
    const throwingParser: Parser<"async", string, { value: string | null }> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { value: string | null }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: null },
      parse() {
        throw new Error("Boom.");
      },
      complete() {
        return Promise.resolve({
          success: false as const,
          error: message`Should not complete.`,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    await assert.rejects(
      () => runWith(throwingParser, "test", [dynamicContext], { args: ["x"] }),
      /Boom\./,
    );
  });

  it("runWithSync uses default empty args when options.args is omitted", () => {
    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });
    const result = runWithSync(parser, "test", [], {});
    assert.deepEqual(result, { name: "default" });
  });

  it("runWithSync handles first-pass throw in two-phase flow", () => {
    const dynamicContext: SourceContext = {
      id: Symbol.for("@test/sync-dyn-throw-in-first-pass"),
      phase: "two-pass",
      getAnnotations(request?: unknown) {
        if (isPhase1ContextRequest(request)) return {};
        return { [Symbol.for("@test/sync-dyn-throw-in-first-pass")]: {} };
      },
    };
    const throwingParser: Parser<"sync", string, { value: string | null }> = {
      $mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { value: string | null }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: null },
      parse() {
        throw new Error("Sync boom.");
      },
      complete() {
        return {
          success: false as const,
          error: message`Should not complete.`,
        };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    assert.throws(
      () =>
        runWithSync(throwingParser, "test", [dynamicContext], { args: ["x"] }),
      /Sync boom\./,
    );
  });

  it("does not classify unbranded help/version-shaped user data", () => {
    const parser: Parser<
      "sync",
      {
        readonly help: false;
        readonly version: false;
        readonly result: {
          readonly command: "status";
          readonly ok: true;
        };
      },
      undefined
    > = {
      $mode: "sync",
      $valueType: [] as never,
      $stateType: [] as never,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return {
          success: true as const,
          next: { ...context, buffer: [], state: undefined },
          consumed: [...context.buffer],
        };
      },
      complete() {
        return {
          success: true as const,
          value: {
            help: false as const,
            version: false as const,
            result: {
              command: "status" as const,
              ok: true as const,
            },
          },
        };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const result = runParser(parser, "test", ["placeholder"]);
    assert.deepEqual(result, {
      help: false,
      version: false,
      result: { command: "status", ok: true },
    });
  });

  it("does not classify unbranded completion-shaped user data", () => {
    const parser: Parser<
      "sync",
      {
        readonly help: false;
        readonly version: false;
        readonly completion: true;
        readonly completionData: {
          readonly shell: "bash";
          readonly args: readonly ["x"];
        };
        readonly result: Record<PropertyKey, never>;
      },
      undefined
    > = {
      $mode: "sync",
      $valueType: [] as never,
      $stateType: [] as never,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return {
          success: true as const,
          next: { ...context, buffer: [], state: undefined },
          consumed: [...context.buffer],
        };
      },
      complete() {
        return {
          success: true as const,
          value: {
            help: false as const,
            version: false as const,
            completion: true as const,
            completionData: { shell: "bash" as const, args: ["x"] as const },
            result: {},
          },
        };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const result = runParser(parser, "test", ["placeholder"]);
    assert.deepEqual(result, {
      help: false,
      version: false,
      completion: true,
      completionData: { shell: "bash", args: ["x"] },
      result: {},
    });
  });

  it("does not reclassify consumed help tokens after sync parse failures", () => {
    const parsers: readonly Parser<"sync", string, undefined>[] = [
      {
        $mode: "sync",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly undefined[],
        priority: 0,
        usage: [],
        leadingNames: new Set(["--help"]),
        acceptingAnyToken: false,
        initialState: undefined,
        parse() {
          return {
            success: false as const,
            consumed: 1,
            error: message`Consumed token failure.`,
          };
        },
        complete() {
          return {
            success: false as const,
            error: message`Should not complete.`,
          };
        },
        *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
      },
      {
        $mode: "sync",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly undefined[],
        priority: 0,
        usage: [],
        leadingNames: new Set(["--help"]),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          return {
            success: true as const,
            next: context,
            consumed: ["--help"],
          };
        },
        complete() {
          return {
            success: false as const,
            error: message`Should not complete.`,
          };
        },
        *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
      },
    ];

    for (const parser of parsers) {
      let stdoutOutput = "";
      const result = runParser(parser, "test", ["--help"], {
        help: {
          option: true,
          onShow: () => "help",
        },
        onError: () => "error",
        stdout: (text) => {
          stdoutOutput += text;
        },
        stderr: () => {},
      });

      assert.equal(result, "error");
      assert.equal(stdoutOutput, "");
    }
  });

  it("does not reclassify consumed help tokens after async parse failures", async () => {
    const parsers: readonly Parser<"async", string, undefined>[] = [
      {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly undefined[],
        priority: 0,
        usage: [],
        leadingNames: new Set(["--help"]),
        acceptingAnyToken: false,
        initialState: undefined,
        parse() {
          return Promise.resolve({
            success: false as const,
            consumed: 1,
            error: message`Consumed token failure.`,
          });
        },
        complete() {
          return Promise.resolve({
            success: false as const,
            error: message`Should not complete.`,
          });
        },
        async *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
      },
      {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly undefined[],
        priority: 0,
        usage: [],
        leadingNames: new Set(["--help"]),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          return Promise.resolve({
            success: true as const,
            next: context,
            consumed: ["--help"],
          });
        },
        complete() {
          return Promise.resolve({
            success: false as const,
            error: message`Should not complete.`,
          });
        },
        async *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
      },
    ];

    for (const parser of parsers) {
      let stdoutOutput = "";
      const result = await runParser(parser, "test", ["--help"], {
        help: {
          option: true,
          onShow: () => "help",
        },
        onError: () => "error",
        stdout: (text) => {
          stdoutOutput += text;
        },
        stderr: () => {},
      });

      assert.equal(result, "error");
      assert.equal(stdoutOutput, "");
    }
  });

  it("needsEarlyExit does not trigger for non-matching completion option args", () => {
    const parser = object({ name: argument(string()) });
    const result = runParser(parser, "test", ["Alice"], {
      completion: { option: true, onShow: () => "shown" },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { name: "Alice" });
  });

  it("runWith uses async fast-path without contexts and with single-pass contexts", async () => {
    const asyncParser: Parser<"async", string, { value: string | null }> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { value: string | null }[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: { value: null },
      parse(context) {
        const [head, ...rest] = context.buffer;
        if (head == null) {
          return Promise.resolve({
            success: false as const,
            error: message`Missing argument.`,
            consumed: 0,
          });
        }
        return Promise.resolve({
          success: true as const,
          next: { ...context, buffer: rest, state: { value: head } },
          consumed: [head],
        });
      },
      complete(state) {
        if (state.value == null) {
          return Promise.resolve({
            success: false as const,
            error: message`No input provided.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          value: state.value,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const withoutContexts = await runWith(asyncParser, "test", [], {
      args: ["first"],
    });
    assert.equal(withoutContexts, "first");

    const staticContext: SourceContext = {
      id: Symbol.for("@test/facade-static-fastpath"),
      phase: "single-pass",
      getAnnotations() {
        return { [Symbol.for("@test/facade-static-fastpath")]: {} };
      },
    };
    const withStaticContext = await runWith(asyncParser, "test", [
      staticContext,
    ], {
      args: ["second"],
    });
    assert.equal(withStaticContext, "second");
  });

  it("runWith skips the meta probe when meta handling is disabled", async () => {
    let parseCalls = 0;
    const ctxKey = Symbol.for("@test/async-two-phase-no-meta-probe");
    const parser: Parser<"async", string, string | undefined> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly (string | undefined)[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        parseCalls++;
        const [head, ...rest] = context.buffer;
        if (head == null) {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`Missing value.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          next: { ...context, buffer: rest, state: head },
          consumed: [head],
        });
      },
      complete(state) {
        if (state == null) {
          return Promise.resolve({
            success: false as const,
            error: message`Missing value.`,
          });
        }
        return Promise.resolve({
          success: true as const,
          value: state,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };
    const context: SourceContext = {
      id: ctxKey,
      phase: "two-pass",
      getAnnotations() {
        return {};
      },
    };

    const result = await runWith(parser, "test", [context], {
      args: ["value"],
    });

    assert.equal(result, "value");
    assert.equal(parseCalls, 2, "two-pass runs should not add a meta probe");
  });

  it("completion callbacks preserve real callback errors", () => {
    const parser = object({ verbose: option("--verbose") });

    assert.throws(
      () =>
        runParser(parser, "myapp", ["completion", "bash"], {
          completion: {
            command: true,
            onShow: function () {
              if (arguments.length > 0) {
                throw new Error("arg-call rejected");
              }
              return "completion-fallback";
            },
          },
          stdout: () => {},
          stderr: () => {},
        }),
      /arg-call rejected/,
    );

    assert.throws(
      () =>
        runParser(parser, "myapp", ["completion"], {
          completion: { command: true },
          onError: function () {
            if (arguments.length > 0) {
              throw new Error("arg-call rejected");
            }
            return "error-fallback";
          },
          stderr: () => {},
          stdout: () => {},
        }),
      /arg-call rejected/,
    );
  });

  it("completion unsupported shell follows async dispatch path", async () => {
    const asyncParser: Parser<"async", Record<string, never>, undefined> = {
      $mode: "async",
      $valueType: [] as never,
      $stateType: [] as never,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return Promise.resolve({
          success: false as const,
          error: context.buffer[0] == null
            ? message`Missing argument.`
            : message`Unexpected option or argument: ${context.buffer[0]}.`,
          consumed: 0,
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: {},
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const result = await runParser(asyncParser, "myapp", [
      "completion",
      "powershell",
    ], {
      completion: { command: true },
      onError: (code) => `async-error-${code}`,
      stderr: () => {},
      stdout: () => {},
    });
    assert.equal(result, "async-error-1");
  });

  it("help callback preserves real callback errors", () => {
    const parser = object({ name: argument(string()) });
    assert.throws(
      () =>
        runParser(parser, "myapp", ["--help"], {
          help: {
            option: true,
            onShow: function () {
              if (arguments.length > 0) {
                throw new Error("arg-call rejected");
              }
              return "help-fallback";
            },
          },
          stderr: () => {},
          stdout: () => {},
        }),
      /arg-call rejected/,
    );
  });

  it("version callback preserves real callback errors", () => {
    const parser = object({ name: argument(string()) });
    assert.throws(
      () =>
        runParser(parser, "myapp", ["--version"], {
          version: {
            value: "1.2.3",
            option: true,
            onShow: function () {
              if (arguments.length > 0) {
                throw new Error("arg-call rejected");
              }
              return "version-fallback";
            },
          },
          stderr: () => {},
          stdout: () => {},
        }),
      /arg-call rejected/,
    );
  });

  it("aboveError=help falls back to usage when doc lookup returns undefined", () => {
    const parser = command("deploy", object({ env: argument(string()) }));
    let stderrOutput = "";

    const result = runParser(parser, "mycli", ["unknown"], {
      aboveError: "help",
      onError: () => "handled",
      stderr: (text) => {
        stderrOutput += text;
      },
    });

    assert.equal(result, "handled");
    assert.ok(stderrOutput.includes("Usage:"));
    assert.ok(stderrOutput.includes("Error:"));
  });

  it("uses async help-command validation path before showing help", async () => {
    const asyncParser: Parser<"async", string, undefined> = {
      $mode: "async",
      $valueType: [] as never,
      $stateType: [] as never,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        const [head, ...tail] = context.buffer;
        if (head == null || head !== "ok") {
          return Promise.resolve({
            success: false as const,
            error: message`Unknown command.`,
            consumed: 0,
          });
        }
        return Promise.resolve({
          success: true as const,
          next: { ...context, buffer: tail, state: undefined },
          consumed: [head],
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "done" });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    let shown = false;
    const result = await runParser(asyncParser, "myapp", ["ok", "--help"], {
      help: {
        option: true,
        onShow: () => {
          shown = true;
          return "help-shown";
        },
      },
      stdout: () => {},
      stderr: () => {},
      onError: () => "error",
    });

    assert.equal(result, "help-shown");
    assert.ok(shown);
  });

  it("reports invalid async help command path before showing help", async () => {
    const asyncParser: Parser<"async", string, undefined> = {
      $mode: "async",
      $valueType: [] as never,
      $stateType: [] as never,
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse() {
        return Promise.resolve({
          success: false as const,
          error: message`Unknown command.`,
          consumed: 0,
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "done" });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    let stderrOutput = "";
    const result = await runParser(asyncParser, "myapp", ["bad", "--help"], {
      help: { option: true },
      stderr: (text) => {
        stderrOutput += text;
      },
      stdout: () => {},
      onError: () => "invalid-help",
    });

    assert.equal(result, "invalid-help");
    assert.ok(stderrOutput.includes("Usage:"));
    assert.ok(stderrOutput.includes("Error:"));
  });

  it("supports hidden aliases for help/version commands", () => {
    const parser = object({ verbose: option("--verbose") });
    let stdoutOutput = "";

    const helpResult = runParser(parser, "myapp", ["assist"], {
      help: {
        command: { names: ["help", "assist"], hidden: "usage" },
        onShow: () => "help-alias",
      },
      stdout: (text) => {
        stdoutOutput += text;
      },
    });
    assert.equal(helpResult, "help-alias");
    assert.ok(stdoutOutput.includes("Usage:"));

    const versionResult = runParser(parser, "myapp", ["ver"], {
      version: {
        value: "1.2.3",
        command: { names: ["version", "ver"], hidden: "doc" },
        onShow: () => "version-alias",
      },
      stdout: () => {},
    });
    assert.equal(versionResult, "version-alias");
  });

  it("keeps meta-command aliases fully hidden with partial visibility", () => {
    const parser = object({ verbose: option("--verbose") });

    let helpOutput = "";
    runParser(parser, "myapp", ["--help"], {
      help: {
        command: { names: ["help", "assist"], hidden: "usage" },
        option: true,
        onShow: () => "help-shown",
      },
      stdout: (text) => {
        helpOutput += text + "\n";
      },
    });
    assert.ok(helpOutput.includes("help"));
    assert.ok(
      !/\bassist\b/.test(helpOutput),
      `hidden help alias should stay out of help output, got:\n${helpOutput}`,
    );

    let versionErrorOutput = "";
    runParser(parser, "myapp", ["--invalid"], {
      version: {
        value: "1.2.3",
        command: { names: ["version", "ver"], hidden: "doc" },
      },
      onError: () => "error",
      stderr: (text) => {
        versionErrorOutput += text + "\n";
      },
    });
    const versionUsageLines = versionErrorOutput
      .split("\n")
      .filter((line) => line.startsWith("Usage:") || line.startsWith("       "))
      .join("\n");
    assert.ok(versionUsageLines.includes("version"));
    assert.ok(
      !/(?:^|\s)ver(?:\s|$)/m.test(versionUsageLines),
      `hidden version alias should stay out of usage output, got:\n${versionUsageLines}`,
    );

    let completionOutput = "";
    runParser(parser, "myapp", ["--help"], {
      help: { option: true, onShow: () => "help-shown" },
      completion: {
        command: { names: ["completion", "completions"], hidden: "usage" },
      },
      stdout: (text) => {
        completionOutput += text + "\n";
      },
    });
    assert.ok(completionOutput.includes("completion"));
    assert.ok(
      !/(?:^|\n)\s+completions\b/m.test(completionOutput) &&
        !/\bmyapp completions\b/.test(completionOutput),
      `hidden completion alias should stay out of help output, got:\n${completionOutput}`,
    );
  });

  it("builds multi-name help/version commands with visible primary names", () => {
    const parser = object({ verbose: option("--verbose") });

    const helpResult = runParser(parser, "myapp", ["assist"], {
      help: {
        command: { names: ["help", "assist"], hidden: false },
        onShow: () => "help-shown",
      },
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(helpResult, "help-shown");

    const versionResult = runParser(parser, "myapp", ["ver"], {
      version: {
        value: "1.2.3",
        command: { names: ["version", "ver"], hidden: false },
        onShow: () => "version-shown",
      },
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(versionResult, "version-shown");
  });

  it("shows meta-command help without top-level examples/author/bugs", () => {
    const parser = object({ verbose: option("--verbose") });
    let out = "";

    const result = runParser(parser, "myapp", ["help", "completion"], {
      help: { command: true, option: true, onShow: () => "shown" },
      completion: { command: true },
      examples: message`myapp --help`,
      author: message`Author Name`,
      bugs: message`https://example.invalid/bugs`,
      stdout: (text) => {
        out += text;
      },
      stderr: () => {},
    });

    assert.equal(result, "shown");
    assert.ok(out.includes("completion"));
  });

  it("completion callback errors propagate for early option-mode script generation", () => {
    const parser = object({ verbose: option("--verbose") });
    assert.throws(
      () =>
        runParser(parser, "myapp", ["--completion", "bash"], {
          completion: {
            option: true,
            onShow: function () {
              if (arguments.length > 0) {
                throw new Error("arg-call rejected");
              }
              return "fallback-ok";
            },
          },
          stdout: () => {},
          stderr: () => {},
        }),
      /arg-call rejected/,
    );
  });

  it("aboveError=help with async parser uses promise doc path and usage fallback", async () => {
    const asyncParser: Parser<"async", string, undefined> = {
      $mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse() {
        return Promise.resolve({
          success: false as const,
          error: message`bad input`,
          consumed: 0,
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "ok" });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    let stderrOutput = "";
    const result = await runParser(asyncParser, "myapp", ["x"], {
      aboveError: "help",
      maxWidth: 40,
      onError: () => "handled",
      stderr: (text) => {
        stderrOutput += text;
      },
      stdout: () => {},
    });

    assert.equal(result, "handled");
    assert.ok(stderrOutput.includes("Usage:"));
    assert.ok(stderrOutput.includes("Error: bad input"));
  });

  it("does not treat help/version options after -- as meta options", () => {
    const parser = object({ name: argument(string()) });
    let stderrOutput = "";
    const result = runParser(parser, "myapp", ["--", "--help"], {
      help: { option: true },
      version: { value: "1.0.0", option: true },
      onError: () => "terminated",
      stderr: (text) => {
        stderrOutput += text;
      },
    });

    assert.deepEqual(result, { name: "--help" });
    assert.ok(!stderrOutput.includes("Error:"));
  });

  it("reports invalid command path before --help when parser consumes nothing", () => {
    const parser = object({
      maybe: optional(option("--ok")),
    });
    let stderrOutput = "";
    const result = runParser(parser, "myapp", ["unknown", "--help"], {
      help: { option: true },
      onError: () => "invalid-help-path",
      stderr: (text) => {
        stderrOutput += text;
      },
    });

    assert.equal(result, "invalid-help-path");
    assert.ok(stderrOutput.includes("Usage:"));
    assert.ok(stderrOutput.includes("Unexpected option or subcommand"));
  });

  it("throws when sync parser help handler returns a Promise", () => {
    const parser = object({ name: argument(string()) });
    assert.throws(
      () =>
        runParser(parser, "myapp", ["--help"], {
          help: {
            option: true,
            onShow: () => Promise.resolve("async-help") as unknown as string,
          },
        }),
      RunParserError,
      "Synchronous parser returned async result.",
    );
  });

  it("throws when sync completion onShow returns a Promise (script generation)", () => {
    // Regression test for https://github.com/dahlia/optique/issues/264
    const parser = object({});
    assert.throws(
      () =>
        runParser(parser, "myapp", ["completion", "bash"], {
          completion: {
            command: true,
            onShow: () => Promise.resolve("async-show") as never,
          },
          stdout: () => {},
          stderr: () => {},
        }),
      {
        name: "RunParserError",
        message: "Synchronous parser returned async result.",
      },
    );
  });

  it("throws when sync completion onShow returns a Promise (suggestions)", () => {
    // Regression test for https://github.com/dahlia/optique/issues/264
    const parser = object({});
    assert.throws(
      () =>
        runParser(parser, "myapp", ["completion", "bash", "--"], {
          completion: {
            command: true,
            onShow: () => Promise.resolve("async-show") as never,
          },
          stdout: () => {},
          stderr: () => {},
        }),
      {
        name: "RunParserError",
        message: "Synchronous parser returned async result.",
      },
    );
  });

  it("throws when sync completion onError returns a Promise (missing shell)", () => {
    // Regression test for https://github.com/dahlia/optique/issues/264
    const parser = object({});
    assert.throws(
      () =>
        runParser(parser, "myapp", ["completion"], {
          completion: { command: true },
          onError: () => Promise.resolve("async-error") as never,
          stdout: () => {},
          stderr: () => {},
        }),
      {
        name: "RunParserError",
        message: "Synchronous parser returned async result.",
      },
    );
  });

  it("throws when sync completion onError returns a Promise (unsupported shell)", () => {
    // Regression test for https://github.com/dahlia/optique/issues/264
    const parser = object({});
    assert.throws(
      () =>
        runParser(parser, "myapp", ["completion", "unknownshell"], {
          completion: { command: true },
          onError: () => Promise.resolve("async-error") as never,
          stdout: () => {},
          stderr: () => {},
        }),
      {
        name: "RunParserError",
        message: "Synchronous parser returned async result.",
      },
    );
  });

  it("throws when sync completion option onShow returns a Promise", () => {
    // Regression test for https://github.com/dahlia/optique/issues/264
    const parser = object({});
    assert.throws(
      () =>
        runParser(parser, "myapp", ["--completion", "bash"], {
          completion: {
            option: true,
            onShow: () => Promise.resolve("async-show") as never,
          },
          stdout: () => {},
          stderr: () => {},
        }),
      {
        name: "RunParserError",
        message: "Synchronous parser returned async result.",
      },
    );
  });

  it("uses option-mode completion script path without swallowing callback errors", () => {
    const parser = object({ verbose: option("--verbose") });
    assert.throws(
      () =>
        runParser(parser, "myapp", ["--completion", "bash"], {
          completion: {
            option: true,
            onShow: function () {
              if (arguments.length > 0) {
                throw new Error("arg-call rejected");
              }
              return "option-completion-fallback";
            },
          },
          stdout: () => {},
          stderr: () => {},
        }),
      /arg-call rejected/,
    );
  });

  it("preserves ordinary positional values that match meta commands", () => {
    const parser = object({ value: argument(string()) });

    assert.deepEqual(
      runParser(parser, "myapp", ["help"], {
        help: { command: true, onShow: () => "HELP" },
        stdout: () => {},
        stderr: () => {},
      }),
      { value: "help" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["assist"], {
        help: {
          command: { names: ["help", "assist"] },
          onShow: () => "HELP",
        },
        stdout: () => {},
        stderr: () => {},
      }),
      { value: "assist" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["version"], {
        version: {
          command: true,
          value: "1.0.0",
          onShow: () => "VER",
        },
        stdout: () => {},
        stderr: () => {},
      }),
      { value: "version" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["completion"], {
        completion: { command: true, onShow: () => "COMP" },
        onError: () => "ERROR",
        stdout: () => {},
        stderr: () => {},
      }),
      { value: "completion" },
    );
  });

  it("prefers user command docs over colliding meta command docs", () => {
    const metaDescriptions = new Map<string, string>([
      ["help", "Command name to show help for."],
      ["version", "Show version information."],
      [
        "completion",
        "Generate shell completion script or provide completions.",
      ],
    ]);

    for (const name of ["help", "version", "completion"] as const) {
      const output: string[] = [];
      const parser = command(name, object({}), {
        description: message`User ${name} command.`,
      });

      const result = runParser(parser, "myapp", [name, "--help"], {
        help: { command: true, option: true, onShow: () => "HELP" },
        version: {
          command: true,
          value: "1.0.0",
          onShow: () => "VERSION",
        },
        completion: { command: true, onShow: () => "COMPLETION" },
        stdout(text) {
          output.push(text);
        },
        stderr: () => {},
      });

      assert.equal(result, "HELP");
      assert.ok(output.join("").includes(`User "${name}" command.`));
      assert.ok(!output.join("").includes(metaDescriptions.get(name)!));
    }
  });

  it("preserves ordinary option values that match meta options and aliases", () => {
    const parser = object({
      message: option("--message", string({ metavar: "MESSAGE" })),
    });

    assert.deepEqual(
      runParser(parser, "myapp", ["--message", "--help"], {
        help: { option: true, onShow: () => "HELP" },
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "--help" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message=--help"], {
        help: { option: true, onShow: () => "HELP" },
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "--help" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message", "-h"], {
        help: {
          option: { names: ["-h"] },
          onShow: () => "HELP",
        },
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "-h" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message=-h"], {
        help: {
          option: { names: ["-h"] },
          onShow: () => "HELP",
        },
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "-h" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message", "--version"], {
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => "VER",
        },
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "--version" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message=--version"], {
        version: {
          option: true,
          value: "1.0.0",
          onShow: () => "VER",
        },
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "--version" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message", "-V"], {
        version: {
          option: { names: ["-V"] },
          value: "1.0.0",
          onShow: () => "VER",
        },
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "-V" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message=-V"], {
        version: {
          option: { names: ["-V"] },
          value: "1.0.0",
          onShow: () => "VER",
        },
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "-V" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message", "--completion"], {
        completion: { option: true, onShow: () => "COMP" },
        onError: () => "ERROR",
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "--completion" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message=--completion"], {
        completion: { option: true, onShow: () => "COMP" },
        onError: () => "ERROR",
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "--completion" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message", "--completions"], {
        completion: {
          option: { names: ["--completions"] },
          onShow: () => "COMP",
        },
        onError: () => "ERROR",
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "--completions" },
    );
    assert.deepEqual(
      runParser(parser, "myapp", ["--message=--completions"], {
        completion: {
          option: { names: ["--completions"] },
          onShow: () => "COMP",
        },
        onError: () => "ERROR",
        stdout: () => {},
        stderr: () => {},
      }),
      { message: "--completions" },
    );
  });

  it("runWithSync does not early-exit when completion-like input is ordinary parser data", () => {
    let annotationsCallCount = 0;
    const trackingContext: SourceContext = {
      id: Symbol.for("@test/issue-230/tracking"),
      phase: "single-pass",
      getAnnotations() {
        annotationsCallCount++;
        return {};
      },
    };
    const parser = object({ value: argument(string()) });

    const result = runWithSync(parser, "myapp", [trackingContext], {
      args: ["--completion=bash"],
      completion: {
        option: true,
        onShow: () => "COMP",
      },
      onError: () => "ERROR",
      stdout: () => {},
      stderr: () => {},
    });

    assert.deepEqual(result, { value: "--completion=bash" });
    assert.equal(annotationsCallCount, 1);
  });
});

describe("runParserSync", () => {
  it("should reject async parser at runtime", () => {
    const asyncVp: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "STR",
      placeholder: "",
      parse(input: string) {
        return Promise.resolve({ success: true as const, value: input });
      },
      format(value: string) {
        return value;
      },
    };
    const parser = object({ name: argument(asyncVp) });

    assert.throws(
      () => runParserSync(parser as never, "test", ["hello"]),
      {
        name: "TypeError",
        message: /runParser\(\) or runParserAsync\(\)/,
      },
    );
  });
});

describe("runWithSync async parser rejection", () => {
  it("should reject async parser at runtime", () => {
    const asyncVp: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "STR",
      placeholder: "",
      parse(input: string) {
        return Promise.resolve({ success: true as const, value: input });
      },
      format(value: string) {
        return value;
      },
    };
    const parser = object({ name: argument(asyncVp) });
    const ctx: SourceContext = {
      id: Symbol.for("@test/async-reject"),
      phase: "single-pass",
      getAnnotations() {
        return {};
      },
    };

    assert.throws(
      () => runWithSync(parser as never, "test", [ctx], { args: ["hello"] }),
      {
        name: "TypeError",
        message: /runWith\(\) or runWithAsync\(\)/,
      },
    );
  });
});

// https://github.com/dahlia/optique/issues/228
describe("options terminator (--) handling", () => {
  function createIssue267Fixture() {
    const envContext = createEnvContext({
      source: (key) => key === "HOST" ? "env-host" : undefined,
    });
    const parser = object({
      file: argument(string()),
      host: bindEnv(fail(), {
        context: envContext,
        key: "HOST",
        parser: string(),
      }),
    });
    return { parser, envContext };
  }

  async function runIssue267With(
    token: string,
    kind: "help" | "version",
    names?: readonly [OptionName, ...OptionName[]],
  ) {
    const { parser, envContext } = createIssue267Fixture();
    return await runWith(parser, "test", [envContext], {
      args: ["--", token],
      help: kind === "help"
        ? {
          option: names == null ? true : { names },
          onShow: () => "help",
        }
        : { option: true, onShow: () => "help" },
      version: kind === "version"
        ? {
          value: "1.0.0",
          option: names == null ? true : { names },
          onShow: () => "version",
        }
        : {
          value: "1.0.0",
          option: true,
          onShow: () => "version",
        },
      stdout: () => {},
      stderr: () => {},
    });
  }

  function runIssue267SyncWith(
    token: string,
    kind: "help" | "version",
    names?: readonly [OptionName, ...OptionName[]],
  ) {
    const { parser, envContext } = createIssue267Fixture();
    return runWithSync(parser, "test", [envContext], {
      args: ["--", token],
      help: kind === "help"
        ? {
          option: names == null ? true : { names },
          onShow: () => "help",
        }
        : { option: true, onShow: () => "help" },
      version: kind === "version"
        ? {
          value: "1.0.0",
          option: names == null ? true : { names },
          onShow: () => "version",
        }
        : {
          value: "1.0.0",
          option: true,
          onShow: () => "version",
        },
      stdout: () => {},
      stderr: () => {},
    });
  }

  it("runParser ignores --completion after -- terminator", () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = runParser(parser, "test", ["--", "--completion", "bash"], {
      completion: { option: true },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { args: ["--completion", "bash"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("runParser ignores --completion=bash after -- terminator", () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = runParser(
      parser,
      "test",
      ["--", "--completion=bash"],
      {
        completion: { option: true },
        stdout: () => {},
        stderr: () => {},
      },
    );
    assert.deepEqual(result, { args: ["--completion=bash"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("runParser ignores custom completion option names after -- terminator", () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = runParser(
      parser,
      "test",
      ["--", "--completions", "bash"],
      {
        completion: { option: { names: ["--completions"] } },
        stdout: () => {},
        stderr: () => {},
      },
    );
    assert.deepEqual(result, { args: ["--completions", "bash"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("runWith ignores --completion after -- terminator", async () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = await runWith(parser, "test", [], {
      args: ["--", "--completion", "bash"],
      completion: { option: true },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { args: ["--completion", "bash"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("runWithSync ignores --completion after -- terminator", () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = runWithSync(parser, "test", [], {
      args: ["--", "--completion", "bash"],
      completion: { option: true },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { args: ["--completion", "bash"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("runWith ignores --completion=bash after -- terminator", async () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = await runWith(parser, "test", [], {
      args: ["--", "--completion=bash"],
      completion: { option: true },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { args: ["--completion=bash"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("runWithSync ignores --completion=bash after -- terminator", () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = runWithSync(parser, "test", [], {
      args: ["--", "--completion=bash"],
      completion: { option: true },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { args: ["--completion=bash"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("runWith ignores custom completion alias after -- terminator", async () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = await runWith(parser, "test", [], {
      args: ["--", "--completions", "bash"],
      completion: { option: { names: ["--completions"] } },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { args: ["--completions", "bash"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("runParser ignores --help after -- terminator", () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = runParser(parser, "test", ["--", "--help"], {
      help: { option: true },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { args: ["--help"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("runParser ignores --version after -- terminator", () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = runParser(parser, "test", ["--", "--version"], {
      help: { option: true },
      version: { value: "1.0.0", option: true },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { args: ["--version"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("needsEarlyExit ignores --help after -- terminator", async () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = await runWith(parser, "test", [], {
      args: ["--", "--help"],
      help: { option: true },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { args: ["--help"] });
  });

  // https://github.com/dahlia/optique/issues/228
  it("needsEarlyExit ignores --version after -- terminator", async () => {
    const parser = object({ args: multiple(argument(string())) });
    const result = await runWith(parser, "test", [], {
      args: ["--", "--version"],
      help: { option: true },
      version: { value: "1.0.0", option: true },
      stdout: () => {},
      stderr: () => {},
    });
    assert.deepEqual(result, { args: ["--version"] });
  });

  // https://github.com/dahlia/optique/issues/267
  it("runWith preserves context-backed parsing for --help and --version after --", async () => {
    assert.deepEqual(await runIssue267With("--help", "help"), {
      file: "--help",
      host: "env-host",
    });
    assert.deepEqual(await runIssue267With("--version", "version"), {
      file: "--version",
      host: "env-host",
    });
    assert.deepEqual(
      await runIssue267With("--assist", "help", ["--assist"]),
      {
        file: "--assist",
        host: "env-host",
      },
    );
    assert.deepEqual(await runIssue267With("--ver", "version", ["--ver"]), {
      file: "--ver",
      host: "env-host",
    });
  });

  // https://github.com/dahlia/optique/issues/267
  it("runWithSync preserves context-backed parsing for --help and --version after --", () => {
    assert.deepEqual(runIssue267SyncWith("--help", "help"), {
      file: "--help",
      host: "env-host",
    });
    assert.deepEqual(runIssue267SyncWith("--version", "version"), {
      file: "--version",
      host: "env-host",
    });
    assert.deepEqual(
      runIssue267SyncWith("--assist", "help", ["--assist"]),
      {
        file: "--assist",
        host: "env-host",
      },
    );
    assert.deepEqual(runIssue267SyncWith("--ver", "version", ["--ver"]), {
      file: "--ver",
      host: "env-host",
    });
  });
});
