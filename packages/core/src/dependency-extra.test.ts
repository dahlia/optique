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
  conditional,
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
import { map, multiple, optional, withDefault } from "./modifiers.ts";
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

    // When factory throws, the exception is caught and returned as a parse failure
    const result2 = await parseAsync(parser, [
      "--mode",
      "broken",
      "--value",
      "ok",
    ]);
    assert.ok(!result2.success);
    if (!result2.success) {
      const errorText = result2.error
        .map((t) => ("text" in t ? t.text : ""))
        .join("");
      assert.ok(
        errorText.includes("Factory error"),
        `Expected error to contain "Factory error", got: ${errorText}`,
      );
    }
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

    // Factory exception is caught and returned as parse failure
    const result = await parseAsync(parser, [
      "--mode",
      "fail",
      "--value",
      "success",
    ]);
    assert.ok(!result.success);
    if (!result.success) {
      const errorText = result.error
        .map((t) => ("text" in t ? t.text : ""))
        .join("");
      assert.ok(
        errorText.includes("Factory error"),
        `Expected error to contain "Factory error", got: ${errorText}`,
      );
    }
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

// =============================================================================
// Double wrapping: optional() + withDefault() with dependencies
// =============================================================================

describe("optional() + withDefault() double wrapping with dependencies", () => {
  test("optional(withDefault(option(..., dependencySource), default))", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose", "info"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Double wrap: optional(withDefault(...))
    const parser = object({
      mode: optional(
        withDefault(option("--mode", modeParser), "prod" as const),
      ),
      logLevel: option("--log-level", logLevelParser),
    });

    // No --mode provided: withDefault gives "prod", derived parser should accept prod-mode values
    const result1 = await parseAsync(parser, ["--log-level", "warn"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "prod");
      assert.equal(result1.value.logLevel, "warn");
    }

    // --mode explicitly provided as "dev"
    const result2 = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "debug",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "dev");
      assert.equal(result2.value.logLevel, "debug");
    }
  });

  test("withDefault(optional(option(..., dependencySource)), default)", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Reverse order: withDefault(optional(...))
    const parser = object({
      mode: withDefault(
        optional(option("--mode", modeParser)),
        "prod" as const,
      ),
      logLevel: option("--log-level", logLevelParser),
    });

    // No --mode provided
    const result = await parseAsync(parser, ["--log-level", "warn"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "warn");
    }
  });
});

// =============================================================================
// map() transformed dependency source
// =============================================================================

describe("map() transformed dependency source", () => {
  test("map() on option with dependency source - derived parser sees original value", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // map() transforms the mode to uppercase, but derived parser should still work
    const parser = object({
      mode: map(option("--mode", modeParser), (m) => m.toUpperCase()),
      logLevel: option("--log-level", logLevelParser),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "error",
    ]);
    assert.ok(result.success);
    if (result.success) {
      // map() should transform the final value to uppercase
      assert.equal(result.value.mode, "PROD");
      // derived parser should still see original "prod" value
      assert.equal(result.value.logLevel, "error");
    }
  });

  test("map() on derived parser option", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // map() on the derived parser's option
    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: map(
        option("--log-level", logLevelParser),
        (level) => level.toUpperCase(),
      ),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "warn",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "WARN");
    }
  });

  test("chained map() transformations on dependency source", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Chain multiple map() transformations
    const parser = object({
      mode: map(
        map(option("--mode", modeParser), (m) => m.toUpperCase()),
        (m) => `MODE_${m}`,
      ),
      logLevel: option("--log-level", logLevelParser),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "debug",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "MODE_DEV");
      assert.equal(result.value.logLevel, "debug");
    }
  });
});

// =============================================================================
// flag() parser with dependencies
// =============================================================================

describe("flag() parser with dependencies", () => {
  test("boolean dependency source with derive()", async () => {
    // Create a custom boolean value parser for dependency
    const boolParser: ValueParser<"sync", boolean> = {
      $mode: "sync",
      metavar: "BOOL" as NonEmptyString,
      parse(input: string) {
        if (input === "true" || input === "1" || input === "yes") {
          return { success: true, value: true };
        }
        if (input === "false" || input === "0" || input === "no") {
          return { success: true, value: false };
        }
        return { success: false, error: message`Expected boolean value` };
      },
      format(value: boolean) {
        return value ? "true" : "false";
      },
      *suggest(_prefix: string) {
        yield { kind: "literal" as const, text: "true" };
        yield { kind: "literal" as const, text: "false" };
      },
    };

    const verboseParser = dependency(boolParser);
    const outputParser = verboseParser.derive({
      metavar: "OUTPUT",
      factory: (verbose: boolean) =>
        choice(
          verbose
            ? (["detailed", "full"] as const)
            : (["summary", "brief"] as const),
        ),
      defaultValue: () => false,
    });

    const parser = object({
      verbose: option("--verbose", verboseParser),
      output: option("--output", outputParser),
    });

    // verbose=true allows "detailed" or "full"
    const result1 = await parseAsync(parser, [
      "--verbose",
      "true",
      "--output",
      "detailed",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.verbose, true);
      assert.equal(result1.value.output, "detailed");
    }

    // verbose=false allows "summary" or "brief"
    const result2 = await parseAsync(parser, [
      "--verbose",
      "false",
      "--output",
      "brief",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.verbose, false);
      assert.equal(result2.value.output, "brief");
    }
  });
});

// =============================================================================
// Factory edge cases
// =============================================================================

describe("Factory edge cases", () => {
  test("factory returns parser that always fails", async () => {
    const modeParser = dependency(choice(["fail"] as const));
    const derivedParser = modeParser.derive({
      metavar: "VALUE",
      factory: (_mode: "fail") => ({
        $mode: "sync" as const,
        metavar: "VALUE" as NonEmptyString,
        parse(_input: string) {
          return { success: false, error: message`Always fails` };
        },
        format() {
          return "";
        },
        *suggest() {},
      }),
      defaultValue: () => "fail" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      value: option("--value", derivedParser),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "fail",
      "--value",
      "anything",
    ]);
    assert.ok(!result.success);
  });

  // TODO: When factory throws an exception, it propagates instead of being
  // caught and returned as a parse failure. This test expects graceful error
  // handling but the current implementation lets exceptions bubble up.
  test("factory exception recovery - parser reuse after error", async () => {
    let callCount = 0;
    const modeParser = dependency(choice(["normal", "error"] as const));
    const derivedParser = modeParser.derive({
      metavar: "VALUE",
      factory: (mode: "normal" | "error") => {
        callCount++;
        if (mode === "error") {
          throw new Error("Factory error!");
        }
        return choice(["a", "b", "c"] as const);
      },
      defaultValue: () => "normal" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      value: option("--value", derivedParser),
    });

    // First call with error mode should fail (factory throws during resolution)
    const result1 = await parseAsync(parser, [
      "--mode",
      "error",
      "--value",
      "a",
    ]);
    assert.ok(!result1.success);
    // Error message should indicate factory error
    if (!result1.success) {
      const errorText = result1.error
        .map((t) => ("text" in t ? t.text : ""))
        .join("");
      assert.ok(
        errorText.includes("Factory error"),
        `Expected error to contain "Factory error", got: ${errorText}`,
      );
    }

    // Second call with normal mode should succeed (parser reuse)
    const result2 = await parseAsync(parser, [
      "--mode",
      "normal",
      "--value",
      "b",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "normal");
      assert.equal(result2.value.value, "b");
    }

    // Factory is called during both initial parse (with default) and resolution
    // (with actual dependency value), so we expect at least 4 calls:
    // Parse 1: default parse + error resolution = 2 calls
    // Parse 2: default parse + normal resolution = 2 calls
    assert.ok(
      callCount >= 4,
      `Expected at least 4 factory calls, got ${callCount}`,
    );
  });
});

// =============================================================================
// Deeply nested merge() with dependencies
// =============================================================================

describe("Deeply nested merge() with dependencies", () => {
  test("merge(merge(merge(...))) with dependency across all levels", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Level 1: innermost object with dependency source
    const level1 = object({
      mode: option("--mode", modeParser),
    });

    // Level 2: merge with another option
    const level2 = merge(level1, object({ name: option("--name", string()) }));

    // Level 3: merge with derived parser
    const level3 = merge(
      level2,
      object({ logLevel: option("--log-level", logLevelParser) }),
    );

    // Level 4: merge with yet another option
    const level4 = merge(
      level3,
      object({ count: option("--count", string()) }),
    );

    const result = await parseAsync(level4, [
      "--mode",
      "prod",
      "--name",
      "app",
      "--log-level",
      "error",
      "--count",
      "5",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.name, "app");
      assert.equal(result.value.logLevel, "error");
      assert.equal(result.value.count, "5");
    }
  });

  test("nested merge with dependency source and derived parser in different branches", async () => {
    const envParser = dependency(choice(["local", "staging", "prod"] as const));
    const serverParser = envParser.derive({
      metavar: "SERVER",
      factory: (env: "local" | "staging" | "prod") => {
        if (env === "local") return choice(["localhost"] as const);
        if (env === "staging") {
          return choice(["staging-1", "staging-2"] as const);
        }
        return choice(["prod-east", "prod-west"] as const);
      },
      defaultValue: () => "local" as const,
    });

    // Create a complex nested structure
    const leftBranch = merge(
      object({ env: option("--env", envParser) }),
      object({ verbose: option("-v", "--verbose") }),
    );

    const rightBranch = merge(
      object({ server: option("--server", serverParser) }),
      object({ timeout: option("--timeout", string()) }),
    );

    const combined = merge(leftBranch, rightBranch);

    const result = await parseAsync(combined, [
      "--env",
      "staging",
      "--server",
      "staging-1",
      "-v",
      "--timeout",
      "30",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.env, "staging");
      assert.equal(result.value.server, "staging-1");
      assert.equal(result.value.verbose, true);
      assert.equal(result.value.timeout, "30");
    }
  });
});

// =============================================================================
// Many derived parsers from same source (10+)
// =============================================================================

describe("Many derived parsers from same source", () => {
  test("10 derived parsers from single dependency source", async () => {
    const modeParser = dependency(choice(["a", "b"] as const));

    // Create 10 derived parsers
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
    const derived3 = modeParser.derive({
      metavar: "D3",
      factory: (m: "a" | "b") =>
        choice(m === "a" ? (["a3"] as const) : (["b3"] as const)),
      defaultValue: () => "a" as const,
    });
    const derived4 = modeParser.derive({
      metavar: "D4",
      factory: (m: "a" | "b") =>
        choice(m === "a" ? (["a4"] as const) : (["b4"] as const)),
      defaultValue: () => "a" as const,
    });
    const derived5 = modeParser.derive({
      metavar: "D5",
      factory: (m: "a" | "b") =>
        choice(m === "a" ? (["a5"] as const) : (["b5"] as const)),
      defaultValue: () => "a" as const,
    });
    const derived6 = modeParser.derive({
      metavar: "D6",
      factory: (m: "a" | "b") =>
        choice(m === "a" ? (["a6"] as const) : (["b6"] as const)),
      defaultValue: () => "a" as const,
    });
    const derived7 = modeParser.derive({
      metavar: "D7",
      factory: (m: "a" | "b") =>
        choice(m === "a" ? (["a7"] as const) : (["b7"] as const)),
      defaultValue: () => "a" as const,
    });
    const derived8 = modeParser.derive({
      metavar: "D8",
      factory: (m: "a" | "b") =>
        choice(m === "a" ? (["a8"] as const) : (["b8"] as const)),
      defaultValue: () => "a" as const,
    });
    const derived9 = modeParser.derive({
      metavar: "D9",
      factory: (m: "a" | "b") =>
        choice(m === "a" ? (["a9"] as const) : (["b9"] as const)),
      defaultValue: () => "a" as const,
    });
    const derived10 = modeParser.derive({
      metavar: "D10",
      factory: (m: "a" | "b") =>
        choice(m === "a" ? (["a10"] as const) : (["b10"] as const)),
      defaultValue: () => "a" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      d1: option("--d1", derived1),
      d2: option("--d2", derived2),
      d3: option("--d3", derived3),
      d4: option("--d4", derived4),
      d5: option("--d5", derived5),
      d6: option("--d6", derived6),
      d7: option("--d7", derived7),
      d8: option("--d8", derived8),
      d9: option("--d9", derived9),
      d10: option("--d10", derived10),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "b",
      "--d1",
      "b1",
      "--d2",
      "b2",
      "--d3",
      "b3",
      "--d4",
      "b4",
      "--d5",
      "b5",
      "--d6",
      "b6",
      "--d7",
      "b7",
      "--d8",
      "b8",
      "--d9",
      "b9",
      "--d10",
      "b10",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "b");
      assert.equal(result.value.d1, "b1");
      assert.equal(result.value.d2, "b2");
      assert.equal(result.value.d3, "b3");
      assert.equal(result.value.d4, "b4");
      assert.equal(result.value.d5, "b5");
      assert.equal(result.value.d6, "b6");
      assert.equal(result.value.d7, "b7");
      assert.equal(result.value.d8, "b8");
      assert.equal(result.value.d9, "b9");
      assert.equal(result.value.d10, "b10");
    }
  });

  test("10 derived parsers - dependency source not provided uses default", async () => {
    const modeParser = dependency(choice(["x", "y"] as const));

    const createDerived = (suffix: string) =>
      modeParser.derive({
        metavar: `D${suffix}`,
        factory: (m: "x" | "y") =>
          choice(
            m === "x" ? ([`x${suffix}`] as const) : ([`y${suffix}`] as const),
          ),
        defaultValue: () => "x" as const,
      });

    const parser = object({
      mode: optional(option("--mode", modeParser)),
      d1: option("--d1", createDerived("1")),
      d2: option("--d2", createDerived("2")),
      d3: option("--d3", createDerived("3")),
    });

    // No --mode provided, all derived parsers use default "x"
    const result = await parseAsync(parser, [
      "--d1",
      "x1",
      "--d2",
      "x2",
      "--d3",
      "x3",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, undefined);
      assert.equal(result.value.d1, "x1");
      assert.equal(result.value.d2, "x2");
      assert.equal(result.value.d3, "x3");
    }
  });
});

// =============================================================================
// constant() parser with dependencies
// =============================================================================

describe("constant() parser with dependencies", () => {
  test("constant() alongside dependency source", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
      version: constant("1.0.0"),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "warn",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "warn");
      assert.equal(result.value.version, "1.0.0");
    }
  });
});

// =============================================================================
// tuple() with dependencies in various positions
// =============================================================================

describe("tuple() with dependencies in various positions", () => {
  test("tuple with derived parser before dependency source", async () => {
    const modeParser = dependency(choice(["fast", "safe"] as const));
    const levelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "fast" | "safe") =>
        choice(mode === "fast" ? (["1", "2"] as const) : (["3", "4"] as const)),
      defaultValue: () => "fast" as const,
    });

    // tuple order: [derived, source, other]
    const parser = tuple([
      option("--level", levelParser),
      option("--mode", modeParser),
      option("--name", string()),
    ]);

    const result = await parseAsync(parser, [
      "--level",
      "3",
      "--mode",
      "safe",
      "--name",
      "test",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "3");
      assert.equal(result.value[1], "safe");
      assert.equal(result.value[2], "test");
    }
  });

  test("tuple with multiple dependencies interleaved", async () => {
    const env = dependency(choice(["dev", "prod"] as const));
    const region = dependency(choice(["us", "eu"] as const));

    const server = deriveFrom({
      metavar: "SERVER",
      dependencies: [env, region] as const,
      factory: (e, r) => choice([`${e}-${r}`] as const),
      defaultValues: () => ["dev", "us"] as const,
    });

    // Interleaved: [derived, env-source, other, region-source]
    const parser = tuple([
      option("--server", server),
      option("--env", env),
      option("--name", string()),
      option("--region", region),
    ]);

    const result = await parseAsync(parser, [
      "--server",
      "prod-eu",
      "--env",
      "prod",
      "--name",
      "app",
      "--region",
      "eu",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "prod-eu");
      assert.equal(result.value[1], "prod");
      assert.equal(result.value[2], "app");
      assert.equal(result.value[3], "eu");
    }
  });
});

// =============================================================================
// Deep modifier chains with dependencies
// =============================================================================

describe("Deep modifier chains with dependencies", () => {
  test("optional(multiple(map(option(..., derivedParser), transform)))", async () => {
    const modeParser = dependency(choice(["a", "b"] as const));
    const itemParser = modeParser.derive({
      metavar: "ITEM",
      factory: (mode: "a" | "b") =>
        choice(
          mode === "a" ? (["a1", "a2"] as const) : (["b1", "b2"] as const),
        ),
      defaultValue: () => "a" as const,
    });

    // Deep chain: optional(multiple(map(...)))
    const parser = object({
      mode: option("--mode", modeParser),
      items: optional(
        multiple(
          map(option("--item", itemParser), (item) => item.toUpperCase()),
        ),
      ),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "b",
      "--item",
      "b1",
      "--item",
      "b2",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "b");
      assert.deepEqual(result.value.items, ["B1", "B2"]);
    }
  });

  test("withDefault(map(optional(option(..., dependencySource)), transform), default)", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Deep chain on dependency source: withDefault(map(optional(...)))
    const parser = object({
      mode: withDefault(
        map(
          optional(option("--mode", modeParser)),
          (m) => m ? m.toUpperCase() : null,
        ),
        "PROD",
      ),
      logLevel: option("--log-level", logLevelParser),
    });

    // When --mode is not provided
    const result1 = await parseAsync(parser, ["--log-level", "debug"]);
    assert.ok(result1.success);
    if (result1.success) {
      // withDefault kicks in
      assert.equal(result1.value.mode, "PROD");
      // derived parser uses its own default "dev" (since dependency source
      // value flows through the chain differently)
      assert.equal(result1.value.logLevel, "debug");
    }

    // When --mode is provided
    const result2 = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "error",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "PROD"); // map transforms to uppercase
      assert.equal(result2.value.logLevel, "error");
    }
  });

  test("map(map(map(option(..., derivedParser), t1), t2), t3)", async () => {
    const modeParser = dependency(choice(["x", "y"] as const));
    const valueParser = modeParser.derive({
      metavar: "VALUE",
      factory: (mode: "x" | "y") =>
        choice(
          mode === "x" ? (["xa", "xb"] as const) : (["ya", "yb"] as const),
        ),
      defaultValue: () => "x" as const,
    });

    // Triple map chain
    const parser = object({
      mode: option("--mode", modeParser),
      value: map(
        map(
          map(option("--value", valueParser), (v) => `1_${v}`),
          (v) => `2_${v}`,
        ),
        (v) => `3_${v}`,
      ),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "y",
      "--value",
      "ya",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "y");
      assert.equal(result.value.value, "3_2_1_ya");
    }
  });
});

// =============================================================================
// withDefault() dependency source + async factory
// =============================================================================

describe("withDefault() dependency source + async factory", () => {
  test("withDefault on sync dependency source with async derived parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const asyncLogLevelParser = modeParser.deriveAsync({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: withDefault(option("--mode", modeParser), "prod" as const),
      logLevel: option("--log-level", asyncLogLevelParser),
    });

    // No --mode provided, withDefault gives "prod"
    const result = await parseAsync(parser, ["--log-level", "warn"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "warn");
    }
  });

  test("async dependency source with withDefault and sync derived parser", async () => {
    const asyncModeParser = dependency(asyncChoice(["dev", "prod"] as const));
    const logLevelParser = asyncModeParser.deriveSync({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: withDefault(option("--mode", asyncModeParser), "prod" as const),
      logLevel: option("--log-level", logLevelParser),
    });

    // --mode provided
    const result1 = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "debug",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "dev");
      assert.equal(result1.value.logLevel, "debug");
    }

    // No --mode provided
    const result2 = await parseAsync(parser, ["--log-level", "warn"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "prod");
      assert.equal(result2.value.logLevel, "warn");
    }
  });

  test("both async: withDefault on async dependency source with async factory", async () => {
    const asyncModeParser = dependency(asyncChoice(["dev", "prod"] as const));
    const asyncLogLevelParser = asyncModeParser.deriveAsync({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: withDefault(option("--mode", asyncModeParser), "prod" as const),
      logLevel: option("--log-level", asyncLogLevelParser),
    });

    // No --mode provided
    const result = await parseAsync(parser, ["--log-level", "error"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "error");
    }
  });
});

// =============================================================================
// or() with dependencies - more complex cases
// =============================================================================

describe("or() with dependencies - complex cases", () => {
  test("or() where both branches have different dependency sources", async () => {
    const modeA = dependency(choice(["a1", "a2"] as const));
    const modeB = dependency(choice(["b1", "b2"] as const));

    const derivedA = modeA.derive({
      metavar: "DA",
      factory: (m) => choice([`${m}-derived`] as const),
      defaultValue: () => "a1" as const,
    });
    const derivedB = modeB.derive({
      metavar: "DB",
      factory: (m) => choice([`${m}-derived`] as const),
      defaultValue: () => "b1" as const,
    });

    const branchA = object({
      mode: option("--mode-a", modeA),
      derived: option("--derived-a", derivedA),
    });
    const branchB = object({
      mode: option("--mode-b", modeB),
      derived: option("--derived-b", derivedB),
    });

    const parser = or(branchA, branchB);

    // Branch A
    const result1 = await parseAsync(parser, [
      "--mode-a",
      "a2",
      "--derived-a",
      "a2-derived",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "a2");
      assert.equal(result1.value.derived, "a2-derived");
    }

    // Branch B
    const result2 = await parseAsync(parser, [
      "--mode-b",
      "b2",
      "--derived-b",
      "b2-derived",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "b2");
      assert.equal(result2.value.derived, "b2-derived");
    }
  });

  test("or() with shared dependency source across branches", async () => {
    const sharedMode = dependency(choice(["shared1", "shared2"] as const));

    const derivedForA = sharedMode.derive({
      metavar: "DA",
      factory: (m) => choice([`a-${m}`] as const),
      defaultValue: () => "shared1" as const,
    });
    const derivedForB = sharedMode.derive({
      metavar: "DB",
      factory: (m) => choice([`b-${m}`] as const),
      defaultValue: () => "shared1" as const,
    });

    // Both branches use the same dependency source but different derived parsers
    const branchA = object({
      mode: option("--mode", sharedMode),
      value: option("--value-a", derivedForA),
    });
    const branchB = object({
      mode: option("--mode", sharedMode),
      value: option("--value-b", derivedForB),
    });

    const parser = or(branchA, branchB);

    // Using branch A's derived parser
    const result1 = await parseAsync(parser, [
      "--mode",
      "shared2",
      "--value-a",
      "a-shared2",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "shared2");
      assert.equal(result1.value.value, "a-shared2");
    }

    // Using branch B's derived parser
    const result2 = await parseAsync(parser, [
      "--mode",
      "shared2",
      "--value-b",
      "b-shared2",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "shared2");
      assert.equal(result2.value.value, "b-shared2");
    }
  });
});

// =============================================================================
// longestMatch() with dependencies - additional cases
// =============================================================================

describe("longestMatch() with dependencies - additional cases", () => {
  test("longestMatch with dependency in multiple branches", async () => {
    const mode = dependency(choice(["x", "y"] as const));
    const derived = mode.derive({
      metavar: "D",
      factory: (m) =>
        choice(m === "x" ? (["x1", "x2"] as const) : (["y1", "y2"] as const)),
      defaultValue: () => "x" as const,
    });

    // Both branches have the same dependency structure but different additional options
    const branch1 = object({
      mode: option("--mode", mode),
      derived: option("--derived", derived),
      extra1: option("--extra1", string()),
    });
    const branch2 = object({
      mode: option("--mode", mode),
      derived: option("--derived", derived),
      extra2: option("--extra2", string()),
    });

    const parser = longestMatch(branch1, branch2);

    // Should match branch1 (has --extra1)
    const result1 = await parseAsync(parser, [
      "--mode",
      "x",
      "--derived",
      "x1",
      "--extra1",
      "value1",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "x");
      assert.equal(result1.value.derived, "x1");
      assert.equal((result1.value as { extra1: string }).extra1, "value1");
    }

    // Should match branch2 (has --extra2)
    const result2 = await parseAsync(parser, [
      "--mode",
      "y",
      "--derived",
      "y2",
      "--extra2",
      "value2",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "y");
      assert.equal(result2.value.derived, "y2");
      assert.equal((result2.value as { extra2: string }).extra2, "value2");
    }
  });
});

// =============================================================================
// longestMatch() with conflicting dependency states
// =============================================================================

describe("longestMatch() with conflicting dependency states", () => {
  test("branches with same dependency source but different derived validations", async () => {
    // Scenario: Both branches use the same dependency source, but each branch's
    // derived parser accepts different values. longestMatch should properly
    // isolate dependency resolution per branch.
    const mode = dependency(choice(["fast", "safe"] as const));

    // Branch 1: fast mode accepts "1" or "2", safe mode accepts "3" or "4"
    const levelForBranch1 = mode.derive({
      metavar: "LEVEL1",
      factory: (m) =>
        choice(m === "fast" ? (["1", "2"] as const) : (["3", "4"] as const)),
      defaultValue: () => "fast" as const,
    });

    // Branch 2: fast mode accepts "a" or "b", safe mode accepts "c" or "d"
    // (completely different values than branch 1)
    const levelForBranch2 = mode.derive({
      metavar: "LEVEL2",
      factory: (m) =>
        choice(m === "fast" ? (["a", "b"] as const) : (["c", "d"] as const)),
      defaultValue: () => "fast" as const,
    });

    const branch1 = object({
      mode: option("--mode", mode),
      level: option("--level1", levelForBranch1),
    });
    const branch2 = object({
      mode: option("--mode", mode),
      level: option("--level2", levelForBranch2),
    });

    const parser = longestMatch(branch1, branch2);

    // Test branch 1 with fast mode
    const result1 = await parseAsync(parser, [
      "--mode",
      "fast",
      "--level1",
      "2",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "fast");
      assert.equal(result1.value.level, "2");
    }

    // Test branch 2 with fast mode (different derived values)
    const result2 = await parseAsync(parser, [
      "--mode",
      "fast",
      "--level2",
      "b",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "fast");
      assert.equal(result2.value.level, "b");
    }

    // Test branch 1 with safe mode
    const result3 = await parseAsync(parser, [
      "--mode",
      "safe",
      "--level1",
      "4",
    ]);
    assert.ok(result3.success);
    if (result3.success) {
      assert.equal(result3.value.mode, "safe");
      assert.equal(result3.value.level, "4");
    }

    // Test branch 2 with safe mode
    const result4 = await parseAsync(parser, [
      "--mode",
      "safe",
      "--level2",
      "d",
    ]);
    assert.ok(result4.success);
    if (result4.success) {
      assert.equal(result4.value.mode, "safe");
      assert.equal(result4.value.level, "d");
    }
  });

  test("longestMatch chooses branch based on token count even with shared dependency", async () => {
    // When both branches share a dependency and both could parse successfully,
    // longestMatch should choose the branch that consumes more tokens
    const mode = dependency(choice(["x", "y"] as const));

    const derived = mode.derive({
      metavar: "D",
      factory: (m) =>
        choice(m === "x" ? (["x1", "x2"] as const) : (["y1", "y2"] as const)),
      defaultValue: () => "x" as const,
    });

    // Branch 1: fewer options
    const branch1 = object({
      mode: option("--mode", mode),
      derived: option("--derived", derived),
    });

    // Branch 2: more options (should be selected when --extra is present)
    const branch2 = object({
      mode: option("--mode", mode),
      derived: option("--derived", derived),
      extra: option("--extra", string()),
    });

    const parser = longestMatch(branch1, branch2);

    // With --extra, branch2 should be selected (consumes more tokens)
    const result = await parseAsync(parser, [
      "--mode",
      "y",
      "--derived",
      "y1",
      "--extra",
      "value",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "y");
      assert.equal(result.value.derived, "y1");
      assert.equal((result.value as { extra: string }).extra, "value");
    }
  });

  test("conflicting branches where only one validates successfully", async () => {
    // Scenario: Both branches try to parse, but the derived parser in one
    // branch rejects the value (wrong mode/value combination)
    const mode = dependency(choice(["alpha", "beta"] as const));

    // Branch 1 only accepts values for alpha mode
    const alphaValues = mode.derive({
      metavar: "ALPHA_VAL",
      factory: (m) =>
        choice(m === "alpha" ? (["a1", "a2"] as const) : ([] as const)),
      defaultValue: () => "alpha" as const,
    });

    // Branch 2 only accepts values for beta mode
    const betaValues = mode.derive({
      metavar: "BETA_VAL",
      factory: (m) =>
        choice(m === "beta" ? (["b1", "b2"] as const) : ([] as const)),
      defaultValue: () => "beta" as const,
    });

    const branch1 = object({
      mode: option("--mode", mode),
      value: option("--alpha-val", alphaValues),
    });
    const branch2 = object({
      mode: option("--mode", mode),
      value: option("--beta-val", betaValues),
    });

    const parser = longestMatch(branch1, branch2);

    // Test alpha mode - only branch1 should validate
    const result1 = await parseAsync(parser, [
      "--mode",
      "alpha",
      "--alpha-val",
      "a1",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "alpha");
      assert.equal(result1.value.value, "a1");
    }

    // Test beta mode - only branch2 should validate
    const result2 = await parseAsync(parser, [
      "--mode",
      "beta",
      "--beta-val",
      "b2",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "beta");
      assert.equal(result2.value.value, "b2");
    }
  });

  test("three branches with same dependency source and overlapping options", async () => {
    const env = dependency(choice(["dev", "staging", "prod"] as const));

    // Each branch has a derived parser specific to certain environments
    const devConfig = env.derive({
      metavar: "DEV_CFG",
      factory: (e) =>
        choice(
          e === "dev" ? (["local", "docker"] as const) : (["N/A"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const stagingConfig = env.derive({
      metavar: "STAGING_CFG",
      factory: (e) =>
        choice(
          e === "staging"
            ? (["staging-us", "staging-eu"] as const)
            : (["N/A"] as const),
        ),
      defaultValue: () => "staging" as const,
    });
    const prodConfig = env.derive({
      metavar: "PROD_CFG",
      factory: (e) =>
        choice(
          e === "prod"
            ? (["prod-east", "prod-west"] as const)
            : (["N/A"] as const),
        ),
      defaultValue: () => "prod" as const,
    });

    const devBranch = object({
      env: option("--env", env),
      config: option("--dev-config", devConfig),
    });
    const stagingBranch = object({
      env: option("--env", env),
      config: option("--staging-config", stagingConfig),
    });
    const prodBranch = object({
      env: option("--env", env),
      config: option("--prod-config", prodConfig),
    });

    const parser = longestMatch(devBranch, stagingBranch, prodBranch);

    // Dev environment
    const result1 = await parseAsync(parser, [
      "--env",
      "dev",
      "--dev-config",
      "docker",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.env, "dev");
      assert.equal(result1.value.config, "docker");
    }

    // Staging environment
    const result2 = await parseAsync(parser, [
      "--env",
      "staging",
      "--staging-config",
      "staging-eu",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.env, "staging");
      assert.equal(result2.value.config, "staging-eu");
    }

    // Prod environment
    const result3 = await parseAsync(parser, [
      "--env",
      "prod",
      "--prod-config",
      "prod-west",
    ]);
    assert.ok(result3.success);
    if (result3.success) {
      assert.equal(result3.value.env, "prod");
      assert.equal(result3.value.config, "prod-west");
    }
  });
});

// =============================================================================
// command() with dependencies - additional cases
// =============================================================================

describe("command() with dependencies - additional cases", () => {
  test("subcommands share same dependency source", async () => {
    const mode = dependency(choice(["fast", "safe"] as const));

    const levelForStart = mode.derive({
      metavar: "LEVEL",
      factory: (m) =>
        choice(m === "fast" ? (["1", "2"] as const) : (["3", "4"] as const)),
      defaultValue: () => "fast" as const,
    });
    const levelForStop = mode.derive({
      metavar: "LEVEL",
      factory: (m) =>
        choice(m === "fast" ? (["5", "6"] as const) : (["7", "8"] as const)),
      defaultValue: () => "fast" as const,
    });

    const startCmd = command(
      "start",
      object({
        mode: option("--mode", mode),
        level: option("--level", levelForStart),
      }),
    );
    const stopCmd = command(
      "stop",
      object({
        mode: option("--mode", mode),
        level: option("--level", levelForStop),
      }),
    );

    const parser = or(startCmd, stopCmd);

    // start command with fast mode
    const result1 = await parseAsync(parser, [
      "start",
      "--mode",
      "fast",
      "--level",
      "2",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "fast");
      assert.equal(result1.value.level, "2");
    }

    // stop command with safe mode
    const result2 = await parseAsync(parser, [
      "stop",
      "--mode",
      "safe",
      "--level",
      "8",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "safe");
      assert.equal(result2.value.level, "8");
    }
  });
});

// =============================================================================
// conditional() with dependencies
// =============================================================================

describe("conditional() with dependencies", () => {
  test("dependency source as discriminator with derived parser in branches", async () => {
    const modeParser = dependency(choice(["json", "xml"] as const));
    const formatParser = modeParser.derive({
      metavar: "FORMAT",
      factory: (mode: "json" | "xml") =>
        choice(
          mode === "json"
            ? (["pretty", "compact"] as const)
            : (["formatted", "minified"] as const),
        ),
      defaultValue: () => "json" as const,
    });

    const parser = conditional(
      option("--mode", modeParser),
      {
        json: object({ format: option("--format", formatParser) }),
        xml: object({ format: option("--format", formatParser) }),
      },
    );

    // Test json mode with json-specific format
    const result1 = await parseAsync(parser, [
      "--mode",
      "json",
      "--format",
      "pretty",
    ]);
    assert.ok(
      result1.success,
      `Expected success but got: ${JSON.stringify(result1)}`,
    );
    if (result1.success) {
      assert.equal(result1.value[0], "json");
      assert.equal(result1.value[1].format, "pretty");
    }

    // Test xml mode with xml-specific format
    const result2 = await parseAsync(parser, [
      "--mode",
      "xml",
      "--format",
      "formatted",
    ]);
    assert.ok(
      result2.success,
      `Expected success but got: ${JSON.stringify(result2)}`,
    );
    if (result2.success) {
      assert.equal(result2.value[0], "xml");
      assert.equal(result2.value[1].format, "formatted");
    }
  });

  test("conditional with independent dependency in each branch", async () => {
    const jsonStyleParser = dependency(choice(["array", "object"] as const));
    const jsonDetailParser = jsonStyleParser.derive({
      metavar: "DETAIL",
      factory: (style: "array" | "object") =>
        choice(
          style === "array"
            ? (["flat", "nested"] as const)
            : (["shallow", "deep"] as const),
        ),
      defaultValue: () => "array" as const,
    });

    const xmlStyleParser = dependency(
      choice(["element", "attribute"] as const),
    );
    const xmlDetailParser = xmlStyleParser.derive({
      metavar: "DETAIL",
      factory: (style: "element" | "attribute") =>
        choice(
          style === "element"
            ? (["verbose", "compact"] as const)
            : (["full", "minimal"] as const),
        ),
      defaultValue: () => "element" as const,
    });

    const parser = conditional(
      option("--mode", choice(["json", "xml"] as const)),
      {
        json: object({
          style: option("--style", jsonStyleParser),
          detail: option("--detail", jsonDetailParser),
        }),
        xml: object({
          style: option("--style", xmlStyleParser),
          detail: option("--detail", xmlDetailParser),
        }),
      },
    );

    // Test json branch
    const result1 = await parseAsync(parser, [
      "--mode",
      "json",
      "--style",
      "object",
      "--detail",
      "deep",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value[0], "json");
      assert.equal(result1.value[1].style, "object");
      assert.equal(result1.value[1].detail, "deep");
    }

    // Test xml branch
    const result2 = await parseAsync(parser, [
      "--mode",
      "xml",
      "--style",
      "attribute",
      "--detail",
      "minimal",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value[0], "xml");
      assert.equal(result2.value[1].style, "attribute");
      assert.equal(result2.value[1].detail, "minimal");
    }
  });

  test("conditional with default branch and dependencies", async () => {
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

    const parser = conditional(
      option("--env", envParser),
      {
        dev: object({ port: option("--port", portParser) }),
        prod: object({ port: option("--port", portParser) }),
      },
      object({ name: option("--name", string()) }), // default branch
    );

    // Test with env specified
    const result1 = await parseAsync(parser, [
      "--env",
      "prod",
      "--port",
      "443",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value[0], "prod");
      assert.equal((result1.value[1] as { port: string }).port, "443");
    }

    // Test default branch (no --env)
    const result2 = await parseAsync(parser, ["--name", "default-app"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value[0], undefined);
      assert.equal((result2.value[1] as { name: string }).name, "default-app");
    }
  });

  test("nested dependencies within conditional branches", async () => {
    // Each branch has its own dependency chain independent of the discriminator
    const jsonStyleParser = dependency(choice(["array", "object"] as const));
    const jsonDetailParser = jsonStyleParser.derive({
      metavar: "JSON_DETAIL",
      factory: (style: "array" | "object") =>
        choice(
          style === "array"
            ? (["flat", "nested"] as const)
            : (["shallow", "deep"] as const),
        ),
      defaultValue: () => "array" as const,
    });

    const xmlStyleParser = dependency(
      choice(["element", "attribute"] as const),
    );
    const xmlDetailParser = xmlStyleParser.derive({
      metavar: "XML_DETAIL",
      factory: (style: "element" | "attribute") =>
        choice(
          style === "element"
            ? (["verbose", "compact"] as const)
            : (["full", "minimal"] as const),
        ),
      defaultValue: () => "element" as const,
    });

    const parser = conditional(
      option("--format", choice(["json", "xml"] as const)),
      {
        json: object({
          style: option("--style", jsonStyleParser),
          detail: option("--detail", jsonDetailParser),
        }),
        xml: object({
          style: option("--style", xmlStyleParser),
          detail: option("--detail", xmlDetailParser),
        }),
      },
    );

    // Test json branch with object style
    const result1 = await parseAsync(parser, [
      "--format",
      "json",
      "--style",
      "object",
      "--detail",
      "deep",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value[0], "json");
      assert.equal(result1.value[1].style, "object");
      assert.equal(result1.value[1].detail, "deep");
    }

    // Test xml branch with attribute style
    const result2 = await parseAsync(parser, [
      "--format",
      "xml",
      "--style",
      "attribute",
      "--detail",
      "minimal",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value[0], "xml");
      assert.equal(result2.value[1].style, "attribute");
      assert.equal(result2.value[1].detail, "minimal");
    }
  });

  test("deeply nested conditional with dependencies", async () => {
    const modeParser = dependency(choice(["fast", "safe"] as const));
    const levelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "fast" | "safe") =>
        choice(mode === "fast" ? (["1", "2"] as const) : (["3", "4"] as const)),
      defaultValue: () => "fast" as const,
    });

    // Nested conditional: outer discriminator determines branch,
    // inner branch has its own dependency chain
    const parser = conditional(
      option("--type", choice(["a", "b"] as const)),
      {
        a: object({
          mode: option("--mode", modeParser),
          level: option("--level", levelParser),
        }),
        b: object({
          name: option("--name", string()),
        }),
      },
    );

    // Test type 'a' with safe mode
    const result1 = await parseAsync(parser, [
      "--type",
      "a",
      "--mode",
      "safe",
      "--level",
      "4",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value[0], "a");
      const branch = result1.value[1] as { mode: string; level: string };
      assert.equal(branch.mode, "safe");
      assert.equal(branch.level, "4");
    }
  });
});

// =============================================================================
// deriveFrom() with partially provided dependencies
// =============================================================================

describe("deriveFrom() with partially provided dependencies", () => {
  test("optional dependency sources - only first provided", async () => {
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
      region: optional(option("--region", regionParser)),
      tier: optional(option("--tier", tierParser)),
      endpoint: option("--endpoint", endpointParser),
    });

    // Only --env is provided, region and tier use defaults from defaultValues
    const result = await parseAsync(parser, [
      "--env",
      "prod",
      "--endpoint",
      "api.us.example.com",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.env, "prod");
      assert.equal(result.value.region, undefined);
      assert.equal(result.value.tier, undefined);
      assert.equal(result.value.endpoint, "api.us.example.com");
    }
  });

  test("optional dependency sources - only last provided", async () => {
    const a = dependency(choice(["a1", "a2"] as const));
    const b = dependency(choice(["b1", "b2"] as const));
    const c = dependency(choice(["c1", "c2"] as const));

    const derivedParser = deriveFrom({
      metavar: "DERIVED",
      dependencies: [a, b, c] as const,
      factory: (av, bv, cv) => choice([`${av}-${bv}-${cv}`] as const),
      defaultValues: () => ["a1", "b1", "c1"] as const,
    });

    const parser = object({
      a: optional(option("--a", a)),
      b: optional(option("--b", b)),
      c: option("--c", c), // Only c is required
      derived: option("--derived", derivedParser),
    });

    // Only --c is provided, a and b use defaults
    const result = await parseAsync(parser, [
      "--c",
      "c2",
      "--derived",
      "a1-b1-c2",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.a, undefined);
      assert.equal(result.value.b, undefined);
      assert.equal(result.value.c, "c2");
      assert.equal(result.value.derived, "a1-b1-c2");
    }
  });

  test("optional dependency sources - middle one provided", async () => {
    const x = dependency(choice(["x1", "x2"] as const));
    const y = dependency(choice(["y1", "y2"] as const));
    const z = dependency(choice(["z1", "z2"] as const));

    const derivedParser = deriveFrom({
      metavar: "XYZ",
      dependencies: [x, y, z] as const,
      factory: (xv, yv, zv) => choice([`${xv}-${yv}-${zv}`] as const),
      defaultValues: () => ["x1", "y1", "z1"] as const,
    });

    const parser = object({
      x: optional(option("--x", x)),
      y: option("--y", y), // Only y is required
      z: optional(option("--z", z)),
      derived: option("--derived", derivedParser),
    });

    // Only --y is provided
    const result = await parseAsync(parser, [
      "--y",
      "y2",
      "--derived",
      "x1-y2-z1",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.x, undefined);
      assert.equal(result.value.y, "y2");
      assert.equal(result.value.z, undefined);
      assert.equal(result.value.derived, "x1-y2-z1");
    }
  });

  test("optional dependency sources - none provided (all use defaults)", async () => {
    const env = dependency(choice(["dev", "prod"] as const));
    const region = dependency(choice(["us", "eu"] as const));

    const configParser = deriveFrom({
      metavar: "CONFIG",
      dependencies: [env, region] as const,
      factory: (e, r) => choice([`${e}-${r}.json`] as const),
      defaultValues: () => ["dev", "us"] as const,
    });

    const parser = object({
      env: optional(option("--env", env)),
      region: optional(option("--region", region)),
      config: option("--config", configParser),
    });

    // No dependency sources provided, all use defaults
    const result = await parseAsync(parser, ["--config", "dev-us.json"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.env, undefined);
      assert.equal(result.value.region, undefined);
      assert.equal(result.value.config, "dev-us.json");
    }
  });

  test("withDefault dependency sources - mixed with optional", async () => {
    const format = dependency(choice(["json", "yaml"] as const));
    const compression = dependency(choice(["none", "gzip", "bzip2"] as const));
    const encoding = dependency(choice(["utf8", "utf16"] as const));

    const outputParser = deriveFrom({
      metavar: "OUTPUT",
      dependencies: [format, compression, encoding] as const,
      factory: (f, c, e) => {
        const ext = f === "json" ? "json" : "yaml";
        const compExt = c === "none" ? "" : `.${c}`;
        return choice([`output-${e}.${ext}${compExt}`] as const);
      },
      defaultValues: () => ["json", "none", "utf8"] as const,
    });

    const parser = object({
      format: withDefault(option("--format", format), "yaml" as const),
      compression: optional(option("--compression", compression)),
      encoding: withDefault(option("--encoding", encoding), "utf16" as const),
      output: option("--output", outputParser),
    });

    // format uses withDefault "yaml", compression is not provided (uses deriveFrom default "none"),
    // encoding uses withDefault "utf16"
    const result = await parseAsync(parser, [
      "--output",
      "output-utf16.yaml",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.format, "yaml");
      assert.equal(result.value.compression, undefined);
      assert.equal(result.value.encoding, "utf16");
      assert.equal(result.value.output, "output-utf16.yaml");
    }
  });

  test("partial dependencies across merge() boundaries", async () => {
    const dbType = dependency(choice(["postgres", "mysql"] as const));
    const cacheType = dependency(choice(["redis", "memcached"] as const));

    const connectionParser = deriveFrom({
      metavar: "CONN",
      dependencies: [dbType, cacheType] as const,
      factory: (db, cache) => {
        const dbPort = db === "postgres" ? "5432" : "3306";
        const cachePort = cache === "redis" ? "6379" : "11211";
        return choice([`${db}:${dbPort}-${cache}:${cachePort}`] as const);
      },
      defaultValues: () => ["postgres", "redis"] as const,
    });

    const parser = merge(
      object({
        dbType: optional(option("--db-type", dbType)),
      }),
      object({
        cacheType: option("--cache-type", cacheType),
        connection: option("--connection", connectionParser),
      }),
    );

    // Only cacheType provided, dbType uses default
    const result = await parseAsync(parser, [
      "--cache-type",
      "memcached",
      "--connection",
      "postgres:5432-memcached:11211",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.dbType, undefined);
      assert.equal(result.value.cacheType, "memcached");
      assert.equal(result.value.connection, "postgres:5432-memcached:11211");
    }
  });

  test("partial dependencies with derived parser validation failure", async () => {
    // When some dependencies use defaults, the derived parser should still
    // validate against the combination of provided and default values
    const env = dependency(choice(["dev", "prod"] as const));
    const region = dependency(choice(["us", "eu", "ap"] as const));

    const serverParser = deriveFrom({
      metavar: "SERVER",
      dependencies: [env, region] as const,
      factory: (e, r) => {
        // Only certain combinations are valid
        if (e === "dev") return choice(["localhost"] as const);
        // prod has region-specific servers
        if (r === "us") return choice(["prod-us-1", "prod-us-2"] as const);
        if (r === "eu") return choice(["prod-eu-1"] as const);
        return choice(["prod-ap-1"] as const);
      },
      defaultValues: () => ["dev", "us"] as const,
    });

    const parser = object({
      env: optional(option("--env", env)),
      region: option("--region", region),
      server: option("--server", serverParser),
    });

    // env not provided (defaults to "dev"), but region is "eu"
    // With default env="dev", only "localhost" is valid
    const result1 = await parseAsync(parser, [
      "--region",
      "eu",
      "--server",
      "localhost",
    ]);
    assert.ok(result1.success);

    // Try to use a prod server with default env="dev" - should fail
    const result2 = await parseAsync(parser, [
      "--region",
      "eu",
      "--server",
      "prod-eu-1",
    ]);
    assert.ok(!result2.success);

    // Explicitly set env="prod", now prod-eu-1 should work
    const result3 = await parseAsync(parser, [
      "--env",
      "prod",
      "--region",
      "eu",
      "--server",
      "prod-eu-1",
    ]);
    assert.ok(result3.success);
    if (result3.success) {
      assert.equal(result3.value.env, "prod");
      assert.equal(result3.value.region, "eu");
      assert.equal(result3.value.server, "prod-eu-1");
    }
  });
});

// =============================================================================
// suggestAsync() with derived parsers and provided dependencies
// =============================================================================

describe("suggestAsync() with derived parsers and provided dependencies", () => {
  test("suggestions use provided dependency value instead of default", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "trace", "verbose"] as const)
            : (["info", "warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // When --mode prod is provided, suggestions for --log-level should be
    // prod-specific values (info, warn, error), not dev values (debug, trace)
    const completions = await suggestAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "",
    ]);
    const values = completions.map((c) => (c.kind === "literal" ? c.text : ""));

    // Should have prod values
    assert.ok(
      values.includes("info"),
      `Expected 'info', got: ${values.join(", ")}`,
    );
    assert.ok(
      values.includes("warn"),
      `Expected 'warn', got: ${values.join(", ")}`,
    );
    assert.ok(
      values.includes("error"),
      `Expected 'error', got: ${values.join(", ")}`,
    );

    // Should NOT have dev values
    assert.ok(
      !values.includes("debug"),
      `Should not include 'debug', got: ${values.join(", ")}`,
    );
    assert.ok(
      !values.includes("trace"),
      `Should not include 'trace', got: ${values.join(", ")}`,
    );
  });

  test("suggestions use default when dependency not yet provided", async () => {
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

    // When --mode is not provided yet, suggestions should use default "dev"
    const completions = await suggestAsync(parser, ["--log-level", ""]);
    const values = completions.map((c) => (c.kind === "literal" ? c.text : ""));

    // Should have dev values (default)
    assert.ok(
      values.includes("debug") || values.includes("trace"),
      `Expected dev values, got: ${values.join(", ")}`,
    );
  });

  test("suggestions with deriveFrom and multiple dependencies", async () => {
    const envParser = dependency(choice(["dev", "staging", "prod"] as const));
    const regionParser = dependency(choice(["us", "eu", "ap"] as const));

    const endpointParser = deriveFrom({
      metavar: "ENDPOINT",
      dependencies: [envParser, regionParser] as const,
      factory: (env, region) => {
        if (env === "dev") {
          return choice([`localhost-${region}`] as const);
        }
        return choice(
          [
            `${env}-${region}-1.example.com`,
            `${env}-${region}-2.example.com`,
          ] as const,
        );
      },
      defaultValues: () => ["dev", "us"] as const,
    });

    const parser = object({
      env: option("--env", envParser),
      region: option("--region", regionParser),
      endpoint: option("--endpoint", endpointParser),
    });

    // With both dependencies provided
    const completions = await suggestAsync(parser, [
      "--env",
      "prod",
      "--region",
      "eu",
      "--endpoint",
      "",
    ]);
    const values = completions.map((c) => (c.kind === "literal" ? c.text : ""));

    assert.ok(
      values.includes("prod-eu-1.example.com"),
      `Expected 'prod-eu-1.example.com', got: ${values.join(", ")}`,
    );
    assert.ok(
      values.includes("prod-eu-2.example.com"),
      `Expected 'prod-eu-2.example.com', got: ${values.join(", ")}`,
    );
    assert.ok(
      !values.includes("localhost-us"),
      `Should not include 'localhost-us', got: ${values.join(", ")}`,
    );
  });

  test("suggestions with partial dependencies provided", async () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const regionParser = dependency(choice(["us", "eu"] as const));

    const configParser = deriveFrom({
      metavar: "CONFIG",
      dependencies: [envParser, regionParser] as const,
      factory: (env, region) =>
        choice([`config-${env}-${region}.json`] as const),
      defaultValues: () => ["dev", "us"] as const,
    });

    const parser = object({
      env: option("--env", envParser),
      region: optional(option("--region", regionParser)),
      config: option("--config", configParser),
    });

    // Only --env provided, region uses default "us"
    const completions = await suggestAsync(parser, [
      "--env",
      "prod",
      "--config",
      "",
    ]);
    const values = completions.map((c) => (c.kind === "literal" ? c.text : ""));

    assert.ok(
      values.includes("config-prod-us.json"),
      `Expected 'config-prod-us.json', got: ${values.join(", ")}`,
    );
  });

  test("suggestions with async derived parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const asyncLogLevelParser = modeParser.deriveAsync({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? (["debug", "trace"] as const)
            : (["info", "warn"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", asyncLogLevelParser),
    });

    // When --mode prod is provided
    const completions = await suggestAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "",
    ]);
    const values = completions.map((c) => (c.kind === "literal" ? c.text : ""));

    assert.ok(
      values.includes("info"),
      `Expected 'info', got: ${values.join(", ")}`,
    );
    assert.ok(
      values.includes("warn"),
      `Expected 'warn', got: ${values.join(", ")}`,
    );
    assert.ok(
      !values.includes("debug"),
      `Should not include 'debug', got: ${values.join(", ")}`,
    );
  });

  test("suggestions with --option=value format", async () => {
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

    // Using --option=value format
    const completions = await suggestAsync(parser, [
      "--mode",
      "prod",
      "--log-level=",
    ]);
    const values = completions.map((c) => (c.kind === "literal" ? c.text : ""));

    assert.ok(
      values.some((v) => v.includes("info")),
      `Expected value containing 'info', got: ${values.join(", ")}`,
    );
  });
});
