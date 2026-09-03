/**
 * Unit tests for DependencyRuntimeContext and shared runtime helpers.
 *
 * Part of https://github.com/dahlia/optique/issues/752
 * Extended for https://github.com/dahlia/optique/issues/753
 */
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import {
  type BarrierCompletionDependencies,
  buildRuntimeNodesFromArray,
  buildRuntimeNodesFromPairs,
  collectDemandedDependencyIds,
  collectExplicitSourceValues,
  collectExplicitSourceValuesAsync,
  collectSourcesFromState,
  completeEffectfulSourcesAsync,
  createDependencyFingerprint,
  createDependencyRuntimeContext,
  createReplayKey,
  derivedRawInputKey,
  extractRawInputFromState,
  fillMissingSourceDefaults,
  fillMissingSourceDefaultsAsync,
  orderDependencyNodes,
  replayDerivedParser,
  replayDerivedParserAsync,
  resolveStateWithRuntime,
  resolveStateWithRuntimeAsync,
  type RuntimeNode,
  serializeSchedulingPath,
} from "#src/dependency-runtime.ts";
import { createInputTrace } from "#src/input-trace.ts";
import type { ParserDependencyMetadata } from "#src/dependency-metadata.ts";
import {
  createDeferredParseState,
  createDependencySourceState,
  createPendingDependencySourceState,
  defaultValues,
  dependencyId,
  dependencyIds,
  DependencyRegistry,
  type DerivedValueParser,
  derivedValueParserMarker,
  isDependencySourceState,
  parseWithDependency,
} from "#src/internal/dependency.ts";
import { formatMessage, message } from "#src/message.ts";
import {
  createEffectfulCompletionSession,
  type EffectfulCompletionSession,
  type ExecutionContext,
  unmatchedNonCliDependencySourceStateMarker,
} from "#src/internal/parser.ts";
import type { DependencyRegistryLike } from "#src/registry-types.ts";
import type { ValueParserResult } from "#src/valueparser.ts";

// =============================================================================
// DependencyRuntimeContext
// =============================================================================

describe("DependencyRuntimeContext", () => {
  test("registerSource and getSource roundtrip", () => {
    const runtime = createDependencyRuntimeContext();
    const id = Symbol("env");
    runtime.registerSource(id, "prod");
    assert.ok(runtime.hasSource(id));
    assert.equal(runtime.getSource(id), "prod");
  });

  test("hasSource returns false for unregistered", () => {
    const runtime = createDependencyRuntimeContext();
    assert.ok(!runtime.hasSource(Symbol("missing")));
  });

  test("getSource returns undefined for unregistered", () => {
    const runtime = createDependencyRuntimeContext();
    assert.equal(runtime.getSource(Symbol("missing")), undefined);
  });

  test("registerSource registers multiple values", () => {
    const runtime = createDependencyRuntimeContext();
    const id1 = Symbol("a");
    const id2 = Symbol("b");
    const id3 = Symbol("c");
    runtime.registerSource(id1, "v1");
    runtime.registerSource(id2, "v2");
    runtime.registerSource(id3, "v3");
    assert.equal(runtime.getSource(id1), "v1");
    assert.equal(runtime.getSource(id2), "v2");
    assert.equal(runtime.getSource(id3), "v3");
  });

  test("resolveDependencies: all present -> resolved", () => {
    const runtime = createDependencyRuntimeContext();
    const id1 = Symbol("env");
    const id2 = Symbol("region");
    runtime.registerSource(id1, "prod");
    runtime.registerSource(id2, "us-east");
    const result = runtime.resolveDependencies({
      dependencyIds: [id1, id2],
    });
    assert.equal(result.kind, "resolved");
    assert.deepStrictEqual(result.values, ["prod", "us-east"]);
    assert.deepStrictEqual(result.usedDefaults, [false, false]);
  });

  test("resolveDependencies: missing with defaults -> resolved", () => {
    const runtime = createDependencyRuntimeContext();
    const id1 = Symbol("env");
    const id2 = Symbol("region");
    runtime.registerSource(id1, "prod");
    // id2 is missing
    const result = runtime.resolveDependencies({
      dependencyIds: [id1, id2],
      defaultValues: ["dev", "us-west"],
    });
    assert.equal(result.kind, "resolved");
    assert.deepStrictEqual(result.values, ["prod", "us-west"]);
    assert.deepStrictEqual(result.usedDefaults, [false, true]);
  });

  test("resolveDependencies: no deps and no defaults -> missing", () => {
    const runtime = createDependencyRuntimeContext();
    const id = Symbol("env");
    const result = runtime.resolveDependencies({
      dependencyIds: [id],
    });
    assert.equal(result.kind, "missing");
    assert.equal(result.values.length, 1);
    assert.equal(result.values[0], undefined);
  });

  test("resolveDependencies: partial -> partial", () => {
    const runtime = createDependencyRuntimeContext();
    const id1 = Symbol("env");
    const id2 = Symbol("region");
    runtime.registerSource(id1, "prod");
    // id2 missing, no defaults provided for it
    const result = runtime.resolveDependencies({
      dependencyIds: [id1, id2],
    });
    assert.equal(result.kind, "partial");
    assert.deepStrictEqual(result.values, ["prod", undefined]);
  });

  test("getReplayResult/setReplayResult caching", () => {
    const runtime = createDependencyRuntimeContext();
    const key = createReplayKey(["env"], "prod", ["prod"]);
    assert.equal(runtime.getReplayResult(key), undefined);
    const result: ValueParserResult<string> = {
      success: true,
      value: "prod",
    };
    runtime.setReplayResult(key, result);
    assert.deepStrictEqual(runtime.getReplayResult(key), result);
  });

  test("getSuggestionDependencies mirrors resolveDependencies", () => {
    const runtime = createDependencyRuntimeContext();
    const id = Symbol("env");
    runtime.registerSource(id, "prod");
    const result = runtime.getSuggestionDependencies({
      dependencyIds: [id],
    });
    assert.equal(result.kind, "resolved");
    assert.deepStrictEqual(result.values, ["prod"]);
  });

  test("wraps existing DependencyRegistryLike", () => {
    const registry = new DependencyRegistry();
    const id = Symbol("env");
    registry.set(id, "prod");
    const runtime = createDependencyRuntimeContext(registry);
    assert.ok(runtime.hasSource(id));
    assert.equal(runtime.getSource(id), "prod");
  });

  test("preserves failed sources when wrapping a cloned registry", () => {
    const sourceId = Symbol("env");
    const runtime = createDependencyRuntimeContext();
    runtime.registerSource(sourceId, "prod");
    runtime.markSourceFailed(sourceId);

    const cloned = createDependencyRuntimeContext(runtime.registry.clone());
    assert.ok(!cloned.hasSource(sourceId));
    assert.equal(cloned.getSource(sourceId), undefined);
    assert.ok(cloned.isSourceFailed(sourceId));
    assert.notEqual(
      cloned.resolveDependencies({
        dependencyIds: [sourceId],
        defaultValues: ["dev"],
      }).kind,
      "resolved",
    );
  });

  test("keeps failed sources hidden when wrapped registry set throws", () => {
    const sourceId = Symbol("env");
    class ThrowingRegistry implements DependencyRegistryLike {
      readonly #values: Map<symbol, unknown>;

      constructor(entries: readonly (readonly [symbol, unknown])[]) {
        this.#values = new Map(entries);
      }

      set<T>(_id: symbol, _value: T): void {
        throw new TypeError("Registry exploded.");
      }

      get<T>(id: symbol): T | undefined {
        return this.#values.get(id) as T | undefined;
      }

      has(id: symbol): boolean {
        return this.#values.has(id);
      }

      clone(): DependencyRegistryLike {
        return new ThrowingRegistry([...this.#values]);
      }
    }

    const runtime = createDependencyRuntimeContext(
      new ThrowingRegistry([[sourceId, "stale"]]),
    );

    runtime.markSourceFailed(sourceId);
    assert.throws(() => runtime.registerSource(sourceId, "fresh"), {
      name: "TypeError",
      message: "Registry exploded.",
    });
    assert.ok(!runtime.hasSource(sourceId));
    assert.equal(runtime.getSource(sourceId), undefined);
    assert.ok(runtime.isSourceFailed(sourceId));
  });

  test("tracks a transitive diagnostic chain for failed sources", () => {
    const framework = Symbol("framework");
    const packageManager = Symbol("package-manager");
    const runtime = createDependencyRuntimeContext();
    runtime.registerSourceMetadata(framework, "FRAMEWORK");
    runtime.registerSourceMetadata(
      packageManager,
      "PACKAGE_MANAGER",
      [framework],
    );

    runtime.markSourceFailed(framework);
    assert.ok(runtime.propagateSourceFailure(
      [framework],
      "PACKAGE_MANAGER",
      packageManager,
    ));
    assert.ok(runtime.propagateSourceFailure(
      [packageManager],
      "STORAGE",
    ));

    assert.deepEqual(runtime.getSourceFailureChain(framework), [
      "FRAMEWORK",
      "PACKAGE_MANAGER",
      "STORAGE",
    ]);
    assert.deepEqual(runtime.getSourceFailureChain(packageManager), [
      "FRAMEWORK",
      "PACKAGE_MANAGER",
      "STORAGE",
    ]);
  });
});

// =============================================================================
// createDependencyFingerprint/createReplayKey
// =============================================================================

describe("createDependencyFingerprint", () => {
  test("same values produce same fingerprint", () => {
    const fp1 = createDependencyFingerprint(["prod", "us-east"]);
    const fp2 = createDependencyFingerprint(["prod", "us-east"]);
    assert.equal(fp1, fp2);
  });

  test("different values produce different fingerprint", () => {
    const fp1 = createDependencyFingerprint(["prod", "us-east"]);
    const fp2 = createDependencyFingerprint(["dev", "us-west"]);
    assert.notEqual(fp1, fp2);
  });

  test("order matters", () => {
    const fp1 = createDependencyFingerprint(["a", "b"]);
    const fp2 = createDependencyFingerprint(["b", "a"]);
    assert.notEqual(fp1, fp2);
  });

  test("handles undefined values", () => {
    const fp = createDependencyFingerprint([undefined, "a"]);
    assert.equal(typeof fp, "string");
  });

  test("distinct symbols with same description produce different fingerprints", () => {
    const sym1 = Symbol("test");
    const sym2 = Symbol("test");
    const fp1 = createDependencyFingerprint([sym1]);
    const fp2 = createDependencyFingerprint([sym2]);
    assert.notEqual(fp1, fp2);
  });

  test("same symbol instance produces same fingerprint", () => {
    const sym = Symbol("test");
    const fp1 = createDependencyFingerprint([sym]);
    const fp2 = createDependencyFingerprint([sym]);
    assert.equal(fp1, fp2);
  });

  test("distinct objects produce different fingerprints", () => {
    const map1 = new Map([["a", 1]]);
    const map2 = new Map([["b", 2]]);
    const fp1 = createDependencyFingerprint([map1]);
    const fp2 = createDependencyFingerprint([map2]);
    assert.notEqual(fp1, fp2);
  });

  test("same object reference produces same fingerprint", () => {
    const obj = { x: 1 };
    const fp1 = createDependencyFingerprint([obj]);
    const fp2 = createDependencyFingerprint([obj]);
    assert.equal(fp1, fp2);
  });

  test("separates primitive edge cases and tuple boundaries", () => {
    const fn = () => "value";

    assert.notEqual(
      createDependencyFingerprint([0]),
      createDependencyFingerprint([-0]),
    );
    assert.notEqual(
      createDependencyFingerprint(["ab", "c"]),
      createDependencyFingerprint(["a", "bc"]),
    );
    assert.notEqual(
      createDependencyFingerprint([null]),
      createDependencyFingerprint([undefined]),
    );
    assert.equal(
      createDependencyFingerprint([fn]),
      createDependencyFingerprint([fn]),
    );
    assert.equal(typeof createDependencyFingerprint([1n]), "string");
  });
});

describe("createReplayKey", () => {
  test("creates key with fingerprint", () => {
    const key = createReplayKey(["env"], "prod", ["prod"]);
    assert.deepStrictEqual(key.path, ["env"]);
    assert.equal(key.rawInput, "prod");
    assert.equal(typeof key.dependencyFingerprint, "string");
  });

  test("symbol path segments do not alias", () => {
    const sym1 = Symbol("field");
    const sym2 = Symbol("field");
    const runtime = createDependencyRuntimeContext();
    const key1 = createReplayKey([sym1], "val", ["dep"]);
    const key2 = createReplayKey([sym2], "val", ["dep"]);
    const result1: ValueParserResult<string> = {
      success: true,
      value: "first",
    };
    const result2: ValueParserResult<string> = {
      success: true,
      value: "second",
    };
    runtime.setReplayResult(key1, result1);
    runtime.setReplayResult(key2, result2);
    // Each symbol-keyed path should get its own cache entry.
    assert.deepStrictEqual(runtime.getReplayResult(key1), result1);
    assert.deepStrictEqual(runtime.getReplayResult(key2), result2);
  });

  test("registered symbol paths (Symbol.for) do not throw", () => {
    const sym = Symbol.for("optique.test.field");
    const runtime = createDependencyRuntimeContext();
    const key = createReplayKey([sym], "val", ["dep"]);
    const result: ValueParserResult<string> = {
      success: true,
      value: "ok",
    };
    // Must not throw TypeError for registered symbols.
    runtime.setReplayResult(key, result);
    assert.deepStrictEqual(runtime.getReplayResult(key), result);
  });

  test("numeric and string path segments do not alias", () => {
    const runtime = createDependencyRuntimeContext();
    const keyNum = createReplayKey([0], "val", ["dep"]);
    const keyStr = createReplayKey(["0"], "val", ["dep"]);
    const result1: ValueParserResult<string> = {
      success: true,
      value: "from-tuple",
    };
    const result2: ValueParserResult<string> = {
      success: true,
      value: "from-object",
    };
    runtime.setReplayResult(keyNum, result1);
    runtime.setReplayResult(keyStr, result2);
    assert.deepStrictEqual(runtime.getReplayResult(keyNum), result1);
    assert.deepStrictEqual(runtime.getReplayResult(keyStr), result2);
  });
});

// =============================================================================
// Shared runtime helpers
// =============================================================================

/** Helper: creates a bare extractSourceValue for tests. */
function bareExtract(
  state: unknown,
): ValueParserResult<unknown> | undefined {
  if (!isDependencySourceState(state)) return undefined;
  return state.result;
}

/** Helper: wraps extractSourceValue to unwrap [state] first. */
function unwrappingExtract(
  state: unknown,
): ValueParserResult<unknown> | undefined {
  if (Array.isArray(state) && state.length === 1) {
    return bareExtract(state[0]);
  }
  return bareExtract(state);
}

function makeDerivedValueParser(
  sourceId: symbol,
  replay: (
    rawInput: string,
    dependencyValue: unknown,
  ) => ValueParserResult<unknown> | Promise<ValueParserResult<unknown>>,
  options: {
    readonly dependencyIds?: readonly symbol[];
    readonly defaultValues?: () => readonly unknown[];
  } = {},
): DerivedValueParser<"sync", unknown, unknown> {
  const parser: DerivedValueParser<"sync", unknown, unknown> = {
    mode: "sync",
    metavar: "VALUE",
    placeholder: "value",
    [dependencyId]: sourceId,
    [parseWithDependency]: replay,
    parse(input: string) {
      return { success: true, value: input };
    },
    format(value: unknown) {
      return String(value);
    },
    [derivedValueParserMarker]: true,
  };
  if (options.dependencyIds != null) {
    Object.defineProperty(parser, dependencyIds, {
      value: options.dependencyIds,
    });
  }
  if (options.defaultValues != null) {
    Object.defineProperty(parser, defaultValues, {
      value: options.defaultValues,
    });
  }
  return parser;
}

describe("collectExplicitSourceValues", () => {
  test("registers source values via extractSourceValue", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const sourceState = createDependencySourceState(
      { success: true, value: "prod" } as ValueParserResult<string>,
      sourceId,
    );
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
          },
        },
      },
      state: sourceState,
    }];
    collectExplicitSourceValues(nodes, runtime);
    assert.ok(runtime.hasSource(sourceId));
    assert.equal(runtime.getSource(sourceId), "prod");
  });

  test("awaits async source extractors in async mode", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const sourceState = createDependencySourceState(
      { success: true, value: "prod" } as ValueParserResult<string>,
      sourceId,
    );
    let resolveExtract!: (
      value: ValueParserResult<unknown> | undefined,
    ) => void;
    const extractPromise = new Promise<ValueParserResult<unknown> | undefined>(
      (resolve) => {
        resolveExtract = resolve;
      },
    );
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: (_state: unknown) => extractPromise,
            preservesSourceValue: true,
          },
        },
      },
      state: sourceState,
    }];

    assert.throws(() => collectExplicitSourceValues(nodes, runtime), {
      name: "TypeError",
      message:
        /collectExplicitSourceValues\(\).*extractSourceValue.*Symbol\(env\)/,
    });
    assert.ok(!runtime.hasSource(sourceId));
    assert.equal(runtime.getSource(sourceId), undefined);
    assert.ok(!runtime.isSourceFailed(sourceId));

    const pending = collectExplicitSourceValuesAsync(nodes, runtime);
    assert.ok(!runtime.hasSource(sourceId));
    resolveExtract(bareExtract(sourceState));
    await pending;
    assert.ok(runtime.hasSource(sourceId));
    assert.ok(!runtime.isSourceFailed(sourceId));
    assert.equal(runtime.getSource(sourceId), "prod");
  });

  test("treats thenable source extractors as async in sync mode", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const sourceState = createDependencySourceState(
      { success: true, value: "prod" } as ValueParserResult<string>,
      sourceId,
    );
    const thenable = {
      then(
        resolve: (value: ValueParserResult<unknown> | undefined) => void,
      ) {
        resolve(bareExtract(sourceState));
      },
    };
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: (_state: unknown) => thenable as never,
            preservesSourceValue: true,
          },
        },
      },
      state: sourceState,
    }];

    assert.throws(() => collectExplicitSourceValues(nodes, runtime), {
      name: "TypeError",
      message:
        /collectExplicitSourceValues\(\).*extractSourceValue.*Symbol\(env\)/,
    });
    assert.ok(!runtime.hasSource(sourceId));
    assert.equal(runtime.getSource(sourceId), undefined);
    assert.ok(!runtime.isSourceFailed(sourceId));

    await collectExplicitSourceValuesAsync(nodes, runtime);
    assert.ok(runtime.hasSource(sourceId));
    assert.ok(!runtime.isSourceFailed(sourceId));
    assert.equal(runtime.getSource(sourceId), "prod");
  });

  test("registers source from optional-wrapped state", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const sourceState = createDependencySourceState(
      { success: true, value: "prod" } as ValueParserResult<string>,
      sourceId,
    );
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: unwrappingExtract,
            preservesSourceValue: true,
          },
        },
      },
      state: [sourceState], // optional() wraps in [state]
    }];
    collectExplicitSourceValues(nodes, runtime);
    assert.ok(runtime.hasSource(sourceId));
    assert.equal(runtime.getSource(sourceId), "prod");
  });

  test("skips nodes without source metadata", () => {
    const runtime = createDependencyRuntimeContext();
    const nodes: RuntimeNode[] = [{
      path: ["file"],
      parser: { dependencyMetadata: undefined },
      state: { success: true, value: "test.txt" },
    }];
    collectExplicitSourceValues(nodes, runtime);
    // Nothing registered—no error
  });

  test("skips nodes without extractSourceValue", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            preservesSourceValue: true,
          } as ParserDependencyMetadata["source"] & { kind: "source" },
        },
      },
      state: undefined,
    }];
    collectExplicitSourceValues(nodes, runtime);
    assert.ok(!runtime.hasSource(sourceId));
  });
});

describe("collectExplicitSourceValues—failed sources", () => {
  test("marks failed source so defaults do not override", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const sourceState = createDependencySourceState(
      { success: false, error: undefined! } as ValueParserResult<string>,
      sourceId,
    );
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
          },
        },
      },
      state: sourceState,
    }];
    collectExplicitSourceValues(nodes, runtime);
    // Source failed—should NOT be registered as a value.
    assert.ok(!runtime.hasSource(sourceId));
    // But should be marked as failed.
    assert.ok(runtime.isSourceFailed(sourceId));

    // Derived parser with defaults should NOT resolve against defaults
    // when the source explicitly failed.
    const resolution = runtime.resolveDependencies({
      dependencyIds: [sourceId],
      defaultValues: ["dev"],
    });
    // Failed source blocks default fallback—resolution stays unresolved.
    assert.notEqual(resolution.kind, "resolved");
  });

  test("later failed extraction shadows an earlier registered value", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [
      {
        path: ["env", "first"],
        parser: {
          dependencyMetadata: {
            source: {
              kind: "source",
              sourceId,
              extractSourceValue: bareExtract,
              preservesSourceValue: true,
            },
          },
        },
        state: createDependencySourceState(
          { success: true, value: "prod" } as ValueParserResult<string>,
          sourceId,
        ),
      },
      {
        path: ["env", "second"],
        parser: {
          dependencyMetadata: {
            source: {
              kind: "source",
              sourceId,
              extractSourceValue: bareExtract,
              preservesSourceValue: true,
            },
          },
        },
        state: createDependencySourceState(
          { success: false, error: undefined! } as ValueParserResult<string>,
          sourceId,
        ),
      },
    ];

    collectExplicitSourceValues(nodes, runtime);

    assert.ok(!runtime.hasSource(sourceId));
    assert.equal(runtime.getSource(sourceId), undefined);
    assert.ok(runtime.isSourceFailed(sourceId));
    assert.notEqual(
      runtime.resolveDependencies({
        dependencyIds: [sourceId],
        defaultValues: ["dev"],
      }).kind,
      "resolved",
    );
  });
});

describe("collectSourcesFromState", () => {
  test("only applies excluded fields at the current object depth", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("shared");
    let topLevelSharedReads = 0;
    const topLevelShared = createDependencySourceState(
      { success: true as const, value: "top" },
      sourceId,
    );
    const state = {
      get shared() {
        topLevelSharedReads++;
        return topLevelShared;
      },
      nested: {
        shared: createDependencySourceState(
          { success: true as const, value: "nested" },
          sourceId,
        ),
      },
    };

    collectSourcesFromState(
      state,
      runtime,
      new WeakSet<object>(),
      new Set<PropertyKey>(["shared"]),
    );

    assert.equal(topLevelSharedReads, 0);
    assert.ok(runtime.hasSource(sourceId));
    assert.ok(!runtime.isSourceFailed(sourceId));
    assert.equal(runtime.getSource(sourceId), "nested");
  });
});

describe("fillMissingSourceDefaults", () => {
  test("fills default for missing source", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
            getMissingSourceValue: () => ({
              success: true as const,
              value: "dev",
            }),
          },
        },
      },
      state: undefined,
    }];
    fillMissingSourceDefaults(nodes, runtime);
    assert.ok(runtime.hasSource(sourceId));
    assert.equal(runtime.getSource(sourceId), "dev");
  });

  test("does not overwrite existing source", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    runtime.registerSource(sourceId, "prod");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
            getMissingSourceValue: () => ({
              success: true as const,
              value: "dev",
            }),
          },
        },
      },
      state: undefined,
    }];
    fillMissingSourceDefaults(nodes, runtime);
    assert.equal(runtime.getSource(sourceId), "prod");
  });

  test("does not fill default when node matched explicit input", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
            getMissingSourceValue: () => ({
              success: true as const,
              value: "dev",
            }),
          },
        },
      },
      state: { success: false, error: "invalid value" },
      matched: true,
    }];
    fillMissingSourceDefaults(nodes, runtime);
    // The source had explicit input that failed—default must not be applied.
    assert.ok(!runtime.hasSource(sourceId));
  });

  test("skips defaults when preservesSourceValue is false (map())", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: false,
            getMissingSourceValue: () => ({
              success: true as const,
              value: "dev",
            }),
          },
          transform: { transformsSourceValue: true },
        },
      },
      state: undefined,
    }];
    fillMissingSourceDefaults(nodes, runtime);
    // map() breaks source identity—default must not be registered.
    assert.ok(!runtime.hasSource(sourceId));
  });

  test("fills default for wrapped no-CLI source state", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const parser = {
      initialState: undefined,
      [unmatchedNonCliDependencySourceStateMarker]: true,
      dependencyMetadata: {
        source: {
          kind: "source" as const,
          sourceId,
          extractSourceValue: bareExtract,
          preservesSourceValue: true,
          getMissingSourceValue: () => ({
            success: true as const,
            value: "dev",
          }),
        },
      },
    };
    const nodes = buildRuntimeNodesFromPairs(
      [["env", parser]],
      { env: [{ hasCliValue: false, cliState: undefined }] },
    );

    fillMissingSourceDefaults(nodes, runtime);

    assert.ok(runtime.hasSource(sourceId));
    assert.equal(runtime.getSource(sourceId), "dev");
  });

  test("handles throwing default thunks gracefully", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
            getMissingSourceValue: () => {
              throw new Error("env not configured");
            },
          },
        },
      },
      state: undefined,
    }];
    // Should not throw—returns the failure so the caller can propagate it.
    const failures = fillMissingSourceDefaults(nodes, runtime);
    assert.ok(!runtime.hasSource(sourceId));
    assert.equal(failures.length, 1);
    assert.equal(failures[0].sourceId, sourceId);
    assert.ok(!failures[0].error.success);
  });

  test("throws when sync default seeding receives a thenable", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
            getMissingSourceValue: () => ({ then() {} }) as never,
          },
        },
      },
      state: undefined,
    }];

    assert.throws(
      () => fillMissingSourceDefaults(nodes, runtime),
      {
        name: "TypeError",
        message:
          /fillMissingSourceDefaults\(\) received an async getMissingSourceValue\(\) result/i,
      },
    );
    assert.ok(!runtime.hasSource(sourceId));
  });
});

describe("fillMissingSourceDefaultsAsync", () => {
  test("awaits async getMissingSourceValue", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
            getMissingSourceValue: () =>
              Promise.resolve({
                success: true as const,
                value: "async-dev",
              }),
          },
        },
      },
      state: undefined,
    }];
    const failures = await fillMissingSourceDefaultsAsync(nodes, runtime);
    assert.equal(failures.length, 0);
    assert.ok(runtime.hasSource(sourceId));
    assert.equal(runtime.getSource(sourceId), "async-dev");
  });

  test("propagates async default failure", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
            getMissingSourceValue: () =>
              Promise.resolve({
                success: false as const,
                error: undefined!,
              }),
          },
        },
      },
      state: undefined,
    }];
    const failures = await fillMissingSourceDefaultsAsync(nodes, runtime);
    assert.equal(failures.length, 1);
    assert.ok(!runtime.hasSource(sourceId));
  });

  test("fills async default for wrapped no-CLI source state", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const parser = {
      initialState: undefined,
      [unmatchedNonCliDependencySourceStateMarker]: true,
      dependencyMetadata: {
        source: {
          kind: "source" as const,
          sourceId,
          extractSourceValue: bareExtract,
          preservesSourceValue: true,
          getMissingSourceValue: () =>
            Promise.resolve({
              success: true as const,
              value: "async-dev",
            }),
        },
      },
    };
    const nodes = buildRuntimeNodesFromPairs(
      [["env", parser]],
      { env: [{ hasCliValue: false, cliState: undefined }] },
    );

    const failures = await fillMissingSourceDefaultsAsync(nodes, runtime);

    assert.equal(failures.length, 0);
    assert.ok(runtime.hasSource(sourceId));
    assert.equal(runtime.getSource(sourceId), "async-dev");
  });

  test("skips async defaults for sources that are already resolved or blocked", async () => {
    const runtime = createDependencyRuntimeContext();
    const existingId = Symbol("existing");
    const failedId = Symbol("failed");
    const matchedId = Symbol("matched");
    const transformedId = Symbol("transformed");
    const missingGetterId = Symbol("missing-getter");
    runtime.registerSource(existingId, "cli");
    runtime.markSourceFailed(failedId);

    const calls: string[] = [];
    const sourceNode = (
      sourceId: symbol,
      path: string,
      extra: Partial<ParserDependencyMetadata["source"]> = {},
      matched?: boolean,
    ): RuntimeNode => ({
      path: [path],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
            getMissingSourceValue: () => {
              calls.push(path);
              return Promise.resolve({
                success: true as const,
                value: `${path}-default`,
              });
            },
            ...extra,
          },
        },
      },
      state: undefined,
      matched,
    });

    const failures = await fillMissingSourceDefaultsAsync([
      { path: ["plain"], parser: {}, state: undefined },
      sourceNode(existingId, "existing"),
      sourceNode(failedId, "failed"),
      sourceNode(matchedId, "matched", {}, true),
      sourceNode(transformedId, "transformed", { preservesSourceValue: false }),
      sourceNode(missingGetterId, "missing-getter", {
        getMissingSourceValue: undefined,
      }),
    ], runtime);

    assert.deepEqual(failures, []);
    assert.deepEqual(calls, []);
    assert.equal(runtime.getSource(existingId), "cli");
    assert.ok(!runtime.hasSource(matchedId));
    assert.ok(!runtime.hasSource(transformedId));
    assert.ok(!runtime.hasSource(missingGetterId));
  });

  test("reports async default thunks that throw non-Error values", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
            getMissingSourceValue: () => {
              throw "missing env";
            },
          },
        },
      },
      state: undefined,
    }];

    const failures = await fillMissingSourceDefaultsAsync(nodes, runtime);

    assert.equal(failures.length, 1);
    assert.equal(failures[0].sourceId, sourceId);
    assert.deepEqual(failures[0].path, ["env"]);
    assert.ok(!failures[0].error.success);
    if (!failures[0].error.success) {
      assert.equal(
        formatMessage(failures[0].error.error),
        'Default value evaluation failed: "missing env"',
      );
    }
    assert.ok(!runtime.hasSource(sourceId));
  });
});

describe("replayDerivedParser", () => {
  test("replays sync derived parser", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    runtime.registerSource(sourceId, "prod");
    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [sourceId],
        replayParse: (_raw: string, deps: readonly unknown[]) => ({
          success: true as const,
          value: `parsed-${deps[0]}`,
        }),
      },
    };
    const result = replayDerivedParser(
      { path: ["level"], parser: { dependencyMetadata: metadata }, state: {} },
      "warn",
      runtime,
    );
    assert.ok(result !== undefined);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "parsed-prod");
    }
  });

  test("returns undefined when dependencies unresolved", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [sourceId],
        replayParse: (_raw: string, deps: readonly unknown[]) => ({
          success: true as const,
          value: `parsed-${deps[0]}`,
        }),
      },
    };
    const result = replayDerivedParser(
      { path: ["level"], parser: { dependencyMetadata: metadata }, state: {} },
      "warn",
      runtime,
    );
    assert.equal(result, undefined);
  });

  test("uses snapshotted defaults instead of re-evaluating thunk", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    // Source is missing—resolution should use defaults.
    let thunkCalls = 0;
    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [sourceId],
        getDefaultDependencyValues: () => {
          thunkCalls++;
          return [`call-${thunkCalls}`];
        },
        replayParse: (_raw: string, deps: readonly unknown[]) => ({
          success: true as const,
          value: `parsed-${deps[0]}`,
        }),
      },
    };
    // Provide snapshotted defaults on the node.
    const result = replayDerivedParser(
      {
        path: ["level"],
        parser: { dependencyMetadata: metadata },
        state: {},
        defaultDependencyValues: ["snapshotted-dev"],
      },
      "warn",
      runtime,
    );
    // Should use the snapshotted value, not call the thunk.
    assert.equal(thunkCalls, 0);
    assert.ok(result !== undefined);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "parsed-snapshotted-dev");
    }
  });

  test("throws when sync replay receives a thenable", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    runtime.registerSource(sourceId, "prod");
    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [sourceId],
        replayParse: () => ({ then() {} }) as never,
      },
    };

    assert.throws(
      () =>
        replayDerivedParser(
          {
            path: ["level"],
            parser: { dependencyMetadata: metadata },
            state: {},
          },
          "warn",
          runtime,
        ),
      {
        name: "TypeError",
        message:
          /replayDerivedParser\(\) received an async replayParse\(\) result/i,
      },
    );
  });
});

describe("replayDerivedParserAsync", () => {
  test("replays async derived parser", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    runtime.registerSource(sourceId, "prod");
    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [sourceId],
        replayParse: (_raw: string, deps: readonly unknown[]) =>
          Promise.resolve({
            success: true as const,
            value: `async-${deps[0]}`,
          }),
      },
    };
    const result = await replayDerivedParserAsync(
      { path: ["level"], parser: { dependencyMetadata: metadata }, state: {} },
      "warn",
      runtime,
    );
    assert.ok(result !== undefined);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "async-prod");
    }
  });
});

// =============================================================================
// Bridge helpers for construct migration
// Part of https://github.com/dahlia/optique/issues/753
// =============================================================================

describe("extractRawInputFromState", () => {
  // Create a minimal DerivedValueParser mock for DeferredParseState creation.
  function makeDerivedVpMock() {
    return {
      [parseWithDependency]: () => ({
        success: true as const,
        value: undefined,
      }),
      // deno-lint-ignore no-explicit-any
    } as any;
  }

  test("extracts rawInput from DeferredParseState", () => {
    const deferred = createDeferredParseState(
      "hello",
      makeDerivedVpMock(),
      { success: true, value: "hello" },
    );
    assert.equal(extractRawInputFromState(deferred), "hello");
  });

  test("extracts rawInput from [DeferredParseState] (array-wrapped)", () => {
    const deferred = createDeferredParseState(
      "world",
      makeDerivedVpMock(),
      { success: true, value: "world" },
    );
    assert.equal(extractRawInputFromState([deferred]), "world");
  });

  test("extracts rawInput from a single-state extension wrapper", () => {
    const inner = Object.defineProperty(
      { success: true, value: "npm" },
      derivedRawInputKey,
      { value: "npm", enumerable: false },
    );
    assert.equal(
      extractRawInputFromState({ hasCliValue: true, cliState: inner }),
      "npm",
    );
  });

  test("rejects an extension wrapper with ambiguous raw inputs", () => {
    const first = Object.defineProperty({}, derivedRawInputKey, {
      value: "npm",
      enumerable: false,
    });
    const second = Object.defineProperty({}, derivedRawInputKey, {
      value: "deno",
      enumerable: false,
    });
    assert.equal(extractRawInputFromState({ first, second }), undefined);
  });

  test("returns undefined for PendingDependencySourceState", () => {
    const pending = createPendingDependencySourceState(Symbol("src"));
    assert.equal(extractRawInputFromState(pending), undefined);
  });

  test("returns undefined for DependencySourceState", () => {
    const depState = createDependencySourceState(
      { success: true, value: "val" },
      Symbol("src"),
    );
    assert.equal(extractRawInputFromState(depState), undefined);
  });

  test("returns undefined for plain value", () => {
    assert.equal(extractRawInputFromState("plain"), undefined);
    assert.equal(extractRawInputFromState(42), undefined);
    assert.equal(extractRawInputFromState(undefined), undefined);
    assert.equal(extractRawInputFromState(null), undefined);
  });

  test("returns undefined for empty array", () => {
    assert.equal(extractRawInputFromState([]), undefined);
  });

  test("returns undefined for array with non-deferred element", () => {
    assert.equal(extractRawInputFromState(["foo"]), undefined);
  });
});

describe("resolveStateWithRuntime", () => {
  test("resolves deferred parse states with explicit single and multiple dependencies", () => {
    const singleId = Symbol("single");
    const firstId = Symbol("first");
    const secondId = Symbol("second");
    const runtime = createDependencyRuntimeContext();
    runtime.registerSource(singleId, "prod");
    runtime.registerSource(firstId, "us");
    runtime.registerSource(secondId, "blue");

    const single = createDeferredParseState(
      "warn",
      makeDerivedValueParser(singleId, (raw, dependency) => ({
        success: true,
        value: `${raw}:${dependency}`,
      })),
      { success: false, error: message`pending` },
    );
    const multi = createDeferredParseState(
      "deploy",
      makeDerivedValueParser(
        firstId,
        (raw, dependencies) => ({
          success: true,
          value: `${raw}:${(dependencies as readonly unknown[]).join("/")}`,
        }),
        { dependencyIds: [firstId, secondId] },
      ),
      { success: false, error: message`pending` },
    );

    assert.deepEqual(resolveStateWithRuntime(single, runtime), {
      success: true,
      value: "warn:prod",
    });
    assert.deepEqual(resolveStateWithRuntime(multi, runtime), {
      success: true,
      value: "deploy:us/blue",
    });
  });

  test("keeps preliminary deferred results when only defaults resolved dependencies", () => {
    const sourceId = Symbol("env");
    let replays = 0;
    const deferred = createDeferredParseState(
      "warn",
      makeDerivedValueParser(
        sourceId,
        () => {
          replays++;
          return { success: true, value: "replayed" };
        },
        { defaultValues: () => ["dev"] },
      ),
      { success: true, value: "preliminary" },
    );

    const runtime = createDependencyRuntimeContext();
    const resolved = resolveStateWithRuntime(deferred, runtime);

    assert.deepEqual(resolved, { success: true, value: "preliminary" });
    assert.equal(replays, 0);
  });

  test("preserves dependency source states and clones only changed containers", () => {
    const sourceId = Symbol("env");
    const runtime = createDependencyRuntimeContext();
    runtime.registerSource(sourceId, "prod");
    const source = createDependencySourceState(
      { success: true, value: "prod" },
      sourceId,
    );
    const deferred = createDeferredParseState(
      "warn",
      makeDerivedValueParser(sourceId, (raw, dependency) => ({
        success: true,
        value: `${raw}:${dependency}`,
      })),
      { success: false, error: message`pending` },
    );
    const symbolKey = Symbol("derived");
    const state = {
      unchanged: source,
      nested: [deferred],
      [symbolKey]: deferred,
    };

    const resolved = resolveStateWithRuntime(state, runtime);

    assert.notStrictEqual(resolved, state);
    assert.ok(resolved != null && typeof resolved === "object");
    const record = resolved as {
      readonly unchanged: unknown;
      readonly nested: readonly unknown[];
      readonly [symbolKey]: unknown;
    };
    assert.strictEqual(record.unchanged, source);
    assert.notStrictEqual(record.nested, state.nested);
    assert.deepEqual(record.nested[0], {
      success: true,
      value: "warn:prod",
    });
    assert.deepEqual(record[symbolKey], {
      success: true,
      value: "warn:prod",
    });
    assert.strictEqual(record.nested[0], record[symbolKey]);
  });

  test("returns original cyclic containers when no deferred state changes", () => {
    const runtime = createDependencyRuntimeContext();
    const state: { self?: unknown; nested: readonly unknown[] } = {
      nested: [],
    };
    state.self = state;

    const resolved = resolveStateWithRuntime(state, runtime);

    assert.strictEqual(resolved, state);
    assert.strictEqual(state.self, state);
  });

  test("throws when sync deferred replay receives a thenable", () => {
    const depId = Symbol("env");
    const deferred = createDeferredParseState(
      "warn",
      {
        [dependencyId]: depId,
        [parseWithDependency]: () =>
          ({ then() {} }) as PromiseLike<
            ValueParserResult<unknown>
          >,
      } as never,
      {
        success: false,
        error: message`pending callback failed`,
      },
    );
    const runtime = createDependencyRuntimeContext();
    runtime.registerSource(depId, "prod");

    assert.throws(
      () => resolveStateWithRuntime(deferred, runtime),
      {
        name: "TypeError",
        message:
          /resolveStateWithRuntime\(\) received an async parseWithDependency\(\) result/i,
      },
    );
  });
});

describe("resolveStateWithRuntimeAsync", () => {
  test("awaits deferred replay and preserves preliminary default-only results", async () => {
    const explicitId = Symbol("explicit");
    const defaultId = Symbol("default");
    const runtime = createDependencyRuntimeContext();
    runtime.registerSource(explicitId, "prod");
    let defaultReplays = 0;
    const state = [
      createDeferredParseState(
        "warn",
        makeDerivedValueParser(
          explicitId,
          (raw, dependency) =>
            Promise.resolve({
              success: true,
              value: `${raw}:${dependency}`,
            }),
        ),
        { success: false, error: message`pending` },
      ),
      createDeferredParseState(
        "info",
        makeDerivedValueParser(
          defaultId,
          () => {
            defaultReplays++;
            return Promise.resolve({ success: true, value: "replayed" });
          },
          { defaultValues: () => ["dev"] },
        ),
        { success: true, value: "preliminary" },
      ),
    ];

    const resolved = await resolveStateWithRuntimeAsync(state, runtime);

    assert.deepEqual(resolved, [
      { success: true, value: "warn:prod" },
      { success: true, value: "preliminary" },
    ]);
    assert.equal(defaultReplays, 0);
  });

  test("keeps unresolved async deferred states at their preliminary result", async () => {
    const sourceId = Symbol("missing");
    const runtime = createDependencyRuntimeContext();
    const preliminary = { success: false as const, error: message`pending` };
    const state = {
      value: createDeferredParseState(
        "warn",
        makeDerivedValueParser(
          sourceId,
          () =>
            Promise.resolve({
              success: true,
              value: "unreachable",
            }),
        ),
        preliminary,
      ),
    };

    const resolved = await resolveStateWithRuntimeAsync(state, runtime);

    assert.deepEqual(resolved, { value: preliminary });
  });

  test("resolves a shared async deferred state at every reference", async () => {
    const sourceId = Symbol("env");
    const runtime = createDependencyRuntimeContext();
    runtime.registerSource(sourceId, "prod");
    const deferred = createDeferredParseState(
      "warn",
      makeDerivedValueParser(
        sourceId,
        (raw, dependency) =>
          Promise.resolve({
            success: true,
            value: `${raw}:${dependency}`,
          }),
      ),
      { success: false, error: message`pending` },
    );
    const symbolKey = Symbol("shared");
    const state = {
      first: deferred,
      nested: [deferred],
      [symbolKey]: deferred,
    };

    const resolved = await resolveStateWithRuntimeAsync(state, runtime);

    assert.ok(resolved != null && typeof resolved === "object");
    const record = resolved as {
      readonly first: unknown;
      readonly nested: readonly unknown[];
      readonly [symbolKey]: unknown;
    };
    const expected = { success: true, value: "warn:prod" };
    assert.deepEqual(record.first, expected);
    assert.deepEqual(record.nested[0], expected);
    assert.deepEqual(record[symbolKey], expected);
    assert.strictEqual(record.first, record.nested[0]);
    assert.strictEqual(record.first, record[symbolKey]);
  });
});

describe("buildRuntimeNodesFromPairs", () => {
  function makeParser(
    meta?: ParserDependencyMetadata,
    initialState?: unknown,
  ) {
    return {
      dependencyMetadata: meta,
      initialState,
    };
  }

  test("builds nodes from field-parser pairs with state", () => {
    const sourceId = Symbol("env");
    const sourceMeta: ParserDependencyMetadata = {
      source: {
        kind: "source",
        sourceId,
        extractSourceValue: () => undefined,
        preservesSourceValue: true,
      },
    };
    const plainParser = makeParser();
    const sourceParser = makeParser(sourceMeta);

    const pairs: [
      PropertyKey,
      { dependencyMetadata?: ParserDependencyMetadata; initialState?: unknown },
    ][] = [
      ["name", plainParser],
      ["env", sourceParser],
    ];

    const state: Record<string | symbol, unknown> = {
      name: { success: true, value: "hello" },
      env: { success: true, value: "prod" },
    };

    const nodes = buildRuntimeNodesFromPairs(pairs, state);
    assert.equal(nodes.length, 2);
    assert.deepStrictEqual(nodes[0].path, ["name"]);
    assert.equal(nodes[0].matched, true);
    assert.equal(nodes[0].parser.dependencyMetadata, undefined);

    assert.deepStrictEqual(nodes[1].path, ["env"]);
    assert.equal(nodes[1].matched, true);
    assert.equal(nodes[1].parser.dependencyMetadata, sourceMeta);
  });

  test("marks unmatched fields (undefined state)", () => {
    const parser = makeParser(undefined, undefined);
    const pairs: [
      PropertyKey,
      { dependencyMetadata?: ParserDependencyMetadata; initialState?: unknown },
    ][] = [
      ["name", parser],
    ];
    const state: Record<string | symbol, unknown> = {};

    const nodes = buildRuntimeNodesFromPairs(pairs, state);
    assert.equal(nodes[0].matched, false);
    assert.equal(nodes[0].state, undefined);
  });

  test("marks PendingDependencySourceState as unmatched", () => {
    const pending = createPendingDependencySourceState(Symbol("src"));
    const parser = makeParser(undefined, pending);
    const pairs: [
      PropertyKey,
      { dependencyMetadata?: ParserDependencyMetadata; initialState?: unknown },
    ][] = [
      ["env", parser],
    ];
    const state: Record<string | symbol, unknown> = {};

    const nodes = buildRuntimeNodesFromPairs(pairs, state);
    assert.equal(nodes[0].matched, false);
  });

  test("prepends parentPath to node paths", () => {
    const parser = makeParser();
    const pairs: [
      PropertyKey,
      { dependencyMetadata?: ParserDependencyMetadata; initialState?: unknown },
    ][] = [
      ["name", parser],
    ];
    const state: Record<string | symbol, unknown> = { name: "hi" };

    const nodes = buildRuntimeNodesFromPairs(pairs, state, ["root", 0]);
    assert.deepStrictEqual(nodes[0].path, ["root", 0, "name"]);
  });

  test("does not eagerly snapshot defaultDependencyValues", () => {
    const depId = Symbol("env");
    const derivedMeta: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [depId],
        getDefaultDependencyValues: () => ["dev"],
        replayParse: () => ({ success: true, value: "x" }),
      },
    };
    const parser = makeParser(derivedMeta);
    const pairs: [
      PropertyKey,
      { dependencyMetadata?: ParserDependencyMetadata; initialState?: unknown },
    ][] = [
      ["level", parser],
    ];
    const state: Record<string | symbol, unknown> = { level: "info" };

    // defaultDependencyValues is deferred to the replay path,
    // not eagerly evaluated during node building.
    const nodes = buildRuntimeNodesFromPairs(pairs, state);
    assert.equal(nodes[0].defaultDependencyValues, undefined);
  });

  test("does not inspect plain parser state properties", () => {
    const parser = makeParser();
    const parserState = {
      success: true as const,
      value: "ok",
      get diagnostic(): never {
        throw new Error("diagnostic getter should not run");
      },
    };

    assert.doesNotThrow(() =>
      buildRuntimeNodesFromPairs([["value", parser]], {
        value: parserState,
      })
    );
  });
});

describe("buildRuntimeNodesFromArray", () => {
  function makeParser(
    meta?: ParserDependencyMetadata,
    initialState?: unknown,
  ) {
    return {
      dependencyMetadata: meta,
      initialState,
    };
  }

  test("builds nodes from parser array with state array", () => {
    const p1 = makeParser();
    const p2 = makeParser();
    const parsers = [p1, p2];
    const stateArray = ["hello", 42];

    const nodes = buildRuntimeNodesFromArray(parsers, stateArray);
    assert.equal(nodes.length, 2);
    assert.deepStrictEqual(nodes[0].path, [0]);
    assert.equal(nodes[0].state, "hello");
    assert.equal(nodes[0].matched, true);

    assert.deepStrictEqual(nodes[1].path, [1]);
    assert.equal(nodes[1].state, 42);
    assert.equal(nodes[1].matched, true);
  });

  test("marks undefined elements as unmatched", () => {
    const p = makeParser();
    const nodes = buildRuntimeNodesFromArray([p], [undefined]);
    assert.equal(nodes[0].matched, false);
  });

  test("prepends parentPath to node paths", () => {
    const p = makeParser();
    const nodes = buildRuntimeNodesFromArray([p], ["x"], ["parent"]);
    assert.deepStrictEqual(nodes[0].path, ["parent", 0]);
  });

  test("does not inspect plain parser state properties", () => {
    const parser = makeParser();
    const parserState = {
      success: true as const,
      value: "ok",
      get diagnostic(): never {
        throw new Error("diagnostic getter should not run");
      },
    };

    assert.doesNotThrow(() =>
      buildRuntimeNodesFromArray([parser], [parserState])
    );
  });
});

// =============================================================================
// Additional branch coverage
// =============================================================================

describe("collectExplicitSourceValues—undefined return from extractSourceValue", () => {
  test("skips registration when extractSourceValue returns undefined", () => {
    // This exercises registerExplicitSourceValue() with result == null.
    // The extractor returns undefined because the state doesn't contain
    // a source result yet (unpopulated/initial state).
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            // Always returns undefined—state is unpopulated
            extractSourceValue: (_state: unknown) => undefined,
            preservesSourceValue: true,
          },
        },
      },
      state: { some: "initial-state" },
    }];

    collectExplicitSourceValues(nodes, runtime);

    // Nothing registered, nothing failed
    assert.ok(!runtime.hasSource(sourceId));
    assert.ok(!runtime.isSourceFailed(sourceId));
  });
});

describe("replayDerivedParser—additional branches", () => {
  test("returns undefined when partial dependencies", () => {
    // Two deps, only one registered → resolution.kind === "partial"
    const runtime = createDependencyRuntimeContext();
    const id1 = Symbol("a");
    const id2 = Symbol("b");
    runtime.registerSource(id1, "present");
    // id2 is missing with no defaults

    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [id1, id2],
        replayParse: (_raw: string, deps: readonly unknown[]) => ({
          success: true as const,
          value: deps,
        }),
      },
    };

    const result = replayDerivedParser(
      { path: ["x"], parser: { dependencyMetadata: metadata }, state: {} },
      "input",
      runtime,
    );
    assert.equal(result, undefined);
  });

  test("returns undefined when getDefaultDependencyValues thunk throws", () => {
    // The node has no snapshotted defaults and the thunk throws —
    // replayDerivedParser must return undefined rather than propagating.
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    // Source is NOT registered so defaults are needed

    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [sourceId],
        getDefaultDependencyValues: () => {
          throw new Error("thunk blew up");
        },
        replayParse: (_raw: string, deps: readonly unknown[]) => ({
          success: true as const,
          value: `parsed-${deps[0]}`,
        }),
      },
    };

    // No defaultDependencyValues on the node → thunk is called
    const result = replayDerivedParser(
      { path: ["level"], parser: { dependencyMetadata: metadata }, state: {} },
      "warn",
      runtime,
    );
    assert.equal(result, undefined);
  });

  test("returns undefined for node with no derived metadata", () => {
    const runtime = createDependencyRuntimeContext();
    const result = replayDerivedParser(
      {
        path: ["x"],
        parser: { dependencyMetadata: undefined },
        state: {},
      },
      "input",
      runtime,
    );
    assert.equal(result, undefined);
  });
});

describe("replayDerivedParserAsync—additional branches", () => {
  test("returns undefined when dependencies are missing", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    // No source registered, no defaults

    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [sourceId],
        replayParse: (_raw: string, deps: readonly unknown[]) =>
          Promise.resolve({
            success: true as const,
            value: `async-${deps[0]}`,
          }),
      },
    };

    const result = await replayDerivedParserAsync(
      { path: ["level"], parser: { dependencyMetadata: metadata }, state: {} },
      "warn",
      runtime,
    );
    assert.equal(result, undefined);
  });

  test("returns undefined when partial dependencies", async () => {
    const runtime = createDependencyRuntimeContext();
    const id1 = Symbol("a");
    const id2 = Symbol("b");
    runtime.registerSource(id1, "present");
    // id2 missing → partial

    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [id1, id2],
        replayParse: () =>
          Promise.resolve({ success: true as const, value: 1 }),
      },
    };

    const result = await replayDerivedParserAsync(
      { path: ["x"], parser: { dependencyMetadata: metadata }, state: {} },
      "input",
      runtime,
    );
    assert.equal(result, undefined);
  });

  test("returns undefined when getDefaultDependencyValues thunk throws", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");

    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [sourceId],
        getDefaultDependencyValues: () => {
          throw new Error("async thunk blew up");
        },
        replayParse: () =>
          Promise.resolve({ success: true as const, value: 0 }),
      },
    };

    const result = await replayDerivedParserAsync(
      { path: ["level"], parser: { dependencyMetadata: metadata }, state: {} },
      "warn",
      runtime,
    );
    assert.equal(result, undefined);
  });

  test("uses snapshotted defaults instead of thunk", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    let thunkCalls = 0;

    const metadata: ParserDependencyMetadata = {
      derived: {
        kind: "derived",
        dependencyIds: [sourceId],
        getDefaultDependencyValues: () => {
          thunkCalls++;
          return ["thunk-dev"];
        },
        replayParse: (_raw: string, deps: readonly unknown[]) =>
          Promise.resolve({
            success: true as const,
            value: `async-${deps[0]}`,
          }),
      },
    };

    const result = await replayDerivedParserAsync(
      {
        path: ["level"],
        parser: { dependencyMetadata: metadata },
        state: {},
        defaultDependencyValues: ["snapshotted-dev"],
      },
      "warn",
      runtime,
    );

    assert.equal(thunkCalls, 0);
    assert.ok(result !== undefined);
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, "async-snapshotted-dev");
    }
  });

  test("returns undefined for node with no derived metadata", async () => {
    const runtime = createDependencyRuntimeContext();
    const result = await replayDerivedParserAsync(
      {
        path: ["x"],
        parser: { dependencyMetadata: undefined },
        state: {},
      },
      "input",
      runtime,
    );
    assert.equal(result, undefined);
  });
});

describe("fillMissingSourceDefaults—failure result", () => {
  test("propagates failure when getMissingSourceValue returns { success: false }", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    const errorMsg = message`env is required`;
    const nodes: RuntimeNode[] = [{
      path: ["env"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: bareExtract,
            preservesSourceValue: true,
            getMissingSourceValue: () => ({
              success: false as const,
              error: errorMsg,
            }),
          },
        },
      },
      state: undefined,
    }];

    const failures = fillMissingSourceDefaults(nodes, runtime);

    assert.equal(failures.length, 1);
    assert.equal(failures[0].sourceId, sourceId);
    // The failure result should carry the exact error message we provided.
    assert.ok(!failures[0].error.success);
    if (!failures[0].error.success) {
      assert.deepEqual(failures[0].error.error, errorMsg);
    }
    // Source should not be registered
    assert.ok(!runtime.hasSource(sourceId));
  });
});

describe("DependencyRuntimeContext—FailedAwareRegistry clone", () => {
  test("clone() preserves all failed-source state across multiple failures", () => {
    // Mark two distinct sources as failed and verify that both IDs are
    // preserved when the registry is cloned and wrapped in a new context.
    const sourceA = Symbol("envA");
    const sourceB = Symbol("envB");
    const runtime = createDependencyRuntimeContext();
    runtime.registerSource(sourceA, "prod");
    runtime.markSourceFailed(sourceA);
    runtime.markSourceFailed(sourceB);

    const clonedRegistry = runtime.registry.clone();
    const cloned = createDependencyRuntimeContext(clonedRegistry);

    // Both failed sources must be propagated through the clone
    assert.ok(cloned.isSourceFailed(sourceA));
    assert.ok(cloned.isSourceFailed(sourceB));
    assert.ok(!cloned.hasSource(sourceA));
  });
});

// =============================================================================
// Effectful source completion scheduling (issue #870)
// =============================================================================

function createCompleteExecFixture(
  session?: EffectfulCompletionSession,
  phase: "complete" | "parse" = "complete",
): ExecutionContext {
  return {
    usage: [],
    phase,
    path: [],
    ...(session != null ? { effectfulCompletionSession: session } : {}),
  };
}

function createEffectfulSourceNode(
  key: string,
  sourceId: symbol,
  completeSource: NonNullable<
    NonNullable<ParserDependencyMetadata["source"]>["completeSource"]
  >,
  options: { readonly preservesSourceValue?: boolean } = {},
): RuntimeNode {
  return {
    path: [key],
    parser: {
      dependencyMetadata: {
        source: {
          kind: "source",
          sourceId,
          extractSourceValue: () => undefined,
          preservesSourceValue: options.preservesSourceValue ?? true,
          completeSource,
        },
      },
    },
    state: undefined,
  };
}

describe("completeEffectfulSourcesAsync", () => {
  // https://github.com/dahlia/optique/issues/872
  test("reports the executing occurrence's completion lineage", async () => {
    const runtime = createDependencyRuntimeContext();
    const failedUpstream = Symbol("upstreamA");
    const otherUpstream = Symbol("upstreamB");
    const shared = Symbol("shared");
    const providerA = createRuntimeSourceNode({
      path: ["a"],
      sourceId: failedUpstream,
      metavar: "AAA",
    });
    const providerB = createRuntimeSourceNode({
      path: ["b"],
      sourceId: otherUpstream,
      metavar: "BBB",
    });
    runtime.registerSource(otherUpstream, "ok");
    runtime.registerSourceMetadata(failedUpstream, "AAA");
    runtime.registerSourceMetadata(otherUpstream, "BBB");
    runtime.markSourceFailed(failedUpstream);
    const occurrence = (
      key: string,
      dependencyId: symbol,
      completeSource: NonNullable<
        NonNullable<ParserDependencyMetadata["source"]>["completeSource"]
      >,
    ): RuntimeNode => ({
      path: [key],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId: shared,
            metavar: "SHARED",
            extractSourceValue: () => undefined,
            preservesSourceValue: true,
            completeSource,
          },
          completion: { dependencyIds: [dependencyId] },
        },
      },
      state: undefined,
    });
    const nodes: RuntimeNode[] = [
      providerA,
      providerB,
      occurrence("first", failedUpstream, () =>
        Promise.resolve({
          success: false,
          error: [{ type: "text", text: "Upstream failed." }],
        })),
      occurrence(
        "second",
        otherUpstream,
        () => Promise.resolve({ success: true, value: "unreached" }),
      ),
    ];

    const result = await completeEffectfulSourcesAsync(
      nodes,
      undefined,
      runtime,
      createCompleteExecFixture(),
    );

    assert.ok(!result.success);
    // The chain reflects the occurrence that actually failed (its
    // configuration depends on AAA), not the last-registered occurrence
    // (which depends on BBB).
    const chain = runtime.getSourceFailureChain(shared);
    assert.deepEqual(chain, ["AAA", "SHARED"]);
  });

  test("keeps a bypassed occurrence out of transitive failure", async () => {
    const runtime = createDependencyRuntimeContext();
    const idA = Symbol("a");
    const idB = Symbol("b");
    // A's own state already extracts a value, so its configuration
    // dependencies on B are inactive: B's cancellation must not fail A.
    const bypassed: RuntimeNode = {
      path: ["a"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId: idA,
            metavar: "AAA",
            extractSourceValue: () => ({ success: true, value: "cli" }),
            preservesSourceValue: true,
            completeSource: () =>
              Promise.resolve({ success: true, value: "cli" }),
          },
          completion: { dependencyIds: [idB] },
        },
      },
      state: undefined,
    };
    const cancelled = createEffectfulSourceNode(
      "b",
      idB,
      () =>
        Promise.resolve({
          success: false,
          error: [{ type: "text", text: "Prompt cancelled." }],
        }),
    );

    const result = await completeEffectfulSourcesAsync(
      [bypassed, cancelled],
      undefined,
      runtime,
      createCompleteExecFixture(),
    );

    assert.ok(!result.success);
    assert.ok(runtime.isSourceFailed(idB));
    assert.ok(!runtime.isSourceFailed(idA));
    assert.equal(runtime.getSource(idA), "cli");
  });

  test("runs completions serially in declaration order and registers", async () => {
    const runtime = createDependencyRuntimeContext();
    const idA = Symbol("a");
    const idB = Symbol("b");
    const order: string[] = [];
    const nodes: RuntimeNode[] = [
      createEffectfulSourceNode("a", idA, () => {
        order.push("a");
        return Promise.resolve({ success: true, value: "A" });
      }),
      createEffectfulSourceNode("b", idB, () => {
        order.push("b");
        return Promise.resolve({ success: true, value: "B" });
      }),
    ];

    const result = await completeEffectfulSourcesAsync(
      nodes,
      undefined,
      runtime,
      createCompleteExecFixture(),
    );

    assert.ok(result.success);
    assert.deepEqual(order, ["a", "b"]);
    assert.equal(runtime.getSource(idA), "A");
    assert.equal(runtime.getSource(idB), "B");
    assert.deepEqual(
      result.completed.map((c) => c.key),
      ["a", "b"],
    );
  });

  test(
    "completes an occurrence despite another occurrence's registered value",
    async () => {
      const runtime = createDependencyRuntimeContext();
      const id = Symbol("a");
      // Registered by another occurrence of the shared source (e.g., a
      // command-line value for a sibling field).  The effectful
      // occurrence's own field still needs a value, so its completion
      // runs and re-registers, and the last occurrence wins.
      runtime.registerSource(id, "cli");
      let calls = 0;
      const nodes: RuntimeNode[] = [
        createEffectfulSourceNode("a", id, () => {
          calls++;
          return Promise.resolve({ success: true, value: "prompted" });
        }),
      ];

      const result = await completeEffectfulSourcesAsync(
        nodes,
        undefined,
        runtime,
        createCompleteExecFixture(),
      );

      assert.ok(result.success);
      assert.equal(calls, 1);
      assert.equal(runtime.getSource(id), "prompted");
    },
  );

  test(
    "re-registers a later structural occurrence over an earlier effect",
    async () => {
      const runtime = createDependencyRuntimeContext();
      const id = Symbol("shared");
      // A structural occurrence declared after an effectful one: its
      // extracted value must register after the effectful result so
      // registration order follows declaration order.
      const structuralNode: RuntimeNode = {
        path: ["b"],
        parser: {
          dependencyMetadata: {
            source: {
              kind: "source",
              sourceId: id,
              extractSourceValue: () => ({
                success: true,
                value: "structural",
              }),
              preservesSourceValue: true,
            },
          },
        },
        state: undefined,
      };
      const nodes: RuntimeNode[] = [
        createEffectfulSourceNode(
          "a",
          id,
          () => Promise.resolve({ success: true, value: "prompted" }),
        ),
        structuralNode,
      ];

      const result = await completeEffectfulSourcesAsync(
        nodes,
        undefined,
        runtime,
        createCompleteExecFixture(),
      );

      assert.ok(result.success);
      assert.equal(runtime.getSource(id), "structural");
    },
  );

  test(
    "completes every occurrence of a shared source, last one winning",
    async () => {
      const runtime = createDependencyRuntimeContext();
      const id = Symbol("shared");
      const order: string[] = [];
      const nodes: RuntimeNode[] = [
        createEffectfulSourceNode("a", id, () => {
          order.push("a");
          return Promise.resolve({ success: true, value: "first" });
        }),
        createEffectfulSourceNode("b", id, () => {
          order.push("b");
          return Promise.resolve({ success: true, value: "second" });
        }),
      ];

      // A value registered by an earlier effectful occurrence within the
      // same pass must not suppress later occurrences: each occurrence
      // completes and re-registers, matching how repeated command-line
      // source occurrences overwrite earlier ones.
      const result = await completeEffectfulSourcesAsync(
        nodes,
        undefined,
        runtime,
        createCompleteExecFixture(),
      );

      assert.ok(result.success);
      assert.deepEqual(order, ["a", "b"]);
      assert.equal(runtime.getSource(id), "second");
    },
  );

  test("skips non-reusable sources when no session is available", async () => {
    const runtime = createDependencyRuntimeContext();
    const id = Symbol("a");
    let calls = 0;
    const nodes: RuntimeNode[] = [
      createEffectfulSourceNode("a", id, () => {
        calls++;
        return Promise.resolve({ success: true, value: "prompted" });
      }, { preservesSourceValue: false }),
    ];

    // Without a run-scoped session, a non-reusable completion cannot be
    // deduplicated against the construct's final completion phase, so it
    // must not run.
    const result = await completeEffectfulSourcesAsync(
      nodes,
      undefined,
      runtime,
      createCompleteExecFixture(),
    );

    assert.ok(result.success);
    assert.equal(calls, 0);
    assert.ok(!runtime.hasSource(id));
  });

  test(
    "registers pre-transform values for non-preserved sources with a session",
    async () => {
      const runtime = createDependencyRuntimeContext();
      const id = Symbol("a");
      let calls = 0;
      const nodes: RuntimeNode[] = [
        createEffectfulSourceNode("a", id, () => {
          calls++;
          return Promise.resolve({ success: true, value: "prompted" });
        }, { preservesSourceValue: false }),
      ];

      // With a session, the completion runs and registers the source
      // value, but the result is not cached for the owning construct
      // because the field's final value differs from the source value.
      const result = await completeEffectfulSourcesAsync(
        nodes,
        undefined,
        runtime,
        createCompleteExecFixture(createEffectfulCompletionSession()),
      );

      assert.ok(result.success);
      assert.equal(calls, 1);
      assert.equal(runtime.getSource(id), "prompted");
      assert.deepEqual(result.completed, []);
    },
  );

  test("treats expanded nodes as non-reusable via isReusable", async () => {
    const runtime = createDependencyRuntimeContext();
    const id = Symbol("a");
    const nodes: RuntimeNode[] = [
      createEffectfulSourceNode(
        "a",
        id,
        () => Promise.resolve({ success: true, value: "prompted" }),
      ),
    ];

    const result = await completeEffectfulSourcesAsync(
      nodes,
      undefined,
      runtime,
      createCompleteExecFixture(createEffectfulCompletionSession()),
      { isReusable: () => false },
    );

    assert.ok(result.success);
    assert.equal(runtime.getSource(id), "prompted");
    assert.deepEqual(result.completed, []);
  });

  test("does not run completions during probe phases", async () => {
    const runtime = createDependencyRuntimeContext();
    const id = Symbol("a");
    let calls = 0;
    const nodes: RuntimeNode[] = [
      createEffectfulSourceNode("a", id, () => {
        calls++;
        return Promise.resolve({ success: true, value: "prompted" });
      }),
    ];

    const result = await completeEffectfulSourcesAsync(
      nodes,
      undefined,
      runtime,
      createCompleteExecFixture(undefined, "parse"),
    );

    assert.ok(result.success);
    assert.equal(calls, 0);
  });

  test("aborts on failure without running later completions", async () => {
    const runtime = createDependencyRuntimeContext();
    const idA = Symbol("a");
    const idB = Symbol("b");
    let laterCalls = 0;
    const nodes: RuntimeNode[] = [
      createEffectfulSourceNode("a", idA, () =>
        Promise.resolve({
          success: false,
          error: message`Prompt cancelled.`,
        })),
      createEffectfulSourceNode("b", idB, () => {
        laterCalls++;
        return Promise.resolve({ success: true, value: "B" });
      }),
    ];

    const result = await completeEffectfulSourcesAsync(
      nodes,
      undefined,
      runtime,
      createCompleteExecFixture(),
    );

    assert.ok(!result.success);
    assert.equal(formatMessage(result.error), "Prompt cancelled.");
    assert.equal(laterCalls, 0);
    assert.ok(runtime.isSourceFailed(idA));
    assert.ok(!runtime.hasSource(idB));
  });

  test("treats undefined and deferred results as declined", async () => {
    const runtime = createDependencyRuntimeContext();
    const idA = Symbol("a");
    const idB = Symbol("b");
    const nodes: RuntimeNode[] = [
      createEffectfulSourceNode("a", idA, () => Promise.resolve(undefined)),
      createEffectfulSourceNode("b", idB, () =>
        Promise.resolve({
          success: true,
          value: "placeholder",
          deferred: true,
        })),
    ];

    const result = await completeEffectfulSourcesAsync(
      nodes,
      undefined,
      runtime,
      createCompleteExecFixture(),
    );

    assert.ok(result.success);
    assert.deepEqual(result.completed, []);
    assert.ok(!runtime.hasSource(idA));
    assert.ok(!runtime.hasSource(idB));
  });

  test("caches a successful undefined value without registering it", async () => {
    const runtime = createDependencyRuntimeContext();
    const id = Symbol("a");
    const nodes: RuntimeNode[] = [
      createEffectfulSourceNode(
        "a",
        id,
        () => Promise.resolve({ success: true, value: undefined }),
      ),
    ];

    const result = await completeEffectfulSourcesAsync(
      nodes,
      undefined,
      runtime,
      createCompleteExecFixture(),
    );

    assert.ok(result.success);
    assert.equal(result.completed.length, 1);
    assert.equal(result.completed[0].key, "a");
    assert.ok(!runtime.hasSource(id));
  });

  test("accumulates demanded ids into a demand-only session", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("mode");
    const session = createEffectfulCompletionSession("demand-only");
    const trace = createInputTrace().set(["level"], {
      kind: "option-value",
      rawInput: "debug",
      consumed: ["--level", "debug"],
    });
    const consumerNode: RuntimeNode = {
      path: ["level"],
      parser: {
        dependencyMetadata: {
          derived: {
            kind: "derived",
            dependencyIds: [sourceId],
            replayParse: () => ({ success: true, value: "debug" }),
          },
        },
      },
      state: undefined,
    };
    const nodes: RuntimeNode[] = [
      createEffectfulSourceNode(
        "mode",
        sourceId,
        () => Promise.resolve({ success: true, value: "prod" }),
      ),
      consumerNode,
    ];

    const result = await completeEffectfulSourcesAsync(
      nodes,
      undefined,
      runtime,
      { ...createCompleteExecFixture(session), trace },
    );

    assert.ok(result.success);
    assert.ok(session.demanded.has(sourceId));
  });

  // https://github.com/dahlia/optique/issues/919
  test("demands a barrier edge's prerequisites for a demanded consumer", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession("demand-only");
    const consumerId = Symbol("consumer");
    const prerequisiteId = Symbol("prerequisite");
    const chainedId = Symbol("chained");
    const trace = createInputTrace().set(["level"], {
      kind: "option-value",
      rawInput: "debug",
      consumed: ["--level", "debug"],
    });
    const derivedConsumer: RuntimeNode = {
      path: ["level"],
      parser: {
        dependencyMetadata: {
          derived: {
            kind: "derived",
            dependencyIds: [consumerId],
            replayParse: () => ({ success: true, value: "debug" }),
          },
        },
      },
      state: undefined,
    };
    const barrier = createBarrierNode({
      path: ["barrier"],
      providesSourceIds: new Set([consumerId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [prerequisiteId],
        demandEdges: [{
          consumerSourceId: consumerId,
          dependencyIds: [prerequisiteId],
        }],
      },
    });
    // The flat rule chains onward: the demanded prerequisite's own
    // completion consumes another source.
    const prerequisite = createRuntimeSourceNode({
      path: ["prerequisite"],
      sourceId: prerequisiteId,
      completionDependencyIds: [chainedId],
      metavar: "PREREQ",
    });

    const result = await completeEffectfulSourcesAsync(
      [barrier, derivedConsumer, prerequisite],
      undefined,
      runtime,
      { ...createCompleteExecFixture(session), trace },
    );

    assert.ok(result.success);
    assert.ok(session.demanded.has(prerequisiteId));
    assert.ok(session.demanded.has(chainedId));
  });

  test("keeps an undemanded barrier edge's prerequisites undemanded", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession("demand-only");
    const consumerId = Symbol("consumer");
    const otherBranchId = Symbol("otherBranch");
    const prerequisiteId = Symbol("prerequisite");
    const discriminatorId = Symbol("discriminator");
    // An unrelated branch source and the discriminator control
    // dependency are demanded, but not the edge's consumer.
    session.demanded.add(otherBranchId);
    session.demanded.add(discriminatorId);
    const barrier = createBarrierNode({
      path: ["barrier"],
      requiresSourceId: discriminatorId,
      providesSourceIds: new Set([consumerId, otherBranchId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [prerequisiteId],
        demandEdges: [{
          consumerSourceId: consumerId,
          dependencyIds: [prerequisiteId],
        }],
      },
    });

    const result = await completeEffectfulSourcesAsync(
      [barrier],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.ok(!session.demanded.has(prerequisiteId));
  });

  // https://github.com/dahlia/optique/issues/925
  test("withholds a gated barrier's demand edges until resolution", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession("demand-only");
    const consumerId = Symbol("consumer");
    const prerequisiteId = Symbol("prerequisite");
    const discriminatorId = Symbol("discriminator");
    const order: string[] = [];
    session.demanded.add(consumerId);
    // The prerequisite is declared first: without parking it would pass
    // its slot (and defer) before the barrier's resolution promotes it.
    const prerequisite = createEffectfulSourceNode(
      "prerequisite",
      prerequisiteId,
      (_state, exec) => {
        const s = exec?.effectfulCompletionSession;
        if (s?.policy === "demand-only" && !s.demanded.has(prerequisiteId)) {
          order.push("prerequisite-deferred");
          return Promise.resolve(undefined);
        }
        order.push("prerequisite");
        return Promise.resolve({ success: true, value: "p" });
      },
    );
    const discriminator = createEffectfulSourceNode(
      "discriminator",
      discriminatorId,
      () => {
        order.push("discriminator");
        return Promise.resolve({ success: true, value: "a" });
      },
    );
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      requiresSourceId: discriminatorId,
      providesSourceIds: new Set([consumerId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [prerequisiteId],
        demandEdges: [{
          consumerSourceId: consumerId,
          dependencyIds: [prerequisiteId],
        }],
      },
      barrierDemandActivation: "after-resolution",
      resolveBarrier: () =>
        Promise.resolve({
          orderingDependencyIds: [prerequisiteId],
          activeProvidesSourceIds: new Set([consumerId]),
          demandEdges: [{
            consumerSourceId: consumerId,
            dependencyIds: [prerequisiteId],
          }],
        }),
      prepare: () => {
        order.push("barrier");
        return Promise.resolve(undefined);
      },
    };

    const result = await completeEffectfulSourcesAsync(
      [prerequisite, discriminator, barrier],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    // The resolution promoted the parked prerequisite into its
    // dependency slot: discriminator, prerequisite provider, barrier.
    assert.deepEqual(order, ["discriminator", "prerequisite", "barrier"]);
    assert.ok(session.demanded.has(prerequisiteId));
  });

  // https://github.com/dahlia/optique/issues/925
  test("leaves a gated prerequisite undemanded without promotion", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession("demand-only");
    const consumerId = Symbol("consumer");
    const prerequisiteId = Symbol("prerequisite");
    const discriminatorId = Symbol("discriminator");
    const order: string[] = [];
    session.demanded.add(consumerId);
    const prerequisite = createEffectfulSourceNode(
      "prerequisite",
      prerequisiteId,
      (_state, exec) => {
        const s = exec?.effectfulCompletionSession;
        if (s?.policy === "demand-only" && !s.demanded.has(prerequisiteId)) {
          order.push("prerequisite-deferred");
          return Promise.resolve(undefined);
        }
        order.push("prerequisite");
        return Promise.resolve({ success: true, value: "p" });
      },
    );
    const discriminator = createEffectfulSourceNode(
      "discriminator",
      discriminatorId,
      () => {
        order.push("discriminator");
        return Promise.resolve({ success: true, value: "b" });
      },
    );
    // The resolution keeps no demand edges (the selection does not read
    // the prerequisite), so the parked prerequisite stays undemanded
    // and defers once parking lifts.
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      requiresSourceId: discriminatorId,
      providesSourceIds: new Set([consumerId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [prerequisiteId],
        demandEdges: [{
          consumerSourceId: consumerId,
          dependencyIds: [prerequisiteId],
        }],
      },
      barrierDemandActivation: "after-resolution",
      resolveBarrier: () =>
        Promise.resolve({
          orderingDependencyIds: [],
          activeProvidesSourceIds: new Set<symbol>(),
          demandEdges: [],
        }),
      prepare: () => {
        order.push("barrier");
        return Promise.resolve(undefined);
      },
    };

    const result = await completeEffectfulSourcesAsync(
      [prerequisite, discriminator, barrier],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.deepEqual(order, [
      "discriminator",
      "prerequisite-deferred",
      "barrier",
    ]);
    assert.ok(!session.demanded.has(prerequisiteId));
  });

  // https://github.com/dahlia/optique/issues/925
  test("terminates when gated barriers await each other's demand", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession("demand-only");
    const order: string[] = [];
    const makeSide = (label: string): readonly RuntimeNode[] => {
      const discriminatorId = Symbol(`${label}-discriminator`);
      const branchId = Symbol(`${label}-branch`);
      const discriminator = createEffectfulSourceNode(
        `${label}-discriminator`,
        discriminatorId,
        (_state, exec) => {
          const s = exec?.effectfulCompletionSession;
          if (s?.policy === "demand-only" && !s.demanded.has(discriminatorId)) {
            order.push(`${label}-deferred`);
            return Promise.resolve(undefined);
          }
          order.push(label);
          return Promise.resolve({ success: true, value: label });
        },
      );
      const barrier: RuntimeNode = {
        path: [`${label}-barrier`],
        parser: {},
        state: undefined,
        requiresSourceId: discriminatorId,
        providesSourceIds: new Set([branchId]),
        barrierCompletionDependencies: {
          orderingDependencyIds: [],
          demandEdges: [],
        },
        barrierDemandActivation: "after-resolution",
        // The discriminator never completed, so resolution reports
        // "not yet resolvable" and the barrier becomes unresolvable.
        resolveBarrier: () => Promise.resolve(undefined),
        prepare: () => {
          order.push(`${label}-barrier`);
          return Promise.resolve(undefined);
        },
      };
      return [discriminator, barrier];
    };

    // Neither discriminator is demanded, so both barriers are skipped
    // and both discriminators parked: the all-blocked fallback must
    // resolve the barriers (to unresolvable) and let the pass drain
    // with both prompts deferring to the eager pass.
    const result = await completeEffectfulSourcesAsync(
      [...makeSide("a"), ...makeSide("b")],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.deepEqual(order, [
      "a-deferred",
      "a-barrier",
      "b-deferred",
      "b-barrier",
    ]);
  });

  // https://github.com/dahlia/optique/issues/925
  test("chains late demand through a resolved barrier's edges", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession("demand-only");
    const c1 = Symbol("firstConsumer");
    const c2 = Symbol("secondConsumer");
    const p1 = Symbol("prerequisite");
    const disc1 = Symbol("firstDiscriminator");
    const disc2 = Symbol("secondDiscriminator");
    const order: string[] = [];
    session.demanded.add(disc1);
    session.demanded.add(c2);
    const prerequisite = createEffectfulSourceNode(
      "prerequisite",
      p1,
      (_state, exec) => {
        const s = exec?.effectfulCompletionSession;
        if (s?.policy === "demand-only" && !s.demanded.has(p1)) {
          order.push("prerequisite-deferred");
          return Promise.resolve(undefined);
        }
        order.push("prerequisite");
        return Promise.resolve({ success: true, value: "p" });
      },
    );
    const effectful = (key: string, sourceId: symbol): RuntimeNode =>
      createEffectfulSourceNode(key, sourceId, () => {
        order.push(key);
        return Promise.resolve({ success: true, value: key });
      });
    const gatedBarrier = (options: {
      readonly path: string;
      readonly requires: symbol;
      readonly provides: symbol;
      readonly edges: readonly {
        readonly consumerSourceId: symbol;
        readonly dependencyIds: readonly symbol[];
      }[];
    }): RuntimeNode => ({
      path: [options.path],
      parser: {},
      state: undefined,
      requiresSourceId: options.requires,
      providesSourceIds: new Set([options.provides]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [],
        demandEdges: options.edges,
      },
      barrierDemandActivation: "after-resolution",
      resolveBarrier: () =>
        Promise.resolve({
          orderingDependencyIds: [],
          activeProvidesSourceIds: new Set([options.provides]),
          demandEdges: options.edges,
        }),
      prepare: () => {
        order.push(options.path);
        return Promise.resolve(undefined);
      },
    });
    // The first barrier resolves (and prepares) before its consumer is
    // demanded; the second barrier's later resolution demands that
    // consumer, and the chain must still reach the prerequisite through
    // the first barrier's resolved edges even though the first barrier
    // already left the pending list.
    const first = gatedBarrier({
      path: "first-barrier",
      requires: disc1,
      provides: c1,
      edges: [{ consumerSourceId: c1, dependencyIds: [p1] }],
    });
    const second = gatedBarrier({
      path: "second-barrier",
      requires: disc2,
      provides: c2,
      edges: [{ consumerSourceId: c2, dependencyIds: [c1] }],
    });

    const result = await completeEffectfulSourcesAsync(
      [
        prerequisite,
        effectful("first-discriminator", disc1),
        first,
        effectful("second-discriminator", disc2),
        second,
      ],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.ok(session.demanded.has(p1));
    assert.deepEqual(order, [
      "first-discriminator",
      "first-barrier",
      "second-discriminator",
      "prerequisite",
      "second-barrier",
    ]);
  });

  // https://github.com/dahlia/optique/issues/925
  test("parks hard-edge descendants of a parked provider", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession("demand-only");
    const consumerId = Symbol("consumer");
    const providerId = Symbol("provider");
    const derivedId = Symbol("derivedSource");
    const discriminatorId = Symbol("discriminator");
    const order: string[] = [];
    session.demanded.add(consumerId);
    // The derived node consumed raw input, so visiting it replays
    // immediately; the hard-edge closure must keep it parked behind
    // its parked provider until the gated barrier's resolution
    // promotes the provider.
    const derivedNode: RuntimeNode = {
      path: ["derived"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId: derivedId,
            metavar: "DERIVED",
            extractSourceValue: () => undefined,
            preservesSourceValue: true,
          },
          derived: {
            kind: "derived",
            dependencyIds: [providerId],
            metavar: "DERIVED",
            replayParse: (rawInput) => {
              order.push("derived-replay");
              return { success: true, value: rawInput };
            },
          },
        },
      },
      state: undefined,
      rawInput: "x",
    };
    const provider = createEffectfulSourceNode(
      "provider",
      providerId,
      () => {
        order.push("provider");
        return Promise.resolve({ success: true, value: "p" });
      },
    );
    const discriminator = createEffectfulSourceNode(
      "discriminator",
      discriminatorId,
      () => {
        order.push("discriminator");
        return Promise.resolve({ success: true, value: "a" });
      },
    );
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      requiresSourceId: discriminatorId,
      providesSourceIds: new Set([consumerId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [providerId],
        demandEdges: [{
          consumerSourceId: consumerId,
          dependencyIds: [providerId],
        }],
      },
      barrierDemandActivation: "after-resolution",
      resolveBarrier: () =>
        Promise.resolve({
          orderingDependencyIds: [providerId],
          activeProvidesSourceIds: new Set([consumerId]),
          demandEdges: [{
            consumerSourceId: consumerId,
            dependencyIds: [providerId],
          }],
        }),
      prepare: () => {
        order.push("barrier");
        return Promise.resolve(undefined);
      },
    };

    const result = await completeEffectfulSourcesAsync(
      [derivedNode, provider, discriminator, barrier],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.deepEqual(order, [
      "discriminator",
      "provider",
      "derived-replay",
      "barrier",
    ]);
  });

  // https://github.com/dahlia/optique/issues/924
  test("resolves a barrier ahead of an advisory provider it refines away", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession("eager");
    const providerId = Symbol("provider");
    const discriminatorId = Symbol("discriminator");
    const order: string[] = [];
    // The static estimate orders the barrier after the later provider,
    // but resolution—eligible once its control dependency is satisfied
    // and never blocked by advisory edges—reports no concrete
    // dependencies, so the barrier executes first at its declaration
    // position.
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      requiresSourceId: discriminatorId,
      barrierCompletionDependencies: {
        orderingDependencyIds: [providerId],
        demandEdges: [],
      },
      resolveBarrier: () =>
        Promise.resolve({
          orderingDependencyIds: [],
          activeProvidesSourceIds: new Set<symbol>(),
          demandEdges: [],
        }),
      prepare: () => {
        order.push("barrier");
        return Promise.resolve(undefined);
      },
    };
    const provider: RuntimeNode = {
      path: ["provider"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId: providerId,
            metavar: "PROVIDER",
            extractSourceValue: () => undefined,
            completeSource: () => {
              order.push("provider");
              return Promise.resolve({ success: true, value: "x" });
            },
            preservesSourceValue: true,
          },
        },
      },
      state: undefined,
    };

    const result = await completeEffectfulSourcesAsync(
      [barrier, provider],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.deepEqual(order, ["barrier", "provider"]);
  });

  // https://github.com/dahlia/optique/issues/924
  test("keeps a resolved concrete dependency ordered after its provider", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession("eager");
    const providerId = Symbol("provider");
    const discriminatorId = Symbol("discriminator");
    const order: string[] = [];
    // Resolution confirms the barrier's dependency, so the concrete
    // edge holds: the provider still completes first.
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      requiresSourceId: discriminatorId,
      barrierCompletionDependencies: {
        orderingDependencyIds: [providerId],
        demandEdges: [],
      },
      resolveBarrier: () =>
        Promise.resolve({
          orderingDependencyIds: [providerId],
          activeProvidesSourceIds: new Set<symbol>(),
          demandEdges: [],
        }),
      prepare: () => {
        order.push("barrier");
        return Promise.resolve(undefined);
      },
    };
    const provider: RuntimeNode = {
      path: ["provider"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId: providerId,
            metavar: "PROVIDER",
            extractSourceValue: () => undefined,
            completeSource: () => {
              order.push("provider");
              return Promise.resolve({ success: true, value: "x" });
            },
            preservesSourceValue: true,
          },
        },
      },
      state: undefined,
    };

    const result = await completeEffectfulSourcesAsync(
      [barrier, provider],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.deepEqual(order, ["provider", "barrier"]);
  });

  // The remaining tests pin publication provenance and barrier-exit
  // re-assertion (https://github.com/dahlia/optique/issues/928): a
  // barrier's branch publish is confined to the branch when a
  // later-declared occurrence has already published, while earlier
  // occurrences and untouched sources keep the plain write order.
  test("re-asserts a later occurrence over a barrier's branch publish", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession();
    const sourceId = Symbol("framework");
    const branchProvider = createEffectfulSourceNode(
      "branch",
      sourceId,
      () => Promise.resolve({ success: true, value: "branch" }),
    );
    // The ordering dependency ranks the later provider ahead of the
    // barrier, so the branch publish lands on top of the later value.
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      providesSourceIds: new Set([sourceId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [sourceId],
        demandEdges: [],
      },
      prepare: (ctx) => ctx.schedule([branchProvider]),
    };
    const later = createEffectfulSourceNode(
      "later",
      sourceId,
      () => Promise.resolve({ success: true, value: "later" }),
    );

    const result = await completeEffectfulSourcesAsync(
      [barrier, later],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.equal(runtime.registry.get(sourceId), "later");
  });

  test("keeps a branch publish over an earlier-declared occurrence", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession();
    const sourceId = Symbol("framework");
    const earlier = createEffectfulSourceNode(
      "earlier",
      sourceId,
      () => Promise.resolve({ success: true, value: "earlier" }),
    );
    const branchProvider = createEffectfulSourceNode(
      "branch",
      sourceId,
      () => Promise.resolve({ success: true, value: "branch" }),
    );
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      providesSourceIds: new Set([sourceId]),
      prepare: (ctx) => ctx.schedule([branchProvider]),
    };

    const result = await completeEffectfulSourcesAsync(
      [earlier, barrier],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.equal(runtime.registry.get(sourceId), "branch");
  });

  test("re-registers nothing when the branch does not publish", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession();
    const sourceId = Symbol("framework");
    const writes: unknown[] = [];
    const originalRegister = runtime.registerSource.bind(runtime);
    runtime.registerSource = (id, value) => {
      writes.push([id, value]);
      originalRegister(id, value);
    };
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      providesSourceIds: new Set([sourceId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [sourceId],
        demandEdges: [],
      },
      prepare: (ctx) => ctx.schedule([]),
    };
    const later = createEffectfulSourceNode(
      "later",
      sourceId,
      () => Promise.resolve({ success: true, value: "later" }),
    );

    const result = await completeEffectfulSourcesAsync(
      [barrier, later],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.equal(runtime.registry.get(sourceId), "later");
    assert.deepEqual(writes, [[sourceId, "later"]]);
  });

  test("skips re-assertion when the barrier's preparation fails", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession();
    const sourceId = Symbol("framework");
    const laterExecuted: string[] = [];
    const writes: unknown[] = [];
    const originalRegister = runtime.registerSource.bind(runtime);
    runtime.registerSource = (id, value) => {
      writes.push(value);
      originalRegister(id, value);
    };
    const branchProvider = createEffectfulSourceNode(
      "branch",
      sourceId,
      () => Promise.resolve({ success: true, value: "branch" }),
    );
    const failing = createEffectfulSourceNode(
      "failing",
      Symbol("failing"),
      () =>
        Promise.resolve({
          success: false,
          error: message`Cancelled.`,
        }),
    );
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      providesSourceIds: new Set([sourceId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [sourceId],
        demandEdges: [],
      },
      prepare: (ctx) => ctx.schedule([branchProvider, failing]),
    };
    const later = createEffectfulSourceNode(
      "later",
      sourceId,
      () => {
        laterExecuted.push("later");
        return Promise.resolve({ success: true, value: "later" });
      },
    );
    const trailing = createEffectfulSourceNode(
      "trailing",
      Symbol("trailing"),
      () => {
        laterExecuted.push("trailing");
        return Promise.resolve({ success: true, value: "t" });
      },
    );

    const result = await completeEffectfulSourcesAsync(
      [barrier, later, trailing],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    // The nested failure aborts the pass at the barrier: the branch's
    // publish is the last write, and no later effect runs after it.
    assert.ok(!result.success);
    assert.deepEqual(laterExecuted, ["later"]);
    assert.deepEqual(writes, ["later", "branch"]);
  });

  test("restores a later sibling barrier's publish over an earlier barrier's", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession();
    const sourceId = Symbol("framework");
    const prerequisiteId = Symbol("prerequisite");
    const firstBranch = createEffectfulSourceNode(
      "firstBranch",
      sourceId,
      () => Promise.resolve({ success: true, value: "first" }),
    );
    const secondBranch = createEffectfulSourceNode(
      "secondBranch",
      sourceId,
      () => Promise.resolve({ success: true, value: "second" }),
    );
    // The earlier barrier waits for a prerequisite declared after the
    // later barrier, so it executes last; its publish loses the
    // provenance comparison against the later barrier's, but must still
    // be observed as an overwrite and re-asserted away.
    const firstBarrier: RuntimeNode = {
      path: ["firstBarrier"],
      parser: {},
      state: undefined,
      providesSourceIds: new Set([sourceId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [prerequisiteId],
        demandEdges: [],
      },
      prepare: (ctx) => ctx.schedule([firstBranch]),
    };
    const secondBarrier: RuntimeNode = {
      path: ["secondBarrier"],
      parser: {},
      state: undefined,
      providesSourceIds: new Set([sourceId]),
      prepare: (ctx) => ctx.schedule([secondBranch]),
    };
    const prerequisite = createEffectfulSourceNode(
      "prerequisite",
      prerequisiteId,
      () => Promise.resolve({ success: true, value: "p" }),
    );

    const result = await completeEffectfulSourcesAsync(
      [firstBarrier, secondBarrier, prerequisite],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.equal(runtime.registry.get(sourceId), "second");
  });

  test("re-asserts a later occurrence whose successful value is undefined", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession();
    const sourceId = Symbol("framework");
    const writes: unknown[] = [];
    const originalRegister = runtime.registerSource.bind(runtime);
    runtime.registerSource = (id, value) => {
      writes.push(value);
      originalRegister(id, value);
    };
    const branchProvider = createEffectfulSourceNode(
      "branch",
      sourceId,
      () => Promise.resolve({ success: true, value: "branch" }),
    );
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      providesSourceIds: new Set([sourceId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [sourceId],
        demandEdges: [],
      },
      prepare: (ctx) => ctx.schedule([branchProvider]),
    };
    // The extraction contract allows a successful `undefined` value, and
    // explicit source collection registers it; the pass must record such
    // a publication too, so the barrier exit can restore it.
    const later: RuntimeNode = {
      path: ["later"],
      parser: {
        dependencyMetadata: {
          source: {
            kind: "source",
            sourceId,
            extractSourceValue: () => ({ success: true, value: undefined }),
            preservesSourceValue: true,
          },
        },
      },
      state: undefined,
    };

    const result = await completeEffectfulSourcesAsync(
      [barrier, later],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    assert.ok(result.success);
    assert.ok(runtime.hasSource(sourceId));
    assert.deepEqual(writes, [undefined, "branch", undefined]);
  });

  test("reuses a cached completion without a spurious re-assertion", async () => {
    const runtime = createDependencyRuntimeContext();
    const session = createEffectfulCompletionSession();
    const sourceId = Symbol("framework");
    const executed: string[] = [];
    const branchProvider = createEffectfulSourceNode(
      "branch",
      sourceId,
      () => Promise.resolve({ success: true, value: "branch" }),
    );
    const barrier: RuntimeNode = {
      path: ["barrier"],
      parser: {},
      state: undefined,
      providesSourceIds: new Set([sourceId]),
      prepare: (ctx) => ctx.schedule([branchProvider]),
    };
    const cached = createEffectfulSourceNode(
      "cached",
      sourceId,
      () => {
        executed.push("cached");
        return Promise.resolve({ success: true, value: "cached" });
      },
    );
    session.completedByPath.set(
      serializeSchedulingPath(cached.path),
      { success: true, value: "cached" },
    );

    const result = await completeEffectfulSourcesAsync(
      [barrier, cached],
      undefined,
      runtime,
      createCompleteExecFixture(session),
    );

    // The cached occurrence neither re-runs its effect nor registers a
    // new value, so the barrier's publish stands and no re-assertion
    // fires for it.
    assert.ok(result.success);
    assert.deepEqual(executed, []);
    assert.equal(runtime.registry.get(sourceId), "branch");
  });
});

describe("collectDemandedDependencyIds", () => {
  test("collects ids from derived nodes with trace raw input", () => {
    const sourceId = Symbol("mode");
    const trace = createInputTrace().set(["level"], {
      kind: "option-value",
      rawInput: "debug",
      consumed: ["--level", "debug"],
    });
    const nodes: RuntimeNode[] = [{
      path: ["level"],
      parser: {
        dependencyMetadata: {
          derived: {
            kind: "derived",
            dependencyIds: [sourceId],
            replayParse: () => ({ success: true, value: "debug" }),
          },
        },
      },
      state: undefined,
    }];

    const demanded = collectDemandedDependencyIds(nodes, undefined, trace);

    assert.ok(demanded.has(sourceId));
  });

  test("ignores derived nodes without raw input evidence", () => {
    const sourceId = Symbol("mode");
    const nodes: RuntimeNode[] = [{
      path: ["level"],
      parser: {
        dependencyMetadata: {
          derived: {
            kind: "derived",
            dependencyIds: [sourceId],
            replayParse: () => ({ success: true, value: "debug" }),
          },
        },
      },
      state: undefined,
    }];

    const demanded = collectDemandedDependencyIds(
      nodes,
      undefined,
      createInputTrace(),
    );

    assert.ok(!demanded.has(sourceId));
  });

  test("collects ids from legacy deferred states in the state tree", () => {
    const sourceId = Symbol("mode");
    const derivedParser = makeDerivedValueParser(
      sourceId,
      (rawInput) => ({ success: true, value: rawInput }),
    );
    const deferred = createDeferredParseState(
      "debug",
      derivedParser,
      { success: true, value: "debug" } as ValueParserResult<unknown>,
    );

    const demanded = collectDemandedDependencyIds(
      [],
      { level: deferred },
      undefined,
    );

    assert.ok(demanded.has(sourceId));
  });
});

describe("orderDependencyNodes", () => {
  test("orders a derived source after every in-scope provider", () => {
    const upstreamId = Symbol("upstream");
    const derivedId = Symbol("derived");
    const consumer = createRuntimeSourceNode({
      path: ["consumer"],
      sourceId: derivedId,
      dependencyIds: [upstreamId],
      metavar: "CONSUMER",
    });
    const unrelated = createRuntimeSourceNode({
      path: ["unrelated"],
      sourceId: Symbol("unrelated"),
      metavar: "UNRELATED",
    });
    const provider = createRuntimeSourceNode({
      path: ["provider"],
      sourceId: upstreamId,
      metavar: "PROVIDER",
    });

    const ordered = orderDependencyNodes([consumer, unrelated, provider]);

    assert.deepEqual(ordered, [unrelated, provider, consumer]);
  });

  test("does not treat a missing provider as a cycle", () => {
    const consumer = createRuntimeSourceNode({
      path: ["consumer"],
      sourceId: Symbol("derived"),
      dependencyIds: [Symbol("absent")],
      metavar: "CONSUMER",
    });

    const ordered = orderDependencyNodes([consumer]);

    assert.deepEqual(ordered, [consumer]);
  });

  // https://github.com/dahlia/optique/issues/872
  test("orders a completion consumer after its provider", () => {
    const upstreamId = Symbol("upstream");
    const consumer = createRuntimeSourceNode({
      path: ["consumer"],
      sourceId: Symbol("consumer"),
      completionDependencyIds: [upstreamId],
      metavar: "CONSUMER",
    });
    const provider = createRuntimeSourceNode({
      path: ["provider"],
      sourceId: upstreamId,
      metavar: "PROVIDER",
    });

    const ordered = orderDependencyNodes([consumer, provider]);

    assert.deepEqual(ordered, [provider, consumer]);
  });

  test("skips a completion dependency on the node's own source", () => {
    const sourceId = Symbol("self");
    const node = createRuntimeSourceNode({
      path: ["self"],
      sourceId,
      completionDependencyIds: [sourceId],
      metavar: "SELF",
    });

    const ordered = orderDependencyNodes([node]);

    assert.deepEqual(ordered, [node]);
  });

  test("keeps same-source self dependencies acyclic across occurrences", () => {
    const sharedId = Symbol("shared");
    const first = createRuntimeSourceNode({
      path: ["first"],
      sourceId: sharedId,
      completionDependencyIds: [sharedId],
      metavar: "FIRST",
    });
    const second = createRuntimeSourceNode({
      path: ["second"],
      sourceId: sharedId,
      completionDependencyIds: [sharedId],
      metavar: "SECOND",
    });

    const ordered = orderDependencyNodes([first, second]);

    assert.deepEqual(ordered, [first, second]);
  });

  test("detects a cycle formed by completion dependencies", () => {
    const firstId = Symbol("first");
    const secondId = Symbol("second");
    const first = createRuntimeSourceNode({
      path: ["first"],
      sourceId: firstId,
      completionDependencyIds: [secondId],
      metavar: "FIRST",
    });
    const second = createRuntimeSourceNode({
      path: ["second"],
      sourceId: secondId,
      completionDependencyIds: [firstId],
      metavar: "SECOND",
    });

    assert.throws(
      () => orderDependencyNodes([first, second]),
      /Circular dependency.*FIRST \(first\).*SECOND \(second\)/,
    );
  });

  // https://github.com/dahlia/optique/issues/919
  test("orders a barrier after providers of its branch completion deps", () => {
    const upstreamId = Symbol("upstream");
    const barrier = createBarrierNode({
      path: ["barrier"],
      barrierCompletionDependencies: {
        orderingDependencyIds: [upstreamId],
        demandEdges: [],
      },
    });
    const unrelated = createRuntimeSourceNode({
      path: ["unrelated"],
      sourceId: Symbol("unrelated"),
      metavar: "UNRELATED",
    });
    const provider = createRuntimeSourceNode({
      path: ["provider"],
      sourceId: upstreamId,
      metavar: "PROVIDER",
    });

    const ordered = orderDependencyNodes([barrier, unrelated, provider]);

    assert.deepEqual(ordered, [unrelated, provider, barrier]);
  });

  test("skips a barrier completion dependency the barrier provides", () => {
    const sharedId = Symbol("shared");
    const barrier = createBarrierNode({
      path: ["barrier"],
      providesSourceIds: new Set([sharedId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [sharedId],
        demandEdges: [],
      },
    });

    const ordered = orderDependencyNodes([barrier]);

    assert.deepEqual(ordered, [barrier]);
  });

  // https://github.com/dahlia/optique/issues/924
  test("relaxes an advisory cycle between a barrier and a sibling consumer", () => {
    const branchId = Symbol("branch");
    const siblingId = Symbol("sibling");
    // The barrier's ordering dependency on the sibling comes from one
    // selectable branch, while the branch source the sibling consumes
    // could only be provided by another: the opposing edges cannot be
    // active together, so the unresolved barrier's advisory in-edge is
    // relaxed and declaration order prevails.
    const barrier = createBarrierNode({
      path: ["barrier"],
      providesSourceIds: new Set([branchId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [siblingId],
        demandEdges: [],
      },
    });
    const sibling = createRuntimeSourceNode({
      path: ["sibling"],
      sourceId: siblingId,
      completionDependencyIds: [branchId],
      metavar: "SIBLING",
    });

    const ordered = orderDependencyNodes([barrier, sibling]);

    assert.deepEqual(ordered, [barrier, sibling]);
  });

  // https://github.com/dahlia/optique/issues/924
  test("detects a concrete cycle through a resolved barrier", () => {
    const branchId = Symbol("branch");
    const siblingId = Symbol("sibling");
    // Once the barrier resolves its selection, its edges are concrete:
    // the selected branch actively provides the source the sibling
    // consumes while also waiting for the sibling, which is a genuine
    // cycle.
    const barrier = createBarrierNode({
      path: ["barrier"],
      providesSourceIds: new Set([branchId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [siblingId],
        demandEdges: [],
      },
      barrierResolutionState: "resolved",
    });
    const sibling = createRuntimeSourceNode({
      path: ["sibling"],
      sourceId: siblingId,
      completionDependencyIds: [branchId],
      metavar: "SIBLING",
    });

    assert.throws(
      () => orderDependencyNodes([barrier, sibling]),
      /Circular dependency/,
    );
  });

  // https://github.com/dahlia/optique/issues/924
  test("keeps advisory relaxation local to the stalled component", () => {
    const branchId = Symbol("branch");
    const siblingId = Symbol("sibling");
    const outsideId = Symbol("outside");
    // A second barrier that merely waits for a provider outside the
    // cycle keeps its advisory edge: only edges inside the strongly
    // connected component are relaxed.
    const cyclic = createBarrierNode({
      path: ["cyclic"],
      providesSourceIds: new Set([branchId]),
      barrierCompletionDependencies: {
        orderingDependencyIds: [siblingId],
        demandEdges: [],
      },
    });
    const sibling = createRuntimeSourceNode({
      path: ["sibling"],
      sourceId: siblingId,
      completionDependencyIds: [branchId],
      metavar: "SIBLING",
    });
    const waiting = createBarrierNode({
      path: ["waiting"],
      barrierCompletionDependencies: {
        orderingDependencyIds: [outsideId],
        demandEdges: [],
      },
    });
    const provider = createRuntimeSourceNode({
      path: ["provider"],
      sourceId: outsideId,
      metavar: "PROVIDER",
    });

    const ordered = orderDependencyNodes([cyclic, sibling, waiting, provider]);

    // Ready nodes drain first; the stalled pair is relaxed afterwards,
    // and the waiting barrier's advisory edge to its provider held.
    assert.deepEqual(ordered, [provider, waiting, cyclic, sibling]);
  });

  test("reports the paths and metavars in a forged cycle", () => {
    const firstId = Symbol("first");
    const secondId = Symbol("second");
    const first = createRuntimeSourceNode({
      path: ["first"],
      sourceId: firstId,
      dependencyIds: [secondId],
      metavar: "FIRST",
    });
    const second = createRuntimeSourceNode({
      path: ["second"],
      sourceId: secondId,
      dependencyIds: [firstId],
      metavar: "SECOND",
    });

    assert.throws(
      () => orderDependencyNodes([first, second]),
      /Circular dependency.*FIRST \(first\).*SECOND \(second\)/,
    );
  });
});

// Helpers

function createBarrierNode(options: {
  readonly path: readonly PropertyKey[];
  readonly requiresSourceId?: symbol;
  readonly providesSourceIds?: ReadonlySet<symbol>;
  readonly barrierCompletionDependencies?: BarrierCompletionDependencies;
  readonly barrierResolutionState?: "resolved" | "unresolvable";
}): RuntimeNode {
  return {
    path: options.path,
    parser: {},
    state: undefined,
    ...(options.requiresSourceId != null
      ? { requiresSourceId: options.requiresSourceId }
      : {}),
    ...(options.providesSourceIds != null
      ? { providesSourceIds: options.providesSourceIds }
      : {}),
    ...(options.barrierCompletionDependencies != null
      ? {
        barrierCompletionDependencies: options.barrierCompletionDependencies,
      }
      : {}),
    ...(options.barrierResolutionState != null
      ? { barrierResolutionState: options.barrierResolutionState }
      : {}),
    prepare: () => Promise.resolve(undefined),
  };
}

function createRuntimeSourceNode(options: {
  readonly path: readonly PropertyKey[];
  readonly sourceId: symbol;
  readonly dependencyIds?: readonly symbol[];
  readonly completionDependencyIds?: readonly symbol[];
  readonly metavar: string;
}): RuntimeNode {
  const source: NonNullable<ParserDependencyMetadata["source"]> = {
    kind: "source",
    sourceId: options.sourceId,
    metavar: options.metavar,
    extractSourceValue: () => undefined,
    preservesSourceValue: true,
  };
  const derived: ParserDependencyMetadata["derived"] =
    options.dependencyIds == null ? undefined : {
      kind: "derived",
      dependencyIds: options.dependencyIds,
      metavar: options.metavar,
      replayParse: (rawInput) => ({ success: true, value: rawInput }),
    };
  const completion: ParserDependencyMetadata["completion"] =
    options.completionDependencyIds == null ? undefined : {
      dependencyIds: options.completionDependencyIds,
    };
  return {
    path: options.path,
    parser: {
      dependencyMetadata: {
        source,
        ...(derived != null ? { derived } : {}),
        ...(completion != null ? { completion } : {}),
      },
    },
    state: undefined,
  };
}
