/**
 * Generic prompt adapter support for Optique.
 *
 * @module
 * @since 1.2.0
 */
import { getAnnotations } from "@optique/core/annotations";
import {
  type AnyDependencySource,
  type DependencyValue,
  type DependencyValues,
  getDependencySourceInfo,
} from "@optique/core/dependency";
import {
  type Message,
  message,
  values as valuesTerm,
} from "@optique/core/message";
import {
  defineTraits,
  delegateSuggestNodes,
  getTraits,
  inheritAnnotations,
  injectAnnotations,
  mapSourceMetadata,
  type ParserSourceMetadata,
  unwrapInjectedAnnotationState,
  withAnnotationView,
} from "@optique/core/extension";
import { fluent, type FluentParser } from "@optique/core/fluent";
import type {
  ExecutionContext,
  Mode,
  ModeValue,
  Parser,
  ParserResult,
} from "@optique/core/parser";
import type { ValueParserResult } from "@optique/core/valueparser";

/**
 * Controls whether a prompt fallback runs at runtime.
 *
 * When `when` returns `false`, the prompt adapter is skipped and `otherwise`
 * is returned.  The condition runs only when parsing reaches the prompt
 * fallback, after CLI values and other configured value sources have been
 * exhausted.
 *
 * @typeParam TValue Value type produced by the wrapped parser.
 * @since 1.3.0
 */
export type PromptCondition<TValue> =
  | {
    readonly when?: never;
    readonly otherwise?: never;
  }
  | {
    readonly when: () => boolean | Promise<boolean>;
    readonly otherwise: NoInfer<TValue>;
  };

/**
 * Validates a value returned by a prompt adapter.
 *
 * Return `undefined` to accept the value, or a structured message to reject it
 * and ask the adapter to try again.  The validator receives the prompted value
 * directly; it is not converted back into command-line input or passed through
 * the wrapped value parser.
 *
 * @typeParam TValue Value type produced by the wrapped parser.
 * @since 1.3.0
 */
export type PromptValidator<TValue> = (
  value: TValue,
) => Message | undefined | Promise<Message | undefined>;

/**
 * Shared validation, retry, and cancellation options for a prompt fallback.
 *
 * These options are separate from adapter-native validation fields.  They
 * apply only when the interactive fallback runs; CLI values, source-bound
 * values, and skipped runtime conditions do not consult them.
 *
 * @typeParam TValue Value type produced by the wrapped parser.
 * @since 1.3.0
 */
export interface PromptOptions<TValue> {
  /** Validator applied to each value returned by the adapter. */
  readonly validate?: PromptValidator<TValue>;

  /**
   * Maximum number of adapter executions in one completion.  Must be a
   * positive integer.  When omitted, validation may retry without a limit.
   */
  readonly maxAttempts?: number;

  /**
   * Signal that stops the active adapter execution or validator.  Its reason
   * is propagated to the caller without becoming a parse failure.
   */
  readonly signal?: AbortSignal;
}

/**
 * Context passed to one execution of a prompt adapter.
 *
 * @since 1.3.0
 */
export interface PromptExecutionContext {
  /** One-based number of the current adapter execution. */
  readonly attempt: number;

  /** Message returned by the validator after the preceding execution. */
  readonly previousValidationMessage?: Message;

  /** Signal supplied through the prompt's shared options, when present. */
  readonly signal?: AbortSignal;
}

/**
 * Prompt adapter used by {@link createPromptAdapter}.
 *
 * The adapter owns library-specific prompt execution and maps the result into
 * Optique's value-parser result shape.  The shared parser wrapping behavior,
 * including CLI priority, source bindings, deferred completion, suggestions,
 * usage metadata, validation retries, and abort handling, is handled by
 * *@optique/prompt*.
 *
 * @typeParam TConfig Prompt configuration accepted by the adapter.
 * @since 1.2.0
 */
export interface PromptAdapter<TConfig> {
  /**
   * Executes the library-specific prompt.
   *
   * @typeParam TValue Value type produced by the wrapped parser.
   * @param config Prompt configuration supplied to the generated `prompt()`
   *               wrapper.
   * @param context Attempt number, preceding validation message, and optional
   *                abort signal for this execution.
   * @returns The prompted value or a prompt failure.
   * @throws Any unexpected prompt execution failure.
   */
  readonly execute: <TValue>(
    config: TConfig,
    context: PromptExecutionContext,
  ) => Promise<ValueParserResult<TValue>>;

  /**
   * Returns a default value from the prompt config for documentation purposes.
   *
   * If omitted, *@optique/prompt* reads a `default` property from object-shaped
   * configs when present.
   *
   * @param config Prompt configuration supplied to the generated `prompt()`
   *               wrapper.
   * @returns A default value to pass to the wrapped parser's documentation
   *          fragments.
   */
  readonly getDefaultValue?: (config: TConfig) => unknown;
}

const derivedPromptConfigMarker: unique symbol = Symbol.for(
  "@optique/prompt/derivedPromptConfig",
);

/**
 * Context passed to a single-dependency prompt configuration resolver.
 *
 * @since 1.3.0
 */
export interface DerivePromptConfigContext {
  /**
   * Whether the dependency value came from the `defaultValue` declared by
   * this derived prompt configuration rather than a published source
   * value.  Source-level fallbacks such as `withDefault()` publish real
   * values and are not reported here.
   */
  readonly usedDefault: boolean;
}

/**
 * Context passed to a multi-dependency prompt configuration resolver.
 *
 * @typeParam Deps Tuple of dependency sources the resolver reads.
 * @since 1.3.0
 */
export interface DerivePromptConfigsContext<
  Deps extends readonly AnyDependencySource[],
> {
  /**
   * For each dependency position, whether the value came from the
   * `defaultValues` declared by this derived prompt configuration rather
   * than a published source value.
   */
  readonly usedDefaults: { readonly [K in keyof Deps]: boolean };
}

/**
 * Options for a single-dependency {@link derivePromptConfig} call.
 *
 * @typeParam TDefault Value type of the dependency source.
 * @typeParam TOtherwise Value type returned when `when` skips the prompt.
 * @since 1.3.0
 */
export type DerivePromptConfigOptions<TDefault, TOtherwise> =
  & {
    /**
     * Lazily evaluated fallback used when the dependency source has not
     * published a value.  Without it, an unresolved dependency fails the
     * prompt instead of running the resolver.
     */
    readonly defaultValue?: () => TDefault;
  }
  & (
    | { readonly when?: never; readonly otherwise?: never }
    | {
      readonly when: () => boolean | Promise<boolean>;
      readonly otherwise: TOtherwise;
    }
  );

/**
 * Options for a multi-dependency {@link derivePromptConfig} call.
 *
 * @typeParam TDefaults Tuple of dependency source value types.
 * @typeParam TOtherwise Value type returned when `when` skips the prompt.
 * @since 1.3.0
 */
export type DerivePromptConfigsOptions<
  TDefaults extends readonly unknown[],
  TOtherwise,
> =
  & {
    /**
     * Lazily evaluated fallbacks used for dependency sources that have
     * not published a value.  The thunk must return one value per
     * dependency.  Without it, an unresolved dependency fails the prompt
     * instead of running the resolver.
     */
    readonly defaultValues?: () => TDefaults;
  }
  & (
    | { readonly when?: never; readonly otherwise?: never }
    | {
      readonly when: () => boolean | Promise<boolean>;
      readonly otherwise: TOtherwise;
    }
  );

/**
 * A prompt configuration derived from dependency source values, created
 * by {@link derivePromptConfig}.
 *
 * The resolver runs during the real completion phase, immediately before
 * the adapter executes, and never during probes, help, or suggestions.
 * Generated documentation therefore cannot reflect a derived
 * configuration and falls back to the wrapped parser's static metadata.
 *
 * @typeParam TConfig Adapter configuration produced by the resolver.
 * @typeParam TOtherwise Value type returned when `when` skips the prompt.
 * @since 1.3.0
 */
export interface DerivedPromptConfig<TConfig, TOtherwise = never> {
  readonly [derivedPromptConfigMarker]: true;

  /** The dependency sources the resolver reads, in declaration order. */
  readonly dependencies: readonly AnyDependencySource[];

  /** Snapshot of the dependency source identities. @internal */
  readonly dependencyIds: readonly symbol[];

  /** Diagnostic labels matching {@link dependencyIds}. @internal */
  readonly dependencyLabels: readonly string[];

  /**
   * Resolves the adapter configuration from dependency values.  Receives
   * one value and one used-default flag per dependency position.
   * @internal
   */
  readonly resolve: (
    values: readonly unknown[],
    usedDefaults: readonly boolean[],
  ) => TConfig | Promise<TConfig>;

  /**
   * Lazily evaluated fallbacks, one per dependency position.
   * @internal
   */
  readonly defaultValues?: () => readonly unknown[];

  /** Runtime condition, evaluated before the resolver. */
  readonly when?: () => boolean | Promise<boolean>;

  /** Value produced when {@link when} returns `false`. */
  readonly otherwise?: TOtherwise;
}

/**
 * Checks whether a prompt configuration was created by
 * {@link derivePromptConfig}.
 *
 * @param config The configuration to inspect.
 * @returns `true` for a derived prompt configuration.
 * @since 1.3.0
 */
export function isDerivedPromptConfig(
  config: unknown,
): config is DerivedPromptConfig<unknown, unknown> {
  return config != null && typeof config === "object" &&
    derivedPromptConfigMarker in config &&
    (config as { readonly [derivedPromptConfigMarker]: unknown })[
        derivedPromptConfigMarker
      ] === true;
}

/**
 * Derives a prompt configuration from one dependency source value.
 *
 * The resolver may return the configuration synchronously or
 * asynchronously.  It runs only during the real completion phase, after
 * the named source has published its value—whether that value came from
 * the command line, a source binding, or another prompt.
 *
 * @typeParam D The dependency source type.
 * @typeParam TConfig Adapter configuration produced by the resolver.
 * @typeParam TOtherwise Value type returned when `when` skips the prompt.
 * @param source The dependency source the resolver reads.
 * @param resolver Produces the adapter configuration from the source
 *                 value.
 * @param options Optional declared default and runtime condition.
 * @returns A derived configuration accepted by `prompt()` wrappers.
 * @throws {TypeError} If `source` is not a dependency source.
 * @since 1.3.0
 */
export function derivePromptConfig<
  D extends AnyDependencySource,
  TConfig,
  const TOtherwise = never,
>(
  source: D,
  resolver: (
    value: DependencyValue<D>,
    context: DerivePromptConfigContext,
  ) => TConfig | Promise<TConfig>,
  options?: DerivePromptConfigOptions<DependencyValue<D>, TOtherwise>,
): DerivedPromptConfig<TConfig, TOtherwise>;

/**
 * Derives a prompt configuration from multiple dependency source values.
 *
 * The resolver receives the values as a tuple matching the declaration
 * order of `sources`.  Evaluation order among prompts follows the
 * dependency graph, not surrounding object or tuple field order.
 *
 * @typeParam Deps Tuple of dependency sources the resolver reads.
 * @typeParam TConfig Adapter configuration produced by the resolver.
 * @typeParam TOtherwise Value type returned when `when` skips the prompt.
 * @param sources The dependency sources, at least one.
 * @param resolver Produces the adapter configuration from the source
 *                 values.
 * @param options Optional declared defaults and runtime condition.
 * @returns A derived configuration accepted by `prompt()` wrappers.
 * @throws {TypeError} If `sources` is empty or contains a value that is
 *         not a dependency source.
 * @since 1.3.0
 */
export function derivePromptConfig<
  const Deps extends readonly [AnyDependencySource, ...AnyDependencySource[]],
  TConfig,
  const TOtherwise = never,
>(
  sources: Deps,
  resolver: (
    values: DependencyValues<Deps>,
    context: DerivePromptConfigsContext<Deps>,
  ) => TConfig | Promise<TConfig>,
  options?: DerivePromptConfigsOptions<DependencyValues<Deps>, TOtherwise>,
): DerivedPromptConfig<TConfig, TOtherwise>;

export function derivePromptConfig(
  source: AnyDependencySource | readonly AnyDependencySource[],
  resolver: (value: never, context: never) => unknown,
  options?: {
    readonly defaultValue?: () => unknown;
    readonly defaultValues?: () => readonly unknown[];
    readonly when?: () => boolean | Promise<boolean>;
    readonly otherwise?: unknown;
  },
): DerivedPromptConfig<unknown, unknown> {
  const isTuple = Array.isArray(source);
  const dependencies: readonly AnyDependencySource[] = isTuple
    ? source
    : [source as AnyDependencySource];
  if (dependencies.length === 0) {
    throw new TypeError(
      "derivePromptConfig() requires at least one dependency source.",
    );
  }
  const infos = dependencies.map(getDependencySourceInfo);
  const singleDefault = options?.defaultValue;
  const defaultValues = isTuple
    ? options?.defaultValues
    : singleDefault == null
    ? undefined
    : () => [singleDefault()];
  const resolve = isTuple
    ? (
      values: readonly unknown[],
      usedDefaults: readonly boolean[],
    ): unknown => resolver(values as never, { usedDefaults } as never)
    : (
      values: readonly unknown[],
      usedDefaults: readonly boolean[],
    ): unknown =>
      resolver(
        values[0] as never,
        { usedDefault: usedDefaults[0] } as never,
      );
  return {
    [derivedPromptConfigMarker]: true,
    dependencies,
    dependencyIds: infos.map((info) => info.sourceId),
    dependencyLabels: infos.map((info, index) =>
      info.metavar ?? `dependency #${index + 1}`
    ),
    resolve: resolve as DerivedPromptConfig<unknown, unknown>["resolve"],
    ...(defaultValues == null ? {} : { defaultValues }),
    ...(options?.when == null
      ? {}
      : { when: options.when, otherwise: options.otherwise }),
  };
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type DerivedConfigResolution<TConfig> =
  | { readonly ok: true; readonly config: TConfig }
  | { readonly ok: false; readonly error: Message };

/**
 * Resolves a derived prompt configuration against the dependency runtime.
 *
 * A failed upstream source fails the resolution transitively—the resolver
 * and the adapter never run.  A missing source uses the configuration's
 * declared default, or fails when none is declared.  Resolver exceptions
 * (synchronous throws and rejections alike) become prompt failures so
 * the scheduler treats them like a cancelled prompt.
 */
async function resolveDerivedPromptConfig<TConfig>(
  config: DerivedPromptConfig<TConfig, unknown>,
  exec: ExecutionContext | undefined,
  ownSourceId: symbol | undefined,
  ownLabel: string | undefined,
): Promise<DerivedConfigResolution<TConfig>> {
  const runtime = exec?.dependencyRuntime;
  const ids = config.dependencyIds;

  if (runtime != null) {
    const failedIndex = ids.findIndex((id) => runtime.isSourceFailed(id));
    if (failedIndex >= 0) {
      runtime.propagateSourceFailure(ids, ownLabel ?? "prompt", ownSourceId);
      const base = message`Cannot resolve prompt configuration: dependency ${
        config.dependencyLabels[failedIndex]
      } failed.`;
      // A source-backed prompt reports through the scheduler, which
      // appends the failure chain itself; a consumer-only prompt appends
      // it here.
      const chain = ownSourceId == null
        ? runtime.getSourceFailureChain(ids[failedIndex])
        : undefined;
      return {
        ok: false,
        error: chain == null || chain.length < 2
          ? base
          : message`${base} Dependency chain: ${chain.join(" -> ")}.`,
      };
    }
  }

  const missing: number[] = [];
  const values = ids.map((id, index) => {
    if (runtime?.hasSource(id) === true) return runtime.getSource(id);
    missing.push(index);
    return undefined;
  });
  const usedDefaults = ids.map(() => false);
  if (missing.length > 0) {
    if (config.defaultValues == null) {
      const missingLabels = valuesTerm(
        missing.map((index) => config.dependencyLabels[index]),
      );
      return {
        ok: false,
        error: missing.length > 1
          ? message`Cannot resolve prompt configuration: dependencies ${missingLabels} are not available and no default values are declared.`
          : message`Cannot resolve prompt configuration: dependency ${missingLabels} is not available and no default value is declared.`,
      };
    }
    let defaults: readonly unknown[];
    try {
      defaults = config.defaultValues();
    } catch (error) {
      return {
        ok: false,
        error: message`Prompt configuration default evaluation failed: ${
          describeThrown(error)
        }`,
      };
    }
    if (defaults.length !== ids.length) {
      return {
        ok: false,
        error: message`Prompt configuration declared ${
          String(defaults.length)
        } default values for ${String(ids.length)} dependencies.`,
      };
    }
    for (const index of missing) {
      values[index] = defaults[index];
      usedDefaults[index] = true;
    }
  }

  try {
    return { ok: true, config: await config.resolve(values, usedDefaults) };
  } catch (error) {
    return {
      ok: false,
      error: message`Prompt configuration resolution failed: ${
        describeThrown(error)
      }`,
    };
  }
}

function shouldDeferPrompt(
  parser: Parser<Mode, unknown, unknown>,
  state: unknown,
  exec?: ExecutionContext,
): boolean {
  return typeof parser.shouldDeferCompletion === "function" &&
    parser.shouldDeferCompletion(state, exec) === true;
}

function deferredPromptResult<TValue>(
  placeholderValue: TValue,
): ValueParserResult<TValue> {
  if (placeholderValue == null || typeof placeholderValue !== "object") {
    return {
      success: true,
      value: placeholderValue,
      deferred: true,
    };
  }

  const isArray = Array.isArray(placeholderValue);
  const keys = new Map<PropertyKey, null>();
  for (const key of Reflect.ownKeys(placeholderValue)) {
    if (isArray && key === "length") continue;
    keys.set(key, null);
  }

  return {
    success: true,
    value: placeholderValue,
    deferred: true,
    deferredKeys: keys,
  };
}

function withAnnotatedInnerState<TState, TResult>(
  sourceState: unknown,
  innerState: TState,
  run: (annotatedState: TState) => TResult,
  inheritPrimitiveAnnotations = false,
): TResult {
  const annotations = getAnnotations(sourceState);
  const innerStateIsObject = innerState != null &&
    typeof innerState === "object";
  if (
    annotations == null ||
    getAnnotations(innerState) != null ||
    (!innerStateIsObject && !inheritPrimitiveAnnotations)
  ) {
    return run(innerState);
  }

  const inheritedState = inheritAnnotations(sourceState, innerState);
  if (inheritedState !== innerState) {
    return run(inheritedState);
  }

  return innerStateIsObject
    ? run(withAnnotationView(innerState, annotations))
    : run(innerState);
}

function hasSourceBindingMarker(state: unknown): boolean {
  return state != null &&
    typeof state === "object" &&
    "hasCliValue" in state &&
    Object.getOwnPropertySymbols(state).length > 0;
}

function readDefaultValue<TConfig>(
  adapter: PromptAdapter<TConfig>,
  config: unknown,
): unknown {
  // A derived configuration does not exist until its resolver runs during
  // the real completion phase, so documentation cannot read a default from
  // it and the adapter never receives the marker object.
  if (isDerivedPromptConfig(config)) return undefined;
  if (adapter.getDefaultValue != null) {
    return adapter.getDefaultValue(config as TConfig);
  }
  if (config != null && typeof config === "object" && "default" in config) {
    return (config as { readonly default?: unknown }).default;
  }
  return undefined;
}

function unwrapCompleteResult<TValue>(
  result: ValueParserResult<TValue>,
): ValueParserResult<TValue> {
  if (!result.success) return result;
  return {
    ...result,
    value: unwrapInjectedAnnotationState(result.value),
  };
}

function throwIfPromptAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason;
}

function racePromptWorkWithAbort<T>(
  signal: AbortSignal | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (signal == null) {
    try {
      return work();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    let outcome: Promise<T>;
    try {
      outcome = work();
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }
    outcome.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Prompt configuration accepted by a generated `prompt()` wrapper: either
 * a static adapter configuration (optionally with a runtime condition) or
 * a configuration derived from dependency sources via
 * {@link derivePromptConfig}.
 *
 * @typeParam TConfig Prompt configuration accepted by the adapter.
 * @typeParam TValue Value type produced by the wrapped parser.
 * @since 1.3.0
 */
export type PromptConfigInput<TConfig, TValue> =
  | (TConfig & PromptCondition<TValue>)
  | DerivedPromptConfig<TConfig, NoInfer<TValue>>;

/**
 * Creates a `prompt()` parser wrapper for a prompt library adapter.
 *
 * The generated wrapper tries the inner parser first.  If CLI tokens or source
 * bindings satisfy the parser, the prompt is skipped.  Otherwise the adapter
 * runs during the real completion phase and provides a fallback value.  An
 * inner `withDefault()` does not suppress the prompt; wrap the prompt itself
 * with `withDefault()` when the default should take precedence.
 *
 * @typeParam TConfig Prompt configuration accepted by the adapter.
 * @param adapter Library-specific prompt executor.
 * @returns A `prompt(parser, config, options?)` wrapper that always produces
 *          an async parser.  The configuration may be a static `TConfig` or a
 *          {@link DerivedPromptConfig} whose resolver returns `TConfig`.  The
 *          returned wrapper throws a `RangeError` when `maxAttempts` is not a
 *          positive integer.
 * @since 1.2.0
 */
export function createPromptAdapter<TConfig>(
  adapter: PromptAdapter<TConfig>,
): <M extends Mode, TValue, TState>(
  parser: Parser<M, TValue, TState>,
  config: PromptConfigInput<TConfig, TValue>,
  options?: PromptOptions<NoInfer<TValue>>,
) => FluentParser<"async", TValue, TState> {
  return function prompt<M extends Mode, TValue, TState>(
    parser: Parser<M, TValue, TState>,
    config: PromptConfigInput<TConfig, TValue>,
    options: PromptOptions<NoInfer<TValue>> = {},
  ): FluentParser<"async", TValue, TState> {
    if (
      options.maxAttempts !== undefined &&
      (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1)
    ) {
      throw new RangeError(
        "maxAttempts must be an integer greater than or equal to 1.",
      );
    }
    const { validate, maxAttempts, signal } = options;
    const promptBindStateKey: unique symbol = Symbol(
      "@optique/prompt/promptState",
    );
    // Identifies this prompt wrapper occurrence in the run-scoped
    // effectful completion session.  The cache key combines the wrapper
    // instance (via this closure) with the completion path so that two
    // distinct prompts sharing one source (e.g., duplicate merge()
    // fields) and one instance reused at several positions (e.g.,
    // `tuple([p, p])`) each keep their own result, while the same
    // occurrence still reuses its result across the seed and final
    // passes of a runWith() run.
    const completionCacheKeys = new Map<string, symbol>();
    const completionCacheSymbolIds = new Map<symbol, number>();
    const completionCacheKeyFor = (
      path: readonly PropertyKey[] | undefined,
    ): symbol => {
      // Length-prefix each segment so no separator escaping is needed.
      const serialized = (path ?? []).map((segment) => {
        if (typeof segment === "symbol") {
          let id = completionCacheSymbolIds.get(segment);
          if (id == null) {
            id = completionCacheSymbolIds.size;
            completionCacheSymbolIds.set(segment, id);
          }
          return `y${id}:`;
        }
        const tag = typeof segment === "number" ? "n" : "s";
        const text = String(segment);
        return `${tag}${text.length}:${text}`;
      }).join("");
      let key = completionCacheKeys.get(serialized);
      if (key == null) {
        key = Symbol("@optique/prompt/completionCache");
        completionCacheKeys.set(serialized, key);
      }
      return key;
    };

    type PromptBindState =
      & { readonly [K in typeof promptBindStateKey]: true }
      & {
        readonly hasCliValue: boolean;
        readonly cliState?: TState;
      };

    function isPromptBindState(value: unknown): value is PromptBindState {
      return value != null &&
        typeof value === "object" &&
        promptBindStateKey in value;
    }

    function shouldAttemptInnerCompletion(
      cliState: unknown,
      state: unknown,
    ): boolean {
      if (cliState == null) {
        return false;
      }
      const cliStateHasAnnotations = getAnnotations(cliState) != null;
      if (cliStateHasAnnotations) {
        return true;
      }
      if (getAnnotations(state) == null || typeof cliState !== "object") {
        return false;
      }
      if ("hasCliValue" in cliState) {
        return true;
      }
      if (Array.isArray(cliState)) {
        return typeof parser.shouldDeferCompletion === "function";
      }
      const prototype = Object.getPrototypeOf(cliState);
      return prototype !== Object.prototype && prototype !== null;
    }

    function shouldCompleteFromSourceBinding(
      cliState: unknown,
      state: unknown,
    ): boolean {
      const cliStateIsInjectedAnnotationWrapper = cliState != null &&
        typeof cliState === "object" &&
        unwrapInjectedAnnotationState(cliState) !== cliState;
      const requiresSourceBindingForAnnotationWrapper =
        getTraits(parser).requiresSourceBinding === true;
      const hasNestedSourceBinding = hasSourceBindingMarker(cliState) ||
        (Array.isArray(cliState) &&
          cliState.length === 1 &&
          (hasSourceBindingMarker(cliState[0]) ||
            (
              cliState[0] != null &&
              typeof cliState[0] === "object" &&
              getAnnotations(cliState[0]) != null
            )));
      if (
        cliStateIsInjectedAnnotationWrapper &&
        requiresSourceBindingForAnnotationWrapper
      ) {
        return hasNestedSourceBinding;
      }
      return shouldAttemptInnerCompletion(cliState, state) ||
        hasNestedSourceBinding;
    }

    async function executePrompt(
      exec?: ExecutionContext,
    ): Promise<ValueParserResult<TValue>> {
      if (config.when != null && !(await config.when())) {
        return { success: true, value: config.otherwise as TValue };
      }
      throwIfPromptAborted(signal);
      let resolvedConfig: TConfig;
      if (!isDerivedPromptConfig(config)) {
        resolvedConfig = config as TConfig;
      } else {
        const source = promptedParser.dependencyMetadata?.source;
        const resolved = await resolveDerivedPromptConfig(
          config as DerivedPromptConfig<TConfig, unknown>,
          exec,
          source?.sourceId,
          source?.metavar,
        );
        throwIfPromptAborted(signal);
        if (!resolved.ok) return { success: false, error: resolved.error };
        resolvedConfig = resolved.config;
      }

      let previousValidationMessage: Message | undefined;
      for (let attempt = 1;; attempt++) {
        const context: PromptExecutionContext = {
          attempt,
          ...(previousValidationMessage === undefined
            ? {}
            : { previousValidationMessage }),
          ...(signal === undefined ? {} : { signal }),
        };
        const result = await racePromptWorkWithAbort(
          signal,
          () => adapter.execute<TValue>(resolvedConfig, context),
        );
        if (!result.success || validate == null) return result;
        const validationMessage = await racePromptWorkWithAbort(
          signal,
          () => Promise.resolve(validate(result.value)),
        );
        if (validationMessage === undefined) return result;
        if (maxAttempts !== undefined && attempt >= maxAttempts) {
          return { success: false, error: validationMessage };
        }
        previousValidationMessage = validationMessage;
      }
    }

    const parserInheritsAnnotations = getTraits(parser).inheritsAnnotations ===
      true;

    const promptedParser: Parser<"async", TValue, TState> = {
      mode: "async",
      $valueType: parser.$valueType,
      $stateType: parser.$stateType,
      priority: parser.priority,
      usage: parser.usage.length === 1 && parser.usage[0].type === "optional"
        ? parser.usage
        : [{ type: "optional", terms: parser.usage }],
      leadingNames: parser.leadingNames,
      acceptingAnyToken: parser.acceptingAnyToken,
      shouldDeferCompletion(state: TState): boolean {
        return !isPromptBindState(state) || !state.hasCliValue;
      },
      getSuggestRuntimeNodes(state: TState, path: readonly PropertyKey[]) {
        const innerState = isPromptBindState(state)
          ? (state.cliState === undefined
            ? parser.initialState
            : state.cliState as TState)
          : state;
        return delegateSuggestNodes(
          parser,
          promptedParser,
          state,
          path,
          innerState,
          "prepend",
        );
      },
      initialState: {
        [promptBindStateKey]: true as const,
        hasCliValue: false as const,
      } as TState,

      parse: (context): ModeValue<"async", ParserResult<TState>> => {
        const annotations = getAnnotations(context.state);
        const innerState = isPromptBindState(context.state)
          ? (context.state.hasCliValue
            ? (context.state.cliState as TState)
            : parser.initialState)
          : context.state;
        const baseInnerContext = innerState !== context.state
          ? { ...context, state: innerState }
          : context;
        const effectiveInnerState = annotations != null &&
            innerState == null &&
            parserInheritsAnnotations
          ? injectAnnotations(innerState, annotations)
          : innerState;
        const processResult = (
          result: ParserResult<TState>,
        ): ParserResult<TState> => {
          if (result.success) {
            const cliState = annotations != null &&
                result.next.state != null &&
                typeof result.next.state === "object" &&
                getAnnotations(result.next.state) !== annotations
              ? injectAnnotations(result.next.state, annotations)
              : result.next.state;
            const cliConsumed = result.consumed.length > 0;
            const nextState = injectAnnotations({
              [promptBindStateKey]: true as const,
              hasCliValue: cliConsumed,
              cliState,
            }, annotations);
            return {
              success: true,
              ...(result.provisional ? { provisional: true as const } : {}),
              next: { ...result.next, state: nextState as TState },
              consumed: result.consumed,
            };
          }

          if (result.consumed > 0) {
            return result;
          }

          const nextState = injectAnnotations({
            [promptBindStateKey]: true as const,
            hasCliValue: false,
          }, annotations);
          return {
            success: true,
            next: { ...baseInnerContext, state: nextState as TState },
            consumed: [],
          };
        };

        const result = withAnnotatedInnerState(
          context.state,
          effectiveInnerState,
          (annotatedInnerState) => {
            const innerContext = annotatedInnerState !== context.state
              ? { ...context, state: annotatedInnerState }
              : context;
            return parser.parse(innerContext);
          },
          parserInheritsAnnotations,
        );
        if (result instanceof Promise) {
          return result.then(processResult);
        }
        return Promise.resolve(processResult(result));
      },

      complete: (state, exec?): Promise<ValueParserResult<TValue>> => {
        if (isPromptBindState(state) && state.hasCliValue) {
          const r = withAnnotatedInnerState(
            state,
            state.cliState!,
            (annotatedInnerState) => parser.complete(annotatedInnerState, exec),
            parserInheritsAnnotations,
          );
          if (r instanceof Promise) {
            return (r as Promise<ValueParserResult<TValue>>).then(
              unwrapCompleteResult,
            );
          }
          return Promise.resolve(
            unwrapCompleteResult(r as ValueParserResult<TValue>),
          );
        }

        const isProbe = exec != null && exec.phase !== "complete";
        const annotations = getAnnotations(state);
        const innerInitialState = parser.initialState;
        const shouldInheritInitialStateAnnotations = annotations != null &&
          (innerInitialState == null ||
            typeof innerInitialState === "object" ||
            parserInheritsAnnotations);
        const effectiveInitialState = shouldInheritInitialStateAnnotations
          ? inheritAnnotations(state, innerInitialState)
          : innerInitialState;

        const readPlaceholder = (): TValue | undefined => {
          try {
            return "placeholder" in parser
              ? parser.placeholder as TValue
              : undefined;
          } catch {
            return undefined;
          }
        };

        const finalizePrompt = (): Promise<ValueParserResult<TValue>> => {
          const shouldDefer = withAnnotatedInnerState(
            state,
            effectiveInitialState,
            (annotatedInnerState) =>
              shouldDeferPrompt(parser, annotatedInnerState, exec),
            parserInheritsAnnotations,
          );
          if (shouldDefer) {
            return Promise.resolve(
              deferredPromptResult(readPlaceholder() as TValue),
            );
          }
          if (isProbe) {
            return Promise.resolve({
              success: true as const,
              value: readPlaceholder() as TValue,
            });
          }
          // When this prompt wraps a dependency source, its execution is
          // coordinated through the run-scoped effectful completion
          // session: a cached result (including a cancellation) is reused
          // so the prompt runs at most once per run, and under the
          // demand-only policy of the phase-two seed pass the prompt
          // defers unless a phase-one consumer demands its source.
          const session = exec?.effectfulCompletionSession;
          const sourceId = promptedParser.dependencyMetadata?.source?.sourceId;
          if (session != null && sourceId != null) {
            const cacheKey = completionCacheKeyFor(exec?.path);
            const cached = session.results.get(cacheKey);
            if (cached != null) {
              // A reused answer is still effectful in origin: mark the
              // source so a later prompted occurrence in the same pass
              // can overwrite it (last occurrence wins).
              session.effectfulSources.add(sourceId);
              return Promise.resolve(cached as ValueParserResult<TValue>);
            }
            if (
              session.policy === "demand-only" &&
              !session.demanded.has(sourceId)
            ) {
              return Promise.resolve(
                deferredPromptResult(readPlaceholder() as TValue),
              );
            }
            // Even when demanded, a derived configuration defers out of
            // the seed pass while any of its dependencies is neither
            // published nor failed: a value bound through a two-pass
            // source context (e.g., a configuration file) arrives only
            // in the final pass, and resolving—or caching a missing-
            // dependency failure—against its absence would poison the
            // whole run.  Dependencies published by earlier prompts in
            // the same pass are visible here, so a demanded prompt
            // chain still resolves in the seed pass.
            if (
              session.policy === "demand-only" &&
              isDerivedPromptConfig(config) &&
              config.dependencyIds.some((id) =>
                exec?.dependencyRuntime?.hasSource(id) !== true &&
                exec?.dependencyRuntime?.isSourceFailed(id) !== true
              )
            ) {
              return Promise.resolve(
                deferredPromptResult(readPlaceholder() as TValue),
              );
            }
            return executePrompt(exec).then((result) => {
              session.results.set(
                cacheKey,
                result as ValueParserResult<unknown>,
              );
              // Record that this source's value now comes from an
              // effectful completion, so a later prompted occurrence of
              // the same source can still overwrite it (last occurrence
              // wins) while structural values keep their precedence.
              session.effectfulSources.add(sourceId);
              return result;
            });
          }
          // A consumer-only prompt with a derived configuration defers
          // during the demand-only seed pass: its dependencies may still
          // be unpublished there, and an answer computed from seed-pass
          // values must not be cached.  It resolves in the final pass,
          // after every source has published.
          if (
            session?.policy === "demand-only" &&
            isDerivedPromptConfig(config)
          ) {
            return Promise.resolve(
              deferredPromptResult(readPlaceholder() as TValue),
            );
          }
          return executePrompt(exec);
        };

        const hasDeferHook = typeof parser.shouldDeferCompletion === "function";

        const decideFromParse = (
          parseResult: ParserResult<TState>,
        ): Promise<ValueParserResult<TValue>> => {
          const consumed = parseResult.success
            ? parseResult.consumed.length
            : 0;
          const cliState = parseResult.success && consumed === 0
            ? parseResult.next.state
            : undefined;
          const cliStateIsInjected = cliState != null &&
            typeof cliState === "object" &&
            unwrapInjectedAnnotationState(cliState) !== cliState;
          const isSourceBinding = shouldCompleteFromSourceBinding(
            cliState,
            state,
          );
          if (!isSourceBinding) {
            return finalizePrompt();
          }
          const completeState = parseResult.success
            ? parseResult.next.state
            : effectiveInitialState;
          const innerR = parser.complete(completeState as TState, exec);
          const handleCompleteResult = (
            res: ValueParserResult<TValue>,
          ): Promise<ValueParserResult<TValue>> => {
            const unwrapped = unwrapCompleteResult(res);
            if (
              unwrapped.success &&
              unwrapped.value === undefined &&
              cliStateIsInjected
            ) {
              return finalizePrompt();
            }
            if (!unwrapped.success) {
              return finalizePrompt();
            }
            return Promise.resolve(unwrapped);
          };
          if (innerR instanceof Promise) {
            return (innerR as Promise<ValueParserResult<TValue>>).then(
              handleCompleteResult,
            );
          }
          return handleCompleteResult(innerR as ValueParserResult<TValue>);
        };

        if (hasDeferHook) {
          const innerR = withAnnotatedInnerState(
            state,
            effectiveInitialState,
            (annotatedInnerState) => parser.complete(annotatedInnerState, exec),
            parserInheritsAnnotations,
          );
          const handleDeferHookResult = (
            res: ValueParserResult<TValue>,
          ): Promise<ValueParserResult<TValue>> => {
            const unwrapped = unwrapCompleteResult(res);
            if (unwrapped.success && unwrapped.value === undefined) {
              return finalizePrompt();
            }
            if (!unwrapped.success) {
              return finalizePrompt();
            }
            return Promise.resolve(unwrapped);
          };
          if (innerR instanceof Promise) {
            return (innerR as Promise<ValueParserResult<TValue>>).then(
              handleDeferHookResult,
            );
          }
          return handleDeferHookResult(innerR as ValueParserResult<TValue>);
        }

        const simParseR = withAnnotatedInnerState(
          state,
          effectiveInitialState,
          (annotatedState) =>
            parser.parse({
              buffer: [],
              state: annotatedState,
              optionsTerminated: false,
              usage: parser.usage,
            }),
          parserInheritsAnnotations,
        );
        if (simParseR instanceof Promise) {
          return (simParseR as Promise<ParserResult<TState>>).then(
            decideFromParse,
          );
        }
        return decideFromParse(simParseR as ParserResult<TState>);
      },

      suggest: (context, prefix) => {
        const innerState = isPromptBindState(context.state)
          ? (context.state.cliState === undefined
            ? parser.initialState
            : context.state.cliState as TState)
          : context.state;
        const innerContext = innerState !== context.state
          ? { ...context, state: innerState }
          : context;

        const innerResult = parser.suggest(innerContext, prefix) as
          | Iterable<unknown>
          | AsyncIterable<unknown>;

        return (async function* () {
          yield* innerResult;
        })() as AsyncIterable<never>;
      },

      getDocFragments(state, upperDefaultValue?) {
        const defaultValue = upperDefaultValue ??
          readDefaultValue(adapter, config);
        return parser.getDocFragments(state, defaultValue as TValue);
      },
    };
    defineTraits(promptedParser, {
      inheritsAnnotations: true,
      ...(getTraits(parser).completesFromSource === true
        ? { completesFromSource: true as const }
        : {}),
    });

    if ("placeholder" in parser) {
      Object.defineProperty(promptedParser, "placeholder", {
        get() {
          try {
            return parser.placeholder as TValue;
          } catch {
            return undefined;
          }
        },
        configurable: true,
        enumerable: false,
      });
    }
    if (typeof parser.normalizeValue === "function") {
      Object.defineProperty(promptedParser, "normalizeValue", {
        value: parser.normalizeValue.bind(parser),
        configurable: true,
        enumerable: false,
      });
    }
    const dependencyMetadata = mapSourceMetadata(
      parser,
      (source: ParserSourceMetadata<M, TValue, TState>) => ({
        ...source,
        extractSourceValue: (state: unknown) => {
          if (!isPromptBindState(state)) {
            return source.extractSourceValue(state);
          }
          return source.extractSourceValue(
            state.cliState ?? state,
          );
        },
        // Originate the effectful completion so the scheduler can run
        // the prompt before dependency replay and register its value.
        // The wrapper's own complete() already handles CLI delegation,
        // source-binding delegation, runtime conditions, deferral, and
        // adapter execution, so it is the completion in its entirety.
        //
        // When the wrapped parser transforms the source value (e.g.,
        // prompt() around a mapped source), the prompt's answer lives in
        // the transformed domain and the pre-transform source value is
        // unrecoverable, so no effectful completion is exposed: the
        // prompt keeps running in the ordinary completion phase and
        // never registers a transformed value under the raw source ID.
        completeSource: source.preservesSourceValue === false ? undefined : (
          state: unknown,
          exec?: ExecutionContext,
        ): Promise<ValueParserResult<unknown> | undefined> =>
          promptedParser.complete(state as TState, exec) as Promise<
            ValueParserResult<unknown>
          >,
        // Without a runtime `when` condition, the prompt always asks and
        // registers its answer, so an absent occurrence still publishes.
        // A conditioned prompt publishes its `otherwise` value when the
        // condition declines, so it stays guaranteed unless that value
        // is `undefined`, which the scheduler never registers.  A
        // wrapped parser whose own chain already declines when missing
        // (e.g. prompt() around an optional()) keeps its explicit
        // `false`: its answer may legitimately be `undefined`.
        ...(source.preservesSourceValue !== false && {
          completesWhenMissing: source.completesWhenMissing !== false &&
            (config.when == null ||
              (config as { readonly otherwise?: unknown }).otherwise !==
                undefined),
        }),
      }),
    );
    // A derived configuration makes this prompt a dependency consumer:
    // the named sources must publish before its effectful completion may
    // run.  The completion capability adds provider edges to the
    // scheduler, propagates demand, and joins failure lineage, whether or
    // not the wrapped parser is itself a source.
    const composedMetadata: typeof dependencyMetadata =
      isDerivedPromptConfig(config)
        ? {
          ...(dependencyMetadata ?? {}),
          completion: { dependencyIds: config.dependencyIds },
        }
        : dependencyMetadata;
    if (composedMetadata != null) {
      Object.defineProperty(promptedParser, "dependencyMetadata", {
        value: composedMetadata,
        configurable: true,
        enumerable: false,
      });
    }

    return fluent(promptedParser);
  };
}
