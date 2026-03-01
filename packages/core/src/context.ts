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
   * Optional declaration of whether this context is static.
   *
   * When present, {@link isStaticContext} reads this field directly instead
   * of calling {@link getAnnotations}, avoiding any side effects that
   * `getAnnotations` might have (such as mutating a global registry).
   *
   * - `true`: the context always returns non-empty annotations synchronously.
   * - `false`: the context is dynamic (depends on a prior parse pass).
   *
   * If omitted, {@link isStaticContext} falls back to calling
   * `getAnnotations()` with no arguments to determine static-ness.
   *
   * @since 1.0.0
   */
  readonly isStatic?: boolean;

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
   * Optional synchronous cleanup method.  Called by `runWith()` and
   * `runWithSync()` in a `finally` block after parsing completes.
   */
  [Symbol.dispose]?(): void;

  /**
   * Optional asynchronous cleanup method.  Called by `runWith()` in a
   * `finally` block after parsing completes.  Takes precedence over
   * `[Symbol.dispose]` in async runners.
   */
  [Symbol.asyncDispose]?(): void | PromiseLike<void>;
}

/**
 * Checks whether a context is static (returns annotations without needing
 * parsed results).
 *
 * A context is considered static if `getAnnotations()` called without
 * arguments returns a non-empty annotations object synchronously.
 *
 * @param context The source context to check.
 * @returns `true` if the context is static, `false` otherwise.
 * @since 0.10.0
 */
export function isStaticContext(context: SourceContext<unknown>): boolean {
  // If the context explicitly declares its static-ness, use that directly
  // to avoid calling getAnnotations() and triggering any side effects it
  // might have (e.g. mutating a global registry as EnvContext does).
  if (context.isStatic !== undefined) {
    return context.isStatic;
  }

  const result = context.getAnnotations();
  if (result instanceof Promise) {
    return false;
  }
  return Object.getOwnPropertySymbols(result).length > 0;
}
