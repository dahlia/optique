import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { object } from "@optique/core/constructs";
import { runWith } from "@optique/core/facade";
import { message } from "@optique/core/message";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import type { Parser } from "@optique/core/parser";
import { parse } from "@optique/core/parser";
import { fail, flag, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { bindEnv, bool, createEnvContext } from "@optique/env";

describe("bool()", () => {
  describe("parsing", () => {
    it("parses true literals", () => {
      const parser = bool();
      const trueLiterals = ["true", "TRUE", "1", "yes", "YES", "on", "ON"];

      for (const literal of trueLiterals) {
        const result = parser.parse(literal);
        assert.ok(result.success, `Expected ${literal} to be valid`);
        assert.equal(result.value, true);
      }
    });

    it("parses false literals", () => {
      const parser = bool();
      const falseLiterals = [
        "false",
        "FALSE",
        "0",
        "no",
        "NO",
        "off",
        "OFF",
      ];

      for (const literal of falseLiterals) {
        const result = parser.parse(literal);
        assert.ok(result.success, `Expected ${literal} to be valid`);
        assert.equal(result.value, false);
      }
    });

    it("trims whitespace before parsing", () => {
      const parser = bool();

      const trueResult = parser.parse("  yes  ");
      assert.ok(trueResult.success);
      assert.equal(trueResult.value, true);

      const falseResult = parser.parse("\tOFF\n");
      assert.ok(falseResult.success);
      assert.equal(falseResult.value, false);
    });

    it("rejects invalid literals", () => {
      const parser = bool();
      const invalidLiterals = ["", "maybe", "t", "f", "2", "enabled"];

      for (const literal of invalidLiterals) {
        const result = parser.parse(literal);
        assert.ok(!result.success, `Expected ${literal} to be invalid`);
      }
    });
  });

  describe("format", () => {
    it("formats true as true", () => {
      const parser = bool();
      assert.equal(parser.format(true), "true");
    });

    it("formats false as false", () => {
      const parser = bool();
      assert.equal(parser.format(false), "false");
    });
  });

  describe("metadata", () => {
    it("uses BOOLEAN as default metavar", () => {
      const parser = bool();
      assert.equal(parser.metavar, "BOOLEAN");
    });

    it("supports custom metavar", () => {
      const parser = bool({ metavar: "BOOL" });
      assert.equal(parser.metavar, "BOOL");
    });

    it("exposes boolean choices", () => {
      const parser = bool();
      assert.deepEqual(parser.choices, [true, false]);
    });
  });

  describe("custom errors", () => {
    it("supports static invalid-format error", () => {
      const parser = bool({
        errors: {
          invalidFormat: message`Expected a Boolean value.`,
        },
      });

      const result = parser.parse("unknown");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Expected a Boolean value." },
      ]);
    });

    it("supports dynamic invalid-format error", () => {
      const parser = bool({
        errors: {
          invalidFormat: (input) => message`Invalid Boolean input: ${input}.`,
        },
      });

      const result = parser.parse("unknown");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Invalid Boolean input: " },
        { type: "value", value: "unknown" },
        { type: "text", text: "." },
      ]);
    });
  });
});

describe("bindEnv()", () => {
  it("uses CLI value when provided", () => {
    const context = createEnvContext({
      source: (key) => ({ APP_PORT: "8080" })[key],
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", integer()), {
      context,
      key: "PORT",
      parser: integer(),
      default: 3000,
    });

    const result = parse(parser, ["--port", "9000"]);
    assert.ok(result.success);
    assert.equal(result.value, 9000);
  });

  it("uses env value when CLI value is missing", () => {
    const context = createEnvContext({
      source: (key) => ({ APP_PORT: "8080" })[key],
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", integer()), {
      context,
      key: "PORT",
      parser: integer(),
      default: 3000,
    });

    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, 8080);
  });

  it("uses default value when CLI and env are missing", () => {
    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", integer()), {
      context,
      key: "PORT",
      parser: integer(),
      default: 3000,
    });

    const result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value, 3000);
  });

  it("fails when CLI, env, and default are all missing", () => {
    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = bindEnv(option("--api-key", string()), {
      context,
      key: "API_KEY",
      parser: string(),
    });

    const result = parse(parser, []);
    assert.ok(!result.success);
  });

  it("does not fall back to default when env value is invalid", () => {
    const context = createEnvContext({
      source: (key) => ({ APP_PORT: "invalid" })[key],
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", integer()), {
      context,
      key: "PORT",
      parser: integer(),
      default: 3000,
    });

    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const result = parse(parser, [], { annotations });
    assert.ok(!result.success);
  });

  it("supports env-only values via fail() parser", () => {
    const context = createEnvContext({
      source: (key) => ({ APP_TIMEOUT: "60" })[key],
      prefix: "APP_",
    });
    const parser = bindEnv(fail<number>(), {
      context,
      key: "TIMEOUT",
      parser: integer(),
      default: 30,
    });

    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, 60);
  });

  it("propagates CLI parse failure when tokens were consumed", () => {
    const context = createEnvContext({
      source: (key) => ({ APP_PORT: "8080" })[key],
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", integer()), {
      context,
      key: "PORT",
      parser: integer(),
      default: 3000,
    });

    // --port without a value: inner parser consumes the token and fails.
    // bindEnv must propagate this failure, not silently fall back to env/default.
    const result = parse(parser, ["--port"]);
    assert.ok(!result.success);
    // Should show the specific "requires a value" error, not a generic
    // "Unexpected option or argument" message:
    const errorText = result.error
      .map((s) => "text" in s ? s.text : "")
      .join("");
    assert.ok(
      errorText.includes("requires a value"),
      `Expected "requires a value" error, got: ${JSON.stringify(result.error)}`,
    );
  });

  it("falls back to env when CLI parse failure consumed no tokens", () => {
    const context = createEnvContext({
      source: (key) => ({ APP_PORT: "8080" })[key],
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", integer()), {
      context,
      key: "PORT",
      parser: integer(),
      default: 3000,
    });

    // No --port at all: inner parser fails with consumed=0.
    // bindEnv should fall back to env value.
    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, 8080);
  });

  it("works with object() via runWith() contexts", async () => {
    const context = createEnvContext({
      source: (key) =>
        ({
          APP_HOST: "env.example.com",
          APP_VERBOSE: "yes",
        })[key],
      prefix: "APP_",
    });

    const parser = object({
      host: bindEnv(option("--host", string()), {
        context,
        key: "HOST",
        parser: string(),
        default: "localhost",
      }),
      verbose: bindEnv(flag("--verbose"), {
        context,
        key: "VERBOSE",
        parser: bool(),
        default: false,
      }),
      timeout: bindEnv(fail<number>(), {
        context,
        key: "TIMEOUT",
        parser: integer(),
        default: 30,
      }),
    });

    const result = await runWith(parser, "test", [context], {
      args: [],
    });

    assert.equal(result.host, "env.example.com");
    assert.equal(result.verbose, true);
    assert.equal(result.timeout, 30);
  });

  it("preserves inner parser state across object() iterations", () => {
    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = object({
      port: bindEnv(option("--port", integer()), {
        context,
        key: "PORT",
        parser: integer(),
        default: 3000,
      }),
    });

    // --port provided twice: inner parser should detect the duplicate
    // and fail with "cannot be used multiple times".
    const result = parse(parser, ["--port", "8080", "--port", "9090"]);
    assert.ok(!result.success);
  });

  it("only marks hasCliValue when inner parser consumed tokens", () => {
    // A mock inner parser that always succeeds with consumed: [] and
    // provides a value through complete().  This simulates wrappers
    // like bindConfig or withDefault.
    const mockParser = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      parse: (context: { readonly buffer: readonly string[] }) => ({
        success: true as const,
        next: context,
        consumed: [] as string[],
      }),
      complete: () => ({
        success: true as const,
        value: "from-inner-complete",
      }),
      suggest: () => [],
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, undefined>;

    const context = createEnvContext({
      source: () => undefined, // no env value
      prefix: "APP_",
    });
    const parser = bindEnv(mockParser, {
      context,
      key: "HOST",
      parser: string(),
      // No default — if hasCliValue is wrongly true, it would call
      // mockParser.complete() which returns "from-inner-complete".
      // If hasCliValue is correctly false and env is absent, we want
      // to fall through to the inner parser's complete() so downstream
      // wrappers can provide their value.
    });

    const result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value, "from-inner-complete");
  });

  it("falls back to inner parser complete() when env is absent", () => {
    // Simulates bindConfig(option(...)) wrapped by bindEnv:
    // bindEnv(mockConfigParser, {...}).  When CLI has no match and env
    // is absent, bindEnv should delegate to the inner parser's complete()
    // so that the config layer can provide its value.
    const mockConfigParser = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      parse: (context: { readonly buffer: readonly string[] }) => ({
        success: true as const,
        next: context,
        consumed: [] as string[],
      }),
      complete: () => ({
        success: true as const,
        value: "from-config",
      }),
      suggest: () => [],
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, undefined>;

    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = bindEnv(mockConfigParser, {
      context,
      key: "HOST",
      parser: string(),
      // No default — should fall through to inner parser's complete()
    });

    const result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value, "from-config");
  });

  it("prefers env value over inner parser complete()", () => {
    const mockConfigParser = {
      $mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      parse: (context: { readonly buffer: readonly string[] }) => ({
        success: true as const,
        next: context,
        consumed: [] as string[],
      }),
      complete: () => ({
        success: true as const,
        value: "from-config",
      }),
      suggest: () => [],
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, undefined>;

    const context = createEnvContext({
      source: (key) => ({ APP_HOST: "from-env" })[key],
      prefix: "APP_",
    });
    const parser = bindEnv(mockConfigParser, {
      context,
      key: "HOST",
      parser: string(),
    });

    // Register env source
    context.getAnnotations();

    const result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value, "from-env");
  });

  it("returns a Promise from complete() in async mode for default path", async () => {
    const asyncInt: ValueParser<"async", number> = {
      $mode: "async",
      metavar: "INT",
      parse(input: string): Promise<ValueParserResult<number>> {
        const n = parseInt(input, 10);
        if (isNaN(n)) {
          return Promise.resolve({
            success: false,
            error: message`Invalid integer: ${input}`,
          });
        }
        return Promise.resolve({ success: true, value: n });
      },
      format(v: number): string {
        return v.toString();
      },
    };

    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", asyncInt), {
      context,
      key: "PORT",
      parser: asyncInt,
      default: 3000,
    });

    // complete() with a state that has no CLI value should fall through
    // to getEnvOrDefault, which takes the default path.  In async mode
    // the return value must be a Promise.
    const completeResult = parser.complete(
      // deno-lint-ignore no-explicit-any
      { hasCliValue: false } as any,
    );
    assert.ok(
      completeResult instanceof Promise,
      "Expected complete() to return a Promise in async mode",
    );
    const value = await completeResult;
    assert.ok(value.success);
    assert.equal(value.value, 3000);
  });

  it("returns a Promise from complete() in async mode for error path", async () => {
    const asyncInt: ValueParser<"async", number> = {
      $mode: "async",
      metavar: "INT",
      parse(input: string): Promise<ValueParserResult<number>> {
        const n = parseInt(input, 10);
        if (isNaN(n)) {
          return Promise.resolve({
            success: false,
            error: message`Invalid integer: ${input}`,
          });
        }
        return Promise.resolve({ success: true, value: n });
      },
      format(v: number): string {
        return v.toString();
      },
    };

    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", asyncInt), {
      context,
      key: "PORT",
      parser: asyncInt,
      // No default — should take the error path.
    });

    const completeResult = parser.complete(
      // deno-lint-ignore no-explicit-any
      { hasCliValue: false } as any,
    );
    assert.ok(
      completeResult instanceof Promise,
      "Expected complete() to return a Promise in async mode",
    );
    const value = await completeResult;
    assert.ok(!value.success);
  });

  it("returns a Promise from complete() in async mode for env path", async () => {
    const asyncInt: ValueParser<"async", number> = {
      $mode: "async",
      metavar: "INT",
      parse(input: string): Promise<ValueParserResult<number>> {
        const n = parseInt(input, 10);
        if (isNaN(n)) {
          return Promise.resolve({
            success: false,
            error: message`Invalid integer: ${input}`,
          });
        }
        return Promise.resolve({ success: true, value: n });
      },
      format(v: number): string {
        return v.toString();
      },
    };

    const context = createEnvContext({
      source: (key) => ({ APP_PORT: "8080" })[key],
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", asyncInt), {
      context,
      key: "PORT",
      parser: asyncInt,
    });

    // Register the active env source (normally done by the runner).
    context.getAnnotations();

    const completeResult = parser.complete(
      // deno-lint-ignore no-explicit-any
      { hasCliValue: false } as any,
    );
    assert.ok(
      completeResult instanceof Promise,
      "Expected complete() to return a Promise in async mode",
    );
    const value = await completeResult;
    assert.ok(value.success);
    assert.equal(value.value, 8080);
  });

  it("supports multiple env contexts with different prefixes and sources", async () => {
    // Regression test for https://github.com/dahlia/optique/issues/136
    // When two EnvContext instances are passed to runWith(), each parser
    // bound to its own context must read from the correct source, even
    // through the annotation path (not just the active-registry fallback).
    //
    // The bug: both contexts write annotations under the same shared
    // envKey symbol, so mergeAnnotations() keeps only the first context's
    // data.  A parser bound to the second context then reads the wrong
    // source via the annotation path.
    //
    // Using a top-level (non-object) bindEnv parser ensures the annotation
    // path is exercised: injectAnnotationsIntoParser() sets annotations on
    // the parser's initialState, so bindEnv.parse() sees them and stores
    // them in the EnvBindState; bindEnv.complete() then reads from
    // annotations[envKey] (wrong context) instead of annotations[context.id].
    const context1 = createEnvContext({
      source: (key) => ({ APP_HOST: "app.example.com" })[key],
      prefix: "APP_",
    });
    const context2 = createEnvContext({
      source: (key) => ({ DB_HOST: "db.example.com" })[key],
      prefix: "DB_",
    });

    // Top-level parser bound to context2 — context1 is only present so
    // its annotations overwrite context2's in the merge, exposing the bug.
    const parser = bindEnv(option("--db-host", string()), {
      context: context2,
      key: "HOST",
      parser: string(),
      default: "fallback",
    });

    const result = await runWith(parser, "test", [context1, context2], {
      args: [],
    });

    // Must read from context2's source, not context1's.
    assert.equal(result, "db.example.com");
  });
});
