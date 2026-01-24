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
