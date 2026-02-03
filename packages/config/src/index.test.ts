import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { parse } from "@optique/core/parser";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";

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
});
