/**
 * Source context system for composable data sources.
 *
 * This module provides the SourceContext interface that allows packages to
 * provide data sources (environment variables, config files, etc.) in a
 * standard way with clear priority ordering and automatic static/dynamic
 * optimization.
 *
 * @module
 * @since 0.10.0
 */

import type { Annotations } from "./annotations.ts";

export type { Annotations } from "./annotations.ts";

/**
 * Declares whether a {@link SourceContext} provides its annotations
 * immediately (`"static"`) or only after a prior parse pass (`"dynamic"`).
 *
 * Used as the type of the optional `mode` field on {@link SourceContext}.
 * When set, {@link isStaticContext} reads this value directly instead of
 * calling `getAnnotations()`, preventing any side effects.
 *
 * @since 1.0.0
 */
export type SourceContextMode = "static" | "dynamic";

/**
 * Brand symbol for ParserValuePlaceholder type.
 * @internal
 */
declare const parserValuePlaceholderBrand: unique symbol;

/**
 * A placeholder type that represents the parser's result value type.
 *
 * Use this type in `SourceContext<TRequiredOptions>` when the required options
 * depend on the parser's result type. The `runWith()` function will substitute
 * this placeholder with the actual parser value type at call site.
 *
 * @example
 * ```typescript
 * import type { SourceContext, ParserValuePlaceholder } from "@optique/core/context";
 *
 * // Define a context that requires options depending on parser result
 * interface MyContext extends SourceContext<{
 *   extractPath: (parsed: ParserValuePlaceholder) => string | undefined;
 * }> {
 *   // ...
 * }
 *
 * // When used with runWith(), the placeholder becomes the actual parser type:
 * // runWith(parser, "app", [myContext], {
 * //   extractPath: (parsed) => parsed.configPath  // 'parsed' is typed!
 * // });
 * ```
 *
 * @since 0.10.0
 */
export type ParserValuePlaceholder = {
  readonly [parserValuePlaceholderBrand]: "ParserValuePlaceholder";
};

/**
 * A source context that can provide data to parsers via annotations.
 *
 * Source contexts are used to inject external data (like environment variables
 * or config files) into the parsing process. They can be either:
 *
 * - *Static*: Data is immediately available (e.g., environment variables)
 * - *Dynamic*: Data depends on parsing results (e.g., config files whose path
 *   is determined by a CLI option)
 *
 * Contexts may optionally implement `Disposable` or `AsyncDisposable` for
 * cleanup.  When present, `runWith()` and `runWithSync()` call the dispose
 * method in a `finally` block after parsing completes.
 *
 * @template TRequiredOptions Additional options that `runWith()` must provide
 *   when this context is used. Use `void` (the default) for contexts that
 *   don't require extra options. Use {@link ParserValuePlaceholder} in option
 *   types that depend on the parser's result type.
 *
 * @example
 * ```typescript
 * // Static context example (environment variables) - no extra options needed
 * const envContext: SourceContext = {
 *   id: Symbol.for("@myapp/env"),
 *   getAnnotations() {
 *     return {
 *       [Symbol.for("@myapp/env")]: {
 *         HOST: process.env.HOST,
 *         PORT: process.env.PORT,
 *       }
 *     };
 *   }
 * };
 *
 * // Dynamic context that requires options from runWith()
 * interface ConfigContext extends SourceContext<{
 *   getConfigPath: (parsed: ParserValuePlaceholder) => string | undefined;
 * }> {
 *   // ...
 * }
 * ```
 *
 * @since 0.10.0
 */
export interface SourceContext<TRequiredOptions = void> {
  /**
   * Unique identifier for this context.
   *
   * This symbol is typically the same as the annotation key used by parsers
   * that consume this context's data.
   */
  readonly id: symbol;

  /**
   * Type-level marker for the required options. Not used at runtime.
   * @internal
   */
  readonly $requiredOptions?: TRequiredOptions;

  /**
   * Optional declaration of whether this context is static or dynamic.
   *
   * When present, {@link isStaticContext} reads this field directly instead
   * of calling {@link getAnnotations}, avoiding any side effects that
   * `getAnnotations` might have (such as mutating a global registry).
   *
   * If omitted, {@link isStaticContext} falls back to calling
   * `getAnnotations()` with no arguments to determine static-ness.
   *
   * @since 1.0.0
   */
  readonly mode?: SourceContextMode;

  /**
   * Get annotations to inject into parsing.
   *
   * This method is called twice during `runWith()` execution:
   *
   * 1. *First call*: `parsed` is `undefined`. Static contexts should return
   *    their annotations, while dynamic contexts should return an empty object.
   * 2. *Second call*: `parsed` contains the result from the first parse pass.
   *    Dynamic contexts can use this to load external data (e.g., reading
   *    a config file whose path was determined in the first pass).
   *
   * @param parsed Optional parsed result from a previous parse pass.
   *               Static contexts can ignore this parameter.
   *               Dynamic contexts use this to extract necessary data.
   * @param options Optional context-required options provided by the caller
   *               of `runWith()`. These are the options declared via the
   *               `TRequiredOptions` type parameter.
   * @returns Annotations to merge into the parsing session. Can be a Promise
   *          for async operations (e.g., loading config files).
   */
  getAnnotations(
    parsed?: unknown,
    options?: unknown,
  ): Promise<Annotations> | Annotations;

  /**
   * Optional hook to provide additional internal annotations during
   * annotation collection.  Called after {@link getAnnotations} with the
   * same parsed value and the annotations returned by `getAnnotations()`.
   *
   * Returns additional annotations to merge, or `undefined` to add nothing.
   * This enables contexts to inject phase-specific markers without
   * exposing them through the primary `getAnnotations()` API.
   *
   * @param parsed The parsed result from a previous parse pass, or
   *               `undefined` during the first pass.
   * @param annotations The annotations returned by `getAnnotations()`.
   * @returns Additional annotations to merge, or `undefined`.
   * @since 1.0.0
   */
  getInternalAnnotations?(
    parsed: unknown,
    annotations: Annotations,
  ): Annotations | undefined;

  /**
   * Optional hook to transform the parsed value before it is passed to
   * {@link getAnnotations} during phase-2 annotation collection.
   *
   * This allows contexts to distinguish between "parsed value was
   * `undefined`" and "no parse happened yet" by wrapping `undefined`
   * values with a context-private marker.
   *
   * @param parsed The parsed value to finalize.
   * @returns The finalized parsed value.
   * @since 1.0.0
   */
  finalizeParsed?(parsed: unknown): unknown;

  /**
   * Optional synchronous cleanup method.  Called by `runWith()` and
   * `runWithSync()` in a `finally` block after parsing completes.
   */
  [Symbol.dispose]?(): void;

  /**
   * Optional asynchronous cleanup method.  Called by `runWith()` in a
   * `finally` block after parsing completes.  Takes precedence over
   * `[Symbol.dispose]` in async runners.  `runWithSync()` also calls this
   * method when `[Symbol.dispose]` is absent, but throws if it returns a
   * Promise.
   */
  [Symbol.asyncDispose]?(): void | PromiseLike<void>;
}

/**
 * Brand symbol for placeholder values.
 *
 * Placeholder values are sentinel objects that represent values to be
 * resolved later (e.g., deferred interactive prompts).  During two-phase
 * parsing, placeholder values are stripped from parsed results before they
 * are passed to phase-2 context annotation collection, and `map()`
 * transformations skip them.
 *
 * Packages that produce placeholder values should set this symbol as a
 * property on their sentinel objects:
 *
 * ~~~~ typescript
 * import { placeholder } from "@optique/core/context";
 *
 * class MyPlaceholder {
 *   readonly [placeholder] = true;
 * }
 * ~~~~
 *
 * @since 1.0.0
 */
export const placeholder: unique symbol = Symbol.for(
  "@optique/core/placeholder",
);

/**
 * Tests whether a value is a placeholder.
 *
 * Returns `true` if the value is a non-null object carrying the
 * {@link placeholder} property.
 *
 * @param value The value to test.
 * @returns `true` if the value is a placeholder.
 * @since 1.0.0
 */
export function isPlaceholderValue(value: unknown): boolean {
  return value != null &&
    typeof value === "object" &&
    placeholder in value;
}

function containsPlaceholderValuesInOwnProperties(
  value: object,
  seen: WeakSet<object>,
): boolean {
  for (const key of Reflect.ownKeys(value)) {
    if (shouldSkipCollectionOwnKey(value, key)) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor != null &&
      "value" in descriptor &&
      containsPlaceholderValues(descriptor.value, seen)
    ) {
      return true;
    }
  }
  return false;
}

function shouldSkipCollectionOwnKey(
  value: object,
  key: PropertyKey,
): boolean {
  if (Array.isArray(value)) {
    return key === "length" ||
      (typeof key === "string" &&
        Number.isInteger(Number(key)) &&
        String(Number(key)) === key);
  }
  return false;
}

/**
 * Tests whether a value recursively contains any placeholder values in its
 * own data properties, array elements, Set entries, or Map entries.
 *
 * Unlike {@link isPlaceholderValue}, which only checks whether the value
 * itself is a placeholder, this function traverses the structure of the
 * value to detect placeholders nested inside objects, arrays, Sets, and Maps.
 *
 * @param value The value to test.
 * @param seen A set of already-visited objects (for cycle detection).
 * @returns `true` if the value contains any placeholder values.
 * @since 1.0.0
 */
/**
 * Registry of objects that may contain placeholder values hidden in private
 * fields or closures.  Used by `map()` to tag transform results whose input
 * contained placeholder values, so that `containsPlaceholderValues()` returns
 * `true` even when the placeholders are not visible in own data properties.
 *
 * A `WeakSet` is used instead of stamping a symbol on the object to avoid
 * mutating caller-owned objects (which could be cached/singleton/reused).
 *
 * @internal
 * @since 1.0.0
 */
export const hiddenPlaceholderObjects: WeakSet<object> = new WeakSet();

export function containsPlaceholderValues(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
): boolean {
  if (isPlaceholderValue(value)) {
    return true;
  }
  // Check functions for hidden-placeholder registration before the
  // typeof !== "object" gate (functions are "function", not "object").
  if (
    typeof value === "function" &&
    hiddenPlaceholderObjects.has(value as object)
  ) {
    return true;
  }
  if (value == null || typeof value !== "object") {
    return false;
  }
  if (hiddenPlaceholderObjects.has(value)) {
    return true;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (
      value.some((item) => containsPlaceholderValues(item, seen))
    ) {
      return true;
    }
    return containsPlaceholderValuesInOwnProperties(value, seen);
  }
  if (value instanceof Set) {
    for (const entryValue of value) {
      if (containsPlaceholderValues(entryValue, seen)) {
        return true;
      }
    }
    return containsPlaceholderValuesInOwnProperties(value, seen);
  }
  if (value instanceof Map) {
    for (const [key, entryValue] of value) {
      if (
        containsPlaceholderValues(key, seen) ||
        containsPlaceholderValues(entryValue, seen)
      ) {
        return true;
      }
    }
    return containsPlaceholderValuesInOwnProperties(value, seen);
  }
  return containsPlaceholderValuesInOwnProperties(value, seen);
}

/**
 * Checks whether a context is static (returns annotations without needing
 * parsed results).
 *
 * A context is considered static if it declares `mode: "static"` or if
 * `getAnnotations()` called without arguments returns a non-empty
 * annotations object synchronously.
 *
 * @param context The source context to check.
 * @returns `true` if the context is static, `false` otherwise.
 * @since 0.10.0
 */
export function isStaticContext(context: SourceContext<unknown>): boolean {
  // If the context explicitly declares its static-ness, use that directly
  // to avoid calling getAnnotations() and triggering any side effects it
  // might have (e.g. mutating a global registry as EnvContext does).
  if (context.mode !== undefined) {
    return context.mode === "static";
  }

  const result = context.getAnnotations();
  if (result instanceof Promise) {
    return false;
  }
  return Object.getOwnPropertySymbols(result).length > 0;
}
