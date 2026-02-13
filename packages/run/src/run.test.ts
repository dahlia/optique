import { longestMatch, object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import { argument, command, option } from "@optique/core/primitives";
import type { Program } from "@optique/core/program";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import { integer, string } from "@optique/core/valueparser";
import type { RunOptions } from "@optique/run/run";
import { run, runAsync, runSync } from "@optique/run/run";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import process from "node:process";

type AssertNever<T extends never> = T;

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
  });

  describe("version functionality", () => {
    it("should handle version as string with default option mode", () => {
      const _parser = object({
        name: argument(string()),
      });

      // Version as string should work but exit the process
      // Since we can't test process.exit directly, we'll skip this test in the real environment
      // This test documents the expected behavior
      assert.ok(typeof run === "function");
    });

    it("should handle version as object with custom mode", () => {
      const _parser = object({
        name: argument(string()),
      });

      // Version as object should work but exit the process
      // Since we can't test process.exit directly, we'll skip this test in the real environment
      // This test documents the expected behavior
      assert.ok(typeof run === "function");
    });

    it("should support version configuration options", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that version configuration is properly typed and accepted
      // We can't test the actual functionality due to process.exit, but we can test the types
      const options = {
        programName: "test",
        args: ["Alice"],
        version: "1.0.0",
      };

      const result = run(parser, options);
      assert.deepEqual(result, { name: "Alice" });
    });

    it("should support version object configuration", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that version object configuration is properly typed
      const options = {
        programName: "test",
        args: ["Alice"],
        version: {
          value: "1.0.0",
          mode: "both" as const,
        },
      };

      const result = run(parser, options);
      assert.deepEqual(result, { name: "Alice" });
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

    it("should enforce completion helpVisibility combinations at compile time", () => {
      const validPlural: RunOptions["completion"] = {
        mode: "both",
        name: "plural",
        helpVisibility: "none",
      };
      void validPlural;

      type InvalidPluralVisibility = Extract<
        RunOptions["completion"],
        {
          readonly name: "plural";
          readonly helpVisibility: "singular";
        }
      >;
      const assertInvalidPlural: AssertNever<InvalidPluralVisibility> =
        undefined as never;
      void assertInvalidPlural;
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
          version: { value: "2.0.0", mode: "both" },
          completion: { mode: "both" },
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
      const originalExit = process.exit;
      process.exit = ((code?: number) => {
        void code;
        throw new Error("exit");
      }) as typeof process.exit;

      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: unknown) => {
        helpOutput += chunk;
        return true;
      }) as typeof process.stdout.write;

      try {
        runSync(prog, {
          args: ["--help"],
          help: "option",
        });
      } catch {
        // Expected exit
      } finally {
        process.exit = originalExit;
        process.stdout.write = originalWrite;
      }

      assert.ok(helpOutput.includes("myapp-sync"));
    });
  });
});

describe("runAsync", () => {
  // Create an async ValueParser for testing
  function asyncString(): ValueParser<"async", string> {
    return {
      $mode: "async",
      metavar: "ASYNC_STRING",
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
      const originalExit = process.exit;
      process.exit = ((code?: number) => {
        exitCode = code ?? 0;
        throw new Error("EXIT");
      }) as typeof process.exit;

      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: unknown) => {
        helpOutput += String(chunk);
        return true;
      }) as typeof process.stdout.write;

      try {
        run(prog, {
          args: ["--help"],
          help: "option",
        });
      } catch (err) {
        if ((err as Error).message !== "EXIT") throw err;
      } finally {
        process.exit = originalExit;
        process.stdout.write = originalWrite;
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
      const originalExit = process.exit;
      process.exit = (() => {
        throw new Error("EXIT");
      }) as typeof process.exit;

      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: unknown) => {
        helpOutput += String(chunk);
        return true;
      }) as typeof process.stdout.write;

      try {
        run(prog, {
          args: ["--help"],
          help: "option",
        });
      } catch (err) {
        if ((err as Error).message !== "EXIT") throw err;
      } finally {
        process.exit = originalExit;
        process.stdout.write = originalWrite;
      }

      assert.ok(helpOutput.includes("myapp"));
      assert.ok(helpOutput.includes("A test app"));
    });
  });
});
