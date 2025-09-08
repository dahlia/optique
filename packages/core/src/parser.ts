import type {
  DocEntry,
  DocFragment,
  DocFragments,
  DocPage,
  DocSection,
} from "./doc.ts";
import {
  formatMessage,
  type Message,
  message,
  metavar,
  optionName as eOptionName,
  optionNames as eOptionNames,
  text,
  values,
} from "./message.ts";
import {
  normalizeUsage,
  type OptionName,
  type Usage,
  type UsageTerm,
} from "./usage.ts";
import {
  isValueParser,
  type ValueParser,
  type ValueParserResult,
} from "./valueparser.ts";

/**
 * Represents the state passed to getDocFragments.
 * Can be either the actual parser state or an explicit indicator
 * that no state is available.
 * @template TState The type of the actual state when available.
 * @since 0.3.0
 */
export type DocState<TState> =
  | { readonly kind: "available"; readonly state: TState }
  | { readonly kind: "unavailable" };

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
   * The usage information for this parser, which describes how
   * to use it in command-line interfaces.
   */
  readonly usage: Usage;

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

  /**
   * Generates a documentation fragment for this parser, which can be used
   * to describe the parser's usage, description, and default value.
   * @param state The current state of the parser, wrapped in a DocState
   *              to indicate whether the actual state is available or not.
   * @param defaultValue An optional default value that can be used
   *                     to provide a default value in the documentation.
   * @returns {@link DocFragments} object containing documentation
   *          fragments for this parser.
   */
  getDocFragments(state: DocState<TState>, defaultValue?: TValue): DocFragments;
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
    readonly error: Message;
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
    usage: [],
    initialState: value,
    parse(context) {
      return { success: true, next: context, consumed: [] };
    },
    complete(state) {
      return { success: true, value: state };
    },
    getDocFragments(_state: DocState<T>, _defaultValue?) {
      return { fragments: [] };
    },
  };
}

/**
 * Options for the {@link option} parser.
 */
export interface OptionOptions {
  /**
   * The description of the option, which can be used for help messages.
   */
  readonly description?: Message;
}

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
): Parser<T, ValueParserResult<T> | undefined>;

/**
 * Creates a parser for various styles of command-line options that take an
 * argument value, such as `--option=value`, `-o value`, or `/option:value`.
 * @template T The type of value this parser produces.
 * @param args The {@link OptionName}s to parse, followed by
 *             a {@link ValueParser} that defines how to parse the value of
 *             the option, and an optional {@link OptionOptions} object
 *             that allows you to specify a description or other metadata.
 * @returns A {@link Parser} that can parse the specified options and their
 *          values.
 */
export function option<T>(
  ...args: readonly [...readonly OptionName[], ValueParser<T>, OptionOptions]
): Parser<T, ValueParserResult<T> | undefined>;

/**
 * Creates a parser for various styles of command-line options that do not
 * take an argument value, such as `--option`, `-o`, or `/option`.
 * @param optionNames The {@link OptionName}s to parse.
 * @return A {@link Parser} that can parse the specified options as Boolean
 *         flags, producing `true` if the option is present.
 */
export function option(
  ...optionNames: readonly OptionName[]
): Parser<boolean, ValueParserResult<boolean> | undefined>;

/**
 * Creates a parser for various styles of command-line options that take an
 * argument value, such as `--option=value`, `-o value`, or `/option:value`.
 * @param args The {@link OptionName}s to parse, followed by
 *             an optional {@link OptionOptions} object that allows you to
 *             specify a description or other metadata.
 * @returns A {@link Parser} that can parse the specified options and their
 *          values.
 */
export function option(
  ...args: readonly [...readonly OptionName[], OptionOptions]
): Parser<boolean, ValueParserResult<boolean> | undefined>;

export function option<T>(
  ...args:
    | readonly [...readonly OptionName[], ValueParser<T>, OptionOptions]
    | readonly [...readonly OptionName[], ValueParser<T>]
    | readonly [...readonly OptionName[], OptionOptions]
    | readonly OptionName[]
): Parser<T | boolean, ValueParserResult<T | boolean> | undefined> {
  const lastArg = args.at(-1);
  const secondLastArg = args.at(-2);
  let valueParser: ValueParser<T> | undefined;
  let optionNames: OptionName[];
  let options: OptionOptions = {};
  if (isValueParser(lastArg)) {
    valueParser = lastArg;
    optionNames = args.slice(0, -1) as OptionName[];
  } else if (typeof lastArg === "object" && lastArg != null) {
    options = lastArg;
    if (isValueParser(secondLastArg)) {
      valueParser = secondLastArg;
      optionNames = args.slice(0, -2) as OptionName[];
    } else {
      valueParser = undefined;
      optionNames = args.slice(0, -1) as OptionName[];
    }
  } else {
    optionNames = args as OptionName[];
    valueParser = undefined;
  }
  return {
    $valueType: [],
    $stateType: [],
    priority: 10,
    usage: [
      valueParser == null
        ? {
          type: "optional",
          terms: [{ type: "option", names: optionNames }],
        }
        : {
          type: "option",
          names: optionNames,
          metavar: valueParser.metavar,
        },
    ],
    initialState: valueParser == null ? { success: true, value: false } : {
      success: false,
      error: message`Missing option ${eOptionNames(optionNames)}.`,
    },
    parse(context) {
      if (context.optionsTerminated) {
        return {
          success: false,
          consumed: 0,
          error: message`No more options can be parsed.`,
        };
      } else if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: message`Expected an option, but got end of input.`,
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
            error: message`${context.buffer[0]} cannot be used multiple times.`,
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
            error: message`Option ${
              eOptionName(context.buffer[0])
            } requires a value, but got no value.`,
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
            error: message`${
              eOptionName(prefix)
            } cannot be used multiple times.`,
          };
        }
        const value = context.buffer[0].slice(prefix.length);
        if (valueParser == null) {
          return {
            success: false,
            consumed: 1,
            error: message`Option ${
              eOptionName(prefix)
            } is a Boolean flag, but got a value: ${value}.`,
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
              error: message`${
                eOptionName(shortOption)
              } cannot be used multiple times.`,
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
        error: message`No matched option for ${
          eOptionName(context.buffer[0])
        }.`,
      };
    },
    complete(state) {
      if (state == null) {
        return valueParser == null ? { success: true, value: false } : {
          success: false,
          error: message`Missing option ${eOptionNames(optionNames)}.`,
        };
      }
      if (state.success) return state;
      return {
        success: false,
        error: message`${eOptionNames(optionNames)}: ${state.error}`,
      };
    },
    getDocFragments(
      _state: DocState<ValueParserResult<T | boolean> | undefined>,
      defaultValue?,
    ) {
      const fragments: readonly DocFragment[] = [{
        type: "entry",
        term: {
          type: "option",
          names: optionNames,
          metavar: valueParser?.metavar,
        },
        description: options.description,
        default: defaultValue != null && valueParser != null
          ? valueParser.format(defaultValue as T)
          : undefined,
      }];
      return { fragments, description: options.description };
    },
    [Symbol.for("Deno.customInspect")]() {
      return `option(${optionNames.map((o) => JSON.stringify(o)).join(", ")})`;
    },
  } satisfies Parser<T | boolean, ValueParserResult<T | boolean>>;
}

/**
 * Options for the {@link flag} parser.
 */
export interface FlagOptions {
  /**
   * The description of the flag, which can be used for help messages.
   */
  readonly description?: Message;
}

/**
 * Creates a parser for command-line flags that must be explicitly provided.
 * Unlike {@link option}, this parser fails if the flag is not present, making
 * it suitable for required boolean flags that don't have a meaningful default.
 *
 * The key difference from {@link option} is:
 * - {@link option} without a value parser: Returns `false` when not present
 * - {@link flag}: Fails parsing when not present, only produces `true`
 *
 * This is useful for dependent options where the presence of a flag changes
 * the shape of the result type.
 *
 * @param args The {@link OptionName}s to parse, followed by an optional
 *             {@link FlagOptions} object that allows you to specify
 *             a description or other metadata.
 * @returns A {@link Parser} that produces `true` when the flag is present
 *          and fails when it is not present.
 *
 * @example
 * ```typescript
 * // Basic flag usage
 * const parser = flag("-f", "--force");
 * // Succeeds with true: parse(parser, ["-f"])
 * // Fails: parse(parser, [])
 *
 * // With description
 * const verboseFlag = flag("-v", "--verbose", {
 *   description: "Enable verbose output"
 * });
 * ```
 */
export function flag(
  ...args:
    | readonly [...readonly OptionName[], FlagOptions]
    | readonly OptionName[]
): Parser<true, ValueParserResult<true> | undefined> {
  const lastArg = args.at(-1);
  let optionNames: OptionName[];
  let options: FlagOptions = {};

  if (
    typeof lastArg === "object" && lastArg != null && !Array.isArray(lastArg)
  ) {
    options = lastArg as FlagOptions;
    optionNames = args.slice(0, -1) as OptionName[];
  } else {
    optionNames = args as OptionName[];
  }

  return {
    $valueType: [],
    $stateType: [],
    priority: 10,
    usage: [{
      type: "option",
      names: optionNames,
    }],
    initialState: undefined,
    parse(context) {
      if (context.optionsTerminated) {
        return {
          success: false,
          consumed: 0,
          error: message`No more options can be parsed.`,
        };
      } else if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: message`Expected an option, but got end of input.`,
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
      if ((optionNames as string[]).includes(context.buffer[0])) {
        if (context.state?.success) {
          return {
            success: false,
            consumed: 1,
            error: message`${
              eOptionName(context.buffer[0])
            } cannot be used multiple times.`,
          };
        }
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

      // Check for joined format (e.g., --flag=value) which should fail for flags
      const prefixes = optionNames
        .filter((name) => name.startsWith("--") || name.startsWith("/"))
        .map((name) => name.startsWith("/") ? `${name}:` : `${name}=`);
      for (const prefix of prefixes) {
        if (context.buffer[0].startsWith(prefix)) {
          const value = context.buffer[0].slice(prefix.length);
          return {
            success: false,
            consumed: 1,
            error: message`Flag ${
              eOptionName(prefix.slice(0, -1))
            } does not accept a value, but got: ${value}.`,
          };
        }
      }

      // When the input contains bundled options, e.g., `-abc`
      const shortOptions = optionNames.filter(
        (name) => name.match(/^-[^-]$/),
      );
      for (const shortOption of shortOptions) {
        if (!context.buffer[0].startsWith(shortOption)) continue;
        if (context.state?.success) {
          return {
            success: false,
            consumed: 1,
            error: message`${
              eOptionName(shortOption)
            } cannot be used multiple times.`,
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

      return {
        success: false,
        consumed: 0,
        error: message`No matched option for ${
          eOptionName(context.buffer[0])
        }.`,
      };
    },
    complete(state) {
      if (state == null) {
        return {
          success: false,
          error: message`Required flag ${
            eOptionNames(optionNames)
          } is missing.`,
        };
      }
      if (state.success) return { success: true, value: true };
      return {
        success: false,
        error: message`${eOptionNames(optionNames)}: ${state.error}`,
      };
    },
    getDocFragments(
      _state: DocState<ValueParserResult<true> | undefined>,
      _defaultValue?,
    ) {
      const fragments: readonly DocFragment[] = [{
        type: "entry",
        term: {
          type: "option",
          names: optionNames,
        },
        description: options.description,
      }];
      return { fragments, description: options.description };
    },
    [Symbol.for("Deno.customInspect")]() {
      return `flag(${optionNames.map((o) => JSON.stringify(o)).join(", ")})`;
    },
  } satisfies Parser<true, ValueParserResult<true> | undefined>;
}

/**
 * Options for the {@link argument} parser.
 */
export interface ArgumentOptions {
  /**
   * The description of the argument, which can be used for help messages.
   */
  readonly description?: Message;
}

/**
 * Creates a parser that expects a single argument value.
 * This parser is typically used for positional arguments
 * that are not options or flags.
 * @template T The type of the value produced by the parser.
 * @param valueParser The {@link ValueParser} that defines how to parse
 *                    the argument value.
 * @param options Optional configuration for the argument parser,
 *                allowing you to specify a description or other metadata.
 * @returns A {@link Parser} that expects a single argument value and produces
 *          the parsed value of type {@link T}.
 */
export function argument<T>(
  valueParser: ValueParser<T>,
  options: ArgumentOptions = {},
): Parser<T, ValueParserResult<T> | undefined> {
  const optionPattern = /^--?[a-z0-9-]+$/i;
  const term: UsageTerm = { type: "argument", metavar: valueParser.metavar };
  return {
    $valueType: [],
    $stateType: [],
    priority: 5,
    usage: [term],
    initialState: undefined,
    parse(context) {
      if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: message`Expected an argument, but got end of input.`,
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
            error: message`Expected an argument, but got an option: ${
              eOptionName(context.buffer[i])
            }.`,
          };
        }
      }

      if (context.buffer.length < i + 1) {
        return {
          success: false,
          consumed: i,
          error: message`Expected an argument, but got end of input.`,
        };
      }

      if (context.state != null) {
        return {
          success: false,
          consumed: i,
          error: message`The argument ${
            metavar(valueParser.metavar)
          } cannot be used multiple times.`,
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
      if (state == null) {
        return {
          success: false,
          error: message`Expected a ${
            metavar(valueParser.metavar)
          }, but too few arguments.`,
        };
      } else if (state.success) return state;
      return {
        success: false,
        error: message`${metavar(valueParser.metavar)}: ${state.error}`,
      };
    },
    getDocFragments(
      _state: DocState<ValueParserResult<T> | undefined>,
      defaultValue?: T,
    ) {
      const fragments: readonly DocFragment[] = [{
        type: "entry",
        term,
        description: options.description,
        default: defaultValue == null
          ? undefined
          : valueParser.format(defaultValue),
      }];
      return { fragments, description: options.description };
    },
    [Symbol.for("Deno.customInspect")]() {
      return `argument()`;
    },
  } satisfies Parser<T, ValueParserResult<T> | undefined>;
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
 *          or the default value if the wrapped parser fails to match (union type {@link TValue} | {@link TDefault}).
 */
export function withDefault<TValue, TState, TDefault = TValue>(
  parser: Parser<TValue, TState>,
  defaultValue: TDefault | (() => TDefault),
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
    getDocFragments(
      state: DocState<[TState] | undefined>,
      upperDefaultValue?: TValue | TDefault,
    ) {
      const innerState: DocState<TState> = state.kind === "unavailable"
        ? { kind: "unavailable" }
        : state.state === undefined
        ? { kind: "unavailable" }
        : { kind: "available", state: state.state[0] };
      return parser.getDocFragments(
        innerState,
        upperDefaultValue != null
          ? upperDefaultValue as TValue
          : typeof defaultValue === "function"
          ? (defaultValue as () => TDefault)() as unknown as TValue
          : defaultValue as unknown as TValue,
      );
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
        return {
          success: false,
          error: message`Expected at least ${
            text(min.toLocaleString("en"))
          } values, but got only ${text(result.length.toLocaleString("en"))}.`,
        };
      } else if (result.length > max) {
        return {
          success: false,
          error: message`Expected at most ${
            text(max.toLocaleString("en"))
          } values, but got ${text(result.length.toLocaleString("en"))}.`,
        };
      }
      return { success: true, value: result };
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
  const label: string | undefined = typeof labelOrParsers === "string"
    ? labelOrParsers
    : undefined;
  const parsers = typeof labelOrParsers === "string"
    ? maybeParsers!
    : labelOrParsers;
  const parserPairs = Object.entries(parsers);
  parserPairs.sort(([_, parserA], [__, parserB]) =>
    parserB.priority - parserA.priority
  );
  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...Object.values(parsers).map((p) => p.priority)),
    usage: parserPairs.flatMap(([_, p]) => p.usage),
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
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: context.buffer.length > 0
          ? message`Unexpected option or argument: ${context.buffer[0]}.`
          : message`Expected an option or argument, but got end of input.`,
      };

      // Try greedy parsing: attempt to consume as many fields as possible
      let currentContext = context;
      let anySuccess = false;
      const allConsumed: string[] = [];

      // Keep trying to parse fields until no more can be matched
      let madeProgress = true;
      while (madeProgress && currentContext.buffer.length > 0) {
        madeProgress = false;

        for (const [field, parser] of parserPairs) {
          const result = parser.parse({
            ...currentContext,
            state: (currentContext.state &&
                typeof currentContext.state === "object" &&
                field in currentContext.state)
              ? currentContext.state[field]
              : parser.initialState,
          });

          if (result.success && result.consumed.length > 0) {
            currentContext = {
              ...currentContext,
              buffer: result.next.buffer,
              optionsTerminated: result.next.optionsTerminated,
              state: {
                ...currentContext.state,
                [field]: result.next.state,
              },
            };
            allConsumed.push(...result.consumed);
            anySuccess = true;
            madeProgress = true;
            break; // Restart the field loop with updated context
          } else if (!result.success && error.consumed < result.consumed) {
            error = result;
          }
        }
      }

      // If we consumed any input, return success
      if (anySuccess) {
        return {
          success: true,
          next: currentContext,
          consumed: allConsumed,
        };
      }

      // If buffer is empty and no parser consumed input, check if all parsers can complete
      if (context.buffer.length === 0) {
        let allCanComplete = true;
        for (const [field, parser] of parserPairs) {
          const fieldState =
            (context.state && typeof context.state === "object" &&
                field in context.state)
              ? context.state[field]
              : parser.initialState;
          const completeResult = parser.complete(fieldState);
          if (!completeResult.success) {
            allCanComplete = false;
            break;
          }
        }

        if (allCanComplete) {
          return {
            success: true,
            next: context,
            consumed: [],
          };
        }
      }

      return { ...error, success: false };
    },
    complete(state) {
      const result: { [K in keyof T]: T[K]["$valueType"][number] } =
        // deno-lint-ignore no-explicit-any
        {} as any;
      for (const field in state) {
        if (!(field in parsers)) continue;
        const valueResult = parsers[field].complete(state[field]);
        if (valueResult.success) result[field] = valueResult.value;
        else return { success: false, error: valueResult.error };
      }
      return { success: true, value: result };
    },
    getDocFragments(
      state: DocState<{ readonly [K in keyof T]: unknown }>,
      defaultValue?,
    ) {
      const fragments = parserPairs.flatMap(([field, p]) => {
        const fieldState: DocState<unknown> = state.kind === "unavailable"
          ? { kind: "unavailable" }
          : { kind: "available", state: state.state[field] };
        return p.getDocFragments(fieldState, defaultValue?.[field]).fragments;
      });
      const entries: DocEntry[] = fragments.filter((d) => d.type === "entry");
      const sections: DocSection[] = [];
      for (const fragment of fragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }
      const section: DocSection = { title: label, entries };
      sections.push(section);
      return { fragments: sections.map((s) => ({ ...s, type: "section" })) };
    },
  };
}

/**
 * Creates a parser that combines multiple parsers into a sequential tuple parser.
 * The parsers are applied in the order they appear in the array, and all must
 * succeed for the tuple parser to succeed.
 * @template T A readonly array type where each element is a {@link Parser}.
 * @param parsers An array of parsers that will be applied sequentially
 *                to create a tuple of their results.
 * @returns A {@link Parser} that produces a readonly tuple with the same length
 *          as the input array, where each element is the result of the
 *          corresponding parser.
 */
export function tuple<
  const T extends readonly Parser<unknown, unknown>[],
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
 * Creates a labeled parser that combines multiple parsers into a sequential
 * tuple parser with an associated label for documentation or error reporting.
 * @template T A readonly array type where each element is a {@link Parser}.
 * @param label A descriptive label for this parser group, used for
 *              documentation and error messages.
 * @param parsers An array of parsers that will be applied sequentially
 *                to create a tuple of their results.
 * @returns A {@link Parser} that produces a readonly tuple with the same length
 *          as the input array, where each element is the result of the
 *          corresponding parser.
 */
export function tuple<
  const T extends readonly Parser<unknown, unknown>[],
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

export function tuple<
  const T extends readonly Parser<unknown, unknown>[],
>(
  labelOrParsers: string | T,
  maybeParsers?: T,
): Parser<
  { readonly [K in keyof T]: unknown },
  { readonly [K in keyof T]: unknown }
> {
  const label: string | undefined = typeof labelOrParsers === "string"
    ? labelOrParsers
    : undefined;
  const parsers = typeof labelOrParsers === "string"
    ? maybeParsers!
    : labelOrParsers;
  return {
    $valueType: [],
    $stateType: [],
    usage: parsers
      .toSorted((a, b) => b.priority - a.priority)
      .flatMap((p) => p.usage),
    priority: parsers.length > 0
      ? Math.max(...parsers.map((p) => p.priority))
      : 0,
    initialState: parsers.map((parser) => parser.initialState) as {
      readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U3)
        ? U3
        : never;
    },
    parse(context) {
      let currentContext = context;
      const allConsumed: string[] = [];
      const matchedParsers = new Set<number>();

      // Similar to object(), try parsers in priority order but maintain tuple semantics
      while (matchedParsers.size < parsers.length) {
        let foundMatch = false;
        let error: { consumed: number; error: Message } = {
          consumed: 0,
          error: message`No remaining parsers could match the input.`,
        };

        // Create priority-ordered list of remaining parsers
        const remainingParsers = parsers
          .map((parser, index) => [parser, index] as [typeof parser, number])
          .filter(([_, index]) => !matchedParsers.has(index))
          .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

        for (const [parser, index] of remainingParsers) {
          const result = parser.parse({
            ...currentContext,
            state: currentContext.state[index],
          });

          if (result.success && result.consumed.length > 0) {
            // Parser succeeded and consumed input - take this match
            currentContext = {
              ...currentContext,
              buffer: result.next.buffer,
              optionsTerminated: result.next.optionsTerminated,
              state: currentContext.state.map((s, idx) =>
                idx === index ? result.next.state : s
              ) as {
                readonly [K in keyof T]: T[K]["$stateType"][number] extends (
                  infer U4
                ) ? U4
                  : never;
              },
            };

            allConsumed.push(...result.consumed);
            matchedParsers.add(index);
            foundMatch = true;
            break; // Take the first (highest priority) match that consumes input
          } else if (!result.success && error.consumed < result.consumed) {
            error = result;
          }
        }

        // If no consuming parser matched, try non-consuming ones (like optional)
        // or mark failing optional parsers as matched
        if (!foundMatch) {
          for (const [parser, index] of remainingParsers) {
            const result = parser.parse({
              ...currentContext,
              state: currentContext.state[index],
            });

            if (result.success && result.consumed.length < 1) {
              // Parser succeeded without consuming input (like optional)
              currentContext = {
                ...currentContext,
                state: currentContext.state.map((s, idx) =>
                  idx === index ? result.next.state : s
                ) as {
                  readonly [K in keyof T]: T[K]["$stateType"][number] extends (
                    infer U5
                  ) ? U5
                    : never;
                },
              };

              matchedParsers.add(index);
              foundMatch = true;
              break;
            } else if (!result.success && result.consumed < 1) {
              // Parser failed without consuming input - this could be
              // an optional parser that doesn't match.
              // Check if we can safely skip it.
              // For now, mark it as matched to continue processing
              matchedParsers.add(index);
              foundMatch = true;
              break;
            }
          }
        }

        if (!foundMatch) {
          return { ...error, success: false };
        }
      }

      return {
        success: true,
        next: currentContext,
        consumed: allConsumed,
      };
    },
    complete(state) {
      const result: { [K in keyof T]: T[K]["$valueType"][number] } =
        // deno-lint-ignore no-explicit-any
        [] as any;

      for (let i = 0; i < parsers.length; i++) {
        const valueResult = parsers[i].complete(state[i]);
        if (valueResult.success) {
          // deno-lint-ignore no-explicit-any
          (result as any)[i] = valueResult.value;
        } else {
          return { success: false, error: valueResult.error };
        }
      }

      return { success: true, value: result };
    },
    getDocFragments(
      state: DocState<{ readonly [K in keyof T]: unknown }>,
      defaultValue?,
    ) {
      const fragments = parsers.flatMap((p, i) => {
        const indexState: DocState<unknown> = state.kind === "unavailable"
          ? { kind: "unavailable" }
          : {
            kind: "available",
            state: (state.state as readonly unknown[])[i],
          };
        return p.getDocFragments(indexState, defaultValue?.[i]).fragments;
      });
      const entries: DocEntry[] = fragments.filter((d) => d.type === "entry");
      const sections: DocSection[] = [];
      for (const fragment of fragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }
      const section: DocSection = { title: label, entries };
      sections.push(section);
      return { fragments: sections.map((s) => ({ ...s, type: "section" })) };
    },
    [Symbol.for("Deno.customInspect")]() {
      const parsersStr = parsers.length === 1
        ? `[1 parser]`
        : `[${parsers.length} parsers]`;
      return label
        ? `tuple(${JSON.stringify(label)}, ${parsersStr})`
        : `tuple(${parsersStr})`;
    },
  } satisfies Parser<
    { readonly [K in keyof T]: unknown },
    { readonly [K in keyof T]: unknown }
  >;
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

/**
 * Creates a parser that combines six mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
  f: Parser<TF, TStateF>,
): Parser<
  TA | TB | TC | TD | TE | TF,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
>;

/**
 * Creates a parser that combines seven mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
  f: Parser<TF, TStateF>,
  g: Parser<TG, TStateG>,
): Parser<
  TA | TB | TC | TD | TE | TF | TG,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
>;

/**
 * Creates a parser that combines eight mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
  f: Parser<TF, TStateF>,
  g: Parser<TG, TStateG>,
  h: Parser<TH, TStateH>,
): Parser<
  TA | TB | TC | TD | TE | TF | TG | TH,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
>;

/**
 * Creates a parser that combines nine mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
  f: Parser<TF, TStateF>,
  g: Parser<TG, TStateG>,
  h: Parser<TH, TStateH>,
  i: Parser<TI, TStateI>,
): Parser<
  TA | TB | TC | TD | TE | TF | TG | TH | TI,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
>;

/**
 * Creates a parser that combines ten mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TJ The type of the value returned by the tenth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @template TStateJ The type of the state used by the tenth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @param j The tenth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TJ,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
  TStateJ,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
  f: Parser<TF, TStateF>,
  g: Parser<TG, TStateG>,
  h: Parser<TH, TStateH>,
  i: Parser<TI, TStateI>,
  j: Parser<TJ, TStateJ>,
): Parser<
  TA | TB | TC | TD | TE | TF | TG | TH | TI | TJ,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
  | [9, ParserResult<TStateJ>]
>;

export function or(
  ...parsers: Parser<unknown, unknown>[]
): Parser<unknown, undefined | [number, ParserResult<unknown>]> {
  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: [{ type: "exclusive", terms: parsers.map((p) => p.usage) }],
    initialState: undefined,
    complete(
      state: undefined | [number, ParserResult<unknown>],
    ): ValueParserResult<unknown> {
      if (state == null) {
        return { success: false, error: message`No parser matched.` }; // FIXME
      }
      const [i, result] = state;
      if (result.success) return parsers[i].complete(result.next.state);
      return { success: false, error: result.error };
    },
    parse(
      context: ParserContext<[number, ParserResult<unknown>]>,
    ): ParserResult<[number, ParserResult<unknown>]> {
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: context.buffer.length < 1
          ? message`No parser matched.`
          : message`Unexpected option or subcommand: ${
            eOptionName(context.buffer[0])
          }.`,
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
              error: message`${values(context.state[1].consumed)} and ${
                values(result.consumed)
              } cannot be used together.`,
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
    getDocFragments(
      state: DocState<undefined | [number, ParserResult<unknown>]>,
      _defaultValue?,
    ) {
      let description: Message | undefined;
      let fragments: readonly DocFragment[];

      if (state.kind === "unavailable" || state.state == null) {
        // When state is unavailable or null, show all parser options
        fragments = parsers.flatMap((p) =>
          p.getDocFragments({ kind: "unavailable" }, undefined).fragments
        );
      } else {
        // When state is available and has a value, show only the selected parser
        const [index, parserResult] = state.state;
        const innerState: DocState<unknown> = parserResult.success
          ? { kind: "available", state: parserResult.next.state }
          : { kind: "unavailable" };
        const docFragments = parsers[index].getDocFragments(
          innerState,
          undefined,
        );
        description = docFragments.description;
        fragments = docFragments.fragments;
      }
      const entries: DocEntry[] = fragments.filter((f) => f.type === "entry");
      const sections: DocSection[] = [];
      for (const fragment of fragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }
      return {
        description,
        fragments: [
          ...sections.map<DocFragment>((s) => ({ ...s, type: "section" })),
          { type: "section", entries },
        ],
      };
    },
  };
}

/**
 * Creates a parser that combines two mutually exclusive parsers into one,
 * selecting the parser that consumes the most tokens.
 * The resulting parser will try both parsers and return the result
 * of the parser that consumed more input tokens.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @returns A {@link Parser} that tries to parse using both parsers
 *          and returns the result of the parser that consumed more tokens.
 * @since 0.3.0
 */
export function longestMatch<TA, TB, TStateA, TStateB>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
): Parser<
  TA | TB,
  undefined | [0, ParserResult<TStateA>] | [1, ParserResult<TStateB>]
>;

/**
 * Creates a parser that combines three mutually exclusive parsers into one,
 * selecting the parser that consumes the most tokens.
 * The resulting parser will try all parsers and return the result
 * of the parser that consumed the most input tokens.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @returns A {@link Parser} that tries to parse using all parsers
 *          and returns the result of the parser that consumed the most tokens.
 * @since 0.3.0
 */
export function longestMatch<TA, TB, TC, TStateA, TStateB, TStateC>(
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
 * Creates a parser that combines four mutually exclusive parsers into one,
 * selecting the parser that consumes the most tokens.
 * The resulting parser will try all parsers and return the result
 * of the parser that consumed the most input tokens.
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
 * @returns A {@link Parser} that tries to parse using all parsers
 *          and returns the result of the parser that consumed the most tokens.
 * @since 0.3.0
 */
export function longestMatch<
  TA,
  TB,
  TC,
  TD,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
>(
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
 * Creates a parser that combines five mutually exclusive parsers into one,
 * selecting the parser that consumes the most tokens.
 * The resulting parser will try all parsers and return the result
 * of the parser that consumed the most input tokens.
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
 * @returns A {@link Parser} that tries to parse using all parsers
 *          and returns the result of the parser that consumed the most tokens.
 * @since 0.3.0
 */
export function longestMatch<
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

export function longestMatch(
  ...parsers: Parser<unknown, unknown>[]
): Parser<unknown, undefined | [number, ParserResult<unknown>]> {
  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: [{ type: "exclusive", terms: parsers.map((p) => p.usage) }],
    initialState: undefined,
    complete(
      state: undefined | [number, ParserResult<unknown>],
    ): ValueParserResult<unknown> {
      if (state == null) {
        return { success: false, error: message`No parser matched.` };
      }
      const [i, result] = state;
      if (result.success) return parsers[i].complete(result.next.state);
      return { success: false, error: result.error };
    },
    parse(
      context: ParserContext<[number, ParserResult<unknown>]>,
    ): ParserResult<[number, ParserResult<unknown>]> {
      let bestMatch: {
        index: number;
        result: ParserResult<unknown>;
        consumed: number;
      } | null = null;
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: context.buffer.length < 1
          ? message`No parser matched.`
          : message`Unexpected option or subcommand: ${
            eOptionName(context.buffer[0])
          }.`,
      };

      // Try all parsers and find the one with longest match
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        const result = parser.parse({
          ...context,
          state: context.state == null || context.state[0] !== i ||
              !context.state[1].success
            ? parser.initialState
            : context.state[1].next.state,
        });

        if (result.success) {
          const consumed = context.buffer.length - result.next.buffer.length;
          if (bestMatch === null || consumed > bestMatch.consumed) {
            bestMatch = { index: i, result, consumed };
          }
        } else if (error.consumed < result.consumed) {
          error = result;
        }
      }

      if (bestMatch && bestMatch.result.success) {
        return {
          success: true,
          next: {
            ...context,
            buffer: bestMatch.result.next.buffer,
            optionsTerminated: bestMatch.result.next.optionsTerminated,
            state: [bestMatch.index, bestMatch.result],
          },
          consumed: bestMatch.result.consumed,
        };
      }

      return { ...error, success: false };
    },
    getDocFragments(
      state: DocState<undefined | [number, ParserResult<unknown>]>,
      _defaultValue?,
    ) {
      let description: Message | undefined;
      let fragments: readonly DocFragment[];

      if (state.kind === "unavailable" || state.state == null) {
        // When state is unavailable or null, show all parser options
        fragments = parsers.flatMap((p) =>
          p.getDocFragments({ kind: "unavailable" }).fragments
        );
      } else {
        const [i, result] = state.state;
        if (result.success) {
          const docResult = parsers[i].getDocFragments(
            { kind: "available", state: result.next.state },
          );
          description = docResult.description;
          fragments = docResult.fragments;
        } else {
          fragments = parsers.flatMap((p) =>
            p.getDocFragments({ kind: "unavailable" }).fragments
          );
        }
      }

      return { description, fragments };
    },
  };
}

/**
 * Helper type to check if all members of a union are object-like.
 * This allows merge() to work with parsers like withDefault() that produce union types.
 */
type AllObjectLike<T> = T extends readonly unknown[] ? never
  : T extends Record<string | symbol, unknown> ? T
  : never;

/**
 * Helper type to extract object-like types from parser value types,
 * including union types where all members are objects.
 */
type ExtractObjectTypes<P> = P extends Parser<infer V, unknown>
  ? [AllObjectLike<V>] extends [never] ? never
  : V
  : never;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
): Parser<
  & ExtractObjectTypes<TA>
  & ExtractObjectTypes<TB>,
  Record<string | symbol, unknown>
>;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
>(
  label: string,
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
): Parser<
  & ExtractObjectTypes<TA>
  & ExtractObjectTypes<TB>,
  Record<string | symbol, unknown>
>;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
  c: ExtractObjectTypes<TC> extends never ? never : TC,
): Parser<
  & ExtractObjectTypes<TA>
  & ExtractObjectTypes<TB>
  & ExtractObjectTypes<TC>,
  Record<string | symbol, unknown>
>;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
  c: ExtractObjectTypes<TC> extends never ? never : TC,
  d: ExtractObjectTypes<TD> extends never ? never : TD,
  e: ExtractObjectTypes<TE> extends never ? never : TE,
): Parser<
  & ExtractObjectTypes<TA>
  & ExtractObjectTypes<TB>
  & ExtractObjectTypes<TC>
  & ExtractObjectTypes<TD>
  & ExtractObjectTypes<TE>,
  Record<string | symbol, unknown>
>;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @template TI The type of the ninth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @param i The ninth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
  TI extends Parser<unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
  i: TI,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : ExtractObjectTypes<TI> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>
    & ExtractObjectTypes<TI>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @template TI The type of the ninth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @param i The ninth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
  TI extends Parser<unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
  i: TI,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : ExtractObjectTypes<TI> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>
    & ExtractObjectTypes<TI>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @template TI The type of the ninth parser.
 * @template TJ The type of the tenth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @param i The ninth {@link object} parser to merge.
 * @param j The tenth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
  TI extends Parser<unknown, unknown>,
  TJ extends Parser<unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
  i: TI,
  j: TJ,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : ExtractObjectTypes<TI> extends never ? never
  : ExtractObjectTypes<TJ> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>
    & ExtractObjectTypes<TI>
    & ExtractObjectTypes<TJ>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @template TI The type of the ninth parser.
 * @template TJ The type of the tenth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @param i The ninth {@link object} parser to merge.
 * @param j The tenth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
  TI extends Parser<unknown, unknown>,
  TJ extends Parser<unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
  i: TI,
  j: TJ,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : ExtractObjectTypes<TI> extends never ? never
  : ExtractObjectTypes<TJ> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>
    & ExtractObjectTypes<TI>
    & ExtractObjectTypes<TJ>,
    Record<string | symbol, unknown>
  >;

export function merge(
  ...args: [
    string,
    ...Parser<
      Record<string | symbol, unknown>,
      Record<string | symbol, unknown>
    >[],
  ] | Parser<
    Record<string | symbol, unknown>,
    Record<string | symbol, unknown>
  >[]
): Parser<
  Record<string | symbol, unknown>,
  Record<string | symbol, unknown>
> {
  // Check if first argument is a label
  const label = typeof args[0] === "string" ? args[0] : undefined;
  let parsers = typeof args[0] === "string"
    ? args.slice(1) as Parser<
      Record<string | symbol, unknown>,
      Record<string | symbol, unknown>
    >[]
    : args as Parser<
      Record<string | symbol, unknown>,
      Record<string | symbol, unknown>
    >[];

  parsers = parsers.toSorted((a, b) => b.priority - a.priority);
  const initialState: Record<string | symbol, unknown> = {};
  for (const parser of parsers) {
    if (parser.initialState && typeof parser.initialState === "object") {
      for (const field in parser.initialState) {
        initialState[field] = parser.initialState[field];
      }
    }
  }
  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: parsers.flatMap((p) => p.usage),
    initialState,
    parse(context) {
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        // Extract the appropriate state for this parser
        let parserState: unknown;
        if (parser.initialState === undefined) {
          // For parsers with undefined initialState, they might still have state in the merged context
          // We need to pass undefined only if no relevant state exists
          parserState = undefined;
        } else if (
          parser.initialState && typeof parser.initialState === "object"
        ) {
          // For object parsers, extract matching fields from context state
          if (context.state && typeof context.state === "object") {
            const extractedState: Record<string | symbol, unknown> = {};
            for (const field in parser.initialState) {
              extractedState[field] = field in context.state
                ? context.state[field]
                : parser.initialState[field];
            }
            parserState = extractedState;
          } else {
            parserState = parser.initialState;
          }
        } else {
          parserState = parser.initialState;
        }

        const result = parser.parse({
          ...context,
          state: parserState as Parameters<typeof parser.parse>[0]["state"],
        });
        if (result.success) {
          // Handle state merging based on parser type
          let newState: Record<string | symbol, unknown>;
          if (parser.initialState === undefined) {
            // For parsers with undefined initialState (like withDefault()),
            // store their state separately to avoid conflicts with object merging
            newState = {
              ...context.state,
              [`__parser_${i}`]: result.next.state,
            };
          } else {
            // For regular object parsers, use the original merging approach
            newState = {
              ...context.state,
              ...result.next.state,
            };
          }

          return {
            success: true,
            next: {
              ...context,
              buffer: result.next.buffer,
              optionsTerminated: result.next.optionsTerminated,
              state: newState,
            },
            consumed: result.consumed,
          };
        } else if (result.consumed < 1) continue;
        else return result;
      }
      return {
        success: false,
        consumed: 0,
        error: message`No parser matched the input.`,
      };
    },
    complete(state) {
      const object: Record<string | symbol, unknown> = {};
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        // Each parser should get its appropriate state for completion
        let parserState: unknown;
        if (parser.initialState === undefined) {
          // For parsers with undefined initialState (like withDefault()),
          // check if they have accumulated state during parsing
          const key = `__parser_${i}`;
          if (state && typeof state === "object" && key in state) {
            parserState = state[key];
          } else {
            parserState = undefined;
          }
        } else if (
          parser.initialState && typeof parser.initialState === "object"
        ) {
          // For object() parsers, extract their portion of the state
          if (state && typeof state === "object") {
            const extractedState: Record<string | symbol, unknown> = {};
            for (const field in parser.initialState) {
              extractedState[field] = field in state
                ? state[field]
                : parser.initialState[field];
            }
            parserState = extractedState;
          } else {
            parserState = parser.initialState;
          }
        } else {
          parserState = parser.initialState;
        }

        // Type assertion is safe here because we're matching each parser with its expected state type
        const result = parser.complete(
          parserState as Parameters<typeof parser.complete>[0],
        );
        if (!result.success) return result;
        for (const field in result.value) object[field] = result.value[field];
      }
      return { success: true, value: object };
    },
    getDocFragments(
      state: DocState<Record<string | symbol, unknown>>,
      _defaultValue?,
    ) {
      const fragments = parsers.flatMap((p) => {
        // If parser has undefined initialState, indicate state unavailable;
        // otherwise pass the available state
        const parserState = p.initialState === undefined
          ? { kind: "unavailable" as const }
          : state.kind === "unavailable"
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: state.state };
        return p.getDocFragments(parserState, undefined)
          .fragments;
      });
      const entries: DocEntry[] = fragments.filter((f) => f.type === "entry");
      const sections: DocSection[] = [];
      for (const fragment of fragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }

      // If label is provided, wrap all content in a labeled section
      if (label) {
        const labeledSection: DocSection = { title: label, entries };
        sections.push(labeledSection);
        return {
          fragments: sections.map<DocFragment>((s) => ({
            ...s,
            type: "section",
          })),
        };
      }

      return {
        fragments: [
          ...sections.map<DocFragment>((s) => ({ ...s, type: "section" })),
          { type: "section", entries },
        ],
      };
    },
  };
}

/**
 * Concatenates two {@link tuple} parsers into a single parser that produces
 * a flattened tuple containing the values from both parsers in order.
 *
 * This is similar to {@link merge} for object parsers, but operates on tuple
 * parsers and preserves the sequential, positional nature of tuples by
 * flattening the results into a single tuple array.
 *
 * @example
 * ```typescript
 * const basicTuple = tuple([
 *   option("-v", "--verbose"),
 *   option("-p", "--port", integer()),
 * ]);
 *
 * const serverTuple = tuple([
 *   option("-h", "--host", string()),
 *   option("-d", "--debug"),
 * ]);
 *
 * const combined = concat(basicTuple, serverTuple);
 * // Type: Parser<[boolean, number, string, boolean], [BasicState, ServerState]>
 *
 * const result = parse(combined, ["-v", "-p", "8080", "-h", "localhost", "-d"]);
 * // result.value: [true, 8080, "localhost", true]
 * ```
 *
 * @template TA The value type of the first tuple parser.
 * @template TB The value type of the second tuple parser.
 * @template TStateA The state type of the first tuple parser.
 * @template TStateB The state type of the second tuple parser.
 * @param a The first {@link tuple} parser to concatenate.
 * @param b The second {@link tuple} parser to concatenate.
 * @return A new {@link tuple} parser that combines the values of both parsers
 *         into a single flattened tuple.
 * @since 0.2.0
 */
export function concat<
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TStateA,
  TStateB,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
): Parser<[...TA, ...TB], [TStateA, TStateB]>;

/**
 * Concatenates three {@link tuple} parsers into a single parser that produces
 * a flattened tuple containing the values from all parsers in order.
 *
 * @template TA The value type of the first tuple parser.
 * @template TB The value type of the second tuple parser.
 * @template TC The value type of the third tuple parser.
 * @template TStateA The state type of the first tuple parser.
 * @template TStateB The state type of the second tuple parser.
 * @template TStateC The state type of the third tuple parser.
 * @param a The first {@link tuple} parser to concatenate.
 * @param b The second {@link tuple} parser to concatenate.
 * @param c The third {@link tuple} parser to concatenate.
 * @return A new {@link tuple} parser that combines the values of all parsers
 *         into a single flattened tuple.
 * @since 0.2.0
 */
export function concat<
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TC extends readonly unknown[],
  TStateA,
  TStateB,
  TStateC,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
): Parser<[...TA, ...TB, ...TC], [TStateA, TStateB, TStateC]>;

/**
 * Concatenates four {@link tuple} parsers into a single parser that produces
 * a flattened tuple containing the values from all parsers in order.
 *
 * @template TA The value type of the first tuple parser.
 * @template TB The value type of the second tuple parser.
 * @template TC The value type of the third tuple parser.
 * @template TD The value type of the fourth tuple parser.
 * @template TStateA The state type of the first tuple parser.
 * @template TStateB The state type of the second tuple parser.
 * @template TStateC The state type of the third tuple parser.
 * @template TStateD The state type of the fourth tuple parser.
 * @param a The first {@link tuple} parser to concatenate.
 * @param b The second {@link tuple} parser to concatenate.
 * @param c The third {@link tuple} parser to concatenate.
 * @param d The fourth {@link tuple} parser to concatenate.
 * @return A new {@link tuple} parser that combines the values of all parsers
 *         into a single flattened tuple.
 * @since 0.2.0
 */
export function concat<
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TC extends readonly unknown[],
  TD extends readonly unknown[],
  TStateA,
  TStateB,
  TStateC,
  TStateD,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
): Parser<[...TA, ...TB, ...TC, ...TD], [TStateA, TStateB, TStateC, TStateD]>;

/**
 * Concatenates five {@link tuple} parsers into a single parser that produces
 * a flattened tuple containing the values from all parsers in order.
 *
 * @template TA The value type of the first tuple parser.
 * @template TB The value type of the second tuple parser.
 * @template TC The value type of the third tuple parser.
 * @template TD The value type of the fourth tuple parser.
 * @template TE The value type of the fifth tuple parser.
 * @template TStateA The state type of the first tuple parser.
 * @template TStateB The state type of the second tuple parser.
 * @template TStateC The state type of the third tuple parser.
 * @template TStateD The state type of the fourth tuple parser.
 * @template TStateE The state type of the fifth tuple parser.
 * @param a The first {@link tuple} parser to concatenate.
 * @param b The second {@link tuple} parser to concatenate.
 * @param c The third {@link tuple} parser to concatenate.
 * @param d The fourth {@link tuple} parser to concatenate.
 * @param e The fifth {@link tuple} parser to concatenate.
 * @return A new {@link tuple} parser that combines the values of all parsers
 *         into a single flattened tuple.
 * @since 0.2.0
 */
export function concat<
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TC extends readonly unknown[],
  TD extends readonly unknown[],
  TE extends readonly unknown[],
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
  [...TA, ...TB, ...TC, ...TD, ...TE],
  [TStateA, TStateB, TStateC, TStateD, TStateE]
>;

export function concat(
  ...parsers: Parser<readonly unknown[], unknown>[]
): Parser<readonly unknown[], readonly unknown[]> {
  const initialState = parsers.map((parser) => parser.initialState);
  return {
    $valueType: [],
    $stateType: [],
    priority: parsers.length > 0
      ? Math.max(...parsers.map((p) => p.priority))
      : 0,
    usage: parsers.flatMap((p) => p.usage),
    initialState,
    parse(context) {
      let currentContext = context;
      const allConsumed: string[] = [];
      const matchedParsers = new Set<number>();

      // Use the exact same logic as tuple() to avoid infinite loops
      while (matchedParsers.size < parsers.length) {
        let foundMatch = false;
        let error: { consumed: number; error: Message } = {
          consumed: 0,
          error: message`No remaining parsers could match the input.`,
        };

        // Create priority-ordered list of remaining parsers
        const remainingParsers = parsers
          .map((parser, index) => [parser, index] as [typeof parser, number])
          .filter(([_, index]) => !matchedParsers.has(index))
          .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

        for (const [parser, index] of remainingParsers) {
          const result = parser.parse({
            ...currentContext,
            state: currentContext.state[index],
          });

          if (result.success && result.consumed.length > 0) {
            // Parser succeeded and consumed input - take this match
            currentContext = {
              ...currentContext,
              buffer: result.next.buffer,
              optionsTerminated: result.next.optionsTerminated,
              state: currentContext.state.map((s, idx) =>
                idx === index ? result.next.state : s
              ),
            };

            allConsumed.push(...result.consumed);
            matchedParsers.add(index);
            foundMatch = true;
            break; // Take the first (highest priority) match that consumes input
          } else if (!result.success && error.consumed < result.consumed) {
            error = result;
          }
        }

        // If no consuming parser matched, try non-consuming ones (like optional)
        // or mark failing optional parsers as matched
        if (!foundMatch) {
          for (const [parser, index] of remainingParsers) {
            const result = parser.parse({
              ...currentContext,
              state: currentContext.state[index],
            });

            if (result.success && result.consumed.length < 1) {
              // Parser succeeded without consuming input (like optional)
              currentContext = {
                ...currentContext,
                state: currentContext.state.map((s, idx) =>
                  idx === index ? result.next.state : s
                ),
              };

              matchedParsers.add(index);
              foundMatch = true;
              break;
            } else if (!result.success && result.consumed < 1) {
              // Parser failed without consuming input - this could be
              // an optional parser that doesn't match.
              // Check if we can safely skip it.
              // For now, mark it as matched to continue processing
              matchedParsers.add(index);
              foundMatch = true;
              break;
            }
          }
        }

        if (!foundMatch) {
          return { ...error, success: false };
        }
      }

      return {
        success: true,
        next: currentContext,
        consumed: allConsumed,
      };
    },
    complete(state) {
      const results: unknown[] = [];
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        const parserState = state[i];
        const result = parser.complete(parserState);
        if (!result.success) return result;

        // Flatten the tuple results
        if (Array.isArray(result.value)) {
          results.push(...result.value);
        } else {
          results.push(result.value);
        }
      }
      return { success: true, value: results };
    },
    getDocFragments(state: DocState<readonly unknown[]>, _defaultValue?) {
      const fragments = parsers.flatMap((p, index) => {
        const indexState: DocState<unknown> = state.kind === "unavailable"
          ? { kind: "unavailable" }
          : { kind: "available", state: state.state[index] };
        return p.getDocFragments(indexState, undefined).fragments;
      });
      const entries: DocEntry[] = fragments.filter((f) => f.type === "entry");
      const sections: DocSection[] = [];
      for (const fragment of fragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }
      const result: DocFragment[] = [
        ...sections.map<DocFragment>((s) => ({ ...s, type: "section" })),
      ];
      if (entries.length > 0) {
        result.push({ type: "section", entries });
      }
      return { fragments: result };
    },
  };
}

/**
 * Options for the {@link command} parser.
 */
export interface CommandOptions {
  /**
   * A description of the command, used for documentation.
   */
  readonly description?: Message;
}

/**
 * The state type for the {@link command} parser.
 * @template TState The type of the inner parser's state.
 */
type CommandState<TState> =
  | undefined // Command not yet matched
  | ["matched", string] // Command matched but inner parser not started
  | ["parsing", TState]; // Command matched and inner parser active

/**
 * Creates a parser that matches a specific subcommand name and then applies
 * an inner parser to the remaining arguments.
 * This is useful for building CLI tools with subcommands like git, npm, etc.
 * @template T The type of the value returned by the inner parser.
 * @template TState The type of the state used by the inner parser.
 * @param name The subcommand name to match (e.g., `"show"`, `"edit"`).
 * @param parser The {@link Parser} to apply after the command is matched.
 * @param options Optional configuration for the command parser, such as
 *                a description for documentation.
 * @returns A {@link Parser} that matches the command name and delegates
 *          to the inner parser for the remaining arguments.
 */
export function command<T, TState>(
  name: string,
  parser: Parser<T, TState>,
  options: CommandOptions = {},
): Parser<T, CommandState<TState>> {
  return {
    $valueType: [],
    $stateType: [],
    priority: 15, // Higher than options to match commands first
    usage: [{ type: "command", name }, ...parser.usage],
    initialState: undefined,
    parse(context) {
      // Handle different states
      if (context.state === undefined) {
        // Check if buffer starts with our command name
        if (context.buffer.length < 1 || context.buffer[0] !== name) {
          return {
            success: false,
            consumed: 0,
            error: message`Expected command ${eOptionName(name)}, but got ${
              context.buffer.length > 0 ? context.buffer[0] : "end of input"
            }.`,
          };
        }
        // Command matched, consume it and move to "matched" state
        return {
          success: true,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: ["matched", name] as ["matched", string],
          },
          consumed: context.buffer.slice(0, 1),
        };
      } else if (context.state[0] === "matched") {
        // Command was matched, now start the inner parser
        const result = parser.parse({
          ...context,
          state: parser.initialState,
        });
        if (result.success) {
          return {
            success: true,
            next: {
              ...result.next,
              state: ["parsing", result.next.state] as ["parsing", TState],
            },
            consumed: result.consumed,
          };
        }
        return result;
      } else if (context.state[0] === "parsing") {
        // Delegate to inner parser
        const result = parser.parse({
          ...context,
          state: context.state[1],
        });
        if (result.success) {
          return {
            success: true,
            next: {
              ...result.next,
              state: ["parsing", result.next.state] as ["parsing", TState],
            },
            consumed: result.consumed,
          };
        }
        return result;
      }
      // Should never reach here
      return {
        success: false,
        consumed: 0,
        error: message`Invalid command state.`,
      };
    },
    complete(state) {
      if (typeof state === "undefined") {
        return {
          success: false,
          error: message`Command ${eOptionName(name)} was not matched.`,
        };
      } else if (state[0] === "matched") {
        // Command matched but inner parser never started, try to complete with initial state
        return parser.complete(parser.initialState);
      } else if (state[0] === "parsing") {
        // Delegate to inner parser
        return parser.complete(state[1]);
      }
      // Should never reach here
      return {
        success: false,
        error: message`Invalid command state during completion.`,
      };
    },
    getDocFragments(state: DocState<CommandState<TState>>, defaultValue?) {
      if (state.kind === "unavailable" || typeof state.state === "undefined") {
        return {
          description: options.description,
          fragments: [
            {
              type: "entry",
              term: { type: "command", name },
              description: options.description,
            },
          ],
        };
      }
      const innerState: DocState<TState> = state.state[0] === "parsing"
        ? { kind: "available", state: state.state[1] }
        : { kind: "unavailable" };
      const innerFragments = parser.getDocFragments(innerState, defaultValue);
      return {
        ...innerFragments,
        description: innerFragments.description ?? options.description,
      };
    },
    [Symbol.for("Deno.customInspect")]() {
      return `command(${JSON.stringify(name)})`;
    },
  } satisfies Parser<T, CommandState<TState>>;
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
    error: Message;
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
    const previousBuffer = context.buffer;
    context = result.next;

    // If no progress was made (buffer completely unchanged), this indicates
    // a potential infinite loop where the parser succeeds but doesn't consume input
    if (
      context.buffer.length > 0 &&
      context.buffer.length === previousBuffer.length &&
      context.buffer[0] === previousBuffer[0]
    ) {
      return {
        success: false,
        error: message`Unexpected option or argument: ${context.buffer[0]}.`,
      };
    }
  } while (context.buffer.length > 0);
  const endResult = parser.complete(context.state);
  return endResult.success
    ? { success: true, value: endResult.value }
    : { success: false, error: endResult.error };
}

/**
 * Wraps a parser with a group label for documentation purposes.
 *
 * The `group()` function is a documentation-only wrapper that applies a label
 * to any parser for help text organization. This allows you to use clean code
 * structure with combinators like {@link merge} while maintaining well-organized
 * help text through group labeling.
 *
 * The wrapped parser has identical parsing behavior but generates documentation
 * fragments wrapped in a labeled section. This is particularly useful when
 * combining parsers using {@link merge}—you can wrap the merged result with
 * `group()` to add a section header in help output.
 *
 * @example
 * ```typescript
 * const apiOptions = merge(
 *   object({ endpoint: option("--endpoint", string()) }),
 *   object({ timeout: option("--timeout", integer()) })
 * );
 *
 * const groupedApiOptions = group("API Options", apiOptions);
 * // Now produces a labeled "API Options" section in help text
 * ```
 *
 * @example
 * ```typescript
 * // Can be used with any parser, not just merge()
 * const verboseGroup = group("Verbosity", object({
 *   verbose: option("-v", "--verbose"),
 *   quiet: option("-q", "--quiet")
 * }));
 * ```
 *
 * @template TValue The value type of the wrapped parser.
 * @template TState The state type of the wrapped parser.
 * @param label A descriptive label for this parser group, used for
 *              documentation and help text organization.
 * @param parser The parser to wrap with a group label.
 * @returns A new parser that behaves identically to the input parser
 *          but generates documentation within a labeled section.
 * @since 0.4.0
 */
export function group<TValue, TState>(
  label: string,
  parser: Parser<TValue, TState>,
): Parser<TValue, TState> {
  return {
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    usage: parser.usage,
    initialState: parser.initialState,
    parse: (context) => parser.parse(context),
    complete: (state) => parser.complete(state),
    getDocFragments: (state, defaultValue) => {
      const { description, fragments } = parser.getDocFragments(
        state,
        defaultValue,
      );

      // Collect all entries and titled sections
      const allEntries: DocEntry[] = [];
      const titledSections: DocSection[] = [];

      for (const fragment of fragments) {
        if (fragment.type === "entry") {
          allEntries.push(fragment);
        } else if (fragment.type === "section") {
          if (fragment.title) {
            // Preserve sections with titles (nested groups)
            titledSections.push(fragment);
          } else {
            // Merge entries from sections without titles into our labeled section
            allEntries.push(...fragment.entries);
          }
        }
      }

      // Create our labeled section with all collected entries
      const labeledSection: DocSection = { title: label, entries: allEntries };

      return {
        description,
        fragments: [
          ...titledSections.map<DocFragment>((s) => ({
            ...s,
            type: "section",
          })),
          { type: "section", ...labeledSection },
        ],
      };
    },
  };
}

/**
 * Generates a documentation page for a parser based on its current state after
 * attempting to parse the provided arguments. This function is useful for
 * creating help documentation that reflects the current parsing context.
 *
 * The function works by:
 * 1. Attempting to parse the provided arguments to determine the current state
 * 2. Generating documentation fragments from the parser's current state
 * 3. Organizing fragments into entries and sections
 * 4. Resolving command usage terms based on parsed arguments
 *
 * @param parser The parser to generate documentation for
 * @param args Optional array of command-line arguments that have been parsed
 *             so far. Defaults to an empty array. This is used to determine
 *             the current parsing context and generate contextual documentation.
 * @returns A {@link DocPage} containing usage information, sections, and
 *          optional description, or `undefined` if no documentation can be
 *          generated.
 *
 * @example
 * ```typescript
 * const parser = object({
 *   verbose: option("-v", "--verbose"),
 *   port: option("-p", "--port", integer())
 * });
 *
 * // Get documentation for the root parser
 * const rootDoc = getDocPage(parser);
 *
 * // Get documentation after parsing some arguments
 * const contextDoc = getDocPage(parser, ["-v"]);
 * ```
 */
export function getDocPage(
  parser: Parser<unknown, unknown>,
  args: readonly string[] = [],
): DocPage | undefined {
  let context: ParserContext<unknown> = {
    buffer: args,
    optionsTerminated: false,
    state: parser.initialState,
  };
  do {
    const result = parser.parse(context);
    if (!result.success) break;
    context = result.next;
  } while (context.buffer.length > 0);
  const { description, fragments } = parser.getDocFragments(
    { kind: "available", state: context.state },
    undefined,
  );
  const entries: DocEntry[] = fragments.filter((f) => f.type === "entry");
  const sections: DocSection[] = [];
  for (const fragment of fragments) {
    if (fragment.type !== "section") continue;
    if (fragment.title == null) {
      entries.push(...fragment.entries);
    } else {
      sections.push(fragment);
    }
  }
  if (entries.length > 0) {
    sections.push({ entries });
  }
  const usage = [...normalizeUsage(parser.usage)];
  let i = 0;
  for (const arg of args) {
    const term = usage[i];
    if (usage.length > i && term.type === "exclusive") {
      for (const termGroup of term.terms) {
        const firstTerm = termGroup[0];
        if (firstTerm?.type !== "command" || firstTerm.name !== arg) continue;
        usage.splice(i, 1, ...termGroup);
        break;
      }
    }
    i++;
  }
  return description == null
    ? { usage, sections }
    : { usage, sections, description };
}
