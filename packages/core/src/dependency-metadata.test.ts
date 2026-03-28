/**
 * Unit tests for dependency metadata extraction and composition.
 *
 * Part of https://github.com/dahlia/optique/issues/752
 */
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { dependency, deriveFrom } from "./dependency.ts";
import { choice } from "./valueparser.ts";
import type { NonEmptyString } from "./nonempty.ts";
import {
  composeDependencyMetadata,
  extractDependencyMetadata,
} from "./dependency-metadata.ts";

// =============================================================================
// Shared test fixtures
// =============================================================================

type Env = "dev" | "prod";

function createEnvSource() {
  return dependency(
    choice<Env>(["dev", "prod"] as const, {
      metavar: "ENV" as NonEmptyString,
    }),
  );
}

function createDerivedLogLevel(env: ReturnType<typeof createEnvSource>) {
  return env.derive({
    metavar: "LEVEL" as NonEmptyString,
    mode: "sync",
    factory: (e: Env) =>
      choice(e === "dev" ? ["debug", "info"] : ["warn", "error"], {
        metavar: "LEVEL" as NonEmptyString,
      }),
    defaultValue: (): Env => "dev",
  });
}

function createDerivedFromMulti(
  env: ReturnType<typeof createEnvSource>,
  region: ReturnType<typeof createEnvSource>,
) {
  return deriveFrom({
    metavar: "URL" as NonEmptyString,
    mode: "sync",
    dependencies: [env, region] as const,
    factory: (e: Env, r: Env) =>
      choice([`https://${e}.${r}.example.com`], {
        metavar: "URL" as NonEmptyString,
      }),
    defaultValues: (): [Env, Env] => ["dev", "dev"],
  });
}

// =============================================================================
// Tests: extractDependencyMetadata
// =============================================================================

describe("extractDependencyMetadata", () => {
  test("extracts source capability from DependencySource", () => {
    const env = createEnvSource();
    const metadata = extractDependencyMetadata(env);
    assert.ok(metadata !== undefined);
    assert.ok(metadata.source !== undefined);
    assert.equal(metadata.source.kind, "source");
    assert.equal(typeof metadata.source.sourceId, "symbol");
    assert.ok(metadata.source.preservesSourceValue);
    assert.equal(metadata.derived, undefined);
  });

  test("extracts derived capability from DerivedValueParser (derive)", () => {
    const env = createEnvSource();
    const logLevel = createDerivedLogLevel(env);
    const metadata = extractDependencyMetadata(logLevel);
    assert.ok(metadata !== undefined);
    assert.ok(metadata.derived !== undefined);
    assert.equal(metadata.derived.kind, "derived");
    assert.ok(metadata.derived.dependencyIds.length >= 1);
    assert.equal(metadata.source, undefined);
  });

  test("derived capability replayParse works", () => {
    const env = createEnvSource();
    const logLevel = createDerivedLogLevel(env);
    const metadata = extractDependencyMetadata(logLevel);
    assert.ok(metadata?.derived !== undefined);
    const result = metadata.derived.replayParse("debug", ["dev"]);
    assert.ok(!(result instanceof Promise));
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "debug");
    }
  });

  test("derived capability replayParse with invalid value", () => {
    const env = createEnvSource();
    const logLevel = createDerivedLogLevel(env);
    const metadata = extractDependencyMetadata(logLevel);
    assert.ok(metadata?.derived !== undefined);
    // "debug" is not valid when env is "prod"
    const result = metadata.derived.replayParse("debug", ["prod"]);
    assert.ok(!(result instanceof Promise));
    assert.ok(!result.success);
  });

  test("single-source derive() exposes getDefaultDependencyValues", () => {
    const env = createEnvSource();
    const logLevel = createDerivedLogLevel(env);
    const metadata = extractDependencyMetadata(logLevel);
    assert.ok(metadata?.derived !== undefined);
    assert.ok(metadata.derived.getDefaultDependencyValues !== undefined);
    const defaults = metadata.derived.getDefaultDependencyValues();
    assert.deepStrictEqual(defaults, ["dev"]);
  });

  test("single-source derive() default is not double-evaluated", () => {
    const env = createEnvSource();
    let callCount = 0;
    const derived = env.derive({
      metavar: "X" as NonEmptyString,
      mode: "sync",
      factory: (e: Env) => choice([e], { metavar: "X" as NonEmptyString }),
      defaultValue: (): Env => {
        callCount++;
        return "dev";
      },
    });
    // parse() calls defaultValue() once for the preliminary result.
    derived.parse("dev");
    const countAfterParse = callCount;
    // getDefaultDependencyValues() calls it again — but NOT during parse.
    const metadata = extractDependencyMetadata(derived);
    assert.ok(metadata?.derived?.getDefaultDependencyValues !== undefined);
    metadata.derived.getDefaultDependencyValues();
    // parse() should have called it exactly once, not twice.
    assert.equal(countAfterParse, 1);
  });

  test("derived capability from deriveFrom has multiple IDs", () => {
    const env = createEnvSource();
    const region = createEnvSource();
    const derived = createDerivedFromMulti(env, region);
    const metadata = extractDependencyMetadata(derived);
    assert.ok(metadata?.derived !== undefined);
    assert.equal(metadata.derived.dependencyIds.length, 2);
  });

  test("derived capability getDefaultDependencyValues works", () => {
    const env = createEnvSource();
    const region = createEnvSource();
    const derived = createDerivedFromMulti(env, region);
    const metadata = extractDependencyMetadata(derived);
    assert.ok(metadata?.derived !== undefined);
    assert.ok(metadata.derived.getDefaultDependencyValues !== undefined);
    const defaults = metadata.derived.getDefaultDependencyValues();
    assert.deepStrictEqual(defaults, ["dev", "dev"]);
  });

  test("returns undefined for plain ValueParser", () => {
    const parser = choice(["a", "b"], {
      metavar: "VAL" as NonEmptyString,
    });
    const metadata = extractDependencyMetadata(parser);
    assert.equal(metadata, undefined);
  });
});

// =============================================================================
// Tests: composeDependencyMetadata
// =============================================================================

describe("composeDependencyMetadata", () => {
  test("optional preserves inner metadata unchanged", () => {
    const env = createEnvSource();
    const inner = extractDependencyMetadata(env);
    assert.ok(inner !== undefined);
    const composed = composeDependencyMetadata(inner, "optional");
    assert.ok(composed !== undefined);
    assert.deepStrictEqual(composed.source, inner.source);
    assert.equal(composed.derived, undefined);
    assert.equal(composed.transform, undefined);
  });

  test("withDefault on source adds getMissingSourceValue", () => {
    const env = createEnvSource();
    const inner = extractDependencyMetadata(env);
    assert.ok(inner !== undefined);
    const defaultValue = "dev";
    const composed = composeDependencyMetadata(inner, "withDefault", {
      defaultValue: () => ({ success: true as const, value: defaultValue }),
    });
    assert.ok(composed !== undefined);
    assert.ok(composed.source !== undefined);
    assert.ok(composed.source.preservesSourceValue);
    assert.ok(composed.source.getMissingSourceValue !== undefined);
    const result = composed.source.getMissingSourceValue();
    assert.ok(!(result instanceof Promise));
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "dev");
    }
  });

  test("withDefault on non-source returns metadata unchanged", () => {
    const env = createEnvSource();
    const logLevel = createDerivedLogLevel(env);
    const inner = extractDependencyMetadata(logLevel);
    assert.ok(inner !== undefined);
    const composed = composeDependencyMetadata(inner, "withDefault", {
      defaultValue: () => ({ success: true as const, value: "debug" }),
    });
    assert.ok(composed !== undefined);
    assert.equal(composed.source, undefined);
    assert.ok(composed.derived !== undefined);
  });

  test("map on source sets transformsSourceValue and clears preservesSourceValue", () => {
    const env = createEnvSource();
    const inner = extractDependencyMetadata(env);
    assert.ok(inner !== undefined);
    const composed = composeDependencyMetadata(inner, "map");
    assert.ok(composed !== undefined);
    assert.ok(composed.source !== undefined);
    assert.ok(!composed.source.preservesSourceValue);
    assert.ok(composed.transform !== undefined);
    assert.ok(composed.transform.transformsSourceValue);
  });

  test("map preserves derived capability", () => {
    const env = createEnvSource();
    const logLevel = createDerivedLogLevel(env);
    const inner = extractDependencyMetadata(logLevel);
    assert.ok(inner !== undefined);
    const composed = composeDependencyMetadata(inner, "map");
    assert.ok(composed !== undefined);
    assert.ok(composed.derived !== undefined);
    assert.ok(composed.transform !== undefined);
    assert.ok(composed.transform.transformsSourceValue);
  });

  test("undefined inner metadata returns undefined", () => {
    const composed = composeDependencyMetadata(undefined, "optional");
    assert.equal(composed, undefined);
  });
});
