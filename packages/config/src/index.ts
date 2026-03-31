/**
 * Configuration file support for Optique with Standard Schema validation.
 *
 * This module provides functions to create configuration contexts and bind
 * parsers to configuration values with automatic fallback handling.
 *
 * @module
 * @since 0.10.0
 */

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  Annotations,
  ParserValuePlaceholder,
  SourceContext,
} from "@optique/core/context";
import type {
  ExecutionContext,
  Parser,
  ParserResult,
  Result,
} from "@optique/core/parser";
import { annotationKey, getAnnotations } from "@optique/core/annotations";
import { message } from "@optique/core/message";
import { mapModeValue, wrapForMode } from "@optique/core/mode-dispatch";

const phase2UndefinedParsedValueKey = Symbol(
  "@optique/config/phase2UndefinedParsedValue",
);

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
const phase1ConfigAnnotationMarker = Symbol(
  "@optique/config/phase1Annotation",
);

function isPhase2UndefinedParsedValue(value: unknown): boolean {
  return value != null &&
    typeof value === "object" &&
    phase2UndefinedParsedValueKey in value;
}

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
   * Metadata about where the config came from, if available.
   */
  readonly meta: TConfigMeta | undefined;
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

function getTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value != null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (value as Record<string, unknown>).then === "function";
}

/**
 * Detects native Promises and cross-realm Promises.  Cross-realm
 * Promises fail `instanceof Promise` but still carry the spec-required
 * `Symbol.toStringTag === "Promise"`.  Domain objects that merely
 * define a `then()` method are not matched unless they also set
 * `Symbol.toStringTag` to `"Promise"`.
 */
function isPromise(value: unknown): boolean {
  if (value instanceof Promise) return true;
  if (
    value == null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  return isPromiseLike(value) &&
    (value as unknown as Record<symbol, unknown>)[Symbol.toStringTag] ===
      "Promise";
}

function validateLoadResult<TConfigMeta>(
  loaded: unknown,
): { config: unknown; meta: TConfigMeta | undefined } {
  if (loaded == null || typeof loaded !== "object" || Array.isArray(loaded)) {
    throw new TypeError(
      `Expected load() to return an object, but got: ${getTypeName(loaded)}.`,
    );
  }
  if (!("config" in loaded)) {
    throw new TypeError(
      "Expected load() result to have a config property.",
    );
  }
  const result = loaded as Record<string, unknown>;
  // Use isPromise() to catch both same-realm and cross-realm
  // Promises without rejecting domain objects that merely have a
  // then() method.
  if (isPromise(result.config)) {
    throw new TypeError(
      "Expected config in load() result to not be a Promise. " +
        "Resolve the Promise before returning.",
    );
  }
  if (isPromise(result.meta)) {
    throw new TypeError(
      "Expected meta in load() result to not be a Promise. " +
        "Resolve the Promise before returning.",
    );
  }
  return loaded as { config: unknown; meta: TConfigMeta | undefined };
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (
    value == null || (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  if (!("~standard" in value)) return false;
  const standard: unknown = (value as Record<PropertyKey, unknown>)[
    "~standard"
  ];
  if (
    standard == null ||
    (typeof standard !== "object" && typeof standard !== "function")
  ) {
    return false;
  }
  return typeof (standard as Record<string, unknown>).validate === "function";
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
function processValidationResult<T>(
  validationResult: {
    readonly issues?: readonly { readonly message?: string }[];
    readonly value?: T;
  },
): T {
  if (validationResult.issues) {
    const firstIssue = validationResult.issues[0];
    throw new Error(
      `Config validation failed: ${firstIssue?.message ?? "Unknown error"}`,
    );
  }

  return validationResult.value as T;
}

function validateWithSchema<T>(
  schema: StandardSchemaV1<unknown, T>,
  rawData: unknown,
): T | Promise<T> {
  const validation = schema["~standard"].validate(rawData);
  if (validation instanceof Promise) {
    return validation.then((result) => processValidationResult(result));
  }
  return processValidationResult(validation);
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
 * @throws {TypeError} If `schema` is not a valid Standard Schema object.
 * @throws {TypeError} If `fileParser` is provided but is not a function.
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
  // Snapshot and validate schema
  const rawSchema = options.schema;
  if (!isStandardSchema(rawSchema)) {
    throw new TypeError(
      `Expected schema to be a Standard Schema object, but got: ${
        getTypeName(rawSchema)
      }.`,
    );
  }

  // Snapshot and validate fileParser
  const rawFileParser = options.fileParser;
  if (rawFileParser !== undefined && typeof rawFileParser !== "function") {
    throw new TypeError(
      `Expected fileParser to be a function, but got: ${
        getTypeName(rawFileParser)
      }.`,
    );
  }

  // Create a unique ID for this context instance
  const contextId = Symbol(`@optique/config:${Math.random()}`);

  const context: ConfigContext<T, TConfigMeta> = {
    id: contextId,
    schema: rawSchema,
    mode: "dynamic",
    getInternalAnnotations(parsed: unknown, annotations: Annotations) {
      if (parsed === undefined) {
        return { [contextId]: phase1ConfigAnnotationMarker };
      }
      return Object.getOwnPropertySymbols(annotations).includes(contextId)
        ? undefined
        : { [contextId]: undefined };
    },
    finalizeParsed(parsed: unknown) {
      return parsed === undefined
        ? { [phase2UndefinedParsedValueKey]: true }
        : parsed;
    },

    getAnnotations(
      parsed?: unknown,
      runtimeOptions?: unknown,
    ): Promise<Annotations> | Annotations {
      // Phase 1 (no parsed result): mark the context as unresolved so
      // prompt(bindConfig(...)) can defer interactive fallback.
      if (parsed === undefined) {
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
      if (opts.load !== undefined && typeof opts.load !== "function") {
        throw new TypeError(
          `Expected load to be a function, but got: ${getTypeName(opts.load)}.`,
        );
      }
      if (
        !opts.load &&
        opts.getConfigPath !== undefined &&
        typeof opts.getConfigPath !== "function"
      ) {
        throw new TypeError(
          `Expected getConfigPath to be a function, but got: ${
            getTypeName(opts.getConfigPath)
          }.`,
        );
      }

      // At runtime, `parsed` is the actual parser value.  The
      // ParserValuePlaceholder brand is compile-time only.
      const parsedValue: unknown = isPhase2UndefinedParsedValue(parsed)
        ? undefined
        : parsed;
      const parsedPlaceholder = parsedValue as ParserValuePlaceholder;

      const buildAnnotations = (
        configData: T | undefined,
        configMeta: TConfigMeta | undefined,
      ): Annotations => {
        if (configData === undefined || configData === null) {
          return {};
        }

        // Set active config in registry for nested parsers inside object()
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
      };

      const validateAndBuildAnnotations = (
        rawData: unknown,
        configMeta: TConfigMeta | undefined,
      ): Promise<Annotations> | Annotations => {
        const validated = validateWithSchema(rawSchema, rawData);
        if (validated instanceof Promise) {
          return validated.then((configData) =>
            buildAnnotations(configData, configMeta)
          );
        }
        return buildAnnotations(validated, configMeta);
      };

      if (opts.load) {
        // Custom load mode
        const loaded = opts.load(parsedPlaceholder);
        // Accept native Promises and cross-realm Promises (detected via
        // Symbol.toStringTag).
        if (isPromise(loaded)) {
          return Promise.resolve(loaded as Promise<unknown>).then(
            (resolved) => {
              const validated = validateLoadResult<TConfigMeta>(resolved);
              return validateAndBuildAnnotations(
                validated.config,
                validated.meta,
              );
            },
          );
        }
        // Reject plain thenables that are neither native nor cross-realm
        // Promises.  The API contract is Promise | ConfigLoadResult.
        if (isPromiseLike(loaded)) {
          throw new TypeError(
            "Expected load() to return a plain object or Promise, " +
              "but got a thenable. Use a real Promise instead.",
          );
        }
        const validated = validateLoadResult<TConfigMeta>(loaded);
        return validateAndBuildAnnotations(validated.config, validated.meta);
      }

      if (opts.getConfigPath) {
        // Single-file mode
        const configPath = opts.getConfigPath(parsedPlaceholder);

        if (configPath !== undefined && typeof configPath !== "string") {
          throw new TypeError(
            `Expected getConfigPath() to return a string or undefined, but got: ${
              getTypeName(configPath)
            }.`,
          );
        }

        if (!configPath) {
          return {};
        }

        const absoluteConfigPath = resolvePath(configPath);
        const singleFileMeta: ConfigMeta = {
          configDir: dirname(absoluteConfigPath),
          configPath: absoluteConfigPath,
        };

        try {
          const contents = readFileSync(absoluteConfigPath);

          // Parse file contents
          let rawData: unknown;
          if (rawFileParser) {
            rawData = rawFileParser(contents);
          } else {
            // Default to JSON
            const text = new TextDecoder().decode(contents);
            rawData = JSON.parse(text);
          }

          return validateAndBuildAnnotations(
            rawData,
            singleFileMeta as TConfigMeta,
          );
        } catch (error) {
          // Missing config file is optional in single-file mode.
          if (isErrnoException(error) && error.code === "ENOENT") {
            return {};
          }
          if (error instanceof SyntaxError) {
            throw new Error(
              `Failed to parse config file ` +
                `${absoluteConfigPath}: ${error.message}`,
            );
          }
          throw error;
        }
      }

      return {};
    },

    [Symbol.dispose]() {
      clearActiveConfig(contextId);
      clearActiveConfigMeta(contextId);
    },
  };

  return context;
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
   * that extracts nested values. Accessor callbacks receive config metadata,
   * if available, as the second argument.
   */
  readonly key:
    | keyof T
    | ((config: T, meta: TConfigMeta | undefined) => TValue);

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
 * @throws {TypeError} If `key` is not a property key or function.
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
  const keyType = typeof options.key;
  if (
    keyType !== "string" && keyType !== "number" && keyType !== "symbol" &&
    keyType !== "function"
  ) {
    throw new TypeError(
      `Expected key to be a property key or function, but got: ${
        getTypeName(options.key)
      }.`,
    );
  }

  // Unique brand symbol scoped to this bindConfig call, mirroring the
  // approach used by bindEnv.  This prevents complete() from accidentally
  // treating an unrelated state object with a `hasCliValue` property as a
  // ConfigBindState.
  const configBindStateKey: unique symbol = Symbol(
    "@optique/config/bindState",
  );

  type ConfigBindState =
    & { readonly [K in typeof configBindStateKey]: true }
    & { readonly hasCliValue: boolean; readonly cliState?: TState };

  function isConfigBindState(value: unknown): value is ConfigBindState {
    return value != null &&
      typeof value === "object" &&
      configBindStateKey in value;
  }

  function shouldDeferPromptUntilConfigResolves(
    state: unknown,
    _exec?: ExecutionContext,
  ): boolean {
    const annotations = getAnnotations(state);
    return annotations?.[options.context.id] === phase1ConfigAnnotationMarker;
  }

  // bindConfig() resolves fallbacks through config annotations at completion
  // time, not through synthetic dependency-wrapper states.  Keeping the bound
  // parser isolated from those legacy markers prevents optional()/withDefault()
  // wrappers from invoking it without the annotation context it requires.

  const boundParser: Parser<M, TValue, TState> = {
    $mode: parser.$mode,
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    usage: options.default !== undefined
      ? [{ type: "optional", terms: parser.usage }]
      : parser.usage,
    [Symbol.for("@optique/core/inheritParentAnnotations")]: true,
    leadingNames: parser.leadingNames,
    acceptingAnyToken: parser.acceptingAnyToken,
    initialState: parser.initialState,

    parse: (context) => {
      // Extract annotations from context to preserve them
      const annotations = getAnnotations(context.state);

      // Unwrap state from a previous parse() call.  After a successful
      // parse, object() stores the wrapped ConfigBindState and passes it
      // back on the next iteration.  The inner parser expects its own
      // native state, so we unwrap cliState before delegating, mirroring
      // the pattern used by bindEnv.
      const innerState = isConfigBindState(context.state)
        ? (context.state.hasCliValue
          ? (context.state.cliState as TState)
          : parser.initialState)
        : context.state;
      const innerContext = innerState !== context.state
        ? { ...context, state: innerState }
        : context;

      const processResult = (
        result: ParserResult<TState>,
      ): ParserResult<TState> => {
        if (result.success) {
          // Only mark hasCliValue when the inner parser actually consumed
          // input tokens.  Wrappers like withDefault may return success
          // with consumed: [] when the CLI option is absent; treating those
          // as "CLI provided" would skip the config fallback and break
          // composition with bindEnv.
          const cliConsumed = result.consumed.length > 0;
          const newState = {
            [configBindStateKey]: true as const,
            hasCliValue: cliConsumed,
            cliState: result.next.state,
            ...(annotations && { [annotationKey]: annotations }),
          } as unknown as TState;
          return {
            success: true,
            next: { ...result.next, state: newState },
            consumed: result.consumed,
          };
        }

        // If the inner parser consumed tokens before failing, propagate
        // the failure so that specific error messages (e.g., "requires a
        // value") are preserved instead of being replaced by a generic
        // "Unexpected option or argument" message.
        if (result.consumed > 0) {
          return result;
        }

        const newState = {
          [configBindStateKey]: true as const,
          hasCliValue: false,
          ...(annotations && { [annotationKey]: annotations }),
        } as unknown as TState;
        return {
          success: true,
          next: { ...innerContext, state: newState },
          consumed: [],
        };
      };

      return mapModeValue(
        parser.$mode,
        parser.parse(innerContext),
        processResult,
      );
    },

    complete: (state, exec?) => {
      // Check if we have a CLI value from parse phase using the branded
      // type guard instead of an unsafe `as unknown as` cast.
      if (isConfigBindState(state) && state.hasCliValue) {
        return parser.complete(state.cliState!, exec);
      }

      // No CLI value, check config
      return wrapForMode(parser.$mode, getConfigOrDefault(state, options));
    },

    suggest: parser.suggest,
    shouldDeferCompletion: shouldDeferPromptUntilConfigResolves,
    getDocFragments(state, upperDefaultValue?) {
      const defaultValue = upperDefaultValue ?? options.default;
      return parser.getDocFragments(state, defaultValue);
    },
  };

  // Lazily forward placeholder from inner parser to avoid eagerly
  // evaluating derived value parser factories at construction time.
  if ("placeholder" in parser) {
    Object.defineProperty(boundParser, "placeholder", {
      get() {
        return parser.placeholder;
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Forward value normalization from inner parser so that withDefault()
  // can normalize defaults through bindConfig() wrappers.
  if (typeof parser.normalizeValue === "function") {
    Object.defineProperty(boundParser, "normalizeValue", {
      value: parser.normalizeValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  const dependencyMetadata = parser.dependencyMetadata;
  if (dependencyMetadata != null) {
    Object.defineProperty(boundParser, "dependencyMetadata", {
      value: dependencyMetadata.source == null ? dependencyMetadata : {
        ...dependencyMetadata,
        source: {
          ...dependencyMetadata.source,
          extractSourceValue: (state: unknown) => {
            if (!isConfigBindState(state)) {
              return dependencyMetadata.source?.extractSourceValue(state);
            }
            if (state.hasCliValue) {
              return dependencyMetadata.source?.extractSourceValue(
                state.cliState,
              );
            }
            return getConfigOrDefault(state, options);
          },
        },
      },
      configurable: true,
      enumerable: false,
    });
  }
  return boundParser;
}

/**
 * Helper function to get value from config or default.
 * Checks both annotations (for top-level parsers) and the active config
 * registry (for parsers nested inside object() when used with context-aware
 * runners).
 * @throws {TypeError} If the key callback returns a Promise or thenable.
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
    | { readonly data: T; readonly meta?: TConfigMeta | undefined }
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
      configValue = options.key(configData, configMeta);
      if (
        configValue != null &&
        (typeof configValue === "object" ||
          typeof configValue === "function") &&
        "then" in configValue &&
        typeof (configValue as Record<string, unknown>).then === "function"
      ) {
        throw new TypeError(
          "The key callback must return a synchronous value, " +
            "but got a thenable.",
        );
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
