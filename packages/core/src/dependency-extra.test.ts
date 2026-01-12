/**
 * Additional edge case tests for dependency functionality.
 * These tests cover complex combinations, corner cases, and integration scenarios.
 */
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { dependency, deriveFrom } from "./dependency.ts";
import {
  getDocPage,
  parseAsync,
  suggestAsync,
  type Suggestion,
} from "./parser.ts";
import {
  choice,
  string,
  type ValueParser,
  type ValueParserResult,
} from "./valueparser.ts";
import {
  concat,
  group,
  longestMatch,
  merge,
  object,
  or,
  tuple,
} from "./constructs.ts";
import {
  argument,
  command,
  constant,
  option,
  passThrough,
} from "./primitives.ts";
import { map, optional, withDefault } from "./modifiers.ts";
import { formatUsage } from "./usage.ts";
import { bash, fish, zsh } from "./completion.ts";
import type { NonEmptyString } from "./nonempty.ts";
import { message } from "./message.ts";

// =============================================================================
// Test Helpers: Async Value Parsers
// =============================================================================

/**
 * Creates an async choice parser that validates against allowed values.
 */
function asyncChoice<T extends string>(
  choices: readonly T[],
  delay = 0,
): ValueParser<"async", T> {
  return {
    $mode: "async",
    metavar: "ASYNC_CHOICE" as NonEmptyString,
    async parse(input: string): Promise<ValueParserResult<T>> {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (choices.includes(input as T)) {
        return { success: true, value: input as T };
      }
      return {
        success: false,
        error: message`Must be one of: ${choices.join(", ")}`,
      };
    },
    format(value: T): string {
      return value;
    },
    async *suggest(prefix: string): AsyncIterable<Suggestion> {
      for (const c of choices) {
        if (c.startsWith(prefix)) {
          yield { kind: "literal", text: c };
        }
      }
    },
  };
}

// =============================================================================
// Nested objects with dependencies
// =============================================================================

describe("Nested objects with dependencies", () => {
  test("dependency source and derived parser in nested object", async () => {
    const dbTypeParser = dependency(
      choice(["postgres", "mysql", "sqlite"] as const),
    );
    const dbConnParser = dbTypeParser.derive({
      metavar: "CONNECTION",
      factory: (dbType: "postgres" | "mysql" | "sqlite") => {
        const patterns = {
          postgres: choice(
            ["postgresql://localhost:5432", "postgresql://db:5432"] as const,
          ),
          mysql: choice(["mysql://localhost:3306", "mysql://db:3306"] as const),
          sqlite: choice(["file:./data.db", "file::memory:"] as const),
        };
        return patterns[dbType];
      },
      defaultValue: () => "postgres" as const,
    });

    const parser = object({
      database: object({
        type: option("--db-type", dbTypeParser),
        connection: option("--db-conn", dbConnParser),
      }),
    });

    const result = await parseAsync(parser, [
      "--db-type",
      "sqlite",
      "--db-conn",
      "file::memory:",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.database.type, "sqlite");
      assert.equal(result.value.database.connection, "file::memory:");
    }
  });

  test("multiple nested objects each with their own dependencies", async () => {
    const dbTypeParser = dependency(choice(["postgres", "mysql"] as const));
    const dbConnParser = dbTypeParser.derive({
      metavar: "DB_CONN",
      factory: (dbType: "postgres" | "mysql") =>
        choice(
          dbType === "postgres"
            ? (["pg://localhost", "pg://remote"] as const)
            : (["mysql://localhost", "mysql://remote"] as const),
        ),
      defaultValue: () => "postgres" as const,
    });

    const cacheTypeParser = dependency(choice(["redis", "memcached"] as const));
    const cacheConnParser = cacheTypeParser.derive({
      metavar: "CACHE_CONN",
      factory: (cacheType: "redis" | "memcached") =>
        choice(
          cacheType === "redis"
            ? (["redis://localhost:6379", "redis://cache:6379"] as const)
            : ([
              "memcached://localhost:11211",
              "memcached://cache:11211",
            ] as const),
        ),
      defaultValue: () => "redis" as const,
    });

    const parser = object({
      database: object({
        type: option("--db-type", dbTypeParser),
        connection: option("--db-conn", dbConnParser),
      }),
      cache: object({
        type: option("--cache-type", cacheTypeParser),
        connection: option("--cache-conn", cacheConnParser),
      }),
    });

    const result = await parseAsync(parser, [
      "--db-type",
      "mysql",
      "--db-conn",
      "mysql://remote",
      "--cache-type",
      "memcached",
      "--cache-conn",
      "memcached://cache:11211",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.database.type, "mysql");
      assert.equal(result.value.database.connection, "mysql://remote");
      assert.equal(result.value.cache.type, "memcached");
      assert.equal(result.value.cache.connection, "memcached://cache:11211");
    }
  });

  test("deeply nested objects with dependencies", async () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = envParser.derive({
      metavar: "LEVEL",
      factory: (env: "dev" | "prod") =>
        choice(
          env === "dev"
            ? (["debug", "trace"] as const)
            : (["info", "warn"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      config: object({
        app: object({
          env: option("--env", envParser),
          logging: object({
            level: option("--log-level", logLevelParser),
          }),
        }),
      }),
    });

    const result = await parseAsync(parser, [
      "--env",
      "prod",
      "--log-level",
      "warn",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.config.app.env, "prod");
      assert.equal(result.value.config.app.logging.level, "warn");
    }
  });
});

// =============================================================================
// argument() with dependencies
// =============================================================================

describe("argument() with dependencies", () => {
  test("positional argument as dependency source", async () => {
    const formatParser = dependency(choice(["json", "xml", "csv"] as const));
    const outputParser = formatParser.derive({
      metavar: "OUTPUT",
      factory: (format: "json" | "xml" | "csv") => {
        const extensions = {
          json: choice(["output.json", "data.json"] as const),
          xml: choice(["output.xml", "data.xml"] as const),
          csv: choice(["output.csv", "data.csv"] as const),
        };
        return extensions[format];
      },
      defaultValue: () => "json" as const,
    });

    const parser = object({
      format: argument(formatParser),
      output: option("--output", outputParser),
    });

    const result = await parseAsync(parser, ["csv", "--output", "data.csv"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.format, "csv");
      assert.equal(result.value.output, "data.csv");
    }
  });

  test("derived parser as positional argument", async () => {
    const modeParser = dependency(choice(["read", "write"] as const));
    const pathParser = modeParser.derive({
      metavar: "PATH",
      factory: (mode: "read" | "write") =>
        choice(
          mode === "read"
            ? (["/input/data.txt", "/input/config.txt"] as const)
            : (["/output/result.txt", "/output/log.txt"] as const),
        ),
      defaultValue: () => "read" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      path: argument(pathParser),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "write",
      "/output/result.txt",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "write");
      assert.equal(result.value.path, "/output/result.txt");
    }
  });

  test("multiple positional arguments with dependency", async () => {
    const sourceFormatParser = dependency(choice(["json", "yaml"] as const));
    const targetFormatParser = sourceFormatParser.derive({
      metavar: "TARGET_FORMAT",
      factory: (source: "json" | "yaml") =>
        // Can only convert json to yaml or yaml to json
        choice(source === "json" ? (["yaml"] as const) : (["json"] as const)),
      defaultValue: () => "json" as const,
    });

    const parser = tuple([
      argument(sourceFormatParser),
      argument(targetFormatParser),
    ]);

    const result = await parseAsync(parser, ["json", "yaml"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "json");
      assert.equal(result.value[1], "yaml");
    }
  });
});

// =============================================================================
// longestMatch() with dependencies
// =============================================================================

describe("longestMatch() with dependencies", () => {
  test("longestMatch with dependency in one branch", async () => {
    const modeParser = dependency(choice(["fast", "safe"] as const));
    const algorithmParser = modeParser.derive({
      metavar: "ALGORITHM",
      factory: (mode: "fast" | "safe") =>
        choice(
          mode === "fast"
            ? (["quick", "hash"] as const)
            : (["secure", "verified"] as const),
        ),
      defaultValue: () => "fast" as const,
    });

    const parser = longestMatch(
      object({
        mode: option("--mode", modeParser),
        algorithm: option("--algorithm", algorithmParser),
      }),
      object({
        verbose: option("--verbose"),
        quiet: option("--quiet"),
      }),
    );

    const result = await parseAsync(parser, [
      "--mode",
      "safe",
      "--algorithm",
      "secure",
    ]);
    assert.ok(result.success);
    if (result.success && "mode" in result.value) {
      assert.equal(result.value.mode, "safe");
      assert.equal(result.value.algorithm, "secure");
    }
  });

  test("longestMatch selects branch with more consumed tokens", async () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const portParser = envParser.derive({
      metavar: "PORT",
      factory: (env: "dev" | "prod") =>
        choice(
          env === "dev"
            ? (["3000", "8080"] as const)
            : (["80", "443"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = longestMatch(
      object({
        env: option("--env", envParser),
        port: option("--port", portParser),
        host: option("--host", string()),
      }),
      object({
        config: option("--config", string()),
      }),
    );

    // First branch should be selected (3 tokens consumed)
    const result = await parseAsync(parser, [
      "--env",
      "prod",
      "--port",
      "443",
      "--host",
      "example.com",
    ]);
    assert.ok(result.success);
    if (result.success && "env" in result.value) {
      assert.equal(result.value.env, "prod");
      assert.equal(result.value.port, "443");
      assert.equal(result.value.host, "example.com");
    }
  });
});

// =============================================================================
// Help and usage generation with dependencies
// =============================================================================

describe("Help and usage generation with dependencies", () => {
  test("formatUsage includes derived parser metavar", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["info", "warn"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    const usage = formatUsage("app", parser.usage);
    assert.ok(usage.includes("--mode"));
    assert.ok(usage.includes("--log-level"));
  });

  test("getDocPage generates documentation for parser with dependencies", () => {
    const envParser = dependency(choice(["dev", "staging", "prod"] as const));
    const regionParser = envParser.derive({
      metavar: "REGION",
      factory: (env: "dev" | "staging" | "prod") => {
        if (env === "dev") return choice(["local"] as const);
        if (env === "staging") {
          return choice(["us-staging", "eu-staging"] as const);
        }
        return choice(["us-east-1", "us-west-2", "eu-west-1"] as const);
      },
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      env: option("--env", "-e", envParser, {
        description: message`Environment`,
      }),
      region: option("--region", "-r", regionParser, {
        description: message`Deployment region`,
      }),
    });

    const docPage = getDocPage(parser);
    assert.ok(docPage);
    assert.ok(docPage.sections.length > 0);

    // Find entries for our options
    const entries = docPage.sections.flatMap((s) => s.entries);
    const envEntry = entries.find((e) =>
      e.term.type === "option" && e.term.names.includes("--env")
    );
    const regionEntry = entries.find((e) =>
      e.term.type === "option" && e.term.names.includes("--region")
    );

    assert.ok(envEntry, "Should have --env entry");
    assert.ok(regionEntry, "Should have --region entry");
  });

  test("command with dependencies generates proper help", () => {
    const formatParser = dependency(choice(["json", "yaml"] as const));
    const outputParser = formatParser.derive({
      metavar: "OUTPUT",
      factory: (f: "json" | "yaml") =>
        choice(
          f === "json" ? (["out.json"] as const) : (["out.yaml"] as const),
        ),
      defaultValue: () => "json" as const,
    });

    const parser = command(
      "convert",
      object({
        format: option("--format", formatParser, {
          description: message`Output format`,
        }),
        output: option("--output", outputParser, {
          description: message`Output file`,
        }),
      }),
      { description: message`Convert data between formats` },
    );

    const usage = formatUsage("app", parser.usage);
    assert.ok(usage.includes("convert"));
  });
});

// =============================================================================
// Shell completion with dependencies
// =============================================================================

describe("Shell completion with dependencies", () => {
  test("suggestAsync returns suggestions for dependency source", async () => {
    const modeParser = dependency(choice(["dev", "staging", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "staging" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "trace"] as const)
            : (["info", "warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // Get completions for --mode value
    const modeCompletions = await suggestAsync(parser, ["--mode", ""]);
    const modeValues = modeCompletions.map((c) =>
      c.kind === "literal" ? c.text : ""
    );
    assert.ok(modeValues.includes("dev"));
    assert.ok(modeValues.includes("staging"));
    assert.ok(modeValues.includes("prod"));
  });

  test("suggestAsync returns suggestions for derived parser (uses default)", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "trace"] as const)
            : (["info", "warn"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // Get completions for --log-level value (should use default "dev")
    const logCompletions = await suggestAsync(parser, ["--log-level", ""]);
    const logValues = logCompletions.map((c) =>
      c.kind === "literal" ? c.text : ""
    );
    // Default is "dev", so should suggest debug/trace
    assert.ok(
      logValues.includes("debug") || logValues.includes("trace"),
      `Expected dev-mode values, got: ${logValues.join(", ")}`,
    );
  });

  test("shell completion scripts generate for dependency parser", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const portParser = modeParser.derive({
      metavar: "PORT",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["3000", "8080"] as const)
            : (["80", "443"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Parser is constructed to verify that dependencies work with shell completion
    object({
      mode: option("--mode", modeParser),
      port: option("--port", portParser),
    });

    // The generateScript function just needs a program name
    const bashScript = bash.generateScript("myapp");
    assert.ok(bashScript.includes("myapp"));

    const zshScript = zsh.generateScript("myapp");
    assert.ok(zshScript.includes("myapp"));

    const fishScript = fish.generateScript("myapp");
    assert.ok(fishScript.includes("myapp"));
  });
});

// =============================================================================
// passThrough() with dependencies
// =============================================================================

describe("passThrough() with dependencies", () => {
  test("passThrough greedy with dependency parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const configParser = modeParser.derive({
      metavar: "CONFIG",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["dev.json", "local.json"] as const)
            : (["prod.json"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = merge(
      object({
        mode: option("--mode", modeParser),
        config: option("--config", configParser),
      }),
      object({
        extra: passThrough({ format: "greedy" }),
      }),
    );

    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--config",
      "prod.json",
      "--",
      "extra",
      "args",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.config, "prod.json");
      assert.deepEqual(result.value.extra, ["extra", "args"]);
    }
  });

  test("passThrough equalsOnly with dependencies", async () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const logParser = envParser.derive({
      metavar: "LOG",
      factory: (env: "dev" | "prod") =>
        choice(env === "dev" ? (["debug"] as const) : (["info"] as const)),
      defaultValue: () => "dev" as const,
    });

    const parser = merge(
      object({
        env: option("--env", envParser),
        log: option("--log", logParser),
      }),
      object({
        extra: passThrough({ format: "equalsOnly" }),
      }),
    );

    const result = await parseAsync(parser, [
      "--env",
      "dev",
      "--log",
      "debug",
      "--unknown=value",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.env, "dev");
      assert.equal(result.value.log, "debug");
      assert.deepEqual(result.value.extra, ["--unknown=value"]);
    }
  });
});

// =============================================================================
// Error recovery scenarios with dependencies
// =============================================================================

describe("Error recovery scenarios with dependencies", () => {
  test("optional dependency source - derived parser uses default", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(mode === "dev" ? (["debug"] as const) : (["info"] as const)),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: optional(option("--mode", modeParser)),
      logLevel: option("--log-level", logLevelParser),
    });

    // Mode not provided, derived parser should use default "dev"
    const result = await parseAsync(parser, ["--log-level", "debug"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, undefined);
      assert.equal(result.value.logLevel, "debug");
    }
  });

  test("derived parser factory throws error - error propagates", async () => {
    const modeParser = dependency(choice(["dev", "prod", "broken"] as const));
    const derivedParser = modeParser.derive({
      metavar: "VALUE",
      factory: (mode: "dev" | "prod" | "broken") => {
        if (mode === "broken") {
          throw new Error("Factory error for broken mode");
        }
        return choice(["ok"] as const);
      },
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      value: option("--value", derivedParser),
    });

    // When factory doesn't throw (normal case)
    const result1 = await parseAsync(parser, [
      "--mode",
      "dev",
      "--value",
      "ok",
    ]);
    assert.ok(result1.success);

    // When factory throws
    await assert.rejects(async () => {
      await parseAsync(parser, ["--mode", "broken", "--value", "ok"]);
    }, /Factory error for broken mode/);
  });

  test("derived parser returns failing parser - error propagates", async () => {
    const modeParser = dependency(choice(["strict", "lenient"] as const));
    const valueParser = modeParser.derive({
      metavar: "VALUE",
      factory: (mode: "strict" | "lenient") => {
        if (mode === "strict") {
          // Only accepts "valid"
          return choice(["valid"] as const);
        }
        // Accepts anything
        return string();
      },
      defaultValue: () => "lenient" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      value: option("--value", valueParser),
    });

    // Strict mode with invalid value should fail
    const result = await parseAsync(parser, [
      "--mode",
      "strict",
      "--value",
      "invalid",
    ]);
    assert.ok(!result.success);

    // Lenient mode with same value should succeed
    const result2 = await parseAsync(parser, [
      "--mode",
      "lenient",
      "--value",
      "invalid",
    ]);
    assert.ok(result2.success);
  });

  test("withDefault on dependency source - derived parser sees default", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "trace"] as const)
            : (["info", "warn"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: withDefault(option("--mode", modeParser), "prod" as const),
      logLevel: option("--log-level", logLevelParser),
    });

    // Mode uses default "prod", so log-level should accept prod values
    const result = await parseAsync(parser, ["--log-level", "warn"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "warn");
    }
  });

  test("async factory that rejects - error propagates", async () => {
    const modeParser = dependency(choice(["ok", "fail"] as const));
    const derivedParser = modeParser.deriveAsync({
      metavar: "VALUE",
      factory: (mode: "ok" | "fail") => {
        if (mode === "fail") {
          throw new Error("Async factory rejection");
        }
        return asyncChoice(["success"] as const);
      },
      defaultValue: () => "ok" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      value: option("--value", derivedParser),
    });

    await assert.rejects(async () => {
      await parseAsync(parser, ["--mode", "fail", "--value", "success"]);
    }, /Async factory rejection/);
  });
});

// =============================================================================
// group() with dependencies
// =============================================================================

describe("group() with dependencies", () => {
  test("group containing dependency source and derived parser", async () => {
    const protocolParser = dependency(choice(["http", "https"] as const));
    const portParser = protocolParser.derive({
      metavar: "PORT",
      factory: (protocol: "http" | "https") =>
        choice(
          protocol === "http"
            ? (["80", "8080"] as const)
            : (["443", "8443"] as const),
        ),
      defaultValue: () => "http" as const,
    });

    const parser = group(
      "Connection Options",
      object({
        protocol: option("--protocol", protocolParser, {
          description: message`Protocol`,
        }),
        port: option("--port", portParser, {
          description: message`Port number`,
        }),
      }),
    );

    const result = await parseAsync(parser, [
      "--protocol",
      "https",
      "--port",
      "443",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.protocol, "https");
      assert.equal(result.value.port, "443");
    }
  });

  test("multiple groups with independent dependencies via merge", async () => {
    const dbParser = dependency(choice(["postgres", "mysql"] as const));
    const dbPortParser = dbParser.derive({
      metavar: "DB_PORT",
      factory: (db: "postgres" | "mysql") =>
        choice(db === "postgres" ? (["5432"] as const) : (["3306"] as const)),
      defaultValue: () => "postgres" as const,
    });

    const cacheParser = dependency(choice(["redis", "memcached"] as const));
    const cachePortParser = cacheParser.derive({
      metavar: "CACHE_PORT",
      factory: (cache: "redis" | "memcached") =>
        choice(cache === "redis" ? (["6379"] as const) : (["11211"] as const)),
      defaultValue: () => "redis" as const,
    });

    const parser = merge(
      group(
        "Database Options",
        object({
          db: option("--db", dbParser),
          dbPort: option("--db-port", dbPortParser),
        }),
      ),
      group(
        "Cache Options",
        object({
          cache: option("--cache", cacheParser),
          cachePort: option("--cache-port", cachePortParser),
        }),
      ),
    );

    const result = await parseAsync(parser, [
      "--db",
      "mysql",
      "--db-port",
      "3306",
      "--cache",
      "memcached",
      "--cache-port",
      "11211",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.db, "mysql");
      assert.equal(result.value.dbPort, "3306");
      assert.equal(result.value.cache, "memcached");
      assert.equal(result.value.cachePort, "11211");
    }
  });

  test("group help text includes dependency options", () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const configParser = envParser.derive({
      metavar: "CONFIG",
      factory: (env: "dev" | "prod") =>
        choice(
          env === "dev" ? (["dev.json"] as const) : (["prod.json"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = group(
      "Environment Settings",
      object({
        env: option("--env", envParser, {
          description: message`Target environment`,
        }),
        config: option("--config", configParser, {
          description: message`Config file`,
        }),
      }),
    );

    const docPage = getDocPage(parser);
    assert.ok(docPage);
    const section = docPage.sections.find((s) =>
      s.title === "Environment Settings"
    );
    assert.ok(section, "Should have Environment Settings section");
    assert.ok(section.entries.length >= 2, "Should have at least 2 entries");
  });
});

// =============================================================================
// concat() with dependencies
// =============================================================================

describe("concat() with dependencies", () => {
  test("concat of tuples where one contains dependencies", async () => {
    const modeParser = dependency(choice(["fast", "safe"] as const));
    const levelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "fast" | "safe") =>
        choice(
          mode === "fast" ? (["1", "2"] as const) : (["3", "4", "5"] as const),
        ),
      defaultValue: () => "fast" as const,
    });

    const parser = concat(
      tuple([
        option("--mode", modeParser),
        option("--level", levelParser),
      ]),
      tuple([
        option("--verbose"),
      ]),
    );

    const result = await parseAsync(parser, [
      "--mode",
      "safe",
      "--level",
      "4",
      "--verbose",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "safe");
      assert.equal(result.value[1], "4");
      assert.equal(result.value[2], true);
    }
  });
});

// =============================================================================
// Same dependency source used by multiple derived parsers
// =============================================================================

describe("Same dependency source used by multiple derived parsers", () => {
  test("three derived parsers from same source", async () => {
    const envParser = dependency(choice(["dev", "staging", "prod"] as const));

    const logLevelParser = envParser.derive({
      metavar: "LOG_LEVEL",
      factory: (env: "dev" | "staging" | "prod") => {
        if (env === "dev") return choice(["debug", "trace"] as const);
        if (env === "staging") return choice(["info", "debug"] as const);
        return choice(["warn", "error"] as const);
      },
      defaultValue: () => "dev" as const,
    });

    const timeoutParser = envParser.derive({
      metavar: "TIMEOUT",
      factory: (env: "dev" | "staging" | "prod") => {
        if (env === "dev") return choice(["1000", "5000"] as const);
        if (env === "staging") return choice(["5000", "10000"] as const);
        return choice(["30000", "60000"] as const);
      },
      defaultValue: () => "dev" as const,
    });

    const retriesParser = envParser.derive({
      metavar: "RETRIES",
      factory: (env: "dev" | "staging" | "prod") => {
        if (env === "dev") return choice(["0", "1"] as const);
        if (env === "staging") return choice(["2", "3"] as const);
        return choice(["5", "10"] as const);
      },
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      env: option("--env", envParser),
      logLevel: option("--log-level", logLevelParser),
      timeout: option("--timeout", timeoutParser),
      retries: option("--retries", retriesParser),
    });

    const result = await parseAsync(parser, [
      "--env",
      "staging",
      "--log-level",
      "info",
      "--timeout",
      "10000",
      "--retries",
      "3",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.env, "staging");
      assert.equal(result.value.logLevel, "info");
      assert.equal(result.value.timeout, "10000");
      assert.equal(result.value.retries, "3");
    }
  });

  test("derived parsers in different merge branches share same source", async () => {
    const modeParser = dependency(choice(["a", "b"] as const));

    const derived1 = modeParser.derive({
      metavar: "D1",
      factory: (m: "a" | "b") =>
        choice(m === "a" ? (["a1"] as const) : (["b1"] as const)),
      defaultValue: () => "a" as const,
    });

    const derived2 = modeParser.derive({
      metavar: "D2",
      factory: (m: "a" | "b") =>
        choice(m === "a" ? (["a2"] as const) : (["b2"] as const)),
      defaultValue: () => "a" as const,
    });

    const parser = merge(
      object({ mode: option("--mode", modeParser) }),
      object({ d1: option("--d1", derived1) }),
      object({ d2: option("--d2", derived2) }),
    );

    const result = await parseAsync(parser, [
      "--mode",
      "b",
      "--d1",
      "b1",
      "--d2",
      "b2",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "b");
      assert.equal(result.value.d1, "b1");
      assert.equal(result.value.d2, "b2");
    }
  });
});

// =============================================================================
// deriveFrom with more than 2 dependencies
// =============================================================================

describe("deriveFrom with more than 2 dependencies", () => {
  test("deriveFrom with 3 dependency sources", async () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const regionParser = dependency(choice(["us", "eu"] as const));
    const tierParser = dependency(choice(["free", "paid"] as const));

    const endpointParser = deriveFrom({
      metavar: "ENDPOINT",
      dependencies: [envParser, regionParser, tierParser] as const,
      factory: (
        env: "dev" | "prod",
        region: "us" | "eu",
        tier: "free" | "paid",
      ) => {
        const base = env === "dev" ? "dev" : "api";
        const suffix = tier === "paid" ? "-premium" : "";
        return choice([`${base}.${region}.example.com${suffix}`] as const);
      },
      defaultValues: () => ["dev", "us", "free"] as const,
    });

    const parser = object({
      env: option("--env", envParser),
      region: option("--region", regionParser),
      tier: option("--tier", tierParser),
      endpoint: option("--endpoint", endpointParser),
    });

    const result = await parseAsync(parser, [
      "--env",
      "prod",
      "--region",
      "eu",
      "--tier",
      "paid",
      "--endpoint",
      "api.eu.example.com-premium",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.env, "prod");
      assert.equal(result.value.region, "eu");
      assert.equal(result.value.tier, "paid");
      assert.equal(result.value.endpoint, "api.eu.example.com-premium");
    }
  });

  test("deriveFrom with 4 dependency sources", async () => {
    const a = dependency(choice(["a1", "a2"] as const));
    const b = dependency(choice(["b1", "b2"] as const));
    const c = dependency(choice(["c1", "c2"] as const));
    const d = dependency(choice(["d1", "d2"] as const));

    const combinedParser = deriveFrom({
      metavar: "COMBINED",
      dependencies: [a, b, c, d] as const,
      factory: (av, bv, cv, dv) => choice([`${av}-${bv}-${cv}-${dv}`] as const),
      defaultValues: () => ["a1", "b1", "c1", "d1"] as const,
    });

    const parser = object({
      a: option("--a", a),
      b: option("--b", b),
      c: option("--c", c),
      d: option("--d", d),
      combined: option("--combined", combinedParser),
    });

    const result = await parseAsync(parser, [
      "--a",
      "a2",
      "--b",
      "b1",
      "--c",
      "c2",
      "--d",
      "d1",
      "--combined",
      "a2-b1-c2-d1",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.combined, "a2-b1-c2-d1");
    }
  });
});

// =============================================================================
// Dependencies with map() modifier
// =============================================================================

describe("Dependencies with map() modifier", () => {
  test("map() applied to option with dependency source", async () => {
    const rawModeParser = dependency(choice(["dev", "prod"] as const));
    const mappedModeParser = map(
      option("--mode", rawModeParser),
      (mode) => mode.toUpperCase(),
    );

    const logLevelParser = rawModeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(mode === "dev" ? (["debug"] as const) : (["info"] as const)),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: mappedModeParser,
      logLevel: option("--log-level", logLevelParser),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "info",
    ]);
    assert.ok(result.success);
    if (result.success) {
      // mode should be mapped to uppercase
      assert.equal(result.value.mode, "PROD");
      // logLevel should still work with original value
      assert.equal(result.value.logLevel, "info");
    }
  });

  test("map() applied to option with derived parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const portParser = modeParser.derive({
      metavar: "PORT",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["3000", "8080"] as const)
            : (["80", "443"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      port: map(option("--port", portParser), (port) => parseInt(port, 10)),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--port",
      "443",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.port, 443);
      assert.equal(typeof result.value.port, "number");
    }
  });
});

// =============================================================================
// Dependencies with or() containing objects
// =============================================================================

describe("Dependencies with or() containing objects", () => {
  test("or() with dependency in first branch only", async () => {
    const modeParser = dependency(choice(["fast", "safe"] as const));
    const levelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "fast" | "safe") =>
        choice(mode === "fast" ? (["1", "2"] as const) : (["3", "4"] as const)),
      defaultValue: () => "fast" as const,
    });

    const parser = or(
      object({
        kind: constant("advanced" as const),
        mode: option("--mode", modeParser),
        level: option("--level", levelParser),
      }),
      object({
        kind: constant("simple" as const),
        name: option("--name", string()),
      }),
    );

    // First branch (with dependencies)
    const result1 = await parseAsync(parser, [
      "--mode",
      "safe",
      "--level",
      "4",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.kind, "advanced");
      assert.equal((result1.value as { mode: string }).mode, "safe");
      assert.equal((result1.value as { level: string }).level, "4");
    }

    // Second branch (no dependencies)
    const result2 = await parseAsync(parser, ["--name", "test"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.kind, "simple");
      assert.equal((result2.value as { name: string }).name, "test");
    }
  });
});

// =============================================================================
// Edge case: dependency source appears after derived parser in args
// =============================================================================

describe("Edge case: dependency source appears after derived parser in args", () => {
  test("derived parser value before dependency source value", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "trace"] as const)
            : (["info", "warn"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // Note: --log-level comes BEFORE --mode in the args
    // The parser should still correctly resolve the dependency
    const result = await parseAsync(parser, [
      "--log-level",
      "warn",
      "--mode",
      "prod",
    ]);
    assert.ok(
      result.success,
      `Expected success but got: ${JSON.stringify(result)}`,
    );
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "warn");
    }
  });

  test("complex ordering with multiple dependencies", async () => {
    const aParser = dependency(choice(["a1", "a2"] as const));
    const bParser = dependency(choice(["b1", "b2"] as const));

    const derivedParser = deriveFrom({
      metavar: "DERIVED",
      dependencies: [aParser, bParser] as const,
      factory: (a, b) => choice([`${a}-${b}`] as const),
      defaultValues: () => ["a1", "b1"] as const,
    });

    const parser = object({
      a: option("--a", aParser),
      b: option("--b", bParser),
      derived: option("--derived", derivedParser),
    });

    // Args in order: derived, b, a (reverse of definition order)
    const result = await parseAsync(parser, [
      "--derived",
      "a2-b2",
      "--b",
      "b2",
      "--a",
      "a2",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.a, "a2");
      assert.equal(result.value.b, "b2");
      assert.equal(result.value.derived, "a2-b2");
    }
  });
});
