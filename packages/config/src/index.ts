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
import {
  containsPlaceholderValues,
  isPlaceholderValue,
} from "@optique/core/context";
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

function isDeferredPromptValue(value: unknown): boolean {
  return isPlaceholderValue(value);
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

const SANITIZE_FAILED: unique symbol = Symbol("sanitizeFailed");

interface ActiveSanitization {
  readonly saved: Map<PropertyKey, PropertyDescriptor>;
  readonly sanitizedValues: Map<PropertyKey, unknown>;
  count: number;
}

const activeSanitizations = new WeakMap<object, ActiveSanitization>();

function callWithSanitizedOwnProperties(
  target: object,
  fn: { apply(thisArg: unknown, args: unknown[]): unknown },
  args: unknown[],
  strip: <V>(value: V, seen: WeakMap<object, unknown>) => V,
  seen: WeakMap<object, unknown>,
): unknown | typeof SANITIZE_FAILED {
  let active = activeSanitizations.get(target);
  if (active != null) {
    // Properties are already sanitized by a concurrent call; just
    // increment the reference count so we defer restoration.
    active.count++;
  } else {
    const saved = new Map<PropertyKey, PropertyDescriptor>();
    const sanitizedValues = new Map<PropertyKey, unknown>();
    for (const key of Reflect.ownKeys(target)) {
      const desc = Object.getOwnPropertyDescriptor(target, key);
      if (desc != null && "value" in desc) {
        let stripped: unknown;
        try {
          stripped = strip(desc.value, seen);
        } catch {
          for (const [k, d] of saved) {
            try {
              Object.defineProperty(target, k, d);
            } catch {
              // Best-effort rollback.
            }
          }
          return SANITIZE_FAILED;
        }
        if (stripped !== desc.value) {
          try {
            Object.defineProperty(target, key, { ...desc, value: stripped });
            saved.set(key, desc);
            sanitizedValues.set(key, stripped);
          } catch {
            for (const [k, d] of saved) {
              try {
                Object.defineProperty(target, k, d);
              } catch {
                // Best-effort rollback.
              }
            }
            return SANITIZE_FAILED;
          }
        }
      }
    }
    active = { saved, sanitizedValues, count: 1 };
    activeSanitizations.set(target, active);
  }

  function release(): void {
    active!.count--;
    if (active!.count === 0) {
      activeSanitizations.delete(target);
      for (const [key, desc] of active!.saved) {
        try {
          const current = Object.getOwnPropertyDescriptor(target, key);
          if (current == null) continue;
          if (
            "value" in current &&
            current.value !== active!.sanitizedValues.get(key)
          ) {
            continue;
          }
          Object.defineProperty(target, key, desc);
        } catch {
          // The method may have frozen, sealed, or redefined this
          // property; best-effort restoration.
        }
      }
    }
  }

  let result: unknown;
  try {
    result = fn.apply(target, args);
  } catch (e) {
    release();
    throw e;
  }

  // If the method returns a real Promise (async method), defer restoration
  // until the promise settles so that awaited continuations still observe
  // the sanitized property values.  Custom thenables are not assimilated
  // to avoid coercing non-Promise return types.
  if (result instanceof Promise) {
    return (result as Promise<unknown>).then(
      (v) => {
        release();
        return strip(v, seen);
      },
      (e) => {
        release();
        throw e;
      },
    );
  }

  release();
  return strip(result, seen);
}

function callMethodOnSanitizedTarget(
  fn: { apply(thisArg: unknown, args: unknown[]): unknown },
  proxy: object,
  target: object,
  args: unknown[],
  strip: <V>(value: V, seen: WeakMap<object, unknown>) => V,
  seen: WeakMap<object, unknown>,
): unknown {
  const result = callWithSanitizedOwnProperties(
    target,
    fn,
    args,
    strip,
    seen,
  );
  if (result !== SANITIZE_FAILED) return result;

  // SANITIZE_FAILED means the target is frozen/sealed and its properties
  // cannot be temporarily replaced.  Fall back to the proxy path.
  const fallback = fn.apply(proxy, args);
  if (fallback instanceof Promise) {
    return (fallback as Promise<unknown>).then((v) => strip(v, seen));
  }
  return strip(fallback, seen);
}

function createSanitizedNonPlainView<T extends object>(
  value: T,
  seen: WeakMap<object, unknown>,
): T {
  // NOTE: Methods are invoked on the original target with temporarily
  // sanitized own properties via callMethodOnSanitizedTarget().  This
  // allows private field access (which requires the real instance as
  // receiver) while ensuring public deferred-value fields are scrubbed.
  // See: https://github.com/dahlia/optique/issues/307
  const methodCache = new Map<
    PropertyKey,
    { fn: unknown; wrapper: (...args: unknown[]) => unknown }
  >();
  const proxy: T = new Proxy(value, {
    get(target, key, _receiver) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor != null && "value" in descriptor) {
        // Non-configurable non-writable properties must return the exact
        // value to satisfy the proxy invariant.
        if (!descriptor.configurable && !descriptor.writable) {
          return descriptor.value;
        }
        const val = stripDeferredPromptValues(descriptor.value, seen);
        if (typeof val === "function") {
          // For non-configurable non-writable properties, the proxy invariant
          // requires returning the exact value.  Class constructors are also
          // returned unwrapped since the wrapper would break new.target and
          // prototype chain semantics when invoked with `new`.
          if (
            (!descriptor.configurable && !descriptor.writable) ||
            /^class[\s{]/.test(Function.prototype.toString.call(val))
          ) {
            return val;
          }
          const cached = methodCache.get(key);
          if (cached != null && cached.fn === val) return cached.wrapper;
          const wrapper = function (this: unknown, ...args: unknown[]) {
            if (this !== proxy) {
              return stripDeferredPromptValues(
                val.apply(this, args),
                seen,
              );
            }
            return callMethodOnSanitizedTarget(
              val,
              proxy,
              target,
              args,
              stripDeferredPromptValues,
              seen,
            );
          };
          methodCache.set(key, { fn: val, wrapper });
          return wrapper;
        }
        return val;
      }
      let isAccessor = false;
      for (
        let proto: object | null = target;
        proto != null;
        proto = Object.getPrototypeOf(proto)
      ) {
        const d = Object.getOwnPropertyDescriptor(proto, key);
        if (d != null) {
          isAccessor = "get" in d;
          break;
        }
      }
      // Invoke the getter on the real target with temporarily sanitized
      // own properties via callMethodOnSanitizedTarget().  This ensures
      // computed getters read sanitized public fields while still being
      // able to access private fields.
      const result = callMethodOnSanitizedTarget(
        {
          apply: (thisArg: unknown) =>
            Reflect.get(target, key, thisArg ?? target),
        },
        proxy,
        target,
        [],
        stripDeferredPromptValues,
        seen,
      );
      if (typeof result === "function") {
        if (/^class[\s{]/.test(Function.prototype.toString.call(result))) {
          return result;
        }
        if (!isAccessor) {
          const cached = methodCache.get(key);
          if (cached != null && cached.fn === result) return cached.wrapper;
          const wrapper = function (this: unknown, ...args: unknown[]) {
            if (this !== proxy) {
              return stripDeferredPromptValues(
                result.apply(this, args),
                seen,
              );
            }
            return callMethodOnSanitizedTarget(
              result,
              proxy,
              target,
              args,
              stripDeferredPromptValues,
              seen,
            );
          };
          methodCache.set(key, { fn: result, wrapper });
          return wrapper;
        }
        return function (this: unknown, ...args: unknown[]) {
          if (this !== proxy) {
            return stripDeferredPromptValues(
              result.apply(this, args),
              seen,
            );
          }
          return callMethodOnSanitizedTarget(
            result,
            proxy,
            target,
            args,
            stripDeferredPromptValues,
            seen,
          );
        };
      }
      return stripDeferredPromptValues(result, seen);
    },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor == null || !("value" in descriptor)) {
        return descriptor;
      }
      if (!descriptor.configurable && !descriptor.writable) {
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
    if (!containsPlaceholderValues(value)) {
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
    if (!containsPlaceholderValues(value)) {
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
    if (!containsPlaceholderValues(value)) {
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
    // Always create the sanitized proxy view for non-plain objects, even when
    // containsPlaceholderValues() doesn't detect any.  Placeholder values may
    // be hidden in private fields or behind method return values where own-
    // property inspection cannot reach them.
    return createSanitizedNonPlainView(value, seen) as T;
  }
  // The core's prepareParsedForContexts() already clones plain objects
  // and wraps function properties before passing them to config contexts,
  // so an additional clone here is only needed when own-property
  // placeholders are still visible.
  if (!containsPlaceholderValues(value)) {
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
      if (typeof descriptor.value === "function") {
        // Wrap function-valued properties so that closures capturing
        // deferred prompt values return sanitized results when called by
        // phase-two contexts.  The wrapper delegates to `new` when
        // invoked as a constructor, preserving new.target, prototype
        // chains, and instanceof semantics.
        // See: https://github.com/dahlia/optique/issues/407
        const fn = descriptor.value as
          & { apply(thisArg: unknown, args: unknown[]): unknown }
          & (new (...args: unknown[]) => unknown);
        descriptor.value = function (
          this: unknown,
          ...args: unknown[]
        ) {
          if (new.target) {
            return Reflect.construct(fn, args, new.target);
          }
          const result = fn.apply(this, args);
          if (result instanceof Promise) {
            return (result as Promise<unknown>).then(
              (v) => stripDeferredPromptValues(v, seen),
            );
          }
          return stripDeferredPromptValues(result, seen);
        };
        for (const fk of Reflect.ownKeys(fn)) {
          const fd = Object.getOwnPropertyDescriptor(fn, fk);
          if (fd == null) continue;
          try {
            Object.defineProperty(descriptor.value, fk, fd);
          } catch {
            // Best-effort copy for non-configurable built-in properties.
          }
        }
      } else {
        descriptor.value = stripDeferredPromptValues(
          descriptor.value,
          seen,
        );
      }
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

  function shouldDeferPromptUntilConfigResolves(state: unknown): boolean {
    const annotations = getAnnotations(state);
    return annotations?.[options.context.id] === phase1ConfigAnnotationMarker;
  }

  // Do NOT propagate wrappedDependencySourceMarker to the returned parser.
  // Unlike withDefault(), bindConfig() cannot resolve dependencies from a
  // synthetic pending state (it needs config annotations).  Propagating the
  // marker would cause optional() to delegate into bindConfig with an
  // unannotated state, surfacing "Missing config" errors instead of undefined.

  const boundParser: Parser<M, TValue, TState> = {
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
    shouldDeferCompletion: shouldDeferPromptUntilConfigResolves,
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
