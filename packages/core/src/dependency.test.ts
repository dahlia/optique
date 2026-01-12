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
  formatDependencyError,
  isDeferredParseState,
  isDependencySource,
  isDerivedValueParser,
  ParseWithDependency,
} from "./dependency.ts";
import { choice, string } from "./valueparser.ts";

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

import { object } from "./constructs.ts";
import { parseSync } from "./parser.ts";
import { option } from "./primitives.ts";

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
