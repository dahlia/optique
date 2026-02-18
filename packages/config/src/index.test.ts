import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { getDocPage, parse } from "@optique/core/parser";
import { object } from "@optique/core/constructs";
import { fail, flag, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

import type { Annotations } from "@optique/core/annotations";
import { bindConfig, configKey, createConfigContext } from "./index.ts";

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

  test("returns empty annotations when called without parsed result", () => {
    const schema = z.object({
      host: z.string(),
    });

    const context = createConfigContext({ schema });
    const annotations = context.getAnnotations();

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

    // Without CLI value, but with config annotation
    const configData = { host: "config.example.com" };
    const annotations: Annotations = {
      [configKey]: configData,
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
      [configKey]: configData,
    };

    const result = parse(parser, [], { annotations });
    assert.ok(result.success);
    assert.equal(result.value, "nested.example.com");
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
      [configKey]: configData,
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
      [configKey]: configData,
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
      [configKey]: { port: 8080 },
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
      [configKey]: configData,
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
