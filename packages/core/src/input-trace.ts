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

  /**
   * Snapshotted default dependency values captured during parse.
   *
   * Present when a derived parser snapshots default dependency values during
   * parse, including both `derive()` and `deriveFrom()` parsers.
   * This avoids re-evaluating dynamic default thunks during replay.
   */
  readonly defaultDependencyValues?: readonly unknown[];

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
}

// ---------------------------------------------------------------------------
// Path serialization
// ---------------------------------------------------------------------------

// Symbol registry: maps each symbol to a stable string key so that
// identical symbol instances always produce the same serialized path.
// Registered symbols are handled by Symbol.keyFor() and never enter
// this map, so WeakMap is safe and avoids retaining local symbols.
const symbolKeys = new WeakMap<symbol, string>();
let symbolCounter = 0;

/** Length-prefix a raw segment so that no delimiter escaping is needed. */
function lengthPrefix(s: string): string {
  return `${s.length}:${s}`;
}

function serializeKey(key: PropertyKey): string {
  if (typeof key === "string") return lengthPrefix(`s${key}`);
  if (typeof key === "number") return lengthPrefix(`n${key}`);
  // Registered symbols have a globally unique key via Symbol.keyFor().
  const registeredKey = Symbol.keyFor(key as symbol);
  if (registeredKey !== undefined) return lengthPrefix(`r${registeredKey}`);
  // Non-registered symbols get a per-instance counter-based id.
  let id = symbolKeys.get(key as symbol);
  if (id === undefined) {
    id = `y${symbolCounter++}`;
    symbolKeys.set(key as symbol, id);
  }
  return lengthPrefix(id);
}

function serializePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "";
  return path.map(serializeKey).join("");
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

// Nodes are immutable. Updating a trace copies only the search path and shares
// untouched subtrees, so retaining or forking an earlier trace is safe.
interface TraceNode {
  readonly key: string;
  readonly entry: TraceEntry;
  readonly left: TraceNode | undefined;
  readonly right: TraceNode | undefined;
  readonly height: number;
}

function height(node: TraceNode | undefined): number {
  return node?.height ?? 0;
}

function node(
  key: string,
  entry: TraceEntry,
  left: TraceNode | undefined,
  right: TraceNode | undefined,
): TraceNode {
  return {
    key,
    entry,
    left,
    right,
    height: 1 + Math.max(height(left), height(right)),
  };
}

// Rebuild bottom-up, including rotations. A zero-balance heavy child requires
// a single rotation (this case occurs during deletion).
function balance(
  key: string,
  entry: TraceEntry,
  left: TraceNode | undefined,
  right: TraceNode | undefined,
): TraceNode {
  if (height(left) - height(right) > 1 && left != null) {
    const pivot = left.right;
    if (height(pivot) > height(left.left) && pivot != null) {
      return node(
        pivot.key,
        pivot.entry,
        node(left.key, left.entry, left.left, pivot.left),
        node(key, entry, pivot.right, right),
      );
    }
    return node(
      left.key,
      left.entry,
      left.left,
      node(key, entry, left.right, right),
    );
  }
  if (height(right) - height(left) > 1 && right != null) {
    const pivot = right.left;
    if (height(pivot) > height(right.right) && pivot != null) {
      return node(
        pivot.key,
        pivot.entry,
        node(key, entry, left, pivot.left),
        node(right.key, right.entry, pivot.right, right.right),
      );
    }
    return node(
      right.key,
      right.entry,
      node(key, entry, left, right.left),
      right.right,
    );
  }
  return node(key, entry, left, right);
}

function setEntry(
  root: TraceNode | undefined,
  key: string,
  entry: TraceEntry,
): TraceNode {
  if (root == null) return node(key, entry, undefined, undefined);
  if (key === root.key) return entry === root.entry ? root : { ...root, entry };
  if (key < root.key) {
    const left = setEntry(root.left, key, entry);
    return left === root.left
      ? root
      : balance(root.key, root.entry, left, root.right);
  }
  const right = setEntry(root.right, key, entry);
  return right === root.right
    ? root
    : balance(root.key, root.entry, root.left, right);
}

function popMin(root: TraceNode): readonly [TraceNode, TraceNode | undefined] {
  if (root.left == null) return [root, root.right];
  const [minimum, left] = popMin(root.left);
  return [minimum, balance(root.key, root.entry, left, root.right)];
}

function deleteEntry(
  root: TraceNode | undefined,
  key: string,
): TraceNode | undefined {
  if (root == null) return undefined;
  if (key === root.key) {
    if (root.left == null) return root.right;
    if (root.right == null) return root.left;
    const [successor, right] = popMin(root.right);
    return balance(successor.key, successor.entry, root.left, right);
  }
  if (key < root.key) {
    const left = deleteEntry(root.left, key);
    return left === root.left
      ? root
      : balance(root.key, root.entry, left, root.right);
  }
  const right = deleteEntry(root.right, key);
  return right === root.right
    ? root
    : balance(root.key, root.entry, root.left, right);
}

function inspectNode(
  root: TraceNode | undefined,
  lower?: string,
  upper?: string,
): { readonly size: number; readonly height: number } {
  if (root == null) return { size: 0, height: 0 };
  if (
    (lower !== undefined && root.key <= lower) ||
    (upper !== undefined && root.key >= upper)
  ) {
    throw new TypeError("Input trace keys are not strictly ordered.");
  }
  const left = inspectNode(root.left, lower, root.key);
  const right = inspectNode(root.right, root.key, upper);
  const actualHeight = 1 + Math.max(left.height, right.height);
  if (
    root.height !== actualHeight || Math.abs(left.height - right.height) > 1
  ) {
    throw new TypeError("Input trace heights or balance are invalid.");
  }
  return { size: 1 + left.size + right.size, height: actualHeight };
}

class InputTraceImpl implements InputTrace {
  readonly #root: TraceNode | undefined;

  constructor(root?: TraceNode) {
    this.#root = root;
  }

  get(path: readonly PropertyKey[]): TraceEntry | undefined {
    const key = serializePath(path);
    let current = this.#root;
    while (current != null) {
      if (key === current.key) return current.entry;
      current = key < current.key ? current.left : current.right;
    }
    return undefined;
  }

  set(path: readonly PropertyKey[], entry: TraceEntry): InputTrace {
    return new InputTraceImpl(setEntry(this.#root, serializePath(path), entry));
  }

  delete(path: readonly PropertyKey[]): InputTrace {
    return new InputTraceImpl(deleteEntry(this.#root, serializePath(path)));
  }

  static inspect(
    trace: InputTrace,
  ): { readonly size: number; readonly height: number } {
    if (!(trace instanceof InputTraceImpl)) {
      throw new TypeError("Expected an Optique input trace.");
    }
    return inspectNode(trace.#root);
  }
}

/**
 * Checks private tree invariants without exposing mutable nodes.
 * This module is not a package export; the checker is used by internal tests.
 *
 * @param trace The trace to inspect.
 * @returns Its size and verified height.
 * @throws {TypeError} If the trace is foreign or its tree invariants are invalid.
 * @internal
 * @since 1.0.16
 */
export function inspectInputTrace(
  trace: InputTrace,
): { readonly size: number; readonly height: number } {
  return InputTraceImpl.inspect(trace);
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
