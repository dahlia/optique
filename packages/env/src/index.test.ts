import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { injectAnnotations } from "@optique/core/extension";
import {
  concat,
  group,
  merge,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { runWith } from "@optique/core/facade";
import { formatMessage, message } from "@optique/core/message";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import type { Parser } from "@optique/core/parser";
import {
  parse,
  parseAsync,
  suggestAsync,
  suggestSync,
} from "@optique/core/parser";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import { constant, fail, flag, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { bindConfig, createConfigContext } from "../../config/src/index.ts";
import {
  collectExplicitSourceValues,
  createDependencyRuntimeContext,
} from "../../core/src/dependency-runtime.ts";
import { bindEnv, bool, createEnvContext } from "./index.ts";

const sourcePath = fileURLToPath(new URL("./index.ts", import.meta.url));

function asyncChoice<const T extends readonly string[]>(
  choices: T,
): ValueParser<"async", T[number]> {
  const parser = choice(choices);
  return {
    ...parser,
    mode: "async",
    async parse(input: string) {
      return await parser.parse(input);
    },
    async *suggest(prefix: string) {
      if (parser.suggest == null) return;
      yield* parser.suggest(prefix);
    },
  };
}

function getJsDocFor(sourceText: string, functionName: string): string {
  const declaration = `export function ${functionName}`;
  const declarationIndex = sourceText.indexOf(declaration);
  assert.notEqual(
    declarationIndex,
    -1,
    `Expected to find declaration for ${functionName}().`,
  );
  const prefix = sourceText.slice(0, declarationIndex);
  const match = prefix.match(/(\/\*\*[\s\S]*?\*\/)\s*$/u);
  assert.ok(match, `Expected an adjacent JSDoc block for ${functionName}().`);
  return match[1];
}

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

    it("suggests all accepted literals for empty prefix", () => {
      const parser = bool();
      assert.deepEqual([...parser.suggest?.("") ?? []], [
        { kind: "literal", text: "true" },
        { kind: "literal", text: "1" },
        { kind: "literal", text: "yes" },
        { kind: "literal", text: "on" },
        { kind: "literal", text: "false" },
        { kind: "literal", text: "0" },
        { kind: "literal", text: "no" },
        { kind: "literal", text: "off" },
      ]);
    });

    it("filters suggestions by prefix", () => {
      const parser = bool();
      assert.deepEqual([...parser.suggest?.("t") ?? []], [
        { kind: "literal", text: "true" },
      ]);
    });

    it("filters suggestions case-insensitively", () => {
      const parser = bool();
      assert.deepEqual([...parser.suggest?.("T") ?? []], [
        { kind: "literal", text: "true" },
      ]);
    });

    it("matches multiple suggestions with shared prefix", () => {
      const parser = bool();
      assert.deepEqual([...parser.suggest?.("o") ?? []], [
        { kind: "literal", text: "on" },
        { kind: "literal", text: "off" },
      ]);
    });

    it("returns empty array for unmatched prefix", () => {
      const parser = bool();
      assert.deepEqual([...parser.suggest?.("xyz") ?? []], []);
    });

    it("rejects an empty metavar", () => {
      const callBool = bool as (...args: readonly unknown[]) => unknown;
      assert.throws(
        () => Reflect.apply(callBool, undefined, [{ metavar: "" }]),
        TypeError,
      );
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

  describe("JSDoc", () => {
    it("documents its TypeError failure mode", () => {
      const sourceText = readFileSync(sourcePath, {
        encoding: "utf8",
      });
      const jsDoc = getJsDocFor(sourceText, "bool");

      assert.match(jsDoc, /@throws\s+\{TypeError\}/u);
    });
  });
});

describe("bindEnv()", () => {
  describe("type constraints", () => {
    it("accepts only sync env parsers for sync bindEnv, but both for async bindEnv", () => {
      const context = createEnvContext();
      const syncIntegerParser = integer();
      const syncCliParser = option("--port", syncIntegerParser);
      const asyncEnvParser: ValueParser<"async", number> = {
        mode: "async",
        metavar: syncIntegerParser.metavar,
        placeholder: 0,
        format: syncIntegerParser.format,
        parse(input: string): Promise<ValueParserResult<number>> {
          return Promise.resolve(syncIntegerParser.parse(input));
        },
      };
      const asyncCliParser = option("--port", asyncEnvParser);

      bindEnv(syncCliParser, {
        context,
        key: "PORT",
        parser: syncIntegerParser,
      });

      bindEnv(asyncCliParser, {
        context,
        key: "PORT",
        parser: syncIntegerParser,
      });

      bindEnv(asyncCliParser, {
        context,
        key: "PORT",
        parser: asyncEnvParser,
      });

      bindEnv(syncCliParser, {
        context,
        key: "PORT",
        // @ts-expect-error Sync bindEnv must reject async env value parsers.
        parser: asyncEnvParser,
      });
    });
  });

  describe("key validation", () => {
    it("throws TypeError when key is an object", () => {
      const context = createEnvContext();
      assert.throws(
        () =>
          bindEnv(option("--name", string()), {
            context,
            key: {} as never,
            parser: string(),
          }),
        {
          name: "TypeError",
          message: "Expected key to be a string, but got: object.",
        },
      );
    });

    it("throws TypeError when key is null", () => {
      const context = createEnvContext();
      assert.throws(
        () =>
          bindEnv(option("--name", string()), {
            context,
            key: null as never,
            parser: string(),
          }),
        {
          name: "TypeError",
          message: "Expected key to be a string, but got: null.",
        },
      );
    });

    it("throws TypeError when key is a symbol", () => {
      const context = createEnvContext();
      assert.throws(
        () =>
          bindEnv(option("--name", string()), {
            context,
            key: Symbol("KEY") as never,
            parser: string(),
          }),
        {
          name: "TypeError",
          message: "Expected key to be a string, but got: symbol.",
        },
      );
    });

    it("throws TypeError when key is an array", () => {
      const context = createEnvContext();
      assert.throws(
        () =>
          bindEnv(option("--name", string()), {
            context,
            key: [] as never,
            parser: string(),
          }),
        {
          name: "TypeError",
          message: "Expected key to be a string, but got: array.",
        },
      );
    });
  });

  describe("parser validation", () => {
    it("throws TypeError when parser is an empty object", () => {
      const context = createEnvContext();
      assert.throws(
        () =>
          bindEnv(option("--name", string()), {
            context,
            key: "NAME",
            parser: {} as never,
          }),
        {
          name: "TypeError",
          message: "Expected parser to be a ValueParser, but got: object.",
        },
      );
    });

    it("throws TypeError when parser is null", () => {
      const context = createEnvContext();
      assert.throws(
        () =>
          bindEnv(option("--name", string()), {
            context,
            key: "NAME",
            parser: null as never,
          }),
        {
          name: "TypeError",
          message: "Expected parser to be a ValueParser, but got: null.",
        },
      );
    });

    it("throws TypeError when parser is a number", () => {
      const context = createEnvContext();
      assert.throws(
        () =>
          bindEnv(option("--name", string()), {
            context,
            key: "NAME",
            parser: 42 as never,
          }),
        {
          name: "TypeError",
          message: "Expected parser to be a ValueParser, but got: number.",
        },
      );
    });

    it("throws TypeError when parser is a string", () => {
      const context = createEnvContext();
      assert.throws(
        () =>
          bindEnv(option("--name", string()), {
            context,
            key: "NAME",
            parser: "not a parser" as never,
          }),
        {
          name: "TypeError",
          message: "Expected parser to be a ValueParser, but got: string.",
        },
      );
    });

    it("throws TypeError when parser is an array", () => {
      const context = createEnvContext();
      assert.throws(
        () =>
          bindEnv(option("--name", string()), {
            context,
            key: "NAME",
            parser: [] as never,
          }),
        {
          name: "TypeError",
          message: "Expected parser to be a ValueParser, but got: array.",
        },
      );
    });
  });

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

  describe("JSDoc", () => {
    it("documents that inner parser failures can surface", () => {
      const sourceText = readFileSync(sourcePath, {
        encoding: "utf8",
      });
      const jsDoc = getJsDocFor(sourceText, "bindEnv");

      assert.match(jsDoc, /@throws\s+\{Error\}/u);
    });

    it("documents the sync and async parser mode constraint", () => {
      const sourceText = readFileSync(sourcePath, {
        encoding: "utf8",
      });
      const match = sourceText.match(
        /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*\r?\n\s*readonly parser:/u,
      );

      assert.ok(match, "Could not find JSDoc for 'parser' property.");
      const jsDoc = match[1];

      assert.match(
        jsDoc,
        /Value parser used to parse the environment variable string value\.[\s\S]*In sync mode, the value parser must also be synchronous\.[\s\S]*In async mode, either sync or async value parsers are accepted,/u,
      );
    });
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

  it("treats an empty env value as defined and passes it to the parser", () => {
    const context = createEnvContext({
      source: (key) => ({ APP_PORT: "" })[key],
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

  // Regression tests for issue #414: bindEnv() must revalidate fallback
  // values (env-sourced values parsed by a looser env parser, and
  // configured defaults) against the inner CLI parser's constraints.
  describe("fallback validation (#414)", () => {
    it("rejects a default that fails the inner string pattern", () => {
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        option("--name", string({ pattern: /^[A-Z]+$/ })),
        {
          context,
          key: "NAME",
          parser: string(),
          default: "abc" as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
    });

    it("rejects a default that fails the inner integer bounds", () => {
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        option("--port", integer({ min: 1024, max: 65535 })),
        {
          context,
          key: "PORT",
          parser: integer(),
          default: 80 as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
    });

    it("revalidates env values through the inner CLI parser", () => {
      const context = createEnvContext({
        source: (key) => ({ PORT: "80" })[key],
      });
      const parser = bindEnv(
        option("--port", integer({ min: 1024 })),
        {
          context,
          key: "PORT",
          parser: integer(),
          default: 8080,
        },
      );
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const result = parse(parser, [], { annotations });
      assert.ok(!result.success);
    });

    it("accepts valid defaults without breaking existing usage", () => {
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        option("--port", integer({ min: 1, max: 65535 })),
        {
          context,
          key: "PORT",
          parser: integer(),
          default: 3000,
        },
      );
      const result = parse(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, 3000);
    });

    it("validates defaults through optional() wrapping", () => {
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        optional(option("--name", string({ pattern: /^[A-Z]+$/ }))),
        {
          context,
          key: "NAME",
          parser: string(),
          default: "abc" as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
    });

    it("accepts undefined through optional() wrapping", () => {
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        optional(option("--name", string({ pattern: /^[A-Z]+$/ }))),
        {
          context,
          key: "NAME",
          parser: string(),
          default: undefined as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(result.success);
    });

    it("validates defaults through withDefault() wrapping", () => {
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        withDefault(
          option("--name", string({ pattern: /^[A-Z]+$/ })),
          "FALLBACK",
        ),
        {
          context,
          key: "NAME",
          parser: string(),
          default: "abc" as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
    });

    it("falls through map() without validation", () => {
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        map(option("--name", string()), (n) => n.toUpperCase()),
        {
          context,
          key: "NAME",
          parser: string(),
          default: "already-upper" as never,
        },
      );
      // map() strips validateValue; fallback returned unvalidated.
      const result = parse(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "already-upper");
    });

    it("validates defaults in async mode", async () => {
      const asyncStringWithPattern: ValueParser<"async", string> = {
        mode: "async",
        metavar: "NAME",
        placeholder: "",
        parse(input: string) {
          if (!/^[A-Z]+$/.test(input)) {
            return Promise.resolve({
              success: false as const,
              error: message`Expected uppercase, got: ${input}.`,
            });
          }
          return Promise.resolve({
            success: true as const,
            value: input,
          });
        },
        format(value: string) {
          return value;
        },
      };
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        option("--name", asyncStringWithPattern),
        {
          context,
          key: "NAME",
          parser: asyncStringWithPattern,
          default: "abc" as never,
        },
      );
      const result = await parseAsync(parser, []);
      assert.ok(!result.success);
    });

    it("forwards validateValue through group() wrapping", () => {
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        group(
          "Server",
          option("--name", string({ pattern: /^[A-Z]+$/ })),
        ),
        {
          context,
          key: "NAME",
          parser: string(),
          default: "abc" as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
    });

    it("validates dependency-source env values through inner parser", () => {
      const context = createEnvContext({
        source: (key) => ({ PORT: "80" })[key],
      });
      const source = dependency(integer({ min: 1024 }));
      const portParser = bindEnv(option("--port", source), {
        context,
        key: "PORT",
        parser: integer(),
      });
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parseResult = portParser.parse({
        buffer: [],
        state: injectAnnotations(portParser.initialState, annotations),
        optionsTerminated: false,
        usage: portParser.usage,
      });
      assert.ok(parseResult.success);
      const extracted = portParser.dependencyMetadata?.source
        ?.extractSourceValue(parseResult.next.state);
      assert.ok(extracted != null && !(extracted instanceof Promise));
      assert.ok(!extracted.success);
    });

    it("validates dependency-source defaults through inner parser", () => {
      const context = createEnvContext({
        source: () => undefined,
      });
      const source = dependency(integer({ min: 1024 }));
      const portParser = bindEnv(option("--port", source), {
        context,
        key: "PORT",
        parser: integer(),
        default: 80 as never,
      });
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parseResult = portParser.parse({
        buffer: [],
        state: injectAnnotations(portParser.initialState, annotations),
        optionsTerminated: false,
        usage: portParser.usage,
      });
      assert.ok(parseResult.success);
      const getMissing = portParser.dependencyMetadata?.source
        ?.getMissingSourceValue;
      assert.ok(typeof getMissing === "function");
      const missing = getMissing!();
      assert.ok(missing != null && !(missing instanceof Promise));
      assert.ok(!missing.success);
    });

    it("bindEnv fallback errors carry the option-name prefix", () => {
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        option("--port", integer({ min: 1024, max: 65535 })),
        {
          context,
          key: "PORT",
          parser: integer(),
          default: 80 as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
      if (!result.success) {
        const formatted = formatMessage(result.error);
        assert.ok(
          formatted.includes("--port"),
          `expected error to include --port prefix, got: ${formatted}`,
        );
      }
    });

    it("does not attach validateValue to derived value parsers", () => {
      // Derived value parsers (deriveFrom / derive) rebuild from default
      // dependency values, so their format() does not correspond to a
      // live-validated round-trip.  bindEnv must skip validation in that
      // case and return the configured default unchanged.
      const source = dependency(string());
      const derived = source.deriveSync({
        metavar: "TAG",
        defaultValue: () => "default-dep",
        factory: (dep: string): ValueParser<"sync", string> => ({
          mode: "sync",
          metavar: "TAG",
          placeholder: "",
          parse: (input: string) => ({
            success: true as const,
            value: `${dep}:${input}`,
          }),
          format: (value: string) => value,
        }),
      });
      const derivedOption = option("--tag", derived);
      // Sanity check: derived value parsers have no validateValue.
      assert.equal(derivedOption.validateValue, undefined);
      const context = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(derivedOption, {
        context,
        key: "TAG",
        parser: string(),
        default: "fallback" as never,
      });
      const result = parse(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "fallback");
    });
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

  it("tuple() does not re-evaluate env fallback parsers", () => {
    const source = dependency(string());
    let parseCalls = 0;
    const flakyEnvParser: ValueParser<"sync", string> = {
      mode: "sync",
      metavar: "MODE",
      placeholder: "",
      parse(input: string) {
        parseCalls += 1;
        return parseCalls === 1
          ? { success: true, value: input }
          : { success: false, error: message`env parser re-ran` };
      },
      format(value: string) {
        return value;
      },
    };
    const context = createEnvContext({
      source: (key) => key === "MODE" ? "prod" : undefined,
    });
    const parser = tuple([
      bindEnv(option("--mode", source), {
        context,
        key: "MODE",
        parser: flakyEnvParser,
      }),
    ]);
    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const result = parse(parser, [], { annotations });

    assert.ok(result.success);
    assert.deepEqual(result.value, ["prod"]);
    assert.equal(parseCalls, 1);
  });

  it("concat() does not re-evaluate env fallback parsers", () => {
    const source = dependency(string());
    let parseCalls = 0;
    const flakyEnvParser: ValueParser<"sync", string> = {
      mode: "sync",
      metavar: "MODE",
      placeholder: "",
      parse(input: string) {
        parseCalls += 1;
        return parseCalls === 1
          ? { success: true, value: input }
          : { success: false, error: message`env parser re-ran` };
      },
      format(value: string) {
        return value;
      },
    };
    const context = createEnvContext({
      source: (key) => key === "MODE" ? "prod" : undefined,
    });
    const parser = concat(
      tuple([
        bindEnv(option("--mode", source), {
          context,
          key: "MODE",
          parser: flakyEnvParser,
        }),
      ]),
      tuple([]),
    );
    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const result = parse(parser, [], { annotations });

    assert.ok(result.success);
    assert.deepEqual(result.value, ["prod"]);
    assert.equal(parseCalls, 1);
  });

  it("uses env values when prefix is omitted", () => {
    const context = createEnvContext({
      source: (key) => ({ PORT: "8080" })[key],
    });
    const parser = bindEnv(option("--port", integer()), {
      context,
      key: "PORT",
      parser: integer(),
    });

    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, 8080);
  });

  it("uses env values when prefix is an empty string", () => {
    const context = createEnvContext({
      source: (key) => ({ PORT: "8080" })[key],
      prefix: "",
    });
    const parser = bindEnv(option("--port", integer()), {
      context,
      key: "PORT",
      parser: integer(),
    });

    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, 8080);
  });

  it("supports standalone bindEnv(flag(...))", () => {
    const context = createEnvContext({
      source: (key) => ({ APP_VERBOSE: "yes" })[key],
      prefix: "APP_",
    });
    const parser = bindEnv(flag("--verbose"), {
      context,
      key: "VERBOSE",
      parser: bool(),
      default: false,
    });

    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, true);
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
      mode: "sync" as const,
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
      mode: "sync" as const,
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

  it("preserves raw inner state when env fallback delegates complete()", () => {
    const configContext = createConfigContext<
      { readonly mode?: "dev" | "prod" }
    >({
      schema: {
        "~standard": {
          version: 1,
          vendor: "optique-test",
          validate(input: unknown) {
            return {
              value: input as { readonly mode?: "dev" | "prod" },
            };
          },
        },
      },
    });
    const annotations = configContext.getAnnotations(
      { phase: "phase2", parsed: {} },
      {
        load: () => ({
          config: { mode: "prod" as const },
          meta: undefined,
        }),
      },
    );
    assert.ok(!(annotations instanceof Promise));
    if (annotations instanceof Promise) return;

    const mode = dependency(choice(["dev", "prod"] as const));
    const inner = object({
      mode: bindConfig(option("--mode", mode), {
        context: configContext,
        key: "mode",
      }),
    });
    const parser = bindEnv(inner, {
      context: createEnvContext({
        prefix: "APP_",
        source: () => undefined,
      }),
      key: "CONFIG",
      parser: {
        mode: "sync",
        metavar: "CONFIG",
        placeholder: { mode: "dev" as const },
        parse(input) {
          if (input === "prod") {
            return {
              success: true as const,
              value: { mode: "prod" as const },
            };
          }
          if (input === "dev") {
            return {
              success: true as const,
              value: { mode: "dev" as const },
            };
          }
          return {
            success: false as const,
            error: message`Invalid config.`,
          };
        },
        format(value) {
          return value.mode;
        },
      },
    });

    const result = parser.complete(
      injectAnnotations(parser.initialState, annotations),
    );
    assert.deepEqual(result, {
      success: true,
      value: { mode: "prod" },
    });
  });

  it("prefers env value over inner parser complete()", () => {
    const mockConfigParser = {
      mode: "sync" as const,
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

    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }

    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, "from-env");
  });

  it("returns a Promise from complete() in async mode for default path", async () => {
    const asyncInt: ValueParser<"async", number> = {
      mode: "async",
      metavar: "INT",
      placeholder: 0,
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
    const completeResult = parser.complete(parser.initialState);
    assert.ok(
      completeResult instanceof Promise,
      "Expected complete() to return a Promise in async mode",
    );
    const value = await completeResult;
    assert.ok(value.success);
    assert.equal(value.value, 3000);
  });

  it("returns a Promise from complete() in async mode for error path", async () => {
    const asyncFailureParser: Parser<"async", number, undefined> = {
      mode: "async",
      $valueType: [] as readonly number[],
      $stateType: [] as readonly undefined[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: context,
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({
          success: false as const,
          error: message`Missing port.`,
        });
      },
      suggest() {
        return (async function* () {})();
      },
      getDocFragments: () => ({ fragments: [] }),
    };

    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = bindEnv(asyncFailureParser, {
      context,
      key: "PORT",
      parser: {
        mode: "async",
        metavar: "INT",
        placeholder: 0,
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
      },
      // No default — should take the error path.
    });

    const completeResult = parser.complete(parser.initialState);
    assert.ok(
      completeResult instanceof Promise,
      "Expected complete() to return a Promise in async mode",
    );
    const value = await completeResult;
    assert.ok(!value.success);
  });

  it("bindEnv getSuggestRuntimeNodes preserves zero-consumption cliState", () => {
    const context = createEnvContext({
      prefix: "APP_",
      source: () => undefined,
    });
    const inner: Parser<"sync", string, string> = {
      mode: "sync" as const,
      $valueType: [] as readonly string[],
      $stateType: [] as readonly string[],
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: "initial",
      parse(parseContext) {
        return {
          success: true as const,
          next: { ...parseContext, state: "cli-state" },
          consumed: [],
        };
      },
      complete: () => ({ success: true as const, value: "cli-state" }),
      suggest: () => [],
      getSuggestRuntimeNodes(state, path) {
        return [{ path, parser: inner, state }];
      },
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser: Parser<"sync", string, string> = bindEnv(inner, {
      context,
      key: "NAME",
      parser: string(),
      default: "fallback",
    });

    const parsed = parser.parse({
      buffer: [],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parsed.success);
    if (!parsed.success) return;

    const nodes = parser.getSuggestRuntimeNodes?.(parsed.next.state, ["name"]);
    assert.ok(nodes != null);
    if (nodes == null) return;
    assert.equal(nodes.length, 1);
    assert.deepEqual(nodes[0]?.path, ["name"]);
    assert.equal(nodes[0]?.parser, inner);
    assert.equal(nodes[0]?.state, "cli-state");
  });

  it("bindEnv getSuggestRuntimeNodes preserves inner nodes for source parsers", () => {
    const context = createEnvContext({ source: () => undefined });
    const mode = dependency(choice(["dev", "prod"] as const));
    const inner = multiple(option("--mode", mode));
    const modeListParser: ValueParser<"sync", readonly ("dev" | "prod")[]> = {
      mode: "sync",
      metavar: "MODE",
      placeholder: ["dev"],
      parse(input) {
        if (input === "dev" || input === "prod") {
          return { success: true as const, value: [input] as const };
        }
        return { success: false as const, error: message`Invalid mode.` };
      },
      format(value) {
        return value.join(",");
      },
    };
    const parser = bindEnv(inner, {
      context,
      key: "MODE",
      parser: modeListParser,
    });

    const parsed = parser.parse({
      buffer: ["--mode", "prod"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parsed.success);
    if (!parsed.success) return;

    const nodes = parser.getSuggestRuntimeNodes?.(parsed.next.state, ["mode"]);
    assert.ok(nodes != null);
    if (nodes == null) return;

    assert.equal(nodes.at(-1)?.parser, parser);
    assert.deepEqual(nodes.at(-1)?.path, ["mode"]);
    assert.equal(nodes.at(-1)?.state, parsed.next.state);
    assert.ok(nodes.some((node) => node.parser === inner));
    assert.ok(
      nodes.some((node) =>
        JSON.stringify(node.path) === JSON.stringify(["mode", 0])
      ),
    );
  });

  it("bindEnv getSuggestRuntimeNodes keeps outer source precedence", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source(key) {
        return ({ APP_MODE: "prod" } as const)[key as "APP_MODE"];
      },
    });
    const envAnnotations = envContext.getAnnotations();
    if (envAnnotations instanceof Promise) {
      throw new TypeError("Expected synchronous env annotations.");
    }
    const configContext = createConfigContext<
      { readonly mode?: "dev" | "prod" }
    >({
      schema: {
        "~standard": {
          version: 1,
          vendor: "optique-test",
          validate(input: unknown) {
            return {
              value: input as { readonly mode?: "dev" | "prod" },
            };
          },
        },
      },
    });
    const parser = bindEnv(
      bindConfig(
        option("--mode", dependency(choice(["dev", "prod"] as const))),
        {
          context: configContext,
          key: "mode",
        },
      ),
      {
        context: envContext,
        key: "MODE",
        parser: choice(["dev", "prod"] as const),
      },
    );
    const state = injectAnnotations(parser.initialState, {
      ...envAnnotations,
      [configContext.id]: { data: { mode: "dev" as const } },
    });
    const nodes = parser.getSuggestRuntimeNodes?.(state, ["mode"]);
    assert.ok(nodes != null);
    if (nodes == null) return;

    const runtime = createDependencyRuntimeContext();
    collectExplicitSourceValues(nodes, runtime);

    const sourceId = parser.dependencyMetadata?.source?.sourceId;
    assert.ok(sourceId != null);
    if (sourceId == null) return;
    assert.ok(runtime.hasSource(sourceId));
    assert.ok(!runtime.isSourceFailed(sourceId));
    assert.equal(runtime.getSource(sourceId), "prod");
  });

  it("returns a Promise from complete() in async mode for env path", async () => {
    const asyncInt: ValueParser<"async", number> = {
      mode: "async",
      metavar: "INT",
      placeholder: 0,
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

    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }

    const completeResult = parser.complete(
      injectAnnotations(
        { hasCliValue: false } as unknown as Parameters<
          typeof parser.complete
        >[0],
        annotations,
      ),
    );
    assert.ok(
      completeResult instanceof Promise,
      "Expected complete() to return a Promise in async mode",
    );
    const value = await completeResult;
    assert.ok(value.success);
    assert.equal(value.value, 8080);
  });

  it("returns a Promise from parse() in async mode", async () => {
    const asyncInt: ValueParser<"async", number> = {
      mode: "async",
      metavar: "INT",
      placeholder: 0,
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
    });

    const parseResult = parser.parse({
      buffer: ["--port", "9000"] as readonly string[],
      state: undefined,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(
      parseResult instanceof Promise,
      "Expected parse() to return a Promise in async mode",
    );
    const resolved = await parseResult;
    assert.ok(resolved.success);
    if (resolved.success) {
      assert.equal(resolved.consumed.length, 2);
    }
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

  it("unwraps wrapped state across parse() calls", () => {
    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = bindEnv(option("--name", string()), {
      context,
      key: "NAME",
      parser: string(),
      default: "fallback",
    });
    const parseContext = {
      buffer: [] as readonly string[],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };
    const first = parser.parse(parseContext);
    assert.ok(first.success);

    const second = parser.parse({
      ...parseContext,
      buffer: ["--name", "alice"],
      state: first.next.state,
    });
    assert.ok(second.success);
    assert.deepEqual(second.consumed, ["--name", "alice"]);
  });

  it("passes default through getDocFragments when upper default is absent", () => {
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

    const docState = parser.initialState as unknown as Parameters<
      typeof parser.getDocFragments
    >[0];
    const fragments = parser.getDocFragments(docState);
    assert.ok(Array.isArray(fragments.fragments));
  });

  it("uses upper default over bindEnv default in getDocFragments", () => {
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

    const docState = parser.initialState as unknown as Parameters<
      typeof parser.getDocFragments
    >[0];
    const fragments = parser.getDocFragments(docState, 7000);
    assert.ok(Array.isArray(fragments.fragments));
  });

  it("throws when sync mode parser.parse returns a Promise", () => {
    const brokenSyncParser = {
      mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      parse: () =>
        Promise.resolve({
          success: true as const,
          next: {
            buffer: [],
            state: undefined,
            optionsTerminated: false,
            usage: [],
          },
          consumed: [],
        }),
      complete: () => ({ success: true as const, value: "ok" }),
      suggest: () => [],
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, undefined>;
    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = bindEnv(brokenSyncParser, {
      context,
      key: "NAME",
      parser: string(),
    });
    assert.throws(
      () =>
        parser.parse({
          buffer: [],
          state: parser.initialState,
          optionsTerminated: false,
          usage: parser.usage,
        }),
      {
        name: "TypeError",
        message: "Synchronous mode cannot map Promise value.",
      },
    );
  });

  it("throws when sync mode complete path receives a Promise", () => {
    const brokenSyncParser = {
      mode: "sync" as const,
      $valueType: undefined,
      $stateType: undefined,
      priority: 0,
      usage: [],
      initialState: undefined,
      parse: (ctx: { readonly buffer: readonly string[] }) => ({
        success: true as const,
        next: {
          buffer: ctx.buffer,
          state: undefined,
          optionsTerminated: false,
          usage: [],
        },
        consumed: [],
      }),
      complete: () => Promise.resolve({ success: true as const, value: "ok" }),
      suggest: () => [],
      getDocFragments: () => ({ fragments: [] }),
    } as unknown as Parser<"sync", string, undefined>;
    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = bindEnv(brokenSyncParser, {
      context,
      key: "NAME",
      parser: string(),
    });

    assert.throws(() => parse(parser, []), {
      name: "TypeError",
      message: "Synchronous mode cannot wrap Promise value.",
    });
  });

  describe("non-string EnvSource value validation", () => {
    it("fails when EnvSource returns an object", () => {
      const context = createEnvContext({
        source: () => ({ bad: true } as never),
      });
      const parser = bindEnv(option("--name", string()), {
        context,
        key: "NAME",
        parser: string(),
      });

      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const result = parse(parser, [], { annotations });
      assert.ok(!result.success);
      const errorText = result.error
        .map((s) => s.type === "text" ? s.text : "")
        .join("");
      assert.match(
        errorText,
        /must be a string, but got: /u,
      );
    });

    it("fails when EnvSource returns a number", () => {
      const context = createEnvContext({
        source: () => (123 as never),
      });
      const parser = bindEnv(option("--port", integer()), {
        context,
        key: "PORT",
        parser: integer(),
      });

      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const result = parse(parser, [], { annotations });
      assert.ok(!result.success);
      const errorText = result.error
        .map((s) => s.type === "text" ? s.text : "")
        .join("");
      assert.match(
        errorText,
        /must be a string, but got: /u,
      );
    });

    it("fails when EnvSource returns a Promise", () => {
      const context = createEnvContext({
        source: () => Promise.resolve("alice") as never,
      });
      const parser = bindEnv(option("--name", string()), {
        context,
        key: "NAME",
        parser: string(),
      });

      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const result = parse(parser, [], { annotations });
      assert.ok(!result.success);
      const errorText = result.error
        .map((s) => s.type === "text" ? s.text : "")
        .join("");
      assert.match(
        errorText,
        /must be a string, but got: /u,
      );
    });
  });

  it("propagates source errors from the annotation-backed env lookup", () => {
    const sourceError = new Error("Environment access failed.");
    const context = createEnvContext({
      source: (key) => {
        if (key === "APP_PORT") {
          throw sourceError;
        }
        return undefined;
      },
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", integer()), {
      context,
      key: "PORT",
      parser: integer(),
      default: 3000,
    });
    let disposed = false;

    try {
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      context[Symbol.dispose]?.();
      disposed = true;

      assert.throws(
        () => parse(parser, [], { annotations }),
        (error) => error === sourceError,
      );
    } finally {
      if (!disposed) {
        context[Symbol.dispose]?.();
      }
    }
  });

  it("ignores prior context.getAnnotations() calls during plain parse", () => {
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

    assert.deepEqual(
      parse(parser, [], { annotations }),
      { success: true, value: 8080 },
    );

    try {
      const result = parse(parser, []);
      assert.deepEqual(result, { success: true, value: 3000 });
    } finally {
      context[Symbol.dispose]?.();
    }
  });

  it("throws synchronously in async mode when the source function throws", async () => {
    const syncInt = integer();
    const asyncInt: ValueParser<"async", number> = {
      mode: "async",
      metavar: syncInt.metavar,
      placeholder: 0,
      parse(input: string): Promise<ValueParserResult<number>> {
        return Promise.resolve(syncInt.parse(input));
      },
      format: syncInt.format,
    };
    const sourceError = new Error("Environment access failed.");
    const context = createEnvContext({
      source: (key) => {
        if (key === "APP_PORT") {
          throw sourceError;
        }
        return undefined;
      },
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", asyncInt), {
      context,
      key: "PORT",
      parser: asyncInt,
      default: 3000,
    });

    try {
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parseResult = await parser.parse({
        buffer: [] as readonly string[],
        state: injectAnnotations(parser.initialState, annotations),
        optionsTerminated: false,
        usage: parser.usage,
      });
      assert.ok(parseResult.success);

      assert.throws(
        () => parser.complete(parseResult.next.state),
        (error) => error === sourceError,
      );
    } finally {
      context[Symbol.dispose]?.();
    }
  });
});

describe("createEnvContext defaults", () => {
  it("dispose does not invalidate returned annotations", () => {
    const context = createEnvContext({
      source: (key) => ({ APP_PORT: "8080" })[key],
      prefix: "APP_",
    });
    const parser = bindEnv(option("--port", integer()), {
      context,
      key: "PORT",
      parser: integer(),
    });

    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }

    context[Symbol.dispose]?.();

    assert.deepEqual(
      parse(parser, [], { annotations }),
      { success: true, value: 8080 },
    );
  });

  it("uses Deno.env.get by default when available", () => {
    const originalDeno = Object.getOwnPropertyDescriptor(globalThis, "Deno");
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: { get: (key: string) => (key === "APP_KEY" ? "v" : "") } },
    });
    try {
      const context = createEnvContext({ prefix: "APP_" });
      assert.equal(context.source("APP_KEY"), "v");
    } finally {
      if (originalDeno != null) {
        Object.defineProperty(globalThis, "Deno", originalDeno);
      }
    }
  });

  it("throws TypeError when source is not a function", () => {
    assert.throws(
      () => createEnvContext({ source: "nope" as never }),
      {
        name: "TypeError",
        message: "Expected source to be a function, but got: string.",
      },
    );
    assert.throws(
      () => createEnvContext({ source: null as never }),
      {
        name: "TypeError",
        message: "Expected source to be a function, but got: null.",
      },
    );
    assert.throws(
      () => createEnvContext({ source: [] as never }),
      {
        name: "TypeError",
        message: "Expected source to be a function, but got: array.",
      },
    );
  });

  it("throws TypeError when prefix is not a string", () => {
    assert.throws(
      () => createEnvContext({ prefix: 123 as never }),
      {
        name: "TypeError",
        message: "Expected prefix to be a string, but got: number.",
      },
    );
    assert.throws(
      () => createEnvContext({ prefix: false as never }),
      {
        name: "TypeError",
        message: "Expected prefix to be a string, but got: boolean.",
      },
    );
    assert.throws(
      () => createEnvContext({ prefix: { x: 1 } as never }),
      {
        name: "TypeError",
        message: "Expected prefix to be a string, but got: object.",
      },
    );
    assert.throws(
      () => createEnvContext({ prefix: Symbol("P") as never }),
      {
        name: "TypeError",
        message: "Expected prefix to be a string, but got: symbol.",
      },
    );
    assert.throws(
      () => createEnvContext({ prefix: null as never }),
      {
        name: "TypeError",
        message: "Expected prefix to be a string, but got: null.",
      },
    );
    assert.throws(
      () => createEnvContext({ prefix: [] as never }),
      {
        name: "TypeError",
        message: "Expected prefix to be a string, but got: array.",
      },
    );
  });

  it("falls back to process.env when Deno.env.get is unavailable", () => {
    const originalDeno = Object.getOwnPropertyDescriptor(globalThis, "Deno");
    const originalProcess = Object.getOwnPropertyDescriptor(
      globalThis,
      "process",
    );
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: { env: {} },
    });
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: { env: { APP_FROM_PROCESS: "process-value" } },
    });
    try {
      const context = createEnvContext({ prefix: "APP_" });
      assert.equal(context.source("APP_FROM_PROCESS"), "process-value");
    } finally {
      if (originalDeno != null) {
        Object.defineProperty(globalThis, "Deno", originalDeno);
      }
      if (originalProcess != null) {
        Object.defineProperty(globalThis, "process", originalProcess);
      }
    }
  });
});

describe("bindEnv() with dependency sources", () => {
  const mode = dependency(choice(["dev", "prod"] as const));
  const level = mode.derive({
    metavar: "LEVEL",
    mode: "sync",
    factory: (value: "dev" | "prod") =>
      choice(
        value === "dev"
          ? (["debug", "verbose"] as const)
          : (["silent", "strict"] as const),
      ),
    defaultValue: () => "dev" as const,
  });

  function createParser(envSource: (key: string) => string | undefined) {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: envSource,
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = object({
      mode: bindEnv(option("--mode", mode), {
        context: envContext,
        key: "MODE",
        parser: choice(["dev", "prod"] as const),
      }),
      level: option("--level", level),
    });
    return { parser, annotations };
  }

  it("propagates env value as dependency to derived parser (parse)", () => {
    const { parser, annotations } = createParser(
      (key) => ({ APP_MODE: "prod" })[key],
    );
    const result = parse(parser, ["--level", "silent"], { annotations });
    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
  });

  it("exposes env fallback as a source from raw annotated state", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const parser = bindEnv(option("--mode", mode), {
      context: envContext,
      key: "MODE",
      parser: choice(["dev", "prod"] as const),
    });
    const state = injectAnnotations(
      parser.initialState,
      envContext.getAnnotations() as Record<symbol, unknown>,
    );

    assert.deepEqual(
      parser.dependencyMetadata?.source?.extractSourceValue(state),
      { success: true, value: "prod" },
    );
  });

  it("propagates env value as dependency to derived parser (suggest)", () => {
    const { parser, annotations } = createParser(
      (key) => ({ APP_MODE: "prod" })[key],
    );
    const suggestions = suggestSync(parser, ["--level", "s"], { annotations });
    const texts = suggestions.map((s) => "text" in s ? s.text : "");
    assert.ok(texts.includes("silent"));
    assert.ok(texts.includes("strict"));
    assert.ok(!texts.includes("debug"));
    assert.ok(!texts.includes("verbose"));
  });

  it("CLI value takes priority over env for dependency", () => {
    const { parser, annotations } = createParser(
      (key) => ({ APP_MODE: "prod" })[key],
    );
    // CLI --mode dev overrides env APP_MODE=prod
    const result = parse(parser, ["--mode", "dev", "--level", "debug"], {
      annotations,
    });
    assert.ok(result.success);
    assert.equal(result.value.mode, "dev");
    assert.equal(result.value.level, "debug");
  });

  it("rejects invalid derived value when env dependency is set", () => {
    const { parser, annotations } = createParser(
      (key) => ({ APP_MODE: "prod" })[key],
    );
    // "debug" is not valid when mode is "prod"
    const result = parse(parser, ["--level", "debug"], { annotations });
    assert.ok(!result.success);
  });

  it("optional(bindEnv(...)) returns undefined when env is absent", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: () => undefined,
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = object({
      mode: optional(
        bindEnv(option("--mode", mode), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
      ),
      level: option("--level", level),
    });
    // When env is absent and CLI omits --mode, mode should be undefined
    // and derived parser should use its defaultValue ("dev")
    const result = parse(parser, ["--level", "debug"], { annotations });
    assert.ok(result.success);
    assert.equal(result.value.mode, undefined);
    assert.equal(result.value.level, "debug");
  });

  // Regression tests for https://github.com/dahlia/optique/issues/233.
  // optional()/withDefault() wrappers placed under object() must allow
  // bindEnv() to resolve from the env context, not just short-circuit to
  // undefined/fallback.
  it("optional(bindEnv(...)) in object() uses env value when present", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = object({
      mode: optional(
        bindEnv(option("--mode", choice(["dev", "prod"] as const)), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
      ),
    });
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
    }
  });

  it("withDefault(bindEnv(...), fb) in object() uses env value when present", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = object({
      mode: withDefault(
        bindEnv(option("--mode", choice(["dev", "prod"] as const)), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
        "dev" as const,
      ),
    });
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
    }
  });

  it("optional(bindEnv(...)) at top level uses env value via annotations", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = optional(
      bindEnv(option("--mode", choice(["dev", "prod"] as const)), {
        context: envContext,
        key: "MODE",
        parser: choice(["dev", "prod"] as const),
      }),
    );
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "prod");
    }
  });

  it("optional(map(bindEnv(...))) preserves env fallback via annotations", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = optional(
      map(
        bindEnv(option("--mode", choice(["dev", "prod"] as const)), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
        (value) => value.toUpperCase() as Uppercase<typeof value>,
      ),
    );
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "PROD");
    }
  });

  it("optional(bindEnv(..., default)) uses bindEnv default when env absent", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: () => undefined,
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = object({
      mode: optional(
        bindEnv(option("--mode", choice(["dev", "prod"] as const)), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
          default: "dev" as const,
        }),
      ),
    });
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "dev");
    }
  });

  it("withDefault(bindEnv(...)) uses outer fallback when env and CLI absent", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: () => undefined,
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = object({
      mode: withDefault(
        bindEnv(option("--mode", choice(["dev", "prod"] as const)), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
        "dev" as const,
      ),
    });
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "dev");
    }
  });

  it("runWith: optional(bindEnv(...)) uses registered env source", async () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const parser = object({
      level: option("--level", string()),
      mode: optional(
        bindEnv(option("--mode", choice(["dev", "prod"] as const)), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
      ),
    });
    const result = await runWith(parser, "test", [envContext], {
      args: ["--level", "info"],
    });
    assert.equal(result.mode, "prod");
    assert.equal(result.level, "info");
  });

  it("bindEnv(optional(...)) uses defaultValue when env is absent", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: () => undefined,
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = object({
      mode: bindEnv(optional(option("--mode", mode)), {
        context: envContext,
        key: "MODE",
        parser: choice(["dev", "prod"] as const),
      }),
      level: option("--level", level),
    });
    // When env is absent and CLI omits --mode, derived parser should use
    // its defaultValue ("dev"), so "debug" (a dev-mode level) should work
    const result = parse(parser, ["--level", "debug"], { annotations });
    assert.ok(result.success);
    assert.equal(result.value.mode, undefined);
    assert.equal(result.value.level, "debug");
  });

  it("propagates async env value as dependency to derived parser (parse)", async () => {
    const asyncMode = dependency(asyncChoice(["dev", "prod"] as const));
    const asyncLevel = asyncMode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (value: "dev" | "prod") =>
        choice(
          value === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = object({
      mode: bindEnv(option("--mode", asyncMode), {
        context: envContext,
        key: "MODE",
        parser: asyncChoice(["dev", "prod"] as const),
      }),
      level: option("--level", asyncLevel),
    });

    const result = await parse(parser, ["--level", "silent"], {
      annotations,
    });
    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
  });

  it("propagates async env value as dependency to derived parser (suggest)", async () => {
    const asyncMode = dependency(asyncChoice(["dev", "prod"] as const));
    const asyncLevel = asyncMode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (value: "dev" | "prod") =>
        choice(
          value === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = object({
      mode: bindEnv(option("--mode", asyncMode), {
        context: envContext,
        key: "MODE",
        parser: asyncChoice(["dev", "prod"] as const),
      }),
      level: option("--level", asyncLevel),
    });

    const suggestions = await suggestAsync(parser, ["--level", "s"], {
      annotations,
    });
    const texts = suggestions
      .filter((s) => s.kind === "literal")
      .map((s) => s.text);
    assert.ok(texts.includes("silent"));
    assert.ok(texts.includes("strict"));
    assert.ok(!texts.includes("debug"));
    assert.ok(!texts.includes("verbose"));
  });

  it("keeps dependency source extraction side-effect free for inner fallbacks", () => {
    const sourceId = Symbol("mode");
    const innerState = { kind: "inner-state" } as const;
    let completeCalls = 0;
    const innerParser = {
      mode: "sync" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: undefined as typeof innerState | undefined,
      parse(context) {
        return {
          success: true as const,
          next: { ...context, state: innerState },
          consumed: [],
        };
      },
      complete() {
        completeCalls += 1;
        return { success: true as const, value: "prod" as const };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
      dependencyMetadata: {
        source: {
          kind: "source" as const,
          sourceId,
          preservesSourceValue: true,
          extractSourceValue(state: unknown) {
            return state === innerState
              ? { success: true as const, value: "prod" as const }
              : undefined;
          },
        },
      },
    } as const satisfies
      & Parser<"sync", "prod", typeof innerState | undefined>
      & {
        readonly dependencyMetadata: {
          readonly source: {
            readonly kind: "source";
            readonly sourceId: typeof sourceId;
            readonly preservesSourceValue: true;
            readonly extractSourceValue: (
              state: unknown,
            ) => ValueParserResult<unknown> | undefined;
          };
        };
      };
    const parser = bindEnv(innerParser, {
      context: createEnvContext({ source: () => undefined }),
      key: "MODE",
      parser: string(),
    });
    const parseResult = parser.parse({
      buffer: [],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parseResult.success);
    const extracted = parser.dependencyMetadata?.source?.extractSourceValue(
      parseResult.next.state,
    );
    assert.deepEqual(extracted, { success: true, value: "prod" });
    assert.equal(completeCalls, 0);
  });

  it("preserves outer annotations when no-CLI fallback delegates source extraction", () => {
    const configContext = createConfigContext<
      { readonly mode?: "dev" | "prod" }
    >({
      schema: {
        "~standard": {
          version: 1,
          vendor: "optique-test",
          validate(input: unknown) {
            return {
              value: input as { readonly mode?: "dev" | "prod" },
            };
          },
        },
      },
    });
    const source = dependency(choice(["dev", "prod"] as const));
    const innerParser = bindConfig(option("--mode", source), {
      context: configContext,
      key: "mode",
    });
    const parser = bindEnv(innerParser, {
      context: createEnvContext({ source: () => undefined }),
      key: "MODE",
      parser: string(),
    });
    const annotations = configContext.getAnnotations(
      { phase: "phase2", parsed: {} },
      {
        load: () => ({
          config: { mode: "prod" as const },
          meta: undefined,
        }),
      },
    );
    assert.ok(!(annotations instanceof Promise));
    if (annotations instanceof Promise) return;
    const parseResult = parser.parse({
      buffer: [],
      state: injectAnnotations(parser.initialState, annotations),
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parseResult.success);
    if (!parseResult.success) return;

    const extracted = parser.dependencyMetadata?.source?.extractSourceValue(
      parseResult.next.state,
    );
    assert.deepEqual(extracted, { success: true, value: "prod" });
  });

  it("only injects annotations into fallback state for inheriting parsers", () => {
    const envContext = createEnvContext({ source: () => undefined });
    const annotations = envContext.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }

    let completedState: unknown;
    const innerParser = {
      mode: "sync" as const,
      $valueType: [] as const,
      $stateType: [] as const,
      priority: 0,
      usage: [],
      leadingNames: new Set<string>(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse() {
        return {
          success: false as const,
          consumed: 0,
          error: message`No CLI value.`,
        };
      },
      complete(state: unknown) {
        completedState = state;
        return { success: true as const, value: "fallback" as const };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
      shouldDeferCompletion() {
        return true;
      },
    } as const satisfies Parser<"sync", "fallback", undefined>;
    const parser = bindEnv(innerParser, {
      context: envContext,
      key: "MODE",
      parser: string(),
    });
    const parseResult = parser.parse({
      buffer: [],
      state: injectAnnotations(parser.initialState, annotations),
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parseResult.success);
    if (!parseResult.success) return;

    const completed = parser.complete(parseResult.next.state);

    assert.deepEqual(completed, { success: true, value: "fallback" });
    assert.equal(completedState, undefined);
  });

  it("treats injected annotation wrappers as omitted CLI state during complete()", () => {
    const envContext = createEnvContext({ source: () => undefined });
    const annotations = envContext.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }

    const inner = option("--mode", string());
    const parser = bindEnv(inner, {
      context: envContext,
      key: "MODE",
      parser: string(),
    });
    const completed = parser.complete(
      injectAnnotations(parser.initialState, annotations),
    );

    assert.deepEqual(completed, inner.complete(undefined));
  });

  it("does not invent mapped dependency source values from env fallbacks", () => {
    const source = dependency(choice(["dev", "prod"] as const));
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "production" })[key],
    });
    const parser = bindEnv(
      map(
        option("--mode", source),
        (value) => value === "dev" ? "development" : "production",
      ),
      {
        context: envContext,
        key: "MODE",
        parser: choice(["development", "production"] as const),
      },
    );
    envContext.getAnnotations();
    try {
      const parseResult = parser.parse({
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      });
      assert.ok(parseResult.success);
      assert.equal(
        parser.dependencyMetadata?.source?.extractSourceValue(
          parseResult.next.state,
        ),
        undefined,
      );
    } finally {
      envContext[Symbol.dispose]?.();
    }
  });
});

// https://github.com/dahlia/optique/issues/681
describe("bindEnv() with dependency sources across merge() boundaries", () => {
  const mode = dependency(choice(["dev", "prod"] as const));
  const level = mode.derive({
    metavar: "LEVEL",
    mode: "sync",
    factory: (value: "dev" | "prod") =>
      choice(
        value === "dev"
          ? (["debug", "verbose"] as const)
          : (["silent", "strict"] as const),
      ),
    defaultValue: () => "dev" as const,
  });

  function createMergedParser(envSource: (key: string) => string | undefined) {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: envSource,
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = merge(
      object({
        mode: bindEnv(option("--mode", mode), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
      }),
      object({
        level: option("--level", level),
      }),
    );
    return { parser, annotations };
  }

  it("propagates env value as dependency to derived parser (parse)", () => {
    const { parser, annotations } = createMergedParser(
      (key) => ({ APP_MODE: "prod" })[key],
    );
    const result = parse(parser, ["--level", "silent"], { annotations });
    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
  });

  it("propagates env value as dependency to derived parser (suggest)", () => {
    const { parser, annotations } = createMergedParser(
      (key) => ({ APP_MODE: "prod" })[key],
    );
    const suggestions = suggestSync(
      parser,
      ["--level", "s"],
      { annotations },
    );
    const texts = suggestions
      .filter((s) => s.kind === "literal")
      .map((s) => s.text);
    assert.ok(
      texts.includes("silent"),
      `Expected "silent" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      texts.includes("strict"),
      `Expected "strict" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("debug"),
      `Did not expect "debug" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("verbose"),
      `Did not expect "verbose" in suggestions, got: ${JSON.stringify(texts)}`,
    );
  });

  it("CLI-provided dependency source works across merged children", () => {
    const { parser, annotations } = createMergedParser(
      (key) => ({ APP_MODE: "dev" })[key],
    );
    // CLI --mode overrides env value
    const result = parse(
      parser,
      ["--mode", "prod", "--level", "silent"],
      { annotations },
    );
    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
  });

  it("CLI-provided dependency source also wins during suggest()", () => {
    const { parser, annotations } = createMergedParser(
      (key) => ({ APP_MODE: "prod" })[key],
    );
    const texts = suggestSync(
      parser,
      ["--mode", "dev", "--level", ""],
      { annotations },
    )
      .filter((s) => s.kind === "literal")
      .map((s) => s.text);
    assert.ok(
      texts.includes("debug"),
      `Expected "debug" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      texts.includes("verbose"),
      `Expected "verbose" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("silent"),
      `Did not expect "silent" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("strict"),
      `Did not expect "strict" in suggestions, got: ${JSON.stringify(texts)}`,
    );
  });

  it("nested merge() propagates env-backed dependency", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = merge(
      merge(
        object({
          mode: bindEnv(option("--mode", mode), {
            context: envContext,
            key: "MODE",
            parser: choice(["dev", "prod"] as const),
          }),
        }),
        object({
          extra: option("--extra", string()),
        }),
      ),
      object({
        level: option("--level", level),
      }),
    );
    const result = parse(
      parser,
      ["--extra", "foo", "--level", "silent"],
      { annotations },
    );
    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
  });

  it("group()-wrapped child propagates env-backed dependency", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = merge(
      group(
        "source",
        object({
          mode: bindEnv(option("--mode", mode), {
            context: envContext,
            key: "MODE",
            parser: choice(["dev", "prod"] as const),
          }),
        }),
      ),
      object({
        level: option("--level", level),
      }),
    );
    const result = parse(
      parser,
      ["--level", "silent"],
      { annotations },
    );
    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
  });

  it("group()-wrapped child propagates env-backed dependency during suggest()", () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations() as Record<symbol, unknown>;
    const parser = merge(
      group(
        "source",
        object({
          mode: bindEnv(option("--mode", mode), {
            context: envContext,
            key: "MODE",
            parser: choice(["dev", "prod"] as const),
          }),
        }),
      ),
      object({
        level: option("--level", level),
      }),
    );
    const texts = suggestSync(parser, ["--level", "s"], { annotations })
      .filter((s) => s.kind === "literal")
      .map((s) => s.text);
    assert.ok(
      texts.includes("silent"),
      `Expected "silent" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      texts.includes("strict"),
      `Expected "strict" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("debug"),
      `Did not expect "debug" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("verbose"),
      `Did not expect "verbose" in suggestions, got: ${JSON.stringify(texts)}`,
    );
  });
});

// https://github.com/dahlia/optique/issues/768
describe("bindEnv() with dependency sources across tuple()/concat() boundaries", () => {
  const mode = dependency(choice(["dev", "prod"] as const));
  const level = mode.derive({
    metavar: "LEVEL",
    mode: "sync",
    factory: (value: "dev" | "prod") =>
      choice(
        value === "dev"
          ? (["debug", "verbose"] as const)
          : (["silent", "strict"] as const),
      ),
    defaultValue: () => "dev" as const,
  });

  function createTupleParser() {
    const context = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const parser = tuple([
      bindEnv(option("--mode", mode), {
        context,
        key: "MODE",
        parser: choice(["dev", "prod"] as const),
      }),
      option("--level", level),
    ]);
    return { parser, annotations };
  }

  function createConcatParser() {
    const context = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const parser = concat(
      tuple([
        bindEnv(option("--mode", mode), {
          context,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
      ]),
      tuple([
        option("--level", level),
      ]),
    );
    return { parser, annotations };
  }

  it("tuple() parse uses env-backed dependency source", () => {
    const { parser, annotations } = createTupleParser();
    const result = parse(parser, ["--level", "silent"], { annotations });

    assert.ok(result.success);
    assert.deepEqual(result.value, ["prod", "silent"]);
  });

  it("tuple() suggest uses env-backed dependency source", () => {
    const { parser, annotations } = createTupleParser();
    const texts = suggestSync(
      parser,
      ["--level", "s"],
      { annotations },
    )
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);

    assert.ok(
      texts.includes("silent"),
      `Expected "silent" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      texts.includes("strict"),
      `Expected "strict" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("debug"),
      `Did not expect "debug" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("verbose"),
      `Did not expect "verbose" in suggestions, got: ${JSON.stringify(texts)}`,
    );
  });

  it("tuple() suggest does not override invalid CLI source with env", () => {
    const { parser, annotations } = createTupleParser();
    const texts = suggestSync(
      parser,
      ["--mode", "invalid", "--level", "s"],
      { annotations },
    )
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);

    assert.ok(!texts.includes("silent"));
    assert.ok(!texts.includes("strict"));
  });

  it("concat() parse uses env-backed dependency source", () => {
    const { parser, annotations } = createConcatParser();
    const result = parse(parser, ["--level", "silent"], { annotations });

    assert.ok(result.success);
    assert.deepEqual(result.value, ["prod", "silent"]);
  });

  it("concat() suggest uses env-backed dependency source", () => {
    const { parser, annotations } = createConcatParser();
    const texts = suggestSync(
      parser,
      ["--level", "s"],
      { annotations },
    )
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);

    assert.ok(
      texts.includes("silent"),
      `Expected "silent" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      texts.includes("strict"),
      `Expected "strict" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("debug"),
      `Did not expect "debug" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("verbose"),
      `Did not expect "verbose" in suggestions, got: ${JSON.stringify(texts)}`,
    );
  });

  it("concat() suggest does not override invalid CLI source with env", () => {
    const { parser, annotations } = createConcatParser();
    const texts = suggestSync(
      parser,
      ["--mode", "invalid", "--level", "s"],
      { annotations },
    )
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);

    assert.ok(!texts.includes("silent"));
    assert.ok(!texts.includes("strict"));
  });
});

describe("or(bindEnv(...), constant(...))", () => {
  it("selects bindEnv branch when CLI input is provided", () => {
    const context = createEnvContext({
      source: () => undefined,
      prefix: "APP_",
    });
    const parser = or(
      bindEnv(option("--mode", string()), {
        context,
        key: "MODE",
        parser: string(),
      }),
      constant("fallback"),
    );

    const result = parse(parser, ["--mode", "cli-value"]);
    assert.ok(result.success);
    assert.equal(result.value, "cli-value");
  });

  it("falls back to constant when CLI is absent (env branch has leadingNames)", () => {
    const context = createEnvContext({
      source: (key) => ({ APP_MODE: "prod" })[key],
      prefix: "APP_",
    });
    const parser = or(
      bindEnv(option("--mode", string()), {
        context,
        key: "MODE",
        parser: string(),
      }),
      constant("fallback"),
    );

    // bindEnv(option("--mode")) has leadingNames from the inner option,
    // so it is not eligible as a zero-consumed fallback even with env set.
    const annotations = context.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, "fallback");
  });
});
