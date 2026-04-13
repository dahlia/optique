import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import {
  createDeferredParseState,
  deferredParseMarker,
  dependency,
  dependencyId,
  DependencyRegistry,
  dependencySourceMarker,
  derivedValueParserMarker,
  deriveFrom,
  deriveFromAsync,
  deriveFromSync,
  formatDependencyError,
  getSnapshottedDefaultDependencyValues,
  isDeferredParseState,
  isDependencySource,
  isDerivedValueParser,
  parseWithDependency,
  snapshotDefaultDependencyValues,
  suggestWithDependency,
} from "./internal/dependency.ts";
import { message } from "./message.ts";
import type { NonEmptyString } from "./nonempty.ts";
import {
  parseAsync,
  parseSync,
  suggestAsync,
  type Suggestion,
  suggestSync,
} from "./internal/parser.ts";
import {
  choice,
  integer,
  string,
  type ValueParser,
  type ValueParserResult,
} from "./valueparser.ts";
import { conditional, merge, object, or, tuple } from "./constructs.ts";
import { argument, command, constant, option } from "./primitives.ts";
import { map, multiple, optional, withDefault } from "./modifiers.ts";
import * as fc from "fast-check";

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
    placeholder: "",
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
    placeholder: choices[0],
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

function syncThrowingParser<
  M extends "sync" | "async",
  T extends string,
>(mode: M): ValueParser<M, T> {
  return {
    $mode: mode,
    metavar: "THROWING" as NonEmptyString,
    placeholder: "" as T,
    parse(): never {
      throw new TypeError("Parser exploded.");
    },
    format(value: T): string {
      return value;
    },
  };
}

/**
 * Creates an async integer parser that validates against a range.
 */
function asyncInteger(
  min: number,
  max: number,
  delay = 0,
): ValueParser<"async", number> {
  return {
    $mode: "async",
    metavar: "ASYNC_INT" as NonEmptyString,
    placeholder: 0,
    async parse(input: string): Promise<ValueParserResult<number>> {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const num = parseInt(input, 10);
      if (isNaN(num)) {
        return {
          success: false,
          error: message`Expected an integer`,
        };
      }
      if (num < min || num > max) {
        return {
          success: false,
          error: message`Must be between ${String(min)} and ${String(max)}`,
        };
      }
      return { success: true, value: num };
    },
    format(value: number): string {
      return String(value);
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
    placeholder: "",
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
    placeholder: "",
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
    assert.equal(source[dependencySourceMarker], true);
    assert.equal(typeof source[dependencyId], "symbol");
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

    assert.notEqual(source1[dependencyId], source2[dependencyId]);
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
      mode: "sync",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    assert.ok(isDerivedValueParser(derived));
    assert.equal(derived[derivedValueParserMarker], true);
  });

  test("derived parser has the specified metavar", () => {
    const cwdParser = dependency(string({ metavar: "DIR" }));
    const derived = cwdParser.derive<string>({
      metavar: "FILE",
      mode: "sync",
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
        mode: "sync",
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
      mode: "sync",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    assert.equal(derived[dependencyId], cwdParser[dependencyId]);
  });

  test("derived parser has sync mode when source is sync", () => {
    const cwdParser = dependency(string({ metavar: "DIR" }));
    const derived = cwdParser.derive<string>({
      metavar: "FILE",
      mode: "sync",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    assert.equal(derived.$mode, "sync");
  });

  test("derived parser format uses factory with default value", () => {
    const cwdParser = dependency(string({ metavar: "DIR" }));
    const derived = cwdParser.derive<string>({
      metavar: "FILE",
      mode: "sync",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    assert.equal(derived.format("test.txt"), "test.txt");
  });

  test("format() should not throw when factory throws on default value", () => {
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = modeParser.derive<string>({
      metavar: "VALUE",
      mode: "sync",
      factory: (value: "safe" | "broken") => {
        if (value === "broken") {
          throw new Error("derive sync factory exploded");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValue: () => "broken" as const,
    });

    assert.equal(derived.format("x"), "x");
  });

  test("suggest() should not throw when factory throws on default value", () => {
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = modeParser.derive<string>({
      metavar: "VALUE",
      mode: "sync",
      factory: (value: "safe" | "broken") => {
        if (value === "broken") {
          throw new Error("derive sync factory exploded");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValue: () => "broken" as const,
    });

    const suggestions = [...derived.suggest!("")];
    assert.equal(suggestions.length, 0);
  });
});

describe("isDerivedValueParser()", () => {
  test("returns true for derived value parsers", () => {
    const source = dependency(string({ metavar: "DIR" }));
    const derived = source.derive<string>({
      metavar: "FILE",
      mode: "sync",
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
      mode: "sync",
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
      mode: "sync",
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
      mode: "sync",
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
      mode: "sync",
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
      mode: "sync",
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
    assert.equal(deferred[deferredParseMarker], true);
    assert.equal(deferred.rawInput, "test-input");
    assert.equal(deferred.parser, derived);
    assert.equal(deferred.dependencyId, source[dependencyId]);
    assert.deepEqual(deferred.preliminaryResult, preliminaryResult);
  });

  test("isDeferredParseState returns true for deferred states", () => {
    const source = dependency(string({ metavar: "DIR" }));
    const derived = source.derive<string>({
      metavar: "FILE",
      mode: "sync",
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
      mode: "sync",
      factory: (_dir: string) => string({ metavar: "FILE" }),
      defaultValue: () => "/default",
    });

    const preliminaryResult = derived.parse("test-input");
    const deferred = createDeferredParseState(
      "test-input",
      derived,
      preliminaryResult,
    );
    assert.equal(deferred.dependencyId, source[dependencyId]);
  });

  test("deferred state stores preliminary result", () => {
    const source = dependency(string({ metavar: "DIR" }));
    const derived = source.derive<string>({
      metavar: "FILE",
      mode: "sync",
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

  test("createDeferredParseState reuses snapshotted default values", () => {
    const env = dependency(choice(["dev", "prod"] as const));
    const region = dependency(choice(["us", "eu"] as const));
    let defaultCalls = 0;
    const derived = deriveFrom({
      metavar: "URL",
      mode: "sync",
      dependencies: [env, region] as const,
      factory: (currentEnv, currentRegion) =>
        choice([`https://${currentEnv}.${currentRegion}.example.com`] as const),
      defaultValues: () => {
        defaultCalls++;
        return defaultCalls === 1
          ? ["dev", "us"] as const
          : ["prod", "eu"] as const;
      },
    });

    const preliminaryResult = derived.parse("https://dev.us.example.com");
    assert.equal(defaultCalls, 1);

    const deferred = createDeferredParseState(
      "https://dev.us.example.com",
      derived,
      preliminaryResult,
    );

    assert.deepEqual(deferred.defaultValues, ["dev", "us"]);
    assert.equal(defaultCalls, 1);
  });

  test(
    "createDeferredParseState reuses snapshotted single-source defaults on factory failure",
    () => {
      const mode = dependency(choice(["dev", "prod"] as const));
      let defaultCalls = 0;
      const derived = mode.derive({
        metavar: "LEVEL",
        mode: "sync",
        factory: () => {
          throw new Error("Factory exploded.");
        },
        defaultValue: () => {
          defaultCalls++;
          return defaultCalls === 1 ? "dev" : "prod";
        },
      });

      const preliminaryResult = derived.parse("warn");
      assert.ok(!preliminaryResult.success);
      assert.equal(defaultCalls, 1);
      assert.deepEqual(
        getSnapshottedDefaultDependencyValues(preliminaryResult),
        ["dev"],
      );

      const deferred = createDeferredParseState(
        "warn",
        derived,
        preliminaryResult,
      );

      assert.deepEqual(deferred.defaultValues, ["dev"]);
      assert.equal(defaultCalls, 1);
    },
  );

  test(
    "createDeferredParseState reuses snapshotted multi-source defaults on async factory failure",
    async () => {
      const env = dependency(choice(["dev", "prod"] as const));
      const region = dependency(choice(["us", "eu"] as const));
      let defaultCalls = 0;
      const derived = deriveFromAsync({
        metavar: "URL",
        dependencies: [env, region] as const,
        factory: () => {
          throw new Error("Factory exploded.");
        },
        defaultValues: () => {
          defaultCalls++;
          return defaultCalls === 1
            ? ["dev", "us"] as const
            : ["prod", "eu"] as const;
        },
      });

      const preliminaryResult = await derived.parse(
        "https://dev.us.example.com",
      );
      assert.ok(!preliminaryResult.success);
      assert.equal(defaultCalls, 1);
      assert.deepEqual(
        getSnapshottedDefaultDependencyValues(preliminaryResult),
        ["dev", "us"],
      );

      const deferred = createDeferredParseState(
        "https://dev.us.example.com",
        derived,
        preliminaryResult,
      );

      assert.deepEqual(deferred.defaultValues, ["dev", "us"]);
      assert.equal(defaultCalls, 1);
    },
  );

  test(
    "createDeferredParseState keeps single-source snapshots across later mode-mismatch parses",
    () => {
      let defaultCalls = 0;
      const mode = dependency(choice(["dev", "prod"] as const));
      const derived = mode.derive<"ok", "sync">({
        metavar: "VALUE",
        mode: "sync",
        // @ts-expect-error: intentional sync/async mode mismatch coverage.
        factory: () => {
          return asyncChoice(["ok"] as const);
        },
        defaultValue: () => {
          defaultCalls++;
          return defaultCalls === 1 ? "dev" : "prod";
        },
      });

      const firstResult = derived.parse("ok");
      assert.ok(!firstResult.success);
      assert.deepEqual(
        getSnapshottedDefaultDependencyValues(firstResult),
        ["dev"],
      );

      const secondResult = derived.parse("ok");
      assert.ok(!secondResult.success);
      assert.deepEqual(
        getSnapshottedDefaultDependencyValues(secondResult),
        ["prod"],
      );

      const deferred = createDeferredParseState("ok", derived, firstResult);

      assert.deepEqual(deferred.defaultValues, ["dev"]);
      assert.equal(defaultCalls, 2);
    },
  );

  test(
    "createDeferredParseState keeps multi-source snapshots across later mode-mismatch parses",
    () => {
      let defaultCalls = 0;
      const env = dependency(choice(["dev", "prod"] as const));
      const region = dependency(choice(["us", "eu"] as const));
      const derived = deriveFrom<
        readonly [typeof env, typeof region],
        "ok",
        "sync"
      >({
        metavar: "VALUE",
        mode: "sync",
        dependencies: [env, region] as const,
        // @ts-expect-error: intentional sync/async mode mismatch coverage.
        factory: () => {
          return asyncChoice(["ok"] as const);
        },
        defaultValues: () => {
          defaultCalls++;
          return defaultCalls === 1
            ? ["dev", "us"] as const
            : ["prod", "eu"] as const;
        },
      });

      const firstResult = derived.parse("ok");
      assert.ok(!firstResult.success);
      assert.deepEqual(
        getSnapshottedDefaultDependencyValues(firstResult),
        ["dev", "us"],
      );

      const secondResult = derived.parse("ok");
      assert.ok(!secondResult.success);
      assert.deepEqual(
        getSnapshottedDefaultDependencyValues(secondResult),
        ["prod", "eu"],
      );

      const deferred = createDeferredParseState("ok", derived, firstResult);

      assert.deepEqual(deferred.defaultValues, ["dev", "us"]);
      assert.equal(defaultCalls, 2);
    },
  );

  test(
    "createDeferredParseState clones snapshotted default values",
    () => {
      const env = dependency(choice(["dev", "prod"] as const));
      const region = dependency(choice(["us", "eu"] as const));
      const parser = deriveFromSync({
        metavar: "URL",
        dependencies: [env, region] as const,
        factory: (currentEnv, currentRegion) =>
          choice(
            [`https://${currentEnv}.${currentRegion}.example.com`] as const,
          ),
        defaultValues: () => ["dev", "us"] as const,
      });
      const preliminaryResult = snapshotDefaultDependencyValues(
        {
          success: false as const,
          error: message`pending callback failed`,
        },
        ["dev", "us"] as const,
      );
      const deferred = createDeferredParseState(
        "https://dev.us.example.com",
        parser,
        preliminaryResult,
      );
      const snapshot = getSnapshottedDefaultDependencyValues(preliminaryResult);

      assert.ok(snapshot != null);
      if (snapshot == null) return;
      (snapshot as ["dev" | "prod", "us" | "eu"])[0] = "prod";
      (snapshot as ["dev" | "prod", "us" | "eu"])[1] = "eu";

      assert.deepEqual(deferred.defaultValues, ["dev", "us"]);
    },
  );

  test(
    "createDeferredParseState clones fallback default values",
    () => {
      const env = dependency(choice(["dev", "prod"] as const));
      const region = dependency(choice(["us", "eu"] as const));
      const defaults: ["dev" | "prod", "us" | "eu"] = ["dev", "us"];
      const parser = deriveFromSync({
        metavar: "URL",
        dependencies: [env, region] as const,
        factory: (currentEnv, currentRegion) =>
          choice(
            [`https://${currentEnv}.${currentRegion}.example.com`] as const,
          ),
        defaultValues: () => defaults,
      });
      const deferred = createDeferredParseState(
        "https://dev.us.example.com",
        parser,
        {
          success: false,
          error: message`pending callback failed`,
        },
      );

      defaults[0] = "prod";
      defaults[1] = "eu";

      assert.deepEqual(deferred.defaultValues, ["dev", "us"]);
    },
  );
});

describe("snapshotDefaultDependencyValues", () => {
  test("clones the result before attaching the snapshot", () => {
    const result = Object.freeze({
      success: true as const,
      value: "prod",
    });
    const defaults = ["dev"];

    const snapshotted = snapshotDefaultDependencyValues(result, defaults);
    defaults[0] = "prod";

    assert.notEqual(snapshotted, result);
    assert.deepEqual(getSnapshottedDefaultDependencyValues(snapshotted), [
      "dev",
    ]);
    assert.equal(getSnapshottedDefaultDependencyValues(result), undefined);
  });

  test("deriveFromAsync snapshots defaults before awaiting parse", async () => {
    const env = dependency(choice(["dev", "prod"] as const));
    const region = dependency(choice(["us", "eu"] as const));
    const defaults: ["dev" | "prod", "us" | "eu"] = ["dev", "us"];
    let releaseParse!: () => void;
    const parseGate = new Promise<void>((resolve) => {
      releaseParse = resolve;
    });

    const derived = deriveFromAsync({
      metavar: "URL",
      dependencies: [env, region] as const,
      factory: (currentEnv, currentRegion) => ({
        $mode: "async" as const,
        metavar: "URL",
        placeholder: "",
        async parse(input: string): Promise<ValueParserResult<string>> {
          await parseGate;
          return input === `https://${currentEnv}.${currentRegion}.example.com`
            ? { success: true as const, value: input }
            : {
              success: false as const,
              error: message`Unexpected URL.`,
            };
        },
        format(value: string): string {
          return value;
        },
      }),
      defaultValues: () => defaults,
    });

    const pending = derived.parse("https://dev.us.example.com");
    defaults[0] = "prod";
    defaults[1] = "eu";
    releaseParse();

    const result = await pending;
    assert.ok(result.success);
    assert.deepEqual(getSnapshottedDefaultDependencyValues(result), [
      "dev",
      "us",
    ]);
  });

  test("deriveFromSync snapshots defaults before parse mutates the tuple", () => {
    const env = dependency(choice(["dev", "prod"] as const));
    const region = dependency(choice(["us", "eu"] as const));
    const defaults: ["dev" | "prod", "us" | "eu"] = ["dev", "us"];

    const derived = deriveFromSync({
      metavar: "URL",
      dependencies: [env, region] as const,
      factory: (currentEnv, currentRegion) => ({
        $mode: "sync" as const,
        metavar: "URL",
        placeholder: "",
        parse(input: string): ValueParserResult<string> {
          defaults[0] = "prod";
          defaults[1] = "eu";
          return input === `https://${currentEnv}.${currentRegion}.example.com`
            ? { success: true as const, value: input }
            : {
              success: false as const,
              error: message`Unexpected URL.`,
            };
        },
        format(value: string): string {
          return value;
        },
      }),
      defaultValues: () => defaults,
    });

    const result = derived.parse("https://dev.us.example.com");
    assert.ok(result.success);
    assert.deepEqual(getSnapshottedDefaultDependencyValues(result), [
      "dev",
      "us",
    ]);
  });

  test("preserves the first snapshot on re-annotation", () => {
    const result = Object.freeze({
      success: true as const,
      value: "ok",
    });

    const first = snapshotDefaultDependencyValues(result, ["dev", "us"]);
    const second = snapshotDefaultDependencyValues(first, ["prod", "eu"]);

    assert.deepEqual(getSnapshottedDefaultDependencyValues(second), [
      "dev",
      "us",
    ]);
  });

  test("outer derived parsers overwrite inner default snapshots", () => {
    const mode = dependency(choice(["inner", "outer"] as const));
    const outer = mode.derive({
      metavar: "VALUE",
      mode: "sync",
      defaultValue: () => "outer" as const,
      factory: (_value) =>
        mode.derive({
          metavar: "INNER",
          mode: "sync",
          defaultValue: () => "inner" as const,
          factory: () => choice(["ok"] as const),
        }),
    });

    const result = outer.parse("ok");
    assert.ok(result.success);
    assert.deepEqual(getSnapshottedDefaultDependencyValues(result), ["outer"]);
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
      mode: "sync",
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
      mode: "sync",
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
      mode: "sync",
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

describe("parseWithDependency", () => {
  test("derived parser can parse with actual dependency value", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const derived = modeParser.derive<"debug" | "verbose" | "quiet" | "silent">(
      {
        metavar: "LOG_LEVEL",
        mode: "sync",
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

    // With parseWithDependency and "prod", now "quiet" is valid
    const result3 = derived[parseWithDependency]("quiet", "prod");
    // For sync parsers, result is not a Promise
    assert.ok("success" in result3 && result3.success);
    if ("value" in result3) {
      assert.equal(result3.value, "quiet");
    }

    // With parseWithDependency and "prod", "debug" is now invalid
    const result4 = derived[parseWithDependency]("debug", "prod");
    assert.ok("success" in result4 && !result4.success);
  });

  test("deriveFrom parser can parse with actual dependency values", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      mode: "sync",
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

    // With parseWithDependency and actual values, "/custom/prod.yaml" is valid
    const result3 = derived[parseWithDependency](
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
      mode: "async",
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
      mode: "sync",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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

  test("async factory parse rejects synchronous parser throws", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      mode: "async",
      factory: () => syncThrowingParser("async"),
      defaultValue: () => "dev" as const,
    });

    const parsePromise = derived.parse("debug");
    assert.ok(parsePromise instanceof Promise);
    await assert.rejects(parsePromise, {
      name: "TypeError",
      message: "Parser exploded.",
    });
    const replayPromise = derived[parseWithDependency]("debug", "prod");
    assert.ok(replayPromise instanceof Promise);
    await assert.rejects(replayPromise, {
      name: "TypeError",
      message: "Parser exploded.",
    });
  });

  test("format() should not throw when factory throws on default value", () => {
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = modeParser.derive({
      metavar: "VALUE",
      mode: "async",
      factory: (value: "safe" | "broken") => {
        if (value === "broken") {
          throw new Error("derive async factory exploded");
        }
        return asyncChoice(["a", "b"]);
      },
      defaultValue: () => "broken" as const,
    });

    assert.equal(derived.format("x"), "x");
  });

  test("suggest() should not throw when factory throws on default value", async () => {
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = modeParser.derive({
      metavar: "VALUE",
      mode: "async",
      factory: (value: "safe" | "broken") => {
        if (value === "broken") {
          throw new Error("derive async factory exploded");
        }
        return asyncChoice(["a", "b"]);
      },
      defaultValue: () => "broken" as const,
    });

    const suggestions: Suggestion[] = [];
    for await (const s of derived.suggest!("")) {
      suggestions.push(s);
    }
    assert.equal(suggestions.length, 0);
  });

  test(
    "option suggest does not double-evaluate single-source defaults",
    async () => {
      let defaultCalls = 0;
      const modeParser = dependency(choice(["dev", "prod"] as const));
      const derived = modeParser.derive({
        metavar: "VALUE",
        mode: "async",
        factory: (value: "dev" | "prod") =>
          asyncChoice(
            value === "dev"
              ? ["debug", "verbose"] as const
              : ["silent", "strict"] as const,
          ),
        defaultValue: () => {
          defaultCalls++;
          return "dev" as const;
        },
      });
      const parser = object({ level: option("--level", derived) });

      const suggestions = await suggestAsync(parser, ["--level", ""]);

      assert.equal(defaultCalls, 1);
      assert.deepEqual(
        suggestions.map((suggestion) =>
          "text" in suggestion ? suggestion.text : ""
        ),
        ["debug", "verbose"],
      );
    },
  );
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

  test("async source parse rejects synchronous parser throws", async () => {
    const modeParser = dependency(asyncChoice(["dev", "prod"] as const));

    const derived = modeParser.deriveSync({
      metavar: "LOG_LEVEL",
      factory: () => syncThrowingParser("sync"),
      defaultValue: () => "dev" as const,
    });

    const parsePromise = derived.parse("debug");
    assert.ok(parsePromise instanceof Promise);
    await assert.rejects(parsePromise, {
      name: "TypeError",
      message: "Parser exploded.",
    });
    const replayPromise = derived[parseWithDependency]("debug", "prod");
    assert.ok(replayPromise instanceof Promise);
    await assert.rejects(replayPromise, {
      name: "TypeError",
      message: "Parser exploded.",
    });
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

  test("format() should not throw when factory throws on default value", () => {
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = modeParser.deriveSync({
      metavar: "VALUE",
      factory: (value: "safe" | "broken") => {
        if (value === "broken") {
          throw new Error("deriveSync default factory exploded");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValue: () => "broken" as const,
    });

    // Should fall back to String(value)
    assert.equal(derived.format("x"), "x");
  });

  test("suggest() should not throw when factory throws on default value", () => {
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = modeParser.deriveSync({
      metavar: "VALUE",
      factory: (value: "safe" | "broken") => {
        if (value === "broken") {
          throw new Error("deriveSync default factory exploded");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValue: () => "broken" as const,
    });

    // Should not throw; should yield empty suggestions
    assert.doesNotThrow(() => {
      const suggestions = [...derived.suggest!("")];
      assert.equal(suggestions.length, 0);
    });
  });

  test("format() should still propagate errors from the derived parser's formatter", () => {
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = modeParser.deriveSync({
      metavar: "VALUE",
      factory: (_value: "safe" | "broken"): ValueParser<"sync", string> => ({
        $mode: "sync",
        metavar: "VALUE" as NonEmptyString,
        placeholder: "",
        parse: (input: string) => ({ success: true, value: input }),
        format(_value: string): string {
          throw new Error("formatter error");
        },
      }),
      defaultValue: () => "safe" as const,
    });

    // Factory succeeds, but the derived parser's format() throws — that
    // exception must not be swallowed.
    assert.throws(() => derived.format("x"), { message: "formatter error" });
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

  test("format() should not throw when factory throws on default value", () => {
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = modeParser.deriveAsync({
      metavar: "VALUE",
      factory: (value: "safe" | "broken") => {
        if (value === "broken") {
          throw new Error("deriveAsync default factory exploded");
        }
        return asyncChoice(["a", "b"]);
      },
      defaultValue: () => "broken" as const,
    });

    assert.equal(derived.format("x"), "x");
  });

  test("suggest() should not throw when factory throws on default value", async () => {
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = modeParser.deriveAsync({
      metavar: "VALUE",
      factory: (value: "safe" | "broken") => {
        if (value === "broken") {
          throw new Error("deriveAsync default factory exploded");
        }
        return asyncChoice(["a", "b"]);
      },
      defaultValue: () => "broken" as const,
    });

    const suggestions: Suggestion[] = [];
    for await (const s of derived.suggest!("")) {
      suggestions.push(s);
    }
    assert.equal(suggestions.length, 0);
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
      mode: "async",
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
      mode: "sync",
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
      mode: "async",
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

  test("format() should not throw when factory throws on default values", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = deriveFrom({
      metavar: "VALUE",
      mode: "async",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "safe" | "broken") => {
        if (mode === "broken") {
          throw new Error("deriveFrom async factory exploded");
        }
        return asyncChoice(["a", "b"]);
      },
      defaultValues: () => ["/config", "broken"] as const,
    });

    assert.equal(derived.format("x"), "x");
  });

  test("deriveFrom async factory parse rejects synchronous parser throws", async () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      mode: "async",
      dependencies: [dirParser, modeParser] as const,
      factory: () => syncThrowingParser("async"),
      defaultValues: () => ["/config", "dev"] as const,
    });

    const parsePromise = derived.parse("debug");
    assert.ok(parsePromise instanceof Promise);
    await assert.rejects(parsePromise, {
      name: "TypeError",
      message: "Parser exploded.",
    });
    const replayPromise = derived[parseWithDependency](
      "debug",
      ["/config", "prod"] as const,
    );
    assert.ok(replayPromise instanceof Promise);
    await assert.rejects(replayPromise, {
      name: "TypeError",
      message: "Parser exploded.",
    });
  });

  test("suggest() should not throw when factory throws on default values", async () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = deriveFrom({
      metavar: "VALUE",
      mode: "async",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "safe" | "broken") => {
        if (mode === "broken") {
          throw new Error("deriveFrom async factory exploded");
        }
        return asyncChoice(["a", "b"]);
      },
      defaultValues: () => ["/config", "broken"] as const,
    });

    const suggestions: Suggestion[] = [];
    for await (const s of derived.suggest!("")) {
      suggestions.push(s);
    }
    assert.equal(suggestions.length, 0);
  });

  test("normalize() delegates to async-factory derived parsers", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFromAsync({
      metavar: "VALUE",
      dependencies: [dirParser, modeParser] as const,
      factory: () => ({
        $mode: "async" as const,
        metavar: "VALUE" as NonEmptyString,
        placeholder: "" as string,
        parse(input: string): Promise<ValueParserResult<string>> {
          return Promise.resolve({
            success: true,
            value: input.trim().toLowerCase(),
          });
        },
        format(value: string): string {
          return value;
        },
        normalize(value: string): string {
          return value.trim().toLowerCase();
        },
      }),
      defaultValues: () => ["/config", "dev"] as const,
    });

    assert.equal(derived.normalize?.("  VERBOSE  "), "verbose");
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

  test("mixed sync/async sources reject synchronous parser throws", async () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(asyncChoice(["dev", "prod"] as const));

    const derived = deriveFromSync({
      metavar: "CONFIG",
      dependencies: [dirParser, modeParser] as const,
      factory: () => syncThrowingParser("sync"),
      defaultValues: () => ["/config", "dev"] as const,
    });

    const parsePromise = derived.parse("debug");
    assert.ok(parsePromise instanceof Promise);
    await assert.rejects(parsePromise, {
      name: "TypeError",
      message: "Parser exploded.",
    });
    const replayPromise = derived[parseWithDependency](
      "debug",
      ["/config", "prod"] as const,
    );
    assert.ok(replayPromise instanceof Promise);
    await assert.rejects(replayPromise, {
      name: "TypeError",
      message: "Parser exploded.",
    });
  });

  test("format() should not throw when factory throws on default values", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = deriveFromSync({
      metavar: "VALUE",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "safe" | "broken") => {
        if (mode === "broken") {
          throw new Error("deriveFromSync default factory exploded");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValues: () => ["/config", "broken"] as const,
    });

    assert.equal(derived.format("x"), "x");
  });

  test("suggest() should not throw when factory throws on default values", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = deriveFromSync({
      metavar: "VALUE",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "safe" | "broken") => {
        if (mode === "broken") {
          throw new Error("deriveFromSync default factory exploded");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValues: () => ["/config", "broken"] as const,
    });

    const suggestions = [...derived.suggest!("")];
    assert.equal(suggestions.length, 0);
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

  test("format() should not throw when factory throws on default values", () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = deriveFromAsync({
      metavar: "VALUE",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "safe" | "broken") => {
        if (mode === "broken") {
          throw new Error("deriveFromAsync default factory exploded");
        }
        return asyncChoice(["a", "b"]);
      },
      defaultValues: () => ["/config", "broken"] as const,
    });

    assert.equal(derived.format("x"), "x");
  });

  test("suggest() should not throw when factory throws on default values", async () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["safe", "broken"] as const));

    const derived = deriveFromAsync({
      metavar: "VALUE",
      dependencies: [dirParser, modeParser] as const,
      factory: (_dir: string, mode: "safe" | "broken") => {
        if (mode === "broken") {
          throw new Error("deriveFromAsync default factory exploded");
        }
        return asyncChoice(["a", "b"]);
      },
      defaultValues: () => ["/config", "broken"] as const,
    });

    // Should not throw; should yield empty suggestions
    const suggestions: Suggestion[] = [];
    for await (const s of derived.suggest!("")) {
      suggestions.push(s);
    }
    assert.equal(suggestions.length, 0);
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
      mode: "async",
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
// parseWithDependency Async Tests
// =============================================================================

describe("parseWithDependency with async derived parser", () => {
  test("async derived parser parseWithDependency returns Promise", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      mode: "async",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // parseWithDependency should return a Promise for async derived parser
    const result = derived[parseWithDependency]("quiet", "prod");
    assert.ok(result instanceof Promise);

    const resolved = await result;
    assert.ok(resolved.success);
    if (resolved.success) {
      assert.equal(resolved.value, "quiet");
    }
  });

  test("parseWithDependency with actual dependency value validates correctly", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const derived = modeParser.derive({
      metavar: "LOG_LEVEL",
      mode: "async",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? ["debug", "verbose"] as const
            : ["quiet", "silent"] as const,
        ),
      defaultValue: () => "dev" as const,
    });

    // With "prod" dependency, "quiet" should be valid
    const result1 = await derived[parseWithDependency]("quiet", "prod");
    assert.ok(result1.success);

    // With "prod" dependency, "debug" should be invalid
    const result2 = await derived[parseWithDependency]("debug", "prod");
    assert.ok(!result2.success);

    // With "dev" dependency, "debug" should be valid
    const result3 = await derived[parseWithDependency]("debug", "dev");
    assert.ok(result3.success);
  });

  test("deriveFrom async parseWithDependency works correctly", async () => {
    const dirParser = dependency(string({ metavar: "DIR" }));
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const derived = deriveFrom({
      metavar: "CONFIG",
      mode: "async",
      dependencies: [dirParser, modeParser] as const,
      factory: (dir: string, mode: "dev" | "prod") =>
        asyncChoice([`${dir}/${mode}.json`, `${dir}/${mode}.yaml`]),
      defaultValues: () => ["/config", "dev"] as const,
    });

    // With default values, "/config/dev.json" is valid
    const result1 = await derived.parse("/config/dev.json");
    assert.ok(result1.success);

    // With custom dependency values via parseWithDependency
    const result2 = await derived[parseWithDependency](
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
      mode: "async",
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
      mode: "async",
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

// =============================================================================
// Parser Combinator Combinations
// =============================================================================

describe("Parser combinator combinations with derived parser", () => {
  test("or() with derived parser in one branch", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Either: --mode with --log-level (complex branch), or just --value (simple branch)
    const parser = or(
      object({
        kind: constant("complex" as const),
        mode: option("--mode", modeParser),
        logLevel: option("--log-level", logLevelParser),
      }),
      object({
        kind: constant("simple" as const),
        value: option("--value", string()),
      }),
    );

    // Test complex branch with dependency
    const result1 = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "debug",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.kind, "complex");
      assert.equal((result1.value as { mode: string }).mode, "dev");
      assert.equal((result1.value as { logLevel: string }).logLevel, "debug");
    }

    // Test simple branch without dependency
    const result2 = await parseAsync(parser, ["--value", "test"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.kind, "simple");
      assert.equal((result2.value as { value: string }).value, "test");
    }
  });

  test("command() with derived parser in subcommand", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = or(
      command(
        "run",
        object({
          type: constant("run" as const),
          mode: option("--mode", modeParser),
          logLevel: option("--log-level", logLevelParser),
        }),
      ),
      command(
        "build",
        object({
          type: constant("build" as const),
          target: option("--target", string()),
        }),
      ),
    );

    // Test run command with dependency
    const result1 = await parseAsync(parser, [
      "run",
      "--mode",
      "prod",
      "--log-level",
      "quiet",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.type, "run");
      if (result1.value.type === "run") {
        assert.equal(result1.value.mode, "prod");
        assert.equal(result1.value.logLevel, "quiet");
      }
    }

    // Test build command without dependency
    const result2 = await parseAsync(parser, ["build", "--target", "linux"]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.type, "build");
      if (result2.value.type === "build") {
        assert.equal(result2.value.target, "linux");
      }
    }
  });

  test("tuple() with derived parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = tuple([
      option("--mode", modeParser),
      option("--log-level", logLevelParser),
      option("--name", string()),
    ]);

    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "verbose",
      "--name",
      "test",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value[0], "dev");
      assert.equal(result.value[1], "verbose");
      assert.equal(result.value[2], "test");
    }
  });

  test("merge() with derived parser across merged objects", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Mode is in one object, derived parser is in another
    const parser = merge(
      object({
        mode: option("--mode", modeParser),
      }),
      object({
        logLevel: option("--log-level", logLevelParser),
        name: option("--name", string()),
      }),
    );

    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "silent",
      "--name",
      "test",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "silent");
      assert.equal(result.value.name, "test");
    }
  });

  test("conditional() with derived parser", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = conditional(
      option("--env", choice(["local", "remote"] as const)),
      {
        local: object({
          mode: option("--mode", modeParser),
          logLevel: option("--log-level", logLevelParser),
        }),
        remote: object({
          host: option("--host", string()),
        }),
      },
    );

    // Test local branch with dependency
    // conditional() returns tuple [discriminatorValue, branchValue]
    const result1 = await parseAsync(parser, [
      "--env",
      "local",
      "--mode",
      "dev",
      "--log-level",
      "debug",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value[0], "local");
      const localValue = result1.value[1] as {
        mode: string;
        logLevel: string;
      };
      assert.equal(localValue.mode, "dev");
      assert.equal(localValue.logLevel, "debug");
    }

    // Test remote branch without dependency
    const result2 = await parseAsync(parser, [
      "--env",
      "remote",
      "--host",
      "example.com",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value[0], "remote");
      const remoteValue = result2.value[1] as { host: string };
      assert.equal(remoteValue.host, "example.com");
    }
  });

  test("nested command with multiple derived parsers", async () => {
    const envParser = dependency(choice(["dev", "staging", "prod"] as const));

    const portParser = envParser.derive({
      metavar: "PORT",
      mode: "sync",
      factory: (env) =>
        integer({
          min: env === "prod" ? 80 : 3000,
          max: env === "prod" ? 443 : 9999,
        }),
      defaultValue: () => "dev" as const,
    });

    const logLevelParser = envParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (env) =>
        choice(
          env === "prod"
            ? (["error", "warn"] as const)
            : (["debug", "info", "warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = command(
      "server",
      object({
        env: option("--env", envParser),
        port: option("--port", portParser),
        logLevel: option("--log-level", logLevelParser),
      }),
    );

    // Test dev environment
    const result1 = await parseAsync(parser, [
      "server",
      "--env",
      "dev",
      "--port",
      "3000",
      "--log-level",
      "debug",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.env, "dev");
      assert.equal(result1.value.port, 3000);
      assert.equal(result1.value.logLevel, "debug");
    }

    // Test prod environment with valid prod port
    const result2 = await parseAsync(parser, [
      "server",
      "--env",
      "prod",
      "--port",
      "443",
      "--log-level",
      "error",
    ]);
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value.env, "prod");
      assert.equal(result2.value.port, 443);
      assert.equal(result2.value.logLevel, "error");
    }

    // Test prod environment rejects dev-only log level
    const result3 = await parseAsync(parser, [
      "server",
      "--env",
      "prod",
      "--port",
      "443",
      "--log-level",
      "debug",
    ]);
    assert.ok(!result3.success);
  });
});

// =============================================================================
// Complex Dependency Chains
// =============================================================================

describe("Complex dependency chains", () => {
  test("multiple derived parsers from same dependency source", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));

    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const portParser = modeParser.derive({
      metavar: "PORT",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        integer({ min: mode === "dev" ? 3000 : 80, max: 65535 }),
      defaultValue: () => "dev" as const,
    });

    const timeoutParser = modeParser.derive({
      metavar: "TIMEOUT",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        integer({ min: 0, max: mode === "dev" ? 60000 : 5000 }),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
      port: option("--port", portParser),
      timeout: option("--timeout", timeoutParser),
    });

    // All three derived parsers should use the same mode value
    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "quiet",
      "--port",
      "443",
      "--timeout",
      "1000",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.logLevel, "quiet");
      assert.equal(result.value.port, 443);
      assert.equal(result.value.timeout, 1000);
    }
  });

  test("deriveFrom with multiple independent dependency sources", async () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const regionParser = dependency(choice(["us", "eu", "asia"] as const));

    const endpointParser = deriveFrom({
      metavar: "ENDPOINT",
      mode: "sync",
      dependencies: [envParser, regionParser] as const,
      factory: (env: "dev" | "prod", region: "us" | "eu" | "asia") => {
        const endpoints = {
          dev: {
            us: "dev-us.example.com",
            eu: "dev-eu.example.com",
            asia: "dev-asia.example.com",
          },
          prod: {
            us: "api-us.example.com",
            eu: "api-eu.example.com",
            asia: "api-asia.example.com",
          },
        };
        return choice([endpoints[env][region]] as const);
      },
      defaultValues: () => ["dev", "us"] as const,
    });

    const parser = object({
      env: option("--env", envParser),
      region: option("--region", regionParser),
      endpoint: option("--endpoint", endpointParser),
    });

    // deriveFrom creates an async parser, so must use parseAsync
    const result = await parseAsync(parser, [
      "--env",
      "prod",
      "--region",
      "eu",
      "--endpoint",
      "api-eu.example.com",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.env, "prod");
      assert.equal(result.value.region, "eu");
      assert.equal(result.value.endpoint, "api-eu.example.com");
    }

    // Wrong endpoint for the given env/region combination should fail
    const result2 = await parseAsync(parser, [
      "--env",
      "prod",
      "--region",
      "eu",
      "--endpoint",
      "dev-us.example.com",
    ]);
    assert.ok(!result2.success);
  });

  test("dependency sources in different order than derived parsers", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Derived parser comes BEFORE dependency source in the object
    const parser = object({
      logLevel: option("--log-level", logLevelParser),
      mode: option("--mode", modeParser),
    });

    // Arguments in order: derived first, then source
    const result1 = await parseAsync(parser, [
      "--log-level",
      "debug",
      "--mode",
      "dev",
    ]);
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value.mode, "dev");
      assert.equal(result1.value.logLevel, "debug");
    }

    // Arguments in order: source first, then derived
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
});

// =============================================================================
// Edge Cases: Dependency Source Modifiers
// =============================================================================

describe("Edge cases: dependency source with modifiers", () => {
  test("optional() dependency source - provided", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: optional(option("--mode", modeParser)),
      logLevel: option("--log-level", logLevelParser),
    });

    // Mode provided - should use actual value
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

  test("optional() dependency source - not provided uses default", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: optional(option("--mode", modeParser)),
      logLevel: option("--log-level", logLevelParser),
    });

    // Mode NOT provided - derived parser should use its defaultValue ("dev")
    const result = await parseAsync(parser, ["--log-level", "debug"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, undefined);
      assert.equal(result.value.logLevel, "debug");
    }
  });

  test("withDefault() dependency source", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: withDefault(option("--mode", modeParser), "prod" as const),
      logLevel: option("--log-level", logLevelParser),
    });

    // Mode NOT provided - withDefault gives "prod", derived parser now sees this
    // and accepts prod-mode values (quiet, silent)
    const result = await parseAsync(parser, ["--log-level", "quiet"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "prod");
      // Now derived parser sees the withDefault value
      assert.equal(result.value.logLevel, "quiet");
    }
  });

  test("multiple() dependency source - uses last value", async () => {
    const tagsParser = dependency(string({ metavar: "TAG" }));
    const prefixParser = tagsParser.derive({
      metavar: "PREFIX",
      mode: "sync",
      factory: (tag: string) =>
        choice([`${tag}-alpha`, `${tag}-beta`, `${tag}-stable`] as const),
      defaultValue: () => "v1",
    });

    const parser = object({
      tags: multiple(option("--tag", tagsParser)),
      prefix: option("--prefix", prefixParser),
    });

    // Multiple tags provided - dependency uses the last value (like typical
    // CLI behavior where later options override earlier ones)
    const result = await parseAsync(parser, [
      "--tag",
      "v2",
      "--tag",
      "v3",
      "--prefix",
      "v3-beta",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.value.tags, ["v2", "v3"]);
      // The derived parser works with the last tag value
      assert.equal(result.value.prefix, "v3-beta");
    }
  });

  test("empty input uses default values", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: optional(option("--mode", modeParser)),
      logLevel: optional(option("--log-level", logLevelParser)),
    });

    // Empty input - all options are optional
    const result = await parseAsync(parser, []);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, undefined);
      assert.equal(result.value.logLevel, undefined);
    }
  });
});

// =============================================================================
// Error Cases
// =============================================================================

describe("Error cases with dependencies", () => {
  test("derived parser without dependency source in same object fails gracefully", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Only derived parser, no source - should use defaultValue
    const parser = object({
      logLevel: option("--log-level", logLevelParser),
    });

    // Should work with defaultValue ("dev")
    const result = await parseAsync(parser, ["--log-level", "debug"]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.logLevel, "debug");
    }

    // Should fail with prod-only values since defaultValue is "dev"
    const result2 = await parseAsync(parser, ["--log-level", "quiet"]);
    assert.ok(!result2.success);
  });

  test("factory that throws for default value does not throw during derive()", () => {
    // derive() should not call the factory during construction.
    // The factory is only called at parse/suggest time.
    const modeParser = dependency(choice(["dev", "prod"] as const));

    // Construction should succeed even though the factory always throws
    const derived = modeParser.derive({
      metavar: "VALUE",
      mode: "sync",
      factory: (_mode: "dev" | "prod") => {
        throw new Error("Factory error");
      },
      defaultValue: () => "dev" as const,
    });

    // The factory error should surface at parse time, not construction time
    assert.ok(derived);
    const result = derived.parse("anything");
    assert.ok(!result.success);
    if (!result.success) {
      assert.deepEqual(
        result.error,
        message`Derived parser error: ${"Factory error"}`,
      );
    }
  });

  test("invalid value for derived parser shows appropriate error", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // "info" is not valid for either dev or prod
    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "info",
    ]);
    assert.ok(!result.success);
  });

  test("mismatched dependency value and derived parser value", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
    });

    // "quiet" is only valid for prod, but mode is dev
    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "quiet",
    ]);
    assert.ok(!result.success);
  });
});

// =============================================================================
// format() Method Tests
// =============================================================================

describe("format() method with dependencies", () => {
  test("derived parser format() uses factory with default value", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // format() should work with values valid for the default mode
    const formatted = logLevelParser.format("debug");
    assert.equal(formatted, "debug");
  });

  test("deriveFrom format() uses factory with default values", () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const regionParser = dependency(choice(["us", "eu"] as const));

    const endpointParser = deriveFrom({
      metavar: "ENDPOINT",
      mode: "sync",
      dependencies: [envParser, regionParser] as const,
      factory: (env, region) =>
        choice([`${env}-${region}.example.com`] as const),
      defaultValues: () => ["dev", "us"] as const,
    });

    const formatted = endpointParser.format("dev-us.example.com");
    assert.equal(formatted, "dev-us.example.com");
  });

  test("async derived parser format() returns Promise", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.deriveAsync({
      metavar: "LEVEL",
      // deriveAsync factory returns async ValueParser, not Promise<ValueParser>
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const formatted = await logLevelParser.format("debug");
    assert.equal(formatted, "debug");
  });
});

// =============================================================================
// suggest() Advanced Tests
// =============================================================================

describe("suggest() advanced tests with dependencies", () => {
  test("suggest() in object context uses dependency default", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    // Direct suggest on derived parser
    const suggestions: Suggestion[] = [];
    for (const suggestion of logLevelParser.suggest!("")) {
      suggestions.push(suggestion);
    }

    // With default "dev", should suggest dev options
    const texts = suggestions
      .filter((s) => s.kind === "literal")
      .map((s) => s.text);
    assert.ok(texts.includes("debug"));
    assert.ok(texts.includes("verbose"));
    assert.ok(!texts.includes("quiet"));
    assert.ok(!texts.includes("silent"));
  });

  test("suggest() filters by prefix", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (mode: "dev" | "prod") =>
        choice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const suggestions: Suggestion[] = [];
    for (const suggestion of logLevelParser.suggest!("v")) {
      suggestions.push(suggestion);
    }

    // Only "verbose" starts with "v"
    const texts = suggestions
      .filter((s) => s.kind === "literal")
      .map((s) => s.text);
    assert.ok(texts.includes("verbose"));
    assert.ok(!texts.includes("debug"));
  });

  test("async suggest() works correctly", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const logLevelParser = modeParser.deriveAsync({
      metavar: "LEVEL",
      // deriveAsync factory returns async ValueParser, not Promise<ValueParser>
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
        ),
      defaultValue: () => "dev" as const,
    });

    const suggestions: Suggestion[] = [];
    for await (const suggestion of logLevelParser.suggest!("d")) {
      suggestions.push(suggestion);
    }

    const texts = suggestions
      .filter((s) => s.kind === "literal")
      .map((s) => s.text);
    assert.ok(texts.includes("debug"));
  });

  test("deriveFrom suggest() uses all default values", () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const regionParser = dependency(choice(["us", "eu"] as const));

    const endpointParser = deriveFrom({
      metavar: "ENDPOINT",
      mode: "sync",
      dependencies: [envParser, regionParser] as const,
      factory: (env, region) =>
        choice(
          [
            `${env}-${region}-1.example.com`,
            `${env}-${region}-2.example.com`,
          ] as const,
        ),
      defaultValues: () => ["dev", "us"] as const,
    });

    const suggestions: Suggestion[] = [];
    for (const suggestion of endpointParser.suggest!("")) {
      suggestions.push(suggestion);
    }

    const texts = suggestions
      .filter((s) => s.kind === "literal")
      .map((s) => s.text);
    assert.ok(texts.includes("dev-us-1.example.com"));
    assert.ok(texts.includes("dev-us-2.example.com"));
  });
});

// =============================================================================
// Async Combinations
// =============================================================================

describe("Async combinations with dependencies", () => {
  test("async factory with or() combinator", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    // deriveAsync factory returns async ValueParser, not Promise<ValueParser>
    const logLevelParser = modeParser.deriveAsync({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
          1, // delay
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = or(
      object({
        kind: constant("advanced" as const),
        mode: option("--mode", modeParser),
        logLevel: option("--log-level", logLevelParser),
      }),
      object({
        kind: constant("simple" as const),
      }),
    );

    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--log-level",
      "silent",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.kind, "advanced");
    }
  });

  test("async factory with merge() combinator", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    // deriveAsync factory returns async ValueParser, not Promise<ValueParser>
    const logLevelParser = modeParser.deriveAsync({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
          1, // delay
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = merge(
      object({ mode: option("--mode", modeParser) }),
      object({ logLevel: option("--log-level", logLevelParser) }),
    );

    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "verbose",
    ]);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value.mode, "dev");
      assert.equal(result.value.logLevel, "verbose");
    }
  });

  test("async factory with command() combinator", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    // deriveAsync factory returns async ValueParser, not Promise<ValueParser>
    const logLevelParser = modeParser.deriveAsync({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        asyncChoice(
          mode === "dev"
            ? (["debug", "verbose"] as const)
            : (["quiet", "silent"] as const),
          1, // delay
        ),
      defaultValue: () => "dev" as const,
    });

    const parser = command(
      "run",
      object({
        mode: option("--mode", modeParser),
        logLevel: option("--log-level", logLevelParser),
      }),
    );

    const result = await parseAsync(parser, [
      "run",
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

  test("multiple async derived parsers resolve concurrently", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    let activeParses = 0;
    let sawOverlap = false;

    const trackOverlap = async <T>(run: () => Promise<T>): Promise<T> => {
      activeParses += 1;
      if (activeParses > 1) {
        sawOverlap = true;
      }
      try {
        return await run();
      } finally {
        activeParses -= 1;
      }
    };

    // deriveAsync factory returns async ValueParser, not Promise<ValueParser>
    // Each parser delays by 50ms.  The assertion below checks for actual
    // overlapping execution instead of relying on wall-clock timing, which
    // can fluctuate under repository-wide test load.
    const logLevelParser = modeParser.deriveAsync({
      metavar: "LEVEL",
      factory: (mode: "dev" | "prod") =>
        ({
          $mode: "async",
          metavar: "LEVEL" as NonEmptyString,
          placeholder: (mode === "dev" ? "debug" : "quiet") as
            | "debug"
            | "quiet",
          async parse(input: string) {
            return await trackOverlap(async () =>
              await asyncChoice(
                mode === "dev"
                  ? (["debug", "verbose"] as const)
                  : (["quiet", "silent"] as const),
                50,
              ).parse(input)
            );
          },
          format(value: "debug" | "verbose" | "quiet" | "silent") {
            return value;
          },
        }) satisfies ValueParser<
          "async",
          "debug" | "verbose" | "quiet" | "silent"
        >,
      defaultValue: () => "dev" as const,
    });

    const portParser = modeParser.deriveAsync({
      metavar: "PORT",
      factory: (mode: "dev" | "prod") =>
        ({
          $mode: "async",
          metavar: "PORT" as NonEmptyString,
          placeholder: mode === "dev" ? 3000 : 80,
          async parse(input: string) {
            return await trackOverlap(async () =>
              await asyncInteger(mode === "dev" ? 3000 : 80, 65535, 50)
                .parse(input)
            );
          },
          format(value: number) {
            return String(value);
          },
        }) satisfies ValueParser<"async", number>,
      defaultValue: () => "dev" as const,
    });

    const parser = object({
      mode: option("--mode", modeParser),
      logLevel: option("--log-level", logLevelParser),
      port: option("--port", portParser),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--log-level",
      "debug",
      "--port",
      "3000",
    ]);

    assert.ok(result.success);
    assert.ok(
      sawOverlap,
      "Expected async derived parsers to overlap while parsing.",
    );
  });
});

describe("suggestWithDependency double factory failure", () => {
  test("does not throw when factory fails for both dependency and default values", () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    // Factory that always throws regardless of the dependency value.
    const derived = modeParser.derive({
      metavar: "VALUE",
      mode: "sync",
      factory: (mode: "dev" | "prod") => {
        throw new Error(`Factory broken: ${mode}`);
      },
      defaultValue: () => "dev" as const,
    });

    // suggestWithDependency should not throw even when both calls fail.
    const suggestFn = derived[suggestWithDependency];
    assert.ok(suggestFn != null);
    const suggestions = [
      ...(suggestFn("d", "prod" as "dev" | "prod") as Iterable<Suggestion>),
    ];
    assert.deepEqual(suggestions, []);
  });
});

describe("coverage-guided dependency parser tests", () => {
  async function collectSuggestions(
    suggestions: Iterable<Suggestion> | AsyncIterable<Suggestion>,
  ): Promise<readonly Suggestion[]> {
    const result: Suggestion[] = [];
    for await (const suggestion of suggestions) {
      result.push(suggestion);
    }
    return result;
  }

  test("deriveFrom variants should handle empty dependency lists", async () => {
    const derived = deriveFrom({
      metavar: "VALUE",
      mode: "sync",
      dependencies: [] as const,
      factory: () => choice(["alpha", "beta"] as const),
      defaultValues: () => [] as const,
    });
    assert.equal(derived.$mode, "sync");
    assert.equal(typeof derived[dependencyId], "symbol");

    const parsedSync = derived.parse("alpha");
    assert.ok(parsedSync.success);
    assert.equal(derived.format("beta"), "beta");

    const syncSuggestions = [...(derived.suggest?.("a") ?? [])]
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);
    assert.ok(syncSuggestions.includes("alpha"));

    const derivedSync = deriveFromSync({
      metavar: "VALUE",
      dependencies: [] as const,
      factory: () => choice(["alpha", "beta"] as const),
      defaultValues: () => [] as const,
    });
    assert.equal(derivedSync.$mode, "sync");
    assert.equal(typeof derivedSync[dependencyId], "symbol");
    const parsedFromSync = derivedSync.parse("beta");
    assert.ok(parsedFromSync.success);

    const derivedAsync = deriveFromAsync({
      metavar: "VALUE",
      dependencies: [] as const,
      factory: () => asyncChoice(["alpha", "beta"] as const),
      defaultValues: () => [] as const,
    });
    assert.equal(derivedAsync.$mode, "async");
    assert.equal(typeof derivedAsync[dependencyId], "symbol");

    const parsedAsync = await derivedAsync.parse("beta");
    assert.ok(parsedAsync.success);
    const parsedWithDependency = await derivedAsync[parseWithDependency](
      "alpha",
      [] as const,
    );
    assert.ok(parsedWithDependency.success);
    assert.equal(derivedAsync.format("alpha"), "alpha");

    const asyncSuggestions: Suggestion[] = [];
    for await (const suggestion of derivedAsync.suggest!("b")) {
      asyncSuggestions.push(suggestion);
    }
    const asyncTexts = asyncSuggestions
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);
    assert.ok(asyncTexts.includes("beta"));
  });

  test("deriveFrom sync parser should reject async parser mode at parse time", async () => {
    // Intentionally declare mode: "sync" but return an async parser from the
    // factory to test runtime mode-mismatch detection.
    const derived = deriveFrom<readonly [], "ok", "sync">({
      metavar: "VALUE",
      mode: "sync",
      dependencies: [] as const,
      // @ts-expect-error: intentional sync/async mode mismatch coverage.
      factory: () => {
        return asyncChoice(["ok"] as const);
      },
      defaultValues: () => [] as const,
    });

    const result = await derived.parse("ok");
    assert.ok(!result.success);
    if (!result.success) {
      assert.deepEqual(
        result.error,
        message`Factory returned an async parser where a sync parser is required.`,
      );
    }
  });

  test("non-Error throws should be stringified in parseWithDependency", async () => {
    const syncDependency = dependency(choice(["ok", "boom"] as const));
    const syncDerived = deriveFromSync({
      metavar: "VALUE",
      dependencies: [syncDependency] as const,
      factory: (value: "ok" | "boom") => {
        if (value === "boom") {
          throw "boom-sync";
        }
        return choice(["value"] as const);
      },
      defaultValues: () => ["ok"] as const,
    });
    const syncResult = await syncDerived[parseWithDependency](
      "value",
      [
        "boom",
      ] as const,
    );
    assert.ok(!syncResult.success);
    if (!syncResult.success) {
      assert.deepEqual(
        syncResult.error,
        message`Factory error: ${"boom-sync"}`,
      );
    }

    const asyncDependency = dependency(asyncChoice(["ok", "boom"] as const));
    const asyncFromSyncFactory = deriveFromSync({
      metavar: "VALUE",
      dependencies: [asyncDependency] as const,
      factory: (value: "ok" | "boom") => {
        if (value === "boom") {
          throw "boom-async-from-sync";
        }
        return choice(["value"] as const);
      },
      defaultValues: () => ["ok"] as const,
    });
    const asyncFromSyncResult = await asyncFromSyncFactory[parseWithDependency](
      "value",
      ["boom"] as const,
    );
    assert.ok(!asyncFromSyncResult.success);
    if (!asyncFromSyncResult.success) {
      assert.deepEqual(
        asyncFromSyncResult.error,
        message`Factory error: ${"boom-async-from-sync"}`,
      );
    }

    const modeParser = dependency(choice(["ok", "boom"] as const));
    const asyncFromAsyncFactory = modeParser.deriveAsync({
      metavar: "VALUE",
      factory: (value: "ok" | "boom") => {
        if (value === "boom") {
          throw "boom-async-from-async";
        }
        return asyncChoice(["value"] as const);
      },
      defaultValue: () => "ok" as const,
    });
    const asyncFromAsyncResult = await asyncFromAsyncFactory[
      parseWithDependency
    ]("value", "boom");
    assert.ok(!asyncFromAsyncResult.success);
    if (!asyncFromAsyncResult.success) {
      assert.deepEqual(
        asyncFromAsyncResult.error,
        message`Factory error: ${"boom-async-from-async"}`,
      );
    }

    const asyncModeParser = dependency(asyncChoice(["ok", "boom"] as const));
    const asyncSingleFromSyncFactory = asyncModeParser.derive({
      metavar: "VALUE",
      mode: "sync",
      factory: (value: "ok" | "boom") => {
        if (value === "boom") {
          throw "boom-single-async-from-sync";
        }
        return choice(["value"] as const);
      },
      defaultValue: () => "ok" as const,
    });
    const asyncSingleFromSyncResult = await asyncSingleFromSyncFactory[
      parseWithDependency
    ]("value", "boom");
    assert.ok(!asyncSingleFromSyncResult.success);
    if (!asyncSingleFromSyncResult.success) {
      assert.deepEqual(
        asyncSingleFromSyncResult.error,
        message`Factory error: ${"boom-single-async-from-sync"}`,
      );
    }
  });

  test("sync derived parsers should reject async parser mode in parse paths", async () => {
    const modeParser = dependency(choice(["sync", "async"] as const));
    const envParser = dependency(choice(["dev", "prod"] as const));
    // Intentionally set mode: "sync" while the factory returns an async parser,
    // to test the runtime mode-mismatch detection in parse paths.
    const multiDerived = deriveFrom<
      readonly [typeof modeParser, typeof envParser],
      "ok",
      "sync"
    >({
      metavar: "VALUE",
      mode: "sync",
      dependencies: [modeParser, envParser] as const,
      // @ts-expect-error: intentional sync/async mode mismatch coverage.
      factory: (
        _mode: "sync" | "async",
        _env: "dev" | "prod",
      ) => {
        return asyncChoice(["ok"] as const);
      },
      defaultValues: () => ["sync", "dev"] as const,
    });

    const multiResult = await multiDerived[parseWithDependency](
      "ok",
      ["async", "dev"] as const,
    );
    assert.ok(!multiResult.success);
    if (!multiResult.success) {
      assert.deepEqual(
        multiResult.error,
        message`Factory returned an async parser where a sync parser is required.`,
      );
    }

    // Intentionally declare mode: "sync" while factory returns async parser
    // to test runtime mode-mismatch detection in single derive.
    const singleDerived = modeParser.derive<"ok", "sync">({
      metavar: "VALUE",
      mode: "sync",
      // @ts-expect-error: intentional sync/async mode mismatch coverage.
      factory: (_mode: "sync" | "async") => {
        return asyncChoice(["ok"] as const);
      },
      defaultValue: () => "sync" as const,
    });

    const singleResult = await singleDerived.parse("ok");
    assert.ok(!singleResult.success);
    if (!singleResult.success) {
      assert.deepEqual(
        singleResult.error,
        message`Factory returned an async parser where a sync parser is required.`,
      );
    }
  });

  test("sync derived parsers should reject promise-like parse results", () => {
    const modeParser = dependency(choice(["sync", "async"] as const));
    const envParser = dependency(choice(["dev", "prod"] as const));
    const multiDerived = deriveFromSync({
      metavar: "VALUE",
      dependencies: [modeParser, envParser] as const,
      factory: () => ({
        $mode: "sync" as const,
        metavar: "VALUE",
        placeholder: "ok" as const,
        parse(_input: string): ValueParserResult<"ok"> {
          // @ts-expect-error: intentional sync Promise regression coverage.
          return Promise.resolve({
            success: true as const,
            value: "ok" as const,
          });
        },
        format(value: "ok"): string {
          return value;
        },
      }),
      defaultValues: () => ["sync", "dev"] as const,
    });

    assert.throws(() => multiDerived.parse("ok"), {
      name: "TypeError",
      message: /promise-like result/i,
    });
    assert.throws(
      () => multiDerived[parseWithDependency]("ok", ["sync", "dev"] as const),
      {
        name: "TypeError",
        message: /promise-like result/i,
      },
    );

    const singleDerived = modeParser.derive({
      metavar: "VALUE",
      mode: "sync",
      factory: () => {
        return {
          $mode: "sync" as const,
          metavar: "VALUE",
          placeholder: "ok" as const,
          parse(_input: string): ValueParserResult<"ok"> {
            // @ts-expect-error: intentional sync Promise regression coverage.
            return Promise.resolve({
              success: true as const,
              value: "ok" as const,
            });
          },
          format(value: "ok"): string {
            return value;
          },
        };
      },
      defaultValue: () => "sync" as const,
    });

    assert.throws(() => singleDerived.parse("ok"), {
      name: "TypeError",
      message: /promise-like result/i,
    });
    assert.throws(() => singleDerived[parseWithDependency]("ok", "sync"), {
      name: "TypeError",
      message: /promise-like result/i,
    });
  });

  test("suggestWithDependency should return empty when both factories fail", async () => {
    const envParser = dependency(choice(["dev", "prod"] as const));
    const regionParser = dependency(choice(["local", "remote"] as const));

    const multiSync = deriveFrom({
      metavar: "VALUE",
      mode: "sync",
      dependencies: [envParser, regionParser] as const,
      factory: (_env: "dev" | "prod", _region: "local" | "remote") => {
        throw new Error("deriveFrom failed");
      },
      defaultValues: () => ["dev", "local"] as const,
    });
    const multiSyncSuggest = multiSync[suggestWithDependency];
    assert.ok(multiSyncSuggest != null);
    assert.deepEqual(
      [
        ...(multiSyncSuggest("v", ["prod", "remote"] as const) as Iterable<
          Suggestion
        >),
      ],
      [],
    );

    let deriveFromAsyncCalls = 0;
    const multiAsyncFactory = deriveFromAsync({
      metavar: "VALUE",
      dependencies: [envParser, regionParser] as const,
      factory: (_env: "dev" | "prod", _region: "local" | "remote") => {
        deriveFromAsyncCalls++;
        throw new Error(`deriveFromAsync failed ${deriveFromAsyncCalls}`);
      },
      defaultValues: () => ["dev", "local"] as const,
    });
    const multiAsyncSuggest = multiAsyncFactory[suggestWithDependency];
    assert.ok(multiAsyncSuggest != null);
    assert.deepEqual(
      await collectSuggestions(
        multiAsyncSuggest("v", ["prod", "remote"] as const),
      ),
      [],
    );

    const asyncEnvParser = dependency(asyncChoice(["dev", "prod"] as const));
    const asyncRegionParser = dependency(
      asyncChoice(["local", "remote"] as const),
    );
    let deriveFromSyncCalls = 0;
    const multiAsyncFromSync = deriveFromSync({
      metavar: "VALUE",
      dependencies: [asyncEnvParser, asyncRegionParser] as const,
      factory: (_env: "dev" | "prod", _region: "local" | "remote") => {
        deriveFromSyncCalls++;
        throw new Error(`deriveFromSync failed ${deriveFromSyncCalls}`);
      },
      defaultValues: () => ["dev", "local"] as const,
    });
    const multiAsyncFromSyncSuggest = multiAsyncFromSync[suggestWithDependency];
    assert.ok(multiAsyncFromSyncSuggest != null);
    assert.deepEqual(
      await collectSuggestions(
        multiAsyncFromSyncSuggest("v", ["prod", "remote"] as const),
      ),
      [],
    );

    const modeParser = dependency(choice(["ok", "boom"] as const));
    const singleAsyncFactory = modeParser.deriveAsync({
      metavar: "VALUE",
      factory: (_mode: "ok" | "boom") => {
        // deriveAsync() no longer calls the factory during construction,
        // so every call here comes from suggest/suggestWithDependency.
        throw new Error("single async factory always fails");
      },
      defaultValue: () => "ok" as const,
    });
    const singleAsyncFactorySuggest = singleAsyncFactory[suggestWithDependency];
    assert.ok(singleAsyncFactorySuggest != null);
    assert.deepEqual(
      await collectSuggestions(singleAsyncFactorySuggest("v", "boom")),
      [],
    );

    const asyncModeParser = dependency(asyncChoice(["ok", "boom"] as const));
    const singleAsyncSource = asyncModeParser.derive({
      metavar: "VALUE",
      mode: "sync",
      factory: (_mode: "ok" | "boom") => {
        throw new Error("single async source failed");
      },
      defaultValue: () => "ok" as const,
    });
    const singleAsyncSourceSuggest = singleAsyncSource[suggestWithDependency];
    assert.ok(singleAsyncSourceSuggest != null);
    assert.deepEqual(
      await collectSuggestions(singleAsyncSourceSuggest("v", "boom")),
      [],
    );
  });

  test("suggestWithDependency should fall back to defaults for deriveFromAsync", async () => {
    const modeParser = dependency(choice(["ok", "boom"] as const));
    const derived = deriveFromAsync({
      metavar: "VALUE",
      dependencies: [modeParser] as const,
      factory: (value: "ok" | "boom") => {
        if (value === "boom") {
          throw new Error("dependency failure");
        }
        return asyncChoice(["ok-default", "ok-extra"] as const);
      },
      defaultValues: () => ["ok"] as const,
    });

    const suggestWithDep = derived[suggestWithDependency];
    assert.ok(suggestWithDep != null);
    const suggestions = await collectSuggestions(
      suggestWithDep("ok", ["boom"] as const),
    );

    const texts = suggestions
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);
    assert.ok(texts.includes("ok-default"));
    assert.ok(texts.includes("ok-extra"));
  });

  test("async-from-sync deriveFrom should expose suggest paths", async () => {
    const modeParser = dependency(asyncChoice(["ok", "boom"] as const));
    const derived = deriveFromSync({
      metavar: "VALUE",
      dependencies: [modeParser] as const,
      factory: (value: "ok" | "boom") => {
        if (value === "boom") {
          throw new Error("dependency failure");
        }
        return choice(["ok-default", "ok-extra"] as const);
      },
      defaultValues: () => ["ok"] as const,
    });

    const suggestions: Suggestion[] = [];
    for await (const suggestion of derived.suggest!("ok")) {
      suggestions.push(suggestion);
    }
    const directTexts = suggestions
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);
    assert.ok(directTexts.includes("ok-default"));

    const suggestWithDep = derived[suggestWithDependency];
    assert.ok(suggestWithDep != null);
    const fromDependency = await collectSuggestions(
      suggestWithDep("ok", ["boom"] as const),
    );
    const dependencyTexts = fromDependency
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);
    assert.ok(dependencyTexts.includes("ok-default"));
  });

  test("async-source derive should support format and suggest fallback", async () => {
    const modeParser = dependency(asyncChoice(["ok", "boom"] as const));
    const derived = modeParser.derive({
      metavar: "VALUE",
      mode: "sync",
      factory: (value: "ok" | "boom") => {
        if (value === "boom") {
          throw new Error("dependency failure");
        }
        return choice(["ok-default", "ok-extra"] as const);
      },
      defaultValue: () => "ok" as const,
    });

    assert.equal(derived.format("ok-default"), "ok-default");

    const suggestions: Suggestion[] = [];
    for await (const suggestion of derived.suggest!("ok")) {
      suggestions.push(suggestion);
    }
    const directTexts = suggestions
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);
    assert.ok(directTexts.includes("ok-default"));

    const suggestWithDep = derived[suggestWithDependency];
    assert.ok(suggestWithDep != null);
    const fromDependency = await collectSuggestions(
      suggestWithDep("ok", "boom"),
    );
    const dependencyTexts = fromDependency
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);
    assert.ok(dependencyTexts.includes("ok-default"));
  });

  test("factory Error throws should be normalized in dependency parse paths", async () => {
    const modeParser = dependency(choice(["ok", "boom"] as const));
    const regionParser = dependency(choice(["us", "eu"] as const));

    const syncDerived = deriveFromSync({
      metavar: "VALUE",
      dependencies: [modeParser, regionParser] as const,
      factory: (mode: "ok" | "boom", _region: "us" | "eu") => {
        if (mode === "boom") {
          throw new Error("sync-factory-error");
        }
        return choice(["value"] as const);
      },
      defaultValues: () => ["ok", "us"] as const,
    });
    const syncResult = await syncDerived[parseWithDependency](
      "value",
      ["boom", "us"] as const,
    );
    assert.ok(!syncResult.success);
    if (!syncResult.success) {
      assert.deepEqual(
        syncResult.error,
        message`Factory error: ${"sync-factory-error"}`,
      );
    }

    const asyncDep = dependency(asyncChoice(["ok", "boom"] as const));
    const asyncSingle = asyncDep.derive({
      metavar: "VALUE",
      mode: "sync",
      factory: (mode: "ok" | "boom") => {
        if (mode === "boom") {
          throw new Error("single-async-source-error");
        }
        return choice(["value"] as const);
      },
      defaultValue: () => "ok" as const,
    });
    const asyncSingleResult = await asyncSingle[parseWithDependency](
      "value",
      "boom",
    );
    assert.ok(!asyncSingleResult.success);
    if (!asyncSingleResult.success) {
      assert.deepEqual(
        asyncSingleResult.error,
        message`Factory error: ${"single-async-source-error"}`,
      );
    }
  });

  test("deriveFromSync async mode should use defaults for format and suggest", async () => {
    const modeParser = dependency(asyncChoice(["dev", "prod"] as const));
    const regionParser = dependency(asyncChoice(["ap", "eu"] as const));
    const derived = deriveFromSync({
      metavar: "VALUE",
      dependencies: [modeParser, regionParser] as const,
      factory: (mode: "dev" | "prod", region: "ap" | "eu") =>
        choice([`${mode}-${region}`] as const),
      defaultValues: () => ["dev", "ap"] as const,
    });

    assert.equal(derived.format("dev-ap"), "dev-ap");

    const suggestions = await collectSuggestions(derived.suggest!("dev"));
    const texts = suggestions
      .filter((suggestion) => suggestion.kind === "literal")
      .map((suggestion) => suggestion.text);
    assert.ok(texts.includes("dev-ap"));
  });
});

describe("property-based tests", () => {
  const propertyParameters = { numRuns: 120 } as const;

  test("DependencyRegistry should match map-model semantics", () => {
    const operationArbitrary = fc.oneof(
      fc.record({
        kind: fc.constant<"set">("set"),
        key: fc.integer({ min: 0, max: 4 }),
        value: fc.string({ minLength: 0, maxLength: 16 }),
      }),
      fc.record({
        kind: fc.constant<"get">("get"),
        key: fc.integer({ min: 0, max: 4 }),
      }),
      fc.record({
        kind: fc.constant<"has">("has"),
        key: fc.integer({ min: 0, max: 4 }),
      }),
      fc.record({
        kind: fc.constant<"cloneSet">("cloneSet"),
        key: fc.integer({ min: 0, max: 4 }),
        value: fc.string({ minLength: 0, maxLength: 16 }),
      }),
    );

    fc.assert(
      fc.property(
        fc.array(operationArbitrary, { minLength: 0, maxLength: 120 }),
        (operations) => {
          const symbols = Array.from(
            { length: 5 },
            (_unused, index) => Symbol(`dep-${index}`),
          );
          const registry = new DependencyRegistry();
          const model = new Map<number, string>();

          for (const operation of operations) {
            if (operation.kind === "set") {
              registry.set(symbols[operation.key], operation.value);
              model.set(operation.key, operation.value);
              continue;
            }

            if (operation.kind === "get") {
              assert.equal(
                registry.get<string>(symbols[operation.key]),
                model.get(operation.key),
              );
              continue;
            }

            if (operation.kind === "has") {
              assert.equal(
                registry.has(symbols[operation.key]),
                model.has(operation.key),
              );
              continue;
            }

            const clone = registry.clone();
            for (let i = 0; i < symbols.length; i++) {
              assert.equal(clone.get<string>(symbols[i]), model.get(i));
              assert.equal(clone.has(symbols[i]), model.has(i));
            }

            clone.set(symbols[operation.key], operation.value);
            assert.equal(
              clone.get<string>(symbols[operation.key]),
              operation.value,
            );
            assert.equal(
              registry.get<string>(symbols[operation.key]),
              model.get(operation.key),
            );
          }
        },
      ),
      propertyParameters,
    );
  });
});

// https://github.com/dahlia/optique/issues/225
describe("deriveSync/deriveFromSync/deriveFromAsync: factory default branch not touched when dependency provided", () => {
  test("deriveSync() does not call factory with default when dependency is provided", () => {
    const mode = dependency(choice(["safe", "broken"] as const));
    const derived = mode.deriveSync({
      metavar: "VALUE",
      factory: (value) => {
        if (value === "broken") {
          throw new Error("broken default branch should not be touched");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValue: () => "broken" as const,
    });
    const parser = object({
      mode: option("--mode", mode),
      value: option("--value", derived),
    });
    const result = parseSync(parser, ["--mode", "safe", "--value", "ok"]);
    assert.ok(result.success);
    assert.deepEqual(result.value, { mode: "safe", value: "ok" });
  });

  test("deriveFromSync() does not call factory with defaults when dependencies are provided", () => {
    const a = dependency(choice(["safe", "broken"] as const));
    const b = dependency(integer({ metavar: "N" }));
    const derived = deriveFromSync({
      metavar: "VALUE",
      dependencies: [a, b] as const,
      factory: (aVal, _bVal) => {
        if (aVal === "broken") {
          throw new Error("broken default branch should not be touched");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValues: () => ["broken" as const, 0] as const,
    });
    const parser = object({
      a: option("--a", a),
      b: option("--b", b),
      value: option("--value", derived),
    });
    const result = parseSync(parser, [
      "--a",
      "safe",
      "--b",
      "1",
      "--value",
      "ok",
    ]);
    assert.ok(result.success);
    assert.deepEqual(result.value, { a: "safe", b: 1, value: "ok" });
  });

  test("deriveFromAsync() does not call factory with defaults when dependencies are provided", async () => {
    const asyncString: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VALUE" as NonEmptyString,
      placeholder: "",
      parse(input: string): Promise<ValueParserResult<string>> {
        return Promise.resolve({ success: true, value: input });
      },
      format(value: string): string {
        return value;
      },
    };
    const a = dependency(choice(["safe", "broken"] as const));
    const b = dependency(integer({ metavar: "N" }));
    const derived = deriveFromAsync({
      metavar: "VALUE",
      dependencies: [a, b] as const,
      factory: (aVal, _bVal) => {
        if (aVal === "broken") {
          throw new Error("broken default branch should not be touched");
        }
        return asyncString;
      },
      defaultValues: () => ["broken" as const, 0] as const,
    });
    const parser = object({
      a: option("--a", a),
      b: option("--b", b),
      value: option("--value", derived),
    });
    const result = await parseAsync(parser, [
      "--a",
      "safe",
      "--b",
      "1",
      "--value",
      "ok",
    ]);
    assert.ok(result.success);
    assert.deepEqual(result.value, { a: "safe", b: 1, value: "ok" });
  });

  test("derive() throws TypeError when mode is omitted at runtime", () => {
    const source = dependency(choice(["a", "b"] as const));
    assert.throws(
      () => {
        // Simulate a JavaScript caller that omits mode:
        source.derive(
          {
            metavar: "VALUE",
            factory: () => choice(["x"] as const),
            defaultValue: () => "a" as const,
            // deno-lint-ignore no-explicit-any
          } as any,
        );
      },
      (err: unknown) =>
        err instanceof TypeError &&
        err.message.includes("derive()") &&
        err.message.includes("mode"),
    );
  });

  test("deriveFrom() throws TypeError when mode is omitted at runtime", () => {
    assert.throws(
      () => {
        // Simulate a JavaScript caller that omits mode:
        deriveFrom(
          {
            metavar: "VALUE",
            dependencies: [] as const,
            factory: () => choice(["x"] as const),
            defaultValues: () => [] as const,
            // deno-lint-ignore no-explicit-any
          } as any,
        );
      },
      (err: unknown) =>
        err instanceof TypeError &&
        err.message.includes("deriveFrom()") &&
        err.message.includes("mode"),
    );
  });

  test("derive() does not call factory during construction", () => {
    // derive() should not call the factory during construction.
    // Even if the factory throws for the default value, construction succeeds.
    const mode = dependency(choice(["safe", "broken"] as const));
    const derived = mode.derive({
      metavar: "VALUE",
      mode: "sync",
      factory: (value) => {
        if (value === "broken") {
          throw new Error("broken default branch");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValue: () => "broken" as const,
    });
    assert.ok(derived);
  });

  test("derive() with explicit mode: 'sync' does not call factory during construction", () => {
    let factoryCalls = 0;
    const mode = dependency(choice(["safe", "broken"] as const));
    const derived = mode.derive({
      metavar: "VALUE",
      mode: "sync",
      factory: (value) => {
        factoryCalls++;
        if (value === "broken") {
          throw new Error("broken default branch");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValue: () => "broken" as const,
    });
    assert.equal(factoryCalls, 0);
    assert.equal(derived.$mode, "sync");
  });

  test("derive() with explicit mode: 'async' does not call factory during construction", () => {
    let factoryCalls = 0;
    const mode = dependency(choice(["safe", "broken"] as const));
    const derived = mode.derive({
      metavar: "VALUE",
      mode: "async",
      factory: (value) => {
        factoryCalls++;
        if (value === "broken") {
          throw new Error("broken default branch");
        }
        return asyncChoice(["a", "b"]);
      },
      defaultValue: () => "broken" as const,
    });
    assert.equal(factoryCalls, 0);
    assert.equal(derived.$mode, "async");
  });

  test("deriveAsync() does not throw during construction when factory throws for default value", async () => {
    const asyncString: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "VALUE" as NonEmptyString,
      placeholder: "",
      parse(input: string): Promise<ValueParserResult<string>> {
        return Promise.resolve({ success: true, value: input });
      },
      format(value: string): string {
        return value;
      },
    };
    const mode = dependency(choice(["safe", "broken"] as const));
    const derived = mode.deriveAsync({
      metavar: "VALUE",
      factory: (value) => {
        if (value === "broken") {
          throw new Error("broken default branch should not be touched");
        }
        return asyncString;
      },
      defaultValue: () => "broken" as const,
    });
    const parser = object({
      mode: option("--mode", mode),
      value: option("--value", derived),
    });
    const result = await parseAsync(parser, [
      "--mode",
      "safe",
      "--value",
      "ok",
    ]);
    assert.ok(result.success);
    assert.deepEqual(result.value, { mode: "safe", value: "ok" });
  });

  test("deriveFrom() does not call factory during construction", () => {
    // deriveFrom() should not call the factory during construction.
    const a = dependency(choice(["safe", "broken"] as const));
    const b = dependency(integer({ metavar: "N" }));
    const derived = deriveFrom({
      metavar: "VALUE",
      mode: "sync",
      dependencies: [a, b] as const,
      factory: (aVal, _bVal) => {
        if (aVal === "broken") {
          throw new Error("broken default branch");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValues: () => ["broken" as const, 0] as const,
    });
    assert.ok(derived);
  });

  test("deriveFrom() with explicit mode: 'sync' does not call factory during construction", () => {
    let factoryCalls = 0;
    const a = dependency(choice(["safe", "broken"] as const));
    const b = dependency(integer({ metavar: "N" }));
    const derived = deriveFrom({
      metavar: "VALUE",
      mode: "sync",
      dependencies: [a, b] as const,
      factory: (aVal, _bVal) => {
        factoryCalls++;
        if (aVal === "broken") {
          throw new Error("broken default branch");
        }
        return string({ metavar: "VALUE" });
      },
      defaultValues: () => ["broken" as const, 0] as const,
    });
    assert.equal(factoryCalls, 0);
    assert.equal(derived.$mode, "sync");
  });

  test("deriveFrom() with explicit mode: 'async' does not call factory during construction", () => {
    let factoryCalls = 0;
    const a = dependency(choice(["safe", "broken"] as const));
    const b = dependency(integer({ metavar: "N" }));
    const derived = deriveFrom({
      metavar: "VALUE",
      mode: "async",
      dependencies: [a, b] as const,
      factory: (aVal, _bVal) => {
        factoryCalls++;
        if (aVal === "broken") {
          throw new Error("broken default branch");
        }
        return asyncChoice(["x", "y"]);
      },
      defaultValues: () => ["broken" as const, 0] as const,
    });
    assert.equal(factoryCalls, 0);
    assert.equal(derived.$mode, "async");
  });
});

describe("top-level option()/argument() with derived parsers", () => {
  // https://github.com/dahlia/optique/issues/238

  test("parseSync option() with single-derive parser succeeds", () => {
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (m) =>
        choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = option("--level", level);
    const result = parseSync(parser, ["--level", "debug"]);
    assert.ok(result.success);
    assert.equal(result.value, "debug");
  });

  test("parseSync argument() with single-derive parser succeeds", () => {
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (m) =>
        choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = argument(level);
    const result = parseSync(parser, ["verbose"]);
    assert.ok(result.success);
    assert.equal(result.value, "verbose");
  });

  test("parseSync argument() rejects invalid value for default dependency", () => {
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (m) =>
        choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = argument(level);
    const result = parseSync(parser, ["silent"]);
    assert.ok(!result.success);
  });

  test("parseAsync option() with single-derive parser succeeds", async () => {
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (m) =>
        choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = option("--level", level);
    const result = await parseAsync(parser, ["--level", "debug"]);
    assert.ok(result.success);
    assert.equal(result.value, "debug");
  });

  test("deriveFrom with option() at top level succeeds", () => {
    const env = dependency(choice(["local", "remote"] as const));
    const port = dependency(integer({ metavar: "PORT" }));
    const config = deriveFromSync({
      metavar: "CONFIG",
      dependencies: [env, port] as const,
      factory: (e, _p) =>
        choice(
          e === "local"
            ? (["dev.json", "test.json"] as const)
            : (["prod.json", "staging.json"] as const),
        ),
      defaultValues: () => ["local" as const, 8080 as const] as const,
    });
    const parser = option("--config", config);
    const result = parseSync(parser, ["--config", "dev.json"]);
    assert.ok(result.success);
    assert.equal(result.value, "dev.json");
  });

  test("deriveFrom with single dependency at top level succeeds", () => {
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = deriveFromSync({
      metavar: "LEVEL",
      dependencies: [mode] as const,
      factory: (m) =>
        choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValues: () => ["dev" as const] as const,
    });
    const parser = option("--level", level);
    const result = parseSync(parser, ["--level", "debug"]);
    assert.ok(result.success);
    assert.equal(result.value, "debug");
  });

  test("suggestSync argument() with single-derive parser", () => {
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (m) =>
        choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = argument(level);
    const suggestions = suggestSync(parser, ["d"]);
    const texts = suggestions.map((s) => "text" in s ? s.text : "");
    assert.ok(texts.includes("debug"));
  });

  test("suggestAsync option() with single-derive parser", async () => {
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (m) =>
        choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = option("--level", level);
    const suggestions = await suggestAsync(parser, ["--level", "d"]);
    const texts = suggestions.map((s) => "text" in s ? s.text : "");
    assert.ok(texts.includes("debug"));
  });

  test("parseSync top-level DependencySource option succeeds", () => {
    const src = dependency(choice(["dev", "prod"] as const));
    const parser = option("--mode", src);
    const result = parseSync(parser, ["--mode", "dev"]);
    assert.ok(result.success);
    assert.equal(result.value, "dev");
  });

  test("parseAsync top-level DependencySource option succeeds", async () => {
    const src = dependency(choice(["dev", "prod"] as const));
    const parser = option("--mode", src);
    const result = await parseAsync(parser, ["--mode", "prod"]);
    assert.ok(result.success);
    assert.equal(result.value, "prod");
  });

  test("parseSync top-level withDefault(DependencySource) option succeeds", () => {
    const src = dependency(choice(["dev", "prod"] as const));
    const parser = withDefault(option("--mode", src), "dev" as const);
    const provided = parseSync(parser, ["--mode", "prod"]);
    assert.ok(provided.success);
    assert.equal(provided.value, "prod");
    const missing = parseSync(parser, []);
    assert.ok(missing.success);
    assert.equal(missing.value, "dev");
  });

  test("parseSync top-level derive resolves via runtime defaults", () => {
    // Verify that runtime-based resolution produces the same result
    // as the old preliminaryResult fallback.  At top level, derived parsers
    // always use their default dependency value since no sibling source
    // parser exists.
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (m) =>
        choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = option("--level", level);
    // "debug" is valid for dev choices — should succeed
    const valid = parseSync(parser, ["--level", "debug"]);
    assert.ok(valid.success);
    assert.equal(valid.value, "debug");
    // "silent" is NOT valid for dev choices — should fail
    const invalid = parseSync(parser, ["--level", "silent"]);
    assert.ok(!invalid.success);
  });

  test("parseAsync top-level derive resolves via runtime defaults", async () => {
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (m) =>
        choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = option("--level", level);
    const valid = await parseAsync(parser, ["--level", "debug"]);
    assert.ok(valid.success);
    assert.equal(valid.value, "debug");
    const invalid = await parseAsync(parser, ["--level", "silent"]);
    assert.ok(!invalid.success);
  });

  test("partial dependency defaults are snapshotted once during parse", () => {
    let defaultCallCount = 0;
    const mode = dependency(choice(["dev", "prod"] as const));
    const format = dependency(choice(["json", "yaml"] as const));
    const config = deriveFromSync({
      metavar: "CONFIG",
      dependencies: [mode, format] as const,
      factory: (m, f) =>
        choice(
          m === "prod"
            ? (f === "yaml" ? ["prod.yaml"] as const : ["prod.json"] as const)
            : (f === "yaml" ? ["dev.yaml"] as const : ["dev.json"] as const),
        ),
      defaultValues: () => {
        defaultCallCount++;
        return [
          "prod" as const,
          defaultCallCount === 1 ? "json" as const : "yaml" as const,
        ] as const;
      },
    });
    const parser = object({
      mode: option("--mode", mode),
      config: option("--config", config),
    });

    const result = parseSync(parser, ["--mode", "dev", "--config", "dev.json"]);
    assert.ok(result.success);
    assert.equal(result.value.mode, "dev");
    assert.equal(result.value.config, "dev.json");
    assert.equal(defaultCallCount, 1);
  });

  test("partial dependency defaults are snapshotted once during async parse", async () => {
    let defaultCallCount = 0;
    const mode = dependency(choice(["dev", "prod"] as const));
    const format = dependency(choice(["json", "yaml"] as const));
    const config = deriveFromSync({
      metavar: "CONFIG",
      dependencies: [mode, format] as const,
      factory: (m, f) =>
        choice(
          m === "prod"
            ? (f === "yaml" ? ["prod.yaml"] as const : ["prod.json"] as const)
            : (f === "yaml" ? ["dev.yaml"] as const : ["dev.json"] as const),
        ),
      defaultValues: () => {
        defaultCallCount++;
        return [
          "prod" as const,
          defaultCallCount === 1 ? "json" as const : "yaml" as const,
        ] as const;
      },
    });
    const parser = object({
      mode: option("--mode", mode),
      config: option("--config", config),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--config",
      "dev.json",
    ]);
    assert.ok(result.success);
    assert.equal(result.value.mode, "dev");
    assert.equal(result.value.config, "dev.json");
    assert.equal(defaultCallCount, 1);
  });

  test("suggestSync top-level option with DependencySource", () => {
    const src = dependency(choice(["dev", "prod"] as const));
    const parser = option("--mode", src);
    const suggestions = suggestSync(parser, ["--mode", "d"]);
    const texts = suggestions.map((s) => "text" in s ? s.text : "");
    assert.ok(texts.includes("dev"));
  });

  test("suggestAsync top-level option with DependencySource", async () => {
    const src = dependency(choice(["dev", "prod"] as const));
    const parser = option("--mode", src);
    const suggestions = await suggestAsync(parser, ["--mode", "d"]);
    const texts = suggestions.map((s) => "text" in s ? s.text : "");
    assert.ok(texts.includes("dev"));
  });

  test("non-idempotent factory is not double-evaluated at top level", () => {
    // A factory that returns different choices on each call.  If the
    // runtime replays the factory when only defaults are available,
    // the second call could produce a different value parser that
    // rejects the input even though the first call (during parse)
    // accepted it.
    let callCount = 0;
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (m) => {
        callCount++;
        return choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        );
      },
      defaultValue: () => "dev" as const,
    });
    const parser = option("--level", level);
    callCount = 0;
    const result = parseSync(parser, ["--level", "debug"]);
    assert.ok(result.success);
    assert.equal(result.value, "debug");
    // The factory should be called exactly once (during parse), not
    // a second time during runtime resolution with the same defaults.
    assert.equal(callCount, 1);
  });

  test("non-idempotent factory is not double-evaluated at top level (async)", async () => {
    let callCount = 0;
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.derive({
      metavar: "LEVEL",
      mode: "sync",
      factory: (m) => {
        callCount++;
        return choice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        );
      },
      defaultValue: () => "dev" as const,
    });
    const parser = option("--level", level);
    callCount = 0;
    const result = await parseAsync(parser, ["--level", "debug"]);
    assert.ok(result.success);
    assert.equal(result.value, "debug");
    assert.equal(callCount, 1);
  });

  test("parseAsync top-level deriveAsync() resolves via runtime defaults", async () => {
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.deriveAsync({
      metavar: "LEVEL",
      factory: (m) =>
        asyncChoice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = option("--level", level);
    const valid = await parseAsync(parser, ["--level", "debug"]);
    assert.ok(valid.success);
    assert.equal(valid.value, "debug");
    const invalid = await parseAsync(parser, ["--level", "silent"]);
    assert.ok(!invalid.success);
  });

  test("suggestAsync top-level deriveAsync() with DependencySource", async () => {
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.deriveAsync({
      metavar: "LEVEL",
      factory: (m) =>
        asyncChoice(
          m === "dev"
            ? (["debug", "verbose"] as const)
            : (["silent", "strict"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = option("--level", level);
    const suggestions = await suggestAsync(parser, ["--level", "d"]);
    const texts = suggestions.map((s) => "text" in s ? s.text : "");
    assert.ok(texts.includes("debug"));
  });
});
