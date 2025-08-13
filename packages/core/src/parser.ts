import type { ErrorMessage } from "./error.ts";
import type { ValueParser, ValueParserResult } from "./valueparser.ts";

/**
 * Parser interface for command-line argument parsing.
 * @template TValue The type of the value returned by the parser.
 * @template TState The type of the state used during parsing.
 */
export interface Parser<TValue, TState> {
  /**
   * A type tag for the result value of this parser, used for type inference.
   * Usually this is an empty array at runtime, but it does not matter
   * what it contains.
   * @internal
   */
  readonly $valueType: readonly TValue[];

  /**
   * A type tag for the state of this parser, used for type inference.
   * Usually this is an empty array at runtime, but it does not matter
   * what it contains.
   * @internal
   */
  readonly $stateType: readonly TState[];

  /**
   * The priority of this parser, which determines the order in which
   * parsers are applied when multiple parsers are available.  The greater
   * the number, the higher the priority.
   */
  readonly priority: number;

  /**
   * The initial state for this parser.  This is used to initialize the
   * state when parsing starts.
   */
  readonly initialState: TState;

  /**
   * Parses the input context and returns a result indicating
   * whether the parsing was successful or not.
   * @param context The context of the parser, which includes the input buffer
   *                and the current state.
   * @returns A result object indicating success or failure.
   */
  parse(context: ParserContext<TState>): ParserResult<TState>;

  /**
   * Transforms a {@link TState} into a {@link TValue}, if applicable.
   * If the transformation is not applicable, it should return
   * a `ValueParserResult` with `success: false` and an appropriate error
   * message.
   * @param state The current state of the parser, which may contain accumulated
   *              data or context needed to produce the final value.
   * @returns A result object indicating success or failure of
   *          the transformation.  If successful, it should contain
   *          the parsed value of type {@link TValue}.  If not applicable,
   *          it should return an error message.
   */
  complete(state: TState): ValueParserResult<TValue>;
}

/**
 * The context of the parser, which includes the input buffer and the state.
 * @template TState The type of the state used during parsing.
 */
export interface ParserContext<TState> {
  /**
   * The array of input strings that the parser is currently processing.
   */
  readonly buffer: readonly string[];

  /**
   * The current state of the parser, which is used to track
   * the progress of parsing and any accumulated data.
   */
  readonly state: TState;

  /**
   * A flag indicating whether no more options should be parsed and instead
   * the remaining input should be treated as positional arguments.
   * This is typically set when the parser encounters a `--` in the input,
   * which is a common convention in command-line interfaces to indicate
   * that no further options should be processed.
   */
  readonly optionsTerminated: boolean;
}

/**
 * A discriminated union type representing the result of a parser operation.
 * It can either indicate a successful parse with the next state and context,
 * or a failure with an error message.
 * @template TState The type of the state after parsing.  It should match with
 *           the `TState` type of the {@link Parser} interface.
 */
export type ParserResult<TState> =
  | {
    /**
     * Indicates that the parsing operation was successful.
     */
    readonly success: true;

    /**
     * The next context after parsing, which includes the updated input buffer.
     */
    readonly next: ParserContext<TState>;

    /**
     * The input elements consumed by the parser during this operation.
     */
    readonly consumed: readonly string[];
  }
  | {
    /**
     * Indicates that the parsing operation failed.
     */
    readonly success: false;

    /**
     * The number of the consumed input elements.
     */
    readonly consumed: number;

    /**
     * The error message describing why the parsing failed.
     */
    readonly error: ErrorMessage;
  };

/**
 * Creates a parser that always succeeds without consuming any input and
 * produces a constant value of the type {@link T}.
 * @template T The type of the constant value produced by the parser.
 */
export function constant<const T>(value: T): Parser<T, T> {
  return {
    $valueType: [],
    $stateType: [],
    priority: 0,
    initialState: value,
    parse(context) {
      return { success: true, next: context, consumed: [] };
    },
    complete(state) {
      return { success: true, value: state };
    },
  };
}

/**
 * Represents the name of a command-line option.  There are four types of
 * option syntax:
 *
 * - GNU-style long options (`--option`)
 * - POSIX-style short options (`-o`) or Java-style options (`-option`)
 * - MS-DOS-style options (`/o`, `/option`)
 * - Plus-prefixed options (`+o`)
 */
export type OptionName =
  | `--${string}`
  | `-${string}`
  | `/${string}`
  | `+${string}`;

/**
 * Creates a parser for various styles of command-line options that take an
 * argument value, such as `--option=value`, `-o value`, or `/option:value`.
 * @template T The type of value this parser produces.
 * @param args The {@link OptionName}s to parse, followed by
 *             a {@link ValueParser} that defines how to parse the value of
 *             the option.  If no value parser is provided, the option is
 *             treated as a boolean flag.
 * @returns A {@link Parser} that can parse the specified options and their
 *          values.
 */
export function option<T>(
  ...args: readonly [...readonly OptionName[], ValueParser<T>]
): Parser<T, ValueParserResult<T>>;

/**
 * Creates a parser for various styles of command-line options that do not
 * take an argument value, such as `--option`, `-o`, or `/option`.
 * @param optionNames The {@link OptionName}s to parse.
 * @return A {@link Parser} that can parse the specified options as Boolean
 *         flags, producing `true` if the option is present.
 */
export function option(
  ...optionNames: readonly OptionName[]
): Parser<boolean, ValueParserResult<boolean>>;

export function option<T>(
  ...args:
    | readonly [...readonly OptionName[], ValueParser<T>]
    | readonly OptionName[]
): Parser<T | boolean, ValueParserResult<T | boolean>> {
  const valueParser = typeof args[args.length - 1] === "string"
    ? undefined
    : args[args.length - 1] as ValueParser<T>;
  const optionNames = valueParser == null
    ? args as OptionName[]
    : args.slice(0, args.length - 1) as OptionName[];
  return {
    $valueType: [],
    $stateType: [],
    priority: 10,
    initialState: valueParser == null
      ? { success: true, value: false }
      : { success: false, error: `Missing option ${optionNames.join("/")}.` },
    parse(context) {
      if (context.optionsTerminated) {
        return {
          success: false,
          consumed: 0,
          error: "No more options can be parsed.",
        };
      } else if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: "Expected an option, but got end of input.",
        };
      }

      // When the input contains `--` it is a signal to stop parsing
      // options and treat the rest as positional arguments.
      if (context.buffer[0] === "--") {
        return {
          success: true,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: context.state,
            optionsTerminated: true,
          },
          consumed: context.buffer.slice(0, 1),
        };
      }

      // When the input is split by spaces, the first element is the option name
      // E.g., `--option value` or `/O value`
      if ((optionNames as string[]).includes(context.buffer[0])) {
        if (
          context.state.success && (valueParser != null || context.state.value)
        ) {
          return {
            success: false,
            consumed: 1,
            error: `${context.buffer[0]} cannot be used multiple times.`,
          };
        }
        if (valueParser == null) {
          return {
            success: true,
            next: {
              ...context,
              state: { success: true, value: true },
              buffer: context.buffer.slice(1),
            },
            consumed: context.buffer.slice(0, 1),
          };
        }
        if (context.buffer.length < 2) {
          return {
            success: false,
            consumed: 1,
            error: `Option ${
              context.buffer[0]
            } requires a value, but got no value.`, // FIXME
          };
        }
        const result = valueParser.parse(context.buffer[1]);
        return {
          success: true,
          next: {
            ...context,
            state: result,
            buffer: context.buffer.slice(2),
          },
          consumed: context.buffer.slice(0, 2),
        };
      }

      // When the input is not split by spaces, but joined by = or :
      // E.g., `--option=value` or `/O:value`
      const prefixes = optionNames
        .filter((name) => name.startsWith("--") || name.startsWith("/"))
        .map((name) => name.startsWith("/") ? `${name}:` : `${name}=`);
      for (const prefix of prefixes) {
        if (!context.buffer[0].startsWith(prefix)) continue;
        if (
          context.state.success && (valueParser != null || context.state.value)
        ) {
          return {
            success: false,
            consumed: 1,
            error: `${prefix} cannot be used multiple times.`,
          };
        }
        const value = context.buffer[0].slice(prefix.length);
        if (valueParser == null) {
          return {
            success: false,
            consumed: 1,
            error:
              `Option ${prefix} is a Boolean flag, but got a value: ${value}.`, // FIXME
          };
        }
        const result = valueParser.parse(value);
        return {
          success: true,
          next: {
            ...context,
            state: result,
            buffer: context.buffer.slice(1),
          },
          consumed: context.buffer.slice(0, 1),
        };
      }

      if (valueParser == null) {
        // When the input contains bundled options, e.g., `-abc`
        const shortOptions = optionNames.filter(
          (name) => name.match(/^-[^-]$/),
        );
        for (const shortOption of shortOptions) {
          if (!context.buffer[0].startsWith(shortOption)) continue;
          if (
            context.state.success &&
            (valueParser != null || context.state.value)
          ) {
            return {
              success: false,
              consumed: 1,
              error: `${shortOption} cannot be used multiple times.`,
            };
          }
          return {
            success: true,
            next: {
              ...context,
              state: { success: true, value: true },
              buffer: [
                `-${context.buffer[0].slice(2)}`,
                ...context.buffer.slice(1),
              ],
            },
            consumed: [context.buffer[0].slice(0, 2)],
          };
        }
      }

      return {
        success: false,
        consumed: 0,
        error: `No matched option for ${context.buffer[0]}.`,
      };
    },
    complete(state) {
      return state;
    },
    [Symbol.for("Deno.customInspect")]() {
      return `option(${optionNames.map((o) => JSON.stringify(o)).join(", ")})`;
    },
  } satisfies
    & Parser<T | boolean, ValueParserResult<T | boolean>>
    & Record<symbol, unknown>;
}

/**
 * Creates a parser that expects a single argument value.
 * This parser is typically used for positional arguments
 * that are not options or flags.
 * @template T The type of the value produced by the parser.
 * @param valueParser The {@link ValueParser} that defines how to parse
 *                    the argument value.
 * @returns A {@link Parser} that expects a single argument value and produces
 *          the parsed value of type {@link T}.
 */
export function argument<T>(
  valueParser: ValueParser<T>,
): Parser<T, ValueParserResult<T>> {
  const optionPattern = /^--?[a-z0-9-]+$/i;
  return {
    $valueType: [],
    $stateType: [],
    priority: 5,
    initialState: { success: false, error: "Too few arguments." },
    parse(context) {
      if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: "Expected an argument, but got end of input.",
        };
      }

      let i = 0;
      let optionsTerminated = context.optionsTerminated;
      if (
        !optionsTerminated
      ) {
        if (context.buffer[i] === "--") {
          optionsTerminated = true;
          i++;
        } else if (context.buffer[i].match(optionPattern)) {
          return {
            success: false,
            consumed: i,
            error: `Expected an argument, but got an option: ${
              context.buffer[i]
            }.`,
          };
        }
      }

      if (context.buffer.length < i + 1) {
        return {
          success: false,
          consumed: i,
          error: "Expected an argument, but got end of input.",
        };
      }

      const result = valueParser.parse(context.buffer[i]);
      return {
        success: true,
        next: {
          ...context,
          buffer: context.buffer.slice(i + 1),
          state: result,
          optionsTerminated,
        },
        consumed: context.buffer.slice(0, i + 1),
      };
    },
    complete(state) {
      return state;
    },
    [Symbol.for("Deno.customInspect")]() {
      return `argument()`;
    },
  } satisfies
    & Parser<T, ValueParserResult<T>>
    & Record<symbol, unknown>;
}

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
  };
}

/**
 * Creates a parser that combines multiple parsers into a single object parser.
 * Each parser in the object is applied to parse different parts of the input,
 * and the results are combined into an object with the same structure.
 * @template T A record type where each value is a {@link Parser}.
 * @param parsers An object containing named parsers that will be combined
 *                into a single object parser.
 * @returns A {@link Parser} that produces an object with the same keys as
 *          the input, where each value is the result of the corresponding
 *          parser.
 */
export function object<
  T extends { readonly [key: string | symbol]: Parser<unknown, unknown> },
>(
  parsers: T,
): Parser<
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

/**
 * Creates a labeled parser that combines multiple parsers into a single
 * object parser with an associated label for documentation or error reporting.
 * @template T A record type where each value is a {@link Parser}.
 * @param label A descriptive label for this parser group, used for
 *              documentation and error messages.
 * @param parsers An object containing named parsers that will be combined
 *                into a single object parser.
 * @returns A {@link Parser} that produces an object with the same keys as
 *          the input, where each value is the result of the corresponding
 *          parser.
 */
export function object<
  T extends { readonly [key: string | symbol]: Parser<unknown, unknown> },
>(
  label: string,
  parsers: T,
): Parser<
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

export function object<
  T extends { readonly [key: string | symbol]: Parser<unknown, unknown> },
>(
  labelOrParsers: string | T,
  maybeParsers?: T,
): Parser<
  { readonly [K in keyof T]: unknown },
  { readonly [K in keyof T]: unknown }
> {
  const _label: string | undefined = typeof labelOrParsers === "string"
    ? labelOrParsers
    : undefined;
  const parsers = typeof labelOrParsers === "string"
    ? maybeParsers!
    : labelOrParsers;
  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...Object.values(parsers).map((p) => p.priority)),
    initialState: Object.fromEntries(
      Object.entries(parsers).map(([key, parser]) => [
        key,
        parser.initialState,
      ]),
    ) as {
      readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U3)
        ? U3
        : never;
    },
    parse(context) {
      let error: { consumed: number; error: ErrorMessage } = {
        consumed: 0,
        error: context.buffer.length > 0
          ? `Unexpected option or argument: ${context.buffer[0]}.` // FIXME
          : "Expected an option or argument, but got end of input.",
      };
      const parserPairs = Object.entries(parsers);
      parserPairs.sort(([_, parserA], [__, parserB]) =>
        parserB.priority - parserA.priority
      );
      for (const [field, parser] of parserPairs) {
        const result = parser.parse({
          ...context,
          state: context.state[field],
        });
        if (result.success && result.consumed.length > 0) {
          return {
            success: true,
            next: {
              ...context,
              buffer: result.next.buffer,
              optionsTerminated: result.next.optionsTerminated,
              state: {
                ...context.state,
                [field]: result.next.state,
              },
            },
            consumed: result.consumed,
          };
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }
      return { ...error, success: false };
    },
    complete(state) {
      const result: { [K in keyof T]: T[K]["$valueType"][number] } =
        // deno-lint-ignore no-explicit-any
        {} as any;
      for (const field in state) {
        const valueResult = parsers[field].complete(state[field]);
        if (valueResult.success) result[field] = valueResult.value;
        else return { success: false, error: valueResult.error };
      }
      return { success: true, value: result };
    },
  };
}

/**
 * Creates a parser that combines two mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @returns A {@link Parser} that tries to parse using the provided parsers
 *          in order, returning the result of the first successful parser.
 */
export function or<TA, TB, TStateA, TStateB>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
): Parser<
  TA | TB,
  undefined | [0, ParserResult<TStateA>] | [1, ParserResult<TStateB>]
>;

/**
 * Creates a parser that combines three mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 */
export function or<TA, TB, TC, TStateA, TStateB, TStateC>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
): Parser<
  TA | TB | TC,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
>;

/**
 * Creates a parser that combines four mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 */
export function or<TA, TB, TC, TD, TStateA, TStateB, TStateC, TStateD>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
): Parser<
  TA | TB | TC | TD,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
>;

/**
 * Creates a parser that combines five mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 */
export function or<
  TA,
  TB,
  TC,
  TD,
  TE,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
): Parser<
  TA | TB | TC | TD | TE,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
>;

export function or(
  ...parsers: Parser<unknown, unknown>[]
): Parser<unknown, undefined | [number, ParserResult<unknown>]> {
  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    initialState: undefined,
    complete(
      state: undefined | [number, ParserResult<unknown>],
    ): ValueParserResult<unknown> {
      if (state == null) return { success: false, error: "No parser matched." };
      const [i, result] = state;
      if (result.success) return parsers[i].complete(result.next.state);
      return { success: false, error: result.error };
    },
    parse(
      context: ParserContext<[number, ParserResult<unknown>]>,
    ): ParserResult<[number, ParserResult<unknown>]> {
      let error: { consumed: number; error: ErrorMessage } = {
        consumed: 0,
        error: "No parser matched.",
      };
      const orderedParsers = parsers.map((p, i) =>
        [p, i] as [Parser<unknown, unknown>, number]
      );
      orderedParsers.sort(([_, a], [__, b]) =>
        context.state?.[0] === a ? -1 : context.state?.[0] === b ? 1 : a - b
      );
      for (const [parser, i] of orderedParsers) {
        const result = parser.parse({
          ...context,
          state: context.state == null || context.state[0] !== i ||
              !context.state[1].success
            ? parser.initialState
            : context.state[1].next.state,
        });
        if (result.success && result.consumed.length > 0) {
          if (context.state?.[0] !== i && context.state?.[1].success) {
            return {
              success: false,
              consumed: context.buffer.length - result.next.buffer.length,
              error: `${context.state[1].consumed.join(" ")} and ${
                result.consumed.join(" ")
              } cannot be used together.`, // FIXME
            };
          }
          return {
            success: true,
            next: {
              ...context,
              buffer: result.next.buffer,
              optionsTerminated: result.next.optionsTerminated,
              state: [i, result],
            },
            consumed: result.consumed,
          };
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }
      return { ...error, success: false };
    },
  };
}

/**
 * Infers the result value type of a {@link Parser}.
 * @template T The {@link Parser} to infer the result value type from.
 */
export type InferValue<T extends Parser<unknown, unknown>> =
  T["$valueType"][number];

/**
 * The result type of a whole parser operation, which can either be a successful
 * result with a value of type `T`, or a failure with an error message.
 * @template T The type of the value produced by the parser.
 */
export type Result<T> =
  | {
    /**
     * Indicates that the parsing operation was successful.
     */
    success: true;
    /**
     * The successfully parsed value of type {@link T}.
     * This is the final result of the parsing operation after all parsers
     * have been applied and completed.
     */
    value: T;
  }
  | {
    /**
     * Indicates that the parsing operation failed.
     */
    success: false;
    /**
     * The error message describing why the parsing failed.
     */
    error: ErrorMessage;
  };

/**
 * Parses an array of command-line arguments using the provided combined parser.
 * This function processes the input arguments, applying the parser to each
 * argument until all arguments are consumed or an error occurs.
 * @template T The type of the value produced by the parser.
 * @param parser The combined {@link Parser} to use for parsing the input
 *               arguments.
 * @param args The array of command-line arguments to parse.  Usually this is
 *             `process.argv.slice(2)` in Node.js or `Deno.args` in Deno.
 * @returns A {@link Result} object indicating whether the parsing was
 *          successful or not.  If successful, it contains the parsed value of
 *          type `T`.  If not, it contains an error message describing the
 *          failure.
 */
export function parse<T>(
  parser: Parser<T, unknown>,
  args: readonly string[],
): Result<T> {
  let context: ParserContext<unknown> = {
    buffer: args,
    optionsTerminated: false,
    state: parser.initialState,
  };
  do {
    const result = parser.parse(context);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    context = result.next;
  } while (context.buffer.length > 0);
  const endResult = parser.complete(context.state);
  return endResult.success
    ? { success: true, value: endResult.value }
    : { success: false, error: endResult.error };
}
