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
  const contextId = Symbol.for(`@optique/env:${Math.random()}`);
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
  type EnvBindState = {
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
      const result = parser.parse(context);

      if (!(result instanceof Promise)) {
        if (result.success) {
          const nextState = {
            hasCliValue: true,
            cliState: result.next.state,
            ...(annotations && { [annotationKey]: annotations }),
          } as unknown as TState;
          return {
            success: true,
            next: { ...result.next, state: nextState },
            consumed: result.consumed,
          } as ModeValue<M, ParserResult<TState>>;
        }

        const nextState = {
          hasCliValue: false,
          ...(annotations && { [annotationKey]: annotations }),
        } as unknown as TState;
        return {
          success: true,
          next: { ...context, state: nextState },
          consumed: [],
        } as unknown as ModeValue<M, ParserResult<TState>>;
      }

      return result.then((resolvedResult) => {
        if (resolvedResult.success) {
          const nextState = {
            hasCliValue: true,
            cliState: resolvedResult.next.state,
            ...(annotations && { [annotationKey]: annotations }),
          } as unknown as TState;
          return {
            success: true,
            next: { ...resolvedResult.next, state: nextState },
            consumed: resolvedResult.consumed,
          };
        }

        const nextState = {
          hasCliValue: false,
          ...(annotations && { [annotationKey]: annotations }),
        } as unknown as TState;
        return {
          success: true,
          next: { ...context, state: nextState },
          consumed: [],
        };
      }) as ModeValue<M, ParserResult<TState>>;
    },

    complete: (state) => {
      const bindState = state as unknown as EnvBindState;
      if (bindState?.hasCliValue && bindState.cliState !== undefined) {
        return parser.complete(bindState.cliState);
      }

      return getEnvOrDefault(state, options) as ModeValue<
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

function getEnvOrDefault<M extends Mode, TValue>(
  state: unknown,
  options: BindEnvOptions<M, TValue>,
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
    return parsed as ModeValue<M, Result<TValue>>;
  }

  if (options.default !== undefined) {
    return {
      success: true,
      value: options.default,
    } as ModeValue<M, Result<TValue>>;
  }

  return {
    success: false,
    error: message`Missing required environment variable: ${fullKey}.`,
  } as ModeValue<M, Result<TValue>>;
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
