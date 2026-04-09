import { longestMatch, object, or } from "@optique/core/constructs";
import type {
  ParserValuePlaceholder,
  SourceContext,
} from "@optique/core/context";
import { message } from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import {
  argument,
  command,
  constant,
  fail,
  option,
} from "@optique/core/primitives";
import type { Program } from "@optique/core/program";
import type { OptionName } from "@optique/core/usage";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import { integer, string } from "@optique/core/valueparser";
import type { DocSection } from "@optique/core/doc";
import type { RunOptions } from "@optique/run/run";
import { run, runAsync, runSync } from "@optique/run/run";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { bindConfig, createConfigContext } from "../../config/src/index.ts";
import { bindEnv, createEnvContext } from "../../env/src/index.ts";

const TEST_DIR = join(import.meta.dirname ?? ".", "test-configs");

function createPassthroughConfigSchema<T>(): Parameters<
  typeof createConfigContext<T>
>[0]["schema"] {
  return {
    "~standard": {
      version: 1,
      vendor: "optique-test",
      validate(input: unknown) {
        return { value: input as T };
      },
    },
  };
}

function createSyncConfigSchema(): Parameters<
  typeof createConfigContext<{ host: string; port: number }>
>[0]["schema"] {
  return createPassthroughConfigSchema<{ host: string; port: number }>();
}

interface ProgramPathContext extends
  SourceContext<{
    readonly getPath: (parsed: ParserValuePlaceholder) => string;
  }> {}

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
  return await run(parser, {
    args: ["--", token],
    programName: "test",
    contexts: [envContext],
    help: kind === "help"
      ? names == null ? "option" : { option: { names } }
      : "option",
    version: kind === "version"
      ? names == null ? "1.0.0" : { value: "1.0.0", option: { names } }
      : "1.0.0",
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
  return runSync(parser, {
    args: ["--", token],
    programName: "test",
    contexts: [envContext],
    help: kind === "help"
      ? names == null ? "option" : { option: { names } }
      : "option",
    version: kind === "version"
      ? names == null ? "1.0.0" : { value: "1.0.0", option: { names } }
      : "1.0.0",
    stdout: () => {},
    stderr: () => {},
  });
}

const issue183ContextKey = Symbol.for("@test/run-issue-183");

function createIssue183RunFixture() {
  const parser = or(
    object({ tag: constant("a" as const), silent: option("--silent") }),
    object({ tag: constant("b" as const), verbose: option("--verbose") }),
  );
  const context: SourceContext = {
    id: issue183ContextKey,
    phase: "single-pass",
    getAnnotations() {
      return { [issue183ContextKey]: true };
    },
  };
  return { parser, context };
}

describe("run", () => {
  describe("basic parsing", () => {
    it("should parse simple arguments when provided explicitly", () => {
      const parser = object({
        name: argument(string()),
      });

      const result = run(parser, {
        args: ["Alice"],
        programName: "test",
      });

      assert.deepEqual(result, { name: "Alice" });
    });

    it("should not crash or() with annotated initial state in runSync()", () => {
      const { parser, context } = createIssue183RunFixture();
      const result = runSync(parser, {
        args: ["--silent"],
        programName: "test",
        contexts: [context],
      });

      assert.deepEqual(result, { tag: "a", silent: true });
    });

    it("should not crash or() with annotated initial state in run()", async () => {
      const { parser, context } = createIssue183RunFixture();
      const result = await run(parser, {
        args: ["--silent"],
        programName: "test",
        contexts: [context],
      });

      assert.deepEqual(result, { tag: "a", silent: true });
    });

    it("should parse arguments with annotated single-pass contexts in runSync()", () => {
      const annotation = Symbol.for("@test/issue-187/run-runSync");
      const context: SourceContext = {
        id: annotation,
        phase: "single-pass",
        getAnnotations() {
          return { [annotation]: true };
        },
      };

      const result = runSync(argument(string()), {
        args: ["value"],
        programName: "test",
        contexts: [context],
      });

      assert.equal(result, "value");
    });

    it("should parse commands with annotated single-pass contexts in run()", async () => {
      const annotation = Symbol.for("@test/issue-187/run-run");
      const context: SourceContext = {
        id: annotation,
        phase: "single-pass",
        getAnnotations() {
          return { [annotation]: true };
        },
      };

      const result = await run(
        command("go", object({ silent: option("--silent") })),
        {
          args: ["go", "--silent"],
          programName: "test",
          contexts: [context],
        },
      );

      assert.deepEqual(result, { silent: true });
    });

    it("should parse options with custom program name", () => {
      const parser = object({
        verbose: option("--verbose"),
        count: option("-c", "--count", integer()),
        name: argument(string()),
      });

      const result = run(parser, {
        args: ["--verbose", "-c", "42", "Alice"],
        programName: "myapp",
      });

      assert.deepEqual(result, {
        verbose: true,
        count: 42,
        name: "Alice",
      });
    });

    it("should parse commands", () => {
      const parser = command(
        "greet",
        object({
          name: argument(string()),
          times: option("-t", "--times", integer()),
        }),
        {
          description: message`Greet someone`,
        },
      );

      const result = run(parser, {
        args: ["greet", "--times", "3", "Bob"],
        programName: "test",
      });

      assert.deepEqual(result, { name: "Bob", times: 3 });
    });
  });

  describe("options handling", () => {
    it("should use process defaults when options are omitted", () => {
      const parser = object({
        name: argument(string()),
      });
      const originalArgv = process.argv;
      process.argv = ["node", "/tmp/my-cli.ts", "DefaultName"];
      try {
        const result = run(parser);
        assert.deepEqual(result, { name: "DefaultName" });
      } finally {
        process.argv = originalArgv;
      }
    });

    it("should use provided options instead of defaults", () => {
      const parser = object({
        name: argument(string()),
      });

      const result = run(parser, {
        programName: "custom-program",
        args: ["test-value"],
        colors: false,
        maxWidth: 100,
      });

      assert.deepEqual(result, { name: "test-value" });
    });

    it("should execute default stdout/stderr/onExit handlers", () => {
      const parser = option("--verbose");
      const originalArgv = process.argv;
      const originalExit = process.exit;
      const originalStdoutWrite = process.stdout.write;
      const originalStderrWrite = process.stderr.write;
      const writes: string[] = [];

      process.argv = ["node", "/tmp/default-handlers.ts", "--help"];
      process.stdout.write = ((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      process.exit = ((code?: number) => {
        throw new Error(`EXIT:${code ?? 0}`);
      }) as typeof process.exit;

      try {
        assert.throws(
          () => {
            run(parser, {
              help: "option",
            });
          },
          /EXIT:0/,
        );
      } finally {
        process.argv = originalArgv;
        process.exit = originalExit;
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
      }

      assert.ok(
        writes.some((line) => line.includes("Usage: default-handlers.ts")),
      );
    });

    it("should use default help setting", () => {
      const parser = object({
        name: argument(string()),
      });

      // With default help: "none", help should not interfere with normal parsing
      const result = run(parser, {
        args: ["test-value"],
        programName: "test",
        // help omitted = no help functionality
      });

      assert.deepEqual(result, { name: "test-value" });
    });

    it("should route parse errors to injected stderr and onExit", () => {
      const parser = object({
        name: argument(string()),
      });

      let stderrOutput = "";
      let exitCode: number | undefined;

      assert.throws(
        () => {
          run(parser, {
            args: [],
            programName: "test",
            stderr: (text) => {
              stderrOutput += `${text}\n`;
            },
            onExit: (code) => {
              exitCode = code;
              throw new Error("EXIT");
            },
          });
        },
        /EXIT/,
      );

      assert.equal(exitCode, 1);
      assert.ok(stderrOutput.includes("Error:"));
    });

    it("should use default stderr writer on parse errors", () => {
      const parser = object({
        name: argument(string()),
      });
      const originalArgv = process.argv;
      const originalStderrWrite = process.stderr.write;
      process.argv = ["node", "/tmp/default-stderr.ts"];

      let stderrOutput = "";
      let exitCode: number | undefined;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrOutput += String(chunk);
        return true;
      }) as typeof process.stderr.write;

      try {
        assert.throws(
          () => {
            run(parser, {
              args: [],
              onExit: (code) => {
                exitCode = code;
                throw new Error("EXIT");
              },
            });
          },
          /EXIT/,
        );
      } finally {
        process.stderr.write = originalStderrWrite;
        process.argv = originalArgv;
      }

      assert.equal(exitCode, 1);
      assert.ok(stderrOutput.includes("Usage: default-stderr.ts"));
      assert.ok(stderrOutput.includes("Error:"));
    });

    it("should use custom errorExitCode with injected onExit", () => {
      const parser = object({
        name: argument(string()),
      });

      let exitCode: number | undefined;

      assert.throws(
        () => {
          run(parser, {
            args: [],
            programName: "test",
            errorExitCode: 7,
            stderr: () => {},
            onExit: (code) => {
              exitCode = code;
              throw new Error("EXIT");
            },
          });
        },
        /EXIT/,
      );

      assert.equal(exitCode, 7);
    });

    it("should route completion errors to injected stderr and onExit", () => {
      const parser = object({});
      let stderrOutput = "";
      let exitCode: number | undefined;

      assert.throws(
        () => {
          run(parser, {
            args: ["completion"],
            programName: "test",
            completion: "command",
            stderr: (text) => {
              stderrOutput += `${text}\n`;
            },
            onExit: (code) => {
              exitCode = code;
              throw new Error("EXIT");
            },
          });
        },
        /EXIT/,
      );

      assert.equal(exitCode, 1);
      assert.ok(stderrOutput.includes("Missing shell name for completion"));
    });

    it("should handle help command mode", () => {
      const parser = option("--verbose");
      let helpOutput = "";
      let exitCode: number | undefined;

      assert.throws(
        () => {
          run(parser, {
            args: ["help"],
            programName: "test",
            help: "command",
            stdout: (text) => {
              helpOutput += `${text}\n`;
            },
            onExit: (code) => {
              exitCode = code;
              throw new Error("EXIT");
            },
          });
        },
        /EXIT/,
      );

      assert.ok(helpOutput.includes("test"));
      assert.equal(exitCode, 0);
    });

    it("should support help object configuration", () => {
      const parser = option("--verbose");
      let helpOutput = "";
      let exitCode: number | undefined;

      assert.throws(
        () => {
          run(parser, {
            args: ["--help"],
            programName: "test",
            help: { option: true },
            stdout: (text) => {
              helpOutput += `${text}\n`;
            },
            onExit: (code) => {
              exitCode = code;
              throw new Error("EXIT");
            },
          });
        },
        /EXIT/,
      );

      assert.ok(helpOutput.includes("--verbose"));
      assert.equal(exitCode, 0);
    });
  });

  describe("version functionality", () => {
    it("should handle version as string with default option mode", () => {
      const parser = object({
        name: argument(string()),
      });

      let output = "";
      let exitCode: number | undefined;
      const options = {
        programName: "test",
        args: ["--version"],
        version: "1.0.0",
        stdout: (text: string) => {
          output += `${text}\n`;
        },
        onExit: (code: number) => {
          exitCode = code;
          throw new Error("EXIT");
        },
      };

      assert.throws(() => run(parser, options), /EXIT/);
      assert.equal(exitCode, 0);
      assert.equal(output, "1.0.0\n");
    });

    it("should handle version as object with custom mode", () => {
      const parser = object({
        name: argument(string()),
      });

      let output = "";
      let exitCode: number | undefined;
      assert.throws(
        () => {
          run(parser, {
            programName: "test",
            args: ["version"],
            version: {
              value: "2.1.0",
              command: true,
            },
            stdout: (text: string) => {
              output += `${text}\n`;
            },
            onExit: (code: number) => {
              exitCode = code;
              throw new Error("EXIT");
            },
          });
        },
        /EXIT/,
      );

      assert.equal(exitCode, 0);
      assert.equal(output, "2.1.0\n");
    });
  });

  describe("completion functionality", () => {
    it("should accept completion configuration", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that completion configuration is properly typed and accepted
      const result = run(parser, {
        programName: "test",
        args: ["Alice"],
        completion: "both",
      });

      assert.deepEqual(result, { name: "Alice" });
    });

    it("should support completion mode options", () => {
      const parser = object({
        verbose: option("--verbose"),
        name: argument(string()),
      });

      // Test different completion modes are properly typed
      const modes: Array<"command" | "option" | "both"> = [
        "command",
        "option",
        "both",
      ];

      for (const mode of modes) {
        const result = run(parser, {
          programName: "test",
          args: ["--verbose", "Bob"],
          completion: mode,
        });

        assert.deepEqual(result, { verbose: true, name: "Bob" });
      }
    });

    it("should work without completion configuration", () => {
      const parser = object({
        count: option("-c", "--count", integer()),
        name: argument(string()),
      });

      // Test that completion is optional
      const result = run(parser, {
        programName: "test",
        args: ["-c", "5", "Charlie"],
        // completion omitted = no completion functionality
      });

      assert.deepEqual(result, { count: 5, name: "Charlie" });
    });

    it("should support completion alongside help and version", () => {
      const parser = object({
        debug: option("--debug"),
        name: argument(string()),
      });

      // Test that completion works with other features
      const result = run(parser, {
        programName: "test",
        args: ["--debug", "David"],
        help: "both",
        version: "1.0.0",
        completion: "both",
      });

      assert.deepEqual(result, { debug: true, name: "David" });
    });

    it("should enforce at least one of command/option at compile time", () => {
      const validCommand: RunOptions["completion"] = {
        command: true,
      };
      void validCommand;

      const validOption: RunOptions["completion"] = {
        option: true,
      };
      void validOption;

      const validBoth: RunOptions["completion"] = {
        command: true,
        option: true,
      };
      void validBoth;

      const validSubConfig: RunOptions["completion"] = {
        command: { names: ["completions"] },
        option: { names: ["--completions"] },
      };
      void validSubConfig;
    });
  });

  describe("documentation fields", () => {
    it("should accept brief option", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that brief option is properly typed and accepted
      const result = run(parser, {
        programName: "test",
        args: ["Alice"],
        brief: message`This is a test program`,
      });

      assert.deepEqual(result, { name: "Alice" });
    });

    it("should accept description option", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that description option is properly typed and accepted
      const result = run(parser, {
        programName: "test",
        args: ["Alice"],
        description: message`This program does something amazing.`,
      });

      assert.deepEqual(result, { name: "Alice" });
    });

    it("should accept footer option", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that footer option is properly typed and accepted
      const result = run(parser, {
        programName: "test",
        args: ["Bob"],
        footer: message`For more information, visit https://example.com`,
      });

      assert.deepEqual(result, { name: "Bob" });
    });

    it("should accept all documentation fields together", () => {
      const parser = object({
        verbose: option("--verbose"),
        name: argument(string()),
      });

      // Test that all documentation options work together
      const result = run(parser, {
        programName: "test",
        args: ["--verbose", "Charlie"],
        brief: message`Test Program`,
        description: message`A comprehensive testing utility.`,
        footer: message`Copyright (c) 2024 Test Corp.`,
      });

      assert.deepEqual(result, { verbose: true, name: "Charlie" });
    });

    it("should properly type Message parameters", () => {
      const parser = object({
        name: argument(string()),
      });

      // This test verifies that the TypeScript types are working correctly
      // by ensuring these calls compile without errors
      const options = {
        programName: "test",
        args: ["David"],
        brief: message`Brief text`,
        description: message`Description with ${"value"} interpolation`,
        footer: message`Footer text`,
      };

      const result = run(parser, options);
      assert.deepEqual(result, { name: "David" });
    });
  });

  describe("async parser support", () => {
    // Create an async ValueParser for testing
    // (simulates async validation like checking a file exists or network lookup)
    function asyncString(): ValueParser<"async", string> {
      return {
        $mode: "async",
        metavar: "ASYNC_STRING",
        placeholder: "",
        async parse(input: string): Promise<ValueParserResult<string>> {
          // Simulate async operation (e.g., validation against remote service)
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { success: true, value: input.toUpperCase() };
        },
        format(value: string): string {
          return value;
        },
      };
    }

    describe("basic async parsing", () => {
      it("should return Promise for async parser", async () => {
        const parser = object({
          name: argument(asyncString()),
        });

        const result = run(parser, {
          args: ["alice"],
          programName: "test",
        });

        // run() should return a Promise when given an async parser
        assert.ok(
          result instanceof Promise,
          "run() should return Promise for async parser",
        );
        const resolved = await result;
        assert.deepEqual(resolved, { name: "ALICE" });
      });

      it("should handle mixed sync/async parsers", async () => {
        const parser = object({
          name: argument(asyncString()),
          count: option("-c", "--count", integer()),
        });

        const result = run(parser, {
          args: ["-c", "5", "bob"],
          programName: "test",
        });

        assert.ok(result instanceof Promise);
        const resolved = await result;
        assert.deepEqual(resolved, { name: "BOB", count: 5 });
      });

      it("should handle async option parser", async () => {
        const parser = object({
          value: option("--value", asyncString()),
        });

        const result = run(parser, {
          args: ["--value", "test"],
          programName: "test",
        });

        assert.ok(result instanceof Promise);
        const resolved = await result;
        assert.deepEqual(resolved, { value: "TEST" });
      });
    });

    describe("async with commands", () => {
      it("should handle command with async options", async () => {
        const parser = command(
          "greet",
          object({
            name: argument(asyncString()),
            times: option("-t", "--times", integer()),
          }),
        );

        const result = run(parser, {
          args: ["greet", "-t", "3", "world"],
          programName: "test",
        });

        assert.ok(result instanceof Promise);
        const resolved = await result;
        assert.deepEqual(resolved, { name: "WORLD", times: 3 });
      });
    });

    describe("async with RunOptions configurations", () => {
      it("should work with help configuration", async () => {
        const parser = object({
          name: argument(asyncString()),
        });

        const result = run(parser, {
          args: ["hello"],
          programName: "test",
          help: "both",
        });

        assert.ok(result instanceof Promise);
        const resolved = await result;
        assert.deepEqual(resolved, { name: "HELLO" });
      });

      it("should work with version configuration", async () => {
        const parser = object({
          name: argument(asyncString()),
        });

        const result = run(parser, {
          args: ["hello"],
          programName: "test",
          version: "1.0.0",
        });

        assert.ok(result instanceof Promise);
        const resolved = await result;
        assert.deepEqual(resolved, { name: "HELLO" });
      });

      it("should work with completion configuration", async () => {
        const parser = object({
          name: argument(asyncString()),
        });

        const result = run(parser, {
          args: ["hello"],
          programName: "test",
          completion: "both",
        });

        assert.ok(result instanceof Promise);
        const resolved = await result;
        assert.deepEqual(resolved, { name: "HELLO" });
      });

      it("should work with all configurations combined", async () => {
        const parser = object({
          name: argument(asyncString()),
          verbose: option("--verbose"),
        });

        const result = run(parser, {
          args: ["--verbose", "world"],
          programName: "test",
          help: "both",
          version: { value: "2.0.0", command: true, option: true },
          completion: { command: true, option: true },
          colors: false,
          maxWidth: 80,
          brief: message`Test program`,
          description: message`A test program for async parsing`,
          footer: message`Copyright 2024`,
        });

        assert.ok(result instanceof Promise);
        const resolved = await result;
        assert.deepEqual(resolved, { name: "WORLD", verbose: true });
      });
    });

    describe("async type inference", () => {
      it("should infer async mode from parser", () => {
        const syncParser = object({
          name: argument(string()),
        });

        const asyncParser = object({
          name: argument(asyncString()),
        });

        // Sync parser should have mode "sync"
        assert.equal(syncParser.$mode, "sync");

        // Async parser should have mode "async"
        assert.equal(asyncParser.$mode, "async");
      });

      it("should correctly type sync parser result", () => {
        const parser = object({
          name: argument(string()),
        });

        const result = run(parser, {
          args: ["test"],
          programName: "test",
        });

        // Sync parser should NOT return Promise
        assert.ok(!(result instanceof Promise));
        assert.deepEqual(result, { name: "test" });
      });
    });

    describe("async with modifiers", () => {
      it("should handle optional() with async parser", async () => {
        const parser = object({
          name: optional(option("--name", asyncString())),
        });

        // With value
        const result1 = run(parser, {
          args: ["--name", "alice"],
          programName: "test",
        });

        assert.ok(result1 instanceof Promise);
        assert.deepEqual(await result1, { name: "ALICE" });

        // Without value
        const result2 = run(parser, {
          args: [],
          programName: "test",
        });

        assert.ok(result2 instanceof Promise);
        assert.deepEqual(await result2, { name: undefined });
      });

      it("should handle withDefault() with async parser", async () => {
        const parser = object({
          name: withDefault(option("--name", asyncString()), "DEFAULT"),
        });

        // With value
        const result1 = run(parser, {
          args: ["--name", "bob"],
          programName: "test",
        });

        assert.ok(result1 instanceof Promise);
        assert.deepEqual(await result1, { name: "BOB" });

        // Without value - uses default
        const result2 = run(parser, {
          args: [],
          programName: "test",
        });

        assert.ok(result2 instanceof Promise);
        assert.deepEqual(await result2, { name: "DEFAULT" });
      });

      it("should handle multiple() with async parser", async () => {
        const parser = object({
          names: multiple(option("--name", asyncString())),
        });

        const result = run(parser, {
          args: ["--name", "alice", "--name", "bob", "--name", "charlie"],
          programName: "test",
        });

        assert.ok(result instanceof Promise);
        assert.deepEqual(await result, { names: ["ALICE", "BOB", "CHARLIE"] });
      });

      it("should handle map() with async parser", async () => {
        const parser = object({
          nameLength: map(option("--name", asyncString()), (s) => s.length),
        });

        const result = run(parser, {
          args: ["--name", "hello"],
          programName: "test",
        });

        assert.ok(result instanceof Promise);
        assert.deepEqual(await result, { nameLength: 5 });
      });

      it("should handle chained modifiers with async", async () => {
        const parser = object({
          names: map(
            withDefault(multiple(option("--name", asyncString())), []),
            (arr) => arr.join(", "),
          ),
        });

        const result = run(parser, {
          args: ["--name", "alice", "--name", "bob"],
          programName: "test",
        });

        assert.ok(result instanceof Promise);
        assert.deepEqual(await result, { names: "ALICE, BOB" });
      });
    });

    describe("async with complex constructs", () => {
      it("should handle or() with async parsers", async () => {
        const parser = or(
          object({
            mode: option("--mode", asyncString()),
            value: option("--value", asyncString()),
          }),
          object({ simple: argument(asyncString()) }),
        );

        // First branch
        const result1 = run(parser, {
          args: ["--mode", "fast", "--value", "test"],
          programName: "test",
        });

        assert.ok(result1 instanceof Promise);
        assert.deepEqual(await result1, { mode: "FAST", value: "TEST" });

        // Second branch
        const result2 = run(parser, {
          args: ["hello"],
          programName: "test",
        });

        assert.ok(result2 instanceof Promise);
        assert.deepEqual(await result2, { simple: "HELLO" });
      });

      it("should handle longestMatch() with async parsers", async () => {
        // Use distinct commands to avoid ambiguity
        const addCmd = command(
          "add",
          object({ name: argument(asyncString()) }),
        );
        const removeCmd = command(
          "remove",
          object({ name: argument(asyncString()) }),
        );

        const parser = longestMatch(addCmd, removeCmd);

        const result1 = run(parser, {
          args: ["add", "item"],
          programName: "test",
        });

        assert.ok(result1 instanceof Promise);
        assert.deepEqual(await result1, { name: "ITEM" });

        const result2 = run(parser, {
          args: ["remove", "old"],
          programName: "test",
        });

        assert.ok(result2 instanceof Promise);
        assert.deepEqual(await result2, { name: "OLD" });
      });

      it("should handle nested commands with async", async () => {
        const parser = or(
          command(
            "add",
            object({ name: argument(asyncString()) }),
          ),
          command(
            "remove",
            object({ name: argument(asyncString()), force: option("--force") }),
          ),
        );

        const result1 = run(parser, {
          args: ["add", "item"],
          programName: "test",
        });

        assert.ok(result1 instanceof Promise);
        assert.deepEqual(await result1, { name: "ITEM" });

        const result2 = run(parser, {
          args: ["remove", "--force", "old-item"],
          programName: "test",
        });

        assert.ok(result2 instanceof Promise);
        assert.deepEqual(await result2, { name: "OLD-ITEM", force: true });
      });
    });
  });
});

describe("runSync", () => {
  // Create a sync ValueParser for testing
  function syncString(): ValueParser<"sync", string> {
    return {
      $mode: "sync",
      metavar: "STRING",
      placeholder: "",
      parse(input: string): ValueParserResult<string> {
        return { success: true, value: input.toLowerCase() };
      },
      format(value: string): string {
        return value;
      },
    };
  }

  it("should parse sync parser and return directly", () => {
    const parser = object({
      name: argument(syncString()),
    });

    const result = runSync(parser, {
      args: ["HELLO"],
      programName: "test",
    });

    // runSync returns directly, not a Promise
    assert.ok(!(result instanceof Promise));
    assert.deepEqual(result, { name: "hello" });
  });

  it("should work with built-in sync value parsers", () => {
    const parser = object({
      name: option("-n", "--name", string()),
      count: option("-c", "--count", integer()),
    });

    const result = runSync(parser, {
      args: ["--name", "test", "--count", "42"],
      programName: "test",
    });

    assert.ok(!(result instanceof Promise));
    assert.deepEqual(result, { name: "test", count: 42 });
  });

  it("should work with commands", () => {
    const parser = command(
      "greet",
      object({
        name: argument(string()),
      }),
    );

    const result = runSync(parser, {
      args: ["greet", "world"],
      programName: "test",
    });

    assert.ok(!(result instanceof Promise));
    assert.deepEqual(result, { name: "world" });
  });

  it("should work with modifiers", () => {
    const parser = object({
      name: optional(option("-n", "--name", string())),
      count: withDefault(option("-c", "--count", integer()), 10),
    });

    const result = runSync(parser, {
      args: [],
      programName: "test",
    });

    assert.ok(!(result instanceof Promise));
    assert.deepEqual(result, { name: undefined, count: 10 });
  });

  it("should work with multiple()", () => {
    const parser = object({
      names: multiple(option("-n", "--name", string())),
    });

    const result = runSync(parser, {
      args: ["-n", "alice", "-n", "bob"],
      programName: "test",
    });

    assert.ok(!(result instanceof Promise));
    assert.deepEqual(result, { names: ["alice", "bob"] });
  });

  it("should use default run options when omitted", () => {
    const parser = multiple(argument(string()));
    const originalArgv = process.argv;
    process.argv = ["node", "/tmp/default-cli.ts", "A", "B", "C"];
    try {
      const result = runSync(parser);
      assert.ok(!(result instanceof Promise));
      assert.deepEqual(result, ["A", "B", "C"]);
    } finally {
      process.argv = originalArgv;
    }
  });

  describe("Program support", () => {
    it("should accept Program object instead of parser", () => {
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

      const result = runSync(prog, {
        args: ["Alice"],
      });

      assert.ok(!(result instanceof Promise));
      assert.deepEqual(result, { name: "Alice" });
    });

    it("should use program name from metadata", () => {
      const parser = option("--verbose");
      const prog: Program<"sync", boolean> = {
        parser,
        metadata: {
          name: "myapp-sync",
          version: "2.0.0",
        },
      };

      let helpOutput = "";
      let exitCode: number | undefined;

      try {
        runSync(prog, {
          args: ["--help"],
          help: "option",
          stdout: (text) => {
            helpOutput += `${text}\n`;
          },
          onExit: (code) => {
            exitCode = code;
            throw new Error("exit");
          },
        });
      } catch {
        // Expected exit
      }

      assert.ok(helpOutput.includes("myapp-sync"));
      assert.equal(exitCode, 0);
    });
  });
});

describe("runAsync", () => {
  // Create an async ValueParser for testing
  function asyncString(): ValueParser<"async", string> {
    return {
      $mode: "async",
      metavar: "ASYNC_STRING",
      placeholder: "",
      parse(input: string): Promise<ValueParserResult<string>> {
        return Promise.resolve({
          success: true,
          value: input.toUpperCase(),
        });
      },
      format(value: string): string {
        return value.toLowerCase();
      },
    };
  }

  it("should parse async parser and return Promise", async () => {
    const parser = object({
      name: argument(asyncString()),
    });

    const result = runAsync(parser, {
      args: ["hello"],
      programName: "test",
    });

    // runAsync always returns Promise
    assert.ok(result instanceof Promise);
    assert.deepEqual(await result, { name: "HELLO" });
  });

  it("should also work with sync parsers (returns Promise)", async () => {
    const parser = object({
      name: argument(string()),
    });

    const result = runAsync(parser, {
      args: ["hello"],
      programName: "test",
    });

    // runAsync always returns Promise, even for sync parsers
    assert.ok(result instanceof Promise);
    assert.deepEqual(await result, { name: "hello" });
  });

  it("should work with mixed sync/async parsers", async () => {
    const parser = object({
      name: option("-n", "--name", asyncString()),
      count: option("-c", "--count", integer()),
    });

    const result = runAsync(parser, {
      args: ["--name", "test", "--count", "42"],
      programName: "test",
    });

    assert.ok(result instanceof Promise);
    assert.deepEqual(await result, { name: "TEST", count: 42 });
  });

  it("should work with commands", async () => {
    const parser = command(
      "greet",
      object({
        name: argument(asyncString()),
      }),
    );

    const result = runAsync(parser, {
      args: ["greet", "world"],
      programName: "test",
    });

    assert.ok(result instanceof Promise);
    assert.deepEqual(await result, { name: "WORLD" });
  });

  it("should work with modifiers", async () => {
    const parser = object({
      name: optional(option("-n", "--name", asyncString())),
      count: withDefault(option("-c", "--count", integer()), 10),
    });

    const result = runAsync(parser, {
      args: ["--name", "test"],
      programName: "test",
    });

    assert.ok(result instanceof Promise);
    assert.deepEqual(await result, { name: "TEST", count: 10 });
  });

  it("should work with multiple()", async () => {
    const parser = object({
      names: multiple(option("-n", "--name", asyncString())),
    });

    const result = runAsync(parser, {
      args: ["-n", "alice", "-n", "bob"],
      programName: "test",
    });

    assert.ok(result instanceof Promise);
    assert.deepEqual(await result, { names: ["ALICE", "BOB"] });
  });

  it("should work with or()", async () => {
    const parser = or(
      object({ mode: option("--mode", asyncString()) }),
      object({ name: argument(asyncString()) }),
    );

    const result = runAsync(parser, {
      args: ["hello"],
      programName: "test",
    });

    assert.ok(result instanceof Promise);
    assert.deepEqual(await result, { name: "HELLO" });
  });

  it("should work with longestMatch()", async () => {
    const addCmd = command("add", object({ name: argument(asyncString()) }));
    const removeCmd = command(
      "remove",
      object({ name: argument(asyncString()) }),
    );
    const parser = longestMatch(addCmd, removeCmd);

    const result = runAsync(parser, {
      args: ["add", "item"],
      programName: "test",
    });

    assert.ok(result instanceof Promise);
    assert.deepEqual(await result, { name: "ITEM" });
  });

  describe("Program support", () => {
    it("should accept Program object instead of parser", () => {
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

      const result = run(prog, {
        args: ["Alice"],
      });

      assert.deepEqual(result, { name: "Alice" });
    });

    it("should use program name from metadata", () => {
      const parser = option("--verbose");
      const prog: Program<"sync", boolean> = {
        parser,
        metadata: {
          name: "myapp",
          version: "2.0.0",
        },
      };

      let helpOutput = "";
      let exitCode = 0;

      try {
        run(prog, {
          args: ["--help"],
          help: "option",
          stdout: (text) => {
            helpOutput += `${text}\n`;
          },
          onExit: (code) => {
            exitCode = code;
            throw new Error("EXIT");
          },
        });
      } catch (err) {
        if ((err as Error).message !== "EXIT") throw err;
      }

      assert.ok(helpOutput.includes("myapp"));
      assert.equal(exitCode, 0);
    });

    it("should merge program metadata with options", () => {
      const parser = option("--verbose");
      const prog: Program<"sync", boolean> = {
        parser,
        metadata: {
          name: "myapp",
          brief: message`A test app`,
          description: message`This is a test application.`,
        },
      };

      let helpOutput = "";

      try {
        run(prog, {
          args: ["--help"],
          help: "option",
          stdout: (text) => {
            helpOutput += `${text}\n`;
          },
          onExit: () => {
            throw new Error("EXIT");
          },
        });
      } catch (err) {
        if ((err as Error).message !== "EXIT") throw err;
      }

      assert.ok(helpOutput.includes("myapp"));
      assert.ok(helpOutput.includes("A test app"));
    });

    it("should accept custom sectionOrder callback", () => {
      const parser = or(
        command("build", object({})),
        command("deploy", object({})),
      );

      let helpOutput = "";

      try {
        run(parser, {
          args: ["--help"],
          programName: "myapp",
          help: "option",
          sectionOrder: (a: DocSection, b: DocSection): number => {
            const aTitle = a.title ?? "";
            const bTitle = b.title ?? "";
            return aTitle.localeCompare(bTitle);
          },
          stdout: (text) => {
            helpOutput += `${text}\n`;
          },
          onExit: () => {
            throw new Error("EXIT");
          },
        });
      } catch (err) {
        if ((err as Error).message !== "EXIT") throw err;
      }

      assert.ok(typeof helpOutput === "string");
    });
  });
});

describe("run with contexts", () => {
  it("preserves context-backed parsing for help/version names after --", async () => {
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

  it("should delegate to runWith and return a Promise when contexts are provided", async () => {
    const envKey = Symbol.for("@test/env-run");
    const context: SourceContext = {
      id: envKey,
      phase: "single-pass",
      getAnnotations() {
        return { [envKey]: { HOST: "localhost" } };
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    const result = run(parser, {
      args: ["--name", "Alice"],
      programName: "test",
      contexts: [context],
    });

    // run() with contexts always returns a Promise
    assert.ok(result instanceof Promise);
    const value = await result;
    assert.deepEqual(value, { name: "Alice" });
  });

  it("run() keeps phase two alive for config-only required values", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-run-issue-180.json");

    await writeFile(
      configPath,
      JSON.stringify({ token: "config-token" }),
    );

    try {
      const context = createConfigContext({
        schema: createPassthroughConfigSchema<{ token: string }>(),
      });
      const parser = object({
        config: option("--config", string()),
        token: bindConfig(fail<string>(), {
          context,
          key: "token",
        }),
      });

      const result = await run(parser, {
        args: ["--config", configPath],
        programName: "test",
        contexts: [context],
        contextOptions: {
          getConfigPath: (parsed: { config: string }) => parsed.config,
        },
      });

      assert.deepEqual(result, {
        config: configPath,
        token: "config-token",
      });
    } finally {
      await rm(configPath, { force: true });
    }
  });

  it("should extract context-required options from RunOptions", async () => {
    let receivedOptions: unknown;
    const key = Symbol.for("@test/run-extract");

    const context: SourceContext = {
      id: key,
      phase: "two-pass",
      getAnnotations(_parsed?: unknown, options?: unknown) {
        receivedOptions = options;
        if (!_parsed) return {};
        return { [key]: { value: true } };
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    await run(parser, {
      args: [],
      programName: "test",
      contexts: [context],
      contextOptions: { custom: "value" },
    });

    // contextOptions should be forwarded to contexts
    assert.ok(receivedOptions != null);
    assert.equal(
      (receivedOptions as Record<string, unknown>).custom,
      "value",
    );
  });

  it("should forward contextOptions to contexts without collision", async () => {
    let receivedOptions: unknown;
    const key = Symbol.for("@test/run-context-options-collision");

    const context: SourceContext<{ help: string }> = {
      id: key,
      phase: "two-pass",
      getAnnotations(_parsed?: unknown, options?: unknown) {
        receivedOptions = options;
        return {};
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    await run(parser, {
      args: [],
      programName: "test",
      help: "option",
      contexts: [context],
      contextOptions: { help: "from-context" },
    });

    // The context should receive "from-context", not the runner's help config
    assert.ok(receivedOptions != null);
    assert.equal(
      (receivedOptions as Record<string, unknown>).help,
      "from-context",
    );
  });

  it("should forward contextOptions in runSync without collision", () => {
    let receivedOptions: unknown;
    const key = Symbol.for("@test/runsync-context-options-collision");

    const context: SourceContext<{ programName: string }> = {
      id: key,
      phase: "two-pass",
      getAnnotations(_parsed?: unknown, options?: unknown) {
        receivedOptions = options;
        return {};
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    runSync(parser, {
      args: [],
      programName: "runner-name",
      contexts: [context],
      contextOptions: { programName: "context-name" },
    });

    assert.ok(receivedOptions != null);
    assert.equal(
      (receivedOptions as Record<string, unknown>).programName,
      "context-name",
    );
  });

  it("should dispose contexts via run()", async () => {
    let disposed = false;
    const key = Symbol.for("@test/run-dispose");

    const context: SourceContext = {
      id: key,
      phase: "single-pass",
      getAnnotations() {
        return { [key]: { value: true } };
      },
      [Symbol.dispose]() {
        disposed = true;
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    await run(parser, {
      args: [],
      programName: "test",
      contexts: [context],
    });

    assert.ok(disposed);
  });

  it("should keep Program run() synchronous with empty contexts", () => {
    const parser = object({
      name: argument(string()),
    });
    const program: Program<"sync", { name: string }> = {
      parser,
      metadata: {
        name: "empty-contexts",
      },
    };

    const result: { name: string } = run(program, {
      args: ["Alice"],
      contexts: [],
    });

    assert.ok(!(result instanceof Promise));
    assert.deepEqual(result, { name: "Alice" });
  });

  it("should keep parser run() synchronous with empty contexts", () => {
    const parser = object({
      name: argument(string()),
    });

    const result: { name: string } = run(parser, {
      args: ["Alice"],
      contexts: [],
    });

    assert.ok(!(result instanceof Promise));
    assert.deepEqual(result, { name: "Alice" });
  });

  it("should widen parser run() for context arrays", async () => {
    const key = Symbol.for("@test/parser-run-dynamic-contexts");
    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });
    const context: SourceContext = {
      id: key,
      phase: "single-pass",
      getAnnotations() {
        return { [key]: { value: true } };
      },
    };
    const emptyContexts: SourceContext[] = [];
    const filledContexts: SourceContext[] = [context];

    const emptyResult: { name: string } | Promise<{ name: string }> = run(
      parser,
      {
        args: [],
        contexts: emptyContexts,
      },
    );
    const filledResult: { name: string } | Promise<{ name: string }> = run(
      parser,
      {
        args: [],
        contexts: filledContexts,
      },
    );

    assert.ok(!(emptyResult instanceof Promise));
    assert.deepEqual(emptyResult, { name: "default" });
    assert.ok(filledResult instanceof Promise);
    assert.deepEqual(await filledResult, { name: "default" });

    // @ts-expect-error - context arrays may still resolve async.
    const syncResult: { name: string } = run(parser, {
      args: [],
      contexts: filledContexts,
    });
    void syncResult;
  });

  it("should reject Program run() with contexts when options are missing", () => {
    const context: ProgramPathContext = {
      id: Symbol.for("@test/program-run-missing-options"),
      phase: "single-pass",
      getAnnotations() {
        return {};
      },
    };
    const program: Program<"sync", { config: string; host: string }> = {
      parser: object({
        config: withDefault(option("--config", string()), "optique.json"),
        host: withDefault(option("--host", string()), "localhost"),
      }),
      metadata: {
        name: "missing-options",
      },
    };

    // @ts-expect-error - contexts require getPath for this Program context.
    run(program, {
      args: [],
      contexts: [context],
    });
  });

  it("should accept RunOptions variables for Program run() without contexts", () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "forwarded-options",
      },
    };
    const options: RunOptions = {
      args: ["Alice"],
    };

    const result: { name: string } | Promise<{ name: string }> = run(
      program,
      options,
    );

    assert.ok(!(result instanceof Promise));
    assert.deepEqual(result, { name: "Alice" });
  });

  it("should widen Program run() when RunOptions variables may include contexts", async () => {
    const key = Symbol.for("@test/program-run-runoptions-contexts");
    const context: SourceContext = {
      id: key,
      phase: "single-pass",
      getAnnotations() {
        return { [key]: { value: true } };
      },
    };
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: withDefault(option("--name", string()), "default"),
      }),
      metadata: {
        name: "forwarded-options-with-contexts",
      },
    };
    const options: RunOptions = {
      args: [],
      contexts: [context],
    };

    const result = run(program, options);

    const maybePromise: { name: string } | Promise<{ name: string }> = result;
    assert.ok(result instanceof Promise);
    assert.deepEqual(await maybePromise, { name: "default" });

    // @ts-expect-error - RunOptions may include contexts, so run() may be async.
    const syncResult: { name: string } = run(program, options);
    void syncResult;
  });

  it("should reject optional RunOptions wrappers for Program run()", () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: withDefault(option("--name", string()), "default"),
      }),
      metadata: {
        name: "optional-runoptions-wrapper",
      },
    };

    function _wrap(options?: RunOptions) {
      // @ts-expect-error - optional RunOptions wrappers could hide contexts.
      return run(program, options);
    }

    void _wrap;
  });

  it("should widen Program run() for context arrays", async () => {
    let resolvedPath: string | undefined;
    const context: ProgramPathContext = {
      id: Symbol.for("@test/program-run-dynamic-context-array"),
      phase: "two-pass",
      getAnnotations(parsed, options) {
        if (parsed && options) {
          resolvedPath = (
            options as {
              getPath: (parsed: { config: string; host: string }) => string;
            }
          ).getPath(parsed as { config: string; host: string });
        }
        return {};
      },
    };
    const program: Program<"sync", { config: string; host: string }> = {
      parser: object({
        config: withDefault(option("--config", string()), "optique.json"),
        host: withDefault(option("--host", string()), "localhost"),
      }),
      metadata: {
        name: "dynamic-context-array-program",
      },
    };
    const emptyContexts: ProgramPathContext[] = [];
    const filledContexts: ProgramPathContext[] = [context];

    const emptyResult:
      | { config: string; host: string }
      | Promise<{ config: string; host: string }> = run(program, {
        args: [],
        contexts: emptyContexts,
        contextOptions: {
          getPath: (parsed) => parsed.config,
        },
      });
    const filledResult:
      | { config: string; host: string }
      | Promise<{ config: string; host: string }> = run(program, {
        args: [],
        contexts: filledContexts,
        contextOptions: {
          getPath: (parsed) => {
            // @ts-expect-error - parsed must not be any.
            void parsed.nonexistent;
            return parsed.config;
          },
        },
      });

    assert.ok(!(emptyResult instanceof Promise));
    assert.deepEqual(emptyResult, {
      config: "optique.json",
      host: "localhost",
    });
    assert.ok(filledResult instanceof Promise);
    assert.deepEqual(await filledResult, {
      config: "optique.json",
      host: "localhost",
    });
    assert.equal(resolvedPath, "optique.json");

    // @ts-expect-error - context arrays may resolve asynchronously.
    const syncResult: { config: string; host: string } = run(program, {
      args: [],
      contexts: filledContexts,
      contextOptions: {
        getPath: (parsed) => parsed.config,
      },
    });
    void syncResult;
  });

  it("should reject unknown option keys for Program run()", () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "program-typo-run",
      },
    };

    const assertUnknownOptionsAreRejected = (): void => {
      // @ts-expect-error - argz is not a valid RunOptions key.
      run(program, {
        argz: ["Alice"],
      });
    };
    void assertUnknownOptionsAreRejected;
  });

  it("should reject widened Program run() option variables with extra keys", () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "program-widened-typo-run",
      },
    };
    const options: RunOptions & { readonly argz: readonly string[] } = {
      args: ["Alice"],
      argz: ["Alice"],
    };

    const assertWidenedOptionsAreRejected = (): void => {
      // @ts-expect-error - widened option variables must not bypass key checks.
      run(program, options);
    };
    void assertWidenedOptionsAreRejected;
  });

  it("should require context options for Program input in run()", async () => {
    let resolvedPath: string | undefined;
    const context: ProgramPathContext = {
      id: Symbol.for("@test/program-run-context"),
      phase: "two-pass",
      getAnnotations(parsed, options) {
        if (parsed && options) {
          resolvedPath = (
            options as {
              getPath: (parsed: { config: string; host: string }) => string;
            }
          ).getPath(parsed as { config: string; host: string });
        }
        return {};
      },
    };
    const parser = object({
      config: withDefault(option("--config", string()), "optique.json"),
      host: withDefault(option("--host", string()), "localhost"),
    });
    const program: Program<"sync", { config: string; host: string }> = {
      parser,
      metadata: {
        name: "configurable-app",
      },
    };

    const result = run(program, {
      args: [],
      contexts: [context],
      contextOptions: {
        getPath: (parsed) => {
          // @ts-expect-error - parsed must not be any.
          void parsed.nonexistent;
          return parsed.config;
        },
      },
    });

    const promise: Promise<{ config: string; host: string }> = result;
    assert.ok(result instanceof Promise);
    assert.deepEqual(await promise, {
      config: "optique.json",
      host: "localhost",
    });
    assert.equal(resolvedPath, "optique.json");

    // @ts-expect-error - run() with contexts must not return synchronously.
    const syncResult: { config: string; host: string } = result;
    void syncResult;
  });

  it("should widen parser run() for non-tuple context arrays", async () => {
    let resolvedPath: string | undefined;
    const context: ProgramPathContext = {
      id: Symbol.for("@test/program-run-dynamic-contexts"),
      phase: "two-pass",
      getAnnotations(parsed, options) {
        if (parsed && options) {
          resolvedPath = (
            options as {
              getPath: (parsed: { config: string; host: string }) => string;
            }
          ).getPath(parsed as { config: string; host: string });
        }
        return {};
      },
    };
    const parser = object({
      config: withDefault(option("--config", string()), "optique.json"),
      host: withDefault(option("--host", string()), "localhost"),
    });
    const contexts: readonly ProgramPathContext[] = [context];
    const options: RunOptions & {
      readonly contexts: readonly ProgramPathContext[];
      readonly contextOptions: {
        readonly getPath: (
          parsed: { config: string; host: string },
        ) => string;
      };
    } = {
      args: [],
      contexts,
      contextOptions: {
        getPath: (parsed) => {
          // @ts-expect-error - parsed must not be any.
          void parsed.nonexistent;
          return parsed.config;
        },
      },
    };

    const result = run(parser, options);

    const maybePromise:
      | { config: string; host: string }
      | Promise<{ config: string; host: string }> = result;
    assert.ok(result instanceof Promise);
    assert.deepEqual(await maybePromise, {
      config: "optique.json",
      host: "localhost",
    });
    assert.equal(resolvedPath, "optique.json");

    // @ts-expect-error - non-tuple context arrays may resolve asynchronously.
    const syncResult: { config: string; host: string } = result;
    void syncResult;
  });
});

describe("runSync with contexts", () => {
  it("preserves context-backed parsing for help/version names after --", () => {
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

  it("should delegate to runWithSync when contexts are provided", () => {
    const envKey = Symbol.for("@test/env-runsync");
    const context: SourceContext = {
      id: envKey,
      phase: "single-pass",
      getAnnotations() {
        return { [envKey]: { HOST: "localhost" } };
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    const result = runSync(parser, {
      args: ["--name", "Bob"],
      programName: "test",
      contexts: [context],
    });

    // runSync returns synchronously
    assert.deepEqual(result, { name: "Bob" });
  });

  it("should dispose contexts via runSync()", () => {
    let disposed = false;
    const key = Symbol.for("@test/runsync-dispose");

    const context: SourceContext = {
      id: key,
      phase: "single-pass",
      getAnnotations() {
        return { [key]: { value: true } };
      },
      [Symbol.dispose]() {
        disposed = true;
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    runSync(parser, {
      args: [],
      programName: "test",
      contexts: [context],
    });

    assert.ok(disposed);
  });

  it("should handle help with contexts in runSync", () => {
    const key = Symbol.for("@test/runsync-help");
    let annotationsCallCount = 0;
    const context: SourceContext = {
      id: key,
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

    try {
      runSync(parser, {
        args: ["--help"],
        programName: "test",
        help: "option",
        contexts: [context],
        stdout: () => {},
        onExit: () => {
          throw new Error("EXIT");
        },
      });
    } catch (err) {
      if ((err as Error).message === "EXIT") {
        helpShown = true;
      } else {
        throw err;
      }
    }

    assert.ok(helpShown);
    // Contexts should not be called for early exits
    assert.equal(annotationsCallCount, 0);
  });

  it("should support Program input with contexts", () => {
    const contextKey = Symbol.for("@test/runsync-program-context");
    const context: SourceContext = {
      id: contextKey,
      phase: "single-pass",
      getAnnotations() {
        return { [contextKey]: { value: true } };
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });
    const prog: Program<"sync", { name: string }> = {
      parser,
      metadata: {
        name: "my-sync-program",
        version: "1.0.0",
      },
    };

    const result = runSync(
      prog,
      {
        args: [],
        contexts: [context],
        contextOptions: { envName: "dev" },
      },
    );

    assert.deepEqual(result, { name: "default" });
  });

  it("should reject Program runSync() with contexts when options are missing", () => {
    const context: ProgramPathContext = {
      id: Symbol.for("@test/program-runsync-missing-options"),
      phase: "single-pass",
      getAnnotations() {
        return {};
      },
    };
    const program: Program<"sync", { config: string; host: string }> = {
      parser: object({
        config: withDefault(option("--config", string()), "optique.json"),
        host: withDefault(option("--host", string()), "localhost"),
      }),
      metadata: {
        name: "missing-options-sync",
      },
    };

    // @ts-expect-error - contexts require getPath for this Program context.
    runSync(program, {
      args: [],
      contexts: [context],
    });
  });

  it("should accept RunOptions variables for Program runSync() without contexts", () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "forwarded-options-sync",
      },
    };
    const options: RunOptions = {
      args: ["Bob"],
    };

    const result: { name: string } = runSync(program, options);

    assert.deepEqual(result, { name: "Bob" });
  });

  it("should accept optional RunOptions wrappers for Program runSync()", () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "forwarded-optional-options-sync",
      },
    };

    function wrap(options?: RunOptions) {
      return runSync(program, options);
    }

    const result: { name: string } = wrap({
      args: ["Bob"],
    });

    assert.deepEqual(result, { name: "Bob" });
  });

  it("should reject unknown option keys for Program runSync()", () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "program-typo-runsync",
      },
    };

    const assertUnknownOptionsAreRejected = (): void => {
      // @ts-expect-error - argz is not a valid RunOptions key.
      runSync(program, {
        argz: ["Bob"],
      });
    };
    void assertUnknownOptionsAreRejected;
  });

  it("should reject widened Program runSync() option variables with extra keys", () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "program-widened-typo-runsync",
      },
    };
    const options: RunOptions & { readonly argz: readonly string[] } = {
      args: ["Bob"],
      argz: ["Bob"],
    };

    const assertWidenedOptionsAreRejected = (): void => {
      // @ts-expect-error - widened option variables must not bypass key checks.
      runSync(program, options);
    };
    void assertWidenedOptionsAreRejected;
  });

  it("should require context options for Program input in runSync()", () => {
    let resolvedPath: string | undefined;
    const context: ProgramPathContext = {
      id: Symbol.for("@test/program-runsync-context"),
      phase: "two-pass",
      getAnnotations(parsed, options) {
        if (parsed && options) {
          resolvedPath = (
            options as {
              getPath: (parsed: { config: string; host: string }) => string;
            }
          ).getPath(parsed as { config: string; host: string });
        }
        return {};
      },
    };
    const parser = object({
      config: withDefault(option("--config", string()), "optique.json"),
      host: withDefault(option("--host", string()), "localhost"),
    });
    const program: Program<"sync", { config: string; host: string }> = {
      parser,
      metadata: {
        name: "configurable-app-sync",
      },
    };

    const result: { config: string; host: string } = runSync(program, {
      args: [],
      contexts: [context],
      contextOptions: {
        getPath: (parsed) => {
          // @ts-expect-error - parsed must not be any.
          void parsed.nonexistent;
          return parsed.config;
        },
      },
    });

    assert.equal(result.config, "optique.json");
    assert.equal(result.host, "localhost");
    assert.equal(resolvedPath, "optique.json");
  });

  it("should load config fallbacks through createConfigContext", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "run-sync-config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        host: "config.example.com",
        port: 8080,
      }),
    );

    try {
      const schema = createSyncConfigSchema();
      const context = createConfigContext({ schema });
      const parser = object({
        config: withDefault(option("--config", string()), configPath),
        host: bindConfig(option("--host", string()), {
          context,
          key: "host",
          default: "localhost",
        }),
        port: bindConfig(option("--port", integer()), {
          context,
          key: "port",
          default: 3000,
        }),
      });

      const result = runSync(parser, {
        args: [],
        programName: "test",
        contexts: [context],
        contextOptions: {
          getConfigPath: (
            parsed: { readonly config: string },
          ) => parsed.config,
        },
      });

      assert.deepEqual(result, {
        config: configPath,
        host: "config.example.com",
        port: 8080,
      });
    } finally {
      await rm(configPath, { force: true });
    }
  });

  it("should keep CLI values ahead of config fallbacks in runSync()", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "run-sync-config-override.json");

    await writeFile(
      configPath,
      JSON.stringify({
        host: "config.example.com",
        port: 8080,
      }),
    );

    try {
      const schema = createSyncConfigSchema();
      const context = createConfigContext({ schema });
      const parser = object({
        config: withDefault(option("--config", string()), configPath),
        host: bindConfig(option("--host", string()), {
          context,
          key: "host",
          default: "localhost",
        }),
        port: bindConfig(option("--port", integer()), {
          context,
          key: "port",
          default: 3000,
        }),
      });

      const result = runSync(parser, {
        args: ["--host", "cli.example.com"],
        programName: "test",
        contexts: [context],
        contextOptions: {
          getConfigPath: (
            parsed: { readonly config: string },
          ) => parsed.config,
        },
      });

      assert.deepEqual(result, {
        config: configPath,
        host: "cli.example.com",
        port: 8080,
      });
    } finally {
      await rm(configPath, { force: true });
    }
  });
});

describe("runAsync with contexts", () => {
  it("should delegate to runWith via runImpl when contexts are provided", async () => {
    const envKey = Symbol.for("@test/env-runasync");
    const context: SourceContext = {
      id: envKey,
      phase: "single-pass",
      getAnnotations() {
        return { [envKey]: { HOST: "localhost" } };
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    const result = await runAsync(parser, {
      args: ["--name", "Charlie"],
      programName: "test",
      contexts: [context],
    });

    assert.deepEqual(result, { name: "Charlie" });
  });

  it("should dispose contexts via runAsync()", async () => {
    let disposed = false;
    const key = Symbol.for("@test/runasync-dispose");

    const context: SourceContext = {
      id: key,
      phase: "single-pass",
      getAnnotations() {
        return { [key]: { value: true } };
      },
      [Symbol.dispose]() {
        disposed = true;
      },
    };

    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    await runAsync(parser, {
      args: [],
      programName: "test",
      contexts: [context],
    });

    assert.ok(disposed);
  });

  it("should pass extra context options through runImpl", async () => {
    const key = Symbol.for("@test/runasync-extra-options");
    const context: SourceContext = {
      id: key,
      phase: "single-pass",
      getAnnotations() {
        return { [key]: { value: true } };
      },
    };
    const parser = object({
      name: withDefault(option("--name", string()), "default"),
    });

    const result = await runAsync(
      parser,
      {
        args: [],
        programName: "test",
        contexts: [context],
        contextOptions: { profile: "local" },
      },
    );

    assert.deepEqual(result, { name: "default" });
  });

  it("should require context options for Program input in runAsync()", async () => {
    let resolvedPath: string | undefined;
    const context: ProgramPathContext = {
      id: Symbol.for("@test/program-runasync-context"),
      phase: "two-pass",
      getAnnotations(parsed, options) {
        if (parsed && options) {
          resolvedPath = (
            options as {
              getPath: (parsed: { config: string; host: string }) => string;
            }
          ).getPath(parsed as { config: string; host: string });
        }
        return {};
      },
    };
    const program: Program<"sync", { config: string; host: string }> = {
      parser: object({
        config: withDefault(option("--config", string()), "optique.json"),
        host: withDefault(option("--host", string()), "localhost"),
      }),
      metadata: {
        name: "configurable-app-async",
      },
    };

    const assertMissingOptionsAreRejected = (): void => {
      // @ts-expect-error - contexts require getPath for this Program context.
      runAsync(program, {
        args: [],
        contexts: [context],
      });
    };
    void assertMissingOptionsAreRejected;

    const result = runAsync(program, {
      args: [],
      contexts: [context],
      contextOptions: {
        getPath: (parsed) => {
          // @ts-expect-error - parsed must not be any.
          void parsed.nonexistent;
          return parsed.config;
        },
      },
    });

    const promise: Promise<{ config: string; host: string }> = result;
    assert.ok(result instanceof Promise);
    assert.deepEqual(await promise, {
      config: "optique.json",
      host: "localhost",
    });
    assert.equal(resolvedPath, "optique.json");
  });

  it("should accept RunOptions variables for Program runAsync() without contexts", async () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "forwarded-options-async",
      },
    };
    const options: RunOptions = {
      args: ["Charlie"],
    };

    const result: Promise<{ name: string }> = runAsync(program, options);

    assert.deepEqual(await result, { name: "Charlie" });
  });

  it("should accept optional RunOptions wrappers for Program runAsync()", async () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "forwarded-optional-options-async",
      },
    };

    function wrap(options?: RunOptions) {
      return runAsync(program, options);
    }

    const result: Promise<{ name: string }> = wrap({
      args: ["Charlie"],
    });

    assert.deepEqual(await result, { name: "Charlie" });
  });

  it("should reject unknown option keys for Program runAsync()", () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "program-typo-runasync",
      },
    };

    const assertUnknownOptionsAreRejected = (): void => {
      // @ts-expect-error - argz is not a valid RunOptions key.
      runAsync(program, {
        argz: ["Charlie"],
      });
    };
    void assertUnknownOptionsAreRejected;
  });

  it("should reject widened Program runAsync() option variables with extra keys", () => {
    const program: Program<"sync", { name: string }> = {
      parser: object({
        name: argument(string()),
      }),
      metadata: {
        name: "program-widened-typo-runasync",
      },
    };
    const options: RunOptions & { readonly argz: readonly string[] } = {
      args: ["Charlie"],
      argz: ["Charlie"],
    };

    const assertWidenedOptionsAreRejected = (): void => {
      // @ts-expect-error - widened option variables must not bypass key checks.
      runAsync(program, options);
    };
    void assertWidenedOptionsAreRejected;
  });
});

describe("runSync async parser rejection", () => {
  function asyncString(): ValueParser<"async", string> {
    return {
      $mode: "async",
      metavar: "STRING",
      placeholder: "",
      parse(input: string) {
        return Promise.resolve({
          success: true as const,
          value: input.toLowerCase(),
        });
      },
      format(value: string) {
        return value;
      },
    };
  }

  it("should reject async parser at runtime", () => {
    const parser = object({ name: argument(asyncString()) });

    assert.throws(
      () =>
        runSync(parser as never, {
          args: ["hello"],
          programName: "test",
        }),
      {
        name: "TypeError",
        message: /run\(\) or runAsync\(\)/,
      },
    );
  });

  it("should reject Program wrapping async parser at runtime", () => {
    const parser = object({ name: argument(asyncString()) });
    const program: Program<"async", { readonly name: string }> = {
      parser,
      metadata: { name: "test" },
    };

    assert.throws(
      () =>
        runSync(program as never, {
          args: ["hello"],
        }),
      {
        name: "TypeError",
        message: /run\(\) or runAsync\(\)/,
      },
    );
  });
});
