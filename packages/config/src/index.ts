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
import type { Parser, ParserResult, Result } from "@optique/core/parser";
import { annotationKey, getAnnotations } from "@optique/core/annotations";
import { message } from "@optique/core/message";
import { mapModeValue, wrapForMode } from "@optique/core/mode-dispatch";

const deferPromptUntilConfigResolvesKey = Symbol.for(
  "@optique/config/deferPromptUntilResolved",
);
const phase1ConfigAnnotationsKey = Symbol.for(
  "@optique/config/phase1PromptAnnotations",
);
const phase2UndefinedParsedValueKey = Symbol.for(
  "@optique/config/phase2UndefinedParsedValue",
);
const deferredPromptValueKey = Symbol.for(
  "@optique/inquirer/deferredPromptValue",
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

function isDeferredPromptValue(value: unknown): boolean {
  return value != null &&
    typeof value === "object" &&
    deferredPromptValueKey in value;
}

function isPhase2UndefinedParsedValue(value: unknown): boolean {
  return value != null &&
    typeof value === "object" &&
    phase2UndefinedParsedValueKey in value;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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

function containsDeferredPromptValuesInOwnProperties(
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
      containsDeferredPromptValues(descriptor.value, seen)
    ) {
      return true;
    }
  }
  return false;
}

function copySanitizedOwnProperties(
  source: object,
  target: object,
  seen: WeakMap<object, unknown>,
): void {
  for (const key of Reflect.ownKeys(source)) {
    if (shouldSkipCollectionOwnKey(source, key)) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor == null) {
      continue;
    }
    if ("value" in descriptor) {
      descriptor.value = stripDeferredPromptValues(descriptor.value, seen);
    }
    Object.defineProperty(target, key, descriptor);
  }
}

function containsDeferredPromptValues(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  // FIXME: This only inspects own data properties, so deferred prompt values
  // hidden behind private fields or method-only wrapper DTOs are missed.
  // See: https://github.com/dahlia/optique/issues/407
  if (isDeferredPromptValue(value)) {
    return true;
  }
  if (value == null || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.some((item) => containsDeferredPromptValues(item, seen))) {
      return true;
    }
    return containsDeferredPromptValuesInOwnProperties(value, seen);
  }
  if (value instanceof Set) {
    for (const entryValue of value) {
      if (containsDeferredPromptValues(entryValue, seen)) {
        return true;
      }
    }
    return containsDeferredPromptValuesInOwnProperties(value, seen);
  }
  if (value instanceof Map) {
    for (const [key, entryValue] of value) {
      if (
        containsDeferredPromptValues(key, seen) ||
        containsDeferredPromptValues(entryValue, seen)
      ) {
        return true;
      }
    }
    return containsDeferredPromptValuesInOwnProperties(value, seen);
  }
  return containsDeferredPromptValuesInOwnProperties(value, seen);
}

function isPrivateFieldTypeError(e: unknown): boolean {
  return e instanceof TypeError &&
    typeof e.message === "string" &&
    /\bprivate\b/i.test(e.message);
}

const SANITIZE_FAILED: unique symbol = Symbol("sanitizeFailed");

function callWithSanitizedOwnProperties(
  target: object,
  fn: { apply(thisArg: unknown, args: unknown[]): unknown },
  args: unknown[],
  strip: <V>(value: V, seen: WeakMap<object, unknown>) => V,
  seen: WeakMap<object, unknown>,
): unknown | typeof SANITIZE_FAILED {
  const saved = new Map<PropertyKey, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(target)) {
    const desc = Object.getOwnPropertyDescriptor(target, key);
    if (desc != null && "value" in desc) {
      const stripped = strip(desc.value, seen);
      if (stripped !== desc.value) {
        try {
          Object.defineProperty(target, key, { ...desc, value: stripped });
          saved.set(key, desc);
        } catch {
          // Property is non-configurable or object is frozen; cannot
          // safely call the method with unsanitized state.
          for (const [k, d] of saved) {
            Object.defineProperty(target, k, d);
          }
          return SANITIZE_FAILED;
        }
      }
    }
  }
  try {
    return strip(fn.apply(target, args), seen);
  } finally {
    for (const [key, desc] of saved) {
      Object.defineProperty(target, key, desc);
    }
  }
}

function createSanitizedNonPlainView<T extends object>(
  value: T,
  seen: WeakMap<object, unknown>,
): T {
  // NOTE: Methods are invoked with the proxy as receiver so that property
  // reads inside the method body go through the sanitized get trap.  If the
  // method accesses private fields, that call throws a TypeError because
  // private fields are bound to the original instance, not the proxy; in
  // that case we temporarily sanitize the target's own properties, retry
  // with the target as receiver, and restore the original values afterward.
  // See: https://github.com/dahlia/optique/issues/407
  const proxy: T = new Proxy(value, {
    get(target, key, _receiver) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor != null && "value" in descriptor) {
        const val = stripDeferredPromptValues(descriptor.value, seen);
        if (typeof val === "function") {
          return function (this: unknown, ...args: unknown[]) {
            try {
              return stripDeferredPromptValues(
                val.apply(proxy, args),
                seen,
              );
            } catch (e) {
              if (isPrivateFieldTypeError(e)) {
                const result = callWithSanitizedOwnProperties(
                  target,
                  val,
                  args,
                  stripDeferredPromptValues,
                  seen,
                );
                if (result !== SANITIZE_FAILED) return result;
              }
              throw e;
            }
          };
        }
        return val;
      }
      const result = Reflect.get(target, key, proxy);
      if (typeof result === "function") {
        return function (this: unknown, ...args: unknown[]) {
          try {
            return stripDeferredPromptValues(
              result.apply(proxy, args),
              seen,
            );
          } catch (e) {
            if (isPrivateFieldTypeError(e)) {
              const fallback = callWithSanitizedOwnProperties(
                target,
                result,
                args,
                stripDeferredPromptValues,
                seen,
              );
              if (fallback !== SANITIZE_FAILED) return fallback;
            }
            throw e;
          }
        };
      }
      return result;
    },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor == null || !("value" in descriptor)) {
        return descriptor;
      }
      return {
        ...descriptor,
        value: stripDeferredPromptValues(descriptor.value, seen),
      };
    },
  });
  seen.set(value, proxy);
  return proxy;
}

function stripDeferredPromptValues<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
): T {
  if (isDeferredPromptValue(value)) {
    return undefined as T;
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  const cached = seen.get(value);
  if (cached !== undefined) {
    return cached as T;
  }
  if (Array.isArray(value)) {
    if (!containsDeferredPromptValues(value)) {
      return value;
    }
    const clone: unknown[] = new Array(value.length);
    seen.set(value, clone);
    for (let i = 0; i < value.length; i++) {
      clone[i] = stripDeferredPromptValues(value[i], seen);
    }
    copySanitizedOwnProperties(value, clone, seen);
    return clone as T;
  }
  if (value instanceof Set) {
    if (!containsDeferredPromptValues(value)) {
      return value;
    }
    const clone = new Set<unknown>();
    seen.set(value, clone);
    for (const entryValue of value) {
      clone.add(stripDeferredPromptValues(entryValue, seen));
    }
    copySanitizedOwnProperties(value, clone, seen);
    return clone as T;
  }
  if (value instanceof Map) {
    if (!containsDeferredPromptValues(value)) {
      return value;
    }
    const clone = new Map<unknown, unknown>();
    seen.set(value, clone);
    for (const [key, entryValue] of value) {
      clone.set(
        stripDeferredPromptValues(key, seen),
        stripDeferredPromptValues(entryValue, seen),
      );
    }
    copySanitizedOwnProperties(value, clone, seen);
    return clone as T;
  }
  if (!isPlainObject(value)) {
    return containsDeferredPromptValues(value)
      ? createSanitizedNonPlainView(value, seen) as T
      : value;
  }
  if (!containsDeferredPromptValues(value)) {
    return value;
  }
  const clone: Record<PropertyKey, unknown> = Object.create(
    Object.getPrototypeOf(value),
  );
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor == null) {
      continue;
    }
    if ("value" in descriptor) {
      descriptor.value = stripDeferredPromptValues(
        descriptor.value,
        seen,
      );
    }
    Object.defineProperty(clone, key, descriptor);
  }
  return clone as T;
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

  const context: ConfigContext<T, TConfigMeta> & {
    readonly [phase1ConfigAnnotationsKey]: (
      parsed: unknown,
      annotations: Annotations,
    ) => Annotations | undefined;
  } = {
    id: contextId,
    schema: options.schema,
    mode: "dynamic",
    [phase1ConfigAnnotationsKey](parsed: unknown, annotations: Annotations) {
      if (parsed === undefined) {
        return { [contextId]: phase1ConfigAnnotationMarker };
      }
      return Object.getOwnPropertySymbols(annotations).includes(contextId)
        ? undefined
        : { [contextId]: undefined };
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

      // At runtime, `parsed` is the actual parser value.  The
      // ParserValuePlaceholder brand is compile-time only.
      const parsedValue: unknown = isPhase2UndefinedParsedValue(parsed)
        ? undefined
        : stripDeferredPromptValues(parsed);
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
        const validated = validateWithSchema(options.schema, rawData);
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
        if (loaded instanceof Promise) {
          return loaded.then(({ config, meta }) =>
            validateAndBuildAnnotations(config, meta)
          );
        }

        return validateAndBuildAnnotations(loaded.config, loaded.meta);
      }

      if (opts.getConfigPath) {
        // Single-file mode
        const configPath = opts.getConfigPath(parsedPlaceholder);

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
          if (options.fileParser) {
            rawData = options.fileParser(contents);
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

  function shouldDeferPromptUntilConfigResolves(state: unknown): boolean {
    const annotations = getAnnotations(state);
    return annotations?.[options.context.id] === phase1ConfigAnnotationMarker;
  }

  const boundParser: Parser<M, TValue, TState> & {
    readonly [deferPromptUntilConfigResolvesKey]: (state: unknown) => boolean;
  } = {
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

    complete: (state) => {
      // Check if we have a CLI value from parse phase using the branded
      // type guard instead of an unsafe `as unknown as` cast.
      if (isConfigBindState(state) && state.hasCliValue) {
        return parser.complete(state.cliState!);
      }

      // No CLI value, check config
      return wrapForMode(parser.$mode, getConfigOrDefault(state, options));
    },

    suggest: parser.suggest,
    [deferPromptUntilConfigResolvesKey]: shouldDeferPromptUntilConfigResolves,
    getDocFragments(state, upperDefaultValue?) {
      const defaultValue = upperDefaultValue ?? options.default;
      return parser.getDocFragments(state, defaultValue);
    },
  };

  return boundParser;
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
