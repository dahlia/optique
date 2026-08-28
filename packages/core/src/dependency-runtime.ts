/**
 * Dependency runtime context and shared resolution helpers.
 *
 * The dependency runtime centralizes dependency resolution state that was
 * previously spread across parser states and wrapper markers.  Constructs
 * and the top-level entry points will eventually use this runtime instead
 * of the old `resolveDeferredParseStates`/`collectDependencies` pipeline.
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
} from "./internal/dependency.ts";
import type { InputTrace } from "./input-trace.ts";
import { type Message, message } from "./message.ts";
import {
  type ExecutionContext,
  unmatchedNonCliDependencySourceStateMarker,
} from "./internal/parser.ts";
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

  /** Register a source value. */
  registerSource(sourceId: symbol, value: unknown): void;

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
    if (registry instanceof FailedAwareRegistry) {
      this.registry = registry.rebindFailedSources(this.#failedSources);
      return;
    }
    this.registry = new FailedAwareRegistry(registry, this.#failedSources);
  }

  registerSource(sourceId: symbol, value: unknown): void {
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

/**
 * Registry wrapper that hides values for sources that have failed.
 *
 * The wrapper lets clones share an underlying registry while maintaining
 * an isolated failed-source view, so later lookups do not reuse stale
 * values after extraction errors.
 *
 * @internal
 */
class FailedAwareRegistry implements DependencyRegistryLike {
  readonly #inner: DependencyRegistryLike;
  readonly #failedSources: Set<symbol>;

  constructor(inner: DependencyRegistryLike, failedSources: Set<symbol>) {
    this.#inner = inner;
    this.#failedSources = failedSources;
  }

  set<T>(id: symbol, value: T): void {
    this.#inner.set(id, value);
    this.#failedSources.delete(id);
  }

  get<T>(id: symbol): T | undefined {
    if (this.#failedSources.has(id)) return undefined;
    return this.#inner.get(id);
  }

  has(id: symbol): boolean {
    if (this.#failedSources.has(id)) return false;
    return this.#inner.has(id);
  }

  copyFailedSources(target: Set<symbol>): void {
    for (const sourceId of this.#failedSources) {
      target.add(sourceId);
    }
  }

  rebindFailedSources(target: Set<symbol>): FailedAwareRegistry {
    this.copyFailedSources(target);
    return new FailedAwareRegistry(this.#inner, target);
  }

  clone(): DependencyRegistryLike {
    const failedSources = new Set(this.#failedSources);
    const innerClone = this.#inner.clone();
    return innerClone instanceof FailedAwareRegistry
      ? innerClone.rebindFailedSources(failedSources)
      : new FailedAwareRegistry(innerClone, failedSources);
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
    if (ctx.isSourceFailed(id)) {
      // Source was explicitly provided but failed validation.
      // Do not fall back to defaults—treat as unresolvable.
      values.push(undefined);
      usedDefaults.push(false);
    } else if (ctx.hasSource(id)) {
      values.push(ctx.getSource(id));
      usedDefaults.push(false);
      resolvedCount++;
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
 * @throws Propagates synchronous errors thrown by `extractSourceValue()`.
 * @throws {TypeError} If `extractSourceValue()` returns a promise-like result.
 *         Use {@link collectExplicitSourceValuesAsync} when async source
 *         extraction is expected.
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
    if (isPromiseLike(result)) {
      throw new TypeError(
        `collectExplicitSourceValues() received an async extractSourceValue() result for ${
          String(meta.source.sourceId)
        }. Use collectExplicitSourceValuesAsync() instead.`,
      );
    }
    registerExplicitSourceValue(meta.source.sourceId, result, runtime);
  }
}

function registerExplicitSourceValue(
  sourceId: symbol,
  result: ValueParserResult<unknown> | undefined,
  runtime: DependencyRuntimeContext,
): void {
  // undefined = state doesn't contain a source result (unpopulated).
  // { success: false } = source was provided but failed validation.
  // { success: true, value } = source value (value may be undefined).
  if (result == null) return;
  if (result.success) {
    runtime.registerSource(sourceId, result.value);
  } else {
    // Mark the source as explicitly failed so that derived parsers
    // do not fall back to defaults for this source.
    runtime.markSourceFailed(sourceId);
  }
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return value != null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (value as Record<PropertyKey, unknown>).then === "function";
}

/**
 * Async version of {@link collectExplicitSourceValues}.
 * Awaits async `extractSourceValue` results instead of rejecting
 * promise-like values as the synchronous variant does.
 *
 * @param nodes The runtime nodes to inspect.
 * @param runtime The dependency runtime context.
 * @throws Propagates errors thrown or rejected by `extractSourceValue()`.
 * @internal
 * @since 1.0.0
 */
export async function collectExplicitSourceValuesAsync(
  nodes: readonly RuntimeNode[],
  runtime: DependencyRuntimeContext,
): Promise<void> {
  for (const node of nodes) {
    const meta = node.parser.dependencyMetadata;
    if (meta?.source == null) continue;
    if (meta.source.extractSourceValue == null) continue;

    const result = await meta.source.extractSourceValue(node.state);
    registerExplicitSourceValue(meta.source.sourceId, result, runtime);
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
 * @throws {TypeError} If `getMissingSourceValue()` returns a promise-like
 *         result. Use {@link fillMissingSourceDefaultsAsync} when async
 *         default extraction is expected.
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
    // A map() transform breaks source identity—the default value
    // would be the pre-transform value, not what the parser produces.
    if (!meta.source.preservesSourceValue) continue;
    if (meta.source.getMissingSourceValue == null) continue;

    let result:
      | ValueParserResult<unknown>
      | Promise<ValueParserResult<unknown>>;
    try {
      result = meta.source.getMissingSourceValue();
    } catch (e) {
      // Default thunk threw—report as failure matching
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
    if (isPromiseLike(result)) {
      throw new TypeError(
        `fillMissingSourceDefaults() received an async getMissingSourceValue() result for ${
          String(meta.source.sourceId)
        }. Use fillMissingSourceDefaultsAsync() instead.`,
      );
    }
    if (result.success) {
      runtime.registerSource(meta.source.sourceId, result.value);
    } else {
      // Default thunk returned a failure—propagate it.
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
      runtime.registerSource(meta.source.sourceId, result.value);
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
 * @throws {TypeError} If `replayParse()` returns a promise-like result.
 *         Use {@link replayDerivedParserAsync} for async replay.
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
      // Default thunk threw—treat as unresolved.
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
  if (isPromiseLike(result)) {
    throw new TypeError(
      "replayDerivedParser() received an async replayParse() result. Use replayDerivedParserAsync() instead.",
    );
  }

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
// Effectful source completion scheduling
// =============================================================================

/**
 * Internal parser hook for constructs whose effectful scheduling nodes
 * cannot be derived from flattened field pairs alone.
 *
 * `merge()` installs it so a parent's scheduling expansion uses the same
 * child-indexed paths, declaration order, and duplicate-field exclusion
 * as the merge's own scheduling pass; `or()`/`longestMatch()` install it
 * to expose the committed branch; `command()` installs it to expose its
 * inner parser once the command has matched.  The returned node paths
 * must match the execution paths used when the same parsers complete, so
 * the run-scoped completion cache lines up.
 *
 * @internal
 * @since 1.3.0
 */
export const effectfulSchedulingNodesKey: unique symbol = Symbol(
  "@optique/core/dependency-runtime/effectfulSchedulingNodes",
);

/**
 * The shape of the {@link effectfulSchedulingNodesKey} hook.
 *
 * @internal
 * @since 1.3.0
 */
export type EffectfulSchedulingNodesFn = (
  state: unknown,
  parentPath: readonly PropertyKey[] | undefined,
) => readonly RuntimeNode[];

/**
 * Opt-in marker for parsers whose {@link effectfulSchedulingNodesKey}
 * hook also defines their explicit-source *collection* scope.
 *
 * A parent construct normally collects explicit source values from its
 * direct children only.  A parser carrying this marker (with value
 * `true`) asks the parent to expand it through its scheduling hook
 * before collecting, so command-line source values inside it—such as a
 * `conditional()` discriminator, a committed conditional branch, or a
 * selected `command()` subtree—register into the parent's dependency
 * runtime exactly like a prompt-completed value would.  Constructs
 * without the marker (plain nested `object()`, uncommitted exclusive
 * branches) keep their existing scope.
 *
 * @internal
 * @since 1.3.0
 */
export const sourceCollectionExpansionKey: unique symbol = Symbol(
  "@optique/core/dependency-runtime/sourceCollectionExpansion",
);

/**
 * Forwards effectful scheduling through a shape-preserving wrapper such
 * as `map()`, `optional()`, `withDefault()`, or `nonEmpty()`, so the
 * wrapped parser—a selected exclusive or command branch, or an ordinary
 * construct with nested effectful sources—stays visible to a parent
 * construct's scheduling expansion.
 *
 * The installed hook simply re-exposes the inner parser as a node with
 * the wrapper's own state shape unwrapped (`adaptState`, e.g. the
 * `[innerState]` array used by `optional()`/`withDefault()`); the
 * expansion then applies its ordinary rules to the inner parser, whether
 * it carries its own hook, flattened field pairs, or source metadata.
 * Wrappers are path-transparent, so the node keeps the wrapper's path.
 *
 * @internal
 * @since 1.3.0
 */
export function defineForwardedEffectfulSchedulingNodes(
  wrapper: object,
  inner: { readonly dependencyMetadata?: ParserDependencyMetadata },
  adaptState?: (state: unknown) => unknown,
): void {
  // When the inner parser is itself a dependency source, the wrapper's
  // own composed metadata governs scheduling—including the deliberate
  // absence of an effectful completion (e.g., optional() suppression or
  // a transformed source).  Re-exposing the inner parser here would
  // bypass that decision, so the hook is only installed for wrapped
  // non-source parsers such as constructs and exclusive branches.
  if (inner.dependencyMetadata?.source != null) return;
  Object.defineProperty(wrapper, effectfulSchedulingNodesKey, {
    value: ((state, parentPath) => [{
      path: parentPath ?? [],
      parser: inner,
      state: adaptState == null ? state : adaptState(state),
    }]) satisfies EffectfulSchedulingNodesFn,
    configurable: true,
    enumerable: false,
  });
  // Wrappers are transparent for source-collection expansion too: a
  // wrapped conditional()/command() keeps its collection opt-in.
  if (
    (inner as { readonly [sourceCollectionExpansionKey]?: boolean })[
      sourceCollectionExpansionKey
    ] === true
  ) {
    Object.defineProperty(wrapper, sourceCollectionExpansionKey, {
      value: true,
      configurable: true,
      enumerable: false,
    });
  }
}

/**
 * A completed effectful source result to be reused by the owning
 * construct's final completion phase, keyed by the node's last path
 * segment (its field key or tuple index).
 *
 * @internal
 * @since 1.3.0
 */
export interface EffectfulSourceCompletion {
  /** The node's field key or index (its last path segment). */
  readonly key: PropertyKey;

  /** The effectful completion result. */
  readonly result: ValueParserResult<unknown>;
}

/**
 * The result of scheduling effectful source completions.
 *
 * @internal
 * @since 1.3.0
 */
export type EffectfulSourceCompletionResult =
  | {
    readonly success: true;
    readonly completed: readonly EffectfulSourceCompletion[];
  }
  | { readonly success: false; readonly error: Message };

/**
 * Collects the dependency source IDs demanded by consumers among the
 * given nodes and state subtree.
 *
 * A consumer demands its sources when it has raw input evidence: either a
 * trace entry recorded at its path during parsing, or a legacy
 * `DeferredParseState` embedded in the state subtree.  Consumers without
 * raw input never replay against real dependency values, so their sources
 * are not demanded.
 *
 * @param nodes The direct-child runtime nodes of the owning construct.
 * @param state The construct's state subtree (for legacy deferred states).
 * @param trace The input trace recorded during parsing.
 * @returns The set of demanded dependency source IDs.
 * @internal
 * @since 1.3.0
 */
export function collectDemandedDependencyIds(
  nodes: readonly RuntimeNode[],
  state: unknown,
  trace: InputTrace | undefined,
): ReadonlySet<symbol> {
  const demanded = new Set<symbol>();
  for (const node of nodes) {
    const derived = node.parser.dependencyMetadata?.derived;
    if (derived == null) continue;
    const hasRawInput = trace?.get(node.path)?.rawInput != null ||
      extractRawInputFromState(node.state) != null;
    if (!hasRawInput) continue;
    for (const id of derived.dependencyIds) demanded.add(id);
  }
  collectDeferredDemand(state, demanded, new WeakSet<object>());
  return demanded;
}

function collectDeferredDemand(
  state: unknown,
  demanded: Set<symbol>,
  visited: WeakSet<object>,
): void {
  if (state == null || typeof state !== "object") return;
  if (visited.has(state)) return;
  visited.add(state);

  if (isDeferredParseState(state)) {
    const ids = state.dependencyIds != null && state.dependencyIds.length > 0
      ? state.dependencyIds
      : [state.dependencyId];
    for (const id of ids) demanded.add(id);
    return;
  }

  for (const key of Reflect.ownKeys(state)) {
    collectDeferredDemand(
      (state as Record<string | symbol, unknown>)[key],
      demanded,
      visited,
    );
  }
}

/**
 * Options for {@link completeEffectfulSourcesAsync}.
 *
 * @internal
 * @since 1.3.0
 */
export interface CompleteEffectfulSourcesOptions {
  /**
   * Nodes used for demand detection instead of the scheduled nodes.
   * Constructs whose parse-time trace paths differ from their scheduling
   * node paths (e.g., `merge()`, which records child-indexed paths but
   * schedules flattened field nodes) pass path-corrected nodes here.
   */
  readonly demandNodes?: readonly RuntimeNode[];

  /**
   * Whether a node's completion result may be cached by the owning
   * construct for reuse in its final completion phase.  Defaults to
   * treating every node as reusable.  Non-reusable completions (nodes
   * expanded from nested children, or sources whose field value differs
   * from the source value) rely on the run-scoped session cache to avoid
   * running twice, and are skipped when no session is available.
   */
  readonly isReusable?: (node: RuntimeNode) => boolean;

  /**
   * Whether a node participated in the owning construct's explicit
   * source collection, and therefore must have its structural value
   * re-registered at its declaration position so registration order
   * follows declaration order across structural and effectful
   * occurrences.  This is wider than {@link isReusable}: nodes expanded
   * from an opted-in child (see `sourceCollectionExpansionKey`) are
   * collected but not reusable.  Defaults to {@link isReusable}.
   */
  readonly isCollected?: (node: RuntimeNode) => boolean;
}

/**
 * Runs effectful source completions (e.g., interactive prompts) serially
 * in declaration order for source nodes whose value is not yet registered.
 *
 * This is the scheduling half of the `completeSource` capability contract:
 *
 * - Runs only during real completion (`exec.phase === "complete"`); probe
 *   and suggest phases return immediately without effects.
 * - Precedence is structural per occurrence: an effectful completion
 *   returns its own field's command-line or bound value without running
 *   the effect, and structural occurrences re-register their extracted
 *   values in declaration order.  When several scheduled occurrences
 *   share one source, the last occurrence wins—the same rule as repeated
 *   command-line source occurrences.
 * - Completion results that are `undefined` or marked `deferred` are
 *   treated as declined and neither registered nor cached.
 * - A successful result registers its value unless the value is
 *   `undefined`.  When the node is reusable (a direct child whose field
 *   value is the source value), the result is also returned for reuse by
 *   the owning construct so the node is not completed twice; otherwise the
 *   effectful parser's own run-scoped session cache prevents a second
 *   execution, so nodes that are not reusable are only scheduled when a
 *   session is present.  For a source behind a transform such as `map()`
 *   (`preservesSourceValue: false`), the `completeSource` contract still
 *   yields the pre-transform source value, so registration stays correct
 *   while the field's final value is produced separately.
 * - A failed result (e.g., a cancelled prompt) marks the source as failed
 *   and aborts immediately—later effectful completions do not run.
 *
 * When the run-scoped session policy is `"demand-only"` (the phase-two
 * seed pass), the demanded source IDs from
 * {@link collectDemandedDependencyIds} are added to the session before any
 * completion runs, letting effectful parsers defer when no phase-one
 * consumer demands their value.
 *
 * @param nodes The runtime nodes to schedule, in declaration order.
 * @param state The construct's state subtree (for demand detection).
 * @param runtime The dependency runtime context.
 * @param exec The execution context of the owning construct.
 * @param options Scheduling options.
 * @returns The scheduling result: completed nodes for reuse, or the first
 *   failure.
 * @internal
 * @since 1.3.0
 */
export async function completeEffectfulSourcesAsync(
  nodes: readonly RuntimeNode[],
  state: unknown,
  runtime: DependencyRuntimeContext,
  exec: ExecutionContext | undefined,
  options?: CompleteEffectfulSourcesOptions,
): Promise<EffectfulSourceCompletionResult> {
  const empty: EffectfulSourceCompletionResult = {
    success: true,
    completed: [],
  };
  if (exec == null || exec.phase !== "complete") return empty;

  // Demand accumulates in the session even when this construct has
  // nothing schedulable itself: a consumer here may demand a source that
  // an opaque descendant (e.g., a selected command branch) completes in
  // its own, later scheduling pass.
  const session = exec.effectfulCompletionSession;
  if (session?.policy === "demand-only") {
    const demandNodes = options?.demandNodes ?? nodes;
    const demanded = collectDemandedDependencyIds(
      demandNodes,
      state,
      exec.trace,
    );
    for (const id of demanded) {
      session.demanded.add(id);
    }
  }

  // A failed effectful completion cached in the run-scoped session (a
  // cancelled prompt) stops every later effectful completion in the run,
  // even across separate scheduling passes sharing the session—such as a
  // seed-extraction fallback after a failed completion attempt.
  if (session != null) {
    for (const result of session.results.values()) {
      if (!result.success) {
        return { success: false, error: result.error };
      }
    }
  }

  const schedulable = nodes.filter((node) =>
    node.parser.dependencyMetadata?.source?.completeSource != null
  );
  if (schedulable.length === 0) return empty;

  const completed: EffectfulSourceCompletion[] = [];
  for (const node of nodes) {
    const source = node.parser.dependencyMetadata?.source;
    if (source == null) continue;
    if (source.completeSource == null) {
      // Registration order must follow declaration order across
      // structural and effectful occurrences of a shared source, the
      // way repeated command-line occurrences overwrite earlier ones.
      // Structural values were registered by source collection before
      // this pass, so a structural occurrence declared *after* an
      // effectful one re-registers its extracted value here to restore
      // that order.  Only nodes that participated in the construct's
      // source collection re-register; other expanded descendants were
      // never part of it.
      const collected = options?.isCollected?.(node) ??
        options?.isReusable?.(node) ?? true;
      if (source.extractSourceValue == null || collected === false) {
        continue;
      }
      const extracted = await source.extractSourceValue(node.state);
      if (extracted?.success === true && extracted.value !== undefined) {
        runtime.registerSource(source.sourceId, extracted.value);
      }
      continue;
    }

    // A completion already performed for this exact node in this pass—
    // typically by a parent construct's expanded scheduling—is reused
    // instead of being performed again, keeping lazy wrapper defaults at
    // one evaluation per pass and letting the owning construct cache the
    // very result whose value was registered.
    const pathKey = serializeSchedulingPath(node.path);
    const priorResult = session?.completedByPath.get(pathKey);
    if (priorResult != null) {
      if (
        source.preservesSourceValue && (options?.isReusable?.(node) ?? true)
      ) {
        completed.push({
          key: node.path[node.path.length - 1],
          result: priorResult,
        });
      }
      continue;
    }

    // Structural precedence is enforced per occurrence by the effectful
    // completion itself: a command-line value or a source binding for
    // the occurrence's own field is returned without running the effect
    // (see prompt()'s completion, which consults both before its
    // run-scoped cache).  A value registered by *another* occurrence of
    // the same source does not suppress this one: its field still needs
    // a value, so the completion runs here rather than after dependency
    // replay, and its registration overwrites earlier ones so the last
    // occurrence wins, matching repeated command-line occurrences.
    //
    // A source marked failed by extraction (e.g., an invalid bound
    // environment or configuration value) is not skipped: the effectful
    // completion is its recovery path—a prompt wrapper falls back after
    // the inner completion fails, and a successful answer re-registers
    // the source, clearing the failed state, so consumers resolve
    // consistently with the prompted field.  (Missing-source *defaults*
    // still never override explicit failures; see
    // fillMissingSourceDefaults.)
    const reusable = source.preservesSourceValue &&
      (options?.isReusable?.(node) ?? true);
    // A completion that cannot be cached by the owning construct would
    // run again during the construct's final completion phase unless it
    // is deduplicated through the run-scoped session.
    if (!reusable && session == null) continue;

    const childExec: ExecutionContext = { ...exec, path: node.path };
    const result = await source.completeSource(node.state, childExec);
    if (result == null) continue;
    if (!result.success) {
      runtime.markSourceFailed(source.sourceId);
      return { success: false, error: result.error };
    }
    // Deferred results carry placeholder values, which must never become
    // dependency values or cached completions.
    if (result.deferred === true) continue;
    session?.completedByPath.set(pathKey, result);
    if (reusable) {
      completed.push({ key: node.path[node.path.length - 1], result });
    }
    if (result.value !== undefined) {
      runtime.registerSource(source.sourceId, result.value);
    }
  }
  return { success: true, completed };
}

/**
 * Serializes a scheduling node path into a stable string key, using
 * length-prefixed segments so no separator escaping is needed.
 */
function serializeSchedulingPath(path: readonly PropertyKey[]): string {
  return path.map(serializePathSegment).join("");
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
  if (isPromiseLike(result)) {
    throw new TypeError(
      "resolveStateWithRuntime() received an async parseWithDependency() result. Use resolveStateWithRuntimeAsync() instead.",
    );
  }
  return result;
}

function resolveSingleDeferredAsync(
  deferred: DeferredParseState<unknown>,
  runtime: DependencyRuntimeContext,
): Promise<unknown> {
  const isMultiDep = deferred.dependencyIds != null &&
    deferred.dependencyIds.length > 0;
  const depIds = isMultiDep ? deferred.dependencyIds! : [deferred.dependencyId];
  const resolution = runtime.resolveDependencies({
    dependencyIds: depIds,
    defaultValues: deferred.defaultValues,
  });
  if (resolution.kind !== "resolved") {
    return Promise.resolve(deferred.preliminaryResult);
  }

  if (resolution.usedDefaults.every((d) => d)) {
    return Promise.resolve(deferred.preliminaryResult);
  }

  const depValue = isMultiDep ? resolution.values : resolution.values[0];
  return Promise.resolve(
    deferred.parser[parseWithDependency](deferred.rawInput, depValue),
  );
}

/**
 * Recursively collects dependency source values from {@link DependencySourceState}
 * objects found in the state tree and registers them in the runtime.
 *
 * This must run BEFORE deferred resolution so that all source values
 * are available when replaying derived parsers.
 *
 * @param state The state tree to traverse.
 * @param runtime The dependency runtime context to populate.
 * @param visited Cycle guard for recursive traversal.
 * @param excludedFields Optional property keys to skip at the current level.
 *                       This exclusion set is not propagated recursively.
 */
export function collectSourcesFromState(
  state: unknown,
  runtime: DependencyRuntimeContext,
  visited: WeakSet<object> = new WeakSet<object>(),
  excludedFields?: ReadonlySet<PropertyKey>,
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
      runtime.registerSource(depId, result.value);
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
      if (excludedFields?.has(key)) continue;
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
 * @throws {TypeError} If a deferred parser returns a promise-like result from
 *         `parseWithDependency()`. Use {@link resolveStateWithRuntimeAsync}
 *         for async resolution.
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
  deferredCache: WeakMap<
    DeferredParseState<unknown>,
    ValueParserResult<unknown>
  > = new WeakMap(),
): unknown {
  if (state == null) return state;

  if (isDeferredParseState(state)) {
    const cached = deferredCache.get(state);
    if (cached !== undefined) return cached;
    const resolved = resolveSingleDeferred(state, runtime);
    deferredCache.set(state, resolved);
    return resolved;
  }

  if (isDependencySourceState(state)) return state;

  if (typeof state === "object") {
    if (visited.has(state)) return state;
    visited.add(state);
  }

  if (Array.isArray(state)) {
    const resolved = state.map((item) =>
      resolveDeferredInState(item, runtime, visited, deferredCache)
    );
    return resolved.every((item, index) => item === state[index])
      ? state
      : resolved;
  }

  if (isPlainObject(state)) {
    const keys = Reflect.ownKeys(state);
    const resolvedEntries = keys.map((key) =>
      [
        key,
        resolveDeferredInState(state[key], runtime, visited, deferredCache),
      ] as const
    );
    if (resolvedEntries.every(([key, value]) => value === state[key])) {
      return state;
    }
    const resolved = Object.create(
      Object.getPrototypeOf(state),
    ) as Record<string | symbol, unknown>;
    for (const [key, value] of resolvedEntries) {
      resolved[key] = value;
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
  deferredCache: WeakMap<DeferredParseState<unknown>, Promise<unknown>> =
    new WeakMap(),
): Promise<unknown> {
  if (state == null) return state;

  if (isDeferredParseState(state)) {
    const cached = deferredCache.get(state);
    if (cached !== undefined) return cached;
    const resolved = resolveSingleDeferredAsync(state, runtime);
    deferredCache.set(state, resolved);
    return resolved;
  }

  if (isDependencySourceState(state)) return state;

  if (typeof state === "object") {
    if (visited.has(state)) return state;
    visited.add(state);
  }

  if (Array.isArray(state)) {
    const resolved = await Promise.all(
      state.map((item) =>
        resolveDeferredInStateAsync(item, runtime, visited, deferredCache)
      ),
    );
    return resolved.every((item, index) => item === state[index])
      ? state
      : resolved;
  }

  if (isPlainObject(state)) {
    const keys = Reflect.ownKeys(state);
    const resolvedEntries = await Promise.all(
      keys.map(async (key) => {
        return [
          key,
          await resolveDeferredInStateAsync(
            state[key],
            runtime,
            visited,
            deferredCache,
          ),
        ] as const;
      }),
    );
    if (resolvedEntries.every(([key, value]) => value === state[key])) {
      return state;
    }
    const resolved = Object.create(
      Object.getPrototypeOf(state),
    ) as Record<string | symbol, unknown>;
    for (const [key, value] of resolvedEntries) {
      resolved[key] = value;
    }
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
  parser: {
    readonly initialState?: unknown;
    readonly [unmatchedNonCliDependencySourceStateMarker]?: true;
  },
): boolean {
  if (fieldState === undefined) return false;
  const innerState = Array.isArray(fieldState) && fieldState.length === 1
    ? fieldState[0]
    : fieldState;
  // PendingDependencySourceState means the option was not provided.
  if (isPendingDependencySourceState(innerState)) return false;
  if (
    parser[unmatchedNonCliDependencySourceStateMarker] === true &&
    innerState != null &&
    typeof innerState === "object" &&
    Object.hasOwn(innerState, "hasCliValue") &&
    (innerState as { readonly hasCliValue?: unknown }).hasCliValue === false
  ) {
    return false;
  }
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
