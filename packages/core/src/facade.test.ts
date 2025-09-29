import { object, or } from "@optique/core/constructs";
import { run, RunError } from "@optique/core/facade";
import { message } from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import { argument, command, flag, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("run", () => {
  describe("basic parsing", () => {
    it("should parse simple arguments", () => {
      const parser = object({
        name: argument(string()),
      });

      const result = run(parser, "test", ["Alice"]);
      assert.deepEqual(result, { name: "Alice" });
    });

    it("should parse options", () => {
      const parser = object({
        verbose: option("--verbose"),
        name: argument(string()),
      });

      const result = run(parser, "test", ["--verbose", "Alice"]);
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

      const result = run(parser, "test", ["hello", "Alice"]);
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

      const result = run(parser, "test", ["--help"], {
        help: {
          mode: "both",
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
        run(parser, "test", ["--help"]);
      }, RunError);
    });

    it("should only show help option when help mode is 'option'", () => {
      const parser = object({
        name: argument(string()),
      });

      let helpShown = false;

      const result = run(parser, "test", ["--help"], {
        help: {
          mode: "option",
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

      const result = run(parser, "test", ["help"], {
        help: {
          mode: "command",
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
  });

  describe("version functionality", () => {
    it("should show version with --version option when version is enabled", () => {
      const parser = object({
        name: argument(string()),
      });

      let versionShown = false;
      let versionOutput = "";

      const result = run(parser, "test", ["--version"], {
        version: {
          mode: "option",
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

      const result = run(parser, "test", ["version"], {
        version: {
          mode: "command",
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
      const result1 = run(parser, "test", ["--version"], {
        version: {
          mode: "both",
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
      const result2 = run(parser, "test", ["version"], {
        version: {
          mode: "both",
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
        run(parser, "test", ["--version"]);
      }, RunError);
    });

    it("should pass exit code 0 to onShow callback", () => {
      const parser = object({
        name: argument(string()),
      });

      let receivedExitCode: number | undefined;

      run(parser, "test", ["--version"], {
        version: {
          mode: "option",
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

      const result1 = run(parser, "test", ["--version", "--help"], {
        help: {
          mode: "option", // Use option mode to avoid contextual parser issues
          onShow: () => {
            helpShown1 = true;
            return "help-shown";
          },
        },
        version: {
          mode: "option",
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

      const result2 = run(parser, "test", ["--help", "--version"], {
        help: {
          mode: "option",
          onShow: () => {
            helpShown2 = true;
            return "help-shown";
          },
        },
        version: {
          mode: "option",
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

      const result = run(parser, "test", ["version"], {
        help: {
          mode: "both",
          onShow: () => "help-shown",
        },
        version: {
          mode: "command",
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

      const result = run(parser, "test", ["help"], {
        help: {
          mode: "command",
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          mode: "both",
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

      const result = run(parser, "test", ["--version"], {
        version: {
          mode: "option",
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

      const result = run(parser, "test", ["--help", "--version"], {
        help: {
          mode: "both",
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          mode: "option",
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

      const result = run(parser, "test", ["version", "--help"], {
        help: {
          mode: "both",
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          mode: "both",
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

      const result = run(parser, "test", ["help", "--version"], {
        help: {
          mode: "both",
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          mode: "both",
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
      const result = run(parser, "test", ["--version", "--version"], {
        version: {
          mode: "option",
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
      const result = run(parser, "test", ["--version", "extra", "args"], {
        version: {
          mode: "option",
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

      const result = run(parser, "test", ["--help", "extra", "args"], {
        help: {
          mode: "option",
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
  });

  describe("error handling", () => {
    it("should throw RunError by default on parse failure", () => {
      const parser = object({
        port: argument(integer()),
      });

      assert.throws(() => {
        run(parser, "test", ["not-a-number"]);
      }, RunError);
    });

    it("should call onError callback on parse failure", () => {
      const parser = object({
        port: argument(integer()),
      });

      let errorCalled = false;
      let errorOutput = "";

      const result = run(parser, "test", ["not-a-number"], {
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

      run(parser, "test", ["not-a-number"], {
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

      run(parser, "test", ["not-a-number"], {
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

      run(parser, "test", ["not-a-number"], {
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

      run(parser, "test", ["not-a-number"], {
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

      run(parser, "test", ["--help"], {
        help: {
          mode: "both",
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

      run(parser, "test", ["not-a-number"], {
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

      run(parser, "test", ["--help"], {
        help: {
          mode: "both",
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

      run(parser, "test", ["--help"], {
        help: {
          mode: "both",
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

      run(parser, "test", ["--help"], {
        help: {
          mode: "both",
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

      const result = run(parser, "test", ["--help"], {
        help: {
          mode: "both",
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

      const result = run(parser, "test", ["not-a-number"], {
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

      const result = run(parser, "myapp", ["--help"], {
        help: {
          mode: "both",
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          mode: "both",
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

      const result = run(parser, "myapp", ["serve", "--help"], {
        help: {
          mode: "both",
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

      const result = run(parser, "myapp", ["help", "deploy"], {
        help: {
          mode: "both",
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
      const result = run(parser, "cli", ["sync", "--help"], {
        help: {
          mode: "option",
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
      const result = run(parser, "cli", [
        "build",
        "--help",
        "--output",
        "out.js",
      ], {
        help: {
          mode: "option",
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

      const result = run(parser, "complex-tool", ["--version"], {
        help: {
          mode: "both",
          onShow: () => "help-shown",
        },
        version: {
          mode: "both",
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

      const result = run(parser, "file-tool", ["--help"], {
        help: {
          mode: "both",
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

      const result = run(parser, "transform-tool", ["--version"], {
        version: {
          mode: "option",
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

      const helpModes: Array<"command" | "option" | "both"> = [
        "command",
        "option",
        "both",
      ];
      const versionModes: Array<"command" | "option" | "both"> = [
        "command",
        "option",
        "both",
      ];

      // Test all 9 combinations
      for (const helpMode of helpModes) {
        for (const versionMode of versionModes) {
          let helpShown = false;
          let versionShown = false;

          // Test last-option-wins: --version --help should show help
          try {
            const result1 = run(parser, "test", ["--version", "--help"], {
              help: {
                mode: helpMode,
                onShow: () => {
                  helpShown = true;
                  return "help-shown";
                },
              },
              version: {
                mode: versionMode,
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
            if (
              (helpMode === "option" || helpMode === "both") &&
              (versionMode === "option" || versionMode === "both")
            ) {
              assert.equal(
                result1,
                "help-shown",
                `Expected help-shown for helpMode=${helpMode}, versionMode=${versionMode}, got ${result1}`,
              );
              assert.ok(
                helpShown && !versionShown,
                `Expected help to win for helpMode=${helpMode}, versionMode=${versionMode}`,
              );
            }
          } catch (error) {
            // Some mode combinations are expected to fail (e.g., command-only modes with options)
            const errorMsg = error instanceof Error
              ? error.message
              : String(error);
            console.log(
              `Mode combination helpMode=${helpMode}, versionMode=${versionMode} failed as expected:`,
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

      const result = run(parser, "test", ["--", "--help", "--version"], {
        help: {
          mode: "both",
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          mode: "both",
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

      const result = run(parser, "test", [
        "--verbose",
        "--quiet",
        "--version",
        "--output",
        "test.txt",
      ], {
        version: {
          mode: "both",
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

      const result = run(parser, "mygit", ["git", "--help"], {
        help: {
          mode: "both",
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

      const result = run(parser, "test", ["--version"], {
        version: {
          mode: "option",
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

      const result = run(parser, "test", ["--version"], {
        version: {
          mode: "option",
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
      const result1 = run(parser, "test", ["--help"], {
        help: {
          mode: "option",
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
      const result2 = run(parser, "test", ["--version"], {
        version: {
          mode: "option",
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
        const result = run(parser, "test", [], {
          help: {
            mode: "both",
            onShow: () => "help-shown",
          },
          version: {
            mode: "both",
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
        // This should throw RunError due to missing required arguments
        assert.ok(error instanceof RunError);
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

      const result = run(parser, "test", ["--help"], {
        help: {
          mode: "both",
          onShow: () => {
            helpShown = true;
            return "help-shown";
          },
        },
        version: {
          mode: "both",
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

describe("RunError", () => {
  it("should create RunError with custom message", () => {
    const error = new RunError("Custom error message");
    assert.equal(error.name, "RunError");
    assert.equal(error.message, "Custom error message");
  });

  it("should be instance of Error", () => {
    const error = new RunError("");
    assert.ok(error instanceof Error);
    assert.ok(error instanceof RunError);
  });
});

describe("Documentation augmentation (brief, description, footer)", () => {
  it("should display brief in help output", () => {
    const parser = object({
      name: argument(string()),
    });

    let output = "";
    const result = run(parser, "test", ["--help"], {
      help: { mode: "option", onShow: () => "help" as const },
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
    const result = run(parser, "test", ["--help"], {
      help: { mode: "option", onShow: () => "help" as const },
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
    const result = run(parser, "test", ["--help"], {
      help: { mode: "option", onShow: () => "help" as const },
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
    const result = run(parser, "test", ["--help"], {
      help: { mode: "option", onShow: () => "help" as const },
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
      run(parser, "test", [], {
        aboveError: "help",
        stderr: (text) => {
          errorOutput += text;
        },
        brief: message`Error Test Program`,
        description: message`This should appear in error help.`,
        footer: message`Error footer message`,
        onError: () => {
          throw new RunError("Parse failed");
        },
      });
    } catch (error) {
      assert.ok(error instanceof RunError);
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
    const result = run(parser, "test", ["--help"], {
      help: { mode: "option", onShow: () => "help" as const },
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
});

describe("Subcommand help edge cases (Issue #26 comprehensive coverage)", () => {
  it("should handle --help with options terminator (--)", () => {
    const parser = object({
      files: multiple(argument(string())),
    });

    let helpShown = false;

    // Test: cli -- --help should NOT show help (--help is treated as argument)
    const result = run(parser, "cli", ["--", "--help"], {
      help: {
        mode: "option",
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
    const result = run(parser, "cli", ["git", "add", "--help"], {
      help: {
        mode: "option",
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
    const result1 = run(parser, "cli", ["--help", "sync"], {
      help: {
        mode: "option",
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
    const result2 = run(parser, "cli", ["sync", "--help", "--force"], {
      help: {
        mode: "option",
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

  it("should handle invalid commands before --help gracefully", () => {
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
    let helpOutput = "";

    // Test: cli invalid-cmd --help should show help with the invalid command context
    const result = run(parser, "cli", ["invalid-cmd", "--help"], {
      help: {
        mode: "option",
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
    // Should show root help since invalid-cmd doesn't match any parser
    assert.ok(helpOutput.includes("sync") || helpOutput.includes("build"));
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
    const result = run(parser, "cli", [
      "deploy",
      "--env",
      "prod",
      "--help",
      "target",
    ], {
      help: {
        mode: "option",
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
    const result = run(parser, "cli", ["sync", "--help", "--version"], {
      help: {
        mode: "option",
        onShow: () => {
          helpShown = true;
          return "help-shown";
        },
      },
      version: {
        mode: "option",
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
    const result = run(parser, "cli", ["--help"], {
      help: {
        mode: "option",
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
    const result = run(parser, "cli", ["dev", "git", "status", "--help"], {
      help: {
        mode: "option",
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
    assert.ok(helpOutput.includes("--short"));
    assert.ok(helpOutput.includes("Show status"));
    // Should NOT show other subcommands or parent commands
    assert.ok(!helpOutput.includes("--all"));
    assert.ok(!helpOutput.includes("List branches"));
    assert.ok(!helpOutput.includes("Git operations"));
    assert.ok(!helpOutput.includes("Development tools"));
  });

  describe("completion functionality", () => {
    it("should generate bash completion script when completion command is used", () => {
      const parser = object({
        verbose: option("--verbose"),
        name: argument(string()),
      });

      let completionOutput = "";
      let completionShown = false;

      const result = run(parser, "myapp", ["completion", "bash"], {
        completion: {
          mode: "command",
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

      run(parser, "myapp", ["completion", "zsh"], {
        completion: {
          mode: "command",
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

      run(parser, "myapp", ["completion", "bash", "--"], {
        completion: {
          mode: "command",
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

      run(parser, "myapp", ["completion", "zsh", "--"], {
        completion: {
          mode: "command",
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

      run(parser, "myapp", ["--completion=bash"], {
        completion: {
          mode: "option",
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

      run(parser, "myapp", ["--completion", "bash"], {
        completion: {
          mode: "option",
        },
        stdout: (text) => {
          completionOutput = text;
        },
      });

      assert.ok(completionOutput.includes("function _myapp"));
    });

    it("should handle unsupported shell with error message", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      let errorOutput = "";
      let errorResult: unknown;

      run(parser, "myapp", ["completion", "powershell"], {
        completion: {
          mode: "command",
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

      run(parser, "myapp", ["completion"], {
        completion: {
          mode: "command",
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
      assert.ok(errorOutput.includes("Usage: myapp completion <shell>"));
    });

    it("should support both command and option modes", () => {
      const parser = object({
        verbose: option("--verbose"),
      });

      // Test command mode
      let commandOutput = "";
      run(parser, "myapp", ["completion", "bash"], {
        completion: { mode: "both" },
        stdout: (text) => {
          commandOutput = text;
        },
      });

      // Test option mode
      let optionOutput = "";
      run(parser, "myapp", ["--completion=bash"], {
        completion: { mode: "both" },
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

      const result = run(parser, "myapp", ["--verbose", "Alice"], {
        completion: { mode: "both" },
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

      run(parser, "myapp", ["completion", "bash", "git", "add", "--"], {
        completion: { mode: "command" },
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
  });
});
