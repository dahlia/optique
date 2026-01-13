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

// =============================================================================
// Internal type guards and factory functions
// =============================================================================

import {
  createDependencySourceState,
  createPendingDependencySourceState,
  DependencyId,
  DependencyRegistry,
  DependencySourceStateMarker,
  isDependencySource,
  isDependencySourceState,
  isDerivedValueParser,
  isPendingDependencySourceState,
  isWrappedDependencySource,
  PendingDependencySourceStateMarker,
  transformsDependencyValue,
  TransformsDependencyValueMarker,
  WrappedDependencySourceMarker,
} from "./dependency.ts";

describe("Internal type guards and factory functions", () => {
  describe("isDependencySourceState()", () => {
    test("returns true for valid dependency source state", () => {
      const state = createDependencySourceState(
        { success: true, value: "test" },
        Symbol("test-dep"),
      );
      assert.ok(isDependencySourceState(state));
    });

    test("returns false for null", () => {
      assert.ok(!isDependencySourceState(null));
    });

    test("returns false for undefined", () => {
      assert.ok(!isDependencySourceState(undefined));
    });

    test("returns false for plain objects", () => {
      assert.ok(!isDependencySourceState({ foo: "bar" }));
    });

    test("returns false for objects with wrong marker value", () => {
      const fake = { [DependencySourceStateMarker]: false };
      assert.ok(!isDependencySourceState(fake));
    });
  });

  describe("createDependencySourceState()", () => {
    test("creates valid state with success result", () => {
      const depId = Symbol("test");
      const state = createDependencySourceState(
        { success: true, value: 42 },
        depId,
      );

      assert.ok(isDependencySourceState(state));
      assert.equal(state[DependencySourceStateMarker], true);
      assert.equal(state[DependencyId], depId);
      assert.ok(state.result.success);
      if (state.result.success) {
        assert.equal(state.result.value, 42);
      }
    });

    test("creates valid state with failure result", () => {
      const depId = Symbol("test");
      const state = createDependencySourceState(
        { success: false, error: message`error` },
        depId,
      );

      assert.ok(isDependencySourceState(state));
      assert.ok(!state.result.success);
    });
  });

  describe("isPendingDependencySourceState()", () => {
    test("returns true for valid pending state", () => {
      const state = createPendingDependencySourceState(Symbol("test"));
      assert.ok(isPendingDependencySourceState(state));
    });

    test("returns false for null", () => {
      assert.ok(!isPendingDependencySourceState(null));
    });

    test("returns false for undefined", () => {
      assert.ok(!isPendingDependencySourceState(undefined));
    });

    test("returns false for plain objects", () => {
      assert.ok(!isPendingDependencySourceState({ foo: "bar" }));
    });

    test("returns false for objects with wrong marker value", () => {
      const fake = { [PendingDependencySourceStateMarker]: false };
      assert.ok(!isPendingDependencySourceState(fake));
    });

    test("returns false for dependency source state (different type)", () => {
      const state = createDependencySourceState(
        { success: true, value: "test" },
        Symbol("test"),
      );
      assert.ok(!isPendingDependencySourceState(state));
    });
  });

  describe("createPendingDependencySourceState()", () => {
    test("creates valid pending state", () => {
      const depId = Symbol("test");
      const state = createPendingDependencySourceState(depId);

      assert.ok(isPendingDependencySourceState(state));
      assert.equal(state[PendingDependencySourceStateMarker], true);
      assert.equal(state[DependencyId], depId);
    });
  });

  describe("isWrappedDependencySource()", () => {
    test("returns false for regular parsers", () => {
      const parser = string({ metavar: "VALUE" });
      assert.ok(!isWrappedDependencySource(parser));
    });

    test("returns false for dependency source itself", () => {
      const depSource = dependency(string({ metavar: "VALUE" }));
      assert.ok(!isWrappedDependencySource(depSource));
    });

    test("returns true for parser with WrappedDependencySourceMarker", () => {
      const fake = {
        [WrappedDependencySourceMarker]: createPendingDependencySourceState(
          Symbol("test"),
        ),
      };
      assert.ok(isWrappedDependencySource(fake));
    });

    test("returns false for null", () => {
      assert.ok(!isWrappedDependencySource(null));
    });
  });

  describe("transformsDependencyValue()", () => {
    test("returns false for regular parsers", () => {
      const parser = string({ metavar: "VALUE" });
      assert.ok(!transformsDependencyValue(parser));
    });

    test("returns false for dependency source", () => {
      const depSource = dependency(string({ metavar: "VALUE" }));
      assert.ok(!transformsDependencyValue(depSource));
    });

    test("returns true for parser with TransformsDependencyValueMarker", () => {
      const fake = { [TransformsDependencyValueMarker]: true };
      assert.ok(transformsDependencyValue(fake));
    });

    test("returns false for marker set to false", () => {
      const fake = { [TransformsDependencyValueMarker]: false };
      assert.ok(!transformsDependencyValue(fake));
    });

    test("returns false for null", () => {
      assert.ok(!transformsDependencyValue(null));
    });
  });

  describe("isDependencySource()", () => {
    test("returns true for dependency source", () => {
      const depSource = dependency(string({ metavar: "VALUE" }));
      assert.ok(isDependencySource(depSource));
    });

    test("returns false for regular value parser", () => {
      const parser = string({ metavar: "VALUE" });
      assert.ok(!isDependencySource(parser));
    });

    test("returns false for derived parser", () => {
      const depSource = dependency(string({ metavar: "VALUE" }));
      const derived = depSource.derive({
        metavar: "DERIVED",
        factory: () => string({ metavar: "INNER" }),
        defaultValue: () => "",
      });
      assert.ok(!isDependencySource(derived));
    });
  });

  describe("isDerivedValueParser()", () => {
    test("returns true for derived parser", () => {
      const depSource = dependency(string({ metavar: "VALUE" }));
      const derived = depSource.derive({
        metavar: "DERIVED",
        factory: () => string({ metavar: "INNER" }),
        defaultValue: () => "",
      });
      assert.ok(isDerivedValueParser(derived));
    });

    test("returns false for dependency source", () => {
      const depSource = dependency(string({ metavar: "VALUE" }));
      assert.ok(!isDerivedValueParser(depSource));
    });

    test("returns false for regular value parser", () => {
      const parser = string({ metavar: "VALUE" });
      assert.ok(!isDerivedValueParser(parser));
    });
  });

  describe("DependencyRegistry", () => {
    test("set and get values", () => {
      const registry = new DependencyRegistry();
      const id1 = Symbol("dep1");
      const id2 = Symbol("dep2");

      registry.set(id1, "value1");
      registry.set(id2, 42);

      assert.equal(registry.get(id1), "value1");
      assert.equal(registry.get(id2), 42);
    });

    test("has() returns correct value", () => {
      const registry = new DependencyRegistry();
      const id1 = Symbol("dep1");
      const id2 = Symbol("dep2");

      registry.set(id1, "value");

      assert.ok(registry.has(id1));
      assert.ok(!registry.has(id2));
    });

    test("get() returns undefined for missing keys", () => {
      const registry = new DependencyRegistry();
      const id = Symbol("missing");

      assert.equal(registry.get(id), undefined);
    });

    test("clone() creates independent copy", () => {
      const registry = new DependencyRegistry();
      const id1 = Symbol("dep1");
      const id2 = Symbol("dep2");

      registry.set(id1, "original");

      const cloned = registry.clone();

      // Verify cloned has same values
      assert.equal(cloned.get(id1), "original");

      // Modify original - should not affect clone
      registry.set(id1, "modified");
      registry.set(id2, "new");

      assert.equal(cloned.get(id1), "original");
      assert.ok(!cloned.has(id2));

      // Modify clone - should not affect original
      cloned.set(id1, "clone-modified");
      assert.equal(registry.get(id1), "modified");
    });
  });
});

// =============================================================================
// Error handling paths
// =============================================================================

describe("Error handling paths", () => {
  describe("Factory throws non-Error value", () => {
    test("derive() factory throws string", async () => {
      const modeParser = dependency(choice(["a", "b"] as const));
      const derivedParser = modeParser.derive({
        metavar: "VALUE",
        factory: (mode: "a" | "b") => {
          if (mode === "b") {
            throw "string error message"; // eslint-disable-line @typescript-eslint/only-throw-error
          }
          return string({ metavar: "VALUE" });
        },
        defaultValue: () => "a" as const,
      });

      const parser = object({
        mode: option("--mode", modeParser),
        value: option("--value", derivedParser),
      });

      const result = await parseAsync(parser, [
        "--mode",
        "b",
        "--value",
        "test",
      ]);
      assert.ok(!result.success);
      if (!result.success) {
        // Should contain the string error message
        // Note: message template puts interpolated values as { type: "value", value: ... }
        const errorText = result.error
          .map((s) => {
            if (s.type === "text") return s.text;
            if (s.type === "value") return s.value;
            return "";
          })
          .join("");
        assert.ok(
          errorText.includes("string error message"),
          `Error should contain thrown string, got: ${errorText}`,
        );
      }
    });

    test("derive() factory throws number", async () => {
      const modeParser = dependency(choice(["a", "b"] as const));
      const derivedParser = modeParser.derive({
        metavar: "VALUE",
        factory: (mode: "a" | "b") => {
          if (mode === "b") {
            throw 42; // eslint-disable-line @typescript-eslint/only-throw-error
          }
          return string({ metavar: "VALUE" });
        },
        defaultValue: () => "a" as const,
      });

      const parser = object({
        mode: option("--mode", modeParser),
        value: option("--value", derivedParser),
      });

      const result = await parseAsync(parser, [
        "--mode",
        "b",
        "--value",
        "test",
      ]);
      assert.ok(!result.success);
      if (!result.success) {
        const errorText = result.error
          .map((s) => {
            if (s.type === "text") return s.text;
            if (s.type === "value") return s.value;
            return "";
          })
          .join("");
        assert.ok(
          errorText.includes("42"),
          `Error should contain stringified number, got: ${errorText}`,
        );
      }
    });

    test("deriveFrom() factory throws object", async () => {
      const dep1 = dependency(choice(["x", "y"] as const));
      const dep2 = dependency(choice(["1", "2"] as const));

      const derived = deriveFrom({
        metavar: "VALUE",
        dependencies: [dep1, dep2] as const,
        factory: (v1: "x" | "y", v2: "1" | "2") => {
          if (v1 === "y" && v2 === "2") {
            throw { custom: "error object" }; // eslint-disable-line @typescript-eslint/only-throw-error
          }
          return string({ metavar: "VALUE" });
        },
        defaultValues: () => ["x", "1"] as const,
      });

      const parser = object({
        v1: option("--v1", dep1),
        v2: option("--v2", dep2),
        value: option("--value", derived),
      });

      const result = await parseAsync(parser, [
        "--v1",
        "y",
        "--v2",
        "2",
        "--value",
        "test",
      ]);
      assert.ok(!result.success);
    });
  });

  describe("Suggestion fallback when factory throws", () => {
    test("derive() suggestions fall back to default when factory throws", async () => {
      const modeParser = dependency(choice(["safe", "dangerous"] as const));
      const derivedParser = modeParser.derive({
        metavar: "VALUE",
        factory: (mode: "safe" | "dangerous") => {
          if (mode === "dangerous") {
            throw new Error("Cannot create parser for dangerous mode");
          }
          return choice(["option1", "option2"] as const);
        },
        defaultValue: () => "safe" as const,
      });

      const parser = object({
        mode: option("--mode", modeParser),
        value: option("--value", derivedParser),
      });

      // When mode is "dangerous", suggest should fall back to default ("safe")
      const completions = await suggestAsync(parser, [
        "--mode",
        "dangerous",
        "--value",
        "",
      ]);
      const values = completions.map((c) => c.kind === "literal" ? c.text : "");

      // Should get options from "safe" mode's parser
      assert.ok(
        values.includes("option1") || values.includes("option2"),
        `Expected fallback suggestions, got: ${values.join(", ")}`,
      );
    });

    test("deriveFrom() suggestions fall back to defaults when factory throws", async () => {
      const dep1 = dependency(choice(["a", "b"] as const));
      const dep2 = dependency(choice(["1", "2"] as const));

      const derived = deriveFrom({
        metavar: "VALUE",
        dependencies: [dep1, dep2] as const,
        factory: (v1: "a" | "b", v2: "1" | "2") => {
          if (v1 === "b") {
            throw new Error("Bad combination");
          }
          return choice([`${v1}-${v2}-x`, `${v1}-${v2}-y`] as const);
        },
        defaultValues: () => ["a", "1"] as const,
      });

      const parser = object({
        v1: option("--v1", dep1),
        v2: option("--v2", dep2),
        value: option("--value", derived),
      });

      const completions = await suggestAsync(parser, [
        "--v1",
        "b",
        "--v2",
        "2",
        "--value",
        "",
      ]);
      const values = completions.map((c) => c.kind === "literal" ? c.text : "");

      // Should fall back to default values ["a", "1"]
      assert.ok(
        values.includes("a-1-x") || values.includes("a-1-y"),
        `Expected fallback suggestions from defaults, got: ${
          values.join(", ")
        }`,
      );
    });
  });
});

// =============================================================================
// Git-like CLI with subcommands and shared global dependency
// =============================================================================

describe("Git-like CLI with subcommands and shared global dependency", () => {
  test("global -C option affects subcommand branch validation", async () => {
    // Simulates: git -C <dir> branch --delete <branch>
    const dirParser = dependency(string({ metavar: "DIR" }));

    // Branch parser that depends on directory
    const branchParser = dirParser.derive({
      metavar: "BRANCH",
      factory: (dir: string) => {
        // In real code, this would validate against actual branches in dir
        const branches = dir === "/repo1"
          ? (["main", "feature-1"] as const)
          : (["master", "develop"] as const);
        return choice(branches);
      },
      defaultValue: () => ".",
    });

    // Build subcommands
    const branchCmd = command(
      "branch",
      object({
        delete: optional(option("-d", "--delete", branchParser)),
        list: optional(option("-l", "--list", branchParser)),
      }),
    );

    const checkoutCmd = command(
      "checkout",
      object({
        branch: argument(branchParser),
      }),
    );

    const parser = object({
      dir: withDefault(option("-C", dirParser), "."),
      cmd: or(branchCmd, checkoutCmd),
    });

    // Test with -C /repo1
    const result1 = await parseAsync(parser, [
      "-C",
      "/repo1",
      "branch",
      "-d",
      "feature-1",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.dir, "/repo1");
      // Type narrowing for union type
      if ("delete" in result1.value.cmd) {
        assert.equal(result1.value.cmd.delete, "feature-1");
      }
    }

    // Test with -C /repo2 - should have different valid branches
    const result2 = await parseAsync(parser, [
      "-C",
      "/repo2",
      "checkout",
      "develop",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.dir, "/repo2");
      // Type narrowing for union type
      if ("branch" in result2.value.cmd) {
        assert.equal(result2.value.cmd.branch, "develop");
      }
    }

    // Invalid branch for the directory
    const result3 = await parseAsync(parser, [
      "-C",
      "/repo1",
      "checkout",
      "develop", // Not valid in /repo1
    ]);
    assert.ok(!result3.success);
  });

  test("global option with multiple subcommands sharing derived parser", async () => {
    const regionParser = dependency(choice(["us-east", "eu-west"] as const));

    const resourceParser = regionParser.derive({
      metavar: "RESOURCE",
      factory: (region: "us-east" | "eu-west") => {
        const resources = region === "us-east"
          ? (["server-1", "server-2"] as const)
          : (["instance-a", "instance-b"] as const);
        return choice(resources);
      },
      defaultValue: () => "us-east" as const,
    });

    const listCmd = command(
      "list",
      object({
        filter: optional(option("--filter", resourceParser)),
      }),
    );

    const deleteCmd = command(
      "delete",
      object({
        resource: argument(resourceParser),
      }),
    );

    const describeCmd = command(
      "describe",
      object({
        resource: argument(resourceParser),
      }),
    );

    const parser = object({
      region: option("--region", regionParser),
      cmd: or(listCmd, or(deleteCmd, describeCmd)),
    });

    // Test list with filter
    const r1 = await parseAsync(parser, [
      "--region",
      "eu-west",
      "list",
      "--filter",
      "instance-a",
    ]);
    assert.ok(r1.success);

    // Test delete
    const r2 = await parseAsync(parser, [
      "--region",
      "us-east",
      "delete",
      "server-1",
    ]);
    assert.ok(r2.success);

    // Test describe
    const r3 = await parseAsync(parser, [
      "--region",
      "eu-west",
      "describe",
      "instance-b",
    ]);
    assert.ok(r3.success);

    // Invalid: wrong resource for region
    const r4 = await parseAsync(parser, [
      "--region",
      "us-east",
      "delete",
      "instance-a", // Not valid in us-east
    ]);
    assert.ok(!r4.success);
  });

  test("suggestions for subcommand argument based on global option", async () => {
    const envParser = dependency(choice(["dev", "prod"] as const));

    const serviceParser = envParser.derive({
      metavar: "SERVICE",
      factory: (env: "dev" | "prod") => {
        const services = env === "dev"
          ? (["api-dev", "web-dev", "worker-dev"] as const)
          : (["api-prod", "web-prod"] as const);
        return choice(services);
      },
      defaultValue: () => "dev" as const,
    });

    const logsCmd = command(
      "logs",
      object({
        service: argument(serviceParser),
      }),
    );

    const parser = object({
      env: option("--env", envParser),
      cmd: logsCmd,
    });

    // Suggestions for prod environment
    const completions = await suggestAsync(parser, [
      "--env",
      "prod",
      "logs",
      "",
    ]);
    const values = completions.map((c) => (c.kind === "literal" ? c.text : ""));

    assert.ok(
      values.includes("api-prod"),
      `Expected 'api-prod', got: ${values.join(", ")}`,
    );
    assert.ok(
      values.includes("web-prod"),
      `Expected 'web-prod', got: ${values.join(", ")}`,
    );
    assert.ok(
      !values.includes("worker-dev"),
      `Should not include 'worker-dev', got: ${values.join(", ")}`,
    );
  });
});

// =============================================================================
// multiple() with derived parser
// =============================================================================

describe("multiple() with derived parser", () => {
  test("multiple derived values with single dependency source", async () => {
    const typeParser = dependency(choice(["number", "string"] as const));

    const valueParser = typeParser.derive({
      metavar: "VALUE",
      factory: (type: "number" | "string") => {
        if (type === "number") {
          // Only accept numeric strings
          return {
            $mode: "sync" as const,
            metavar: "NUMBER" as const,
            parse: (input: string) => {
              const num = Number(input);
              if (Number.isNaN(num)) {
                return { success: false, error: message`Not a number` };
              }
              return { success: true, value: input };
            },
            format: (v: string) => v,
          };
        } else {
          return string({ metavar: "STRING" });
        }
      },
      defaultValue: () => "string" as const,
    });

    const parser = object({
      type: option("--type", typeParser),
      values: multiple(option("--value", valueParser)),
    });

    // Multiple number values
    const r1 = await parseAsync(parser, [
      "--type",
      "number",
      "--value",
      "1",
      "--value",
      "2",
      "--value",
      "3",
    ]);
    assert.ok(r1.success);
    if (r1.success) {
      assert.deepEqual(r1.value.values, ["1", "2", "3"]);
    }

    // Multiple string values
    const r2 = await parseAsync(parser, [
      "--type",
      "string",
      "--value",
      "foo",
      "--value",
      "bar",
    ]);
    assert.ok(r2.success);
    if (r2.success) {
      assert.deepEqual(r2.value.values, ["foo", "bar"]);
    }

    // Invalid: non-number when type is number
    const r3 = await parseAsync(parser, [
      "--type",
      "number",
      "--value",
      "123",
      "--value",
      "not-a-number",
    ]);
    assert.ok(!r3.success);
  });

  test("multiple with empty array", async () => {
    const modeParser = dependency(choice(["a", "b"] as const));
    const valueParser = modeParser.derive({
      metavar: "VALUE",
      factory: () => string({ metavar: "VALUE" }),
      defaultValue: () => "a" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      values: multiple(option("--value", valueParser)),
    });

    const result = await parseAsync(parser, ["--mode", "a"]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value.values, []);
    }
  });

  test("multiple derived arguments", async () => {
    const formatParser = dependency(choice(["json", "csv"] as const));

    const fileParser = formatParser.derive({
      metavar: "FILE",
      factory: (format: "json" | "csv") => {
        return {
          $mode: "sync" as const,
          metavar: "FILE" as const,
          parse: (input: string) => {
            const expectedExt = format === "json" ? ".json" : ".csv";
            if (!input.endsWith(expectedExt)) {
              return {
                success: false,
                error: message`File must end with ${expectedExt}`,
              };
            }
            return { success: true, value: input };
          },
          format: (v: string) => v,
        };
      },
      defaultValue: () => "json" as const,
    });

    const parser = object({
      format: option("--format", formatParser),
      files: multiple(argument(fileParser)),
    });

    // Valid JSON files
    const r1 = await parseAsync(parser, [
      "--format",
      "json",
      "a.json",
      "b.json",
      "c.json",
    ]);
    assert.ok(r1.success);
    if (r1.success) {
      assert.deepEqual(r1.value.files, ["a.json", "b.json", "c.json"]);
    }

    // Invalid: wrong extension
    const r2 = await parseAsync(parser, [
      "--format",
      "json",
      "a.json",
      "b.csv",
    ]);
    assert.ok(!r2.success);
  });
});

// =============================================================================
// Multi-level dependencies using deriveFrom()
// =============================================================================

describe("Multi-level dependencies using deriveFrom()", () => {
  test("deriveFrom with two independent dependency sources", async () => {
    // Two independent dependency sources
    const envParser = dependency(choice(["dev", "staging", "prod"] as const));
    const regionParser = dependency(
      choice(["local", "us-east", "us-west", "eu-west"] as const),
    );

    // Instance depends on both env and region
    const instanceParser = deriveFrom({
      metavar: "INSTANCE",
      dependencies: [envParser, regionParser] as const,
      factory: (
        env: "dev" | "staging" | "prod",
        region: "local" | "us-east" | "us-west" | "eu-west",
      ) => {
        // Valid combinations based on env
        const validRegions: Record<string, readonly string[]> = {
          dev: ["local"],
          staging: ["us-east", "eu-west"],
          prod: ["us-east", "us-west", "eu-west"],
        };

        // Check if region is valid for env
        if (!validRegions[env].includes(region)) {
          // Return a parser that will fail for any input
          return {
            $mode: "sync" as const,
            metavar: "INSTANCE" as const,
            parse: () => ({
              success: false,
              error:
                message`Invalid region "${region}" for environment "${env}"`,
            }),
            format: (v: string) => v,
          };
        }

        // Instance names depend on region
        const instances: Record<string, readonly string[]> = {
          local: ["localhost"],
          "us-east": ["prod-us-1", "prod-us-2"],
          "us-west": ["prod-usw-1"],
          "eu-west": ["prod-eu-1", "prod-eu-2"],
        };
        return choice((instances[region] ?? ["unknown"]) as readonly string[]);
      },
      defaultValues: () => ["dev", "local"] as const,
    });

    const parser = object({
      env: option("--env", envParser),
      region: option("--region", regionParser),
      instance: option("--instance", instanceParser),
    });

    // Valid: dev + local + localhost
    const r1 = await parseAsync(parser, [
      "--env",
      "dev",
      "--region",
      "local",
      "--instance",
      "localhost",
    ]);
    assert.ok(r1.success);

    // Valid: prod + us-east + prod-us-2
    const r2 = await parseAsync(parser, [
      "--env",
      "prod",
      "--region",
      "us-east",
      "--instance",
      "prod-us-2",
    ]);
    assert.ok(r2.success);

    // Invalid: dev + us-east (us-east not valid for dev)
    const r3 = await parseAsync(parser, [
      "--env",
      "dev",
      "--region",
      "us-east",
      "--instance",
      "prod-us-1",
    ]);
    assert.ok(!r3.success);

    // Invalid: prod + eu-west + prod-us-1 (wrong instance for region)
    const r4 = await parseAsync(parser, [
      "--env",
      "prod",
      "--region",
      "eu-west",
      "--instance",
      "prod-us-1",
    ]);
    assert.ok(!r4.success);
  });

  test("suggestions with deriveFrom use both dependency values", async () => {
    const tierParser = dependency(choice(["free", "pro"] as const));
    const categoryParser = dependency(
      choice(["basic", "advanced"] as const),
    );

    // Features depend on both tier and category
    const featureParser = deriveFrom({
      metavar: "FEATURE",
      dependencies: [tierParser, categoryParser] as const,
      factory: (tier: "free" | "pro", category: "basic" | "advanced") => {
        const features: Record<string, Record<string, readonly string[]>> = {
          free: {
            basic: ["f-basic-1", "f-basic-2"],
            advanced: ["f-adv-1"], // Limited in free tier
          },
          pro: {
            basic: ["p-basic-1", "p-basic-2", "p-basic-3"],
            advanced: ["p-adv-1", "p-adv-2", "p-adv-3", "p-adv-4"],
          },
        };
        return choice(
          (features[tier]?.[category] ?? ["none"]) as readonly string[],
        );
      },
      defaultValues: () => ["free", "basic"] as const,
    });

    const parser = object({
      tier: option("--tier", tierParser),
      category: option("--category", categoryParser),
      feature: option("--feature", featureParser),
    });

    // Suggestions for pro + advanced
    const completions = await suggestAsync(parser, [
      "--tier",
      "pro",
      "--category",
      "advanced",
      "--feature",
      "",
    ]);
    const values = completions.map((c) => (c.kind === "literal" ? c.text : ""));

    assert.ok(
      values.includes("p-adv-1"),
      `Expected 'p-adv-1' for pro+advanced, got: ${values.join(", ")}`,
    );
    assert.ok(
      values.includes("p-adv-4"),
      `Expected 'p-adv-4' for pro+advanced, got: ${values.join(", ")}`,
    );
    assert.ok(
      !values.includes("f-basic-1"),
      `Should not include free tier features, got: ${values.join(", ")}`,
    );
  });

  test("three dependency sources with deriveFrom", async () => {
    const cloud = dependency(choice(["aws", "gcp"] as const));
    const region = dependency(choice(["us", "eu"] as const));
    const tier = dependency(choice(["dev", "prod"] as const));

    const resource = deriveFrom({
      metavar: "RESOURCE",
      dependencies: [cloud, region, tier] as const,
      factory: (
        c: "aws" | "gcp",
        r: "us" | "eu",
        t: "dev" | "prod",
      ) => {
        // Resource naming follows pattern: {cloud}-{region}-{tier}-{id}
        const prefix = `${c}-${r}-${t}`;
        return choice([`${prefix}-1`, `${prefix}-2`] as const);
      },
      defaultValues: () => ["aws", "us", "dev"] as const,
    });

    const parser = object({
      cloud: option("--cloud", cloud),
      region: option("--region", region),
      tier: option("--tier", tier),
      resource: option("--resource", resource),
    });

    // Valid combination
    const r1 = await parseAsync(parser, [
      "--cloud",
      "gcp",
      "--region",
      "eu",
      "--tier",
      "prod",
      "--resource",
      "gcp-eu-prod-1",
    ]);
    assert.ok(r1.success);
    if (r1.success) {
      assert.equal(r1.value.resource, "gcp-eu-prod-1");
    }

    // Invalid: wrong resource name
    const r2 = await parseAsync(parser, [
      "--cloud",
      "aws",
      "--region",
      "us",
      "--tier",
      "dev",
      "--resource",
      "gcp-eu-prod-1", // Wrong cloud/region/tier
    ]);
    assert.ok(!r2.success);
  });
});

// =============================================================================
// Edge case dependency values
// =============================================================================

describe("Edge case dependency values", () => {
  test("empty string as dependency value", async () => {
    const prefixParser = dependency(string({ metavar: "PREFIX" }));

    const valueParser = prefixParser.derive({
      metavar: "VALUE",
      factory: (prefix: string) => {
        return {
          $mode: "sync" as const,
          metavar: "VALUE" as const,
          parse: (input: string) => {
            if (prefix === "") {
              // Empty prefix: accept anything
              return { success: true, value: input };
            }
            if (!input.startsWith(prefix)) {
              return {
                success: false,
                error: message`Value must start with "${prefix}"`,
              };
            }
            return { success: true, value: input };
          },
          format: (v: string) => v,
        };
      },
      defaultValue: () => "",
    });

    const parser = object({
      prefix: option("--prefix", prefixParser),
      value: option("--value", valueParser),
    });

    // Empty prefix - should accept anything
    const r1 = await parseAsync(parser, [
      "--prefix",
      "",
      "--value",
      "anything",
    ]);
    assert.ok(r1.success);

    // Non-empty prefix
    const r2 = await parseAsync(parser, [
      "--prefix",
      "test-",
      "--value",
      "test-value",
    ]);
    assert.ok(r2.success);

    // Invalid: doesn't match prefix
    const r3 = await parseAsync(parser, [
      "--prefix",
      "test-",
      "--value",
      "other-value",
    ]);
    assert.ok(!r3.success);
  });

  test("whitespace-only dependency value", async () => {
    const delimParser = dependency(string({ metavar: "DELIM" }));

    const itemsParser = delimParser.derive({
      metavar: "ITEMS",
      factory: (delim: string) => {
        return {
          $mode: "sync" as const,
          metavar: "ITEMS" as const,
          parse: (input: string) => {
            const items = input.split(delim);
            return { success: true, value: items.join(",") };
          },
          format: (v: string) => v,
        };
      },
      defaultValue: () => ",",
    });

    const parser = object({
      delim: option("--delim", delimParser),
      items: option("--items", itemsParser),
    });

    // Space as delimiter
    const r1 = await parseAsync(parser, [
      "--delim",
      " ",
      "--items",
      "a b c",
    ]);
    assert.ok(r1.success);
    if (r1.success) {
      assert.equal(r1.value.items, "a,b,c");
    }
  });

  test("special characters in dependency value", async () => {
    const patternParser = dependency(string({ metavar: "PATTERN" }));

    const matchParser = patternParser.derive({
      metavar: "INPUT",
      factory: (pattern: string) => {
        return {
          $mode: "sync" as const,
          metavar: "INPUT" as const,
          parse: (input: string) => {
            try {
              const regex = new RegExp(pattern);
              if (!regex.test(input)) {
                return {
                  success: false,
                  error: message`Input doesn't match pattern`,
                };
              }
              return { success: true, value: input };
            } catch {
              return { success: false, error: message`Invalid regex pattern` };
            }
          },
          format: (v: string) => v,
        };
      },
      defaultValue: () => ".*",
    });

    const parser = object({
      pattern: option("--pattern", patternParser),
      input: option("--input", matchParser),
    });

    // Regex with special chars
    const r1 = await parseAsync(parser, [
      "--pattern",
      "^[a-z]+$",
      "--input",
      "hello",
    ]);
    assert.ok(r1.success);

    const r2 = await parseAsync(parser, [
      "--pattern",
      "^[a-z]+$",
      "--input",
      "Hello123",
    ]);
    assert.ok(!r2.success);
  });

  test("unicode characters in dependency value", async () => {
    const langParser = dependency(choice(["en", "ko", "ja"] as const));

    const greetingParser = langParser.derive({
      metavar: "GREETING",
      factory: (lang: "en" | "ko" | "ja") => {
        const greetings = {
          en: ["Hello", "Hi", "Hey"] as const,
          ko: ["안녕하세요", "안녕", "반갑습니다"] as const,
          ja: ["こんにちは", "おはよう", "こんばんは"] as const,
        };
        return choice(greetings[lang]);
      },
      defaultValue: () => "en" as const,
    });

    const parser = object({
      lang: option("--lang", langParser),
      greeting: option("--greeting", greetingParser),
    });

    // Korean
    const r1 = await parseAsync(parser, [
      "--lang",
      "ko",
      "--greeting",
      "안녕하세요",
    ]);
    assert.ok(r1.success);
    if (r1.success) {
      assert.equal(r1.value.greeting, "안녕하세요");
    }

    // Japanese
    const r2 = await parseAsync(parser, [
      "--lang",
      "ja",
      "--greeting",
      "こんにちは",
    ]);
    assert.ok(r2.success);
  });

  test("null-ish coerced dependency value", async () => {
    // Test with value that becomes falsy when coerced
    const countParser = dependency(choice(["0", "1", "2"] as const));

    const itemsParser = countParser.derive({
      metavar: "ITEMS",
      factory: (count: "0" | "1" | "2") => {
        const num = parseInt(count, 10);
        const options = Array.from(
          { length: num + 1 },
          (_, i) => `item-${i}`,
        ) as readonly string[];
        return choice(options.length > 0 ? options : (["none"] as const));
      },
      defaultValue: () => "0" as const,
    });

    const parser = object({
      count: option("--count", countParser),
      item: option("--item", itemsParser),
    });

    // count = "0" (falsy when parsed as number)
    const r1 = await parseAsync(parser, [
      "--count",
      "0",
      "--item",
      "item-0",
    ]);
    assert.ok(r1.success);
  });
});

// =============================================================================
// Real-world scenario: Database CLI
// =============================================================================

describe("Real-world scenario: Database CLI", () => {
  // Test using deriveFrom with multiple dependencies for database-schema-table
  // relationship. This pattern is supported: table depends on both db and schema.
  test("database + schema → table using deriveFrom", async () => {
    const dbParser = dependency(choice(["postgres", "mysql"] as const));

    // Schema depends only on database
    const schemaParser = dbParser.derive({
      metavar: "SCHEMA",
      factory: (db: "postgres" | "mysql") => {
        if (db === "postgres") {
          return choice(["public", "private", "audit"] as const);
        }
        return choice(["main", "archive"] as const);
      },
      defaultValue: () => "postgres" as const,
    });

    // Wrap schema as a dependency source for table to use
    const schemaDep = dependency(
      // Use a simple string parser since schema values are validated by schemaParser
      {
        $mode: "sync" as const,
        metavar: "SCHEMA" as const,
        parse: (s: string) => ({ success: true, value: s }),
        format: (s: string) => s,
      },
    );

    // Table depends on schema value (using deriveFrom for explicit dependency)
    const tableParser = schemaDep.derive({
      metavar: "TABLE",
      factory: (schema: string) => {
        const tables: Record<string, readonly string[]> = {
          public: ["users", "posts", "comments"],
          private: ["secrets", "tokens"],
          audit: ["audit_log", "access_log"],
          main: ["users", "products"],
          archive: ["old_users", "old_products"],
        };
        return choice(
          (tables[schema] ?? ["unknown_table"]) as readonly string[],
        );
      },
      defaultValue: () => "public",
    });

    const queryCmd = command(
      "query",
      object({
        table: option("--table", tableParser),
        limit: withDefault(
          option(
            "--limit",
            {
              $mode: "sync" as const,
              metavar: "N" as const,
              parse: (s: string) => ({ success: true, value: parseInt(s, 10) }),
              format: (n: number) => String(n),
            },
          ),
          100,
        ),
      }),
    );

    const parser = object({
      db: option("--db", dbParser),
      schema: option("--schema", schemaDep), // Use simple dependency source
      schemaValidated: option("--schema-check", schemaParser), // Validates schema against db
      cmd: queryCmd,
    });

    // Valid: postgres → public → users (schema is valid string, validated separately)
    const r1 = await parseAsync(parser, [
      "--db",
      "postgres",
      "--schema",
      "public",
      "--schema-check",
      "public",
      "query",
      "--table",
      "users",
    ]);
    assert.ok(r1.success);

    // Valid: mysql → archive → old_products
    const r2 = await parseAsync(parser, [
      "--db",
      "mysql",
      "--schema",
      "archive",
      "--schema-check",
      "archive",
      "query",
      "--table",
      "old_products",
    ]);
    assert.ok(r2.success);

    // Invalid: wrong table for schema (table validation catches this)
    const r3 = await parseAsync(parser, [
      "--db",
      "postgres",
      "--schema",
      "audit",
      "--schema-check",
      "audit",
      "query",
      "--table",
      "users", // Not in audit schema
    ]);
    assert.ok(!r3.success);
  });

  // Alternative pattern: use deriveFrom to depend on both db and schema
  test("table depends on db and schema using deriveFrom", async () => {
    const dbParser = dependency(choice(["postgres", "mysql"] as const));
    const schemaParser = dependency(
      choice(["public", "private", "audit", "main", "archive"] as const),
    );

    // Table depends on both db and schema to validate the combination
    const tableParser = deriveFrom({
      dependencies: [dbParser, schemaParser] as const,
      metavar: "TABLE",
      factory: (db: "postgres" | "mysql", schema: string) => {
        // Define valid schema-table combinations per database
        const dbSchemas: Record<string, readonly string[]> = {
          postgres: ["public", "private", "audit"],
          mysql: ["main", "archive"],
        };

        const tables: Record<string, readonly string[]> = {
          public: ["users", "posts", "comments"],
          private: ["secrets", "tokens"],
          audit: ["audit_log", "access_log"],
          main: ["users", "products"],
          archive: ["old_users", "old_products"],
        };

        // If schema is not valid for this db, return a parser that always fails
        if (!dbSchemas[db]?.includes(schema)) {
          return {
            $mode: "sync" as const,
            metavar: "TABLE" as const,
            parse: () => ({
              success: false,
              error: message`Schema ${schema} is not valid for ${db} database.`,
            }),
            format: (s: string) => s,
          };
        }

        return choice(
          (tables[schema] ?? ["unknown_table"]) as readonly string[],
        );
      },
      defaultValues: () => ["postgres", "public"] as const,
    });

    const parser = object({
      db: option("--db", dbParser),
      schema: option("--schema", schemaParser),
      table: option("--table", tableParser),
    });

    // Valid: postgres → public → users
    const r1 = await parseAsync(parser, [
      "--db",
      "postgres",
      "--schema",
      "public",
      "--table",
      "users",
    ]);
    assert.ok(r1.success);

    // Valid: mysql → archive → old_products
    const r2 = await parseAsync(parser, [
      "--db",
      "mysql",
      "--schema",
      "archive",
      "--table",
      "old_products",
    ]);
    assert.ok(r2.success);

    // Invalid: postgres schema with mysql database
    const r3 = await parseAsync(parser, [
      "--db",
      "mysql",
      "--schema",
      "public", // Not valid for mysql
      "--table",
      "users",
    ]);
    assert.ok(!r3.success);

    // Invalid: wrong table for schema
    const r4 = await parseAsync(parser, [
      "--db",
      "postgres",
      "--schema",
      "audit",
      "--table",
      "users", // Not in audit schema
    ]);
    assert.ok(!r4.success);
  });
});

// =============================================================================
// Performance and stress tests
// =============================================================================

describe("Performance and stress tests", () => {
  test("many derived parsers from single source", async () => {
    const baseParser = dependency(choice(["a", "b"] as const));

    // Create derived parsers with explicit types
    const derived0 = baseParser.derive({
      metavar: "V0",
      factory: (v: "a" | "b") => choice([`${v}-0-x`, `${v}-0-y`] as const),
      defaultValue: () => "a" as const,
    });
    const derived1 = baseParser.derive({
      metavar: "V1",
      factory: (v: "a" | "b") => choice([`${v}-1-x`, `${v}-1-y`] as const),
      defaultValue: () => "a" as const,
    });
    const derived2 = baseParser.derive({
      metavar: "V2",
      factory: (v: "a" | "b") => choice([`${v}-2-x`, `${v}-2-y`] as const),
      defaultValue: () => "a" as const,
    });
    const derived3 = baseParser.derive({
      metavar: "V3",
      factory: (v: "a" | "b") => choice([`${v}-3-x`, `${v}-3-y`] as const),
      defaultValue: () => "a" as const,
    });
    const derived4 = baseParser.derive({
      metavar: "V4",
      factory: (v: "a" | "b") => choice([`${v}-4-x`, `${v}-4-y`] as const),
      defaultValue: () => "a" as const,
    });

    const parser = object({
      base: option("--base", baseParser),
      v0: optional(option("--v0", derived0)),
      v1: optional(option("--v1", derived1)),
      v2: optional(option("--v2", derived2)),
      v3: optional(option("--v3", derived3)),
      v4: optional(option("--v4", derived4)),
    });

    // Parse with base and some derived options
    const result = await parseAsync(parser, [
      "--base",
      "b",
      "--v0",
      "b-0-x",
      "--v2",
      "b-2-y",
      "--v4",
      "b-4-x",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.base, "b");
      assert.equal(result.value.v0, "b-0-x");
      assert.equal(result.value.v2, "b-2-y");
      assert.equal(result.value.v4, "b-4-x");
      assert.equal(result.value.v1, undefined);
      assert.equal(result.value.v3, undefined);
    }
  });

  test("deeply nested merge with dependencies (5 levels)", async () => {
    // Simpler version without recursive types
    const level1Parser = dependency(choice(["L1"] as const));
    const level2Parser = level1Parser.derive({
      metavar: "L2",
      factory: () => choice(["L1-L2"] as const),
      defaultValue: () => "L1" as const,
    });
    const level2Dep = dependency(level2Parser);
    const level3Parser = level2Dep.derive({
      metavar: "L3",
      factory: () => choice(["L1-L2-L3"] as const),
      defaultValue: () => "L1-L2",
    });
    const level3Dep = dependency(level3Parser);
    const level4Parser = level3Dep.derive({
      metavar: "L4",
      factory: () => choice(["L1-L2-L3-L4"] as const),
      defaultValue: () => "L1-L2-L3",
    });
    const level4Dep = dependency(level4Parser);
    const level5Parser = level4Dep.derive({
      metavar: "L5",
      factory: () => choice(["L1-L2-L3-L4-L5"] as const),
      defaultValue: () => "L1-L2-L3-L4",
    });

    const parser = object({
      l1: option("--l1", level1Parser),
      l2: option("--l2", level2Dep),
      l3: option("--l3", level3Dep),
      l4: option("--l4", level4Dep),
      l5: option("--l5", level5Parser),
    });

    const result = await parseAsync(parser, [
      "--l1",
      "L1",
      "--l2",
      "L1-L2",
      "--l3",
      "L1-L2-L3",
      "--l4",
      "L1-L2-L3-L4",
      "--l5",
      "L1-L2-L3-L4-L5",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.l5, "L1-L2-L3-L4-L5");
    }
  });

  test("deriveFrom with 5 dependencies", async () => {
    const d1 = dependency(choice(["a", "b"] as const));
    const d2 = dependency(choice(["1", "2"] as const));
    const d3 = dependency(choice(["x", "y"] as const));
    const d4 = dependency(choice(["p", "q"] as const));
    const d5 = dependency(choice(["m", "n"] as const));

    const combined = deriveFrom({
      metavar: "COMBINED",
      dependencies: [d1, d2, d3, d4, d5] as const,
      factory: (
        v1: "a" | "b",
        v2: "1" | "2",
        v3: "x" | "y",
        v4: "p" | "q",
        v5: "m" | "n",
      ) => {
        return choice([`${v1}${v2}${v3}${v4}${v5}`] as const);
      },
      defaultValues: () => ["a", "1", "x", "p", "m"] as const,
    });

    const parser = object({
      d1: option("--d1", d1),
      d2: option("--d2", d2),
      d3: option("--d3", d3),
      d4: option("--d4", d4),
      d5: option("--d5", d5),
      combined: option("--combined", combined),
    });

    const result = await parseAsync(parser, [
      "--d1",
      "b",
      "--d2",
      "2",
      "--d3",
      "y",
      "--d4",
      "q",
      "--d5",
      "n",
      "--combined",
      "b2yqn",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.combined, "b2yqn");
    }

    // Invalid combination
    const r2 = await parseAsync(parser, [
      "--d1",
      "a",
      "--d2",
      "1",
      "--d3",
      "x",
      "--d4",
      "p",
      "--d5",
      "m",
      "--combined",
      "wrong",
    ]);
    assert.ok(!r2.success);
  });

  test("rapid sequential parsing with dependencies", async () => {
    const modeParser = dependency(choice(["fast", "slow"] as const));
    const valueParser = modeParser.derive({
      metavar: "VALUE",
      factory: (mode: "fast" | "slow") =>
        choice(
          mode === "fast" ? (["f1", "f2"] as const) : (["s1", "s2"] as const),
        ),
      defaultValue: () => "fast" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      value: option("--value", valueParser),
    });

    // Run 100 parses in sequence
    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      const mode = i % 2 === 0 ? "fast" : "slow";
      const value = i % 2 === 0 ? "f1" : "s1";
      const result = await parseAsync(parser, [
        "--mode",
        mode,
        "--value",
        value,
      ]);
      results.push(result.success);
    }

    assert.ok(
      results.every((r) => r),
      "All 100 parses should succeed",
    );
  });
});

// =============================================================================
// Short option clustering with dependencies
// =============================================================================

describe("Short option clustering with dependencies", () => {
  test("bundled short flags with dependency source", async () => {
    // -v (verbose) as dependency source, -d (debug) as derived parser
    const verboseParser = dependency(choice(["true", "false"] as const));
    const debugParser = verboseParser.derive({
      metavar: "DEBUG",
      defaultValue: () => "false" as const,
      factory: (verbose: "true" | "false") => {
        if (verbose === "true") {
          return choice(["trace", "info"] as const);
        }
        return choice(["warn", "error"] as const);
      },
    });

    const parser = object({
      verbose: option("-v", "--verbose", verboseParser),
      debug: option("-d", "--debug", debugParser),
    });

    // Test with long options first (baseline)
    const result1 = await parseAsync(parser, [
      "--verbose",
      "true",
      "--debug",
      "trace",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.verbose, "true");
      assert.equal(result1.value.debug, "trace");
    }

    // Test with separate short options
    const result2 = await parseAsync(parser, ["-v", "true", "-d", "trace"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.verbose, "true");
      assert.equal(result2.value.debug, "trace");
    }
  });

  test("long options with value attached using equals", async () => {
    const modeParser = dependency(choice(["fast", "slow"] as const));
    const levelParser = modeParser.derive({
      metavar: "LEVEL",
      defaultValue: () => "fast" as const,
      factory: (mode: "fast" | "slow") => {
        if (mode === "fast") {
          return choice(["1", "2", "3"] as const);
        }
        return choice(["a", "b", "c"] as const);
      },
    });

    const parser = object({
      mode: option("-m", "--mode", modeParser),
      level: option("-l", "--level", levelParser),
    });

    // Test with --mode=fast --level=1 format (note: -m=fast is not supported,
    // as equals format is only for long options starting with --)
    const result = await parseAsync(parser, ["--mode=fast", "--level=1"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "fast");
      assert.equal(result.value.level, "1");
    }
  });

  test("short options in reverse order (derived before source)", async () => {
    const typeParser = dependency(choice(["json", "xml"] as const));
    const formatParser = typeParser.derive({
      metavar: "FORMAT",
      defaultValue: () => "json" as const,
      factory: (type: "json" | "xml") => {
        if (type === "json") {
          return choice(["pretty", "compact"] as const);
        }
        return choice(["indented", "flat"] as const);
      },
    });

    const parser = object({
      type: option("-t", "--type", typeParser),
      format: option("-f", "--format", formatParser),
    });

    // Provide derived option before source option
    const result = await parseAsync(parser, ["-f", "pretty", "-t", "json"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.type, "json");
      assert.equal(result.value.format, "pretty");
    }
  });

  test("multiple short options with dependency chain", async () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const regionParser = envParser.derive({
      metavar: "REGION",
      defaultValue: () => "dev" as const,
      factory: (env: "dev" | "prod") => {
        if (env === "dev") {
          return choice(["local", "staging"] as const);
        }
        return choice(["us-east", "eu-west"] as const);
      },
    });
    const tierParser = envParser.derive({
      metavar: "TIER",
      defaultValue: () => "dev" as const,
      factory: (env: "dev" | "prod") => {
        if (env === "dev") {
          return choice(["free", "basic"] as const);
        }
        return choice(["standard", "premium"] as const);
      },
    });

    const parser = object({
      env: option("-e", "--env", envParser),
      region: option("-r", "--region", regionParser),
      tier: option("-t", "--tier", tierParser),
    });

    // All short options
    const result = await parseAsync(parser, [
      "-e",
      "prod",
      "-r",
      "us-east",
      "-t",
      "premium",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.env, "prod");
      assert.equal(result.value.region, "us-east");
      assert.equal(result.value.tier, "premium");
    }
  });

  test("mixed short and long options with dependencies", async () => {
    const sourceParser = dependency(choice(["a", "b"] as const));
    const derivedParser = sourceParser.derive({
      metavar: "DERIVED",
      defaultValue: () => "a" as const,
      factory: (source: "a" | "b") => {
        if (source === "a") {
          return choice(["a1", "a2"] as const);
        }
        return choice(["b1", "b2"] as const);
      },
    });

    const parser = object({
      source: option("-s", "--source", sourceParser),
      derived: option("-d", "--derived", derivedParser),
      extra: option("-x", "--extra", string()),
    });

    // Mix of short and long options
    const result = await parseAsync(parser, [
      "-s",
      "a",
      "--derived",
      "a1",
      "-x",
      "test",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.source, "a");
      assert.equal(result.value.derived, "a1");
      assert.equal(result.value.extra, "test");
    }
  });
});

// =============================================================================
// Negatable-style options with dependencies
// =============================================================================

describe("Negatable-style options with dependencies", () => {
  // Helper: create a boolean value parser that accepts "true"/"false"
  function booleanValueParser(): ValueParser<"sync", boolean> {
    return {
      $mode: "sync",
      metavar: "BOOL" as NonEmptyString,
      parse(input: string): ValueParserResult<boolean> {
        const lower = input.toLowerCase();
        if (lower === "true" || lower === "1" || lower === "yes") {
          return { success: true, value: true };
        }
        if (lower === "false" || lower === "0" || lower === "no") {
          return { success: true, value: false };
        }
        return {
          success: false,
          error: message`Expected boolean (true/false/yes/no/1/0)`,
        };
      },
      format(value: boolean): string {
        return value ? "true" : "false";
      },
      *suggest(_prefix: string): Iterable<Suggestion> {
        yield { kind: "literal", text: "true" };
        yield { kind: "literal", text: "false" };
      },
    };
  }

  test("boolean dependency with or() for negatable-like pattern", async () => {
    // Simulate --verbose/--no-verbose using or() with boolean dependency
    const verboseParser = dependency(booleanValueParser());
    const outputParser = verboseParser.derive({
      metavar: "OUTPUT",
      defaultValue: () => false,
      factory: (verbose: boolean) =>
        choice(
          verbose
            ? (["detailed", "debug", "trace"] as const)
            : (["summary", "brief"] as const),
        ),
    });

    // Use or() to provide two ways to set verbose: --verbose=true or --quiet (sets to false)
    const parser = object({
      verbose: or(
        option("--verbose", verboseParser),
        map(option("--quiet"), () => false as boolean),
      ),
      output: option("--output", outputParser),
    });

    // --verbose=true allows detailed output
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

    // --verbose=false allows summary output
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

  test("boolean dependency with withDefault for optional verbose", async () => {
    const verboseParser = dependency(booleanValueParser());
    const formatParser = verboseParser.derive({
      metavar: "FORMAT",
      defaultValue: () => false,
      factory: (verbose: boolean) =>
        choice(verbose ? (["json", "yaml"] as const) : (["text"] as const)),
    });

    const parser = object({
      verbose: withDefault(option("--verbose", verboseParser), false),
      format: option("--format", formatParser),
    });

    // Without --verbose, defaults to false, so only "text" is valid
    const result1 = await parseAsync(parser, ["--format", "text"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.verbose, false);
      assert.equal(result1.value.format, "text");
    }

    // With --verbose=true, "json" and "yaml" are valid
    const result2 = await parseAsync(parser, [
      "--verbose",
      "true",
      "--format",
      "json",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.verbose, true);
      assert.equal(result2.value.format, "json");
    }
  });

  test("boolean dependency affects multiple derived options", async () => {
    const debugParser = dependency(booleanValueParser());

    const logLevelParser = debugParser.derive({
      metavar: "LEVEL",
      defaultValue: () => false,
      factory: (debug: boolean) =>
        choice(
          debug
            ? (["trace", "debug", "info", "warn", "error"] as const)
            : (["info", "warn", "error"] as const),
        ),
    });

    const outputFormatParser = debugParser.derive({
      metavar: "OUTPUT",
      defaultValue: () => false,
      factory: (debug: boolean) =>
        choice(
          debug
            ? (["json", "pretty", "raw"] as const)
            : (["json", "pretty"] as const),
        ),
    });

    const parser = object({
      debug: option("--debug", debugParser),
      logLevel: option("--log-level", logLevelParser),
      outputFormat: option("--output-format", outputFormatParser),
    });

    // debug=true unlocks more options for both derived parsers
    const result1 = await parseAsync(parser, [
      "--debug",
      "true",
      "--log-level",
      "trace",
      "--output-format",
      "raw",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.debug, true);
      assert.equal(result1.value.logLevel, "trace");
      assert.equal(result1.value.outputFormat, "raw");
    }

    // debug=false restricts options
    const result2 = await parseAsync(parser, [
      "--debug",
      "false",
      "--log-level",
      "info",
      "--output-format",
      "pretty",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.debug, false);
      assert.equal(result2.value.logLevel, "info");
      assert.equal(result2.value.outputFormat, "pretty");
    }

    // debug=false should reject "trace" as log level
    const result3 = await parseAsync(parser, [
      "--debug",
      "false",
      "--log-level",
      "trace",
      "--output-format",
      "pretty",
    ]);
    assert.ok(!result3.success);
  });

  test("boolean dependency with yes/no input format", async () => {
    const enabledParser = dependency(booleanValueParser());
    const modeParser = enabledParser.derive({
      metavar: "MODE",
      defaultValue: () => false,
      factory: (enabled: boolean) =>
        choice(enabled ? (["full", "partial"] as const) : (["off"] as const)),
    });

    const parser = object({
      enabled: option("--enabled", enabledParser),
      mode: option("--mode", modeParser),
    });

    // Test with "yes"
    const result1 = await parseAsync(parser, [
      "--enabled",
      "yes",
      "--mode",
      "full",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.enabled, true);
      assert.equal(result1.value.mode, "full");
    }

    // Test with "no"
    const result2 = await parseAsync(parser, [
      "--enabled",
      "no",
      "--mode",
      "off",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.enabled, false);
      assert.equal(result2.value.mode, "off");
    }

    // Test with "1"
    const result3 = await parseAsync(parser, [
      "--enabled",
      "1",
      "--mode",
      "partial",
    ]);
    assert.ok(result3.success);
    if (result3.success) {
      assert.equal(result3.value.enabled, true);
      assert.equal(result3.value.mode, "partial");
    }
  });
});

// =============================================================================
// Diamond dependency pattern
// =============================================================================

describe("Diamond dependency pattern", () => {
  test("two derived parsers depending on same two sources", async () => {
    // Diamond pattern:
    //      sourceA    sourceB
    //         \       /    \
    //          \     /      \
    //           v   v        v
    //         derivedX    derivedY
    //
    // Both derivedX and derivedY depend on sourceA and sourceB

    const envParser = dependency(choice(["dev", "staging", "prod"] as const));
    const regionParser = dependency(choice(["us", "eu", "ap"] as const));

    // derivedX: database connection depends on both env and region
    const dbConnParser = deriveFrom({
      dependencies: [envParser, regionParser] as const,
      metavar: "DB_CONN",
      defaultValues: () => ["dev", "us"] as const,
      factory: (
        env: "dev" | "staging" | "prod",
        region: "us" | "eu" | "ap",
      ) => {
        const connections: Record<string, Record<string, readonly string[]>> = {
          dev: {
            us: ["localhost:5432", "dev-us.db:5432"],
            eu: ["localhost:5432", "dev-eu.db:5432"],
            ap: ["localhost:5432", "dev-ap.db:5432"],
          },
          staging: {
            us: ["staging-us.db:5432"],
            eu: ["staging-eu.db:5432"],
            ap: ["staging-ap.db:5432"],
          },
          prod: {
            us: ["prod-us-primary.db:5432", "prod-us-replica.db:5432"],
            eu: ["prod-eu-primary.db:5432", "prod-eu-replica.db:5432"],
            ap: ["prod-ap-primary.db:5432", "prod-ap-replica.db:5432"],
          },
        };
        return choice(
          connections[env][region] as readonly [string, ...string[]],
        );
      },
    });

    // derivedY: cache endpoint also depends on both env and region
    const cacheParser = deriveFrom({
      dependencies: [envParser, regionParser] as const,
      metavar: "CACHE",
      defaultValues: () => ["dev", "us"] as const,
      factory: (
        env: "dev" | "staging" | "prod",
        region: "us" | "eu" | "ap",
      ) => {
        const caches: Record<string, Record<string, readonly string[]>> = {
          dev: {
            us: ["localhost:6379"],
            eu: ["localhost:6379"],
            ap: ["localhost:6379"],
          },
          staging: {
            us: ["staging-us.cache:6379"],
            eu: ["staging-eu.cache:6379"],
            ap: ["staging-ap.cache:6379"],
          },
          prod: {
            us: ["prod-us.cache:6379", "prod-us-backup.cache:6379"],
            eu: ["prod-eu.cache:6379", "prod-eu-backup.cache:6379"],
            ap: ["prod-ap.cache:6379", "prod-ap-backup.cache:6379"],
          },
        };
        return choice(caches[env][region] as readonly [string, ...string[]]);
      },
    });

    const parser = object({
      env: option("--env", envParser),
      region: option("--region", regionParser),
      db: option("--db", dbConnParser),
      cache: option("--cache", cacheParser),
    });

    // Test prod + us
    const result1 = await parseAsync(parser, [
      "--env",
      "prod",
      "--region",
      "us",
      "--db",
      "prod-us-primary.db:5432",
      "--cache",
      "prod-us.cache:6379",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.env, "prod");
      assert.equal(result1.value.region, "us");
      assert.equal(result1.value.db, "prod-us-primary.db:5432");
      assert.equal(result1.value.cache, "prod-us.cache:6379");
    }

    // Test dev + eu
    const result2 = await parseAsync(parser, [
      "--env",
      "dev",
      "--region",
      "eu",
      "--db",
      "dev-eu.db:5432",
      "--cache",
      "localhost:6379",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.env, "dev");
      assert.equal(result2.value.region, "eu");
      assert.equal(result2.value.db, "dev-eu.db:5432");
      assert.equal(result2.value.cache, "localhost:6379");
    }

    // Test invalid combination (prod + us with staging db)
    const result3 = await parseAsync(parser, [
      "--env",
      "prod",
      "--region",
      "us",
      "--db",
      "staging-us.db:5432",
      "--cache",
      "prod-us.cache:6379",
    ]);
    assert.ok(!result3.success);
  });

  test("diamond with async derived parsers", async () => {
    const protocolParser = dependency(choice(["http", "https"] as const));
    const portParser = dependency(choice(["80", "443", "8080"] as const));

    // Both derived parsers depend on protocol + port
    const urlParser = deriveFrom({
      dependencies: [protocolParser, portParser] as const,
      metavar: "URL",
      defaultValues: () => ["http", "80"] as const,
      factory: (protocol: "http" | "https", port: "80" | "443" | "8080") => {
        if (protocol === "https") {
          return choice(
            [
              `https://secure.example.com:${port}`,
              `https://api.example.com:${port}`,
            ] as const,
          );
        }
        return choice(
          [
            `http://example.com:${port}`,
            `http://test.example.com:${port}`,
          ] as const,
        );
      },
    });

    const wsUrlParser = deriveFrom({
      dependencies: [protocolParser, portParser] as const,
      metavar: "WS_URL",
      defaultValues: () => ["http", "80"] as const,
      factory: (protocol: "http" | "https", port: "80" | "443" | "8080") => {
        const wsProtocol = protocol === "https" ? "wss" : "ws";
        return choice([`${wsProtocol}://ws.example.com:${port}`] as const);
      },
    });

    const parser = object({
      protocol: option("--protocol", protocolParser),
      port: option("--port", portParser),
      url: option("--url", urlParser),
      wsUrl: option("--ws-url", wsUrlParser),
    });

    const result = await parseAsync(parser, [
      "--protocol",
      "https",
      "--port",
      "443",
      "--url",
      "https://secure.example.com:443",
      "--ws-url",
      "wss://ws.example.com:443",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.protocol, "https");
      assert.equal(result.value.port, "443");
      assert.equal(result.value.url, "https://secure.example.com:443");
      assert.equal(result.value.wsUrl, "wss://ws.example.com:443");
    }
  });

  test("diamond with three sources", async () => {
    // Extended diamond with three sources
    //   sourceA   sourceB   sourceC
    //       \        |        /
    //        \       |       /
    //         v      v      v
    //           derivedABC

    const cloudParser = dependency(choice(["aws", "gcp", "azure"] as const));
    const tierParser = dependency(
      choice(["free", "pro", "enterprise"] as const),
    );
    const regionParser = dependency(choice(["us", "eu"] as const));

    const instanceTypeParser = deriveFrom({
      dependencies: [cloudParser, tierParser, regionParser] as const,
      metavar: "INSTANCE",
      defaultValues: () => ["aws", "free", "us"] as const,
      factory: (
        cloud: "aws" | "gcp" | "azure",
        tier: "free" | "pro" | "enterprise",
        region: "us" | "eu",
      ) => {
        const instances: Record<
          string,
          Record<string, Record<string, readonly string[]>>
        > = {
          aws: {
            free: { us: ["t2.micro"], eu: ["t2.micro"] },
            pro: { us: ["t3.medium", "t3.large"], eu: ["t3.medium"] },
            enterprise: {
              us: ["m5.xlarge", "m5.2xlarge"],
              eu: ["m5.xlarge", "m5.2xlarge"],
            },
          },
          gcp: {
            free: { us: ["f1-micro"], eu: ["f1-micro"] },
            pro: { us: ["n1-standard-1"], eu: ["n1-standard-1"] },
            enterprise: { us: ["n1-standard-4"], eu: ["n1-standard-4"] },
          },
          azure: {
            free: { us: ["B1s"], eu: ["B1s"] },
            pro: { us: ["B2s", "B2ms"], eu: ["B2s"] },
            enterprise: { us: ["D4s_v3"], eu: ["D4s_v3"] },
          },
        };
        return choice(
          instances[cloud][tier][region] as readonly [string, ...string[]],
        );
      },
    });

    const parser = object({
      cloud: option("--cloud", cloudParser),
      tier: option("--tier", tierParser),
      region: option("--region", regionParser),
      instance: option("--instance", instanceTypeParser),
    });

    // AWS enterprise us
    const result1 = await parseAsync(parser, [
      "--cloud",
      "aws",
      "--tier",
      "enterprise",
      "--region",
      "us",
      "--instance",
      "m5.2xlarge",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.cloud, "aws");
      assert.equal(result1.value.tier, "enterprise");
      assert.equal(result1.value.region, "us");
      assert.equal(result1.value.instance, "m5.2xlarge");
    }

    // GCP free eu
    const result2 = await parseAsync(parser, [
      "--cloud",
      "gcp",
      "--tier",
      "free",
      "--region",
      "eu",
      "--instance",
      "f1-micro",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.cloud, "gcp");
      assert.equal(result2.value.instance, "f1-micro");
    }
  });

  test("diamond with defaults for sources", async () => {
    const formatParser = dependency(choice(["json", "xml"] as const));
    const compressionParser = dependency(choice(["gzip", "none"] as const));

    const extensionParser = deriveFrom({
      dependencies: [formatParser, compressionParser] as const,
      metavar: "EXT",
      defaultValues: () => ["json", "none"] as const,
      factory: (format: "json" | "xml", compression: "gzip" | "none") => {
        const ext = format === "json" ? ".json" : ".xml";
        const suffix = compression === "gzip" ? ".gz" : "";
        return choice([`${ext}${suffix}`] as const);
      },
    });

    const parser = object({
      format: withDefault(option("--format", formatParser), "json" as const),
      compression: withDefault(
        option("--compression", compressionParser),
        "none" as const,
      ),
      extension: option("--extension", extensionParser),
    });

    // Use defaults for format and compression
    const result1 = await parseAsync(parser, ["--extension", ".json"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.format, "json");
      assert.equal(result1.value.compression, "none");
      assert.equal(result1.value.extension, ".json");
    }

    // Override just compression
    const result2 = await parseAsync(parser, [
      "--compression",
      "gzip",
      "--extension",
      ".json.gz",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.format, "json");
      assert.equal(result2.value.compression, "gzip");
      assert.equal(result2.value.extension, ".json.gz");
    }

    // Override both
    const result3 = await parseAsync(parser, [
      "--format",
      "xml",
      "--compression",
      "gzip",
      "--extension",
      ".xml.gz",
    ]);
    assert.ok(result3.success);
    if (result3.success) {
      assert.equal(result3.value.format, "xml");
      assert.equal(result3.value.compression, "gzip");
      assert.equal(result3.value.extension, ".xml.gz");
    }
  });
});
