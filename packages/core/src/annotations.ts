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
 * Internal marker attached during the first pass of `runWith()` so wrappers
 * with side effects can defer work until dynamic contexts have resolved.
 *
 * @internal
 */
export const firstPassAnnotationKey: unique symbol = Symbol.for(
  "@optique/core/parser/firstPass",
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
 * Internal symbol keys that define Optique's primitive-state annotation
 * wrapper shape.
 * @internal
 */
const annotationWrapperKeys: ReadonlySet<PropertyKey> = new Set<
  PropertyKey
>([
  annotationKey,
  annotationStateValueKey,
  annotationWrapperKey,
]);

const injectedAnnotationWrappers = new WeakSet<object>();

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
 * Reattaches annotations to a freshly created array state.
 *
 * Array spread copies elements but drops symbol properties, so parsers that
 * rebuild array states need to copy annotations back explicitly.
 *
 * @param source The original state that may carry annotations.
 * @param target The freshly created array state.
 * @returns The target array, with annotations copied when available.
 * @internal
 */
export function annotateFreshArray<T>(
  source: unknown,
  target: readonly T[],
): readonly T[] {
  const annotations = getAnnotations(source);
  if (annotations === undefined) {
    return target;
  }
  const annotated = target as readonly T[] & { [annotationKey]?: Annotations };
  annotated[annotationKey] = annotations;
  return annotated as readonly T[];
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
  const annotations = getAnnotations(source);
  if (annotations === undefined) {
    return target;
  }
  if (target == null || typeof target !== "object") {
    return injectAnnotations(target, annotations);
  }
  if (isInjectedAnnotationWrapper(target)) {
    return injectAnnotations(target, annotations);
  }
  if (Array.isArray(target)) {
    const cloned = [...target];
    (cloned as typeof cloned & { [annotationKey]?: Annotations })[
      annotationKey
    ] = annotations;
    return cloned as T;
  }
  if (target instanceof Date) {
    const cloned = new Date(target.getTime()) as Date & {
      [annotationKey]?: Annotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as T;
  }
  if (target instanceof Map) {
    const cloned = new Map(target) as Map<unknown, unknown> & {
      [annotationKey]?: Annotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as T;
  }
  if (target instanceof Set) {
    const cloned = new Set(target) as Set<unknown> & {
      [annotationKey]?: Annotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as T;
  }
  if (target instanceof RegExp) {
    const cloned = new RegExp(target) as RegExp & {
      [annotationKey]?: Annotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as T;
  }
  if (
    Object.getPrototypeOf(target) !== Object.prototype &&
    Object.getPrototypeOf(target) !== null
  ) {
    // Avoid mutating non-plain objects because they may be shared parser
    // initialState values, which can leak annotations across runs.
    return target;
  }
  const cloned = Object.create(
    Object.getPrototypeOf(target),
    Object.getOwnPropertyDescriptors(target),
  ) as T & { [annotationKey]?: Annotations };
  cloned[annotationKey] = annotations;
  return cloned;
}

/**
 * Injects annotations into parser state while preserving state shape.
 *
 * - Primitive, null, and undefined states are wrapped with internal metadata.
 * - Array states are cloned and annotated without mutating the original.
 * - Plain object states are shallow-cloned with annotations attached.
 * - Built-in object states (Date/Map/Set/RegExp) are cloned by constructor.
 * - Other non-plain object states are cloned via prototype/descriptors.
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
    const wrapper: Record<PropertyKey, unknown> = {};
    Object.defineProperties(wrapper, {
      [annotationKey]: {
        value: annotations,
        enumerable: true,
        writable: true,
        configurable: true,
      },
      // Internal wrapper markers should not be copied by object spread.
      [annotationStateValueKey]: {
        value: state,
        enumerable: false,
        writable: true,
        configurable: true,
      },
      [annotationWrapperKey]: {
        value: true,
        enumerable: false,
        writable: true,
        configurable: true,
      },
    });
    injectedAnnotationWrappers.add(wrapper);
    return wrapper as TState;
  }
  if (Array.isArray(state)) {
    const cloned = [...state];
    (cloned as typeof cloned & { [annotationKey]?: Annotations })[
      annotationKey
    ] = annotations;
    return cloned as TState;
  }
  if (isInjectedAnnotationWrapper(state)) {
    (
      state as TState & {
        [annotationKey]?: Annotations;
      }
    )[annotationKey] = annotations;
    return state;
  }
  if (state instanceof Date) {
    const cloned = new Date(state.getTime()) as Date & {
      [annotationKey]?: Annotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as TState;
  }
  if (state instanceof Map) {
    const cloned = new Map(state) as Map<unknown, unknown> & {
      [annotationKey]?: Annotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as TState;
  }
  if (state instanceof Set) {
    const cloned = new Set(state) as Set<unknown> & {
      [annotationKey]?: Annotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as TState;
  }
  if (state instanceof RegExp) {
    const cloned = new RegExp(state) as RegExp & {
      [annotationKey]?: Annotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as TState;
  }
  const proto = Object.getPrototypeOf(state);
  if (proto === Object.prototype || proto === null) {
    return {
      ...(state as Record<PropertyKey, unknown>),
      [annotationKey]: annotations,
    } as TState;
  }
  const cloned = Object.create(
    proto,
    Object.getOwnPropertyDescriptors(state as Record<PropertyKey, unknown>),
  ) as TState & { [annotationKey]?: Annotations };
  cloned[annotationKey] = annotations;
  return cloned;
}

/**
 * Unwraps a primitive-state annotation wrapper injected by Optique internals.
 *
 * @param value Value to potentially unwrap.
 * @returns The unwrapped primitive value when the input is an injected wrapper;
 *          otherwise the original value.
 * @internal
 */
export function unwrapInjectedAnnotationWrapper<T>(value: T): T {
  if (value == null || typeof value !== "object") {
    return value;
  }
  const valueRecord = value as Record<PropertyKey, unknown>;
  if (valueRecord[annotationWrapperKey] !== true) {
    return value;
  }
  const ownKeys = Reflect.ownKeys(valueRecord);
  if (
    ownKeys.length === 3 &&
    ownKeys.every((key) => annotationWrapperKeys.has(key)) &&
    isInjectedAnnotationWrapper(value)
  ) {
    return valueRecord[annotationStateValueKey] as T;
  }
  return value;
}

/**
 * Returns whether the given value is an internal primitive-state annotation
 * wrapper that was injected by Optique.
 *
 * @param value Value to check.
 * @returns `true` if the value is an injected internal wrapper.
 * @internal
 */
export function isInjectedAnnotationWrapper(value: unknown): boolean {
  return value != null &&
    typeof value === "object" &&
    injectedAnnotationWrappers.has(value);
}
