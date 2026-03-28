/**
 * Immutable input trace for recording raw inputs during parsing.
 *
 * Primitives record raw input into the trace so that constructs and the
 * dependency runtime can replay derived parsers with actual dependency values
 * later.  The trace is path-keyed and immutable — every mutation returns a
 * new instance.
 *
 * @internal
 * @since 1.0.0
 * @module
 */
import type { ValueParserResult } from "./valueparser.ts";

/**
 * A replayable record of raw input consumed by a single parser node.
 *
 * @internal
 * @since 1.0.0
 */
export interface TraceEntry {
  /** The kind of input that was consumed. */
  readonly kind: "option-value" | "argument-value" | "literal" | "custom";

  /** The raw input string to be replayed. */
  readonly rawInput: string;

  /** The tokens consumed from the buffer. */
  readonly consumed: readonly string[];

  /** The preliminary parse result using default dependency values. */
  readonly preliminaryResult?: ValueParserResult<unknown>;

  /** The option names that matched (e.g., `["--env", "-e"]`). */
  readonly optionNames?: readonly string[];

  /** The metavar of the value parser. */
  readonly metavar?: string;
}

/**
 * An immutable, path-keyed store of {@link TraceEntry} records.
 *
 * Each entry is keyed by a path of `PropertyKey` segments (strings, numbers,
 * or symbols) corresponding to the position of the parser in the parse tree.
 *
 * All mutation methods return a new `InputTrace` instance; the original is
 * never modified.
 *
 * @internal
 * @since 1.0.0
 */
export interface InputTrace {
  /**
   * Retrieves the trace entry at the given path.
   *
   * @param path The path segments identifying the entry.
   * @returns The entry, or `undefined` if no entry exists at that path.
   */
  get(path: readonly PropertyKey[]): TraceEntry | undefined;

  /**
   * Returns a new trace with the entry set at the given path.
   *
   * @param path The path segments identifying the entry.
   * @param entry The trace entry to store.
   * @returns A new `InputTrace` with the entry stored.
   */
  set(path: readonly PropertyKey[], entry: TraceEntry): InputTrace;

  /**
   * Returns a new trace with the entry at the given path removed.
   *
   * @param path The path segments identifying the entry to remove.
   * @returns A new `InputTrace` without the entry.
   */
  delete(path: readonly PropertyKey[]): InputTrace;

  /**
   * Returns a scoped view of this trace prefixed by the given path segment.
   *
   * Entries set on the child trace are stored under `[pathSegment, ...]`
   * from the child's perspective.
   *
   * @param pathSegment The path segment to scope by.
   * @returns A new `InputTrace` scoped to the given segment.
   */
  child(pathSegment: PropertyKey): InputTrace;
}

// ---------------------------------------------------------------------------
// Path serialization
// ---------------------------------------------------------------------------

// Symbol registry: maps each symbol to a stable string key so that
// identical symbol instances always produce the same serialized path.
// Uses Map (not WeakMap) because WeakMap rejects registered symbols
// created with Symbol.for().
const symbolKeys = new Map<symbol, string>();
let symbolCounter = 0;

function serializeKey(key: PropertyKey): string {
  if (typeof key === "string") return `s:${key}`;
  if (typeof key === "number") return `n:${key}`;
  // Registered symbols have a globally unique key via Symbol.keyFor().
  const registeredKey = Symbol.keyFor(key as symbol);
  if (registeredKey !== undefined) return `r:${registeredKey}`;
  // Non-registered symbols get a per-instance counter-based id.
  let id = symbolKeys.get(key as symbol);
  if (id === undefined) {
    id = `y:${symbolCounter++}`;
    symbolKeys.set(key as symbol, id);
  }
  return id;
}

function serializePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "";
  return path.map(serializeKey).join("\0");
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class InputTraceImpl implements InputTrace {
  readonly #entries: ReadonlyMap<string, TraceEntry>;
  readonly #prefix: readonly PropertyKey[];

  constructor(
    entries?: ReadonlyMap<string, TraceEntry>,
    prefix?: readonly PropertyKey[],
  ) {
    this.#entries = entries ?? new Map();
    this.#prefix = prefix ?? [];
  }

  #fullPath(path: readonly PropertyKey[]): readonly PropertyKey[] {
    return this.#prefix.length === 0 ? path : [...this.#prefix, ...path];
  }

  get(path: readonly PropertyKey[]): TraceEntry | undefined {
    return this.#entries.get(serializePath(this.#fullPath(path)));
  }

  set(path: readonly PropertyKey[], entry: TraceEntry): InputTrace {
    const copy = new Map(this.#entries);
    copy.set(serializePath(this.#fullPath(path)), entry);
    return new InputTraceImpl(copy, this.#prefix);
  }

  delete(path: readonly PropertyKey[]): InputTrace {
    const copy = new Map(this.#entries);
    copy.delete(serializePath(this.#fullPath(path)));
    return new InputTraceImpl(copy, this.#prefix);
  }

  child(pathSegment: PropertyKey): InputTrace {
    return new InputTraceImpl(
      this.#entries,
      [...this.#prefix, pathSegment],
    );
  }
}

/**
 * Creates a new empty {@link InputTrace}.
 *
 * @returns An empty immutable input trace.
 * @internal
 * @since 1.0.0
 */
export function createInputTrace(): InputTrace {
  return new InputTraceImpl();
}
