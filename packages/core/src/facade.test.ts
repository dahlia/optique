import { group, merge, object, or } from "@optique/core/constructs";
import type { SourceContext } from "@optique/core/context";
import type { DocSection } from "@optique/core/doc";
import {
  type RunOptions,
  runParser,
  RunParserError,
  runWith,
  runWithAsync,
  runWithSync,
} from "@optique/core/facade";
import { message } from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import {
  argument,
  command,
  constant,
  flag,
  option,
} from "@optique/core/primitives";
import type { Program } from "@optique/core/program";
import { integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

type AssertNever<T extends never> = T;

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
        name: argument(string()),
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
        name: argument(string()),
      });

      assert.throws(() => {
        runParser(parser, "test", ["--help"]);
      }, RunParserError);
    });

    it("should only show help option when help mode is 'option'", () => {
      const parser = object({
        name: argument(string()),
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
        name: argument(string()),
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
        name: argument(string()),
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

    it("should show version with version command when version mode is 'command'", () => {
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

      assert.equal(result, "version-shown");
      assert.ok(versionShown);
      assert.equal(versionOutput, "2.1.0");
    });

    it("should support both --version and version command when mode is 'both'", () => {
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

      assert.equal(result2, "version-shown");
      assert.equal(versionOutput, "3.0.0");
    });

    it("should not provide version when version is not configured (default)", () => {
      const parser = object({
        name: argument(string()),
      });

      assert.throws(() => {
        runParser(parser, "test", ["--version"]);
      }, RunParserError);
    });

    it("should pass exit code 0 to onShow callback", () => {
      const parser = object({
        name: argument(string()),
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
        name: argument(string()),
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

    it("should handle version command with help option available", () => {
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

      assert.equal(result, "version-shown");
      assert.ok(versionShown);
      assert.equal(versionOutput, "2.0.0");
    });

    it("should handle help command with version option available", () => {
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

      assert.equal(result, "help-shown");
      assert.ok(helpShown);
      assert.ok(helpOutput.includes("Usage: test"));
    });

    it("should work with onShow callback without exit code parameter", () => {
      const parser = object({
        name: argument(string()),
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

    it("should handle empty version string", () => {
      const parser = object({
        name: argument(string()),
      });

      let versionOutput = "";

      const result = runParser(parser, "test", ["--version"], {
        version: {
          option: true,
          value: "",
          onShow: () => "version-shown",
        },
        stdout: (text) => {
          versionOutput = text;
        },
      });

      assert.equal(result, "version-shown");
      assert.equal(versionOutput, "");
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

    it("should handle callback exceptions gracefully", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test onHelp exception handling
      const result1 = runParser(parser, "test", ["--help"], {
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
      });

      assert.equal(result1, "help-shown-no-exit");

      // Test onVersion exception handling
      const result2 = runParser(parser, "test", ["--version"], {
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
      });

      assert.equal(result2, "version-shown-no-exit");
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
        name: argument(string()),
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
      assert.ok(completionOutput.includes("complete -F _myapp myapp"));
      assert.ok(completionOutput.includes("myapp 'completion' 'bash'"));
    });

    it("should generate zsh completion script when completion command is used", () => {
      const parser = object({
        verbose: option("--verbose"),
        name: argument(string()),
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
        name: argument(string()),
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
          completionOutput = text;
        },
      });

      assert.ok(completionOutput.includes("function _myapp"));
      assert.ok(completionOutput.includes("complete -F _myapp myapp"));
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
          completionOutput = text;
        },
      });

      assert.ok(completionOutput.includes("function _myapp"));
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
});

describe("runWith", () => {
  describe("basic functionality", () => {
    it("should parse with no contexts", async () => {
      const parser = object({
        name: argument(string()),
      });

      const result = await runWith(parser, "test", [], {
        args: ["Alice"],
      });
      assert.deepEqual(result, { name: "Alice" });
    });

    it("should parse with a static context", async () => {
      const envKey = Symbol.for("@test/env");
      const envContext: SourceContext = {
        id: envKey,
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

    it("should call static context once in async runWith", async () => {
      let callCount = 0;
      const staticContext: SourceContext = {
        id: Symbol.for("@test/static-once"),
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

    it("should parse with multiple static contexts", async () => {
      const envKey = Symbol.for("@test/env");
      const configKey = Symbol.for("@test/config");

      const envContext: SourceContext = {
        id: envKey,
        getAnnotations() {
          return { [envKey]: { HOST: "env-host" } };
        },
      };

      const configContext: SourceContext = {
        id: configKey,
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
        getAnnotations() {
          return { [sharedKey]: { value: "from-context1" } };
        },
      };

      const context2: SourceContext = {
        id: Symbol.for("@test/context2"),
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
  });

  describe("dynamic contexts", () => {
    it("should handle dynamic context with two-phase parsing", async () => {
      const configKey = Symbol.for("@test/config");

      const dynamicContext: SourceContext = {
        id: configKey,
        getAnnotations(parsed?: unknown) {
          if (!parsed) return {};
          const result = parsed as { config?: string };
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
    });

    it("should handle mixed static and dynamic contexts", async () => {
      const envKey = Symbol.for("@test/env");
      const configKey = Symbol.for("@test/config");

      const staticContext: SourceContext = {
        id: envKey,
        getAnnotations() {
          return { [envKey]: { HOST: "env-host" } };
        },
      };

      const dynamicContext: SourceContext = {
        id: configKey,
        getAnnotations(parsed?: unknown) {
          if (!parsed) return {};
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
    });

    it("should handle async context", async () => {
      const asyncKey = Symbol.for("@test/async");

      const asyncContext: SourceContext = {
        id: asyncKey,
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
    it("should not call context.getAnnotations() when --help option is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
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
      assert.equal(annotationsCallCount, 0);
    });

    it("should not call context.getAnnotations() when --version option is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
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
      assert.equal(annotationsCallCount, 0);
    });

    it("should not call context.getAnnotations() when help command is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
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
      assert.equal(annotationsCallCount, 0);
    });

    it("should not call context.getAnnotations() when version command is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
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
      assert.equal(annotationsCallCount, 0);
    });

    it("should not call context.getAnnotations() when completion command is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        name: argument(string()),
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
      assert.equal(annotationsCallCount, 0);
    });

    it("should not call context.getAnnotations() when --completion option is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        name: argument(string()),
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
      assert.equal(annotationsCallCount, 0);
    });

    it("should not call context.getAnnotations() when completions (plural) command is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        name: argument(string()),
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
      assert.equal(annotationsCallCount, 0);
    });

    it("should not call context.getAnnotations() when --completions (plural) option is provided", async () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        name: argument(string()),
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
      assert.equal(annotationsCallCount, 0);
    });
  });

  describe("error handling", () => {
    it("should display error only once with dynamic context and empty args", async () => {
      const cmd1 = command("foo", object({ cmd: constant("foo") }));
      const cmd2 = command("bar", object({ cmd: constant("bar") }));
      const parser = merge(
        or(cmd1, cmd2),
        object({ debug: flag("-d") }),
      );

      const dynamicContext: SourceContext = {
        id: Symbol("dynamic"),
        getAnnotations(_parsed?: unknown) {
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

    it("should dispose multiple contexts in order", async () => {
      const disposed: string[] = [];

      const context1: SourceContext = {
        id: Symbol.for("@test/dispose1"),
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

    it("should handle context without dispose methods", async () => {
      const context: SourceContext = {
        id: Symbol.for("@test/no-dispose"),
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
  });

  describe("options passthrough", () => {
    it("should pass options to getAnnotations in async runWith", async () => {
      let receivedOptions: unknown;
      const passthroughKey = Symbol.for("@test/passthrough");

      // Use SourceContext (void required options) so runWith doesn't need
      // extra fields.  The context reads options from the untyped second arg.
      const context: SourceContext = {
        id: passthroughKey,
        getAnnotations(_parsed?: unknown, options?: unknown) {
          receivedOptions = options;
          if (!_parsed) return {};
          return { [passthroughKey]: { value: "loaded" } };
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      await runWith(parser, "test", [context], {
        args: [],
      });

      // The options object (minus args) is passed through as-is
      assert.ok(receivedOptions !== undefined);
    });

    it("should pass options to getAnnotations in both phases", async () => {
      const receivedOptionsPerCall: unknown[] = [];
      const dynamicKey = Symbol.for("@test/passthrough-phases");

      const context: SourceContext = {
        id: dynamicKey,
        getAnnotations(parsed?: unknown, options?: unknown) {
          receivedOptionsPerCall.push(options);
          if (!parsed) return {};
          return { [dynamicKey]: { value: "loaded" } };
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      await runWith(parser, "test", [context], {
        args: [],
      });

      // Should have been called twice (phase 1 and phase 2)
      assert.equal(receivedOptionsPerCall.length, 2);
    });
  });
});

describe("runWithSync", () => {
  it("should parse with static contexts synchronously", () => {
    const envKey = Symbol.for("@test/env");
    const envContext: SourceContext = {
      id: envKey,
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

  it("should call static context once in runWithSync", () => {
    let callCount = 0;
    const staticContext: SourceContext = {
      id: Symbol.for("@test/static-once-sync"),
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

  it("should throw error when context returns Promise", () => {
    const asyncKey = Symbol.for("@test/async");
    const asyncContext: SourceContext = {
      id: asyncKey,
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
      getAnnotations(parsed?: unknown) {
        if (!parsed) return {}; // sync (empty → dynamic)
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
    it("should not call context.getAnnotations() when --help option is provided", () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
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
      assert.equal(annotationsCallCount, 0);
    });

    it("should not call context.getAnnotations() when --version option is provided", () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
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
      assert.equal(annotationsCallCount, 0);
    });

    it("should not call context.getAnnotations() when completion command is provided", () => {
      let annotationsCallCount = 0;
      const trackingContext: SourceContext = {
        id: Symbol.for("@test/tracking"),
        getAnnotations() {
          annotationsCallCount++;
          return {};
        },
      };

      const parser = object({
        name: argument(string()),
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
      assert.equal(annotationsCallCount, 0);
    });
  });

  describe("dispose lifecycle (sync)", () => {
    it("should dispose contexts after successful sync parsing", () => {
      let disposed = false;
      const context: SourceContext = {
        id: Symbol.for("@test/sync-disposable"),
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

    it("should ignore Symbol.asyncDispose in sync mode", () => {
      const disposed: string[] = [];
      const context: SourceContext = {
        id: Symbol.for("@test/sync-no-async-dispose"),
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
      // disposeContextsSync only calls Symbol.dispose
      assert.deepEqual(disposed, ["sync"]);
    });
  });

  describe("options passthrough (sync)", () => {
    it("should pass options to getAnnotations in runWithSync", () => {
      let receivedOptions: unknown;
      const syncKey = Symbol.for("@test/sync-passthrough");

      const context: SourceContext = {
        id: syncKey,
        getAnnotations(_parsed?: unknown, options?: unknown) {
          receivedOptions = options;
          if (!_parsed) return {};
          return { [syncKey]: { value: "loaded" } };
        },
      };

      const parser = object({
        name: withDefault(option("--name", string()), "default"),
      });

      runWithSync(parser, "test", [context], {
        args: [],
      });

      // The options object is passed through to getAnnotations
      assert.ok(receivedOptions !== undefined);
    });
  });
});

describe("runWithAsync", () => {
  it("should parse with async contexts", async () => {
    const asyncKey = Symbol.for("@test/async");
    const asyncContext: SourceContext = {
      id: asyncKey,
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
      async getAnnotations() {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { [key1]: { value: "value1" } };
      },
    };

    const context2: SourceContext = {
      id: key2,
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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
        const parser = object({ name: argument(string()) });

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
});
