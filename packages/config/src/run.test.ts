import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";
import { bindConfig, createConfigContext } from "./index.ts";
import { runWithConfig } from "./run.ts";

const TEST_DIR = join(import.meta.dirname ?? ".", "test-configs");

describe("runWithConfig", { concurrency: false }, () => {
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

  test("fails when config file JSON is malformed", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-malformed.json");
    await writeFile(configPath, "{ invalid json");

    try {
      const schema = z.object({
        host: z.string().optional(),
      });

      const context = createConfigContext({ schema });

      const parser = object({
        config: withDefault(option("--config", string()), configPath),
        host: bindConfig(option("--host", string()), {
          context,
          key: "host",
          default: "localhost",
        }),
      });

      await assert.rejects(
        async () => {
          await runWithConfig(parser, context, {
            getConfigPath: (parsed) => (parsed as { config: string }).config,
            args: [],
          });
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

  test("supports custom file parser", async () => {
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

  test("supports custom load function for multi-file merging", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const baseConfigPath = join(TEST_DIR, "base-config.json");
    const userConfigPath = join(TEST_DIR, "user-config.json");

    await writeFile(
      baseConfigPath,
      JSON.stringify({
        host: "base.example.com",
        port: 3000,
        timeout: 30,
      }),
    );

    await writeFile(
      userConfigPath,
      JSON.stringify({
        host: "user.example.com",
        timeout: 60,
      }),
    );

    try {
      const schema = z.object({
        host: z.string(),
        port: z.number(),
        timeout: z.number(),
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
          default: 8080,
        }),
        timeout: bindConfig(option("--timeout", integer()), {
          context,
          key: "timeout",
          default: 10,
        }),
      });

      const result = await runWithConfig(parser, context, {
        load: async () => {
          const base = JSON.parse(await readFile(baseConfigPath, "utf-8"));
          const user = JSON.parse(await readFile(userConfigPath, "utf-8"));
          // Simple merge: user overrides base
          return { ...base, ...user };
        },
        args: [],
      });

      assert.equal(result.host, "user.example.com"); // from user config
      assert.equal(result.port, 3000); // from base config
      assert.equal(result.timeout, 60); // from user config (overrides base)
    } finally {
      await rm(baseConfigPath, { force: true });
      await rm(userConfigPath, { force: true });
    }
  });

  test("preserves falsy config values from custom loader", async () => {
    const schema = z.number();
    const context = createConfigContext({ schema });

    const parser = bindConfig(option("--timeout", integer()), {
      context,
      key: (config) => config,
      default: 10,
    });

    const result = await runWithConfig(parser, context, {
      load: () => 0,
      args: [],
    });

    assert.equal(result, 0);
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

  describe("help/version/completion support", () => {
    test("should show help without loading config", async () => {
      const schema = z.object({
        host: z.string(),
        port: z.number(),
      });

      const context = createConfigContext({ schema });

      const parser = object({
        config: option("--config", string()),
        host: bindConfig(option("--host", string()), {
          context,
          key: "host",
          default: "localhost",
        }),
      });

      let helpShown = false;
      let helpOutput = "";

      await runWithConfig(parser, context, {
        getConfigPath: (parsed) => (parsed as { config?: string }).config,
        args: ["--help"],
        help: {
          mode: "option",
          onShow: () => {
            helpShown = true;
            return "help-shown" as never;
          },
        },
        stdout: (text) => {
          helpOutput += text;
        },
      });

      assert.ok(helpShown);
      assert.ok(helpOutput.includes("Usage:"));
    });

    test("should show help even when config file doesn't exist", async () => {
      const nonExistentPath = join(TEST_DIR, "nonexistent-config.json");

      const schema = z.object({
        host: z.string(),
      });

      const context = createConfigContext({ schema });

      const parser = object({
        config: withDefault(option("--config", string()), nonExistentPath),
        host: bindConfig(option("--host", string()), {
          context,
          key: "host",
          default: "localhost",
        }),
      });

      let helpShown = false;

      await runWithConfig(parser, context, {
        getConfigPath: (parsed) => (parsed as { config: string }).config,
        args: ["--help"],
        help: {
          mode: "option",
          onShow: () => {
            helpShown = true;
            return "help-shown" as never;
          },
        },
        stdout: () => {},
      });

      assert.ok(helpShown);
    });

    test("should show version without loading config", async () => {
      const schema = z.object({
        host: z.string(),
      });

      const context = createConfigContext({ schema });

      const parser = object({
        config: option("--config", string()),
        host: bindConfig(option("--host", string()), {
          context,
          key: "host",
          default: "localhost",
        }),
      });

      let versionShown = false;
      let versionOutput = "";

      await runWithConfig(parser, context, {
        getConfigPath: (parsed) => (parsed as { config?: string }).config,
        args: ["--version"],
        version: {
          mode: "option",
          value: "1.0.0",
          onShow: () => {
            versionShown = true;
            return "version-shown" as never;
          },
        },
        stdout: (text) => {
          versionOutput += text;
        },
      });

      assert.ok(versionShown);
      assert.equal(versionOutput, "1.0.0");
    });

    test("should generate completion without loading config", async () => {
      const schema = z.object({
        host: z.string(),
      });

      const context = createConfigContext({ schema });

      const parser = object({
        config: option("--config", string()),
        host: bindConfig(option("--host", string()), {
          context,
          key: "host",
          default: "localhost",
        }),
      });

      let completionShown = false;
      let completionOutput = "";

      await runWithConfig(parser, context, {
        getConfigPath: (parsed) => (parsed as { config?: string }).config,
        args: ["completion", "bash"],
        completion: {
          mode: "command",
          onShow: () => {
            completionShown = true;
            return "completion-shown" as never;
          },
        },
        stdout: (text) => {
          completionOutput += text;
        },
      });

      assert.ok(completionShown);
      assert.ok(completionOutput.length > 0);
    });

    test("should support programName option", async () => {
      const schema = z.object({
        host: z.string(),
      });

      const context = createConfigContext({ schema });

      const parser = object({
        host: bindConfig(option("--host", string()), {
          context,
          key: "host",
          default: "localhost",
        }),
      });

      let helpOutput = "";

      await runWithConfig(parser, context, {
        getConfigPath: () => undefined,
        args: ["--help"],
        programName: "my-custom-app",
        help: {
          mode: "option",
          onShow: () => "help-shown" as never,
        },
        stdout: (text) => {
          helpOutput += text;
        },
      });

      assert.ok(helpOutput.includes("Usage: my-custom-app"));
    });
  });
});
