import { describe, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { object } from "@optique/core/constructs";
import type { SourceContext } from "@optique/core/context";
import { flag, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";
import { runWith, runWithSync } from "@optique/core/facade";
import {
  bindConfig,
  createConfigContext,
  getActiveConfig,
  getActiveConfigMeta,
} from "./index.ts";
import type { ConfigMeta } from "./index.ts";

const TEST_DIR = join(import.meta.dirname ?? ".", "test-configs");

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new TypeError(message);
  }

  return value;
}

describe("run with config context", { concurrency: false }, () => {
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

      const result = await runWith(parser, "test", [context], {
        getConfigPath: (parsed: { config: string }) => parsed.config,
        args: [],
      });

      assert.equal(result.host, "config.example.com");
      assert.equal(result.port, 8080);
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("config loaders preserve parsed object identity when no scrub is needed", async () => {
    const schema = z.object({
      token: z.string().optional(),
    }).optional();

    const context = createConfigContext({ schema });
    const parser = object({
      token: withDefault(option("--token", string()), "cli-token"),
    });

    const metadataByParsed = new WeakMap<object, string>();
    const identityContext: SourceContext = {
      id: Symbol.for("@test/config-loader-identity"),
      mode: "dynamic",
      getAnnotations(parsed?: unknown) {
        if (parsed != null && typeof parsed === "object") {
          metadataByParsed.set(parsed as object, "seen");
        }
        return {};
      },
    };

    let observedMetadata: string | undefined;
    const result = await runWith(parser, "test", [identityContext, context], {
      args: [],
      load(parsed) {
        observedMetadata = metadataByParsed.get(parsed as object);
        return { config: undefined, meta: undefined };
      },
    });

    assert.deepEqual(result, { token: "cli-token" });
    assert.equal(observedMetadata, "seen");
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

      const result = await runWith(parser, "test", [context], {
        getConfigPath: (parsed: { config: string }) => parsed.config,
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

    const result = await runWith(parser, "test", [context], {
      getConfigPath: (parsed: { config?: string }) => parsed.config,
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
          await runWith(parser, "test", [context], {
            getConfigPath: (parsed: { config: string }) => parsed.config,
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
          await runWith(parser, "test", [context], {
            getConfigPath: (parsed: { config: string }) => parsed.config,
            args: [],
          });
        },
        (error: Error) => {
          assert.ok(
            error.message.includes(configPath),
            "error message should include the config file path",
          );
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
    const result = await runWith(parser, "test", [context], {
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

      const context = createConfigContext({
        schema,
        fileParser: customParser,
      });

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

      const result = await runWith(parser, "test", [context], {
        getConfigPath: (parsed: { config: string }) => parsed.config,
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

      const result = await runWith(parser, "test", [context], {
        load: async () => {
          const base = JSON.parse(await readFile(baseConfigPath, "utf-8"));
          const user = JSON.parse(await readFile(userConfigPath, "utf-8"));
          // Simple merge: user overrides base
          return {
            config: { ...base, ...user },
            meta: {
              configDir: TEST_DIR,
              configPath: join(TEST_DIR, "merged-config.json"),
            } satisfies ConfigMeta,
          };
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

    const result = await runWith(parser, "test", [context], {
      load: () => ({
        config: 0,
        meta: {
          configDir: TEST_DIR,
          configPath: join(TEST_DIR, "custom-loader-number.json"),
        } satisfies ConfigMeta,
      }),
      args: [],
    });

    assert.equal(result, 0);
  });

  for (
    const [parserName, configValue, cliArgs, label] of [
      [
        "number",
        9,
        [] as readonly string[],
        "0 as the initial parsed result",
      ],
      [
        "boolean",
        true,
        [] as readonly string[],
        "false as the initial parsed result",
      ],
      [
        "string",
        "config-name",
        [] as readonly string[],
        '"" as the initial parsed result',
      ],
    ] as const
  ) {
    test(
      `runs phase-two config loading when the top-level parser returns ${label}`,
      async () => {
        if (parserName === "number") {
          const schema = z.number();
          const context = createConfigContext({ schema });
          const parser = bindConfig(
            withDefault(option("--count", integer()), 0),
            {
              context,
              key: (config) => config,
              default: 0,
            },
          );

          const result = await runWith(parser, "test", [context], {
            load: (parsed: number) => {
              assert.equal(parsed, 0);
              return { config: configValue, meta: undefined };
            },
            args: cliArgs,
          });

          assert.equal(result, configValue);
          return;
        }

        if (parserName === "boolean") {
          const schema = z.boolean();
          const context = createConfigContext({ schema });
          const parser = bindConfig(withDefault(flag("--enabled"), false), {
            context,
            key: (config) => config,
            default: false,
          });

          const result = await runWith(parser, "test", [context], {
            load: (parsed: boolean) => {
              assert.equal(parsed, false);
              return { config: configValue, meta: undefined };
            },
            args: cliArgs,
          });

          assert.equal(result, configValue);
          return;
        }

        const schema = z.string();
        const context = createConfigContext({ schema });
        const parser = bindConfig(withDefault(option("--name", string()), ""), {
          context,
          key: (config) => config,
          default: "",
        });

        const result = await runWith(parser, "test", [context], {
          load: (parsed: string) => {
            assert.equal(parsed, "");
            return { config: configValue, meta: undefined };
          },
          args: cliArgs,
        });

        assert.equal(result, configValue);
      },
    );
  }

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

      const result = await runWith(parser, "test", [context], {
        getConfigPath: (parsed: { config: string }) => parsed.config,
        args: [],
      });

      assert.equal(result.serverHost, "server.example.com");
      assert.equal(result.dbHost, "db.example.com");
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("single-file mode passes config metadata to key callback", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-path-meta.json");

    await writeFile(configPath, JSON.stringify({ outDir: "./output" }));

    try {
      const schema = z.object({
        outDir: z.string(),
      });

      const context = createConfigContext({ schema });

      const parser = object({
        config: withDefault(option("--config", string()), configPath),
        outDir: bindConfig(option("--out-dir", string()), {
          context,
          key: (config, meta) =>
            resolve(
              requireValue(meta, "Expected config metadata.").configDir,
              config.outDir,
            ),
          default: "./fallback",
        }),
      });

      const result = await runWith(parser, "test", [context], {
        getConfigPath: (parsed: { config: string }) => parsed.config,
        args: [],
      });

      assert.equal(result.outDir, resolve(TEST_DIR, "output"));
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("single-file metadata normalizes relative config path to absolute", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-relative-meta.json");
    const relativeConfigPath = relative(process.cwd(), configPath);

    await writeFile(configPath, JSON.stringify({ name: "demo" }));

    try {
      const schema = z.object({
        name: z.string(),
      });

      const context = createConfigContext({ schema });
      const parser = bindConfig(option("--name", string()), {
        context,
        key: (_config, meta) =>
          requireValue(meta, "Expected config metadata.").configPath,
        default: "unused",
      });

      const result = await runWith(parser, "test", [context], {
        getConfigPath: () => relativeConfigPath,
        args: [],
      });

      assert.equal(result, resolve(configPath));
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("custom load mode passes custom metadata to key callback", async () => {
    interface CustomMeta {
      readonly source: "project" | "user" | "system";
      readonly dir: string;
    }

    const schema = z.object({
      outDir: z.string(),
    });

    const context = createConfigContext<z.infer<typeof schema>, CustomMeta>({
      schema,
    });

    const parser = bindConfig(option("--out-dir", string()), {
      context,
      key: (config, meta) => {
        const metadata = requireValue(meta, "Expected config metadata.");
        return `${metadata.source}:${resolve(metadata.dir, config.outDir)}`;
      },
      default: "unused",
    });

    const result = await runWith(parser, "test", [context], {
      load: () => ({
        config: { outDir: "./cache" },
        meta: { source: "project", dir: "/workspace" },
      }),
      args: [],
    });

    assert.equal(result, "project:/workspace/cache");
  });

  test("custom load mode keeps default ConfigMeta type", async () => {
    const schema = z.object({
      outDir: z.string(),
    });

    const context = createConfigContext({ schema });

    const parser = bindConfig(option("--out-dir", string()), {
      context,
      key: (config, meta) =>
        resolve(
          requireValue(meta, "Expected config metadata.").configDir,
          config.outDir,
        ),
      default: "unused",
    });

    const result = await runWith(parser, "test", [context], {
      load: () => ({
        config: { outDir: "./build" },
        meta: {
          configDir: "/repo",
          configPath: "/repo/myapp.json",
        } satisfies ConfigMeta,
      }),
      args: [],
    });

    assert.equal(result, "/repo/build");
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

      await runWith(parser, "test", [context], {
        getConfigPath: (parsed: { config?: string }) => parsed.config,
        args: ["--help"],
        help: {
          option: true,
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

      await runWith(parser, "test", [context], {
        getConfigPath: (parsed: { config: string }) => parsed.config,
        args: ["--help"],
        help: {
          option: true,
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

      await runWith(parser, "test", [context], {
        getConfigPath: (parsed: { config?: string }) => parsed.config,
        args: ["--version"],
        version: {
          option: true,
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

      await runWith(parser, "test", [context], {
        getConfigPath: (parsed: { config?: string }) => parsed.config,
        args: ["completion", "bash"],
        completion: {
          command: true,
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

      await runWith(parser, "my-custom-app", [context], {
        getConfigPath: () => undefined,
        args: ["--help"],
        help: {
          option: true,
          onShow: () => "help-shown" as never,
        },
        stdout: (text) => {
          helpOutput += text;
        },
      });

      assert.ok(helpOutput.includes("Usage: my-custom-app"));
    });
  });

  test("withDefault(object(...)) returns default on empty args", async () => {
    // Regression test for https://github.com/dahlia/optique/issues/131
    // runWith() crashed with TypeError when withDefault(object(...))
    // took the default path (no tokens consumed).
    const schema = z.object({});
    const context = createConfigContext({ schema });

    const parser = withDefault(
      object({
        enabled: flag("--enabled"),
        dependent: option("--dependent", string()),
      }),
      { enabled: false as const } as const,
    );

    const result = await runWith(parser, "test", [context], {
      load: () => ({
        config: {},
        meta: {
          configDir: TEST_DIR,
          configPath: join(TEST_DIR, "issue-131-default.json"),
        } satisfies ConfigMeta,
      }),
      args: [],
    });

    assert.deepEqual(result, { enabled: false });
  });

  test("withDefault(object(...)) returns parsed value when args given", async () => {
    // Companion test for https://github.com/dahlia/optique/issues/131
    // Verify that when tokens are consumed, the parser works correctly.
    const schema = z.object({});
    const context = createConfigContext({ schema });

    const parser = withDefault(
      object({
        enabled: flag("--enabled"),
        dependent: option("--dependent", string()),
      }),
      { enabled: false as const } as const,
    );

    const result = await runWith(parser, "test", [context], {
      load: () => ({
        config: {},
        meta: {
          configDir: TEST_DIR,
          configPath: join(TEST_DIR, "issue-131-parsed.json"),
        } satisfies ConfigMeta,
      }),
      args: ["--enabled", "--dependent", "foo"],
    });

    assert.deepEqual(result, { enabled: true, dependent: "foo" });
  });

  test("dispose clears active config registry after runWith", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-dispose.json");
    await writeFile(
      configPath,
      JSON.stringify({ host: "dispose-test.com" }),
    );

    try {
      const schema = z.object({ host: z.string() });
      const context = createConfigContext({ schema });

      const parser = object({
        config: withDefault(option("--config", string()), configPath),
        host: bindConfig(option("--host", string()), {
          context,
          key: "host",
          default: "localhost",
        }),
      });

      await runWith(parser, "test", [context], {
        getConfigPath: (parsed: { config: string }) => parsed.config,
        args: [],
      });

      // After runWith completes, dispose should have cleared the registries
      assert.equal(getActiveConfig(context.id), undefined);
      assert.equal(getActiveConfigMeta(context.id), undefined);
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("ENOENT file (non-existent config) returns defaults", async () => {
    const schema = z.object({
      host: z.string(),
      port: z.number(),
    });
    const context = createConfigContext({ schema });

    const parser = object({
      config: withDefault(
        option("--config", string()),
        "/nonexistent/path/config.json",
      ),
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

    const result = await runWith(parser, "test", [context], {
      getConfigPath: (parsed: { config: string }) => parsed.config,
      args: [],
    });

    // Non-existent config file should be treated as optional
    assert.equal(result.host, "localhost");
    assert.equal(result.port, 3000);
  });

  test("load function that throws propagates through runWith", async () => {
    const schema = z.object({ host: z.string() });
    const context = createConfigContext({ schema });

    const parser = object({
      host: bindConfig(option("--host", string()), {
        context,
        key: "host",
        default: "localhost",
      }),
    });

    await assert.rejects(
      () =>
        runWith(parser, "test", [context], {
          load: () => {
            throw new Error("Custom load failure.");
          },
          args: [],
        }),
      (error: Error) => {
        assert.equal(error.message, "Custom load failure.");
        return true;
      },
    );
  });

  test("load function returning sync ConfigLoadResult works", async () => {
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

    const result = await runWith(parser, "test", [context], {
      load: () => ({
        config: { host: "sync-host", port: 9999 },
        meta: {
          configDir: "/test",
          configPath: "/test/config.json",
        } satisfies ConfigMeta,
      }),
      args: [],
    });

    assert.equal(result.host, "sync-host");
    assert.equal(result.port, 9999);
  });

  test("supports multiple config contexts with different schemas", async () => {
    // Regression test for https://github.com/dahlia/optique/issues/136
    // When two ConfigContext instances are passed to runWith(), each parser
    // bound to its own context must read from the correct source, even
    // through the annotation path (not just the active-registry fallback).
    //
    // The bug: both contexts write annotations under the same shared
    // configKey symbol.  mergeAnnotations() keeps only one value, so a
    // parser bound to the losing context reads from the wrong config data.
    //
    // Using a top-level (non-object) bindConfig parser exercises the
    // annotation path: injectAnnotationsIntoParser() sets annotations on
    // the parser's initialState, so bindConfig.parse() stores them in its
    // state and bindConfig.complete() reads from annotations[configKey]
    // (which may be the wrong context's data) rather than the registry.
    //
    // schema1 validates only { host }, schema2 validates only { port }.
    // After Zod strips extra fields, context1 produces { host } and
    // context2 produces { port }.  With the bug, context1's data
    // overwrites context2's at configKey, so the port parser falls back to
    // the default instead of reading 8080.
    const schema1 = z.object({ host: z.string() });
    const schema2 = z.object({ port: z.number() });

    const context1 = createConfigContext({ schema: schema1 });
    const context2 = createConfigContext({ schema: schema2 });

    // Top-level parser bound to context2.  context1 is present so its
    // annotations overwrite context2's in the merged result, exposing the
    // bug.
    const parser = bindConfig(option("--port", integer()), {
      context: context2,
      key: "port",
      default: 3000,
    });

    // Both contexts share the same load function.  Each validates the raw
    // config against its own schema.
    const result = await runWith(parser, "test", [context1, context2], {
      load: () => ({
        config: { host: "config.example.com", port: 8080 },
        meta: {
          configDir: "/test",
          configPath: "/test/config.json",
        } satisfies ConfigMeta,
      }),
      args: [],
    });

    // Must read from context2's validated config, not context1's.
    assert.equal(result, 8080);
  });

  test("supports runWithSync() with config file fallbacks", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-sync.json");

    await writeFile(
      configPath,
      JSON.stringify({
        host: "sync.example.com",
        port: 7000,
      }),
    );

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

      const result = runWithSync(parser, "test", [context], {
        getConfigPath: (parsed: { config: string }) => parsed.config,
        args: [],
      });

      assert.deepEqual(result, {
        config: configPath,
        host: "sync.example.com",
        port: 7000,
      });
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("runWithSync() keeps CLI values ahead of config fallbacks", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const configPath = join(TEST_DIR, "test-config-sync-override.json");

    await writeFile(
      configPath,
      JSON.stringify({
        host: "sync.example.com",
        port: 7000,
      }),
    );

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

      const result = runWithSync(parser, "test", [context], {
        getConfigPath: (parsed: { config: string }) => parsed.config,
        args: ["--host", "cli.example.com"],
      });

      assert.deepEqual(result, {
        config: configPath,
        host: "cli.example.com",
        port: 7000,
      });
    } finally {
      await rm(configPath, { force: true });
    }
  });

  test("sanitized non-plain parsed values preserve private field access", async () => {
    // Regression test for https://github.com/dahlia/optique/issues/307
    // When a non-plain object (class instance) containing a deferred prompt
    // value is sanitized, the proxy must not break methods that access
    // private fields.
    const deferredPromptValueKey = Symbol.for(
      "@optique/inquirer/deferredPromptValue",
    );

    class ConfigInput {
      #apiKey: string;
      deferred: unknown;
      constructor(apiKey: string, deferred: unknown) {
        this.#apiKey = apiKey;
        this.deferred = deferred;
      }
      getApiKey(): string {
        return this.#apiKey;
      }
    }

    const schema = z.object({ token: z.string().optional() }).optional();
    const context = createConfigContext({ schema });

    const parser = object({
      name: withDefault(option("--name", string()), "test"),
    });

    // The load callback receives sanitized parsed values.  We use a custom
    // SourceContext that injects a class instance with a deferred prompt
    // value into the parsed result before the config context sees it.
    let observedApiKey: string | undefined;
    let observedDeferred: unknown = "not-set";

    const injectContext: SourceContext = {
      id: Symbol.for("@test/inject-class-instance"),
      mode: "dynamic",
      getAnnotations(parsed?: unknown) {
        if (parsed == null) return {};
        // Replace the parsed value with a class instance containing a
        // deferred prompt value.  This simulates what happens when map()
        // transforms a prompt-backed config field into a class instance.
        return {};
      },
    };

    const result = await runWith(parser, "test", [injectContext, context], {
      args: [],
      load(_parsed) {
        return { config: undefined, meta: undefined };
      },
    });
    assert.deepEqual(result, { name: "test" });

    // Now test the sanitization directly through getAnnotations.
    // getAnnotations is called by the runner with the parsed value.
    // We call it manually with a class instance containing deferred values.
    const instance = new ConfigInput(
      "secret-key",
      { [deferredPromptValueKey]: true },
    );

    const annotations = context.getAnnotations(instance, {
      load(parsed: unknown) {
        const sanitized = parsed as ConfigInput;
        observedApiKey = sanitized.getApiKey();
        observedDeferred = sanitized.deferred;
        return { config: undefined, meta: undefined };
      },
    });

    // If synchronous, check directly; if async, await it
    if (annotations instanceof Promise) {
      await annotations;
    }

    assert.equal(observedApiKey, "secret-key");
    assert.equal(observedDeferred, undefined);
  });

  test("sanitized non-plain methods do not leak deferred values via public fields", () => {
    // Regression test for https://github.com/dahlia/optique/issues/307
    // Methods that wrap public fields (e.g. getToken() { return this.token; })
    // must return sanitized values, not raw deferred prompt sentinels.
    const deferredPromptValueKey = Symbol.for(
      "@optique/inquirer/deferredPromptValue",
    );

    class Wrapper {
      #secret: string;
      token: unknown;
      constructor(secret: string, token: unknown) {
        this.#secret = secret;
        this.token = token;
      }
      getSecret(): string {
        return this.#secret;
      }
      getToken(): unknown {
        return this.token;
      }
    }

    const schema = z.object({ v: z.string().optional() }).optional();
    const context = createConfigContext({ schema });

    const instance = new Wrapper(
      "safe",
      { [deferredPromptValueKey]: true },
    );

    let observedSecret: string | undefined;
    let observedToken: unknown = "not-set";

    context.getAnnotations(instance, {
      load(parsed: unknown) {
        const w = parsed as Wrapper;
        observedSecret = w.getSecret();
        observedToken = w.getToken();
        return { config: undefined, meta: undefined };
      },
    });

    assert.equal(observedSecret, "safe");
    assert.equal(observedToken, undefined);
  });

  test("sanitized non-plain methods observe scrubbed public fields via this", () => {
    // Regression test for https://github.com/dahlia/optique/issues/307
    // Methods that derive results from sanitized public fields must observe
    // the scrubbed values, not the original deferred sentinels.  For example,
    // hasToken() { return this.token !== undefined; } must return false when
    // the token field holds a deferred prompt value.
    const deferredPromptValueKey = Symbol.for(
      "@optique/inquirer/deferredPromptValue",
    );

    class Cfg {
      #id: string;
      token: unknown;
      constructor(id: string, token: unknown) {
        this.#id = id;
        this.token = token;
      }
      getId(): string {
        return this.#id;
      }
      hasToken(): boolean {
        return this.token !== undefined;
      }
    }

    const schema = z.object({ v: z.string().optional() }).optional();
    const context = createConfigContext({ schema });

    const instance = new Cfg(
      "abc",
      { [deferredPromptValueKey]: true },
    );

    let observedId: string | undefined;
    let observedHasToken: boolean | undefined;

    context.getAnnotations(instance, {
      load(parsed: unknown) {
        const c = parsed as Cfg;
        observedId = c.getId();
        observedHasToken = c.hasToken();
        return { config: undefined, meta: undefined };
      },
    });

    assert.equal(observedId, "abc");
    assert.equal(observedHasToken, false);
  });
});
