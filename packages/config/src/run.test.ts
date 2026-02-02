import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";
import { bindConfig, createConfigContext } from "./index.ts";
import { runWithConfig } from "./run.ts";

const TEST_DIR = join(import.meta.dirname ?? ".", "test-configs");

describe("runWithConfig", () => {
  test("performs two-pass parsing with config file", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-1.json");

    const configData = {
      host: "config.example.com",
      port: 8080,
    };
    await writeFile(configPath, JSON.stringify(configData));

    try {
      const schema = z.object({
        host: z.string(),
        port: z.number(),
      });

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

      const result = await runWithConfig(parser, context, {
        getConfigPath: (parsed) => (parsed as { config: string }).config,
        args: [],
      });

      assert.equal(result.host, "config.example.com");
      assert.equal(result.port, 8080);
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("CLI values override config file values", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-2.json");

    const configData = {
      host: "config.example.com",
      port: 8080,
    };
    await writeFile(configPath, JSON.stringify(configData));

    try {
      const schema = z.object({
        host: z.string(),
        port: z.number(),
      });

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

      const result = await runWithConfig(parser, context, {
        getConfigPath: (parsed) => (parsed as { config: string }).config,
        args: ["--host", "cli.example.com"],
      });

      assert.equal(result.host, "cli.example.com"); // from CLI
      assert.equal(result.port, 8080); // from config
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("uses default values when no config file", async () => {
    const schema = z.object({
      host: z.string().optional(),
      port: z.number().optional(),
    });

    const context = createConfigContext({ schema });

    const parser = object({
      config: withDefault(option("--config", string()), undefined),
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

    const result = await runWithConfig(parser, context, {
      getConfigPath: (parsed) => (parsed as { config?: string }).config,
      args: [],
    });

    assert.equal(result.host, "localhost");
    assert.equal(result.port, 3000);
  });

  test("validates config file with Standard Schema", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-invalid.json");

    // Invalid config: port should be number, not string
    const invalidConfig = {
      host: "example.com",
      port: "not-a-number",
    };
    await writeFile(configPath, JSON.stringify(invalidConfig));

    try {
      const schema = z.object({
        host: z.string(),
        port: z.number(),
      });

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

      await assert.rejects(
        async () => {
          await runWithConfig(parser, context, {
            getConfigPath: (parsed) => (parsed as { config: string }).config,
            args: [],
          });
        },
        (error: Error) => {
          assert.ok(error.message.includes("Config validation failed"));
          return true;
        },
      );
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("handles missing config file gracefully when not required", async () => {
    const schema = z.object({
      host: z.string().optional(),
    });

    const context = createConfigContext({ schema });

    const parser = object({
      host: bindConfig(option("--host", string()), {
        context,
        key: "host",
        default: "localhost",
      }),
    });

    // No config file specified
    const result = await runWithConfig(parser, context, {
      getConfigPath: () => undefined,
      args: [],
    });

    assert.equal(result.host, "localhost");
  });

  test("supports custom file parser function", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-custom.txt");

    // Custom format: "key=value" lines
    await writeFile(configPath, "host=custom.example.com\nport=9000");

    try {
      const schema = z.object({
        host: z.string(),
        port: z.number(),
      });

      const customParser = (contents: Uint8Array): unknown => {
        const text = new TextDecoder().decode(contents);
        const lines = text.split("\n");
        const result: Record<string, string | number> = {};

        for (const line of lines) {
          const [key, value] = line.split("=");
          if (key && value) {
            result[key] = key === "port" ? parseInt(value, 10) : value;
          }
        }

        return result;
      };

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

      const result = await runWithConfig(parser, context, {
        getConfigPath: (parsed) => (parsed as { config: string }).config,
        fileParser: customParser,
        args: [],
      });

      assert.equal(result.host, "custom.example.com");
      assert.equal(result.port, 9000);
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("works with nested config values", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-nested.json");

    const configData = {
      server: {
        host: "server.example.com",
        port: 8080,
      },
      database: {
        host: "db.example.com",
        port: 5432,
      },
    };
    await writeFile(configPath, JSON.stringify(configData));

    try {
      const schema = z.object({
        server: z.object({
          host: z.string(),
          port: z.number(),
        }),
        database: z.object({
          host: z.string(),
          port: z.number(),
        }),
      });

      const context = createConfigContext({ schema });

      const parser = object({
        config: withDefault(option("--config", string()), configPath),
        serverHost: bindConfig(option("--server-host", string()), {
          context,
          key: (config) => config.server.host,
          default: "localhost",
        }),
        dbHost: bindConfig(option("--db-host", string()), {
          context,
          key: (config) => config.database.host,
          default: "localhost",
        }),
      });

      const result = await runWithConfig(parser, context, {
        getConfigPath: (parsed) => (parsed as { config: string }).config,
        args: [],
      });

      assert.equal(result.serverHost, "server.example.com");
      assert.equal(result.dbHost, "db.example.com");
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("supports custom load function for single config", async () => {
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

    const result = await runWithConfig(parser, context, {
      load: () => ({
        host: "loaded.example.com",
        port: 8080,
      }),
      args: [],
    });

    assert.equal(result.host, "loaded.example.com");
    assert.equal(result.port, 8080);
  });

  test("supports async custom load function", async () => {
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

    const result = await runWithConfig(parser, context, {
      load: async () => {
        // Simulate async loading
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          host: "async.example.com",
          port: 9999,
        };
      },
      args: [],
    });

    assert.equal(result.host, "async.example.com");
    assert.equal(result.port, 9999);
  });

  test("custom load function receives first-pass parsed values", async () => {
    const schema = z.object({
      host: z.string(),
    });

    const context = createConfigContext({ schema });

    const parser = object({
      config: withDefault(option("--config", string()), undefined),
      host: bindConfig(option("--host", string()), {
        context,
        key: "host",
        default: "localhost",
      }),
    });

    let receivedParsed: unknown = null;

    const result = await runWithConfig(parser, context, {
      load: (parsed) => {
        receivedParsed = parsed;
        return { host: "from-load.example.com" };
      },
      args: ["--config", "/custom/path.json"],
    });

    // Verify the load function received the parsed CLI args
    assert.deepEqual(receivedParsed, {
      config: "/custom/path.json",
      host: "localhost", // default value from first pass
    });
    assert.equal(result.host, "from-load.example.com");
  });

  test("custom load validates against schema", async () => {
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
    });

    await assert.rejects(
      async () => {
        await runWithConfig(parser, context, {
          load: () => ({
            host: "example.com",
            port: "not-a-number" as unknown as number, // invalid type
          }),
          args: [],
        });
      },
      (error: Error) => {
        assert.ok(error.message.includes("Config validation failed"));
        return true;
      },
    );
  });

  test("custom load returning undefined skips config", async () => {
    const schema = z.object({
      host: z.string().optional(),
    });

    const context = createConfigContext({ schema });

    const parser = object({
      host: bindConfig(option("--host", string()), {
        context,
        key: "host",
        default: "localhost",
      }),
    });

    const result = await runWithConfig(parser, context, {
      load: () => undefined,
      args: [],
    });

    // Should use default since load returned undefined
    assert.equal(result.host, "localhost");
  });

  test("CLI values override custom load values", async () => {
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

    const result = await runWithConfig(parser, context, {
      load: () => ({
        host: "loaded.example.com",
        port: 8080,
      }),
      args: ["--host", "cli.example.com"],
    });

    assert.equal(result.host, "cli.example.com"); // from CLI
    assert.equal(result.port, 8080); // from load
  });
});
