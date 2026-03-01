/**
 * Configuration file support for Optique with Standard Schema validation.
 *
 * This module provides functions to create configuration contexts and bind
 * parsers to configuration values with automatic fallback handling.
 *
 * @module
 * @since 0.10.0
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
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
 * Internal registry for active config data during config context execution.
 * This is a workaround for the limitation that object() doesn't propagate
 * annotations to child field parsers.
 * @internal
 */
const activeConfigRegistry: Map<symbol, unknown> = new Map();

/**
 * Internal registry for active config metadata during config context execution.
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

  /**
   * Custom parser function for reading config file contents.
   * If not provided, defaults to JSON.parse.
   *
   * This option is only used in single-file mode (with `getConfigPath`).
   * When using the `load` callback, file parsing is handled by the loader.
   *
   * @param contents The raw file contents as Uint8Array.
   * @returns The parsed config data (will be validated by schema).
   * @since 1.0.0
   */
  readonly fileParser?: (contents: Uint8Array) => unknown;
}

/**
 * Result type for custom config loading.
 *
 * @template TConfigMeta Metadata type associated with loaded config data.
 * @since 1.0.0
 */
export interface ConfigLoadResult<TConfigMeta = ConfigMeta> {
  /**
   * Raw config data to validate against the schema.
   */
  readonly config: unknown;

  /**
   * Metadata about where the config came from.
   */
  readonly meta: TConfigMeta;
}

/**
 * Required options for ConfigContext when used with `runWith()` or `run()`.
 * The `ParserValuePlaceholder` will be substituted with the actual parser
 * result type by `runWith()`.
 *
 * Provide *either* `getConfigPath` (single-file mode) *or* `load` (custom
 * multi-file mode).  At least one must be provided; a runtime error is
 * thrown otherwise.
 *
 * @template TConfigMeta Metadata type for config sources.
 * @since 0.10.0
 */
export interface ConfigContextRequiredOptions<TConfigMeta = ConfigMeta> {
  /**
   * Function to extract config file path from parsed CLI arguments.
   * Used in single-file mode.  The `parsed` parameter is typed as the
   * parser's result type.
   *
   * @param parsed The parsed CLI arguments (typed from parser).
   * @returns The config file path, or undefined if not specified.
   */
  readonly getConfigPath?: (
    parsed: ParserValuePlaceholder,
  ) => string | undefined;

  /**
   * Custom loader function that receives the first-pass parse result and
   * returns the config data (or a Promise of it).  This allows full control
   * over file discovery, loading, merging, and error handling.
   *
   * The returned data will be validated against the schema.
   *
   * When `load` is provided, `getConfigPath` is ignored.
   *
   * @param parsed The result from the first parse pass.
   * @returns Config data and metadata (config is validated by schema).
   * @since 1.0.0
   */
  readonly load?: (
    parsed: ParserValuePlaceholder,
  ) =>
    | Promise<ConfigLoadResult<TConfigMeta>>
    | ConfigLoadResult<TConfigMeta>;
}

/**
 * A config context that provides configuration data via annotations.
 *
 * When used with `runWith()` or `run()`, the options must include either
 * `getConfigPath` or `load` with the correct parser result type.  The
 * `ParserValuePlaceholder` in `ConfigContextRequiredOptions` is substituted
 * with the actual parser type.
 *
 * @template T The validated config data type.
 * @template TConfigMeta Metadata type for config sources.
 * @since 0.10.0
 */
export interface ConfigContext<T, TConfigMeta = ConfigMeta>
  extends SourceContext<ConfigContextRequiredOptions<TConfigMeta>> {
  /**
   * The Standard Schema validator for the config file.
   */
  readonly schema: StandardSchemaV1<unknown, T>;
}

function isErrnoException(
  error: unknown,
): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

/**
 * Validates raw data against a Standard Schema and returns the validated value.
 * @internal
 */
async function validateWithSchema<T>(
  schema: StandardSchemaV1<unknown, T>,
  rawData: unknown,
): Promise<T> {
  const validation = schema["~standard"].validate(rawData);
  const validationResult = validation instanceof Promise
    ? await validation
    : validation;

  if (validationResult.issues) {
    const firstIssue = validationResult.issues[0];
    throw new Error(
      `Config validation failed: ${firstIssue?.message ?? "Unknown error"}`,
    );
  }

  return validationResult.value as T;
}

/**
 * Creates a config context for use with Optique parsers.
 *
 * The config context implements the `SourceContext` interface and can be used
 * with `runWith()` from *@optique/core* or `run()`/`runAsync()` from
 * *@optique/run* to provide configuration file support.
 *
 * @template T The output type of the config schema.
 * @template TConfigMeta The metadata type for config sources.
 * @param options Configuration options including schema and optional file
 *   parser.
 * @returns A config context that can be used with `bindConfig()` and runners.
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
  const contextId = Symbol(`@optique/config:${Math.random()}`);

  return {
    id: contextId,
    schema: options.schema,

    async getAnnotations(
      parsed?: unknown,
      runtimeOptions?: unknown,
    ): Promise<Annotations> {
      // Phase 1 (no parsed result): return empty — this is a dynamic context
      if (!parsed) {
        return {};
      }

      const opts = runtimeOptions as
        | ConfigContextRequiredOptions<TConfigMeta>
        | undefined;
      if (!opts || (!opts.getConfigPath && !opts.load)) {
        throw new TypeError(
          "Either getConfigPath or load must be provided " +
            "in the runner options when using ConfigContext.",
        );
      }

      let configData: T | undefined;
      let configMeta: TConfigMeta | undefined;

      // At runtime, `parsed` is the actual parser value.  The
      // ParserValuePlaceholder brand is compile-time only.
      const parsedValue = parsed as ParserValuePlaceholder;

      if (opts.load) {
        // Custom load mode
        const loaded = await Promise.resolve(opts.load(parsedValue));
        configData = await validateWithSchema(options.schema, loaded.config);
        configMeta = loaded.meta;
      } else if (opts.getConfigPath) {
        // Single-file mode
        const configPath = opts.getConfigPath(parsedValue);

        if (configPath) {
          const absoluteConfigPath = resolvePath(configPath);
          const singleFileMeta: ConfigMeta = {
            configDir: dirname(absoluteConfigPath),
            configPath: absoluteConfigPath,
          };

          try {
            const contents = await readFile(absoluteConfigPath);

            // Parse file contents
            let rawData: unknown;
            if (options.fileParser) {
              rawData = options.fileParser(contents);
            } else {
              // Default to JSON
              const text = new TextDecoder().decode(contents);
              rawData = JSON.parse(text);
            }

            configData = await validateWithSchema(options.schema, rawData);
            configMeta = singleFileMeta as TConfigMeta;
          } catch (error) {
            // Missing config file is optional in single-file mode.
            if (isErrnoException(error) && error.code === "ENOENT") {
              configData = undefined;
            } else if (error instanceof SyntaxError) {
              throw new Error(
                `Failed to parse config file ` +
                  `${absoluteConfigPath}: ${error.message}`,
              );
            } else {
              throw error;
            }
          }
        }
      }

      // Set active config in registry for nested parsers inside object()
      if (configData !== undefined && configData !== null) {
        setActiveConfig(contextId, configData);
        // Use the per-instance contextId as the annotation key so that
        // multiple ConfigContext instances can coexist without overwriting
        // each other during mergeAnnotations().  Data and metadata are
        // stored together under a single key.
        // See: https://github.com/dahlia/optique/issues/136
        if (configMeta !== undefined) {
          setActiveConfigMeta(contextId, configMeta);
          return {
            [contextId]: { data: configData, meta: configMeta },
          };
        }

        return { [contextId]: { data: configData } };
      }

      return {};
    },

    [Symbol.dispose]() {
      clearActiveConfig(contextId);
      clearActiveConfigMeta(contextId);
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
 * registry (for parsers nested inside object() when used with context-aware
 * runners).
 */
function getConfigOrDefault<T, TValue, TConfigMeta>(
  state: unknown,
  options: BindConfigOptions<T, TValue, TConfigMeta>,
): Result<TValue> {
  // First, try to get config from annotations (works for top-level parsers).
  // Read from the per-instance context id so that the correct config data is
  // selected even when annotations from multiple config contexts are merged.
  // See: https://github.com/dahlia/optique/issues/136
  const annotations = getAnnotations(state);
  const contextId = options.context.id;
  const annotationValue = annotations?.[contextId] as
    | { readonly data: T; readonly meta?: TConfigMeta }
    | undefined;
  let configData = annotationValue?.data;
  let configMeta = annotationValue?.meta;

  // If not found in annotations, check the active config registry
  // (this handles the case when used inside object() with context-aware runners)
  if (configData === undefined || configData === null) {
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
