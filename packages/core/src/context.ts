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
 * A source context that can provide data to parsers via annotations.
 *
 * Source contexts are used to inject external data (like environment variables
 * or config files) into the parsing process. They can be either:
 *
 * - *Static*: Data is immediately available (e.g., environment variables)
 * - *Dynamic*: Data depends on parsing results (e.g., config files whose path
 *   is determined by a CLI option)
 *
 * @example
 * ```typescript
 * // Static context example (environment variables)
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
 * // Dynamic context example (config file)
 * const configContext: SourceContext = {
 *   id: Symbol.for("@myapp/config"),
 *   async getAnnotations(parsed?: unknown) {
 *     if (!parsed) return {}; // Return empty on first pass
 *     const result = parsed as { config?: string };
 *     if (!result.config) return {};
 *     const data = await loadConfigFile(result.config);
 *     return {
 *       [Symbol.for("@myapp/config")]: data
 *     };
 *   }
 * };
 * ```
 *
 * @since 0.10.0
 */
export interface SourceContext {
  /**
   * Unique identifier for this context.
   *
   * This symbol is typically the same as the annotation key used by parsers
   * that consume this context's data.
   */
  readonly id: symbol;

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
   * @returns Annotations to merge into the parsing session. Can be a Promise
   *          for async operations (e.g., loading config files).
   */
  getAnnotations(parsed?: unknown): Promise<Annotations> | Annotations;
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
export function isStaticContext(context: SourceContext): boolean {
  const result = context.getAnnotations();
  if (result instanceof Promise) {
    return false;
  }
  return Object.getOwnPropertySymbols(result).length > 0;
}
