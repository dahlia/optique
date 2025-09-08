import { message, metavar, optionName, values } from "@optique/core/message";
import { createPrinter, print, printError } from "./print.ts";
import type { PrintErrorOptions, PrintOptions } from "./print.ts";
import assert from "node:assert/strict";
import process from "node:process";
import { describe, it } from "node:test";

// Simple mock function that works in both Deno and Node.js
function createMockFn(): {
  fn: (...args: unknown[]) => void;
  calls: { arguments: unknown[] }[];
} {
  const calls: { arguments: unknown[] }[] = [];
  const fn = (...args: unknown[]) => {
    calls.push({ arguments: args });
  };
  return { fn, calls };
}

describe("print module", () => {
  describe("print function", () => {
    it("should write to stdout with automatic formatting", () => {
      // Mock process.stdout.write
      const writeMock = createMockFn();
      const originalWrite = process.stdout.write;
      process.stdout.write = writeMock.fn as typeof process.stdout.write;

      // Mock TTY detection
      const originalIsTTY = process.stdout.isTTY;
      process.stdout.isTTY = true;

      try {
        const msg = message`Hello ${"world"}!`;
        print(msg);

        assert.strictEqual(writeMock.calls.length, 1);
        const output = writeMock.calls[0].arguments[0] as string;
        assert.ok(typeof output === "string");
        // TTY environment should produce colored output with quotes
        assert.strictEqual(output, 'Hello \x1b[32m"world"\x1b[0m!\n');
      } finally {
        // Restore original functions
        process.stdout.write = originalWrite;
        process.stdout.isTTY = originalIsTTY;
      }
    });

    it("should respect custom formatting options", () => {
      const writeMock = createMockFn();
      const originalWrite = process.stdout.write;
      process.stdout.write = writeMock.fn as typeof process.stdout.write;

      try {
        const msg = message`Using ${optionName("--verbose")} option`;
        print(msg, { colors: false, quotes: false });

        assert.strictEqual(writeMock.calls.length, 1);
        const output = writeMock.calls[0].arguments[0] as string;
        // With colors: false and quotes: false, should be plain text
        assert.strictEqual(output, "Using --verbose option\n");
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it("should write to stderr when stream option is specified", () => {
      const stderrWriteMock = createMockFn();
      const originalStderrWrite = process.stderr.write;
      process.stderr.write = stderrWriteMock.fn as typeof process.stderr.write;

      try {
        const msg = message`Debug info`;
        print(msg, { stream: "stderr" });

        assert.strictEqual(stderrWriteMock.calls.length, 1);
        const output = stderrWriteMock.calls[0].arguments[0] as string;
        // With no colors (default for stderr output), should be plain text with quotes
        assert.strictEqual(output, "Debug info\n");
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });
  });

  describe("printError function", () => {
    it("should write to stderr with Error prefix", () => {
      const stderrWriteMock = createMockFn();
      const originalStderrWrite = process.stderr.write;
      process.stderr.write = stderrWriteMock.fn as typeof process.stderr.write;

      // Mock TTY detection for stderr
      const originalIsTTY = process.stderr.isTTY;
      process.stderr.isTTY = true;

      try {
        const msg = message`File ${"config.json"} not found`;
        printError(msg);

        assert.strictEqual(stderrWriteMock.calls.length, 1);
        const output = stderrWriteMock.calls[0].arguments[0] as string;
        assert.ok(output.startsWith("Error: "));
        assert.ok(output.includes("File"));
        assert.ok(output.includes("config.json"));
      } finally {
        process.stderr.write = originalStderrWrite;
        process.stderr.isTTY = originalIsTTY;
      }
    });

    it("should use quotes in non-TTY environments by default", () => {
      const stderrWriteMock = createMockFn();
      const originalStderrWrite = process.stderr.write;
      process.stderr.write = stderrWriteMock.fn as typeof process.stderr.write;

      // Mock non-TTY environment
      const originalIsTTY = process.stderr.isTTY;
      process.stderr.isTTY = false;

      try {
        const msg = message`Invalid ${optionName("--port")} value`;
        printError(msg);

        assert.strictEqual(stderrWriteMock.calls.length, 1);
        const output = stderrWriteMock.calls[0].arguments[0] as string;
        // Should contain backticks in non-TTY environment
        assert.ok(output.includes("`--port`"));
      } finally {
        process.stderr.write = originalStderrWrite;
        process.stderr.isTTY = originalIsTTY;
      }
    });

    it("should exit with specified exit code", () => {
      const exitMock = createMockFn();
      const originalExit = process.exit;
      process.exit = exitMock.fn as typeof process.exit;

      const stderrWriteMock = createMockFn();
      const originalStderrWrite = process.stderr.write;
      process.stderr.write = stderrWriteMock.fn as typeof process.stderr.write;

      try {
        const msg = message`Critical error`;
        printError(msg, { exitCode: 2 });

        assert.strictEqual(stderrWriteMock.calls.length, 1);
        assert.strictEqual(exitMock.calls.length, 1);
        assert.strictEqual(exitMock.calls[0].arguments[0], 2);
      } finally {
        process.exit = originalExit;
        process.stderr.write = originalStderrWrite;
      }
    });

    it("should not exit when no exit code is specified", () => {
      const exitMock = createMockFn();
      const originalExit = process.exit;
      process.exit = exitMock.fn as typeof process.exit;

      const stderrWriteMock = createMockFn();
      const originalStderrWrite = process.stderr.write;
      process.stderr.write = stderrWriteMock.fn as typeof process.stderr.write;

      try {
        const msg = message`Warning message`;
        printError(msg);

        assert.strictEqual(stderrWriteMock.calls.length, 1);
        assert.strictEqual(exitMock.calls.length, 0);
      } finally {
        process.exit = originalExit;
        process.stderr.write = originalStderrWrite;
      }
    });
  });

  describe("createPrinter function", () => {
    it("should create a printer with default options", () => {
      const writeMock = createMockFn();
      const originalWrite = process.stdout.write;
      process.stdout.write = writeMock.fn as typeof process.stdout.write;

      const originalIsTTY = process.stdout.isTTY;
      process.stdout.isTTY = true;

      try {
        const printer = createPrinter();
        const msg = message`Created printer`;

        printer(msg);

        assert.strictEqual(writeMock.calls.length, 1);
        const output = writeMock.calls[0].arguments[0] as string;
        assert.ok(output.includes("Created printer"));
      } finally {
        process.stdout.write = originalWrite;
        process.stdout.isTTY = originalIsTTY;
      }
    });

    it("should create a printer with custom options", () => {
      const stderrWriteMock = createMockFn();
      const originalStderrWrite = process.stderr.write;
      process.stderr.write = stderrWriteMock.fn as typeof process.stderr.write;

      try {
        const printer = createPrinter({
          stream: "stderr",
          colors: false,
          quotes: true,
        });

        const msg = message`Using ${metavar("CONFIG")} file`;
        printer(msg);

        assert.strictEqual(stderrWriteMock.calls.length, 1);
        const output = stderrWriteMock.calls[0].arguments[0] as string;
        // Should not contain color codes
        assert.ok(!output.includes("\x1b["));
        // Should contain backticks for metavar
        assert.ok(output.includes("`CONFIG`"));
      } finally {
        process.stderr.write = originalStderrWrite;
      }
    });

    it("should handle complex messages with multiple components", () => {
      const writeMock = createMockFn();
      const originalWrite = process.stdout.write;
      process.stdout.write = writeMock.fn as typeof process.stdout.write;

      try {
        const printer = createPrinter({ colors: false, quotes: false });
        const choices = ["red", "green", "blue"];
        const msg = message`Choose from ${values(choices)} for ${
          optionName("--color")
        }`;

        printer(msg);

        assert.strictEqual(writeMock.calls.length, 1);
        const output = writeMock.calls[0].arguments[0] as string;
        assert.ok(output.includes("Choose from"));
        assert.ok(output.includes("red"));
        assert.ok(output.includes("green"));
        assert.ok(output.includes("blue"));
        assert.ok(output.includes("--color"));
      } finally {
        process.stdout.write = originalWrite;
      }
    });

    it("should respect maxWidth option", () => {
      const writeMock = createMockFn();
      const originalWrite = process.stdout.write;
      process.stdout.write = writeMock.fn as typeof process.stdout.write;

      try {
        const printer = createPrinter({ maxWidth: 20 });
        const longMsg =
          message`This is a very long message that should be wrapped`;

        printer(longMsg);

        assert.strictEqual(writeMock.calls.length, 1);
        const output = writeMock.calls[0].arguments[0] as string;
        // Should contain newlines due to wrapping
        assert.ok(output.includes("\n"));
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  });

  describe("message composition", () => {
    it("should handle composed messages correctly", () => {
      const writeMock = createMockFn();
      const originalWrite = process.stdout.write;
      process.stdout.write = writeMock.fn as typeof process.stdout.write;

      try {
        const baseError = message`File ${"test.txt"} not found`;
        const contextualError = message`Operation failed: ${baseError}`;

        print(contextualError, { colors: false });

        assert.strictEqual(writeMock.calls.length, 1);
        const output = writeMock.calls[0].arguments[0] as string;
        assert.ok(output.includes("Operation failed:"));
        assert.ok(output.includes("File"));
        assert.ok(output.includes("test.txt"));
        assert.ok(output.includes("not found"));
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  });

  describe("type safety", () => {
    it("should enforce correct types for PrintOptions and PrintErrorOptions", () => {
      // Test that PrintOptions doesn't have exitCode
      const printOpts: PrintOptions = {
        colors: true,
        stream: "stdout",
        // exitCode: 1, // This should cause a TypeScript error
      };

      // Test that PrintErrorOptions has exitCode
      const printErrorOpts: PrintErrorOptions = {
        colors: false,
        stream: "stderr",
        exitCode: 2, // This should be valid
      };

      // Both should be usable with their respective functions
      print(message`Test message`, printOpts);

      // Mock to prevent actual exit
      const originalExit = process.exit;
      process.exit = (() => {}) as typeof process.exit;

      try {
        printError(message`Test error`, printErrorOpts);
      } finally {
        process.exit = originalExit;
      }
    });

    it("should return never type when exitCode is provided", () => {
      // Mock to prevent actual exit
      const originalExit = process.exit;
      process.exit = (() => {}) as typeof process.exit;

      try {
        // This should have return type 'never' when exitCode is provided
        const _result1: never = printError(message`Fatal error`, {
          exitCode: 1,
        });

        // This should have return type 'void' when exitCode is not provided
        const _result2: void = printError(message`Warning`);

        // TypeScript should enforce these types at compile time
        assert.ok(true, "Types are enforced at compile time");
      } finally {
        process.exit = originalExit;
      }
    });
  });
});
