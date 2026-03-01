import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { getDocPage, parse } from "@optique/core/parser";
import { object } from "@optique/core/constructs";
import { fail, flag, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { bindEnv, createEnvContext } from "@optique/env";

import type { Annotations } from "@optique/core/annotations";
import {
  bindConfig,
  createConfigContext,
  getActiveConfig,
  getActiveConfigMeta,
  setActiveConfig,
  setActiveConfigMeta,
} from "./index.ts";
import type { ConfigMeta } from "./index.ts";

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
});

describe("bindConfig", () => {
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
      key: (config, meta) => `${meta.configDir}:${config.outDir}`,
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
      key: (config, meta) => `${meta?.configDir ?? "no-meta"}:${config.outDir}`,
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

    // Provide env annotations (as a static context, getAnnotations() is called
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

describe("createConfigContext error paths", () => {
  test("getAnnotations throws TypeError when neither getConfigPath nor load is provided", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    // Phase 2 call (parsed is truthy) without required options
    await assert.rejects(
      async () =>
        await context.getAnnotations({ config: "test.json" }, undefined),
      TypeError,
    );
  });

  test("getAnnotations throws TypeError when runtimeOptions is empty object", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    await assert.rejects(
      async () => await context.getAnnotations({ config: "test.json" }, {}),
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
      { config: undefined },
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
      { config: "/nonexistent/path/config.json" },
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
          await context.getAnnotations(
            { config: tmpFile },
            { getConfigPath: () => tmpFile },
          ),
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
          await context.getAnnotations(
            { config: tmpFile },
            { getConfigPath: () => tmpFile },
          ),
        (error: Error) => {
          assert.ok(error.message.includes("Failed to parse config file"));
          return true;
        },
      );
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  test("key accessor function that throws falls through to default", () => {
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

    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, "fallback");
  });

  test("Symbol.dispose clears active config registry", () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    // Simulate what happens during context-aware parsing
    setActiveConfig(context.id, { host: "test-host" });
    setActiveConfigMeta(context.id, {
      configDir: "/test",
      configPath: "/test/config.json",
    });

    // Verify it's set
    assert.ok(getActiveConfig(context.id) !== undefined);
    assert.ok(getActiveConfigMeta(context.id) !== undefined);

    // Dispose should clear both registries
    context[Symbol.dispose]!();

    assert.equal(getActiveConfig(context.id), undefined);
    assert.equal(getActiveConfigMeta(context.id), undefined);
  });

  test("load function receives parsed value and returns config", async () => {
    const schema = z.object({ host: z.string(), port: z.number() });
    const context = createConfigContext({ schema });

    let receivedParsed: unknown;
    const annotations = await context.getAnnotations(
      { configPath: "/app/config.json" },
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
        await context.getAnnotations(
          { config: "test" },
          {
            load: () => {
              throw new Error("Load failed.");
            },
          },
        ),
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
        await context.getAnnotations(
          { config: "test" },
          {
            load: () => ({
              config: { host: 123, port: "not-a-number" }, // invalid types
            }),
          },
        ),
      (error: Error) => {
        assert.ok(error.message.includes("Config validation failed"));
        return true;
      },
    );
  });
});
