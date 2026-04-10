import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { getDocPage, parse, suggestSync } from "@optique/core/parser";
import type { Parser } from "@optique/core/parser";
import {
  concat,
  group,
  merge,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import { getAnnotations, injectAnnotations } from "@optique/core/annotations";
import type { SourceContextRequest } from "@optique/core/context";
import { dependency } from "@optique/core/dependency";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import { constant, fail, flag, option } from "@optique/core/primitives";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import { choice, integer, string } from "@optique/core/valueparser";
import { formatMessage, message } from "@optique/core/message";
import { bindEnv, createEnvContext } from "@optique/env";

import type { Annotations } from "@optique/core/annotations";
import {
  collectExplicitSourceValues,
  createDependencyRuntimeContext,
} from "../../core/src/dependency-runtime.ts";
import { bindConfig, createConfigContext } from "./index.ts";
import type { ConfigLoadResult, ConfigMeta } from "./index.ts";

type IsExact<T, U> = (<V>() => V extends T ? 1 : 2) extends
  (<V>() => V extends U ? 1 : 2)
  ? ((<V>() => V extends U ? 1 : 2) extends (<V>() => V extends T ? 1 : 2)
    ? true
    : false)
  : false;

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new TypeError(message);
  }

  return value;
}

function phase2<T>(parsed: T): SourceContextRequest {
  return { phase: "phase2", parsed };
}

describe("createConfigContext", () => {
  test("creates a config context with Standard Schema", () => {
    const schema = z.object({
      host: z.string(),
      port: z.number(),
    });

    const context = createConfigContext({ schema });

    assert.ok(context);
    assert.equal(typeof context.id, "symbol");
    assert.equal(typeof context.getAnnotations, "function");
  });

  test("context id is not registered in the global Symbol registry", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    // Symbol.for() would register the symbol so that Symbol.for(description)
    // returns the *same* symbol — making it accessible by any code that knows
    // the description string.  Symbol() does not register, so looking it up
    // via Symbol.for(description) produces a different symbol.
    const lookedUp = Symbol.for(context.id.description!);
    assert.notEqual(
      context.id,
      lookedUp,
      "Context id should not be retrievable from the global Symbol registry",
    );
  });

  test("returns empty annotations when called without parsed result", async () => {
    const schema = z.object({
      host: z.string(),
    });

    const context = createConfigContext({ schema });
    const annotations = await context.getAnnotations();

    assert.ok(annotations);
    assert.deepEqual(Object.getOwnPropertySymbols(annotations).length, 0);
  });

  for (
    const [parsed, expectedHost, label] of [
      [0, "zero-host", "0"],
      [false, "false-host", "false"],
      ["", "empty-string-host", '""'],
    ] as const
  ) {
    test(
      `treats ${label} as a valid phase-two parsed value`,
      async () => {
        const schema = z.object({
          host: z.string(),
        });

        const context = createConfigContext({ schema });
        let receivedParsed: unknown;

        const annotations = await context.getAnnotations(phase2(parsed), {
          load: (value: unknown) => {
            receivedParsed = value;
            return {
              config: { host: expectedHost },
              meta: {
                configDir: "/app",
                configPath: "/app/config.json",
              } satisfies ConfigMeta,
            };
          },
        });

        assert.equal(receivedParsed, parsed);
        const contextAnnotation = annotations[context.id] as
          | { readonly data: unknown; readonly meta?: unknown }
          | undefined;
        assert.ok(contextAnnotation != null);
        assert.deepEqual(contextAnnotation.data, { host: expectedHost });
      },
    );
  }
});

describe("bindConfig", () => {
  describe("key validation", () => {
    test("throws TypeError when key is an object", () => {
      const context = createConfigContext({
        schema: z.object({ name: z.string() }),
      });
      assert.throws(
        () =>
          bindConfig(option("--name", string()), {
            context,
            key: {} as never,
          }),
        {
          name: "TypeError",
          message:
            "Expected key to be a property key or function, but got: object.",
        },
      );
    });

    test("throws TypeError when key is null", () => {
      const context = createConfigContext({
        schema: z.object({ name: z.string() }),
      });
      assert.throws(
        () =>
          bindConfig(option("--name", string()), {
            context,
            key: null as never,
          }),
        {
          name: "TypeError",
          message:
            "Expected key to be a property key or function, but got: null.",
        },
      );
    });

    test("throws TypeError when key is an array", () => {
      const context = createConfigContext({
        schema: z.object({ name: z.string() }),
      });
      assert.throws(
        () =>
          bindConfig(option("--name", string()), {
            context,
            key: [] as never,
          }),
        {
          name: "TypeError",
          message:
            "Expected key to be a property key or function, but got: array.",
        },
      );
    });

    test("accepts symbol keys", () => {
      const sym = Symbol("KEY");
      const context = createConfigContext<{ [sym]: string }>({
        schema: z.object({}) as never,
      });
      // Should not throw — symbol is a valid property key
      assert.doesNotThrow(() =>
        bindConfig(option("--name", string()), {
          context,
          key: sym,
        })
      );
    });

    test("accepts numeric keys", () => {
      const context = createConfigContext<{ 0: string }>({
        schema: z.object({}) as never,
      });
      // Should not throw — number is a valid property key
      assert.doesNotThrow(() =>
        bindConfig(option("--name", string()), {
          context,
          key: 0,
        })
      );
    });

    test("rejects async key callback at parse time", async () => {
      const schema = z.object({ name: z.string() });
      const context = createConfigContext({ schema });
      const parser = bindConfig(option("--name", string()), {
        context,
        // deno-lint-ignore require-await
        key: (async (config: { name: string }) =>
          config.name.toUpperCase()) as never,
      });
      const annotations = await context.getAnnotations(phase2({}), {
        load: () => ({ config: { name: "alice" }, meta: undefined }),
      });
      assert.throws(
        () => parse(parser, [], { annotations }),
        {
          name: "TypeError",
          message:
            "The key callback must return a synchronous value, but got a thenable.",
        },
      );
    });

    test("rejects thenable-returning key callback at parse time", async () => {
      const schema = z.object({ name: z.string() });
      const context = createConfigContext({ schema });
      const thenable = {
        then: (resolve: (value: string) => void) => resolve("ALICE"),
      };
      const parser = bindConfig(option("--name", string()), {
        context,
        key: (() => thenable) as never,
      });
      const annotations = await context.getAnnotations(phase2({}), {
        load: () => ({ config: { name: "alice" }, meta: undefined }),
      });
      assert.throws(
        () => parse(parser, [], { annotations }),
        {
          name: "TypeError",
          message:
            "The key callback must return a synchronous value, but got a thenable.",
        },
      );
    });

    test("rejects callable thenable-returning key callback at parse time", async () => {
      const schema = z.object({ name: z.string() });
      const context = createConfigContext({ schema });
      const callableThenable = Object.assign(
        () => "ignored",
        { then: (resolve: (value: string) => void) => resolve("ALICE") },
      );
      const parser = bindConfig(option("--name", string()), {
        context,
        key: (() => callableThenable) as never,
      });
      const annotations = await context.getAnnotations(phase2({}), {
        load: () => ({ config: { name: "alice" }, meta: undefined }),
      });
      assert.throws(
        () => parse(parser, [], { annotations }),
        {
          name: "TypeError",
          message:
            "The key callback must return a synchronous value, but got a thenable.",
        },
      );
    });
  });

  test("uses CLI value when provided", () => {
    const schema = z.object({
      host: z.string(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--host", string()), {
      context,
      key: "host",
      default: "localhost",
    });

    // With CLI value
    const result = parse(parser, ["--host", "example.com"]);
    assert.ok(result.success);
    assert.equal(result.value, "example.com");
  });

  test("uses config value when CLI value not provided", () => {
    const schema = z.object({
      host: z.string(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--host", string()), {
      context,
      key: "host",
      default: "localhost",
    });

    // Without CLI value, but with config annotation.
    // Annotations are keyed by context.id (per-instance symbol) so that
    // multiple config contexts can coexist without overwriting each other.
    const configData = { host: "config.example.com" };
    const annotations: Annotations = {
      [context.id]: { data: configData },
    };

    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, "config.example.com");
  });

  test("uses default value when CLI and config both not provided", () => {
    const schema = z.object({
      host: z.string().optional(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--host", string()), {
      context,
      key: "host",
      default: "localhost",
    });

    // No CLI value, no config value
    const result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value, "localhost");
  });

  // Regression tests for issue #414: bindConfig() must revalidate fallback
  // values (config-sourced values and configured defaults) against the
  // inner CLI parser's constraints.
  describe("fallback validation (#414)", () => {
    test("rejects a default that fails the inner string pattern", () => {
      const context = createConfigContext({
        schema: z.object({ name: z.string().optional() }),
      });
      const parser = bindConfig(
        option("--name", string({ pattern: /^[A-Z]+$/ })),
        {
          context,
          key: "name",
          default: "abc" as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
      if (!result.success) {
        // Lock in that the rejection is due to the pattern constraint,
        // not some unrelated missing-value failure (#414).
        const formatted = formatMessage(result.error);
        assert.ok(
          formatted.includes("--name"),
          `expected error to mention --name, got: ${formatted}`,
        );
        assert.ok(
          formatted.includes("pattern") || formatted.includes("/^[A-Z]+$/"),
          `expected error to mention the pattern, got: ${formatted}`,
        );
      }
    });

    test("rejects a default that fails the inner integer bounds", () => {
      const context = createConfigContext({
        schema: z.object({ port: z.number().optional() }),
      });
      const parser = bindConfig(
        option("--port", integer({ min: 1024, max: 65535 })),
        {
          context,
          key: "port",
          default: 80 as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
      if (!result.success) {
        const formatted = formatMessage(result.error);
        assert.ok(
          formatted.includes("--port"),
          `expected error to mention --port, got: ${formatted}`,
        );
        // The inner integer() parser produces an "at least 1,024" message.
        assert.ok(
          formatted.includes("1,024"),
          `expected error to mention the lower bound, got: ${formatted}`,
        );
      }
    });

    test("revalidates config values through the inner CLI parser", () => {
      const context = createConfigContext({
        schema: z.object({ port: z.number() }),
      });
      const parser = bindConfig(
        option("--port", integer({ min: 1024 })),
        {
          context,
          key: "port",
          default: 8080,
        },
      );
      const annotations: Annotations = {
        [context.id]: { data: { port: 80 } },
      };
      const result = parse(parser, [], { annotations });
      assert.ok(!result.success);
      if (!result.success) {
        const formatted = formatMessage(result.error);
        assert.ok(
          formatted.includes("--port"),
          `expected error to mention --port, got: ${formatted}`,
        );
        assert.ok(
          formatted.includes("1,024"),
          `expected error to mention the lower bound, got: ${formatted}`,
        );
      }
    });

    test("accepts valid defaults without breaking existing usage", () => {
      const context = createConfigContext({
        schema: z.object({ port: z.number().optional() }),
      });
      const parser = bindConfig(
        option("--port", integer({ min: 1, max: 65535 })),
        {
          context,
          key: "port",
          default: 3000,
        },
      );
      const result = parse(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, 3000);
    });

    test("validates defaults through optional() wrapping", () => {
      const context = createConfigContext({
        schema: z.object({ name: z.string().optional() }),
      });
      const parser = bindConfig(
        optional(option("--name", string({ pattern: /^[A-Z]+$/ }))),
        {
          context,
          key: "name",
          default: "abc" as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
    });

    test("validates defaults through withDefault() wrapping", () => {
      const context = createConfigContext({
        schema: z.object({ name: z.string().optional() }),
      });
      const parser = bindConfig(
        withDefault(
          option("--name", string({ pattern: /^[A-Z]+$/ })),
          "FALLBACK",
        ),
        {
          context,
          key: "name",
          default: "abc" as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
    });

    test("falls through map() without validation", () => {
      const context = createConfigContext({
        schema: z.object({ name: z.string().optional() }),
      });
      const parser = bindConfig(
        map(option("--name", string()), (n) => n.toUpperCase()),
        {
          context,
          key: "name",
          default: "already-upper" as never,
        },
      );
      // map() strips validateValue; fallback is returned unvalidated.
      const result = parse(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "already-upper");
    });

    test("propagates validation into bindEnv(bindConfig(...)) composition", () => {
      const configContext = createConfigContext({
        schema: z.object({ name: z.string().optional() }),
      });
      const envContext = createEnvContext({
        source: () => undefined,
      });
      const parser = bindEnv(
        bindConfig(
          option("--name", string({ pattern: /^[A-Z]+$/ })),
          {
            context: configContext,
            key: "name",
          },
        ),
        {
          context: envContext,
          key: "NAME",
          parser: string(),
          default: "abc" as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
    });

    test("validates dependency-source config values through inner parser", () => {
      const context = createConfigContext({
        schema: z.object({ port: z.number() }),
      });
      const source = dependency(integer({ min: 1024 }));
      const portParser = bindConfig(option("--port", source), {
        context,
        key: "port",
      });
      const annotations: Annotations = {
        [context.id]: { data: { port: 80 } },
      };
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

    test("validates dependency-source defaults through inner parser", () => {
      const context = createConfigContext({
        schema: z.object({ port: z.number().optional() }),
      });
      const source = dependency(integer({ min: 1024 }));
      const portParser = bindConfig(option("--port", source), {
        context,
        key: "port",
        default: 80 as never,
      });
      const parseResult = portParser.parse({
        buffer: [],
        state: portParser.initialState,
        optionsTerminated: false,
        usage: portParser.usage,
      });
      assert.ok(parseResult.success);
      // getMissingSourceValue routes through inner parser's validator.
      const getMissing = portParser.dependencyMetadata?.source
        ?.getMissingSourceValue;
      assert.ok(typeof getMissing === "function");
      const missing = getMissing!();
      assert.ok(missing != null && !(missing instanceof Promise));
      assert.ok(!missing.success);
    });

    test("bindConfig revalidates each element of a multiple() fallback", () => {
      const context = createConfigContext({
        schema: z.object({
          roles: z.array(z.string()).optional(),
        }),
      });
      const parser = bindConfig(
        multiple(option("--role", choice(["admin", "user"] as const))),
        {
          context,
          key: "roles",
        },
      );
      const annotations: Annotations = {
        [context.id]: { data: { roles: ["admin", "root"] as const } as never },
      };
      const result = parse(parser, [], { annotations });
      assert.ok(!result.success);
    });

    test("bindConfig rejects multiple() defaults below the min arity", () => {
      const context = createConfigContext({
        schema: z.object({ tags: z.array(z.string()).optional() }),
      });
      const parser = bindConfig(
        multiple(option("--tag", string()), { min: 2 }),
        {
          context,
          key: "tags",
          default: ["only-one"] as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
    });

    test("bindConfig fallback errors carry the option-name prefix", () => {
      const context = createConfigContext({
        schema: z.object({ port: z.number().optional() }),
      });
      const parser = bindConfig(
        option("--port", integer({ min: 1024, max: 65535 })),
        {
          context,
          key: "port",
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

    test("does not attach validateValue to derived value parsers", () => {
      const source = dependency(string());
      const derived = source.deriveSync({
        metavar: "TAG",
        defaultValue: () => "default-dep",
        factory: (dep: string): ValueParser<"sync", string> => ({
          $mode: "sync",
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
      assert.equal(derivedOption.validateValue, undefined);
      const context = createConfigContext({
        schema: z.object({ tag: z.string().optional() }),
      });
      const parser = bindConfig(derivedOption, {
        context,
        key: "tag",
        default: "fallback" as never,
      });
      const result = parse(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "fallback");
    });

    test("forwards validateValue through group() wrapping", () => {
      const context = createConfigContext({
        schema: z.object({ name: z.string().optional() }),
      });
      const parser = bindConfig(
        group(
          "Server",
          option("--name", string({ pattern: /^[A-Z]+$/ })),
        ),
        {
          context,
          key: "name",
          default: "abc" as never,
        },
      );
      const result = parse(parser, []);
      assert.ok(!result.success);
    });
  });

  test("marks usage as optional when default is provided", () => {
    const schema = z.object({
      host: z.string().optional(),
    });

    const context = createConfigContext({ schema });
    const innerParser = option("--host", string());
    const parser = bindConfig(innerParser, {
      context,
      key: "host",
      default: "localhost",
    });

    assert.equal(parser.usage.length, 1);
    assert.equal(parser.usage[0].type, "optional");
    if (parser.usage[0].type === "optional") {
      assert.deepEqual(parser.usage[0].terms, innerParser.usage);
    }
  });

  test("fails when no CLI, no config, and no default", () => {
    const schema = z.object({
      host: z.string().optional(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--host", string()), {
      context,
      key: "host",
    });

    // No CLI value, no config value, no default
    const result = parse(parser, []);
    assert.ok(!result.success);
  });

  test("supports nested key access with function", () => {
    const schema = z.object({
      server: z.object({
        host: z.string(),
        port: z.number(),
      }),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--host", string()), {
      context,
      key: (config) => config.server.host,
      default: "localhost",
    });

    // With config containing nested value
    const configData = {
      server: {
        host: "nested.example.com",
        port: 8080,
      },
    };
    const annotations: Annotations = {
      [context.id]: { data: configData },
    };

    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, "nested.example.com");
  });

  test("passes config metadata to key accessor callback", () => {
    const schema = z.object({
      outDir: z.string(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--out-dir", string()), {
      context,
      key: (config, meta) =>
        `${
          requireValue(meta, "Expected config metadata.").configDir
        }:${config.outDir}`,
      default: "unused",
    });

    // Data and metadata are stored together under context.id.
    const annotations: Annotations = {
      [context.id]: {
        data: { outDir: "./dist" },
        meta: {
          configDir: "/project",
          configPath: "/project/app.json",
        } satisfies ConfigMeta,
      },
    };

    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, "/project:./dist");
  });

  test("passes undefined metadata when none is available", () => {
    const schema = z.object({
      outDir: z.string(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--out-dir", string()), {
      context,
      key: (config, meta) => {
        const exact: IsExact<typeof meta, ConfigMeta | undefined> = true;
        assert.equal(exact, true);
        return `${meta?.configDir ?? "no-meta"}:${config.outDir}`;
      },
      default: "unused",
    });

    // No meta field — only data is present.
    const annotations: Annotations = {
      [context.id]: { data: { outDir: "./dist" } },
    };

    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, "no-meta:./dist");
  });

  test("ConfigLoadResult allows undefined metadata", () => {
    const loaded: ConfigLoadResult = {
      config: { outDir: "./dist" },
      meta: undefined,
    };

    assert.equal(loaded.meta, undefined);
  });

  test("supports nested key access with string key path", () => {
    const schema = z.object({
      database: z.object({
        host: z.string(),
      }),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--db-host", string()), {
      context,
      key: (config) => config.database.host,
      default: "localhost",
    });

    const configData = {
      database: {
        host: "db.example.com",
      },
    };
    const annotations: Annotations = {
      [context.id]: { data: configData },
    };

    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, "db.example.com");
  });

  test("priority: CLI > config > default", () => {
    const schema = z.object({
      port: z.number(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--port", integer()), {
      context,
      key: "port",
      default: 3000,
    });

    // Test CLI priority
    const configData = { port: 8080 };
    const annotations: Annotations = {
      [context.id]: { data: configData },
    };

    const cliResult = parse(parser, ["--port", "9000"], { annotations });
    assert.ok(cliResult.success);
    assert.equal(cliResult.value, 9000);

    // Test config priority over default
    const configResult = parse(parser, [], { annotations });
    assert.ok(configResult.success);
    assert.equal(configResult.value, 8080);

    // Test default when nothing else
    const defaultResult = parse(parser, []);
    assert.ok(defaultResult.success);
    assert.equal(defaultResult.value, 3000);
  });

  test("keeps multiple ConfigContext instances isolated in merged annotations", async () => {
    const leftContext = createConfigContext({
      schema: z.object({ host: z.string() }),
    });
    const rightContext = createConfigContext({
      schema: z.object({ host: z.string() }),
    });
    const leftParser = bindConfig(fail<string>(), {
      context: leftContext,
      key: "host",
    });
    const rightParser = bindConfig(fail<string>(), {
      context: rightContext,
      key: "host",
    });

    try {
      const leftAnnotations = await leftContext.getAnnotations(phase2(true), {
        load: () => ({ config: { host: "left.example.com" } }),
      });
      const rightAnnotations = await rightContext.getAnnotations(phase2(true), {
        load: () => ({ config: { host: "right.example.com" } }),
      });
      const annotations: Annotations = {
        ...rightAnnotations,
        ...leftAnnotations,
      };

      const leftResult = parse(leftParser, [], { annotations });
      const rightResult = parse(rightParser, [], { annotations });

      assert.ok(leftResult.success);
      assert.ok(rightResult.success);
      assert.equal(leftResult.value, "left.example.com");
      assert.equal(rightResult.value, "right.example.com");
    } finally {
      leftContext[Symbol.dispose]?.();
      rightContext[Symbol.dispose]?.();
    }
  });

  test("does not fall back to config/default when CLI value is invalid", () => {
    const schema = z.object({
      port: z.number().optional(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--port", integer()), {
      context,
      key: "port",
      default: 3000,
    });

    const annotations: Annotations = {
      [context.id]: { data: { port: 8080 } },
    };

    const result = parse(parser, ["--port", "not-a-number"], { annotations });
    assert.ok(!result.success);
  });

  test("works within object() combinator", () => {
    const schema = z.object({
      host: z.string().optional(),
      port: z.number().optional(),
    });

    const context = createConfigContext({ schema });

    const parser = object({
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

    // When used within object(), bindConfig falls back to defaults
    // (config annotations require two-pass parsing via runWithConfig)
    const result = parse(parser, ["--host", "cli.com"]);
    assert.ok(result.success);
    assert.equal(result.value.host, "cli.com"); // from CLI
    assert.equal(result.value.port, 3000); // from default (not config)
  });

  test("tuple() complete() does not re-evaluate config fallback readers", () => {
    const source = dependency(string());
    let keyCalls = 0;
    const context = createConfigContext({
      schema: z.object({ mode: z.string() }),
    });
    const annotations: Annotations = {
      [context.id]: { data: { mode: "prod" } },
    };
    const leaf = bindConfig(option("--mode", source), {
      context,
      key(config) {
        keyCalls += 1;
        if (keyCalls > 1) {
          throw new TypeError("Config key callback re-ran.");
        }
        return config.mode;
      },
    });
    const leafParse = leaf.parse({
      buffer: [],
      state: injectAnnotations(leaf.initialState, annotations),
      optionsTerminated: false,
      usage: leaf.usage,
    });
    assert.ok(leafParse.success);
    const parser = tuple([leaf]);
    const result = parser.complete(
      [leafParse.next.state],
      { usage: parser.usage, phase: "complete", path: [], trace: undefined },
    );

    assert.ok(result.success);
    assert.deepEqual(result.value, ["prod"]);
    assert.equal(keyCalls, 1);
  });

  test("concat() complete() does not re-evaluate config fallback readers", () => {
    const source = dependency(string());
    let keyCalls = 0;
    const context = createConfigContext({
      schema: z.object({ mode: z.string() }),
    });
    const annotations: Annotations = {
      [context.id]: { data: { mode: "prod" } },
    };
    const leaf = bindConfig(option("--mode", source), {
      context,
      key(config) {
        keyCalls += 1;
        if (keyCalls > 1) {
          throw new TypeError("Config key callback re-ran.");
        }
        return config.mode;
      },
    });
    const leafParse = leaf.parse({
      buffer: [],
      state: injectAnnotations(leaf.initialState, annotations),
      optionsTerminated: false,
      usage: leaf.usage,
    });
    assert.ok(leafParse.success);
    const parser = concat(tuple([leaf]), tuple([]));
    const result = parser.complete(
      [[leafParse.next.state], []],
      { usage: parser.usage, phase: "complete", path: [], trace: undefined },
    );

    assert.ok(result.success);
    assert.deepEqual(result.value, ["prod"]);
    assert.equal(keyCalls, 1);
  });

  // Regression test for https://github.com/dahlia/optique/issues/94
  test("does not crash when bindConfig wraps flag() inside object() with no CLI args", () => {
    const schema = z.object({
      myFlag: z.boolean().optional(),
    });

    const context = createConfigContext({ schema });

    const parser = object({
      myFlag: bindConfig(
        flag("-a", "--my-flag"),
        { context, key: "myFlag", default: false },
      ),
    });

    // This should not crash with "Cannot read properties of undefined
    // (reading 'hasCliValue')"
    const result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value.myFlag, false); // from default

    // Also verify that providing the flag still works
    const resultWithFlag = parse(parser, ["-a"]);
    assert.ok(resultWithFlag.success);
    assert.equal(resultWithFlag.value.myFlag, true); // from CLI
  });

  test("exposes default value in help text via getDocFragments()", () => {
    const schema = z.object({
      host: z.string(),
      port: z.number(),
    });

    const context = createConfigContext({ schema });

    const parser = object({
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

    const docPage = getDocPage(parser);
    assert.ok(docPage);
    assert.ok(docPage.sections.length > 0);

    const entries = docPage.sections.flatMap((s) => s.entries);
    const hostEntry = entries.find(
      (e) =>
        e.term.type === "option" &&
        e.term.names.includes("--host"),
    );
    const portEntry = entries.find(
      (e) =>
        e.term.type === "option" &&
        e.term.names.includes("--port"),
    );

    assert.ok(hostEntry);
    assert.ok(portEntry);
    assert.deepEqual(hostEntry.default, message`${"localhost"}`);
    assert.deepEqual(portEntry.default, message`${"3000"}`);
  });

  test("does not set default in help text when no default is provided", () => {
    const schema = z.object({
      host: z.string(),
    });

    const context = createConfigContext({ schema });

    const parser = object({
      host: bindConfig(option("--host", string()), {
        context,
        key: "host",
        // No default
      }),
    });

    const docPage = getDocPage(parser);
    assert.ok(docPage);

    const entries = docPage.sections.flatMap((s) => s.entries);
    const hostEntry = entries.find(
      (e) =>
        e.term.type === "option" &&
        e.term.names.includes("--host"),
    );

    assert.ok(hostEntry);
    assert.equal(hostEntry.default, undefined);
  });

  test("fail() + bindConfig() uses config value when provided", () => {
    const schema = z.object({
      timeout: z.number(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(fail<number>(), {
      context,
      key: "timeout",
      default: 30,
    });

    const configData = { timeout: 60 };
    const annotations: Annotations = {
      [context.id]: { data: configData },
    };

    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, 60);
  });

  test("fail() + bindConfig() uses default when config not provided", () => {
    const schema = z.object({
      timeout: z.number().optional(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(fail<number>(), {
      context,
      key: "timeout",
      default: 30,
    });

    const result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value, 30);
  });

  test("fail() + bindConfig() fails when neither config nor default provided", () => {
    const schema = z.object({
      timeout: z.number().optional(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(fail<number>(), {
      context,
      key: "timeout",
    });

    const result = parse(parser, []);
    assert.ok(!result.success);
  });

  test("fail() + bindConfig() inside object(): falls back to default", () => {
    // Note: config annotations only work for nested parsers when using
    // runWithConfig (two-pass parsing). With plain parse(), nested
    // bindConfig() falls back to default values.
    const schema = z.object({
      host: z.string().optional(),
      timeout: z.number().optional(),
    });

    const context = createConfigContext({ schema });
    const parser = object({
      host: bindConfig(option("--host", string()), {
        context,
        key: "host",
        default: "localhost",
      }),
      timeout: bindConfig(fail<number>(), {
        context,
        key: "timeout",
        default: 30,
      }),
    });

    // timeout has no CLI flag; with plain parse(), it always falls back to default
    const result = parse(parser, ["--host", "cli.com"]);
    assert.ok(result.success);
    assert.equal(result.value.host, "cli.com");
    assert.equal(result.value.timeout, 30); // default, since no runWithConfig

    // Without any input, both fall back to defaults
    const resultDefault = parse(parser, []);
    assert.ok(resultDefault.success);
    assert.equal(resultDefault.value.host, "localhost");
    assert.equal(resultDefault.value.timeout, 30);
  });
});

describe("bindConfig parity with bindEnv", () => {
  test("does not treat withDefault success (consumed: []) as CLI value (issue 2)", () => {
    // When bindConfig wraps a parser that returns success with consumed: []
    // (e.g. withDefault or another bindConfig), the inner success should NOT
    // be treated as a CLI-provided value.  If it were, the config fallback
    // would be skipped.
    const schema = z.object({ port: z.number() });
    const context = createConfigContext({ schema });

    // fail() always fails, so bindConfig falls through to config/default.
    // Wrapping it in another bindConfig with a default simulates the case
    // where the inner layer returns success with consumed: [].
    const inner = bindConfig(fail<number>(), {
      context,
      key: "port",
      default: 9999,
    });

    const outer = bindConfig(inner, {
      context,
      key: "port",
      default: 1111,
    });

    // When the inner bindConfig returns consumed: [] (no CLI tokens), the
    // outer bindConfig must NOT mark hasCliValue = true.  Otherwise the
    // config annotation would be ignored in the outer layer.
    const configData = { port: 8080 };
    const annotations: Annotations = { [context.id]: { data: configData } };

    // The outer layer should see the config annotation and return 8080, not
    // 9999 (inner default) or 1111 (outer default).
    const result = parse(outer, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, 8080);
  });

  test("propagates failure when inner parser consumed tokens (issue 5)", () => {
    // If the inner parser consumed tokens but then failed (e.g. --port with
    // no value following), bindConfig must propagate that specific failure
    // instead of converting it to success with consumed: [].
    const schema = z.object({ port: z.number() });
    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--port", integer()), {
      context,
      key: "port",
      default: 3000,
    });

    // "--port" with no value: the inner option parser will consume "--port"
    // and then fail because there's no value token.
    const result = parse(parser, ["--port"]);
    assert.ok(!result.success);
  });

  test("bindEnv(bindConfig(...)) composition: env fallback works (issue 2)", () => {
    // When composing bindEnv(bindConfig(...)), the env fallback should still
    // activate when no CLI value is provided.  The bug was that bindConfig
    // returned success with consumed: [] (from withDefault / no CLI), and
    // bindEnv was seeing that as "CLI provided a value", so it skipped the
    // env fallback.
    const schema = z.object({ port: z.number() });
    const configCtx = createConfigContext({ schema });

    const envCtx = createEnvContext({
      source: (key) => key === "PORT" ? "7777" : undefined,
    });

    const parser = bindEnv(
      bindConfig(option("--port", integer()), {
        context: configCtx,
        key: "port",
        default: 3000,
      }),
      { context: envCtx, key: "PORT", parser: integer() },
    );

    // Provide env annotations (as a single-pass context, getAnnotations() is called
    // manually here to simulate what runWith() does).
    const envAnnotations = envCtx.getAnnotations();
    if (envAnnotations instanceof Promise) {
      throw new TypeError("Expected synchronous env annotations.");
    }

    // No CLI arg, no config annotation → env should supply 7777
    const result = parse(parser, [], { annotations: envAnnotations });
    assert.ok(result.success);
    assert.equal(result.value, 7777);
  });

  test("state unwrapping: parse() correctly handles wrapped ConfigBindState (issue 4)", () => {
    // When object() calls parse() multiple times on the same parser
    // (iterating over tokens), it passes the wrapped state back each time.
    // bindConfig must unwrap the state before delegating to the inner parser,
    // otherwise the inner parser receives a foreign state object.
    const schema = z.object({ host: z.string(), port: z.number() });
    const context = createConfigContext({ schema });

    const parser = object({
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

    // With multiple CLI args, object() will iterate and pass wrapped states
    // back to each field parser.  Both values should be correctly parsed.
    const result = parse(parser, [
      "--host",
      "cli.example.com",
      "--port",
      "9000",
    ]);
    assert.ok(result.success);
    assert.equal(result.value.host, "cli.example.com");
    assert.equal(result.value.port, 9000);
  });
});

describe("createConfigContext input validation", () => {
  test("rejects non-object schema", () => {
    assert.throws(
      () => createConfigContext({ schema: "not a schema" as never }),
      {
        name: "TypeError",
        message:
          "Expected schema to be a Standard Schema object, but got: string.",
      },
    );
  });

  test("rejects null schema", () => {
    assert.throws(
      () => createConfigContext({ schema: null as never }),
      {
        name: "TypeError",
        message:
          "Expected schema to be a Standard Schema object, but got: null.",
      },
    );
  });

  test("rejects object without ~standard property", () => {
    assert.throws(
      () => createConfigContext({ schema: {} as never }),
      {
        name: "TypeError",
        message:
          "Expected schema to be a Standard Schema object, but got: object.",
      },
    );
  });

  test("rejects array schema", () => {
    assert.throws(
      () => createConfigContext({ schema: [] as never }),
      {
        name: "TypeError",
        message:
          "Expected schema to be a Standard Schema object, but got: array.",
      },
    );
  });

  test("accepts callable Standard Schema (e.g., ArkType)", () => {
    const callableSchema = Object.assign(
      (input: unknown) => input,
      {
        "~standard": {
          validate(value: unknown) {
            return { value };
          },
        },
      },
    );
    const context = createConfigContext({
      schema: callableSchema as never,
    });
    assert.ok(context != null);
  });

  test("accepts callable ~standard property bag", () => {
    const callableStandard = Object.assign(
      () => {},
      {
        validate(value: unknown) {
          return { value };
        },
      },
    );
    const schema = { "~standard": callableStandard };
    const context = createConfigContext({ schema: schema as never });
    assert.ok(context != null);
  });

  test("rejects non-function fileParser", () => {
    const schema = z.object({ host: z.string() });
    assert.throws(
      () => createConfigContext({ schema, fileParser: "nope" as never }),
      {
        name: "TypeError",
        message: "Expected fileParser to be a function, but got: string.",
      },
    );
  });

  test("rejects null fileParser", () => {
    const schema = z.object({ host: z.string() });
    assert.throws(
      () => createConfigContext({ schema, fileParser: null as never }),
      {
        name: "TypeError",
        message: "Expected fileParser to be a function, but got: null.",
      },
    );
  });

  test("rejects array fileParser", () => {
    const schema = z.object({ host: z.string() });
    assert.throws(
      () => createConfigContext({ schema, fileParser: [] as never }),
      {
        name: "TypeError",
        message: "Expected fileParser to be a function, but got: array.",
      },
    );
  });

  test("rejects non-function load in getAnnotations", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    assert.throws(
      () =>
        context.getAnnotations(phase2({ any: 1 }), { load: "nope" as never }),
      {
        name: "TypeError",
        message: "Expected load to be a function, but got: string.",
      },
    );
  });

  test("rejects non-function getConfigPath in getAnnotations", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    assert.throws(
      () =>
        context.getAnnotations(phase2({ any: 1 }), {
          getConfigPath: "nope" as never,
        }),
      {
        name: "TypeError",
        message: "Expected getConfigPath to be a function, but got: string.",
      },
    );
  });

  test("ignores malformed getConfigPath when load is provided", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    // load takes precedence; getConfigPath should not be validated
    const result = context.getAnnotations(phase2({ any: 1 }), {
      load: () => ({
        config: { host: "ok" },
        meta: undefined,
      }),
      getConfigPath: "nope" as never,
    });
    assert.ok(result != null);
  });

  test("rejects non-string getConfigPath() return value (object)", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          getConfigPath: (() => ({ path: "./foo.json" })) as never,
        }),
      {
        name: "TypeError",
        message:
          "Expected getConfigPath() to return a string or undefined, but got: object.",
      },
    );
  });

  test("rejects non-string getConfigPath() return value (Promise)", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          getConfigPath: (() => Promise.resolve("./foo.json")) as never,
        }),
      {
        name: "TypeError",
        message:
          "Expected getConfigPath() to return a string or undefined, but got: object.",
      },
    );
  });

  test("rejects non-string getConfigPath() return value (null)", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          getConfigPath: (() => null) as never,
        }),
      {
        name: "TypeError",
        message:
          "Expected getConfigPath() to return a string or undefined, but got: null.",
      },
    );
  });

  test("rejects non-string getConfigPath() return value (number)", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          getConfigPath: (() => 123) as never,
        }),
      {
        name: "TypeError",
        message:
          "Expected getConfigPath() to return a string or undefined, but got: number.",
      },
    );
  });
});

describe("load() return value validation", () => {
  const createNameContext = () => {
    const schema = z.object({ name: z.string() });
    return createConfigContext({ schema });
  };

  test("rejects non-object return value from load()", () => {
    const context = createNameContext();
    assert.throws(
      () => context.getAnnotations(phase2({}), { load: (() => 123) as never }),
      {
        name: "TypeError",
        message: "Expected load() to return an object, but got: number.",
      },
    );
  });

  test("returns empty annotations when load() returns null", () => {
    const context = createNameContext();
    const annotations = context.getAnnotations(phase2({}), {
      load: () => null,
    });
    assert.deepStrictEqual(annotations, {});
  });

  test("returns empty annotations when load() returns undefined", () => {
    const context = createNameContext();
    const annotations = context.getAnnotations(phase2({}), {
      load: () => undefined,
    });
    assert.deepStrictEqual(annotations, {});
  });

  test("validates { config: undefined } against schema", () => {
    const context = createNameContext();
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          load: () => ({ config: undefined, meta: undefined }),
        }),
      { message: /Config validation failed/ },
    );
  });

  test("validates { config: null } against schema", () => {
    const context = createNameContext();
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          load: () => ({ config: null, meta: undefined }),
        }),
      { message: /Config validation failed/ },
    );
  });

  test("permissive schema can transform { config: undefined }", () => {
    const schema = z.undefined().transform(() => ({ name: "from-schema" }));
    const context = createConfigContext({ schema });
    const annotations = context.getAnnotations(phase2({}), {
      load: () => ({ config: undefined, meta: undefined }),
    });
    const symbols = Object.getOwnPropertySymbols(annotations);
    assert.equal(symbols.length, 1);
    const value = (annotations as Record<symbol, unknown>)[symbols[0]] as {
      data: { name: string };
    };
    assert.equal(value.data.name, "from-schema");
  });

  test("returns empty annotations when async load() resolves undefined", async () => {
    const context = createNameContext();
    const annotations = await context.getAnnotations(phase2({}), {
      load: () => Promise.resolve(undefined),
    });
    assert.deepStrictEqual(annotations, {});
  });

  test("returns empty annotations when async load() resolves null", async () => {
    const context = createNameContext();
    const annotations = await context.getAnnotations(phase2({}), {
      load: () => Promise.resolve(null),
    });
    assert.deepStrictEqual(annotations, {});
  });

  test("validates async { config: undefined } against schema", async () => {
    const context = createNameContext();
    await assert.rejects(
      async () =>
        await context.getAnnotations(phase2({}), {
          load: () => Promise.resolve({ config: undefined, meta: undefined }),
        }),
      { message: /Config validation failed/ },
    );
  });

  test("validates async { config: null } against schema", async () => {
    const context = createNameContext();
    await assert.rejects(
      async () =>
        await context.getAnnotations(phase2({}), {
          load: () => Promise.resolve({ config: null, meta: undefined }),
        }),
      { message: /Config validation failed/ },
    );
  });

  test("later phase-one probes do not leak prior config into plain parse", () => {
    const context = createNameContext();
    const parser = bindConfig(option("--name", string()), {
      context,
      key: "name",
    });

    const annotations = context.getAnnotations(phase2({}), {
      load: () => ({ config: { name: "configured" }, meta: undefined }),
    });
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    assert.deepEqual(
      parse(parser, [], { annotations }),
      { success: true, value: "configured" },
    );

    assert.deepEqual(
      context.getAnnotations(
        undefined,
        { load: () => ({ config: { name: "later" }, meta: undefined }) },
      ),
      {},
    );

    const result = parse(parser, []);
    assert.ok(!result.success);
    if (result.success) return;
    assert.equal(
      formatMessage(result.error),
      "Missing required configuration value.",
    );
  });

  test(
    "validation failures in later probes do not leak prior config into plain parse",
    () => {
      const context = createNameContext();
      const parser = bindConfig(option("--name", string()), {
        context,
        key: "name",
      });

      const annotations = context.getAnnotations(phase2({}), {
        load: () => ({ config: { name: "configured" }, meta: undefined }),
      });
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      assert.deepEqual(
        parse(parser, [], { annotations }),
        { success: true, value: "configured" },
      );

      assert.throws(
        () =>
          context.getAnnotations(phase2({}), {
            load: () => ({
              config: { name: 123 },
              meta: undefined,
            }),
          }),
        { message: /Config validation failed/ },
      );

      const result = parse(parser, []);
      assert.ok(!result.success);
      if (result.success) return;
      assert.equal(
        formatMessage(result.error),
        "Missing required configuration value.",
      );
    },
  );

  test("no-config phase-two probes do not leak prior config into plain parse", () => {
    const context = createNameContext();
    const parser = bindConfig(option("--name", string()), {
      context,
      key: "name",
    });

    const annotations = context.getAnnotations(phase2({}), {
      load: () => ({ config: { name: "configured" }, meta: undefined }),
    });
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    assert.deepEqual(
      parse(parser, [], { annotations }),
      { success: true, value: "configured" },
    );

    assert.deepEqual(
      context.getAnnotations(phase2({}), { getConfigPath: () => undefined }),
      {},
    );

    const result = parse(parser, []);
    assert.ok(!result.success);
    if (result.success) return;
    assert.equal(
      formatMessage(result.error),
      "Missing required configuration value.",
    );
  });

  test("rejects array return value from load()", () => {
    const context = createNameContext();
    assert.throws(
      () => context.getAnnotations(phase2({}), { load: (() => []) as never }),
      {
        name: "TypeError",
        message: "Expected load() to return an object, but got: array.",
      },
    );
  });

  test("rejects load() result missing config property", () => {
    const context = createNameContext();
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() => ({ meta: { source: "x" } })) as never,
        }),
      {
        name: "TypeError",
        message: "Expected load() result to have a config property.",
      },
    );
  });

  test("rejects plain thenable return value from load()", () => {
    const context = createNameContext();
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() => ({
            then: (resolve: (value: unknown) => void) =>
              resolve({ config: { name: "ALICE" }, meta: undefined }),
          })) as never,
        }),
      {
        name: "TypeError",
        message: "Expected load() to return a plain object or Promise, " +
          "but got a thenable. Use a real Promise instead.",
      },
    );
  });

  test("accepts cross-realm Promise from load()", async () => {
    const context = createNameContext();
    // Simulate a cross-realm Promise: Symbol.toStringTag is "Promise"
    // but instanceof Promise is false.
    const crossRealmPromise = {
      [Symbol.toStringTag]: "Promise",
      then(
        resolve: (value: { config: { name: string }; meta: undefined }) => void,
      ) {
        resolve({ config: { name: "ALICE" }, meta: undefined });
      },
    };
    const annotations = await context.getAnnotations(phase2({}), {
      load: (() => crossRealmPromise) as never,
    });
    assert.ok(annotations != null);
    const symbols = Object.getOwnPropertySymbols(annotations);
    assert.equal(symbols.length, 1);
    const entry = (annotations as Record<symbol, { data: { name: string } }>)[
      symbols[0]
    ];
    assert.ok(entry != null);
    assert.equal(entry.data.name, "ALICE");
  });

  test("rejects thenable even if it would resolve to valid result", () => {
    const context = createNameContext();
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() => ({
            then: (resolve: (value: unknown) => void) => resolve(123),
          })) as never,
        }),
      {
        name: "TypeError",
        message: "Expected load() to return a plain object or Promise, " +
          "but got a thenable. Use a real Promise instead.",
      },
    );
  });

  test("rejects Promise-valued config in load() result", () => {
    const context = createNameContext();
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() => ({
            config: Promise.resolve({ name: "ALICE" }) as never,
            meta: undefined,
          })) as never,
        }),
      {
        name: "TypeError",
        message: "Expected config in load() result to not be a Promise. " +
          "Resolve the Promise before returning.",
      },
    );
  });

  test("rejects Promise-valued meta in load() result", () => {
    const context = createNameContext();
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() => ({
            config: { name: "ALICE" },
            meta: Promise.resolve({
              configPath: "x",
              configDir: ".",
            }) as never,
          })) as never,
        }),
      {
        name: "TypeError",
        message: "Expected meta in load() result to not be a Promise. " +
          "Resolve the Promise before returning.",
      },
    );
  });

  test("accepts config object with then method (not a Promise)", () => {
    const schema = z.object({
      name: z.string(),
      then: z.function(),
    });
    const context = createConfigContext({ schema });
    const annotations = context.getAnnotations(phase2({}), {
      load: (() => ({
        config: { name: "ALICE", then: () => "domain method" },
        meta: undefined,
      })) as never,
    });
    assert.ok(annotations != null);
    const symbols = Object.getOwnPropertySymbols(annotations);
    assert.equal(symbols.length, 1);
    const entry = (
      annotations as Record<
        symbol,
        { data: { name: string; then: () => string } }
      >
    )[symbols[0]];
    assert.ok(entry != null);
    assert.equal(entry.data.name, "ALICE");
    assert.equal(typeof entry.data.then, "function");
  });

  test("rejects cross-realm Promise config (Symbol.toStringTag)", () => {
    const context = createNameContext();
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() => ({
            config: {
              [Symbol.toStringTag]: "Promise",
              then: (resolve: (v: unknown) => void) =>
                resolve({ name: "ALICE" }),
            },
            meta: undefined,
          })) as never,
        }),
      {
        name: "TypeError",
        message: "Expected config in load() result to not be a Promise. " +
          "Resolve the Promise before returning.",
      },
    );
  });

  test("rejects cross-realm Promise meta (Symbol.toStringTag)", () => {
    const context = createNameContext();
    assert.throws(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() => ({
            config: { name: "ALICE" },
            meta: {
              [Symbol.toStringTag]: "Promise",
              then: (resolve: (v: unknown) => void) =>
                resolve({ configPath: "x", configDir: "." }),
            },
          })) as never,
        }),
      {
        name: "TypeError",
        message: "Expected meta in load() result to not be a Promise. " +
          "Resolve the Promise before returning.",
      },
    );
  });

  test("rejects non-object resolved value from async load()", async () => {
    const context = createNameContext();
    await assert.rejects(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() => Promise.resolve(123)) as never,
        }) as Promise<unknown>,
      {
        name: "TypeError",
        message: "Expected load() to return an object, but got: number.",
      },
    );
  });

  test("rejects missing config in resolved value from async load()", async () => {
    const context = createNameContext();
    await assert.rejects(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() => Promise.resolve({ meta: undefined })) as never,
        }) as Promise<unknown>,
      {
        name: "TypeError",
        message: "Expected load() result to have a config property.",
      },
    );
  });

  test("rejects Promise-valued config in resolved value from async load()", async () => {
    const context = createNameContext();
    await assert.rejects(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() =>
            Promise.resolve({
              config: Promise.resolve({ name: "ALICE" }),
              meta: undefined,
            })) as never,
        }) as Promise<unknown>,
      {
        name: "TypeError",
        message: "Expected config in load() result to not be a Promise. " +
          "Resolve the Promise before returning.",
      },
    );
  });

  test("rejects Promise-valued meta in resolved value from async load()", async () => {
    const context = createNameContext();
    await assert.rejects(
      () =>
        context.getAnnotations(phase2({}), {
          load: (() =>
            Promise.resolve({
              config: { name: "ALICE" },
              meta: Promise.resolve({ configPath: "x", configDir: "." }),
            })) as never,
        }) as Promise<unknown>,
      {
        name: "TypeError",
        message: "Expected meta in load() result to not be a Promise. " +
          "Resolve the Promise before returning.",
      },
    );
  });
});

describe("createConfigContext error paths", () => {
  test("supports async Standard Schema validation result", async () => {
    const asyncSchema = {
      "~standard": {
        validate(_input: unknown) {
          return Promise.resolve({ value: { host: "async-host", port: 443 } });
        },
      },
    } as unknown as z.ZodType<{ host: string; port: number }>;
    const context = createConfigContext({ schema: asyncSchema });

    const annotations = await context.getAnnotations(
      phase2({ configPath: "/app/config.json" }),
      {
        load: () => ({
          config: { host: "async-host", port: 443 },
          meta: { configDir: "/app", configPath: "/app/config.json" },
        }),
      },
    );

    const contextAnnotation = annotations[context.id] as
      | { readonly data: unknown; readonly meta: unknown }
      | undefined;
    assert.ok(contextAnnotation != null);
    assert.deepEqual(contextAnnotation.data, {
      host: "async-host",
      port: 443,
    });
  });

  test("supports annotation payload with data only (without meta)", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    const annotations = await context.getAnnotations(
      phase2({ configPath: "/app/config.json" }),
      {
        load: () => ({
          config: { host: "meta-less" },
          meta: undefined,
        }),
      },
    );

    const value = annotations[context.id] as
      | { readonly data: unknown; readonly meta?: unknown }
      | undefined;
    assert.ok(value != null);
    assert.deepEqual(value.data, { host: "meta-less" });
    assert.ok(!("meta" in value));
  });

  test("schema validation fallback message handles missing issue message", async () => {
    const schemaWithoutMessage = {
      "~standard": {
        validate(_input: unknown) {
          return {
            issues: [{ path: ["host"] }],
            value: undefined,
          };
        },
      },
    } as unknown as z.ZodType<{ host: string }>;
    const context = createConfigContext({ schema: schemaWithoutMessage });

    await assert.rejects(
      async () =>
        await context.getAnnotations(
          phase2({ configPath: "/app/config.json" }),
          {
            load: () => ({
              config: { host: "x" },
              meta: { configDir: "/app", configPath: "/app/config.json" },
            }),
          },
        ),
      (error: Error) => {
        assert.ok(error.message.includes("Unknown error"));
        return true;
      },
    );
  });

  test("getAnnotations throws TypeError when neither getConfigPath nor load is provided", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    // Phase 2 call (parsed is truthy) without required options
    await assert.rejects(
      async () =>
        await context.getAnnotations(
          phase2({ config: "test.json" }),
          undefined,
        ),
      TypeError,
    );
  });

  test("getAnnotations throws TypeError when runtimeOptions is empty object", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    await assert.rejects(
      async () =>
        await context.getAnnotations(phase2({ config: "test.json" }), {}),
      TypeError,
    );
  });

  test("getAnnotations returns empty annotations for phase 1 call", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    // Phase 1: parsed is undefined
    const annotations = await context.getAnnotations();
    assert.deepEqual(Object.getOwnPropertySymbols(annotations).length, 0);
  });

  test("getAnnotations with getConfigPath returning undefined skips file loading", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    const annotations = await context.getAnnotations(
      phase2({ config: undefined }),
      { getConfigPath: () => undefined },
    );

    // No config loaded, should be empty
    assert.deepEqual(Object.getOwnPropertySymbols(annotations).length, 0);
  });

  test("getAnnotations with getConfigPath pointing to non-existent file returns empty", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    // ENOENT should be handled gracefully (optional config file)
    const annotations = await context.getAnnotations(
      phase2({ config: "/nonexistent/path/config.json" }),
      {
        getConfigPath: () => "/nonexistent/path/does-not-exist.json",
      },
    );

    assert.deepEqual(Object.getOwnPropertySymbols(annotations).length, 0);
  });

  test("getAnnotations with fileParser that throws non-SyntaxError propagates", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({
      schema,
      fileParser: () => {
        throw new RangeError("Custom parse error.");
      },
    });

    // Create a temporary config file for this test
    const tmpDir = (await import("node:os")).tmpdir();
    const tmpFile = `${tmpDir}/optique-test-${Date.now()}.json`;
    const fs = await import("node:fs/promises");
    await fs.writeFile(tmpFile, "{}");

    try {
      await assert.rejects(
        async () =>
          await context.getAnnotations(phase2({ config: tmpFile }), {
            getConfigPath: () => tmpFile,
          }),
        RangeError,
      );
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  test("getAnnotations with fileParser that throws SyntaxError wraps it", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({
      schema,
      fileParser: () => {
        throw new SyntaxError("Unexpected token");
      },
    });

    const tmpDir = (await import("node:os")).tmpdir();
    const tmpFile = `${tmpDir}/optique-test-syntax-${Date.now()}.json`;
    const fs = await import("node:fs/promises");
    await fs.writeFile(tmpFile, "not-json");

    try {
      await assert.rejects(
        async () =>
          await context.getAnnotations(phase2({ config: tmpFile }), {
            getConfigPath: () => tmpFile,
          }),
        (error: Error) => {
          assert.ok(error.message.includes("Failed to parse config file"));
          return true;
        },
      );
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  test("getConfigPath mode rejects null from fileParser", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({
      schema,
      fileParser: () => null,
    });

    const tmpDir = (await import("node:os")).tmpdir();
    const tmpFile = `${tmpDir}/optique-test-null-${Date.now()}.json`;
    const fs = await import("node:fs/promises");
    await fs.writeFile(tmpFile, "{}");

    try {
      await assert.rejects(
        async () =>
          await context.getAnnotations(phase2({ config: tmpFile }), {
            getConfigPath: () => tmpFile,
          }),
        (error: Error) => {
          assert.ok(error.message.includes("Config validation failed"));
          return true;
        },
      );
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  test("key accessor function that throws propagates the error", () => {
    const schema = z.object({
      nested: z.object({
        value: z.string(),
      }).optional(),
    });

    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--value", string()), {
      context,
      // This accessor will throw when nested is undefined
      key: (config) => config.nested!.value,
      default: "fallback",
    });

    // Config has nested as undefined, so accessor throws
    const annotations: Annotations = {
      [context.id]: { data: { nested: undefined } },
    };

    assert.throws(
      () => parse(parser, [], { annotations }),
      TypeError,
    );
  });

  test("key callback exceptions are not swallowed", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--host", string()), {
      context,
      key: () => {
        throw new Error("Custom error from key callback.");
      },
      default: "fallback",
    });

    const annotations: Annotations = {
      [context.id]: { data: { host: "example.com" } },
    };

    assert.throws(
      () => parse(parser, [], { annotations }),
      (err: Error) => {
        assert.ok(err.message.includes("Custom error from key callback."));
        return true;
      },
    );
  });

  test("Symbol.dispose does not invalidate returned annotations", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--host", string()), {
      context,
      key: "host",
    });

    const annotations = context.getAnnotations(phase2({}), {
      load: () => ({ config: { host: "test-host" }, meta: undefined }),
    });
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    context[Symbol.dispose]!();

    assert.deepEqual(
      parse(parser, [], { annotations }),
      { success: true, value: "test-host" },
    );
  });

  test("load function receives parsed value and returns config", async () => {
    const schema = z.object({ host: z.string(), port: z.number() });
    const context = createConfigContext({ schema });

    let receivedParsed: unknown;
    const annotations = await context.getAnnotations(
      phase2({ configPath: "/app/config.json" }),
      {
        load: (parsed: unknown) => {
          receivedParsed = parsed;
          return {
            config: { host: "loaded-host", port: 8080 },
            meta: { configDir: "/app", configPath: "/app/config.json" },
          };
        },
      },
    );

    // Verify the parsed value was forwarded
    assert.deepEqual(receivedParsed, { configPath: "/app/config.json" });

    // Verify annotations contain loaded config under the per-instance context id.
    // Data and metadata are stored together as { data, meta }.
    const contextAnnotation = annotations[context.id] as
      | { readonly data: unknown; readonly meta: unknown }
      | undefined;
    assert.ok(contextAnnotation != null);
    assert.deepEqual(contextAnnotation.data, {
      host: "loaded-host",
      port: 8080,
    });
    assert.deepEqual(contextAnnotation.meta, {
      configDir: "/app",
      configPath: "/app/config.json",
    });
  });

  test("load function that throws propagates the error", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    await assert.rejects(
      async () =>
        await context.getAnnotations(phase2({ config: "test" }), {
          load: () => {
            throw new Error("Load failed.");
          },
        }),
      (error: Error) => {
        assert.equal(error.message, "Load failed.");
        return true;
      },
    );
  });

  test("schema validation failure in load mode throws", async () => {
    const schema = z.object({ host: z.string(), port: z.number() });
    const context = createConfigContext({ schema });

    await assert.rejects(
      async () =>
        await context.getAnnotations(phase2({ config: "test" }), {
          load: () => ({
            config: { host: 123, port: "not-a-number" }, // invalid types
          }),
        }),
      (error: Error) => {
        assert.ok(error.message.includes("Config validation failed"));
        return true;
      },
    );
  });

  test("bindConfig async mode returns Promise from parse and complete", async () => {
    const schema = z.object({ port: z.number() });
    const context = createConfigContext({ schema });
    const asyncInt: ValueParser<"async", number> = {
      $mode: "async" as const,
      metavar: "INT",
      placeholder: 0,
      parse(input: string): Promise<ValueParserResult<number>> {
        const n = parseInt(input, 10);
        if (isNaN(n)) {
          return Promise.resolve({
            success: false as const,
            error: message`Invalid integer: ${input}`,
          });
        }
        return Promise.resolve({ success: true as const, value: n });
      },
      format(v: number) {
        return `${v}`;
      },
    };
    const parser = bindConfig(option("-p", "--port", asyncInt), {
      context,
      key: "port",
      default: 3000,
    });

    const parseResult = parser.parse({
      buffer: [],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });
    assert.ok(parseResult instanceof Promise);
    const parsed = await parseResult;
    assert.ok(parsed.success);

    const completeResult = parser.complete(
      { hasCliValue: false } as unknown as Parameters<
        typeof parser.complete
      >[0],
    );
    assert.ok(completeResult instanceof Promise);
    const completed = await completeResult;
    assert.ok(completed.success);
    assert.equal(completed.value, 3000);
  });

  test("bindConfig unwraps wrapped state across parse calls", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--host", string()), {
      context,
      key: "host",
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
      buffer: ["--host", "alice"],
      state: first.next.state,
    });
    assert.ok(second.success);
    assert.deepEqual(second.consumed, ["--host", "alice"]);
  });

  test("bindConfig getSuggestRuntimeNodes preserves zero-consumption cliState", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    const inner: Parser<"sync", string, string> = {
      $mode: "sync" as const,
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
    const parser: Parser<"sync", string, string> = bindConfig(inner, {
      context,
      key: "host",
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

    const nodes = parser.getSuggestRuntimeNodes?.(parsed.next.state, ["host"]);
    assert.ok(nodes != null);
    if (nodes == null) return;
    assert.equal(nodes.length, 1);
    assert.deepEqual(nodes[0]?.path, ["host"]);
    assert.equal(nodes[0]?.parser, inner);
    assert.equal(nodes[0]?.state, "cli-state");
  });

  test(
    "bindConfig getSuggestRuntimeNodes preserves annotations on no-cli fallback",
    () => {
      const context = createConfigContext({
        schema: z.object({
          host: z.string().optional(),
        }),
      });
      let seenHost: string | undefined;
      const inner: Parser<"sync", string, undefined> = {
        $mode: "sync" as const,
        $valueType: [] as readonly string[],
        $stateType: [] as readonly undefined[],
        priority: 0,
        usage: [],
        leadingNames: new Set<string>(),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(parseContext) {
          return {
            success: true as const,
            next: { ...parseContext, state: undefined },
            consumed: [],
          };
        },
        complete: () => ({ success: true as const, value: "ok" }),
        suggest: () => [],
        getSuggestRuntimeNodes(state, path) {
          seenHost = (
            getAnnotations(state) as
              | {
                readonly [key: symbol]: { readonly data?: { host?: string } };
              }
              | undefined
          )?.[context.id]?.data?.host;
          return [{ path, parser: inner, state }];
        },
        getDocFragments: () => ({ fragments: [] }),
      };
      const parser = bindConfig(inner, {
        context,
        key: "host",
      });

      const parsed = parser.parse({
        buffer: [],
        state: injectAnnotations(parser.initialState, {
          [context.id]: { data: { host: "prod" } },
        }),
        optionsTerminated: false,
        usage: parser.usage,
      });
      assert.ok(parsed.success);
      if (!parsed.success) return;

      const nodes = parser.getSuggestRuntimeNodes?.(parsed.next.state, [
        "host",
      ]);
      assert.ok(nodes != null);
      if (nodes == null) return;
      assert.equal(nodes.length, 1);
      assert.equal(seenHost, "prod");
    },
  );

  test("bindConfig getSuggestRuntimeNodes preserves inner nodes for source parsers", () => {
    const context = createConfigContext({
      schema: z.object({
        mode: z.array(z.enum(["dev", "prod"])).optional(),
      }),
    });
    const mode = dependency(choice(["dev", "prod"] as const));
    const inner = multiple(option("--mode", mode));
    const parser = bindConfig(inner, {
      context,
      key: "mode",
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

  test("bindConfig getSuggestRuntimeNodes keeps outer source precedence", () => {
    const context = createConfigContext({
      schema: z.object({
        mode: z.enum(["dev", "prod"]).optional(),
      }),
    });
    const mode = dependency(choice(["dev", "prod"] as const));
    const envContext = createEnvContext({
      prefix: "APP_",
      source(key) {
        return ({ APP_MODE: "invalid" } as const)[key as "APP_MODE"];
      },
    });
    const envAnnotations = envContext.getAnnotations();
    if (envAnnotations instanceof Promise) {
      throw new TypeError("Expected synchronous env annotations.");
    }
    const parser = bindConfig(
      bindEnv(option("--mode", mode), {
        context: envContext,
        key: "MODE",
        parser: choice(["dev", "prod"] as const),
      }),
      {
        context,
        key: "mode",
      },
    );
    const state = injectAnnotations(
      injectAnnotations(parser.initialState, envAnnotations),
      {
        [context.id]: { data: { mode: "prod" as const } },
      },
    );
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

  test("bindConfig keeps annotation inheritance non-enumerable", () => {
    const context = createConfigContext({
      schema: z.object({
        mode: z.enum(["dev", "prod"]).optional(),
      }),
    });
    const mode = dependency(choice(["dev", "prod"] as const));
    const parser = bindConfig(option("--mode", mode), {
      context,
      key: "mode",
    });
    const marker = Symbol.for("@optique/core/inheritParentAnnotations");
    const descriptor = Object.getOwnPropertyDescriptor(parser, marker);

    assert.ok(descriptor != null);
    if (descriptor == null) return;
    assert.ok(!descriptor.enumerable);
    assert.notEqual(Reflect.get(map(parser, (value) => value), marker), true);
  });

  test("bindConfig suggest unwraps zero-consumption cliState", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    const inner: Parser<"sync", string, string> = {
      $mode: "sync" as const,
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
      *suggest(context) {
        yield { kind: "literal" as const, text: context.state };
      },
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser: Parser<"sync", string, string> = bindConfig(inner, {
      context,
      key: "host",
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

    const suggestions = [...parser.suggest(parsed.next, "")];
    assert.deepEqual(suggestions, [{ kind: "literal", text: "cli-state" }]);
  });

  test("throws when sync mode parser.parse returns Promise", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    const brokenParser = {
      $mode: "sync" as const,
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
    const parser = bindConfig(brokenParser, {
      context,
      key: "host",
      default: "fallback",
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
});

describe("bindConfig() with dependency sources", () => {
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

  const schema = z.object({ mode: z.enum(["dev", "prod"]) });

  function createParser(
    configData: { readonly mode: "dev" | "prod" } | undefined,
  ) {
    const context = createConfigContext({ schema });
    const annotations: Annotations = configData
      ? { [context.id]: { data: configData } }
      : {};
    const parser = object({
      mode: bindConfig(option("--mode", mode), {
        context,
        key: "mode",
      }),
      level: option("--level", level),
    });
    return { parser, annotations };
  }

  test("propagates config value as dependency to derived parser (parse)", () => {
    const { parser, annotations } = createParser({ mode: "prod" });
    const result = parse(parser, ["--level", "silent"], { annotations });
    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
  });

  test("exposes config fallback as a source from raw annotated state", () => {
    const context = createConfigContext({ schema });
    const parser = bindConfig(option("--mode", mode), {
      context,
      key: "mode",
    });
    const state = injectAnnotations(parser.initialState, {
      [context.id]: { data: { mode: "prod" as const } },
    });

    assert.deepEqual(
      parser.dependencyMetadata?.source?.extractSourceValue(state),
      { success: true, value: "prod" },
    );
  });

  test("preserves nested bindConfig() source extraction from raw bind state", () => {
    const context = createConfigContext({ schema });
    const parser = bindConfig(
      map(
        bindConfig(option("--mode", mode), {
          context,
          key: "mode",
        }),
        (value) => value.toUpperCase(),
      ),
      {
        context,
        key: "mode",
      },
    );
    const state = injectAnnotations(parser.initialState, {
      [context.id]: { data: { mode: "prod" as const } },
    });

    assert.deepEqual(
      parser.dependencyMetadata?.source?.extractSourceValue(state),
      { success: true, value: "prod" },
    );
  });

  test("preserves nested bindEnv() source extraction from raw bind state", () => {
    const context = createConfigContext({ schema });
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
    const parser = bindConfig(
      map(
        bindEnv(option("--mode", mode), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
        (value) => value.toUpperCase(),
      ),
      {
        context,
        key: "mode",
      },
    );
    const state = injectAnnotations(parser.initialState, envAnnotations);

    assert.deepEqual(
      parser.dependencyMetadata?.source?.extractSourceValue(state),
      { success: true, value: "prod" },
    );
  });

  test("treats a missing config key as an absent source", () => {
    const optionalSchema = z.object({
      mode: z.enum(["dev", "prod"]).optional(),
    });
    const context = createConfigContext({ schema: optionalSchema });
    const parser = bindConfig(option("--mode", mode), {
      context,
      key: "mode",
    });
    const state = injectAnnotations(parser.initialState, {
      [context.id]: { data: {} },
    });
    const source = parser.dependencyMetadata?.source;

    assert.ok(source != null, "Expected dependency source metadata.");
    if (source == null) return;
    assert.equal(source.extractSourceValue(state), undefined);
  });

  test("propagates config value as dependency to derived parser (suggest)", () => {
    const { parser, annotations } = createParser({ mode: "prod" });
    const suggestions = suggestSync(parser, ["--level", "s"], { annotations });
    const texts = suggestions.map((s) => "text" in s ? s.text : "");
    assert.ok(texts.includes("silent"));
    assert.ok(texts.includes("strict"));
    assert.ok(!texts.includes("debug"));
    assert.ok(!texts.includes("verbose"));
  });

  test("CLI value takes priority over config for dependency", () => {
    const { parser, annotations } = createParser({ mode: "prod" });
    const result = parse(parser, ["--mode", "dev", "--level", "debug"], {
      annotations,
    });
    assert.ok(result.success);
    assert.equal(result.value.mode, "dev");
    assert.equal(result.value.level, "debug");
  });

  test("rejects invalid derived value when config dependency is set", () => {
    const { parser, annotations } = createParser({ mode: "prod" });
    const result = parse(parser, ["--level", "debug"], { annotations });
    assert.ok(!result.success);
  });

  test("optional(bindConfig(...)) returns undefined when config is absent", () => {
    const context = createConfigContext({ schema });
    // No config data in annotations
    const annotations: Annotations = {};
    const parser = object({
      mode: optional(
        bindConfig(option("--mode", mode), {
          context,
          key: "mode",
        }),
      ),
      level: option("--level", level),
    });
    // When config is absent and CLI omits --mode, mode should be undefined
    // and derived parser should use its defaultValue ("dev")
    const result = parse(parser, ["--level", "debug"], { annotations });
    assert.ok(result.success);
    assert.equal(result.value.mode, undefined);
    assert.equal(result.value.level, "debug");
  });

  // Regression tests for https://github.com/dahlia/optique/issues/233.
  // optional()/withDefault() wrappers placed under object() must allow
  // bindConfig() to resolve from the config, not just short-circuit to
  // undefined/fallback.
  test("optional(bindConfig(...)) in object() uses config value when present", () => {
    const context = createConfigContext({ schema });
    const annotations: Annotations = {
      [context.id]: { data: { mode: "prod" as const } },
    };
    const parser = object({
      mode: optional(
        bindConfig(option("--mode", choice(["dev", "prod"] as const)), {
          context,
          key: "mode",
        }),
      ),
    });
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
    }
  });

  test("withDefault(bindConfig(...), fb) in object() uses config value when present", () => {
    const context = createConfigContext({ schema });
    const annotations: Annotations = {
      [context.id]: { data: { mode: "prod" as const } },
    };
    const parser = object({
      mode: withDefault(
        bindConfig(option("--mode", choice(["dev", "prod"] as const)), {
          context,
          key: "mode",
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

  test("optional(bindConfig(...)) at top level uses config via annotations", () => {
    const context = createConfigContext({ schema });
    const annotations: Annotations = {
      [context.id]: { data: { mode: "prod" as const } },
    };
    const parser = optional(
      bindConfig(option("--mode", choice(["dev", "prod"] as const)), {
        context,
        key: "mode",
      }),
    );
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "prod");
    }
  });

  test(
    "optional(bindConfig(flag)) at top level uses config via annotations",
    () => {
      // Boolean flag options (no value parser) have an object-shaped
      // initialState `{ success: true, value: false }`.  Regression
      // test for the annotation injection gap identified in review
      // of the #233 fix: `deriveOptionalInnerParseState` must inject
      // annotations into object initial states as well as primitive
      // ones, otherwise `optional(bindConfig(option("--verbose")))`
      // cannot see its config fallback at top level.
      const flagSchema = z.object({ verbose: z.boolean().optional() });
      const context = createConfigContext({ schema: flagSchema });
      const annotations: Annotations = {
        [context.id]: { data: { verbose: true } },
      };
      const parser = optional(
        bindConfig(option("-v", "--verbose"), {
          context,
          key: "verbose",
        }),
      );
      const result = parse(parser, [], { annotations });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, true);
      }
    },
  );

  test(
    "withDefault(bindConfig(flag), fb) at top level uses config via annotations",
    () => {
      const flagSchema = z.object({ verbose: z.boolean().optional() });
      const context = createConfigContext({ schema: flagSchema });
      const annotations: Annotations = {
        [context.id]: { data: { verbose: true } },
      };
      const parser = withDefault(
        bindConfig(option("-v", "--verbose"), {
          context,
          key: "verbose",
        }),
        false as const,
      );
      const result = parse(parser, [], { annotations });
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, true);
      }
    },
  );

  test("optional(bindConfig(..., default)) uses bindConfig default when config absent", () => {
    const context = createConfigContext({ schema });
    // The config context is bound, but the config object is empty — bindConfig
    // should fall back to its own `default` for the unbound key.
    const annotations: Annotations = {
      [context.id]: { data: {} },
    };
    const parser = object({
      mode: optional(
        bindConfig(option("--mode", choice(["dev", "prod"] as const)), {
          context,
          key: "mode",
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

  test("does not preserve inner missing-source defaults without outer fallback", () => {
    const context = createConfigContext({ schema });
    const parser = bindConfig(
      withDefault(optional(option("--mode", mode)), "prod" as const),
      {
        context,
        key: "mode",
      },
    );
    const source = parser.dependencyMetadata?.source;

    assert.ok(source != null, "Expected dependency source metadata.");
    if (source == null) return;
    assert.equal(source.getMissingSourceValue, undefined);
  });

  test("uses the outer config default for missing source values", () => {
    const context = createConfigContext({ schema });
    const parser = bindConfig(
      withDefault(optional(option("--mode", mode)), "prod" as const),
      {
        context,
        key: "mode",
        default: "dev" as const,
      },
    );
    const source = parser.dependencyMetadata?.source;

    assert.ok(source != null, "Expected dependency source metadata.");
    if (source == null) return;
    assert.deepEqual(source.getMissingSourceValue?.(), {
      success: true,
      value: "dev",
    });
  });

  test("does not invent mapped dependency source values from config fallbacks", () => {
    const context = createConfigContext({ schema });
    const annotations: Annotations = {
      [context.id]: { data: { mode: "prod" as const } },
    };
    const parser = bindConfig(
      map(
        option("--mode", mode),
        (value) => value === "dev" ? "development" : "production",
      ),
      {
        context,
        key: "mode",
      },
    );

    const parseResult = parser.parse({
      buffer: [],
      state: injectAnnotations(parser.initialState, annotations),
      optionsTerminated: false,
      usage: parser.usage,
    });

    assert.ok(parseResult.success);
    const source = parser.dependencyMetadata?.source;
    assert.ok(source != null, "Expected dependency source metadata.");
    if (source == null) return;
    assert.equal(source.extractSourceValue(parseResult.next.state), undefined);
  });
});

// https://github.com/dahlia/optique/issues/681
describe("bindConfig() with dependency sources across merge() boundaries", () => {
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

  const schema = z.object({ mode: z.enum(["dev", "prod"]) });

  function createMergedParser(
    configData: { readonly mode: "dev" | "prod" } | undefined,
  ) {
    const context = createConfigContext({ schema });
    const annotations: Annotations = configData
      ? { [context.id]: { data: configData } }
      : {};
    const parser = merge(
      object({
        mode: bindConfig(option("--mode", mode), {
          context,
          key: "mode",
        }),
      }),
      object({
        level: option("--level", level),
      }),
    );
    return { parser, annotations };
  }

  test("propagates config value as dependency across merged children (parse)", () => {
    const { parser, annotations } = createMergedParser({ mode: "prod" });
    const result = parse(parser, ["--level", "silent"], { annotations });
    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
  });

  test("propagates config value as dependency across merged children (suggest)", () => {
    const { parser, annotations } = createMergedParser({ mode: "prod" });
    const suggestions = suggestSync(parser, ["--level", "s"], { annotations });
    const texts = suggestions.map((s) => "text" in s ? s.text : "");
    assert.ok(texts.includes("silent"));
    assert.ok(texts.includes("strict"));
    assert.ok(!texts.includes("debug"));
    assert.ok(!texts.includes("verbose"));
  });

  test("CLI value takes priority over config across merged children", () => {
    const { parser, annotations } = createMergedParser({ mode: "prod" });
    const result = parse(parser, ["--mode", "dev", "--level", "debug"], {
      annotations,
    });
    assert.ok(result.success);
    assert.equal(result.value.mode, "dev");
    assert.equal(result.value.level, "debug");
  });
});

// https://github.com/dahlia/optique/issues/768
describe("bindConfig() with dependency sources across tuple()/concat() boundaries", () => {
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
    const context = createConfigContext({
      schema: z.object({
        mode: z.enum(["dev", "prod"]).optional(),
      }),
    });
    const parser = tuple([
      bindConfig(option("--mode", mode), {
        context,
        key: "mode",
      }),
      option("--level", level),
    ]);
    const annotations = {
      [context.id]: { data: { mode: "prod" as const } },
    } satisfies Annotations;
    return { parser, annotations };
  }

  function createConcatParser() {
    const context = createConfigContext({
      schema: z.object({
        mode: z.enum(["dev", "prod"]).optional(),
      }),
    });
    const parser = concat(
      tuple([
        bindConfig(option("--mode", mode), {
          context,
          key: "mode",
        }),
      ]),
      tuple([
        option("--level", level),
      ]),
    );
    const annotations = {
      [context.id]: { data: { mode: "prod" as const } },
    } satisfies Annotations;
    return { parser, annotations };
  }

  test("tuple() parse uses config-backed dependency source", () => {
    const { parser, annotations } = createTupleParser();
    const result = parse(parser, ["--level", "silent"], { annotations });

    assert.ok(result.success);
    assert.deepEqual(result.value, ["prod", "silent"]);
  });

  test("tuple() suggest uses config-backed dependency source", () => {
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

  test("tuple() suggest does not override invalid CLI source with config", () => {
    const { parser, annotations } = createTupleParser();
    const texts = suggestSync(
      parser,
      ["--mode", "invalid", "--level", "s"],
      { annotations },
    )
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);

    assert.ok(
      !texts.includes("silent"),
      `Did not expect "silent" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("strict"),
      `Did not expect "strict" in suggestions, got: ${JSON.stringify(texts)}`,
    );
  });

  test("concat() parse uses config-backed dependency source", () => {
    const { parser, annotations } = createConcatParser();
    const result = parse(parser, ["--level", "silent"], { annotations });

    assert.ok(result.success);
    assert.deepEqual(result.value, ["prod", "silent"]);
  });

  test("concat() suggest uses config-backed dependency source", () => {
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

  test("concat() suggest does not override invalid CLI source with config", () => {
    const { parser, annotations } = createConcatParser();
    const texts = suggestSync(
      parser,
      ["--mode", "invalid", "--level", "s"],
      { annotations },
    )
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);

    assert.ok(
      !texts.includes("silent"),
      `Did not expect "silent" in suggestions, got: ${JSON.stringify(texts)}`,
    );
    assert.ok(
      !texts.includes("strict"),
      `Did not expect "strict" in suggestions, got: ${JSON.stringify(texts)}`,
    );
  });
});

describe("or(bindConfig(...), constant(...))", () => {
  test("selects bindConfig branch when CLI input is provided", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    const parser = or(
      bindConfig(option("--host", string()), {
        context,
        key: "host",
      }),
      constant("fallback"),
    );

    const result = parse(parser, ["--host", "cli-value"]);
    assert.ok(result.success);
    assert.equal(result.value, "cli-value");
  });

  test("falls back to constant when CLI is absent (config branch has leadingNames)", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });
    const parser = or(
      bindConfig(option("--host", string()), {
        context,
        key: "host",
      }),
      constant("fallback"),
    );

    // bindConfig(option("--host")) has leadingNames from the inner option,
    // so it is not eligible as a zero-consumed fallback even with config set.
    const annotations: Annotations = {
      [context.id]: { data: { host: "config.example.com" } },
    };
    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, "fallback");
  });
});
