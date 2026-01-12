import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import {
  dependency,
  DependencyId,
  DependencySourceMarker,
  DerivedValueParserMarker,
  deriveFrom,
  isDependencySource,
  isDerivedValueParser,
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
