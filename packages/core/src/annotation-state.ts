import {
  annotationKey,
  type Annotations,
  getAnnotations,
  inheritAnnotations,
  injectAnnotations,
  isInjectedAnnotationWrapper,
  unwrapInjectedAnnotationWrapper,
} from "./annotations.ts";
import {
  inheritParentAnnotationsKey,
  type Mode,
  type Parser,
} from "./parser.ts";

/**
 * Shared targets for annotation-view proxies.
 *
 * Maps a proxy returned by {@link withAnnotationView} back to its original
 * target object.
 *
 * @internal
 */
export const annotationViewTargets = new WeakMap<object, object>();

const delegatedAnnotationCloneTargets = new WeakMap<object, object>();

/**
 * Unwraps an annotation-view proxy to its original target object.
 *
 * @param value The candidate value that may be an annotation-view proxy.
 * @returns The original target object when the input is a tracked
 *          annotation-view proxy; otherwise the input value unchanged.
 * @internal
 */
export function unwrapAnnotationView<T>(value: T): T {
  if (value == null || typeof value !== "object") {
    return value;
  }
  return (annotationViewTargets.get(value as object) as T | undefined) ?? value;
}

function unwrapDelegatedAnnotationClone<T>(value: T): T {
  if (value == null || typeof value !== "object") {
    return value;
  }
  return (delegatedAnnotationCloneTargets.get(value as object) as
    | T
    | undefined) ??
    value;
}

/**
 * Creates a proxy that exposes annotations without changing the target shape.
 *
 * @param state The object state to expose through an annotation-aware view.
 * @param annotations The annotations to surface through the proxy.
 * @returns A proxy over the unwrapped target object that reports the supplied
 *          annotations while preserving the target's structural behavior.
 * @internal
 */
export function withAnnotationView<T extends object>(
  state: T,
  annotations: Annotations,
): T {
  const target = unwrapAnnotationView(state) as T;
  const view = new Proxy(target, {
    get(target, key) {
      if (key === annotationKey) {
        return annotations;
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(target, key) {
      return key === annotationKey || Reflect.has(target, key);
    },
  });
  annotationViewTargets.set(view, target);
  return view;
}

/**
 * Removes Optique's internal primitive-state annotation wrapper when present.
 *
 * @param state The parser state to normalize.
 * @returns The wrapped primitive sentinel when the input is an injected
 *          annotation wrapper; otherwise the original input unchanged.
 * @internal
 */
export function normalizeInjectedAnnotationState<T>(state: T): T {
  return unwrapInjectedAnnotationWrapper(state);
}

function isNonPlainDelegatedObject(state: object): boolean {
  const proto = Object.getPrototypeOf(state);
  if (
    Array.isArray(state) ||
    proto === Date.prototype ||
    proto === Map.prototype ||
    proto === Set.prototype ||
    proto === RegExp.prototype
  ) {
    return false;
  }
  return proto !== Object.prototype && proto !== null;
}

function inheritDelegatedAnnotations<TState extends object>(
  parentState: unknown,
  childState: TState,
): TState {
  const target = normalizeDelegatedAnnotationState(childState);
  const delegatedState = inheritAnnotations(parentState, target);
  if (delegatedState !== target) {
    delegatedAnnotationCloneTargets.set(
      delegatedState as object,
      target as object,
    );
  }
  return delegatedState as TState;
}

/**
 * Removes Optique's internal annotation carriers from a delegated state.
 *
 * This unwraps primitive-state annotation wrappers, tracked delegated clones,
 * and annotation-view proxies used for object states.
 *
 * @param state The delegated state to normalize.
 * @returns The original underlying state value.
 * @internal
 */
export function normalizeDelegatedAnnotationState<T>(state: T): T {
  return normalizeInjectedAnnotationState(
    unwrapDelegatedAnnotationClone(unwrapAnnotationView(state)),
  );
}

/**
 * Returns whether the given state uses an internal delegated annotation carrier.
 *
 * @param state The candidate state to inspect.
 * @returns `true` when the state is an injected primitive wrapper, a tracked
 *          delegated clone, or an annotation-view proxy.
 * @internal
 */
export function hasDelegatedAnnotationCarrier(state: unknown): boolean {
  return state != null &&
    typeof state === "object" &&
    (
      isInjectedAnnotationWrapper(state) ||
      delegatedAnnotationCloneTargets.has(state as object) ||
      annotationViewTargets.has(state as object)
    );
}

interface NestedNormalizationEntry {
  clone: object;
  finalized: boolean;
  result: object;
  preferCloneOnRead: boolean;
}

function getPendingNestedNormalizationEntry(
  originalValue: unknown,
  normalizedValue: unknown,
  seen: WeakMap<object, NestedNormalizationEntry>,
): NestedNormalizationEntry | undefined {
  if (originalValue == null || typeof originalValue !== "object") {
    return undefined;
  }
  const entry = seen.get(originalValue as object);
  return entry != null && entry.clone === normalizedValue &&
      (!entry.finalized || entry.preferCloneOnRead)
    ? entry
    : undefined;
}

function createPendingNestedNormalizationClone(source: object): object {
  return Array.isArray(source)
    ? []
    : Object.create(Object.getPrototypeOf(source));
}

function createPendingNestedNormalizationCollectionClone<
  T extends Map<unknown, unknown> | Set<unknown>,
>(source: T): T {
  const Constructor = source.constructor as new () => T;
  return new Constructor();
}

function normalizeNestedDelegatedStructuredState<T extends object>(
  source: T,
  seen: WeakMap<object, NestedNormalizationEntry>,
  preferPendingClone: boolean,
): T {
  const clone = createPendingNestedNormalizationClone(source);
  const entry: NestedNormalizationEntry = {
    clone,
    finalized: false,
    result: clone,
    preferCloneOnRead: false,
  };
  seen.set(source, entry);

  const overrides = new Map<PropertyKey, unknown>();
  let changed = false;
  let hasPendingAliasOverride = false;
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor == null || !("value" in descriptor)) {
      continue;
    }
    const nextValue = normalizeNestedDelegatedAnnotationState(
      descriptor.value,
      seen,
      true,
    );
    if (nextValue === descriptor.value) {
      continue;
    }
    overrides.set(key, nextValue);
    if (
      getPendingNestedNormalizationEntry(descriptor.value, nextValue, seen) ==
        null
    ) {
      changed = true;
    } else {
      hasPendingAliasOverride = true;
    }
  }

  if (!changed && !hasPendingAliasOverride) {
    entry.finalized = true;
    entry.result = source;
    return source;
  }

  const descriptors = Object.getOwnPropertyDescriptors(source) as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  for (const [key, nextValue] of overrides) {
    const descriptor = descriptors[key];
    if (descriptor == null || !("value" in descriptor)) {
      continue;
    }
    descriptors[key] = { ...descriptor, value: nextValue };
  }

  Object.defineProperties(clone, descriptors);
  entry.finalized = true;
  entry.preferCloneOnRead = !changed && hasPendingAliasOverride;
  entry.result = changed ? clone : source;
  return (changed || preferPendingClone ? clone : source) as T;
}

function normalizeNestedDelegatedMapState<T extends Map<unknown, unknown>>(
  source: T,
  seen: WeakMap<object, NestedNormalizationEntry>,
  preferPendingClone: boolean,
): T {
  const clone = createPendingNestedNormalizationCollectionClone(source);
  const entry: NestedNormalizationEntry = {
    clone,
    finalized: false,
    result: clone,
    preferCloneOnRead: false,
  };
  seen.set(source, entry);

  const normalizedEntries: Array<readonly [unknown, unknown]> = [];
  const overrides = new Map<PropertyKey, unknown>();
  let changed = false;
  let hasPendingAliasOverride = false;

  for (const [key, value] of source) {
    const nextKey = normalizeNestedDelegatedAnnotationState(key, seen, true);
    const nextValue = normalizeNestedDelegatedAnnotationState(
      value,
      seen,
      true,
    );
    normalizedEntries.push([nextKey, nextValue]);
    if (nextKey !== key) {
      if (getPendingNestedNormalizationEntry(key, nextKey, seen) == null) {
        changed = true;
      } else {
        hasPendingAliasOverride = true;
      }
    }
    if (nextValue !== value) {
      if (
        getPendingNestedNormalizationEntry(value, nextValue, seen) == null
      ) {
        changed = true;
      } else {
        hasPendingAliasOverride = true;
      }
    }
  }

  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor == null || !("value" in descriptor)) {
      continue;
    }
    const nextValue = normalizeNestedDelegatedAnnotationState(
      descriptor.value,
      seen,
      true,
    );
    if (nextValue === descriptor.value) {
      continue;
    }
    overrides.set(key, nextValue);
    if (
      getPendingNestedNormalizationEntry(descriptor.value, nextValue, seen) ==
        null
    ) {
      changed = true;
    } else {
      hasPendingAliasOverride = true;
    }
  }

  if (!changed && !hasPendingAliasOverride) {
    entry.finalized = true;
    entry.result = source;
    return source;
  }

  for (const [key, value] of normalizedEntries) {
    clone.set(key, value);
  }

  const descriptors = Object.getOwnPropertyDescriptors(source) as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  for (const [key, nextValue] of overrides) {
    const descriptor = descriptors[key];
    if (descriptor == null || !("value" in descriptor)) {
      continue;
    }
    descriptors[key] = { ...descriptor, value: nextValue };
  }

  Object.defineProperties(clone, descriptors);
  entry.finalized = true;
  entry.preferCloneOnRead = !changed && hasPendingAliasOverride;
  entry.result = changed ? clone : source;
  return (changed || preferPendingClone ? clone : source) as T;
}

function normalizeNestedDelegatedSetState<T extends Set<unknown>>(
  source: T,
  seen: WeakMap<object, NestedNormalizationEntry>,
  preferPendingClone: boolean,
): T {
  const clone = createPendingNestedNormalizationCollectionClone(source);
  const entry: NestedNormalizationEntry = {
    clone,
    finalized: false,
    result: clone,
    preferCloneOnRead: false,
  };
  seen.set(source, entry);

  const normalizedValues: unknown[] = [];
  const overrides = new Map<PropertyKey, unknown>();
  let changed = false;
  let hasPendingAliasOverride = false;

  for (const value of source) {
    const nextValue = normalizeNestedDelegatedAnnotationState(
      value,
      seen,
      true,
    );
    normalizedValues.push(nextValue);
    if (nextValue === value) {
      continue;
    }
    if (getPendingNestedNormalizationEntry(value, nextValue, seen) == null) {
      changed = true;
    } else {
      hasPendingAliasOverride = true;
    }
  }

  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor == null || !("value" in descriptor)) {
      continue;
    }
    const nextValue = normalizeNestedDelegatedAnnotationState(
      descriptor.value,
      seen,
      true,
    );
    if (nextValue === descriptor.value) {
      continue;
    }
    overrides.set(key, nextValue);
    if (
      getPendingNestedNormalizationEntry(descriptor.value, nextValue, seen) ==
        null
    ) {
      changed = true;
    } else {
      hasPendingAliasOverride = true;
    }
  }

  if (!changed && !hasPendingAliasOverride) {
    entry.finalized = true;
    entry.result = source;
    return source;
  }

  for (const value of normalizedValues) {
    clone.add(value);
  }

  const descriptors = Object.getOwnPropertyDescriptors(source) as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  for (const [key, nextValue] of overrides) {
    const descriptor = descriptors[key];
    if (descriptor == null || !("value" in descriptor)) {
      continue;
    }
    descriptors[key] = { ...descriptor, value: nextValue };
  }

  Object.defineProperties(clone, descriptors);
  entry.finalized = true;
  entry.preferCloneOnRead = !changed && hasPendingAliasOverride;
  entry.result = changed ? clone : source;
  return (changed || preferPendingClone ? clone : source) as T;
}

/**
 * Recursively removes delegated annotation carriers from plain-object, array,
 * and built-in collection structures.
 *
 * Nested plain objects, arrays, Maps, and Sets are shallow-cloned only when a
 * delegated carrier is found below them. Other non-plain objects are unwrapped
 * at the top level and then preserved as-is to avoid mutating or reconstructing
 * class instances.
 *
 * @param value The candidate value to normalize.
 * @param seen Tracks already-normalized objects so cyclic values keep their
 *             shape.
 * @returns The original value when no delegated carriers are present, or a
 *          normalized clone with delegated carriers removed.
 * @internal
 */
export function normalizeNestedDelegatedAnnotationState<T>(
  value: T,
  seen = new WeakMap<object, NestedNormalizationEntry>(),
  preferPendingClone = false,
): T {
  const normalized = normalizeDelegatedAnnotationState(value);
  if (normalized == null || typeof normalized !== "object") {
    return normalized;
  }
  const source = normalized as object;
  const existing = seen.get(source);
  if (existing != null) {
    if (!existing.finalized) {
      return existing.clone as T;
    }
    return (
      preferPendingClone && existing.preferCloneOnRead
        ? existing.clone
        : existing.result
    ) as T;
  }
  if (Array.isArray(source)) {
    return normalizeNestedDelegatedStructuredState(
      source,
      seen,
      preferPendingClone,
    ) as T;
  }
  if (source instanceof Map) {
    return normalizeNestedDelegatedMapState(
      source,
      seen,
      preferPendingClone,
    ) as T;
  }
  if (source instanceof Set) {
    return normalizeNestedDelegatedSetState(
      source,
      seen,
      preferPendingClone,
    ) as T;
  }
  const proto = Object.getPrototypeOf(source);
  if (proto !== Object.prototype && proto !== null) {
    return normalized;
  }
  return normalizeNestedDelegatedStructuredState(
    source,
    seen,
    preferPendingClone,
  ) as T;
}

/**
 * Creates a short-lived delegated state that exposes the parent's annotations
 * regardless of the child state's runtime shape.
 *
 * Primitive and nullish states use `injectAnnotations()`, clone-based object
 * delegation is tracked so it can be normalized back out later, and non-plain
 * objects use an annotation-view proxy so class invariants such as private
 * fields remain intact.
 *
 * @param parentState The state carrying the annotations to delegate.
 * @param childState The child state that should observe those annotations.
 * @returns A delegated child state that exposes the parent's annotations.
 * @internal
 */
export function getDelegatedAnnotationState<TState>(
  parentState: unknown,
  childState: TState,
): TState {
  const annotations = getAnnotations(parentState);
  if (annotations === undefined) {
    return childState;
  }
  if (isInjectedAnnotationWrapper(childState)) {
    return injectAnnotations(
      normalizeInjectedAnnotationState(childState),
      annotations,
    );
  }
  if (childState == null || typeof childState !== "object") {
    return injectAnnotations(childState, annotations);
  }
  if (
    getAnnotations(childState) === annotations &&
    (
      delegatedAnnotationCloneTargets.has(childState as object) ||
      annotationViewTargets.has(childState as object)
    )
  ) {
    return childState;
  }
  if (isNonPlainDelegatedObject(childState)) {
    return withAnnotationView(childState, annotations) as TState;
  }
  return inheritDelegatedAnnotations(parentState, childState);
}

/**
 * Returns whether a state is still at the initial sentinel after normalizing
 * Optique's injected annotation wrapper.
 *
 * This treats plain `undefined` and annotation-wrapped `undefined` the same.
 *
 * @param state The parser state to inspect.
 * @returns `true` when the normalized state is still `undefined`;
 *          otherwise `false`.
 * @internal
 */
export function isAnnotationWrappedInitialState(state: unknown): boolean {
  return normalizeInjectedAnnotationState(state) === undefined;
}

/**
 * Propagates parent annotations into a child parse state when the child parser
 * explicitly opts into parent annotation inheritance.
 *
 * @param parentState The parent parser state that may carry annotations.
 * @param childState The child parse state that may receive inherited
 *                   annotations.
 * @param parser The child parser whose inheritance marker controls whether
 *               wrapper injection is allowed.
 * @returns The original child state when no injection is needed or possible,
 *          or an annotation-injected child state that preserves the original
 *          sentinel or object shape when inheritance applies.
 * @internal
 */
export function getWrappedChildParseState<TState>(
  parentState: unknown,
  childState: TState,
  parser: Parser<Mode, unknown, unknown>,
): TState {
  const annotations = getAnnotations(parentState);
  const shouldInheritAnnotations =
    Reflect.get(parser, inheritParentAnnotationsKey) === true;
  if (childState == null) {
    if (annotations !== undefined && shouldInheritAnnotations) {
      return injectAnnotations(childState, annotations);
    }
    return childState;
  }
  if (
    annotations === undefined ||
    typeof childState !== "object" ||
    getAnnotations(childState) === annotations ||
    !shouldInheritAnnotations
  ) {
    return childState;
  }
  const injectedState = injectAnnotations(childState, annotations);
  return getAnnotations(injectedState) === annotations
    ? injectedState as TState
    : childState;
}

/**
 * Propagates parent annotations into a child state while preserving the child
 * state's shape for parsers that do not opt into full wrapper injection.
 *
 * @param parentState The parent parser state that may carry annotations.
 * @param childState The child state that may receive inherited annotations.
 * @param parser The child parser whose inheritance marker controls whether
 *               full wrapper injection is allowed.
 * @returns The original child state when no wrapping is needed, an
 *          annotation-injected child state when inheritance applies, or an
 *          annotation-view proxy that preserves the child's object shape.
 * @internal
 */
export function getWrappedChildState<TState>(
  parentState: unknown,
  childState: TState,
  parser: Parser<Mode, unknown, unknown>,
): TState {
  const annotations = getAnnotations(parentState);
  const shouldInheritAnnotations =
    Reflect.get(parser, inheritParentAnnotationsKey) === true;
  if (childState == null) {
    if (annotations !== undefined && shouldInheritAnnotations) {
      return injectAnnotations(childState, annotations);
    }
    return childState;
  }
  if (
    annotations === undefined ||
    typeof childState !== "object" ||
    getAnnotations(childState) === annotations
  ) {
    return childState;
  }
  if (shouldInheritAnnotations) {
    const injectedState = injectAnnotations(childState, annotations);
    if (getAnnotations(injectedState) === annotations) {
      return injectedState as TState;
    }
  }
  return withAnnotationView(childState, annotations) as TState;
}

/**
 * Reconciles object-owned child state with parent annotations using the same
 * shared object-state inheritance rule across parser families.
 *
 * @param parentState The parent parser state that may carry annotations.
 * @param childState The object-owned child state to reconcile.
 * @returns The original child state when no reconciliation is needed, or a
 *          child state with inherited annotations when the object state should
 *          carry the parent's annotations.
 * @internal
 */
export function reconcileObjectChildState<TState>(
  parentState: unknown,
  childState: TState,
): TState {
  const annotations = getAnnotations(parentState);
  if (
    annotations === undefined ||
    childState == null ||
    typeof childState !== "object" ||
    getAnnotations(childState) === annotations
  ) {
    return childState;
  }
  return inheritAnnotations(parentState, childState);
}
