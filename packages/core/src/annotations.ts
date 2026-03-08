/**
 * Runtime context extension system for Optique parsers.
 *
 * This module provides the annotations system that allows external runtime data
 * to be passed to parsers during the parsing session. This enables use cases like
 * config file fallbacks, environment-based validation, and shared context.
 *
 * @module
 * @since 0.10.0
 */

/**
 * Annotation key symbol for storing data in parser state.
 * @since 0.10.0
 */
export const annotationKey: unique symbol = Symbol.for(
  "@optique/core/parser/annotation",
);

/**
 * Internal key for preserving primitive parser state values when annotations
 * are injected into non-object states.
 * @internal
 */
export const annotationStateValueKey: unique symbol = Symbol.for(
  "@optique/core/parser/annotationStateValue",
);

/**
 * Internal marker key that indicates annotation wrapping was injected by
 * Optique internals for non-object states.
 * @internal
 */
export const annotationWrapperKey: unique symbol = Symbol.for(
  "@optique/core/parser/annotationWrapper",
);

/**
 * Annotations that can be passed to parsers during execution.
 * Allows external packages to provide additional data that parsers can access
 * during complete() or parse() phases.
 *
 * @example
 * ```typescript
 * const myDataKey = Symbol.for("@my-package/data");
 * const result = parse(parser, args, {
 *   annotations: {
 *     [myDataKey]: { foo: "bar" }
 *   }
 * });
 * ```
 * @since 0.10.0
 */
export type Annotations = Record<symbol, unknown>;

/**
 * Options for parse functions.
 * @since 0.10.0
 */
export interface ParseOptions {
  /**
   * Annotations to attach to the parsing session.
   * Parsers can access these annotations via getAnnotations(state).
   */
  annotations?: Annotations;
}

/**
 * Extracts annotations from parser state.
 *
 * @param state Parser state that may contain annotations
 * @returns Annotations object or undefined if no annotations are present
 * @since 0.10.0
 *
 * @example
 * ```typescript
 * const annotations = getAnnotations(state);
 * const myData = annotations?.[myDataKey];
 * ```
 */
export function getAnnotations(state: unknown): Annotations | undefined {
  if (state == null || typeof state !== "object") {
    return undefined;
  }
  const stateObj = state as Record<symbol, unknown>;
  const annotations = stateObj[annotationKey];
  if (annotations != null && typeof annotations === "object") {
    return annotations as Annotations;
  }
  return undefined;
}

/**
 * Propagates annotations from one parser state to another.
 *
 * This is mainly used by parsers that rebuild array states with spread syntax.
 * Array spread copies elements but drops custom symbol properties, so we need
 * to reattach annotations explicitly when present.
 *
 * @param source The original state that may carry annotations.
 * @param target The new state to receive annotations.
 * @returns The target state, with annotations copied when available.
 * @internal
 */
export function inheritAnnotations<T>(source: unknown, target: T): T {
  if (target == null || typeof target !== "object") {
    return target;
  }
  const annotations = getAnnotations(source);
  if (annotations === undefined) {
    return target;
  }
  (target as T & { [annotationKey]?: Annotations })[annotationKey] =
    annotations;
  return target;
}

/**
 * Injects annotations into parser state while preserving state shape.
 *
 * - Primitive, null, and undefined states are wrapped with internal metadata.
 * - Array states are cloned and annotated without mutating the original.
 * - Object states are shallow-cloned with annotations attached.
 *
 * @param state The parser state to annotate.
 * @param annotations The annotations to inject.
 * @returns Annotated state.
 * @internal
 */
export function injectAnnotations<TState>(
  state: TState,
  annotations: Annotations,
): TState {
  if (state == null || typeof state !== "object") {
    return {
      [annotationKey]: annotations,
      [annotationStateValueKey]: state,
      [annotationWrapperKey]: true,
    } as TState;
  }
  if (Array.isArray(state)) {
    const cloned = [...state];
    (cloned as typeof cloned & { [annotationKey]?: Annotations })[
      annotationKey
    ] = annotations;
    return cloned as TState;
  }
  return {
    ...(state as Record<PropertyKey, unknown>),
    [annotationKey]: annotations,
  } as TState;
}
