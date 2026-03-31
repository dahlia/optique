/**
 * Unit tests for DependencyRuntimeContext and shared runtime helpers.
 *
 * Part of https://github.com/dahlia/optique/issues/752
 * Extended for https://github.com/dahlia/optique/issues/753
 */
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import {
  buildRuntimeNodesFromArray,
  buildRuntimeNodesFromPairs,
  collectExplicitSourceValues,
  collectExplicitSourceValuesAsync,
  collectSourcesFromState,
  createDependencyFingerprint,
  createDependencyRuntimeContext,
  createReplayKey,
  extractRawInputFromState,
  fillMissingSourceDefaults,
  fillMissingSourceDefaultsAsync,
  replayDerivedParser,
  replayDerivedParserAsync,
  type RuntimeNode,
} from "./dependency-runtime.ts";
import type { ParserDependencyMetadata } from "./dependency-metadata.ts";
import {
  createDeferredParseState,
  createDependencySourceState,
  createPendingDependencySourceState,
  DependencyRegistry,
  isDependencySourceState,
  parseWithDependency,
} from "./dependency.ts";
import type { ValueParserResult } from "./valueparser.ts";

// =============================================================================
// DependencyRuntimeContext
// =============================================================================

describe("DependencyRuntimeContext", () => {
  test("registerSource and getSource roundtrip", () => {
    const runtime = createDependencyRuntimeContext();
    const id = Symbol("env");
    runtime.registerSource(id, "prod", "cli");
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

  test("registerSource with different origins", () => {
    const runtime = createDependencyRuntimeContext();
    const id1 = Symbol("a");
    const id2 = Symbol("b");
    const id3 = Symbol("c");
    runtime.registerSource(id1, "v1", "cli");
    runtime.registerSource(id2, "v2", "default");
    runtime.registerSource(id3, "v3", "config");
    assert.equal(runtime.getSource(id1), "v1");
    assert.equal(runtime.getSource(id2), "v2");
    assert.equal(runtime.getSource(id3), "v3");
  });

  test("resolveDependencies: all present -> resolved", () => {
    const runtime = createDependencyRuntimeContext();
    const id1 = Symbol("env");
    const id2 = Symbol("region");
    runtime.registerSource(id1, "prod", "cli");
    runtime.registerSource(id2, "us-east", "cli");
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
    runtime.registerSource(id1, "prod", "cli");
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
    runtime.registerSource(id1, "prod", "cli");
    // id2 missing, no defaults provided for it
    const result = runtime.resolveDependencies({
      dependencyIds: [id1, id2],
    });
    assert.equal(result.kind, "partial");
    assert.deepStrictEqual(result.values, ["prod", undefined]);
  });

  test("getReplayResult / setReplayResult caching", () => {
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
    runtime.registerSource(id, "prod", "cli");
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
});

// =============================================================================
// createDependencyFingerprint / createReplayKey
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

    assert.throws(
      () => collectExplicitSourceValues(nodes, runtime),
      /collectExplicitSourceValues\(\).*extractSourceValue.*Symbol\(env\)/,
    );

    const pending = collectExplicitSourceValuesAsync(nodes, runtime);
    assert.ok(!runtime.hasSource(sourceId));
    resolveExtract(bareExtract(sourceState));
    await pending;
    assert.ok(runtime.hasSource(sourceId));
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

    assert.throws(
      () => collectExplicitSourceValues(nodes, runtime),
      /collectExplicitSourceValues\(\).*extractSourceValue.*Symbol\(env\)/,
    );

    await collectExplicitSourceValuesAsync(nodes, runtime);
    assert.ok(runtime.hasSource(sourceId));
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
    // Nothing registered — no error
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

describe("collectExplicitSourceValues — failed sources", () => {
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
    // Source failed — should NOT be registered as a value.
    assert.ok(!runtime.hasSource(sourceId));
    // But should be marked as failed.
    assert.ok(runtime.isSourceFailed(sourceId));

    // Derived parser with defaults should NOT resolve against defaults
    // when the source explicitly failed.
    const resolution = runtime.resolveDependencies({
      dependencyIds: [sourceId],
      defaultValues: ["dev"],
    });
    // Failed source blocks default fallback — resolution stays unresolved.
    assert.notEqual(resolution.kind, "resolved");
  });
});

describe("collectSourcesFromState", () => {
  test("only applies excluded fields at the current object depth", () => {
    const runtime = createDependencyRuntimeContext();
    const topSourceId = Symbol("top");
    const nestedSourceId = Symbol("nested");
    const state = {
      shared: createDependencySourceState(
        { success: true as const, value: "top" },
        topSourceId,
      ),
      nested: {
        shared: createDependencySourceState(
          { success: true as const, value: "nested" },
          nestedSourceId,
        ),
      },
    };

    collectSourcesFromState(
      state,
      runtime,
      new WeakSet<object>(),
      new Set<PropertyKey>(["shared"]),
    );

    assert.ok(!runtime.hasSource(topSourceId));
    assert.equal(runtime.getSource(nestedSourceId), "nested");
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
    runtime.registerSource(sourceId, "prod", "cli");
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
    // The source had explicit input that failed — default must not be applied.
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
    // map() breaks source identity — default must not be registered.
    assert.ok(!runtime.hasSource(sourceId));
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
    // Should not throw — returns the failure so the caller can propagate it.
    const failures = fillMissingSourceDefaults(nodes, runtime);
    assert.ok(!runtime.hasSource(sourceId));
    assert.equal(failures.length, 1);
    assert.equal(failures[0].sourceId, sourceId);
    assert.ok(!failures[0].error.success);
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
});

describe("replayDerivedParser", () => {
  test("replays sync derived parser", () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    runtime.registerSource(sourceId, "prod", "cli");
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
    // Source is missing — resolution should use defaults.
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
});

describe("replayDerivedParserAsync", () => {
  test("replays async derived parser", async () => {
    const runtime = createDependencyRuntimeContext();
    const sourceId = Symbol("env");
    runtime.registerSource(sourceId, "prod", "cli");
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
});
