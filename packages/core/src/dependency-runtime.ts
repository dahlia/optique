/**
 * Dependency runtime context and shared resolution helpers.
 *
 * The dependency runtime centralizes dependency resolution state that was
 * previously spread across parser states and wrapper markers.  Constructs
 * and the top-level entry points will eventually use this runtime instead
 * of the old `resolveDeferredParseStates` / `collectDependencies` pipeline.
 *
 * @internal
 * @since 1.0.0
 * @module
 */
import {
  type DeferredParseState,
  dependencyId as dependencyIdSymbol,
  isDeferredParseState,
  isDependencySourceState,
  isPendingDependencySourceState,
  parseWithDependency,
} from "./dependency.ts";
import { message } from "./message.ts";
import type { DependencyRegistryLike } from "./registry-types.ts";
import type { ValueParserResult } from "./valueparser.ts";
import type { ParserDependencyMetadata } from "./dependency-metadata.ts";

// =============================================================================
// Symbol serialization
// =============================================================================

// Per-instance counter so that distinct symbols with the same description
// serialize to different strings.  Registered symbols are handled by
// Symbol.keyFor() and never enter this map, so WeakMap is safe here
// and avoids retaining local symbols across parse sessions.
const symbolIds = new WeakMap<symbol, string>();
let symbolCounter = 0;

function stableSymbolKey(sym: symbol): string {
  // Registered symbols have a globally unique key via Symbol.keyFor().
  const registeredKey = Symbol.keyFor(sym);
  if (registeredKey !== undefined) return `reg:${registeredKey}`;
  // Non-registered symbols get a per-instance counter-based id.
  let id = symbolIds.get(sym);
  if (id === undefined) {
    id = `sym:${symbolCounter++}`;
    symbolIds.set(sym, id);
  }
  return id;
}

// =============================================================================
// Types
// =============================================================================

/**
 * The origin of a dependency source value.
 *
 * @internal
 * @since 1.0.0
 */
export type DependencyValueOrigin =
  | "cli"
  | "default"
  | "config"
  | "env"
  | "prompt"
  | "derived-precomplete";

/**
 * A request to resolve one or more dependency values.
 *
 * @internal
 * @since 1.0.0
 */
export interface DependencyRequest {
  /** The dependency source IDs to resolve. */
  readonly dependencyIds: readonly symbol[];

  /** Optional default values (one per ID) for missing sources. */
  readonly defaultValues?: readonly unknown[];
}

/**
 * The result of a dependency resolution request.
 *
 * @internal
 * @since 1.0.0
 */
export interface DependencyResolution {
  /**
   * - `"resolved"`: all dependency values are available.
   * - `"partial"`: some are available, some are missing.
   * - `"missing"`: none are available.
   */
  readonly kind: "resolved" | "partial" | "missing";

  /** The resolved values (one per requested ID, `undefined` for missing). */
  readonly values: readonly unknown[];

  /** For each position, whether the value came from a default. */
  readonly usedDefaults: readonly boolean[];
}

/**
 * A failure that occurred while evaluating a missing-source default.
 * Returned by `fillMissingSourceDefaults()` so the caller can propagate
 * the error instead of silently treating the source as absent.
 *
 * @internal
 * @since 1.0.0
 */
export interface SourceDefaultFailure {
  /** The source that failed. */
  readonly sourceId: symbol;

  /** The path of the node. */
  readonly path: readonly PropertyKey[];

  /** The failed result or error message. */
  readonly error: ValueParserResult<unknown>;
}

/**
 * A key for caching replayed parse results.
 *
 * @internal
 * @since 1.0.0
 */
export interface ReplayKey {
  /** Path from root to the parser node. */
  readonly path: readonly PropertyKey[];

  /** The raw input string that was parsed. */
  readonly rawInput: string;

  /** A stable fingerprint of the dependency values used. */
  readonly dependencyFingerprint: string;

  /**
   * A per-parser identity string that disambiguates different derived
   * parsers sharing the same path (e.g., alternative branches).
   * @since 1.0.0
   */
  readonly parserFingerprint: string;
}

/**
 * A runtime node representing a child parser's position, metadata, and state.
 * Used as input to the shared runtime helpers.
 *
 * @internal
 * @since 1.0.0
 */
export interface RuntimeNode {
  /** Path from root to this parser node. */
  readonly path: readonly PropertyKey[];

  /** The parser (only the metadata field is inspected). */
  readonly parser: {
    readonly dependencyMetadata?: ParserDependencyMetadata;
  };

  /** The parser's current state. */
  readonly state: unknown;

  /**
   * Whether the parser consumed explicit input during parsing.
   * When `true`, the parser's state reflects user-provided input (which
   * may have failed validation).  Missing-source defaults must not override
   * explicit parse failures.
   * @since 1.0.0
   */
  readonly matched?: boolean;

  /**
   * Snapshotted default dependency values for derived parsers.
   * Constructs should populate this at node creation time (once) to
   * avoid re-evaluating dynamic `getDefaultDependencyValues()` thunks
   * at replay time.
   * @since 1.0.0
   */
  readonly defaultDependencyValues?: readonly unknown[];
}

/**
 * Dependency runtime context for centralized dependency resolution.
 *
 * @internal
 * @since 1.0.0
 */
export interface DependencyRuntimeContext {
  /** The underlying registry (for bridge interop). */
  readonly registry: DependencyRegistryLike;

  /** Register a source value with its origin. */
  registerSource(
    sourceId: symbol,
    value: unknown,
    origin: DependencyValueOrigin,
  ): void;

  /** Check if a source has been registered. */
  hasSource(sourceId: symbol): boolean;

  /** Get a registered source value. */
  getSource(sourceId: symbol): unknown;

  /** Resolve dependency values for a request. */
  resolveDependencies(request: DependencyRequest): DependencyResolution;

  /** Get a cached replay result. */
  getReplayResult(key: ReplayKey): ValueParserResult<unknown> | undefined;

  /** Cache a replay result. */
  setReplayResult(
    key: ReplayKey,
    result: ValueParserResult<unknown>,
  ): void;

  /**
   * Mark a source as explicitly failed (user provided input that did
   * not pass validation).  Derived parsers should not fall back to
   * defaults for failed sources.
   */
  markSourceFailed(sourceId: symbol): void;

  /**
   * Check if a source was explicitly attempted but failed validation.
   */
  isSourceFailed(sourceId: symbol): boolean;

  /** Resolve dependencies for suggestions (same semantics as resolve). */
  getSuggestionDependencies(request: DependencyRequest): DependencyResolution;
}

// =============================================================================
// Implementation
// =============================================================================

class DependencyRuntimeContextImpl implements DependencyRuntimeContext {
  readonly registry: DependencyRegistryLike;
  readonly #replayCache = new Map<string, ValueParserResult<unknown>>();
  readonly #failedSources = new Set<symbol>();

  constructor(registry: DependencyRegistryLike) {
    this.registry = registry;
  }

  registerSource(
    sourceId: symbol,
    value: unknown,
    _origin: DependencyValueOrigin,
  ): void {
    this.registry.set(sourceId, value);
  }

  hasSource(sourceId: symbol): boolean {
    return this.registry.has(sourceId);
  }

  getSource(sourceId: symbol): unknown {
    return this.registry.get(sourceId);
  }

  resolveDependencies(request: DependencyRequest): DependencyResolution {
    return resolveRequest(this, request);
  }

  getReplayResult(key: ReplayKey): ValueParserResult<unknown> | undefined {
    return this.#replayCache.get(serializeReplayKey(key));
  }

  setReplayResult(
    key: ReplayKey,
    result: ValueParserResult<unknown>,
  ): void {
    this.#replayCache.set(serializeReplayKey(key), result);
  }

  markSourceFailed(sourceId: symbol): void {
    this.#failedSources.add(sourceId);
  }

  isSourceFailed(sourceId: symbol): boolean {
    return this.#failedSources.has(sourceId);
  }

  getSuggestionDependencies(request: DependencyRequest): DependencyResolution {
    return resolveRequest(this, request);
  }
}

function resolveRequest(
  ctx: DependencyRuntimeContext,
  request: DependencyRequest,
): DependencyResolution {
  const values: unknown[] = [];
  const usedDefaults: boolean[] = [];
  let resolvedCount = 0;
  let defaultedCount = 0;

  for (let i = 0; i < request.dependencyIds.length; i++) {
    const id = request.dependencyIds[i];
    if (ctx.hasSource(id)) {
      values.push(ctx.getSource(id));
      usedDefaults.push(false);
      resolvedCount++;
    } else if (ctx.isSourceFailed(id)) {
      // Source was explicitly provided but failed validation.
      // Do not fall back to defaults — treat as unresolvable.
      values.push(undefined);
      usedDefaults.push(false);
    } else if (
      request.defaultValues != null && i < request.defaultValues.length
    ) {
      values.push(request.defaultValues[i]);
      usedDefaults.push(true);
      defaultedCount++;
    } else {
      values.push(undefined);
      usedDefaults.push(false);
    }
  }

  const total = request.dependencyIds.length;
  const foundOrDefaulted = resolvedCount + defaultedCount;

  let kind: DependencyResolution["kind"];
  if (foundOrDefaulted === total) {
    kind = "resolved";
  } else if (resolvedCount === 0 && defaultedCount === 0) {
    kind = "missing";
  } else {
    kind = "partial";
  }

  return { kind, values, usedDefaults };
}

/** Length-prefix a segment so that no delimiter escaping is needed. */
function lengthPrefix(s: string): string {
  return `${s.length}:${s}`;
}

function serializePathSegment(p: PropertyKey): string {
  if (typeof p === "string") return lengthPrefix(`s${p}`);
  if (typeof p === "number") return lengthPrefix(`n${p}`);
  // Prefix with "y" so that a symbol like sym:0 does not collide
  // with a string like "ym:0" (which would also become "sym:0").
  return lengthPrefix(`y${stableSymbolKey(p as symbol)}`);
}

function serializeReplayKey(key: ReplayKey): string {
  const pathStr = key.path.map(serializePathSegment).join("");
  return `${pathStr}\x01${
    lengthPrefix(key.rawInput)
  }\x01${key.dependencyFingerprint}\x01${key.parserFingerprint}`;
}

// =============================================================================
// Factory
// =============================================================================

/** Minimal registry implementation for standalone use. */
class SimpleRegistry implements DependencyRegistryLike {
  readonly #map = new Map<symbol, unknown>();
  set<T>(id: symbol, value: T): void {
    this.#map.set(id, value);
  }
  get<T>(id: symbol): T | undefined {
    return this.#map.get(id) as T | undefined;
  }
  has(id: symbol): boolean {
    return this.#map.has(id);
  }
  clone(): DependencyRegistryLike {
    const copy = new SimpleRegistry();
    for (const [k, v] of this.#map) copy.set(k, v);
    return copy;
  }
}

/**
 * Creates a new {@link DependencyRuntimeContext}.
 *
 * @param registry Optional existing registry to wrap for bridge interop.
 * @returns A new runtime context.
 * @internal
 * @since 1.0.0
 */
export function createDependencyRuntimeContext(
  registry?: DependencyRegistryLike,
): DependencyRuntimeContext {
  return new DependencyRuntimeContextImpl(registry ?? new SimpleRegistry());
}

// =============================================================================
// Fingerprinting
// =============================================================================

/**
 * Creates a stable fingerprint from dependency values.
 *
 * @param values The dependency values to fingerprint.
 * @returns A string fingerprint.
 * @internal
 * @since 1.0.0
 */
export function createDependencyFingerprint(
  values: readonly unknown[],
): string {
  // Length-prefix each component so that values containing the join
  // character cannot collide with multi-value boundaries.
  return values.map((v) => {
    const raw = fingerprintValue(v);
    return `${raw.length}:${raw}`;
  }).join("");
}

// Per-reference identity counter for fingerprinting non-primitive values.
// Using reference identity avoids lossy JSON.stringify (which maps Map,
// Set, class instances, etc. to '{}') and also handles functions (which
// String() collapses for identical source text).  Same reference → same
// fingerprint; different reference → different fingerprint (conservative
// but never stale).
// deno-lint-ignore ban-types
const objectIds = new WeakMap<object | Function, number>();
let objectIdCounter = 0;

function fingerprintValue(v: unknown): string {
  if (v === undefined) return "u:";
  if (v === null) return "n:";
  if (typeof v === "string") return `s:${v}`;
  if (typeof v === "number") {
    // Object.is distinguishes 0 from -0; String() does not.
    if (Object.is(v, -0)) return "d:-0";
    return `d:${v}`;
  }
  if (typeof v === "boolean") return `b:${v}`;
  if (typeof v === "symbol") return `y:${stableSymbolKey(v)}`;
  if (typeof v === "object" || typeof v === "function") {
    let id = objectIds.get(v as object);
    if (id === undefined) {
      id = objectIdCounter++;
      objectIds.set(v as object, id);
    }
    return `o:${id}`;
  }
  return `?:${String(v)}`;
}

/**
 * Creates a {@link ReplayKey} from a path, raw input, and dependency values.
 *
 * @param path The parser path.
 * @param rawInput The raw input string.
 * @param dependencyValues The dependency values.
 * @returns A replay key.
 * @internal
 * @since 1.0.0
 */
// deno-lint-ignore ban-types
const parserIds = new WeakMap<Function, number>();
let parserIdCounter = 0;

/** Get a stable identity string for a replayParse function reference. */
// deno-lint-ignore ban-types
function getParserFingerprint(replayParse: Function): string {
  let id = parserIds.get(replayParse);
  if (id === undefined) {
    id = parserIdCounter++;
    parserIds.set(replayParse, id);
  }
  return `p:${id}`;
}

export function createReplayKey(
  path: readonly PropertyKey[],
  rawInput: string,
  dependencyValues: readonly unknown[],
  // deno-lint-ignore ban-types
  replayParse?: Function,
): ReplayKey {
  return {
    path,
    rawInput,
    dependencyFingerprint: createDependencyFingerprint(dependencyValues),
    parserFingerprint: replayParse != null
      ? getParserFingerprint(replayParse)
      : "",
  };
}

// =============================================================================
// Shared runtime helpers
// =============================================================================

/**
 * Collects explicit source values from parser states and registers them
 * in the runtime context.
 *
 * @param nodes The runtime nodes to inspect.
 * @param runtime The dependency runtime context.
 * @internal
 * @since 1.0.0
 */
export function collectExplicitSourceValues(
  nodes: readonly RuntimeNode[],
  runtime: DependencyRuntimeContext,
): void {
  for (const node of nodes) {
    const meta = node.parser.dependencyMetadata;
    if (meta?.source == null) continue;
    if (meta.source.extractSourceValue == null) continue;

    const result = meta.source.extractSourceValue(node.state);
    // undefined = state doesn't contain a source result (unpopulated).
    // { success: false } = source was provided but failed validation.
    // { success: true, value } = source value (value may be undefined).
    if (result == null) continue;
    if (result.success) {
      runtime.registerSource(meta.source.sourceId, result.value, "cli");
    } else {
      // Mark the source as explicitly failed so that derived parsers
      // do not fall back to defaults for this source.
      runtime.markSourceFailed(meta.source.sourceId);
    }
  }
}

/**
 * Fills missing source defaults for source parsers whose state is
 * unpopulated.
 *
 * Returns an array of failures for sources whose default evaluation
 * failed (either threw or returned `{ success: false }`).  The caller
 * should propagate these so that dependent parsers see the real error
 * instead of silently treating the source as absent.
 *
 * @param nodes The runtime nodes to inspect.
 * @param runtime The dependency runtime context.
 * @returns Failures from default evaluation (empty if all succeeded).
 * @internal
 * @since 1.0.0
 */
export function fillMissingSourceDefaults(
  nodes: readonly RuntimeNode[],
  runtime: DependencyRuntimeContext,
): readonly SourceDefaultFailure[] {
  const failures: SourceDefaultFailure[] = [];
  for (const node of nodes) {
    const meta = node.parser.dependencyMetadata;
    if (meta?.source == null) continue;
    if (runtime.hasSource(meta.source.sourceId)) continue;
    // Do not override explicit parse failures with defaults.
    if (runtime.isSourceFailed(meta.source.sourceId)) continue;
    // Also skip if the node's matched flag is set (belt-and-suspenders
    // for cases where the caller didn't run collectExplicitSourceValues).
    if (node.matched === true) continue;
    // A map() transform breaks source identity — the default value
    // would be the pre-transform value, not what the parser produces.
    if (!meta.source.preservesSourceValue) continue;
    if (meta.source.getMissingSourceValue == null) continue;

    let result:
      | ValueParserResult<unknown>
      | Promise<ValueParserResult<unknown>>;
    try {
      result = meta.source.getMissingSourceValue();
    } catch (e) {
      // Default thunk threw — report as failure matching
      // withDefault.complete() contract.
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({
        sourceId: meta.source.sourceId,
        path: node.path,
        error: {
          success: false,
          error: message`Default value evaluation failed: ${msg}`,
        },
      });
      continue;
    }
    // Only handle sync results here; async handled by async variant
    if (result instanceof Promise) continue;
    if (result.success) {
      runtime.registerSource(
        meta.source.sourceId,
        result.value,
        "default",
      );
    } else {
      // Default thunk returned a failure — propagate it.
      failures.push({
        sourceId: meta.source.sourceId,
        path: node.path,
        error: result,
      });
    }
  }
  return failures;
}

/**
 * Async version of {@link fillMissingSourceDefaults}.
 * Awaits async `getMissingSourceValue` results.
 *
 * @param nodes The runtime nodes to inspect.
 * @param runtime The dependency runtime context.
 * @returns Failures from default evaluation (empty if all succeeded).
 * @internal
 * @since 1.0.0
 */
export async function fillMissingSourceDefaultsAsync(
  nodes: readonly RuntimeNode[],
  runtime: DependencyRuntimeContext,
): Promise<readonly SourceDefaultFailure[]> {
  const failures: SourceDefaultFailure[] = [];
  for (const node of nodes) {
    const meta = node.parser.dependencyMetadata;
    if (meta?.source == null) continue;
    if (runtime.hasSource(meta.source.sourceId)) continue;
    if (runtime.isSourceFailed(meta.source.sourceId)) continue;
    if (node.matched === true) continue;
    if (!meta.source.preservesSourceValue) continue;
    if (meta.source.getMissingSourceValue == null) continue;

    let result: ValueParserResult<unknown>;
    try {
      result = await meta.source.getMissingSourceValue();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({
        sourceId: meta.source.sourceId,
        path: node.path,
        error: {
          success: false,
          error: message`Default value evaluation failed: ${msg}`,
        },
      });
      continue;
    }
    if (result.success) {
      runtime.registerSource(
        meta.source.sourceId,
        result.value,
        "default",
      );
    } else {
      failures.push({
        sourceId: meta.source.sourceId,
        path: node.path,
        error: result,
      });
    }
  }
  return failures;
}

/**
 * Replays a derived parser with resolved dependency values (sync).
 *
 * Returns `undefined` if dependencies cannot be resolved.
 *
 * @param node The runtime node with derived metadata.
 * @param rawInput The raw input to replay.
 * @param runtime The dependency runtime context.
 * @returns The replay result, or `undefined`.
 * @internal
 * @since 1.0.0
 */
export function replayDerivedParser(
  node: RuntimeNode,
  rawInput: string,
  runtime: DependencyRuntimeContext,
): ValueParserResult<unknown> | undefined {
  const meta = node.parser.dependencyMetadata;
  if (meta?.derived == null) return undefined;

  // Use snapshotted defaults from the node (captured at parse time) to
  // avoid re-evaluating dynamic getDefaultDependencyValues() thunks.
  // Guard the fallback call since validating default thunks may throw.
  let defaults = node.defaultDependencyValues;
  if (defaults == null && meta.derived.getDefaultDependencyValues != null) {
    try {
      defaults = meta.derived.getDefaultDependencyValues();
    } catch {
      // Default thunk threw — treat as unresolved.
      return undefined;
    }
  }

  const resolution = runtime.resolveDependencies({
    dependencyIds: meta.derived.dependencyIds,
    defaultValues: defaults,
  });

  if (resolution.kind === "missing") return undefined;
  if (resolution.kind === "partial") return undefined;

  // Check replay cache
  const key = createReplayKey(
    node.path,
    rawInput,
    resolution.values,
    meta.derived.replayParse,
  );
  const cached = runtime.getReplayResult(key);
  if (cached != null) return cached;

  const result = meta.derived.replayParse(rawInput, resolution.values);
  // Handle sync result only
  if (result instanceof Promise) return undefined;

  runtime.setReplayResult(key, result);
  return result;
}

/**
 * Replays a derived parser with resolved dependency values (async).
 *
 * Returns `undefined` if dependencies cannot be resolved.
 *
 * @param node The runtime node with derived metadata.
 * @param rawInput The raw input to replay.
 * @param runtime The dependency runtime context.
 * @returns The replay result, or `undefined`.
 * @internal
 * @since 1.0.0
 */
export async function replayDerivedParserAsync(
  node: RuntimeNode,
  rawInput: string,
  runtime: DependencyRuntimeContext,
): Promise<ValueParserResult<unknown> | undefined> {
  const meta = node.parser.dependencyMetadata;
  if (meta?.derived == null) return undefined;

  // Use snapshotted defaults from the node (captured at parse time) to
  // avoid re-evaluating dynamic getDefaultDependencyValues() thunks.
  // Guard the fallback call since validating default thunks may throw.
  let defaults = node.defaultDependencyValues;
  if (defaults == null && meta.derived.getDefaultDependencyValues != null) {
    try {
      defaults = meta.derived.getDefaultDependencyValues();
    } catch {
      return undefined;
    }
  }

  const resolution = runtime.resolveDependencies({
    dependencyIds: meta.derived.dependencyIds,
    defaultValues: defaults,
  });

  if (resolution.kind === "missing") return undefined;
  if (resolution.kind === "partial") return undefined;

  // Check replay cache
  const key = createReplayKey(
    node.path,
    rawInput,
    resolution.values,
    meta.derived.replayParse,
  );
  const cached = runtime.getReplayResult(key);
  if (cached != null) return cached;

  const result = await meta.derived.replayParse(rawInput, resolution.values);

  runtime.setReplayResult(key, result);
  return result;
}

// =============================================================================
// Bridge helpers for construct migration
// =============================================================================

/**
 * Extracts `rawInput` from a parser state that may contain a
 * {@link DeferredParseState}.  During the transition period, primitives
 * still produce `DeferredParseState` with `rawInput`.
 *
 * Handles direct `DeferredParseState` and array-wrapped
 * `[DeferredParseState]` (from optional/withDefault wrappers).
 *
 * @param state The parser state to inspect.
 * @returns The raw input string, or `undefined` if the state does not
 *   contain a `DeferredParseState`.
 * @internal
 * @since 1.0.0
 */
export function extractRawInputFromState(state: unknown): string | undefined {
  if (state == null) return undefined;
  if (typeof state !== "object") return undefined;

  // Direct DeferredParseState
  if (isDeferredParseState(state)) return state.rawInput;

  // Array-wrapped: [DeferredParseState] from optional/withDefault
  if (
    Array.isArray(state) &&
    state.length === 1 &&
    isDeferredParseState(state[0])
  ) {
    return state[0].rawInput;
  }

  return undefined;
}

// =============================================================================
// Recursive state resolution with the dependency runtime
// =============================================================================

/**
 * Checks if a value is a plain object (not a class instance) for the
 * purpose of recursive state traversal.
 */
function isPlainObject(
  value: unknown,
): value is Record<string | symbol, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Resolves a single {@link DeferredParseState} using the dependency runtime.
 *
 * Returns the replay result if all dependencies are available, or the
 * preliminary result if dependencies are missing.
 */
function resolveSingleDeferred(
  deferred: DeferredParseState<unknown>,
  runtime: DependencyRuntimeContext,
): ValueParserResult<unknown> {
  // deriveFrom() sets dependencyIds (always an array).
  // derive() only sets dependencyId (single value).
  const isMultiDep = deferred.dependencyIds != null &&
    deferred.dependencyIds.length > 0;
  const depIds = isMultiDep ? deferred.dependencyIds! : [deferred.dependencyId];
  const resolution = runtime.resolveDependencies({
    dependencyIds: depIds,
    defaultValues: deferred.defaultValues,
  });
  if (resolution.kind !== "resolved") return deferred.preliminaryResult;

  // If every dependency value came from defaults, the replay would use
  // the same values that produced preliminaryResult during parse().
  // Skip the replay to avoid double-evaluating non-idempotent factories.
  if (resolution.usedDefaults.every((d) => d)) {
    return deferred.preliminaryResult;
  }

  // deriveFrom always passes values as an array; derive passes a single value.
  const depValue = isMultiDep ? resolution.values : resolution.values[0];
  const result = deferred.parser[parseWithDependency](
    deferred.rawInput,
    depValue,
  );
  if (result instanceof Promise) return deferred.preliminaryResult;
  return result;
}

/**
 * Recursively collects dependency source values from {@link DependencySourceState}
 * objects found in the state tree and registers them in the runtime.
 *
 * This must run BEFORE deferred resolution so that all source values
 * are available when replaying derived parsers.
 */
export function collectSourcesFromState(
  state: unknown,
  runtime: DependencyRuntimeContext,
  visited: WeakSet<object> = new WeakSet<object>(),
): void {
  if (state == null || typeof state !== "object") return;
  if (visited.has(state)) return;
  visited.add(state);

  if (isDependencySourceState(state)) {
    const depId = state[dependencyIdSymbol];
    const result = state.result;
    if (depId != null && result.success) {
      // Always overwrite so that later values win (e.g., multiple()
      // where the last tag value should be used as the dependency).
      runtime.registerSource(depId, result.value, "cli");
    } else if (depId != null) {
      // Mark the source as explicitly failed so that derived parsers
      // do not fall back to defaults for this source.
      runtime.markSourceFailed(depId);
    }
    return;
  }

  // Skip DeferredParseState internals (they contain parser references, not sources)
  if (isDeferredParseState(state)) return;

  if (Array.isArray(state)) {
    for (const item of state) {
      collectSourcesFromState(item, runtime, visited);
    }
    return;
  }

  // Recurse into any object (including class instances with nested
  // DependencySourceState).  The old collectDependencies() traversed
  // all non-DeferredParseState objects; isPlainObject would miss
  // custom parser states that are class instances.
  if (typeof state === "object") {
    for (const key of Reflect.ownKeys(state as object)) {
      collectSourcesFromState(
        (state as Record<string | symbol, unknown>)[key],
        runtime,
        visited,
      );
    }
  }
}

/**
 * Recursively resolves all {@link DeferredParseState} objects in a state
 * tree using the dependency runtime (sync).
 *
 * Performs a two-pass traversal:
 *  1. Collect all {@link DependencySourceState} values into the runtime.
 *  2. Resolve all {@link DeferredParseState} using the populated runtime.
 *
 * This replaces the old `resolveDeferredParseStates` with runtime-based
 * resolution.  Only traverses plain objects and arrays; class instances
 * and primitives are returned as-is.
 *
 * @param state The state tree to resolve.
 * @param runtime The dependency runtime context.
 * @returns The resolved state tree.
 * @internal
 * @since 1.0.0
 */
export function resolveStateWithRuntime(
  state: unknown,
  runtime: DependencyRuntimeContext,
): unknown {
  // Pass 1: Collect all DependencySourceState values into the runtime.
  collectSourcesFromState(state, runtime);
  // Pass 2: Resolve all DeferredParseState using the populated runtime.
  return resolveDeferredInState(state, runtime);
}

/** Pass 2 helper: recursively replace DeferredParseState with resolved values. */
function resolveDeferredInState(
  state: unknown,
  runtime: DependencyRuntimeContext,
  visited: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (state == null) return state;

  if (typeof state === "object") {
    if (visited.has(state)) return state;
    visited.add(state);
  }

  if (isDeferredParseState(state)) {
    return resolveSingleDeferred(state, runtime);
  }

  if (isDependencySourceState(state)) return state;

  if (Array.isArray(state)) {
    return state.map((item) => resolveDeferredInState(item, runtime, visited));
  }

  if (isPlainObject(state)) {
    const resolved = Object.create(
      Object.getPrototypeOf(state),
    ) as Record<string | symbol, unknown>;
    for (const key of Reflect.ownKeys(state)) {
      resolved[key] = resolveDeferredInState(state[key], runtime, visited);
    }
    return resolved;
  }

  return state;
}

/**
 * Async version of {@link resolveStateWithRuntime}.
 *
 * @param state The state tree to resolve.
 * @param runtime The dependency runtime context.
 * @returns The resolved state tree.
 * @internal
 * @since 1.0.0
 */
export function resolveStateWithRuntimeAsync(
  state: unknown,
  runtime: DependencyRuntimeContext,
): Promise<unknown> {
  // Pass 1: Collect all DependencySourceState values into the runtime.
  collectSourcesFromState(state, runtime);
  // Pass 2: Resolve all DeferredParseState using the populated runtime.
  return resolveDeferredInStateAsync(state, runtime);
}

/** Async pass 2 helper. */
async function resolveDeferredInStateAsync(
  state: unknown,
  runtime: DependencyRuntimeContext,
  visited: WeakSet<object> = new WeakSet<object>(),
): Promise<unknown> {
  if (state == null) return state;

  if (typeof state === "object") {
    if (visited.has(state)) return state;
    visited.add(state);
  }

  if (isDeferredParseState(state)) {
    const deferred = state;
    const isMultiDep = deferred.dependencyIds != null &&
      deferred.dependencyIds.length > 0;
    const depIds = isMultiDep
      ? deferred.dependencyIds!
      : [deferred.dependencyId];
    const resolution = runtime.resolveDependencies({
      dependencyIds: depIds,
      defaultValues: deferred.defaultValues,
    });
    if (resolution.kind !== "resolved") return deferred.preliminaryResult;

    // If every dependency value came from defaults, skip the replay.
    if (resolution.usedDefaults.every((d) => d)) {
      return deferred.preliminaryResult;
    }

    const depValue = isMultiDep ? resolution.values : resolution.values[0];
    return Promise.resolve(
      deferred.parser[parseWithDependency](deferred.rawInput, depValue),
    );
  }

  if (isDependencySourceState(state)) return state;

  if (Array.isArray(state)) {
    return Promise.all(
      state.map((item) => resolveDeferredInStateAsync(item, runtime, visited)),
    );
  }

  if (isPlainObject(state)) {
    const resolved = Object.create(
      Object.getPrototypeOf(state),
    ) as Record<string | symbol, unknown>;
    const keys = Reflect.ownKeys(state);
    await Promise.all(
      keys.map(async (key) => {
        resolved[key] = await resolveDeferredInStateAsync(
          state[key],
          runtime,
          visited,
        );
      }),
    );
    return resolved;
  }

  return state;
}

/**
 * Determines whether a parser state represents an explicit match (the user
 * provided input) rather than an initial/pending state.
 */
function isMatchedState(
  fieldState: unknown,
  parser: { readonly initialState?: unknown },
): boolean {
  if (fieldState === undefined) return false;
  // PendingDependencySourceState in an array means the option was not provided
  if (
    Array.isArray(fieldState) &&
    fieldState.length === 1 &&
    isPendingDependencySourceState(fieldState[0])
  ) {
    return false;
  }
  // Bare PendingDependencySourceState
  if (isPendingDependencySourceState(fieldState)) return false;
  // If state equals the parser's initialState, it was not matched
  if (fieldState === parser.initialState) return false;
  return true;
}

/**
 * Builds {@link RuntimeNode}s from field→parser pairs and a state record.
 *
 * Used by `object()` and `merge()` constructs.
 *
 * @param pairs Field→parser pairs.
 * @param state The state record keyed by field name.
 * @param parentPath Optional parent path prefix.
 * @returns An array of runtime nodes.
 * @internal
 * @since 1.0.0
 */
export function buildRuntimeNodesFromPairs(
  pairs: ReadonlyArray<
    readonly [
      PropertyKey,
      {
        readonly dependencyMetadata?: ParserDependencyMetadata;
        readonly initialState?: unknown;
      },
    ]
  >,
  state: Record<PropertyKey, unknown>,
  parentPath?: readonly PropertyKey[],
): readonly RuntimeNode[] {
  const prefix = parentPath ?? [];
  const nodes: RuntimeNode[] = [];
  for (const [field, parser] of pairs) {
    const fieldState = Object.hasOwn(state, field)
      ? state[field as string | symbol]
      : undefined;
    nodes.push({
      path: [...prefix, field],
      parser,
      state: fieldState,
      matched: isMatchedState(fieldState, parser),
    });
  }
  return nodes;
}

/**
 * Builds {@link RuntimeNode}s from a parser array and a state array.
 *
 * Used by `tuple()` and `concat()` constructs.
 *
 * @param parsers The child parsers.
 * @param stateArray The state array (one element per parser).
 * @param parentPath Optional parent path prefix.
 * @returns An array of runtime nodes.
 * @internal
 * @since 1.0.0
 */
export function buildRuntimeNodesFromArray(
  parsers: ReadonlyArray<
    {
      readonly dependencyMetadata?: ParserDependencyMetadata;
      readonly initialState?: unknown;
    }
  >,
  stateArray: readonly unknown[],
  parentPath?: readonly PropertyKey[],
): readonly RuntimeNode[] {
  const prefix = parentPath ?? [];
  const nodes: RuntimeNode[] = [];
  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    const elemState = i < stateArray.length ? stateArray[i] : undefined;
    nodes.push({
      path: [...prefix, i],
      parser,
      state: elemState,
      matched: isMatchedState(elemState, parser),
    });
  }
  return nodes;
}
