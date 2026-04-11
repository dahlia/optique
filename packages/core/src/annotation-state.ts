import {
  annotationKey,
  type Annotations,
  getAnnotations,
  inheritAnnotations,
  injectAnnotations,
  type ReadonlyAnnotations,
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
  annotations: Annotations | ReadonlyAnnotations,
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
