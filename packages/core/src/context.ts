/**
 * Source context system for composable data sources.
 *
 * This module provides the SourceContext interface that allows packages to
 * provide data sources (environment variables, config files, etc.) in a
 * standard way with clear priority ordering and explicit single-pass /
 * two-pass execution.
 *
 * @module
 * @since 0.10.0
 */

import type { Annotations } from "./annotations.ts";

export type { Annotations } from "./annotations.ts";

/**
 * Declares whether a {@link SourceContext} participates only in the initial
 * annotation collection (`"single-pass"`) or is recollected after a usable
 * first parse pass (`"two-pass"`).
 *
 * Used as the type of the required `phase` field on {@link SourceContext}.
 *
 * @since 1.0.0
 */
export type SourceContextPhase = "single-pass" | "two-pass";

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
 * Source contexts are used to inject external data (like environment
 * variables or config files) into the parsing process. They can be either:
 *
 * - *Single-pass*: The runner collects annotations once before parsing
 *   (e.g., environment variables)
 * - *Two-pass*: The runner collects annotations before parsing and then
 *   recollects them after a usable first parse pass (e.g., config files whose
 *   path is determined by a CLI option)
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
 * // Single-pass context example (environment variables)
 * const envContext: SourceContext = {
 *   id: Symbol.for("@myapp/env"),
 *   phase: "single-pass",
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
 * // Two-pass context that requires options from runWith()
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
   * that consume this context's data.  Passing multiple contexts with the
   * same id to {@link runWith}, {@link runWithSync}, or {@link runWithAsync}
   * throws a `TypeError`.
   */
  readonly id: symbol;

  /**
   * Type-level marker for the required options. Not used at runtime.
   * @internal
   */
  readonly $requiredOptions?: TRequiredOptions;

  /**
   * Declares whether this context is collected once or recollected after a
   * usable first parse pass.
   *
   * `single-pass` contexts contribute only their phase-1 annotations to the
   * final parse. `two-pass` contexts are called again with the first-pass
   * parsed value (or a best-effort seed extracted from parser state) and that
   * second return value becomes the context's final annotation snapshot.
   *
   * @since 1.0.0
   */
  readonly phase: SourceContextPhase;

  /**
   * Get annotations to inject into parsing.
   *
   * This method is called during phase 1 for every context and during phase 2
   * only for `two-pass` contexts:
   *
   * 1. *Phase 1*: `parsed` is `undefined`.
   * 2. *Phase 2*: `parsed` contains the first pass result, or a best-effort
   *    partial value extracted from parser state when the first pass reached a
   *    usable intermediate state but still did not complete successfully.
   *    Deferred or otherwise unresolved fields may be `undefined`. This
   *    second return value is treated as the context's final annotation
   *    snapshot for the second parse pass, replacing that context's phase-one
   *    contribution. If the runner cannot extract a usable value at all, this
   *    second call is skipped and the original parse failure is reported
   *    instead.
   *
   * @param parsed Optional parsed result from a previous parse pass.
   *               `single-pass` contexts can ignore this parameter.
   *               `two-pass` contexts use this to extract or refine data.
   * @param options Optional context-required options provided by the caller
   *               of `runWith()`. These are the options declared via the
   *               `TRequiredOptions` type parameter.
   * @returns Annotations to merge into the parsing session. During phase 2,
   *          returning `{}` clears any annotations this context contributed
   *          during phase 1. Can be a Promise for async operations (e.g.,
   *          loading config files).
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
