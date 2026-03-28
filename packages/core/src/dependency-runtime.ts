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
import { message } from "./message.ts";
import type { DependencyRegistryLike } from "./registry-types.ts";
import type { ValueParserResult } from "./valueparser.ts";
import type { ParserDependencyMetadata } from "./dependency-metadata.ts";

// =============================================================================
// Symbol serialization
// =============================================================================

// Per-instance counter so that distinct symbols with the same description
// serialize to different strings.  Uses Map (not WeakMap) because WeakMap
// rejects registered symbols created with Symbol.for().
const symbolIds = new Map<symbol, string>();
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
   */
  readonly matched?: boolean;

  /**
   * Snapshotted default dependency values for derived parsers.
   * Constructs should populate this at node creation time (once) to
   * avoid re-evaluating dynamic `getDefaultDependencyValues()` thunks
   * at replay time.
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

  /** Resolve dependencies for suggestions (same semantics as resolve). */
  getSuggestionDependencies(request: DependencyRequest): DependencyResolution;
}

// =============================================================================
// Implementation
// =============================================================================

class DependencyRuntimeContextImpl implements DependencyRuntimeContext {
  readonly registry: DependencyRegistryLike;
  readonly #replayCache = new Map<string, ValueParserResult<unknown>>();

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
  return lengthPrefix(stableSymbolKey(p as symbol));
}

function serializeReplayKey(key: ReplayKey): string {
  const pathStr = key.path.map(serializePathSegment).join("");
  return `${pathStr}\x01${
    lengthPrefix(key.rawInput)
  }\x01${key.dependencyFingerprint}`;
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
  return values.map(fingerprintValue).join("\x00");
}

// Per-object identity counter for fingerprinting non-primitive values.
// Using reference identity avoids lossy JSON.stringify (which maps Map,
// Set, class instances, etc. to '{}').  Same reference → same fingerprint;
// different reference → different fingerprint (conservative but never stale).
const objectIds = new WeakMap<object, number>();
let objectIdCounter = 0;

function fingerprintValue(v: unknown): string {
  if (v === undefined) return "u:";
  if (v === null) return "n:";
  if (typeof v === "string") return `s:${v}`;
  if (typeof v === "number") return `d:${v}`;
  if (typeof v === "boolean") return `b:${v}`;
  if (typeof v === "symbol") return `y:${stableSymbolKey(v)}`;
  if (typeof v === "object") {
    let id = objectIds.get(v);
    if (id === undefined) {
      id = objectIdCounter++;
      objectIds.set(v, id);
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
export function createReplayKey(
  path: readonly PropertyKey[],
  rawInput: string,
  dependencyValues: readonly unknown[],
): ReplayKey {
  return {
    path,
    rawInput,
    dependencyFingerprint: createDependencyFingerprint(dependencyValues),
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
    if (result != null && result.success) {
      runtime.registerSource(meta.source.sourceId, result.value, "cli");
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
    // Do not override explicit parse failures with defaults.  If the
    // parser consumed input (matched === true), the user explicitly
    // provided a value that failed validation.
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
  const key = createReplayKey(node.path, rawInput, resolution.values);
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
  const key = createReplayKey(node.path, rawInput, resolution.values);
  const cached = runtime.getReplayResult(key);
  if (cached != null) return cached;

  const result = await meta.derived.replayParse(rawInput, resolution.values);

  runtime.setReplayResult(key, result);
  return result;
}
