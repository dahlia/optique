import type { DocFragment } from "./doc.ts";
import {
  type Message,
  message,
  metavar,
  optionName as eOptionName,
  optionNames as eOptionNames,
} from "./message.ts";
import type { DocState, Parser, Suggestion } from "./parser.ts";
import {
  createErrorWithSuggestions,
  DEFAULT_FIND_SIMILAR_OPTIONS,
  findSimilar,
} from "./suggestion.ts";
import type { OptionName, UsageTerm } from "./usage.ts";
import { extractCommandNames, extractOptionNames } from "./usage.ts";
import {
  isValueParser,
  type ValueParser,
  type ValueParserResult,
} from "./valueparser.ts";

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
    suggest(_context, _prefix) {
      return [];
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

  /**
   * Error message customization options.
   * @since 0.5.0
   */
  readonly errors?: OptionErrorOptions;
}

/**
 * Options for customizing error messages in the {@link option} parser.
 * @since 0.5.0
 */
export interface OptionErrorOptions {
  /**
   * Custom error message when the option is missing (for required options).
   * Can be a static message or a function that receives the option names.
   */
  missing?: Message | ((optionNames: readonly string[]) => Message);

  /**
   * Custom error message when options are terminated (after `--`).
   */
  optionsTerminated?: Message;

  /**
   * Custom error message when input is empty but option is expected.
   */
  endOfInput?: Message;

  /**
   * Custom error message when option is used multiple times.
   * Can be a static message or a function that receives the token.
   */
  duplicate?: Message | ((token: string) => Message);

  /**
   * Custom error message when value parsing fails.
   * Can be a static message or a function that receives the error message.
   */
  invalidValue?: Message | ((error: Message) => Message);

  /**
   * Custom error message when a Boolean flag receives an unexpected value.
   * Can be a static message or a function that receives the value.
   */
  unexpectedValue?: Message | ((value: string) => Message);

  /**
   * Custom error message when no matching option is found.
   * Can be a static message or a function that receives:
   * - invalidOption: The invalid option name that was provided
   * - suggestions: Array of similar valid option names (can be empty)
   *
   * @since 0.7.0
   */
  noMatch?:
    | Message
    | ((invalidOption: string, suggestions: readonly string[]) => Message);
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
      error: options.errors?.missing
        ? (typeof options.errors.missing === "function"
          ? options.errors.missing(optionNames)
          : options.errors.missing)
        : message`Missing option ${eOptionNames(optionNames)}.`,
    },
    parse(context) {
      if (context.optionsTerminated) {
        return {
          success: false,
          consumed: 0,
          error: options.errors?.optionsTerminated ??
            message`No more options can be parsed.`,
        };
      } else if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: options.errors?.endOfInput ??
            message`Expected an option, but got end of input.`,
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
            error: options.errors?.duplicate
              ? (typeof options.errors.duplicate === "function"
                ? options.errors.duplicate(context.buffer[0])
                : options.errors.duplicate)
              : message`${
                eOptionName(context.buffer[0])
              } cannot be used multiple times.`,
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
            error: options.errors?.duplicate
              ? (typeof options.errors.duplicate === "function"
                ? options.errors.duplicate(prefix)
                : options.errors.duplicate)
              : message`${eOptionName(prefix)} cannot be used multiple times.`,
          };
        }
        const value = context.buffer[0].slice(prefix.length);
        if (valueParser == null) {
          return {
            success: false,
            consumed: 1,
            error: options.errors?.unexpectedValue
              ? (typeof options.errors.unexpectedValue === "function"
                ? options.errors.unexpectedValue(value)
                : options.errors.unexpectedValue)
              : message`Option ${
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
              error: options.errors?.duplicate
                ? (typeof options.errors.duplicate === "function"
                  ? options.errors.duplicate(shortOption)
                  : options.errors.duplicate)
                : message`${
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

      // Find similar options from context usage and suggest them
      const invalidOption = context.buffer[0];

      // Check if custom noMatch error is provided
      if (options.errors?.noMatch) {
        const candidates = new Set<string>();
        for (const name of extractOptionNames(context.usage)) {
          candidates.add(name);
        }
        const suggestions = findSimilar(
          invalidOption,
          candidates,
          DEFAULT_FIND_SIMILAR_OPTIONS,
        );

        const errorMessage = typeof options.errors.noMatch === "function"
          ? options.errors.noMatch(invalidOption, suggestions)
          : options.errors.noMatch;

        return {
          success: false,
          consumed: 0,
          error: errorMessage,
        };
      }

      const baseError = message`No matched option for ${
        eOptionName(invalidOption)
      }.`;

      return {
        success: false,
        consumed: 0,
        error: createErrorWithSuggestions(
          baseError,
          invalidOption,
          context.usage,
          "option",
        ),
      };
    },
    complete(state) {
      if (state == null) {
        return valueParser == null ? { success: true, value: false } : {
          success: false,
          error: options.errors?.missing
            ? (typeof options.errors.missing === "function"
              ? options.errors.missing(optionNames)
              : options.errors.missing)
            : message`Missing option ${eOptionNames(optionNames)}.`,
        };
      }
      if (state.success) return state;
      return {
        success: false,
        error: options.errors?.invalidValue
          ? (typeof options.errors.invalidValue === "function"
            ? options.errors.invalidValue(state.error)
            : options.errors.invalidValue)
          : message`${eOptionNames(optionNames)}: ${state.error}`,
      };
    },
    suggest(context, prefix) {
      const suggestions: Suggestion[] = [];

      // Check for --option=value format
      const equalsIndex = prefix.indexOf("=");
      if (equalsIndex >= 0) {
        // Handle --option=value completion
        const optionPart = prefix.slice(0, equalsIndex);
        const valuePart = prefix.slice(equalsIndex + 1);

        // Check if this option matches any of our option names
        if ((optionNames as readonly string[]).includes(optionPart)) {
          if (valueParser && valueParser.suggest) {
            const valueSuggestions = valueParser.suggest(valuePart);
            // Prepend the option= part to each suggestion
            for (const suggestion of valueSuggestions) {
              if (suggestion.kind === "literal") {
                suggestions.push({
                  kind: "literal",
                  text: `${optionPart}=${suggestion.text}`,
                  description: suggestion.description,
                });
              } else {
                // For file suggestions, we can't easily combine with option= format
                // so we fall back to literal suggestions
                suggestions.push({
                  kind: "literal",
                  text: `${optionPart}=${suggestion.pattern || ""}`,
                  description: suggestion.description,
                });
              }
            }
          }
        }
      } else {
        // If the prefix looks like an option prefix, suggest matching option names
        if (
          prefix.startsWith("--") || prefix.startsWith("-") ||
          prefix.startsWith("/")
        ) {
          for (const optionName of optionNames) {
            if (optionName.startsWith(prefix)) {
              // Special case: if prefix is exactly "-", only suggest short options (single dash + single char)
              if (prefix === "-" && optionName.length !== 2) {
                continue;
              }
              suggestions.push({ kind: "literal", text: optionName });
            }
          }
        }

        // Check if we should suggest values for this option
        // This happens in two scenarios:
        // 1. The buffer contains our option name as the last token (e.g., ["-f"])
        // 2. The parser state is undefined and we haven't yet processed any args
        if (valueParser && valueParser.suggest) {
          let shouldSuggestValues = false;

          // Scenario 1: Buffer contains option name
          if (context.buffer.length > 0) {
            const lastToken = context.buffer[context.buffer.length - 1];
            if ((optionNames as readonly string[]).includes(lastToken)) {
              shouldSuggestValues = true;
            }
          } // Scenario 2: Empty buffer but state is undefined (we might be continuing from a consumed option)
          // This happens when suggest() function has already consumed the option name
          else if (context.state === undefined && context.buffer.length === 0) {
            // We need more sophisticated logic here to determine if we should suggest values
            // For now, we'll assume that if we have a value parser and no buffer,
            // we might be in a value-expecting state
            shouldSuggestValues = true;
          }

          if (shouldSuggestValues) {
            const valueSuggestions = valueParser.suggest(prefix);
            suggestions.push(...valueSuggestions);
          }
        }
      }

      return suggestions;
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
          ? message`${valueParser.format(defaultValue as T)}`
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

  /**
   * Error message customization options.
   * @since 0.5.0
   */
  readonly errors?: FlagErrorOptions;
}

/**
 * Options for customizing error messages in the {@link flag} parser.
 * @since 0.5.0
 */
export interface FlagErrorOptions {
  /**
   * Custom error message when the flag is missing (for required flags).
   * Can be a static message or a function that receives the option names.
   */
  missing?: Message | ((optionNames: readonly string[]) => Message);

  /**
   * Custom error message when options are terminated (after --).
   */
  optionsTerminated?: Message;

  /**
   * Custom error message when input is empty but flag is expected.
   */
  endOfInput?: Message;

  /**
   * Custom error message when flag is used multiple times.
   * Can be a static message or a function that receives the token.
   */
  duplicate?: Message | ((token: string) => Message);

  /**
   * Custom error message when no matching flag is found.
   * Can be a static message or a function that receives:
   * - invalidOption: The invalid option name that was provided
   * - suggestions: Array of similar valid option names (can be empty)
   *
   * @since 0.7.0
   */
  noMatch?:
    | Message
    | ((invalidOption: string, suggestions: readonly string[]) => Message);
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
          error: options.errors?.optionsTerminated ??
            message`No more options can be parsed.`,
        };
      } else if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: options.errors?.endOfInput ??
            message`Expected an option, but got end of input.`,
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
            error: options.errors?.duplicate
              ? (typeof options.errors.duplicate === "function"
                ? options.errors.duplicate(context.buffer[0])
                : options.errors.duplicate)
              : message`${
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
            error: options.errors?.duplicate
              ? (typeof options.errors.duplicate === "function"
                ? options.errors.duplicate(shortOption)
                : options.errors.duplicate)
              : message`${
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

      // Find similar options from context usage and suggest them
      const invalidOption = context.buffer[0];

      // Check if custom noMatch error is provided
      if (options.errors?.noMatch) {
        const candidates = new Set<string>();
        for (const name of extractOptionNames(context.usage)) {
          candidates.add(name);
        }
        const suggestions = findSimilar(
          invalidOption,
          candidates,
          DEFAULT_FIND_SIMILAR_OPTIONS,
        );

        const errorMessage = typeof options.errors.noMatch === "function"
          ? options.errors.noMatch(invalidOption, suggestions)
          : options.errors.noMatch;

        return {
          success: false,
          consumed: 0,
          error: errorMessage,
        };
      }

      const baseError = message`No matched option for ${
        eOptionName(invalidOption)
      }.`;

      return {
        success: false,
        consumed: 0,
        error: createErrorWithSuggestions(
          baseError,
          invalidOption,
          context.usage,
          "option",
        ),
      };
    },
    complete(state) {
      if (state == null) {
        return {
          success: false,
          error: options.errors?.missing
            ? (typeof options.errors.missing === "function"
              ? options.errors.missing(optionNames)
              : options.errors.missing)
            : message`Required flag ${eOptionNames(optionNames)} is missing.`,
        };
      }
      if (state.success) return { success: true, value: true };
      return {
        success: false,
        error: message`${eOptionNames(optionNames)}: ${state.error}`,
      };
    },
    suggest(_context, prefix) {
      const suggestions: Suggestion[] = [];

      // If the prefix looks like an option prefix, suggest matching option names
      if (
        prefix.startsWith("--") || prefix.startsWith("-") ||
        prefix.startsWith("/")
      ) {
        for (const optionName of optionNames) {
          if (optionName.startsWith(prefix)) {
            // Special case: if prefix is exactly "-", only suggest short options (single dash + single char)
            if (prefix === "-" && optionName.length !== 2) {
              continue;
            }
            suggestions.push({ kind: "literal", text: optionName });
          }
        }
      }

      return suggestions;
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

  /**
   * Error message customization options.
   * @since 0.5.0
   */
  readonly errors?: ArgumentErrorOptions;
}

/**
 * Options for customizing error messages in the {@link argument} parser.
 * @since 0.5.0
 */
export interface ArgumentErrorOptions {
  /**
   * Custom error message when input is empty but argument is expected.
   */
  endOfInput?: Message;

  /**
   * Custom error message when value parsing fails.
   * Can be a static message or a function that receives the error message.
   */
  invalidValue?: Message | ((error: Message) => Message);

  /**
   * Custom error message when argument is used multiple times.
   * Can be a static message or a function that receives the metavar.
   */
  multiple?: Message | ((metavar: string) => Message);
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
          error: options.errors?.endOfInput ??
            message`Expected an argument, but got end of input.`,
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
          error: options.errors?.multiple
            ? (typeof options.errors.multiple === "function"
              ? options.errors.multiple(valueParser.metavar)
              : options.errors.multiple)
            : message`The argument ${
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
          error: options.errors?.endOfInput ??
            message`Expected a ${
              metavar(valueParser.metavar)
            }, but too few arguments.`,
        };
      } else if (state.success) return state;
      return {
        success: false,
        error: options.errors?.invalidValue
          ? (typeof options.errors.invalidValue === "function"
            ? options.errors.invalidValue(state.error)
            : options.errors.invalidValue)
          : message`${metavar(valueParser.metavar)}: ${state.error}`,
      };
    },
    suggest(_context, prefix) {
      const suggestions: Suggestion[] = [];

      // Delegate to value parser if it has completion capabilities
      if (valueParser.suggest) {
        const valueSuggestions = valueParser.suggest(prefix);
        suggestions.push(...valueSuggestions);
      }

      return suggestions;
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
          : message`${valueParser.format(defaultValue)}`,
      }];
      return { fragments, description: options.description };
    },
    [Symbol.for("Deno.customInspect")]() {
      return `argument()`;
    },
  } satisfies Parser<T, ValueParserResult<T> | undefined>;
}

/**
 * Options for the {@link command} parser.
 * @since 0.5.0
 */
export interface CommandOptions {
  /**
   * A brief description of the command, shown in command lists.
   * If provided along with {@link description}, this will be used in
   * command listings (e.g., `myapp help`), while {@link description}
   * will be used for detailed help (e.g., `myapp help subcommand` or
   * `myapp subcommand --help`).
   * @since 0.6.0
   */
  readonly brief?: Message;

  /**
   * A description of the command, used for documentation.
   */
  readonly description?: Message;

  /**
   * A footer message that appears at the bottom of the command's help text.
   * Useful for showing examples, notes, or additional information.
   * @since 0.6.0
   */
  readonly footer?: Message;

  /**
   * Error messages customization.
   * @since 0.5.0
   */
  readonly errors?: CommandErrorOptions;
}

/**
 * Options for customizing error messages in the {@link command} parser.
 * @since 0.5.0
 */
export interface CommandErrorOptions {
  /**
   * Error message when command is expected but not found.
   * Since version 0.7.0, the function signature now includes suggestions:
   * - expected: The expected command name
   * - actual: The actual input (or null if no input)
   * - suggestions: Array of similar valid command names (can be empty)
   */
  readonly notMatched?:
    | Message
    | ((
      expected: string,
      actual: string | null,
      suggestions?: readonly string[],
    ) => Message);

  /**
   * Error message when command was not matched during completion.
   */
  readonly notFound?: Message;

  /**
   * Error message for invalid command state.
   */
  readonly invalidState?: Message;
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
          const actual = context.buffer.length > 0 ? context.buffer[0] : null;

          // If custom error is provided, use it
          if (options.errors?.notMatched) {
            const errorMessage = options.errors.notMatched;

            // Calculate suggestions for custom error
            const candidates = new Set<string>();
            for (const cmdName of extractCommandNames(context.usage)) {
              candidates.add(cmdName);
            }
            const suggestions = actual
              ? findSimilar(actual, candidates, DEFAULT_FIND_SIMILAR_OPTIONS)
              : [];

            return {
              success: false,
              consumed: 0,
              error: typeof errorMessage === "function"
                ? errorMessage(name, actual, suggestions)
                : errorMessage,
            };
          }

          // Generate default error with suggestions
          if (actual == null) {
            return {
              success: false,
              consumed: 0,
              error: message`Expected command ${
                eOptionName(name)
              }, but got end of input.`,
            };
          }

          // Find similar command names
          const baseError = message`Expected command ${
            eOptionName(name)
          }, but got ${actual}.`;

          return {
            success: false,
            consumed: 0,
            error: createErrorWithSuggestions(
              baseError,
              actual,
              context.usage,
              "command",
            ),
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
        error: options.errors?.invalidState ?? message`Invalid command state.`,
      };
    },
    complete(state) {
      if (typeof state === "undefined") {
        return {
          success: false,
          error: options.errors?.notFound ??
            message`Command ${eOptionName(name)} was not matched.`,
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
        error: options.errors?.invalidState ??
          message`Invalid command state during completion.`,
      };
    },
    suggest(context, prefix) {
      const suggestions: Suggestion[] = [];

      // Handle different command states
      if (context.state === undefined) {
        // Command not yet matched - suggest command name if it matches prefix
        if (name.startsWith(prefix)) {
          suggestions.push({
            kind: "literal",
            text: name,
            ...(options.description && { description: options.description }),
          });
        }
      } else if (context.state[0] === "matched") {
        // Command matched but inner parser not started - delegate to inner parser
        const innerSuggestions = parser.suggest({
          ...context,
          state: parser.initialState,
        }, prefix);
        suggestions.push(...innerSuggestions);
      } else if (context.state[0] === "parsing") {
        // Command in parsing state - delegate to inner parser
        const innerSuggestions = parser.suggest({
          ...context,
          state: context.state[1],
        }, prefix);
        suggestions.push(...innerSuggestions);
      }

      return suggestions;
    },
    getDocFragments(state: DocState<CommandState<TState>>, defaultValue?) {
      if (state.kind === "unavailable" || typeof state.state === "undefined") {
        // When showing command in a list, use brief if available,
        // otherwise fall back to description
        return {
          description: options.description,
          fragments: [
            {
              type: "entry",
              term: { type: "command", name },
              description: options.brief ?? options.description,
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
        footer: innerFragments.footer ?? options.footer,
      };
    },
    [Symbol.for("Deno.customInspect")]() {
      return `command(${JSON.stringify(name)})`;
    },
  } satisfies Parser<T, CommandState<TState>>;
}
