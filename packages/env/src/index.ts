import {
  annotationKey,
  getAnnotations,
  injectAnnotations,
  isInjectedAnnotationState,
} from "@optique/core/annotations";
import type { Annotations, SourceContext } from "@optique/core/context";
import {
  defineTraits,
  delegateSuggestNodes,
  getTraits,
  mapSourceMetadata,
  type ParserSourceMetadata,
} from "@optique/core/extension";
import { envVar, type Message, message, valueSet } from "@optique/core/message";
import {
  dispatchByMode,
  mapModeValue,
  wrapForMode,
} from "@optique/core/mode-dispatch";
import type {
  ExecutionContext,
  Mode,
  ModeValue,
  Parser,
  ParserResult,
  Result,
} from "@optique/core/parser";
import {
  ensureNonEmptyString,
  isValueParser,
  type NonEmptyString,
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";

/**
 * Function type for reading environment variable values.
 *
 * @since 1.0.0
 */
export type EnvSource = (key: string) => string | undefined;

interface EnvSourceData {
  readonly prefix: string;
  readonly source: EnvSource;
}

/**
 * Context for environment-variable-based fallback values.
 *
 * @since 1.0.0
 */
export interface EnvContext extends SourceContext {
  /**
   * Prefix added to all bound keys.
   */
  readonly prefix: string;

  /**
   * Environment value source for this context.
   */
  readonly source: EnvSource;
}

/**
 * Options for creating an environment context.
 *
 * @since 1.0.0
 */
export interface EnvContextOptions {
  /**
   * Optional prefix added to all environment keys.
   *
   * @default ""
   */
  readonly prefix?: string;

  /**
   * Custom environment source function.
   *
   * @default Runtime-specific source (`Deno.env.get` or `process.env`)
   */
  readonly source?: EnvSource;
}

function defaultEnvSource(key: string): string | undefined {
  const denoGlobal = (globalThis as {
    readonly Deno?: { readonly env?: { readonly get?: EnvSource } };
  }).Deno;
  if (typeof denoGlobal?.env?.get === "function") {
    return denoGlobal.env.get(key);
  }
  const processGlobal = (globalThis as {
    readonly process?: { readonly env?: Record<string, string | undefined> };
  }).process;
  return processGlobal?.env?.[key];
}

/**
 * Creates an environment context for use with Optique runners.
 *
 * When calling `context.getAnnotations()` manually, pass the returned
 * annotations to low-level APIs such as `parse()`, `parseAsync()`,
 * `parser.complete()`, `suggest()`, or `getDocPage()`. Since environment
 * contexts are single-pass, `getAnnotations()` can still be called without
 * a phase request. Calling it by itself does not affect later parses.
 *
 * @param options Environment context options.
 * @returns A context that provides environment source annotations.
 * @throws {TypeError} If `prefix` is not a string.
 * @throws {TypeError} If `source` is not a function.
 * @since 1.0.0
 */
export function createEnvContext(options: EnvContextOptions = {}): EnvContext {
  const contextId = Symbol(`@optique/env context:${Math.random()}`);
  const rawSource = options.source;
  if (rawSource !== undefined && typeof rawSource !== "function") {
    throw new TypeError(
      `Expected source to be a function, but got: ${
        rawSource === null
          ? "null"
          : Array.isArray(rawSource)
          ? "array"
          : typeof rawSource
      }.`,
    );
  }
  const source = rawSource ?? defaultEnvSource;
  const rawPrefix = options.prefix;
  if (rawPrefix !== undefined && typeof rawPrefix !== "string") {
    throw new TypeError(
      `Expected prefix to be a string, but got: ${
        rawPrefix === null
          ? "null"
          : Array.isArray(rawPrefix)
          ? "array"
          : typeof rawPrefix
      }.`,
    );
  }
  const prefix = rawPrefix ?? "";

  return {
    id: contextId,
    prefix,
    source,
    phase: "single-pass",

    getAnnotations(): Annotations {
      const sourceData: EnvSourceData = { prefix, source };
      // Use the per-instance contextId as the annotation key so that
      // multiple EnvContext instances can coexist without overwriting each
      // other during mergeAnnotations().  See:
      // https://github.com/dahlia/optique/issues/136
      return { [contextId]: sourceData };
    },

    [Symbol.dispose]() {
      // No-op. Env annotations are detached parse-time snapshots.
    },
  };
}

/**
 * Options for binding a parser to environment values.
 *
 * @template TValue The parser value type.
 * @since 1.0.0
 */
export interface BindEnvOptions<M extends Mode, TValue> {
  /**
   * The environment context to read from.
   */
  readonly context: EnvContext;

  /**
   * Environment variable key without prefix.
   */
  readonly key: string;

  /**
   * Value parser used to parse the environment variable string value.
   *
   * In sync mode, the value parser must also be synchronous.
   * In async mode, either sync or async value parsers are accepted,
   * since the async pipeline can await sync results as well.
   */
  readonly parser: ValueParser<M extends "sync" ? "sync" : Mode, TValue>;

  /**
   * Default value used when neither CLI nor environment provides a value.
   */
  readonly default?: TValue;
}

/**
 * Binds a parser to environment variables with fallback behavior.
 *
 * Priority order:
 *
 *  1. CLI argument value
 *  2. Environment variable value
 *  3. Default value
 *  4. Error
 *
 * @param parser Parser that reads CLI values.
 * @param options Environment binding options.
 * @returns A parser with environment fallback behavior.
 * @throws {TypeError} If `key` is not a string or `parser` is not a valid
 *                    {@link ValueParser}.
 * @throws {Error} If the inner parser throws while parsing or completing a
 *                 value, if the environment source throws while reading a
 *                 variable, if the environment value parser throws while
 *                 parsing the environment variable value, or if the inner
 *                 parser's {@link Parser.validateValue} hook throws while
 *                 re-validating a fallback value (environment variable value
 *                 or configured `default`) — the hook can run even when no
 *                 CLI tokens are parsed (see issue #414).
 * @since 1.0.0
 */
export function bindEnv<
  M extends Mode,
  TValue,
  TState,
>(
  parser: Parser<M, TValue, TState>,
  options: BindEnvOptions<M, TValue>,
): Parser<M, TValue, TState> {
  if (typeof options.key !== "string") {
    throw new TypeError(
      `Expected key to be a string, but got: ${
        options.key === null
          ? "null"
          : Array.isArray(options.key)
          ? "array"
          : typeof options.key
      }.`,
    );
  }

  if (!isValueParser(options.parser)) {
    throw new TypeError(
      `Expected parser to be a ValueParser, but got: ${
        options.parser === null
          ? "null"
          : Array.isArray(options.parser)
          ? "array"
          : typeof options.parser
      }.`,
    );
  }

  const envBindStateKey: unique symbol = Symbol("@optique/env/bindState");

  type EnvBindState =
    & {
      readonly [K in typeof envBindStateKey]: true;
    }
    & {
      readonly hasCliValue: boolean;
      readonly cliState?: TState;
    };

  function isEnvBindState(value: unknown): value is EnvBindState {
    return value != null &&
      typeof value === "object" &&
      envBindStateKey in value;
  }

  const deferPromptUntilConfigResolves = parser.shouldDeferCompletion;

  // bindEnv() resolves fallbacks through env annotations at completion time,
  // not through synthetic dependency-wrapper states.  Keeping the bound
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
    leadingNames: parser.leadingNames,
    acceptingAnyToken: parser.acceptingAnyToken,
    initialState: parser.initialState,
    getSuggestRuntimeNodes(state: TState, path: readonly PropertyKey[]) {
      const innerState = isEnvBindState(state)
        ? (state.cliState === undefined
          ? parser.initialState
          : state.cliState as TState)
        : state;
      return delegateSuggestNodes(
        parser,
        boundParser,
        state,
        path,
        innerState,
      );
    },

    parse: (context) => {
      const annotations = getAnnotations(context.state);

      // Unwrap state from a previous parse() call.  After a successful
      // parse, object() stores the wrapped { hasCliValue, cliState }
      // state and passes it back on the next iteration.  The inner
      // parser expects its own native state, so we unwrap cliState
      // before delegating.
      const innerState = isEnvBindState(context.state)
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
          // input tokens.  Wrappers like bindConfig or withDefault may
          // return success with consumed: [] when the CLI option is
          // absent; treating those as "CLI provided" would skip the env
          // fallback and break composition.
          const cliConsumed = result.consumed.length > 0;
          const nextState = {
            [envBindStateKey]: true as const,
            hasCliValue: cliConsumed,
            cliState: result.next.state,
            ...(annotations && { [annotationKey]: annotations }),
          } as unknown as TState;
          return {
            success: true,
            ...(result.provisional ? { provisional: true as const } : {}),
            next: { ...result.next, state: nextState },
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

        const nextState = {
          [envBindStateKey]: true as const,
          hasCliValue: false,
          ...(annotations && { [annotationKey]: annotations }),
        } as unknown as TState;
        return {
          success: true,
          next: { ...innerContext, state: nextState },
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
      if (isEnvBindState(state) && state.hasCliValue) {
        return parser.complete(state.cliState!, exec);
      }

      return getEnvOrDefault(
        state,
        options,
        parser.$mode,
        parser,
        isEnvBindState(state)
          ? state.cliState
          : isInjectedAnnotationState(state)
          ? undefined
          : state,
        exec,
      );
    },

    suggest: parser.suggest,
    ...(typeof deferPromptUntilConfigResolves === "function"
      ? {
        shouldDeferCompletion: (
          state: TState,
          exec?: ExecutionContext,
        ) => deferPromptUntilConfigResolves.call(parser, state, exec),
      }
      : {}),
    getDocFragments(state, upperDefaultValue?) {
      const defaultValue = upperDefaultValue ?? options.default;
      return parser.getDocFragments(state, defaultValue);
    },
  };
  defineTraits(boundParser, {
    inheritsAnnotations: true,
    completesFromSource: true,
  });
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
  // can normalize defaults through bindEnv() wrappers.
  if (typeof parser.normalizeValue === "function") {
    Object.defineProperty(boundParser, "normalizeValue", {
      value: parser.normalizeValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  // Forward value validation from inner parser (see issue #414) so
  // that outer bind wrappers (e.g., bindEnv(bindConfig(...))) can
  // revalidate fallback values through the primitive parser's
  // constraints.
  if (typeof parser.validateValue === "function") {
    Object.defineProperty(boundParser, "validateValue", {
      value: parser.validateValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  const dependencyMetadata = mapSourceMetadata(
    parser,
    (sourceMetadata: ParserSourceMetadata<M, TValue, TState>) => ({
      ...sourceMetadata,
      extractSourceValue: (state: unknown) => {
        if (!isEnvBindState(state)) {
          if (sourceMetadata.preservesSourceValue) {
            return getEnvSourceValue(
              state,
              options,
              state,
              sourceMetadata.extractSourceValue,
              parser,
            );
          }
          return sourceMetadata.extractSourceValue(state);
        }
        if (state.hasCliValue) {
          return sourceMetadata.extractSourceValue(
            state.cliState,
          );
        }
        const innerState = state.cliState ?? state;
        if (!sourceMetadata.preservesSourceValue) {
          return sourceMetadata.extractSourceValue(innerState);
        }
        return getEnvSourceValue(
          state,
          options,
          innerState,
          sourceMetadata.extractSourceValue,
          parser,
        );
      },
    }),
  );
  if (dependencyMetadata != null) {
    Object.defineProperty(boundParser, "dependencyMetadata", {
      value: dependencyMetadata,
      configurable: true,
      enumerable: false,
    });
  }
  return boundParser;
}

/**
 * Resolves a `bindEnv()` fallback value with env > default > inner
 * `complete()` priority, running each candidate through the inner
 * parser's `validateValue()` hook when available so the inner CLI
 * parser's constraints are enforced on fallback values (see issue
 * #414).
 *
 * @param state The wrapper state, which may carry env annotations.
 * @param options The binding options with lookup and default settings.
 * @param mode The parser mode (`"sync"` or `"async"`), used to
 *             dispatch env parsing and fallback validation.
 * @param innerParser Optional wrapped parser.  When present, its
 *                    `validateValue()` hook is used to re-validate
 *                    fallback values and its `complete()` is
 *                    delegated to as the last fallback.
 * @param innerState Optional unwrapped inner state to pass through to
 *                   `innerParser.complete()`.
 * @param exec Optional execution context forwarded to
 *             `innerParser.complete()`.
 * @returns The resolved value as a mode-dependent result.
 * @throws {Error} Propagates errors thrown by the env source callback
 *                 (`sourceData.source(fullKey)`) while reading the
 *                 environment variable.
 * @throws {Error} Propagates errors thrown by
 *                 `options.parser.parse(rawValue)` (sync or async)
 *                 while parsing the raw env string into `TValue`.
 * @throws {Error} Propagates errors thrown by
 *                 `innerParser.validateValue()` while re-validating
 *                 a successful env-sourced value or the configured
 *                 `default` against the inner CLI parser's
 *                 constraints.
 * @throws {Error} Propagates errors thrown by `innerParser.complete()`
 *                 when falling through to the inner parser (e.g.,
 *                 `bindEnv(bindConfig(...))` with neither env nor
 *                 default set).
 */
function getEnvOrDefault<M extends Mode, TValue>(
  state: unknown,
  options: BindEnvOptions<M, TValue>,
  mode: M,
  innerParser?: Parser<M, TValue, unknown>,
  innerState?: unknown,
  exec?: ExecutionContext,
): ModeValue<M, Result<TValue>> {
  const annotations = getAnnotations(state);
  // Read from the per-instance context id so that the correct source is
  // selected even when annotations from multiple env contexts are merged.
  // See: https://github.com/dahlia/optique/issues/136
  const sourceData = annotations?.[options.context.id] as
    | EnvSourceData
    | undefined;

  const fullKey = `${
    sourceData?.prefix ?? options.context.prefix
  }${options.key}`;
  const rawValue = sourceData?.source(fullKey);

  // Helper that runs a (successful) fallback value through the inner
  // parser's validateValue() hook (#414).  The env parser
  // (`options.parser`) can be looser than the inner CLI parser, and
  // configured defaults bypass any validation entirely, so we pipe
  // every fallback value through the inner parser's constraints when
  // it exposes a validator.  If the inner parser does not implement
  // validateValue (e.g., it sits behind map()), we return the value
  // unchanged to preserve existing behavior.
  const validateSync = (
    parsed: ValueParserResult<TValue>,
  ): ValueParserResult<TValue> => {
    if (!parsed.success) return parsed;
    if (
      innerParser == null || typeof innerParser.validateValue !== "function"
    ) {
      return parsed;
    }
    return innerParser.validateValue(
      parsed.value,
    ) as ValueParserResult<TValue>;
  };
  const validateAsync = async (
    parsed: ValueParserResult<TValue>,
  ): Promise<ValueParserResult<TValue>> => {
    if (!parsed.success) return parsed;
    if (
      innerParser == null || typeof innerParser.validateValue !== "function"
    ) {
      return parsed;
    }
    return await innerParser.validateValue(parsed.value);
  };

  if (rawValue !== undefined) {
    if (typeof rawValue !== "string") {
      const type = rawValue === null
        ? "null"
        : Array.isArray(rawValue)
        ? "array"
        : typeof rawValue;
      return wrapForMode(mode, {
        success: false as const,
        error: message`Environment variable ${
          envVar(fullKey)
        } must be a string, but got: ${type}.`,
      });
    }
    // Parse through the env value parser first (its own constraints),
    // then pipe the result through the inner CLI parser's validator so
    // that the inner parser's constraints are enforced even when
    // `options.parser` is a looser value parser than the one the
    // inner parser was constructed with (#414).
    return dispatchByMode(
      mode,
      () => {
        const parsed = (options.parser as ValueParser<"sync", TValue>)
          .parse(rawValue);
        return validateSync(parsed);
      },
      async () => {
        const parsed = await options.parser.parse(rawValue);
        return await validateAsync(parsed);
      },
    );
  }

  if (options.default !== undefined) {
    return dispatchByMode(
      mode,
      () => validateSync({ success: true as const, value: options.default! }),
      () => validateAsync({ success: true as const, value: options.default! }),
    );
  }

  // When the env variable is absent and no default is provided, fall back
  // to the inner parser's complete() so that downstream wrappers (e.g.,
  // bindConfig) can still supply their own value.  Without this, composing
  // bindEnv(bindConfig(...)) would always fail with "Missing required
  // environment variable" when the env var is unset, even if the config
  // layer has a value.
  if (innerParser != null) {
    const completeState = innerState ??
      (annotations != null &&
          innerParser.initialState == null &&
          getTraits(innerParser).inheritsAnnotations === true
        ? injectAnnotations(innerParser.initialState, annotations)
        : innerParser.initialState);
    return wrapForMode(mode, innerParser.complete(completeState, exec));
  }

  return wrapForMode(mode, {
    success: false as const,
    error: message`Missing required environment variable: ${envVar(fullKey)}`,
  });
}

/**
 * Resolves an env-backed dependency source with env and default fallbacks.
 *
 * This first checks annotations for the bound variable. If no env-backed value
 * is available, it falls back to `options.default` and finally delegates to
 * the wrapped parser's source extractor.
 *
 * When `innerParser` exposes a `validateValue` hook, env-sourced values
 * and the configured default are re-validated against the inner parser's
 * CLI constraints (see issue #414).  This is only called from the
 * `preservesSourceValue: true` branch in {@link bindEnv}, so the source
 * value type is guaranteed to equal `TValue`.
 *
 * @param state The wrapper state, which may carry env annotations.
 * @param options The binding options with lookup and default settings.
 * @param innerState The unwrapped inner state for delegated extraction.
 * @param extractInnerSourceValue The wrapped parser's source extractor.
 * @param innerParser The wrapped parser, used to revalidate fallback values.
 * @returns The resolved source value, an async source value, or `undefined`.
 * @throws {Error} Propagates errors thrown by the env source callback
 *                 (`sourceData.source(fullKey)`).
 * @throws {Error} Propagates errors thrown by `options.parser.parse(rawValue)`.
 * @throws {Error} Propagates errors thrown by
 *                 `innerParser.validateValue()` while revalidating a
 *                 successful env-sourced value or the configured
 *                 `default` against the inner CLI parser's constraints
 *                 (see issue #414).
 */
function getEnvSourceValue<M extends Mode, TValue>(
  state: unknown,
  options: BindEnvOptions<M, TValue>,
  innerState: unknown,
  extractInnerSourceValue: (
    state: unknown,
  ) =>
    | ValueParserResult<unknown>
    | Promise<ValueParserResult<unknown> | undefined>
    | undefined,
  innerParser?: Parser<M, TValue, unknown>,
):
  | ValueParserResult<unknown>
  | Promise<ValueParserResult<unknown> | undefined>
  | undefined {
  const annotations = getAnnotations(state);
  const sourceData = annotations?.[options.context.id] as
    | EnvSourceData
    | undefined;

  const fullKey = `${
    sourceData?.prefix ?? options.context.prefix
  }${options.key}`;
  const rawValue = sourceData?.source(fullKey);

  // Runs a successful fallback result through the inner parser's
  // validateValue() when available.  Since getEnvSourceValue is only
  // invoked from the preservesSourceValue: true branch, the source
  // value type matches TValue so validation is type-safe (#414).
  const validateFallback = (
    parsed: ValueParserResult<TValue>,
  ):
    | ValueParserResult<unknown>
    | Promise<ValueParserResult<unknown>> => {
    if (!parsed.success) return parsed;
    if (
      innerParser == null || typeof innerParser.validateValue !== "function"
    ) {
      return parsed;
    }
    return innerParser.validateValue(parsed.value) as
      | ValueParserResult<unknown>
      | Promise<ValueParserResult<unknown>>;
  };

  if (rawValue !== undefined) {
    if (typeof rawValue !== "string") {
      const type = rawValue === null
        ? "null"
        : Array.isArray(rawValue)
        ? "array"
        : typeof rawValue;
      return {
        success: false as const,
        error: message`Environment variable ${
          envVar(fullKey)
        } must be a string, but got: ${type}.`,
      };
    }
    // Route both sync and async env-parse results through the inner
    // parser's validateValue() without manually checking for Promises
    // (see CLAUDE.md: "All mode-based type assertions are isolated in
    // mode-dispatch.ts").
    return mapModeValue(
      options.parser.$mode,
      options.parser.parse(rawValue),
      (p) => validateFallback(p as ValueParserResult<TValue>),
    ) as
      | ValueParserResult<unknown>
      | Promise<ValueParserResult<unknown> | undefined>
      | undefined;
  }

  if (options.default !== undefined) {
    return validateFallback({
      success: true as const,
      value: options.default,
    });
  }

  return extractInnerSourceValue(innerState);
}

/**
 * Options for the {@link bool} parser.
 *
 * @since 1.0.0
 */
export interface BoolOptions {
  /**
   * The metavariable name shown in help text.
   *
   * @default "BOOLEAN"
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for invalid Boolean input.
   */
  readonly errors?: {
    /**
     * Custom error when input is not a recognized Boolean literal.
     */
    readonly invalidFormat?: Message | ((input: string) => Message);
  };
}

const TRUE_LITERALS = ["true", "1", "yes", "on"] as const;
const FALSE_LITERALS = ["false", "0", "no", "off"] as const;

/**
 * Creates a Boolean value parser that accepts common true/false literals.
 *
 * Accepted values (case-insensitive):
 *
 *  -  True: `true`, `1`, `yes`, `on`
 *  -  False: `false`, `0`, `no`, `off`
 *
 * @param options Parser configuration options.
 * @returns A value parser for Boolean values.
 * @throws {TypeError} If `options.metavar` is an empty string.
 * @since 1.0.0
 */
export function bool(options: BoolOptions = {}): ValueParser<"sync", boolean> {
  const metavar = options.metavar ?? "BOOLEAN";
  ensureNonEmptyString(metavar);

  return {
    $mode: "sync",
    metavar,
    placeholder: false,
    choices: [true, false],
    parse(input: string): ValueParserResult<boolean> {
      const normalized = input.trim().toLowerCase();

      if (
        TRUE_LITERALS.includes(normalized as (typeof TRUE_LITERALS)[number])
      ) {
        return { success: true, value: true };
      }

      if (
        FALSE_LITERALS.includes(
          normalized as (typeof FALSE_LITERALS)[number],
        )
      ) {
        return { success: true, value: false };
      }

      return {
        success: false,
        error: options.errors?.invalidFormat
          ? (typeof options.errors.invalidFormat === "function"
            ? options.errors.invalidFormat(input)
            : options.errors.invalidFormat)
          : message`Invalid Boolean value: ${input}. Expected one of ${
            valueSet([...TRUE_LITERALS, ...FALSE_LITERALS], {
              fallback: "",
              locale: "en-US",
            })
          }`,
      };
    },
    format(value: boolean): string {
      return value ? "true" : "false";
    },
    suggest(prefix: string) {
      const allLiterals = [...TRUE_LITERALS, ...FALSE_LITERALS];
      const normalizedPrefix = prefix.toLowerCase();
      return allLiterals
        .filter((lit) => lit.startsWith(normalizedPrefix))
        .map((lit) => ({ kind: "literal" as const, text: lit }));
    },
  };
}
