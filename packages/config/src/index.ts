/**
 * Configuration file support for Optique with Standard Schema validation.
 *
 * This module provides functions to create configuration contexts and bind
 * parsers to configuration values with automatic fallback handling.
 *
 * @module
 * @since 0.10.0
 */

import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  Annotations,
  ParserValuePlaceholder,
  SourceContext,
} from "@optique/core/context";
import type {
  ModeValue,
  Parser,
  ParserResult,
  Result,
} from "@optique/core/parser";
import type { ValueParserResult } from "@optique/core/valueparser";
import { annotationKey, getAnnotations } from "@optique/core/annotations";
import { message } from "@optique/core/message";

/**
 * Unique symbol for config data in annotations.
 * @since 0.10.0
 */
export const configKey: unique symbol = Symbol.for("@optique/config");

/**
 * Unique symbol for config metadata in annotations.
 * @since 1.0.0
 */
export const configMetaKey: unique symbol = Symbol.for("@optique/config/meta");

/**
 * Metadata about the loaded config source.
 *
 * @since 1.0.0
 */
export interface ConfigMeta {
  /**
   * Directory containing the config file.
   */
  readonly configDir: string;

  /**
   * Absolute path to the config file.
   */
  readonly configPath: string;
}

/**
 * Internal registry for active config data during runWithConfig execution.
 * This is a workaround for the limitation that object() doesn't propagate
 * annotations to child field parsers.
 * @internal
 */
const activeConfigRegistry: Map<symbol, unknown> = new Map();

/**
 * Internal registry for active config metadata during runWithConfig execution.
 * @internal
 */
const activeConfigMetaRegistry: Map<symbol, unknown> = new Map();

/**
 * Sets active config data for a context.
 * @internal
 */
export function setActiveConfig<T>(contextId: symbol, data: T): void {
  activeConfigRegistry.set(contextId, data);
}

/**
 * Gets active config data for a context.
 * @internal
 */
export function getActiveConfig<T>(contextId: symbol): T | undefined {
  return activeConfigRegistry.get(contextId) as T | undefined;
}

/**
 * Clears active config data for a context.
 * @internal
 */
export function clearActiveConfig(contextId: symbol): void {
  activeConfigRegistry.delete(contextId);
}

/**
 * Sets active config metadata for a context.
 * @internal
 */
export function setActiveConfigMeta<T>(contextId: symbol, meta: T): void {
  activeConfigMetaRegistry.set(contextId, meta);
}

/**
 * Gets active config metadata for a context.
 * @internal
 */
export function getActiveConfigMeta<T>(contextId: symbol): T | undefined {
  return activeConfigMetaRegistry.get(contextId) as T | undefined;
}

/**
 * Clears active config metadata for a context.
 * @internal
 */
export function clearActiveConfigMeta(contextId: symbol): void {
  activeConfigMetaRegistry.delete(contextId);
}

/**
 * Options for creating a config context.
 *
 * @template T The output type of the config schema.
 * @since 0.10.0
 */
export interface ConfigContextOptions<T> {
  /**
   * Standard Schema validator for the config file.
   * Accepts any Standard Schema-compatible library (Zod, Valibot, ArkType, etc.).
   */
  readonly schema: StandardSchemaV1<unknown, T>;
}

/**
 * Required options for ConfigContext when used with runWith().
 * The `ParserValuePlaceholder` will be substituted with the actual parser
 * result type by runWith().
 *
 * @since 0.10.0
 */
export interface ConfigContextRequiredOptions {
  /**
   * Function to extract config file path from parsed CLI arguments.
   * The `parsed` parameter is typed as the parser's result type.
   *
   * @param parsed The parsed CLI arguments (typed from parser).
   * @returns The config file path, or undefined if not specified.
   */
  readonly getConfigPath: (
    parsed: ParserValuePlaceholder,
  ) => string | undefined;
}

/**
 * A config context that provides configuration data via annotations.
 *
 * When used with `runWith()`, the options must include `getConfigPath` with
 * the correct parser result type. The `ParserValuePlaceholder` in
 * `ConfigContextRequiredOptions` is substituted with the actual parser type.
 *
 * @template T The validated config data type.
 * @since 0.10.0
 */
export interface ConfigContext<T, TConfigMeta = ConfigMeta>
  extends SourceContext<ConfigContextRequiredOptions> {
  /**
   * The Standard Schema validator for the config file.
   */
  readonly schema: StandardSchemaV1<unknown, T>;
}

/**
 * Creates a config context for use with Optique parsers.
 *
 * The config context implements the SourceContext interface and can be used
 * with runWith() or runWithConfig() to provide configuration file support.
 *
 * @template T The output type of the config schema.
 * @template TConfigMeta The metadata type for config sources.
 * @param options Configuration options including schema and optional parser.
 * @returns A config context that can be used with bindConfig() and runWithConfig().
 * @since 0.10.0
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { createConfigContext } from "@optique/config";
 *
 * const schema = z.object({
 *   host: z.string(),
 *   port: z.number(),
 * });
 *
 * const configContext = createConfigContext({ schema });
 * ```
 */
export function createConfigContext<T, TConfigMeta = ConfigMeta>(
  options: ConfigContextOptions<T>,
): ConfigContext<T, TConfigMeta> {
  // Create a unique ID for this context instance
  const contextId = Symbol.for(`@optique/config:${Math.random()}`);

  return {
    id: contextId,
    schema: options.schema,

    getAnnotations(parsed?: unknown): Annotations {
      // Static contexts return empty on first call (without parsed)
      // Dynamic contexts load config based on parsed result
      if (!parsed) {
        return {};
      }

      // This will be populated by runWithConfig
      return {};
    },
  };
}

/**
 * Options for binding a parser to config values.
 *
 * @template T The config data type.
 * @template TValue The value type extracted from config.
 * @since 0.10.0
 */
export interface BindConfigOptions<T, TValue, TConfigMeta = ConfigMeta> {
  /**
   * The config context to use for fallback values.
   */
  readonly context: ConfigContext<T, TConfigMeta>;

  /**
   * Key or accessor function to extract the value from config.
   * Can be a property key (for top-level config values) or a function
   * that extracts nested values. Accessor callbacks receive config metadata
   * as the second argument.
   */
  readonly key: keyof T | ((config: T, meta: TConfigMeta) => TValue);

  /**
   * Default value to use when neither CLI nor config provides a value.
   * If not specified, the parser will fail when no value is available.
   */
  readonly default?: TValue;
}

/**
 * Binds a parser to configuration values with fallback priority.
 *
 * The binding implements the following priority order:
 * 1. CLI argument (if provided)
 * 2. Config file value (if available)
 * 3. Default value (if specified)
 * 4. Error (if none of the above)
 *
 * @template M The parser mode (sync or async).
 * @template TValue The parser value type.
 * @template TState The parser state type.
 * @template T The config data type.
 * @param parser The parser to bind to config values.
 * @param options Binding options including context, key, and default.
 * @returns A new parser with config fallback behavior.
 * @since 0.10.0
 *
 * @example
 * ```typescript
 * import { bindConfig } from "@optique/config";
 * import { option } from "@optique/core/primitives";
 * import { string } from "@optique/core/valueparser";
 *
 * const hostParser = bindConfig(option("--host", string()), {
 *   context: configContext,
 *   key: "host",
 *   default: "localhost",
 * });
 * ```
 */
export function bindConfig<
  M extends "sync" | "async",
  TValue,
  TState,
  T,
  TConfigMeta = ConfigMeta,
>(
  parser: Parser<M, TValue, TState>,
  options: BindConfigOptions<T, TValue, TConfigMeta>,
): Parser<M, TValue, TState> {
  type ConfigBindState = { hasCliValue: boolean; cliState?: TState };

  return {
    $mode: parser.$mode,
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    usage: options.default !== undefined
      ? [{ type: "optional", terms: parser.usage }]
      : parser.usage,
    initialState: parser.initialState,

    parse: (context) => {
      // Extract annotations from context to preserve them
      const annotations = getAnnotations(context.state);

      // Try parsing with the inner parser
      const result = parser.parse(context);

      // For sync mode
      if (!(result instanceof Promise)) {
        if (result.success) {
          // CLI value provided - store the next state for complete phase
          const newState = {
            hasCliValue: true,
            cliState: result.next.state,
            ...(annotations && { [annotationKey]: annotations }),
          } as unknown as TState;

          return {
            success: true,
            next: { ...result.next, state: newState },
            consumed: result.consumed,
          } as ModeValue<M, ParserResult<TState>>;
        }

        // No CLI value, return success with empty state but preserve annotations
        const newState = {
          hasCliValue: false,
          ...(annotations && { [annotationKey]: annotations }),
        } as unknown as TState;
        return {
          success: true,
          next: { ...context, state: newState },
          consumed: [],
        } as unknown as ModeValue<M, ParserResult<TState>>;
      }

      // For async mode
      return result.then((res) => {
        if (res.success) {
          const newState = {
            hasCliValue: true,
            cliState: res.next.state,
            ...(annotations && { [annotationKey]: annotations }),
          } as unknown as TState;

          return {
            success: true,
            next: { ...res.next, state: newState },
            consumed: res.consumed,
          };
        }

        const newState = {
          hasCliValue: false,
          ...(annotations && { [annotationKey]: annotations }),
        } as unknown as TState;
        return {
          success: true,
          next: { ...context, state: newState },
          consumed: [],
        };
      }) as ModeValue<M, ParserResult<TState>>;
    },

    complete: (state) => {
      const bindState = state as unknown as ConfigBindState;

      // Check if we have a CLI value from parse phase
      if (bindState?.hasCliValue && bindState.cliState !== undefined) {
        // Use the inner parser's complete to get the CLI value
        const innerResult = parser.complete(bindState.cliState);

        if (innerResult instanceof Promise) {
          return innerResult.then((res) => {
            if (res.success) {
              return { success: true, value: res.value };
            }
            // CLI value was provided but invalid, so preserve the CLI error.
            return res;
          }) as ModeValue<M, ValueParserResult<TValue>>;
        }

        if (innerResult.success) {
          return { success: true, value: innerResult.value } as ModeValue<
            M,
            ValueParserResult<TValue>
          >;
        }
        // CLI value was provided but invalid, so preserve the CLI error.
        return innerResult as ModeValue<
          M,
          ValueParserResult<TValue>
        >;
      }

      // No CLI value, check config
      return getConfigOrDefault(state, options) as ModeValue<
        M,
        ValueParserResult<TValue>
      >;
    },

    suggest: parser.suggest,
    getDocFragments(state, upperDefaultValue?) {
      const defaultValue = upperDefaultValue ?? options.default;
      return parser.getDocFragments(state, defaultValue);
    },
  };
}

/**
 * Helper function to get value from config or default.
 * Checks both annotations (for top-level parsers) and the active config
 * registry (for parsers nested inside object() when used with runWithConfig).
 */
function getConfigOrDefault<T, TValue, TConfigMeta>(
  state: unknown,
  options: BindConfigOptions<T, TValue, TConfigMeta>,
): Result<TValue> {
  // First, try to get config from annotations (works for top-level parsers)
  const annotations = getAnnotations(state);
  let configData = annotations?.[configKey] as T | undefined;
  let configMeta = annotations?.[configMetaKey] as TConfigMeta | undefined;

  // If not found in annotations, check the active config registry
  // (this handles the case when used inside object() with runWithConfig)
  if (configData === undefined || configData === null) {
    const contextId = options.context.id;
    configData = getActiveConfig<T>(contextId);
    configMeta = getActiveConfigMeta<TConfigMeta>(contextId);
  }

  let configValue: TValue | undefined;

  if (configData !== undefined && configData !== null) {
    // Extract value from config
    if (typeof options.key === "function") {
      try {
        configValue = options.key(configData, configMeta as TConfigMeta);
      } catch {
        configValue = undefined;
      }
    } else {
      configValue = configData[options.key] as TValue;
    }
  }

  // Priority: config > default
  if (configValue !== undefined) {
    return { success: true, value: configValue };
  }

  if (options.default !== undefined) {
    return { success: true, value: options.default };
  }

  // No value available
  return {
    success: false,
    error: message`Missing required configuration value.`,
  };
}
