import {
  annotationKey,
  type Annotations,
  getAnnotations,
  inheritAnnotations,
  injectAnnotations,
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
 * @internal
 */
export const annotationViewTargets = new WeakMap<object, object>();

/**
 * Unwraps an annotation-view proxy to its original target object.
 *
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
 * @internal
 */
export function isAnnotationWrappedInitialState(state: unknown): boolean {
  return normalizeInjectedAnnotationState(state) === undefined;
}

/**
 * Propagates parent annotations into a child parse state when the child parser
 * explicitly opts into parent annotation inheritance.
 *
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
