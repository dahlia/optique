import { formatMessage, type Message, message, text } from "./message.ts";
import type { DocState, Parser } from "./parser.ts";

/**
 * Creates a parser that makes another parser optional, allowing it to succeed
 * without consuming input if the wrapped parser fails to match.
 * If the wrapped parser succeeds, this returns its value.
 * If the wrapped parser fails, this returns `undefined` without consuming input.
 * @template TValue The type of the value returned by the wrapped parser.
 * @template TState The type of the state used by the wrapped parser.
 * @param parser The {@link Parser} to make optional.
 * @returns A {@link Parser} that produces either the result of the wrapped parser
 *          or `undefined` if the wrapped parser fails to match.
 */
export function optional<TValue, TState>(
  parser: Parser<TValue, TState>,
): Parser<TValue | undefined, [TState] | undefined> {
  return {
    $valueType: [],
    $stateType: [],
    priority: parser.priority,
    usage: [{ type: "optional", terms: parser.usage }],
    initialState: undefined,
    parse(context) {
      const result = parser.parse({
        ...context,
        state: typeof context.state === "undefined"
          ? parser.initialState
          : context.state[0],
      });
      if (result.success) {
        return {
          success: true,
          next: {
            ...result.next,
            state: [result.next.state],
          },
          consumed: result.consumed,
        };
      }
      // If inner parser failed without consuming input, return success
      // with undefined state so complete() can provide undefined value
      if (result.consumed === 0) {
        return {
          success: true,
          next: context,
          consumed: [],
        };
      }
      return result;
    },
    complete(state) {
      if (typeof state === "undefined") {
        return {
          success: true,
          value: undefined,
        };
      }
      return parser.complete(state[0]);
    },
    suggest(context, prefix) {
      // Delegate to wrapped parser
      const innerState = typeof context.state === "undefined"
        ? parser.initialState
        : context.state[0];

      return parser.suggest({
        ...context,
        state: innerState,
      }, prefix);
    },
    getDocFragments(
      state: DocState<[TState] | undefined>,
      defaultValue?: TValue,
    ) {
      const innerState: DocState<TState> = state.kind === "unavailable"
        ? { kind: "unavailable" }
        : state.state === undefined
        ? { kind: "unavailable" }
        : { kind: "available", state: state.state[0] };
      return parser.getDocFragments(innerState, defaultValue);
    },
  };
}

/**
 * Options for the {@link withDefault} parser.
 */
export interface WithDefaultOptions {
  /**
   * Custom message to display in help output instead of the formatted default value.
   * This allows showing descriptive text like "SERVICE_URL environment variable"
   * instead of the actual default value.
   *
   * @example
   * ```typescript
   * withDefault(
   *   option("--url", url()),
   *   process.env["SERVICE_URL"],
   *   { message: message`${envVar("SERVICE_URL")} environment variable` }
   * )
   * ```
   */
  readonly message?: Message;
}

/**
 * Error type for structured error messages in {@link withDefault} default value callbacks.
 * Unlike regular errors that only support string messages, this error type accepts
 * a {@link Message} object that supports rich formatting, colors, and structured content.
 *
 * @example
 * ```typescript
 * withDefault(option("--url", url()), () => {
 *   if (!process.env.INSTANCE_URL) {
 *     throw new WithDefaultError(
 *       message`Environment variable ${envVar("INSTANCE_URL")} is not set.`
 *     );
 *   }
 *   return new URL(process.env.INSTANCE_URL);
 * })
 * ```
 *
 * @since 0.5.0
 */
export class WithDefaultError extends Error {
  /**
   * The structured message associated with this error.
   */
  readonly errorMessage: Message;

  /**
   * Creates a new WithDefaultError with a structured message.
   * @param message The structured {@link Message} describing the error.
   */
  constructor(message: Message) {
    super(formatMessage(message));
    this.errorMessage = message;
    this.name = "WithDefaultError";
  }
}

/**
 * Creates a parser that makes another parser use a default value when it fails
 * to match or consume input. This is similar to {@link optional}, but instead
 * of returning `undefined` when the wrapped parser doesn't match, it returns
 * a specified default value.
 * @template TValue The type of the value returned by the wrapped parser.
 * @template TState The type of the state used by the wrapped parser.
 * @template TDefault The type of the default value.
 * @param parser The {@link Parser} to wrap with default behavior.
 * @param defaultValue The default value to return when the wrapped parser
 *                     doesn't match or consume input. Can be a value of type
 *                     {@link TDefault} or a function that returns such a value.
 * @returns A {@link Parser} that produces either the result of the wrapped parser
 *          or the default value if the wrapped parser fails to match
 *          (union type {@link TValue} | {@link TDefault}).
 */
export function withDefault<TValue, TState, TDefault = TValue>(
  parser: Parser<TValue, TState>,
  defaultValue: TDefault | (() => TDefault),
): Parser<TValue | TDefault, [TState] | undefined>;

/**
 * Creates a parser that makes another parser use a default value when it fails
 * to match or consume input. This is similar to {@link optional}, but instead
 * of returning `undefined` when the wrapped parser doesn't match, it returns
 * a specified default value.
 * @template TValue The type of the value returned by the wrapped parser.
 * @template TState The type of the state used by the wrapped parser.
 * @template TDefault The type of the default value.
 * @param parser The {@link Parser} to wrap with default behavior.
 * @param defaultValue The default value to return when the wrapped parser
 *                     doesn't match or consume input. Can be a value of type
 *                     {@link TDefault} or a function that returns such a value.
 * @param options Optional configuration including custom help display message.
 * @returns A {@link Parser} that produces either the result of the wrapped parser
 *          or the default value if the wrapped parser fails to match
 *          (union type {@link TValue} | {@link TDefault}).
 * @since 0.5.0
 */
export function withDefault<TValue, TState, TDefault = TValue>(
  parser: Parser<TValue, TState>,
  defaultValue: TDefault | (() => TDefault),
  options?: WithDefaultOptions,
): Parser<TValue | TDefault, [TState] | undefined>;

export function withDefault<TValue, TState, TDefault = TValue>(
  parser: Parser<TValue, TState>,
  defaultValue: TDefault | (() => TDefault),
  options?: WithDefaultOptions,
): Parser<TValue | TDefault, [TState] | undefined> {
  return {
    $valueType: [],
    $stateType: [],
    priority: parser.priority,
    usage: [{ type: "optional", terms: parser.usage }],
    initialState: undefined,
    parse(context) {
      const result = parser.parse({
        ...context,
        state: typeof context.state === "undefined"
          ? parser.initialState
          : context.state[0],
      });
      if (result.success) {
        return {
          success: true,
          next: {
            ...result.next,
            state: [result.next.state],
          },
          consumed: result.consumed,
        };
      }
      // If inner parser failed without consuming input, return success
      // with undefined state so complete() can provide the default value
      if (result.consumed === 0) {
        return {
          success: true,
          next: context,
          consumed: [],
        };
      }
      return result;
    },
    complete(state) {
      if (typeof state === "undefined") {
        try {
          const value = typeof defaultValue === "function"
            ? (defaultValue as () => TDefault)()
            : defaultValue;
          return { success: true, value };
        } catch (error) {
          return {
            success: false,
            error: error instanceof WithDefaultError
              ? error.errorMessage
              : message`${text(String(error))}`,
          };
        }
      }
      return parser.complete(state[0]);
    },
    suggest(context, prefix) {
      // Delegate to wrapped parser
      const innerState = typeof context.state === "undefined"
        ? parser.initialState
        : context.state[0];

      return parser.suggest({
        ...context,
        state: innerState,
      }, prefix);
    },
    getDocFragments(
      state: DocState<[TState] | undefined>,
      upperDefaultValue?: TValue | TDefault,
    ) {
      const innerState: DocState<TState> = state.kind === "unavailable"
        ? { kind: "unavailable" }
        : state.state === undefined
        ? { kind: "unavailable" }
        : { kind: "available", state: state.state[0] };

      const actualDefaultValue = upperDefaultValue != null
        ? upperDefaultValue as TValue
        : typeof defaultValue === "function"
        ? (defaultValue as () => TDefault)() as unknown as TValue
        : defaultValue as unknown as TValue;

      const fragments = parser.getDocFragments(innerState, actualDefaultValue);

      // If a custom message is provided, replace the default field in all entries
      if (options?.message) {
        const modifiedFragments = fragments.fragments.map((fragment) => {
          if (fragment.type === "entry") {
            return {
              ...fragment,
              default: options.message,
            };
          }
          return fragment;
        });
        return {
          ...fragments,
          fragments: modifiedFragments,
        };
      }

      return fragments;
    },
  };
}

/**
 * Creates a parser that transforms the result value of another parser using
 * a mapping function. This enables value transformation while preserving
 * the original parser's parsing logic and state management.
 *
 * The `map()` function is useful for:
 * - Converting parsed values to different types
 * - Applying transformations like string formatting or boolean inversion
 * - Computing derived values from parsed input
 * - Creating reusable transformations that can be applied to any parser
 *
 * @template T The type of the value produced by the original parser.
 * @template U The type of the value produced by the mapping function.
 * @template TState The type of the state used by the original parser.
 * @param parser The {@link Parser} whose result will be transformed.
 * @param transform A function that transforms the parsed value from type T to type U.
 * @returns A {@link Parser} that produces the transformed value of type U
 *          while preserving the original parser's state type and parsing behavior.
 *
 * @example
 * ```typescript
 * // Transform boolean flag to its inverse
 * const parser = object({
 *   disallow: map(option("--allow"), b => !b)
 * });
 *
 * // Transform string to uppercase
 * const upperParser = map(argument(string()), s => s.toUpperCase());
 *
 * // Transform number to formatted string
 * const prefixedParser = map(option("-n", integer()), n => `value: ${n}`);
 * ```
 */
export function map<T, U, TState>(
  parser: Parser<T, TState>,
  transform: (value: T) => U,
): Parser<U, TState> {
  return {
    $valueType: [] as readonly U[],
    $stateType: parser.$stateType,
    priority: parser.priority,
    usage: parser.usage,
    initialState: parser.initialState,
    parse: parser.parse.bind(parser),
    complete(state: TState) {
      const result = parser.complete(state);
      if (result.success) {
        return { success: true, value: transform(result.value) };
      }
      return result;
    },
    suggest(context, prefix) {
      // Delegate to wrapped parser - suggestions are based on input format, not output
      return parser.suggest(context, prefix);
    },
    getDocFragments(state: DocState<TState>, _defaultValue?: U) {
      // Since we can't reverse the transformation, we delegate to the original parser
      // with the original default value (if available). This is acceptable since
      // documentation typically shows the input format, not the transformed output.
      return parser.getDocFragments(state, undefined);
    },
  };
}

/**
 * Options for the {@link multiple} parser.
 */
export interface MultipleOptions {
  /**
   * The minimum number of occurrences required for the parser to succeed.
   * If the number of occurrences is less than this value,
   * the parser will fail with an error.
   * @default `0`
   */
  readonly min?: number;

  /**
   * The maximum number of occurrences allowed for the parser.
   * If the number of occurrences exceeds this value,
   * the parser will fail with an error.
   * @default `Infinity`
   */
  readonly max?: number;

  /**
   * Error messages customization.
   * @since 0.5.0
   */
  readonly errors?: MultipleErrorOptions;
}

/**
 * Options for customizing error messages in the {@link multiple} parser.
 * @since 0.5.0
 */
export interface MultipleErrorOptions {
  /**
   * Error message when fewer than the minimum number of values are provided.
   */
  readonly tooFew?: Message | ((min: number, actual: number) => Message);

  /**
   * Error message when more than the maximum number of values are provided.
   */
  readonly tooMany?: Message | ((max: number, actual: number) => Message);
}

/**
 * Creates a parser that allows multiple occurrences of a given parser.
 * This parser can be used to parse multiple values of the same type,
 * such as multiple command-line arguments or options.
 * @template TValue The type of the value that the parser produces.
 * @template TState The type of the state used by the parser.
 * @param parser The {@link Parser} to apply multiple times.
 * @param options Optional configuration for the parser,
 *                allowing you to specify the minimum and maximum number of
 *                occurrences allowed.
 * @returns A {@link Parser} that produces an array of values
 *          of type {@link TValue} and an array of states
 *          of type {@link TState}.
 */
export function multiple<TValue, TState>(
  parser: Parser<TValue, TState>,
  options: MultipleOptions = {},
): Parser<readonly TValue[], readonly TState[]> {
  const { min = 0, max = Infinity } = options;
  return {
    $valueType: [],
    $stateType: [],
    priority: parser.priority,
    usage: [{ type: "multiple", terms: parser.usage, min }],
    initialState: [],
    parse(context) {
      let added = context.state.length < 1;
      let result = parser.parse({
        ...context,
        state: context.state.at(-1) ?? parser.initialState,
      });
      if (!result.success) {
        if (!added) {
          result = parser.parse({
            ...context,
            state: parser.initialState,
          });
          if (!result.success) return result;
          added = true;
        } else {
          return result;
        }
      }
      return {
        success: true,
        next: {
          ...result.next,
          state: [
            ...(added ? context.state : context.state.slice(0, -1)),
            result.next.state,
          ],
        },
        consumed: result.consumed,
      };
    },
    complete(state) {
      const result = [];
      for (const s of state) {
        const valueResult = parser.complete(s);
        if (valueResult.success) {
          result.push(valueResult.value);
        } else {
          return { success: false, error: valueResult.error };
        }
      }
      if (result.length < min) {
        const customMessage = options.errors?.tooFew;
        return {
          success: false,
          error: customMessage
            ? (typeof customMessage === "function"
              ? customMessage(min, result.length)
              : customMessage)
            : message`Expected at least ${
              text(min.toLocaleString("en"))
            } values, but got only ${
              text(result.length.toLocaleString("en"))
            }.`,
        };
      } else if (result.length > max) {
        const customMessage = options.errors?.tooMany;
        return {
          success: false,
          error: customMessage
            ? (typeof customMessage === "function"
              ? customMessage(max, result.length)
              : customMessage)
            : message`Expected at most ${
              text(max.toLocaleString("en"))
            } values, but got ${text(result.length.toLocaleString("en"))}.`,
        };
      }
      return { success: true, value: result };
    },
    suggest(context, prefix) {
      // Use the most recent state for suggestions, or initial state if empty
      const innerState = context.state.length > 0
        ? context.state.at(-1)!
        : parser.initialState;

      return parser.suggest({
        ...context,
        state: innerState,
      }, prefix);
    },
    getDocFragments(state: DocState<readonly TState[]>, defaultValue?) {
      const innerState: DocState<TState> = state.kind === "unavailable"
        ? { kind: "unavailable" }
        : state.state.length > 0
        ? { kind: "available", state: state.state.at(-1)! }
        : { kind: "unavailable" };
      return parser.getDocFragments(
        innerState,
        defaultValue != null && defaultValue.length > 0
          ? defaultValue[0]
          : undefined,
      );
    },
  };
}
