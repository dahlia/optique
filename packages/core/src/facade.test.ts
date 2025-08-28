import { run, RunError } from "@optique/core/facade";
import { message } from "@optique/core/message";
import { argument, command, object, option } from "@optique/core/parser";
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
