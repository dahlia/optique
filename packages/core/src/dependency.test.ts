import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import {
  createDeferredParseState,
  DeferredParseMarker,
  dependency,
  DependencyId,
  DependencyRegistry,
  DependencySourceMarker,
  DerivedValueParserMarker,
  deriveFrom,
  deriveFromAsync,
  deriveFromSync,
  formatDependencyError,
  isDeferredParseState,
  isDependencySource,
  isDerivedValueParser,
  ParseWithDependency,
} from "./dependency.ts";
import { message } from "./message.ts";
import type { NonEmptyString } from "./nonempty.ts";
import { parseAsync, parseSync, type Suggestion } from "./parser.ts";
import {
  choice,
  string,
  type ValueParser,
  type ValueParserResult,
} from "./valueparser.ts";
import { object } from "./constructs.ts";
import { option } from "./primitives.ts";
import { map, multiple, optional, withDefault } from "./modifiers.ts";

// =============================================================================
// Test Helpers: Async Value Parsers
// =============================================================================

/**
 * Creates an async string parser that transforms input to uppercase.
 * Optionally delays to simulate async operations.
 */
function _asyncString(delay = 0): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "ASYNC_STRING" as NonEmptyString,
    async parse(input: string): Promise<ValueParserResult<string>> {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return { success: true, value: input.toUpperCase() };
    },
    format(value: string): string {
      return value.toLowerCase();
    },
  };
}

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

/**
 * Creates an async parser that always fails.
 */
function asyncFailingParser(errorMsg: string): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "FAIL" as NonEmptyString,
    parse(_input: string): Promise<ValueParserResult<string>> {
      return Promise.resolve({
        success: false,
        error: message`${errorMsg}`,
      });
    },
    format(value: string): string {
      return value;
    },
  };
}

/**
 * Creates an async parser that throws/rejects.
 */
function asyncThrowingParser(errorMsg: string): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "THROW" as NonEmptyString,
    parse(_input: string): Promise<ValueParserResult<string>> {
      return Promise.reject(new Error(errorMsg));
    },
    format(value: string): string {
      return value;
    },
  };
}

describe("dependency()", () => {
  test("creates a DependencySource from a ValueParser", () => {
    const parser = string({ metavar: "DIR" });
    const source = dependency(parser);

    assert.ok(isDependencySource(source));
    assert.equal(source[DependencySourceMarker], true);
    assert.equal(typeof source[DependencyId], "symbol");
  });

  test("preserves the original parser's properties", () => {
    const parser = string({ metavar: "DIR" });
    const source = dependency(parser);

    assert.equal(source.$mode, "sync");
    assert.equal(source.metavar, "DIR");
  });

  test("preserves the original parser's parse method", () => {
    const parser = string({ metavar: "DIR" });
    const source = dependency(parser);

    const result = source.parse("/path/to/dir");
    assert.ok(result.success);
    assert.equal(result.value, "/path/to/dir");
  });

  test("preserves the original parser's format method", () => {
    const parser = string({ metavar: "DIR" });
    const source = dependency(parser);

    assert.equal(source.format("/path/to/dir"), "/path/to/dir");
  });

  test("each dependency source has a unique ID", () => {
    const parser = string({ metavar: "DIR" });
    const source1 = dependency(parser);
    const source2 = dependency(parser);

    assert.notEqual(source1[DependencyId], source2[DependencyId]);
  });
});

describe("isDependencySource()", () => {
  test("returns true for dependency sources", () => {
    const source = dependency(string({ metavar: "DIR" }));
    assert.ok(isDependencySource(source));
  });

  test("returns false for regular value parsers", () => {
    const parser = string({ metavar: "DIR" });
    assert.ok(!isDependencySource(parser));
  });
});

describe("derive()", () => {
  test("creates a DerivedValueParser", () => {
    const cwdParser = dependency(string({ metavar: "DIR" }));
    const derived = cwdParser.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    assert.ok(isDerivedValueParser(derived));
    assert.equal(derived[DerivedValueParserMarker], true);
  });

  test("derived parser has the specified metavar", () => {
    const cwdParser = dependency(string({ metavar: "DIR" }));
    const derived = cwdParser.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    assert.equal(derived.metavar, "FILE");
  });

  test("derived parser uses factory with default value for parsing", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const derived = modeParser.derive<"debug" | "verbose" | "quiet" | "silent">(
      {
        metavar: "CONFIG",
        factory: (mode: "dev" | "prod") =>
          choice(
            mode === "dev"
              ? ["debug", "verbose"] as const
              : ["quiet", "silent"] as const,
          ),
        defaultValue: () => "dev" as const,
      },
    );

    // With default value "dev", should accept "debug" or "verbose"
    const result1 = derived.parse("debug");
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value, "debug");
    }

    const result2 = derived.parse("verbose");
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value, "verbose");
    }

    // Should reject values not in the dev choices
    const result3 = derived.parse("quiet");
    assert.ok(!result3.success);
  });

  test("derived parser references source dependency ID", () => {
    const cwdParser = dependency(string({ metavar: "DIR" }));
    const derived = cwdParser.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    assert.equal(derived[DependencyId], cwdParser[DependencyId]);
  });

  test("derived parser has sync mode when source is sync", () => {
    const cwdParser = dependency(string({ metavar: "DIR" }));
    const derived = cwdParser.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    assert.equal(derived.$mode, "sync");
  });

  test("derived parser format uses factory with default value", () => {
    const cwdParser = dependency(string({ metavar: "DIR" }));
    const derived = cwdParser.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    assert.equal(derived.format("test.txt"), "test.txt");
  });
});

describe("isDerivedValueParser()", () => {
  test("returns true for derived value parsers", () => {
    const source = dependency(string({ metavar: "DIR" }));
    const derived = source.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });
    assert.ok(isDerivedValueParser(derived));
  });

  test("returns false for regular value parsers", () => {
    const parser = string({ metavar: "DIR" });
    assert.ok(!isDerivedValueParser(parser));
  });

  test("returns false for dependency sources", () => {
    const source = dependency(string({ metavar: "DIR" }));
    assert.ok(!isDerivedValueParser(source));
  });
});

describe("deriveFrom()", () => {
  test("creates a DerivedValueParser from multiple dependencies", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (dir: string, mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? [`${dir}/dev.json`, `${dir}/dev.yaml`]
            : [`${dir}/prod.json`, `${dir}/prod.yaml`],
        ),
      defaultValues: () => ["/config", "dev"] as const,
    });

    assert.ok(isDerivedValueParser(derived));
    assert.equal(derived.metavar, "CONFIG");
  });

  test("derived parser uses factory with default values for parsing", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "dev" | "prod") =>
        choice(mode === "dev" ? ["debug", "verbose"] : ["quiet", "silent"]),
      defaultValues: () => ["/config", "dev"] as const,
    });

    // With default mode "dev", should accept "debug" or "verbose"
    const result1 = derived.parse("debug");
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value, "debug");
    }

    const result2 = derived.parse("quiet");
    assert.ok(!result2.success);
  });

  test("derived parser has sync mode when all sources are sync", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, _mode: "dev" | "prod") =>
        string({ metavar: "CONFIG" }),
      defaultValues: () => ["/config", "dev"] as const,
    });

    assert.equal(derived.$mode, "sync");
  });
});

describe("nested dependency prevention", () => {
  test("DerivedValueParser does not have derive method", () => {
    const source = dependency(string({ metavar: "DIR" }));
    const derived = source.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    // TypeScript should prevent this at compile time, but we also verify at runtime
    // that DerivedValueParser does not have the derive method
    assert.ok(!("derive" in derived));
  });
});

describe("DeferredParseState", () => {
  test("createDeferredParseState creates a valid deferred state", () => {
    const source = dependency(string({ metavar: "DIR" }));
    const derived = source.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    const preliminaryResult = derived.parse("test-input");
    const deferred = createDeferredParseState(
      "test-input",
      derived,
      preliminaryResult,
    );

    assert.ok(isDeferredParseState(deferred));
    assert.equal(deferred[DeferredParseMarker], true);
    assert.equal(deferred.rawInput, "test-input");
    assert.equal(deferred.parser, derived);
    assert.equal(deferred.dependencyId, source[DependencyId]);
    assert.deepEqual(deferred.preliminaryResult, preliminaryResult);
  });

  test("isDeferredParseState returns true for deferred states", () => {
    const source = dependency(string({ metavar: "DIR" }));
    const derived = source.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    const preliminaryResult = derived.parse("test-input");
    const deferred = createDeferredParseState(
      "test-input",
      derived,
      preliminaryResult,
    );
    assert.ok(isDeferredParseState(deferred));
  });

  test("isDeferredParseState returns false for regular objects", () => {
    assert.ok(!isDeferredParseState({}));
    assert.ok(!isDeferredParseState(null));
    assert.ok(!isDeferredParseState(undefined));
    assert.ok(!isDeferredParseState("string"));
    assert.ok(!isDeferredParseState(123));
    assert.ok(!isDeferredParseState({ success: true, value: "test" }));
  });

  test("deferred state references correct dependency ID", () => {
    const source = dependency(string({ metavar: "DIR" }));
    const derived = source.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    const preliminaryResult = derived.parse("test-input");
    const deferred = createDeferredParseState(
      "test-input",
      derived,
      preliminaryResult,
    );
    assert.equal(deferred.dependencyId, source[DependencyId]);
  });

  test("deferred state stores preliminary result", () => {
    const source = dependency(string({ metavar: "DIR" }));
    const derived = source.derive<string>({
      metavar: "FILE",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    const preliminaryResult = derived.parse("test-input");
    const deferred = createDeferredParseState(
      "test-input",
      derived,
      preliminaryResult,
    );

    // Verify the preliminary result is stored
    assert.ok(deferred.preliminaryResult.success);
    if (deferred.preliminaryResult.success) {
      assert.equal(deferred.preliminaryResult.value, "test-input");
    }
  });
});

describe("DependencyRegistry", () => {
  test("set and get store and retrieve values", () => {
    const registry = new DependencyRegistry();
    const id = Symbol("test-dep");

    registry.set(id, "test-value");
    assert.equal(registry.get(id), "test-value");
  });

  test("get returns undefined for unregistered dependencies", () => {
    const registry = new DependencyRegistry();
    const id = Symbol("test-dep");

    assert.equal(registry.get(id), undefined);
  });

  test("has returns true for registered dependencies", () => {
    const registry = new DependencyRegistry();
    const id = Symbol("test-dep");

    registry.set(id, "test-value");
    assert.ok(registry.has(id));
  });

  test("has returns false for unregistered dependencies", () => {
    const registry = new DependencyRegistry();
    const id = Symbol("test-dep");

    assert.ok(!registry.has(id));
  });

  test("clone creates an independent copy", () => {
    const registry = new DependencyRegistry();
    const id1 = Symbol("dep-1");
    const id2 = Symbol("dep-2");

    registry.set(id1, "value-1");
    const cloned = registry.clone();

    // Cloned registry has the original values
    assert.equal(cloned.get(id1), "value-1");

    // Modifying original doesn't affect clone
    registry.set(id2, "value-2");
    assert.ok(!cloned.has(id2));

    // Modifying clone doesn't affect original
    cloned.set(id1, "modified");
    assert.equal(registry.get(id1), "value-1");
    assert.equal(cloned.get(id1), "modified");
  });

  test("can store complex values", () => {
    const registry = new DependencyRegistry();
    const id = Symbol("test-dep");
    const complexValue = { nested: { data: [1, 2, 3] }, flag: true };

    registry.set(id, complexValue);
    assert.deepEqual(registry.get(id), complexValue);
  });
});

describe("formatDependencyError", () => {
  test("formats duplicate error", () => {
    const error = formatDependencyError({
      kind: "duplicate",
      dependencyId: Symbol("test"),
      locations: ["--option1", "--option2"],
    });

    assert.equal(error.length, 1);
    assert.equal(error[0].type, "text");
    assert.ok(
      (error[0] as { type: "text"; text: string }).text.includes(
        "multiple locations",
      ),
    );
    assert.ok(
      (error[0] as { type: "text"; text: string }).text.includes("--option1"),
    );
    assert.ok(
      (error[0] as { type: "text"; text: string }).text.includes("--option2"),
    );
  });

  test("formats unresolved error", () => {
    const error = formatDependencyError({
      kind: "unresolved",
      dependencyId: Symbol("test"),
      derivedParserMetavar: "BRANCH",
    });

    assert.equal(error.length, 1);
    assert.equal(error[0].type, "text");
    assert.ok(
      (error[0] as { type: "text"; text: string }).text.includes(
        "Unresolved dependency",
      ),
    );
    assert.ok(
      (error[0] as { type: "text"; text: string }).text.includes("BRANCH"),
    );
  });

  test("formats circular error", () => {
    const error = formatDependencyError({
      kind: "circular",
      cycle: [Symbol("a"), Symbol("b"), Symbol("c")],
    });

    assert.equal(error.length, 1);
    assert.equal(error[0].type, "text");
    assert.ok(
      (error[0] as { type: "text"; text: string }).text.includes(
        "Circular dependency",
      ),
    );
  });
});

describe("Integration: End-to-end dependency resolution", () => {
  test("option with DerivedValueParser uses actual dependency value from DependencySource", () => {
    // Create a dependency source for mode selection
    const modeParser = dependency(choice(["dev", "prod"] as const));

    // Create a derived parser that depends on mode
    const logLevelParser = modeParser.derive<
      "debug" | "verbose" | "quiet" | "silent"
    >({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // Create object parser combining both options
    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // Test 1: When mode is "prod", log-level should accept "quiet"
    const result1 = parseSync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "quiet",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "prod");
      assert.equal(result1.value.logLevel, "quiet");
    }

    // Test 2: When mode is "dev", log-level should accept "debug"
    const result2 = parseSync(parser, [
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

    // Test 3: Order shouldn't matter - log-level before mode
    const result3 = parseSync(parser, [
      "--log-level",
      "silent",
      "--mode",
      "prod",
    ]);
    assert.ok(result3.success);
    if (result3.success) {
      assert.equal(result3.value.mode, "prod");
      assert.equal(result3.value.logLevel, "silent");
    }

    // Test 4: When mode is "prod" but log-level tries to use "debug", it should fail
    const result4 = parseSync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "debug",
    ]);
    assert.ok(!result4.success);
  });

  test("works with option using = syntax", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive<
      "debug" | "verbose" | "quiet" | "silent"
    >({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // Test with = syntax
    const result = parseSync(parser, ["--mode=prod", "--log-level=quiet"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "quiet");
    }
  });

  test("uses default value when dependency is not provided", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive<
      "debug" | "verbose" | "quiet" | "silent"
    >({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // Parser where mode is optional
    const parser = object({
      logLevel: option("--log-level", logLevelParser),
    });

    // When mode is not provided, uses default "dev" which allows "debug"
    const result = parseSync(parser, ["--log-level", "debug"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.logLevel, "debug");
    }
  });
});

describe("ParseWithDependency", () => {
  test("derived parser can parse with actual dependency value", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const derived = modeParser.derive<"debug" | "verbose" | "quiet" | "silent">(
      {
        metavar: "LOG_LEVEL",
        factory: (mode: "dev" | "prod") =>
          choice(
            mode === "dev"
              ? ["debug", "verbose"] as const
              : ["quiet", "silent"] as const,
          ),
        defaultValue: () => "dev" as const,
      },
    );

    // With default value "dev", parse accepts "debug"
    const result1 = derived.parse("debug");
    assert.ok(result1.success);

    // With default value "dev", parse rejects "quiet"
    const result2 = derived.parse("quiet");
    assert.ok(!result2.success);

    // With ParseWithDependency and "prod", now "quiet" is valid
    const result3 = derived[ParseWithDependency]("quiet", "prod");
    // For sync parsers, result is not a Promise
    assert.ok("success" in result3 && result3.success);
    if ("value" in result3) {
      assert.equal(result3.value, "quiet");
    }

    // With ParseWithDependency and "prod", "debug" is now invalid
    const result4 = derived[ParseWithDependency]("debug", "prod");
    assert.ok("success" in result4 && !result4.success);
  });

  test("deriveFrom parser can parse with actual dependency values", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (dir: string, mode: "dev" | "prod") =>
        choice([`${dir}/${mode}.json`, `${dir}/${mode}.yaml`]),
      defaultValues: () => ["/config", "dev"] as const,
    });

    // With default values, accepts "/config/dev.json"
    const result1 = derived.parse("/config/dev.json");
    assert.ok(result1.success);

    // With default values, rejects "/custom/prod.yaml"
    const result2 = derived.parse("/custom/prod.yaml");
    assert.ok(!result2.success);

    // With ParseWithDependency and actual values, "/custom/prod.yaml" is valid
    const result3 = derived[ParseWithDependency](
      "/custom/prod.yaml",
      ["/custom", "prod"] as const,
    );
    // For sync parsers, result is not a Promise
    assert.ok("success" in result3 && result3.success);
    if ("value" in result3) {
      assert.equal(result3.value, "/custom/prod.yaml");
    }
  });
});

// =============================================================================
// Async Factory Tests
// =============================================================================

describe("derive() with async factory", () => {
  test("sync source + async factory → async derived parser", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // Derived parser should be async
    assert.equal(derived.$mode, "async");
  });

  test("async source + sync factory → async derived parser", () => {
    const modeParser = dependency(asyncChoice(["dev", "prod"] as const));

    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // Derived parser should be async (source is async)
    assert.equal(derived.$mode, "async");
  });

  test("async source + async factory → async derived parser", () => {
    const modeParser = dependency(asyncChoice(["dev", "prod"] as const));

    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    assert.equal(derived.$mode, "async");
  });

  test("async factory parse returns Promise", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const result = derived.parse("debug");
    // Result should be a Promise
    assert.ok(result instanceof Promise);

    const resolved = await result;
    assert.ok(resolved.success);
    if (resolved.success) {
      assert.equal(resolved.value, "debug");
    }
  });

  test("async factory rejects invalid input", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // "quiet" is not valid for default mode "dev"
    const result = await derived.parse("quiet");
    assert.ok(!result.success);
  });
});

describe("deriveSync()", () => {
  test("sync source + sync factory → sync derived parser", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = modeParser.deriveSync({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    assert.equal(derived.$mode, "sync");
  });

  test("async source + sync factory → async derived parser", () => {
    const modeParser = dependency(asyncChoice(["dev", "prod"] as const));

    const derived = modeParser.deriveSync({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // Even with sync factory, async source makes it async
    assert.equal(derived.$mode, "async");
  });

  test("deriveSync parse works correctly", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = modeParser.deriveSync({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const result = derived.parse("debug");
    // Sync result, not a Promise
    assert.ok(!("then" in result));
    assert.ok(result.success);
  });
});

describe("deriveAsync()", () => {
  test("sync source + async factory → async derived parser", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = modeParser.deriveAsync({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    assert.equal(derived.$mode, "async");
  });

  test("async source + async factory → async derived parser", () => {
    const modeParser = dependency(asyncChoice(["dev", "prod"] as const));

    const derived = modeParser.deriveAsync({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    assert.equal(derived.$mode, "async");
  });

  test("deriveAsync parse returns Promise and works correctly", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = modeParser.deriveAsync({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const result = await derived.parse("verbose");
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "verbose");
    }
  });
});

// =============================================================================
// deriveFrom Async Factory Tests
// =============================================================================

describe("deriveFrom() with async factory", () => {
  test("sync sources + async factory → async derived parser", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev" ? ["debug", "verbose"] : ["quiet", "silent"],
        ),
      defaultValues: () => ["/config", "dev"] as const,
    });

    assert.equal(derived.$mode, "async");
  });

  test("mixed sync/async sources + sync factory → async derived parser", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(asyncChoice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "dev" | "prod") =>
        choice(mode === "dev" ? ["debug", "verbose"] : ["quiet", "silent"]),
      defaultValues: () => ["/config", "dev"] as const,
    });

    // Even with sync factory, async source makes it async
    assert.equal(derived.$mode, "async");
  });

  test("async factory parse returns Promise", async () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev" ? ["debug", "verbose"] : ["quiet", "silent"],
        ),
      defaultValues: () => ["/config", "dev"] as const,
    });

    const result = derived.parse("debug");
    assert.ok(result instanceof Promise);

    const resolved = await result;
    assert.ok(resolved.success);
  });
});

describe("deriveFromSync()", () => {
  test("sync sources + sync factory → sync derived parser", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFromSync({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "dev" | "prod") =>
        choice(mode === "dev" ? ["debug", "verbose"] : ["quiet", "silent"]),
      defaultValues: () => ["/config", "dev"] as const,
    });

    assert.equal(derived.$mode, "sync");
  });

  test("mixed sync/async sources + sync factory → async derived parser", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(asyncChoice(["dev", "prod"] as const));

    const derived = deriveFromSync({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "dev" | "prod") =>
        choice(mode === "dev" ? ["debug", "verbose"] : ["quiet", "silent"]),
      defaultValues: () => ["/config", "dev"] as const,
    });

    // Async source makes it async even with sync factory
    assert.equal(derived.$mode, "async");
  });
});

describe("deriveFromAsync()", () => {
  test("sync sources + async factory → async derived parser", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFromAsync({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev" ? ["debug", "verbose"] : ["quiet", "silent"],
        ),
      defaultValues: () => ["/config", "dev"] as const,
    });

    assert.equal(derived.$mode, "async");
  });

  test("deriveFromAsync parse works correctly", async () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFromAsync({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev" ? ["debug", "verbose"] : ["quiet", "silent"],
        ),
      defaultValues: () => ["/config", "dev"] as const,
    });

    const result = await derived.parse("verbose");
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "verbose");
    }
  });
});

// =============================================================================
// Integration Tests: object() and parseAsync()
// =============================================================================

describe("Integration: Async derived parser with object() and parseAsync()", () => {
  test("object with async derived parser becomes async", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // The combined parser should be async
    assert.equal(parser.$mode, "async");
  });

  test("parseAsync with async derived parser works correctly", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // Test: prod mode with quiet log level
    const result1 = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "quiet",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "prod");
      assert.equal(result1.value.logLevel, "quiet");
    }

    // Test: dev mode with debug log level
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

  test("parseAsync with options in reverse order", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // Log level before mode - dependency resolution should still work
    const result = await parseAsync(parser, [
      "--log-level",
      "silent",
      "--mode",
      "prod",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "silent");
    }
  });

  test("parseAsync rejects invalid dependency combination", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // prod mode with debug (invalid - debug is only for dev)
    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "debug",
    ]);
    assert.ok(!result.success);
  });

  test("async derived parser with async source dependency", async () => {
    // Both source and factory are async
    const modeParser = dependency(asyncChoice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "quiet",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "quiet");
    }
  });
});

// =============================================================================
// Complex Combination Tests
// =============================================================================

describe("Complex combinations with async derived parser", () => {
  test("optional() with async derived parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: optional(option("--log-level", logLevelParser)),
    });

    // Without --log-level
    const result1 = await parseAsync(parser, ["--mode", "prod"]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "prod");
      assert.equal(result1.value.logLevel, undefined);
    }

    // With --log-level
    const result2 = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "quiet",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "prod");
      assert.equal(result2.value.logLevel, "quiet");
    }
  });

  test("withDefault() with async derived parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: withDefault(option("--mode", modeParser), "dev" as const),
      logLevel: withDefault(
        option("--log-level", logLevelParser),
        "debug" as "debug" | "verbose" | "quiet" | "silent",
      ),
    });

    // Both default
    const result1 = await parseAsync(parser, []);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "dev");
      assert.equal(result1.value.logLevel, "debug");
    }

    // Only mode provided
    const result2 = await parseAsync(parser, ["--mode", "prod"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, "prod");
      assert.equal(result2.value.logLevel, "debug");
    }
  });

  test("multiple() with async derived parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevels: multiple(option("--log-level", logLevelParser)),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "debug",
      "--log-level",
      "verbose",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "dev");
      assert.deepEqual(result.value.logLevels, ["debug", "verbose"]);
    }
  });

  test("map() chain with async derived parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: map(
        option("--log-level", logLevelParser),
        (level) => level.toUpperCase(),
      ),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "debug",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "dev");
      assert.equal(result.value.logLevel, "DEBUG");
    }
  });

  test("nested optional with async derived parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: optional(option("--mode", modeParser)),
      logLevel: optional(option("--log-level", logLevelParser)),
    });

    // Both optional, neither provided
    const result1 = await parseAsync(parser, []);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, undefined);
      assert.equal(result1.value.logLevel, undefined);
    }

    // Only log-level provided (uses default dependency value "dev")
    const result2 = await parseAsync(parser, ["--log-level", "debug"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.mode, undefined);
      assert.equal(result2.value.logLevel, "debug");
    }
  });
});

// =============================================================================
// Concurrency Tests
// =============================================================================

describe("Concurrency: async derived parser", () => {
  test("multiple concurrent parseAsync calls are independent", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
          5, // 5ms delay
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // Run multiple parses concurrently
    const results = await Promise.all([
      parseAsync(parser, ["--mode", "dev", "--log-level", "debug"]),
      parseAsync(parser, ["--mode", "prod", "--log-level", "quiet"]),
      parseAsync(parser, ["--mode", "dev", "--log-level", "verbose"]),
    ]);

    // All should succeed with their respective values
    assert.ok(results[0].success);
    if (results[0].success) {
      assert.equal(results[0].value.mode, "dev");
      assert.equal(results[0].value.logLevel, "debug");
    }

    assert.ok(results[1].success);
    if (results[1].success) {
      assert.equal(results[1].value.mode, "prod");
      assert.equal(results[1].value.logLevel, "quiet");
    }

    assert.ok(results[2].success);
    if (results[2].success) {
      assert.equal(results[2].value.mode, "dev");
      assert.equal(results[2].value.logLevel, "verbose");
    }
  });

  test("parser reuse produces consistent results", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // Same parser, multiple uses
    const result1 = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "debug",
    ]);
    const result2 = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "silent",
    ]);
    const result3 = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "verbose",
    ]);

    assert.ok(result1.success && result2.success && result3.success);
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("Error handling with async derived parser", () => {
  test("async factory returning failing parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const errorParser = modeParser.derive({
      metavar: "VALUE",
      factory: (_mode: "dev" | "prod") => asyncFailingParser("Always fails"),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      value: option("--value", errorParser),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--value",
      "anything",
    ]);
    assert.ok(!result.success);
  });

  test("async factory returning throwing parser propagates error", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const throwingParser = modeParser.derive({
      metavar: "VALUE",
      factory: (_mode: "dev" | "prod") =>
        asyncThrowingParser("Async parser error"),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      value: option("--value", throwingParser),
    });

    await assert.rejects(
      async () =>
        await parseAsync(parser, ["--mode", "dev", "--value", "anything"]),
      { message: "Async parser error" },
    );
  });

  test("dependency not provided uses default value correctly", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const, // Default is "dev"
    });

    // Parser without mode option
    const parser = object({
      logLevel: option("--log-level", logLevelParser),
    });

    // Should use default "dev" and accept "debug"
    const result = await parseAsync(parser, ["--log-level", "debug"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.logLevel, "debug");
    }
  });

  test("invalid value for default dependency mode fails", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const, // Default is "dev"
    });

    // Parser without mode option
    const parser = object({
      logLevel: option("--log-level", logLevelParser),
    });

    // "quiet" is only valid for prod, but default is dev
    const result = await parseAsync(parser, ["--log-level", "quiet"]);
    assert.ok(!result.success);
  });
});

// =============================================================================
// ParseWithDependency Async Tests
// =============================================================================

describe("ParseWithDependency with async derived parser", () => {
  test("async derived parser ParseWithDependency returns Promise", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // ParseWithDependency should return a Promise for async derived parser
    const result = derived[ParseWithDependency]("quiet", "prod");
    assert.ok(result instanceof Promise);

    const resolved = await result;
    assert.ok(resolved.success);
    if (resolved.success) {
      assert.equal(resolved.value, "quiet");
    }
  });

  test("ParseWithDependency with actual dependency value validates correctly", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // With "prod" dependency, "quiet" should be valid
    const result1 = await derived[ParseWithDependency]("quiet", "prod");
    assert.ok(result1.success);

    // With "prod" dependency, "debug" should be invalid
    const result2 = await derived[ParseWithDependency]("debug", "prod");
    assert.ok(!result2.success);

    // With "dev" dependency, "debug" should be valid
    const result3 = await derived[ParseWithDependency]("debug", "dev");
    assert.ok(result3.success);
  });

  test("deriveFrom async ParseWithDependency works correctly", async () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (dir: string, mode: "dev" | "prod") =>
        asyncChoice([`${dir}/${mode}.json`, `${dir}/${mode}.yaml`]),
      defaultValues: () => ["/config", "dev"] as const,
    });

    // With default values, "/config/dev.json" is valid
    const result1 = await derived.parse("/config/dev.json");
    assert.ok(result1.success);

    // With custom dependency values via ParseWithDependency
    const result2 = await derived[ParseWithDependency](
      "/custom/prod.yaml",
      ["/custom", "prod"] as const,
    );
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value, "/custom/prod.yaml");
    }
  });
});

// =============================================================================
// Suggest Tests with Async
// =============================================================================

describe("suggest() with async derived parser", () => {
  test("async derived parser suggest returns AsyncIterable", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // Should have suggest method
    assert.ok(derived.suggest !== undefined);

    // Collect suggestions
    const suggestions: Suggestion[] = [];
    for await (const suggestion of derived.suggest!("d")) {
      suggestions.push(suggestion);
    }

    // With default "dev", should suggest "debug"
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "debug"),
    );
  });

  test("async derived parser suggest uses default dependency value", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));

    // Default is "prod"
    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "prod" as const,
    });

    const suggestions: Suggestion[] = [];
    for await (const suggestion of derived.suggest!("q")) {
      suggestions.push(suggestion);
    }

    // With default "prod", should suggest "quiet"
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "quiet"),
    );
  });

  test("deriveFromAsync suggest works correctly", async () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFromAsync({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev" ? ["debug", "verbose"] : ["quiet", "silent"],
        ),
      defaultValues: () => ["/config", "dev"] as const,
    });

    const suggestions: Suggestion[] = [];
    for await (const suggestion of derived.suggest!("v")) {
      suggestions.push(suggestion);
    }

    // With default "dev", should suggest "verbose"
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "verbose"),
    );
  });
});
