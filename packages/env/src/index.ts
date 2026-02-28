import { annotationKey, getAnnotations } from "@optique/core/annotations";
import type { Annotations, SourceContext } from "@optique/core/context";
import { type Message, message, valueSet } from "@optique/core/message";
import type {
  Mode,
  ModeValue,
  Parser,
  ParserResult,
  Result,
} from "@optique/core/parser";
import {
  ensureNonEmptyString,
  type NonEmptyString,
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";

/**
 * Unique symbol for environment source data in annotations.
 *
 * @since 1.0.0
 */
export const envKey: unique symbol = Symbol.for("@optique/env");

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

const activeEnvSourceRegistry: Map<symbol, EnvSourceData> = new Map();

/**
 * Sets active environment source data for a context.
 *
 * @internal
 */
export function setActiveEnvSource(
  contextId: symbol,
  sourceData: EnvSourceData,
): void {
  activeEnvSourceRegistry.set(contextId, sourceData);
}

/**
 * Gets active environment source data for a context.
 *
 * @internal
 */
export function getActiveEnvSource(
  contextId: symbol,
): EnvSourceData | undefined {
  return activeEnvSourceRegistry.get(contextId);
}

/**
 * Clears active environment source data for a context.
 *
 * @internal
 */
export function clearActiveEnvSource(contextId: symbol): void {
  activeEnvSourceRegistry.delete(contextId);
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
 * @param options Environment context options.
 * @returns A context that provides environment source annotations.
 * @since 1.0.0
 */
export function createEnvContext(options: EnvContextOptions = {}): EnvContext {
  const contextId = Symbol(`@optique/env context:${Math.random()}`);
  const source = options.source ?? defaultEnvSource;
  const prefix = options.prefix ?? "";

  return {
    id: contextId,
    prefix,
    source,

    getAnnotations(): Annotations {
      const sourceData: EnvSourceData = { prefix, source };
      setActiveEnvSource(contextId, sourceData);
      return { [envKey]: sourceData };
    },

    [Symbol.dispose]() {
      clearActiveEnvSource(contextId);
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
  const envBindStateKey: unique symbol = Symbol("@optique/env/bindState");

  type EnvBindState =
    & {
      readonly [K in typeof envBindStateKey]: true;
    }
    & {
      readonly hasCliValue: boolean;
      readonly cliState?: TState;
    };

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
      const annotations = getAnnotations(context.state);

      // Unwrap state from a previous parse() call.  After a successful
      // parse, object() stores the wrapped { hasCliValue, cliState }
      // state and passes it back on the next iteration.  The inner
      // parser expects its own native state, so we unwrap cliState
      // before delegating.
      const stateObj = context.state as unknown as EnvBindState | null;
      const innerState = stateObj != null &&
          typeof stateObj === "object" &&
          envBindStateKey in stateObj
        ? (stateObj.hasCliValue
          ? (stateObj.cliState as unknown as TState)
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

      const result = parser.parse(innerContext);

      if (result instanceof Promise) {
        return result.then(processResult) as ModeValue<
          M,
          ParserResult<TState>
        >;
      }

      return processResult(result) as ModeValue<M, ParserResult<TState>>;
    },

    complete: (state) => {
      const bindState = state as unknown as EnvBindState | null;
      const isBound = bindState != null &&
        typeof bindState === "object" &&
        envBindStateKey in bindState;
      if (isBound && bindState.hasCliValue) {
        return parser.complete(bindState.cliState!);
      }

      return getEnvOrDefault(
        state,
        options,
        parser.$mode,
        parser,
        isBound ? bindState.cliState : undefined,
      ) as ModeValue<
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

function wrapForMode<M extends Mode, T>(
  mode: M,
  value: T,
): ModeValue<M, T> {
  if (mode === "async") {
    return Promise.resolve(value) as ModeValue<M, T>;
  }
  return value as ModeValue<M, T>;
}

function getEnvOrDefault<M extends Mode, TValue>(
  state: unknown,
  options: BindEnvOptions<M, TValue>,
  mode: M,
  innerParser?: Parser<M, TValue, unknown>,
  innerState?: unknown,
): ModeValue<M, Result<TValue>> {
  const annotations = getAnnotations(state);
  const sourceData = (annotations?.[envKey] as EnvSourceData | undefined) ??
    getActiveEnvSource(options.context.id);

  const fullKey = `${
    sourceData?.prefix ?? options.context.prefix
  }${options.key}`;
  const rawValue = sourceData?.source(fullKey);
  if (rawValue !== undefined) {
    const parsed = options.parser.parse(rawValue);
    if (parsed instanceof Promise) {
      return parsed as ModeValue<M, Result<TValue>>;
    }
    return wrapForMode(mode, parsed as Result<TValue>);
  }

  if (options.default !== undefined) {
    return wrapForMode(mode, {
      success: true as const,
      value: options.default,
    });
  }

  // When the env variable is absent and no default is provided, fall back
  // to the inner parser's complete() so that downstream wrappers (e.g.,
  // bindConfig) can still supply their own value.  Without this, composing
  // bindEnv(bindConfig(...)) would always fail with "Missing required
  // environment variable" when the env var is unset, even if the config
  // layer has a value.
  if (innerParser != null) {
    const completeState = innerState ?? innerParser.initialState;
    const result = innerParser.complete(completeState);
    if (result instanceof Promise) {
      return result as ModeValue<M, Result<TValue>>;
    }
    return wrapForMode(mode, result as Result<TValue>);
  }

  return wrapForMode(mode, {
    success: false as const,
    error: message`Missing required environment variable: ${fullKey}.`,
  });
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
 * @since 1.0.0
 */
export function bool(options: BoolOptions = {}): ValueParser<"sync", boolean> {
  const metavar = options.metavar ?? "BOOLEAN";
  ensureNonEmptyString(metavar);

  return {
    $mode: "sync",
    metavar,
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
            valueSet([...TRUE_LITERALS, ...FALSE_LITERALS], { locale: "en-US" })
          }`,
      };
    },
    format(value: boolean): string {
      return value ? "true" : "false";
    },
  };
}
