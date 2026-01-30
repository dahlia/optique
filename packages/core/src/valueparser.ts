import { type Message, message, text, valueSet } from "./message.ts";
import { ensureNonEmptyString, type NonEmptyString } from "./nonempty.ts";
import type { Mode, ModeIterable, ModeValue, Suggestion } from "./parser.ts";

export {
  ensureNonEmptyString,
  isNonEmptyString,
  type NonEmptyString,
} from "./nonempty.ts";

export type { Mode, ModeIterable, ModeValue } from "./parser.ts";

/**
 * Interface for parsing CLI option values and arguments.
 *
 * A `ValueParser` is responsible for converting string input (typically from
 * CLI arguments or option values) into strongly-typed values of type {@link T}.
 *
 * @template M The execution mode of the parser (`"sync"` or `"async"`).
 * @template T The type of value this parser produces.
 * @since 0.9.0 Added the `M` type parameter for sync/async mode support.
 */
export interface ValueParser<M extends Mode = "sync", T = unknown> {
  /**
   * The execution mode of this value parser.
   *
   * - `"sync"`: The `parse` method returns values directly.
   * - `"async"`: The `parse` method returns Promises.
   *
   * @since 0.9.0
   */
  readonly $mode: M;

  /**
   * The metavariable name for this parser.  Used in help messages
   * to indicate what kind of value this parser expects.  Usually
   * a single word in uppercase, like `PORT` or `FILE`.
   */
  readonly metavar: NonEmptyString;

  /**
   * Parses a string input into a value of type {@link T}.
   *
   * @param input The string input to parse
   *              (e.g., the `value` part of `--option=value`).
   * @returns A result object indicating success or failure with an error
   *          message.  In async mode, returns a Promise that resolves to
   *          the result.
   */
  parse(input: string): ModeValue<M, ValueParserResult<T>>;

  /**
   * Formats a value of type {@link T} into a string representation.
   * This is useful for displaying the value in help messages or
   * documentation.
   *
   * @param value The value to format.
   * @returns A string representation of the value.
   */
  format(value: T): string;

  /**
   * Provides completion suggestions for values of this type.
   * This is optional and used for shell completion functionality.
   *
   * @param prefix The current input prefix to complete.
   * @returns An iterable of suggestion objects.
   *          In async mode, returns an AsyncIterable.
   * @since 0.6.0
   */
  suggest?(prefix: string): ModeIterable<M, Suggestion>;
}

/**
 * Result type returned by {@link ValueParser#parse}.
 *
 * This is a discriminated union that represents either a successful parse
 * with the resulting value, or a failed parse with an error message.
 *
 * @template T The type of the successfully parsed value.
 */
export type ValueParserResult<T> =
  | {
    /** Indicates that the parsing operation was successful. */
    readonly success: true;

    /** The successfully parsed value of type {@link T}. */
    readonly value: T;
  }
  | {
    /** Indicates that the parsing operation failed. */
    readonly success: false;

    /** The error message describing why the parsing failed. */
    readonly error: Message;
  };

/**
 * Options for creating a string parser.
 */
export interface StringOptions {
  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `HOST` or `NAME`.
   * @default `"STRING"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Optional regular expression pattern that the string must match.
   *
   * **Security note**: When using user-defined or complex patterns, be aware
   * of potential Regular Expression Denial of Service (ReDoS) attacks.
   * Maliciously crafted input strings can cause exponential backtracking in
   * vulnerable patterns, leading to high CPU usage. Avoid patterns with
   * nested quantifiers like `(a+)+` or overlapping alternations. Consider
   * using tools like [safe-regex](https://www.npmjs.com/package/safe-regex)
   * to validate patterns before use.
   */
  readonly pattern?: RegExp;

  /**
   * Custom error messages for various string parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input doesn't match the pattern.
     * Can be a static message or a function that receives the input and pattern.
     * @since 0.5.0
     */
    patternMismatch?: Message | ((input: string, pattern: RegExp) => Message);
  };
}

/**
 * Base options for creating a {@link choice} parser.
 * @since 0.9.0
 */
export interface ChoiceOptionsBase {
  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `TYPE` or `MODE`.
   * @default `"TYPE"`
   */
  readonly metavar?: NonEmptyString;
}

/**
 * Options for creating a {@link choice} parser with string values.
 * @since 0.9.0
 */
export interface ChoiceOptionsString extends ChoiceOptionsBase {
  /**
   * If `true`, the parser will perform case-insensitive matching
   * against the enumerated values. This means that input like "value",
   * "Value", or "VALUE" will all match the same enumerated value.
   * If `false`, the matching will be case-sensitive.
   * @default `false`
   */
  readonly caseInsensitive?: boolean;

  /**
   * Custom error messages for choice parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input doesn't match any of the valid choices.
     * Can be a static message or a function that receives the input and valid choices.
     * @since 0.5.0
     */
    invalidChoice?:
      | Message
      | ((input: string, choices: readonly string[]) => Message);
  };
}

/**
 * Options for creating a {@link choice} parser with number values.
 * Note: `caseInsensitive` is not available for number choices.
 * @since 0.9.0
 */
export interface ChoiceOptionsNumber extends ChoiceOptionsBase {
  /**
   * Custom error messages for choice parsing failures.
   * @since 0.9.0
   */
  readonly errors?: {
    /**
     * Custom error message when input doesn't match any of the valid choices.
     * Can be a static message or a function that receives the input and valid choices.
     * @since 0.9.0
     */
    invalidChoice?:
      | Message
      | ((input: string, choices: readonly number[]) => Message);
  };
}

/**
 * Options for creating a {@link choice} parser.
 * @deprecated Use {@link ChoiceOptionsString} for string choices or
 *             {@link ChoiceOptionsNumber} for number choices.
 */
export type ChoiceOptions = ChoiceOptionsString;

/**
 * A predicate function that checks if an object is a {@link ValueParser}.
 * @param object The object to check.
 * @return `true` if the object is a {@link ValueParser}, `false` otherwise.
 */
export function isValueParser<M extends Mode, T>(
  object: unknown,
): object is ValueParser<M, T> {
  return typeof object === "object" && object != null &&
    "$mode" in object &&
    ((object as ValueParser<M, T>).$mode === "sync" ||
      (object as ValueParser<M, T>).$mode === "async") &&
    "metavar" in object &&
    typeof (object as ValueParser<M, T>).metavar === "string" &&
    "parse" in object &&
    typeof (object as ValueParser<M, T>).parse === "function" &&
    "format" in object &&
    typeof (object as ValueParser<M, T>).format === "function";
}

/**
 * Creates a {@link ValueParser} that accepts one of multiple
 * string values, so-called enumerated values.
 *
 * This parser validates that the input string matches one of
 * the specified values. If the input does not match any of the values,
 * it returns an error message indicating the valid options.
 * @param choices An array of valid string values that this parser can accept.
 * @param options Configuration options for the choice parser.
 * @returns A {@link ValueParser} that checks if the input matches one of the
 *          specified values.
 */
export function choice<const T extends string>(
  choices: readonly T[],
  options?: ChoiceOptionsString,
): ValueParser<"sync", T>;

/**
 * Creates a {@link ValueParser} that accepts one of multiple
 * number values.
 *
 * This parser validates that the input can be parsed as a number and matches
 * one of the specified values. If the input does not match any of the values,
 * it returns an error message indicating the valid options.
 * @param choices An array of valid number values that this parser can accept.
 * @param options Configuration options for the choice parser.
 * @returns A {@link ValueParser} that checks if the input matches one of the
 *          specified values.
 * @since 0.9.0
 */
export function choice<const T extends number>(
  choices: readonly T[],
  options?: ChoiceOptionsNumber,
): ValueParser<"sync", T>;

/**
 * Implementation of the choice parser for both string and number types.
 */
export function choice<const T extends string | number>(
  choices: readonly T[],
  options: ChoiceOptionsString | ChoiceOptionsNumber = {},
): ValueParser<"sync", T> {
  const metavar = options.metavar ?? "TYPE";
  ensureNonEmptyString(metavar);

  // Check if choices are numbers
  const isNumberChoice = choices.length > 0 && typeof choices[0] === "number";

  if (isNumberChoice) {
    // Number choice implementation
    const numberChoices = choices as readonly number[];
    const numberOptions = options as ChoiceOptionsNumber;
    return {
      $mode: "sync",
      metavar,
      parse(input: string): ValueParserResult<T> {
        const parsed = Number(input);
        if (Number.isNaN(parsed)) {
          return {
            success: false,
            error: formatNumberChoiceError(input, numberChoices, numberOptions),
          };
        }
        const index = numberChoices.indexOf(parsed);
        if (index < 0) {
          return {
            success: false,
            error: formatNumberChoiceError(input, numberChoices, numberOptions),
          };
        }
        return { success: true, value: numberChoices[index] as T };
      },
      format(value: T): string {
        return String(value);
      },
      suggest(prefix: string) {
        return numberChoices
          .map((value) => String(value))
          .filter((valueStr) => valueStr.startsWith(prefix))
          .map((valueStr) => ({ kind: "literal" as const, text: valueStr }));
      },
    };
  }

  // String choice implementation
  const stringChoices = choices as readonly string[];
  const stringOptions = options as ChoiceOptionsString;
  const normalizedValues = stringOptions.caseInsensitive
    ? stringChoices.map((v) => v.toLowerCase())
    : stringChoices;
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<T> {
      const normalizedInput = stringOptions.caseInsensitive
        ? input.toLowerCase()
        : input;
      const index = normalizedValues.indexOf(normalizedInput);
      if (index < 0) {
        return {
          success: false,
          error: formatStringChoiceError(input, stringChoices, stringOptions),
        };
      }
      return { success: true, value: stringChoices[index] as T };
    },
    format(value: T): string {
      return String(value);
    },
    suggest(prefix: string) {
      const normalizedPrefix = stringOptions.caseInsensitive
        ? prefix.toLowerCase()
        : prefix;

      return stringChoices
        .filter((value) => {
          const normalizedValue = stringOptions.caseInsensitive
            ? value.toLowerCase()
            : value;
          return normalizedValue.startsWith(normalizedPrefix);
        })
        .map((value) => ({ kind: "literal" as const, text: value }));
    },
  };
}

/**
 * Formats error message for string choice parser.
 */
function formatStringChoiceError(
  input: string,
  choices: readonly string[],
  options: ChoiceOptionsString,
): Message {
  if (options.errors?.invalidChoice) {
    return typeof options.errors.invalidChoice === "function"
      ? options.errors.invalidChoice(input, choices)
      : options.errors.invalidChoice;
  }
  return formatDefaultChoiceError(input, choices);
}

/**
 * Formats error message for number choice parser.
 */
function formatNumberChoiceError(
  input: string,
  choices: readonly number[],
  options: ChoiceOptionsNumber,
): Message {
  if (options.errors?.invalidChoice) {
    return typeof options.errors.invalidChoice === "function"
      ? options.errors.invalidChoice(input, choices)
      : options.errors.invalidChoice;
  }
  return formatDefaultChoiceError(input, choices);
}

/**
 * Formats default error message for choice parser.
 */
function formatDefaultChoiceError(
  input: string,
  choices: readonly (string | number)[],
): Message {
  const choiceStrings = choices.map((c) => String(c));
  return message`Expected one of ${
    valueSet(choiceStrings, { locale: "en-US" })
  }, but got ${input}.`;
}

/**
 * Creates a {@link ValueParser} for strings.
 *
 * This parser validates that the input is a string and optionally checks
 * if it matches a specified regular expression pattern.
 *
 * **Security note**: When using the `pattern` option with user-defined or
 * complex patterns, be aware of potential Regular Expression Denial of Service
 * (ReDoS) attacks. See {@link StringOptions.pattern} for more details.
 *
 * @param options Configuration options for the string parser.
 * @returns A {@link ValueParser} that parses strings according to the
 *          specified options.
 */
export function string(
  options: StringOptions = {},
): ValueParser<"sync", string> {
  const metavar = options.metavar ?? "STRING";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<string> {
      if (options.pattern != null && !options.pattern.test(input)) {
        return {
          success: false,
          error: options.errors?.patternMismatch
            ? (typeof options.errors.patternMismatch === "function"
              ? options.errors.patternMismatch(input, options.pattern)
              : options.errors.patternMismatch)
            : message`Expected a string matching pattern ${
              text(options.pattern.source)
            }, but got ${input}.`,
        };
      }
      return { success: true, value: input };
    },
    format(value: string): string {
      return value;
    },
  };
}

/**
 * Options for creating an integer parser that returns a JavaScript `number`.
 *
 * This interface is used when you want to parse integers as regular JavaScript
 * numbers (which are safe up to `Number.MAX_SAFE_INTEGER`).
 */
export interface IntegerOptionsNumber {
  /**
   * The type of integer to parse.
   * @default `"number"`
   */
  readonly type?: "number";

  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `PORT`.
   * @default `"INTEGER"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Minimum allowed value (inclusive). If not specified,
   * no minimum is enforced.
   */
  readonly min?: number;

  /**
   * Maximum allowed value (inclusive). If not specified,
   * no maximum is enforced.
   */
  readonly max?: number;

  /**
   * Custom error messages for integer parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid integer.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidInteger?: Message | ((input: string) => Message);

    /**
     * Custom error message when integer is below minimum value.
     * Can be a static message or a function that receives the value and minimum.
     * @since 0.5.0
     */
    belowMinimum?: Message | ((value: number, min: number) => Message);

    /**
     * Custom error message when integer is above maximum value.
     * Can be a static message or a function that receives the value and maximum.
     * @since 0.5.0
     */
    aboveMaximum?: Message | ((value: number, max: number) => Message);
  };
}

/**
 * Options for creating an integer parser that returns a `bigint`.
 *
 * This interface is used when you need to parse very large integers that
 * exceed JavaScript's safe integer range.
 */
export interface IntegerOptionsBigInt {
  /** Must be set to `"bigint"` to create a `bigint` parser. */
  readonly type: "bigint";

  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `PORT`.
   * @default `"INTEGER"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Minimum allowed value (inclusive). If not specified,
   * no minimum is enforced.
   */
  readonly min?: bigint;

  /**
   * Maximum allowed value (inclusive). If not specified,
   * no maximum is enforced.
   */
  readonly max?: bigint;

  /**
   * Custom error messages for bigint integer parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid integer.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidInteger?: Message | ((input: string) => Message);

    /**
     * Custom error message when integer is below minimum value.
     * Can be a static message or a function that receives the value and minimum.
     * @since 0.5.0
     */
    belowMinimum?: Message | ((value: bigint, min: bigint) => Message);

    /**
     * Custom error message when integer is above maximum value.
     * Can be a static message or a function that receives the value and maximum.
     * @since 0.5.0
     */
    aboveMaximum?: Message | ((value: bigint, max: bigint) => Message);
  };
}

/**
 * Creates a ValueParser for integers that returns JavaScript numbers.
 *
 * @param options Configuration options for the integer parser.
 * @returns A {@link ValueParser} that parses strings into numbers.
 */
export function integer(
  options?: IntegerOptionsNumber,
): ValueParser<"sync", number>;

/**
 * Creates a ValueParser for integers that returns `bigint` values.
 *
 * @param options Configuration options for the `bigint` parser.
 * @returns A {@link ValueParser} that parses strings into `bigint` values.
 */
export function integer(
  options: IntegerOptionsBigInt,
): ValueParser<"sync", bigint>;

/**
 * Creates a ValueParser for parsing integer values from strings.
 *
 * This function provides two modes of operation:
 *
 * - Regular mode: Returns JavaScript numbers
 *   (safe up to `Number.MAX_SAFE_INTEGER`)
 * - `bigint` mode: Returns `bigint` values for arbitrarily large integers
 *
 * The parser validates that the input is a valid integer and optionally
 * enforces minimum and maximum value constraints.
 *
 * @example
 * ```typescript
 * // Create a parser for regular integers
 * const portParser = integer({ min: 1, max: 0xffff });
 *
 * // Create a parser for BigInt values
 * const bigIntParser = integer({ type: "bigint", min: 0n });
 *
 * // Use the parser
 * const result = portParser.parse("8080");
 * if (result.success) {
 *   console.log(`Port: ${result.value}`);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 *
 * @param options Configuration options specifying the type and constraints.
 * @returns A {@link ValueParser} that converts string input to the specified
 *          integer type.
 */
export function integer(
  options?: IntegerOptionsNumber | IntegerOptionsBigInt,
): ValueParser<"sync", number> | ValueParser<"sync", bigint> {
  if (options?.type === "bigint") {
    const metavar = options.metavar ?? "INTEGER";
    ensureNonEmptyString(metavar);
    return {
      $mode: "sync",
      metavar,
      parse(input: string): ValueParserResult<bigint> {
        let value: bigint;
        try {
          value = BigInt(input);
        } catch (e) {
          if (e instanceof SyntaxError) {
            return {
              success: false,
              error: options.errors?.invalidInteger
                ? (typeof options.errors.invalidInteger === "function"
                  ? options.errors.invalidInteger(input)
                  : options.errors.invalidInteger)
                : message`Expected a valid integer, but got ${input}.`,
            };
          }
          throw e;
        }
        if (options.min != null && value < options.min) {
          return {
            success: false,
            error: options.errors?.belowMinimum
              ? (typeof options.errors.belowMinimum === "function"
                ? options.errors.belowMinimum(value, options.min)
                : options.errors.belowMinimum)
              : message`Expected a value greater than or equal to ${
                text(options.min.toLocaleString("en"))
              }, but got ${input}.`,
          };
        } else if (options.max != null && value > options.max) {
          return {
            success: false,
            error: options.errors?.aboveMaximum
              ? (typeof options.errors.aboveMaximum === "function"
                ? options.errors.aboveMaximum(value, options.max)
                : options.errors.aboveMaximum)
              : message`Expected a value less than or equal to ${
                text(options.max.toLocaleString("en"))
              }, but got ${input}.`,
          };
        }
        return { success: true, value };
      },
      format(value: bigint): string {
        return value.toString();
      },
    };
  }
  const metavar = options?.metavar ?? "INTEGER";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<number> {
      if (!input.match(/^-?\d+$/)) {
        return {
          success: false,
          error: options?.errors?.invalidInteger
            ? (typeof options.errors.invalidInteger === "function"
              ? options.errors.invalidInteger(input)
              : options.errors.invalidInteger)
            : message`Expected a valid integer, but got ${input}.`,
        };
      }
      const value = Number.parseInt(input);
      if (options?.min != null && value < options.min) {
        return {
          success: false,
          error: options.errors?.belowMinimum
            ? (typeof options.errors.belowMinimum === "function"
              ? options.errors.belowMinimum(value, options.min)
              : options.errors.belowMinimum)
            : message`Expected a value greater than or equal to ${
              text(options.min.toLocaleString("en"))
            }, but got ${input}.`,
        };
      } else if (options?.max != null && value > options.max) {
        return {
          success: false,
          error: options.errors?.aboveMaximum
            ? (typeof options.errors.aboveMaximum === "function"
              ? options.errors.aboveMaximum(value, options.max)
              : options.errors.aboveMaximum)
            : message`Expected a value less than or equal to ${
              text(options.max.toLocaleString("en"))
            }, but got ${input}.`,
        };
      }
      return { success: true, value };
    },
    format(value: number): string {
      return value.toString();
    },
  };
}

/**
 * Options for creating a {@link float} parser.
 */
export interface FloatOptions {
  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `RATE` or `PRICE`.
   * @default `"NUMBER"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Minimum allowed value (inclusive). If not specified,
   * no minimum is enforced.
   */
  readonly min?: number;

  /**
   * Maximum allowed value (inclusive). If not specified,
   * no maximum is enforced.
   */
  readonly max?: number;

  /**
   * If `true`, allows the special value `NaN` (not a number).
   * This is useful for cases where `NaN` is a valid input,
   * such as in some scientific calculations.
   * @default `false`
   */
  readonly allowNaN?: boolean;

  /**
   * If `true`, allows the special values `Infinity` and `-Infinity`.
   * This is useful for cases where infinite values are valid inputs,
   * such as in mathematical calculations or limits.
   * @default `false`
   */
  readonly allowInfinity?: boolean;

  /**
   * Custom error messages for float parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid number.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidNumber?: Message | ((input: string) => Message);

    /**
     * Custom error message when number is below minimum value.
     * Can be a static message or a function that receives the value and minimum.
     * @since 0.5.0
     */
    belowMinimum?: Message | ((value: number, min: number) => Message);

    /**
     * Custom error message when number is above maximum value.
     * Can be a static message or a function that receives the value and maximum.
     * @since 0.5.0
     */
    aboveMaximum?: Message | ((value: number, max: number) => Message);
  };
}

/**
 * Creates a {@link ValueParser} for floating-point numbers.
 *
 * This parser validates that the input is a valid floating-point number
 * and optionally enforces minimum and maximum value constraints.
 * @param options Configuration options for the float parser.
 * @returns A {@link ValueParser} that parses strings into floating-point
 *          numbers.
 */
export function float(options: FloatOptions = {}): ValueParser<"sync", number> {
  // Regular expression to match valid floating-point numbers
  // Matches: integers, decimals, scientific notation
  // Does not match: empty strings, whitespace-only, hex/bin/oct numbers
  const floatRegex = /^[+-]?(?:(?:\d+\.?\d*)|(?:\d*\.\d+))(?:[eE][+-]?\d+)?$/;
  const metavar = options.metavar ?? "NUMBER";
  ensureNonEmptyString(metavar);

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<number> {
      let value: number;
      const lowerInput = input.toLowerCase();

      if (lowerInput === "nan" && options.allowNaN) {
        value = NaN;
      } else if (
        (lowerInput === "infinity" || lowerInput === "+infinity") &&
        options.allowInfinity
      ) {
        value = Infinity;
      } else if (lowerInput === "-infinity" && options.allowInfinity) {
        value = -Infinity;
      } else if (floatRegex.test(input)) {
        value = Number(input);
        // This should not happen with our regex, but let's be safe
        if (Number.isNaN(value)) {
          return {
            success: false,
            error: options.errors?.invalidNumber
              ? (typeof options.errors.invalidNumber === "function"
                ? options.errors.invalidNumber(input)
                : options.errors.invalidNumber)
              : message`Expected a valid number, but got ${input}.`,
          };
        }
      } else {
        return {
          success: false,
          error: options.errors?.invalidNumber
            ? (typeof options.errors.invalidNumber === "function"
              ? options.errors.invalidNumber(input)
              : options.errors.invalidNumber)
            : message`Expected a valid number, but got ${input}.`,
        };
      }

      if (options.min != null && value < options.min) {
        return {
          success: false,
          error: options.errors?.belowMinimum
            ? (typeof options.errors.belowMinimum === "function"
              ? options.errors.belowMinimum(value, options.min)
              : options.errors.belowMinimum)
            : message`Expected a value greater than or equal to ${
              text(options.min.toLocaleString("en"))
            }, but got ${input}.`,
        };
      } else if (options.max != null && value > options.max) {
        return {
          success: false,
          error: options.errors?.aboveMaximum
            ? (typeof options.errors.aboveMaximum === "function"
              ? options.errors.aboveMaximum(value, options.max)
              : options.errors.aboveMaximum)
            : message`Expected a value less than or equal to ${
              text(options.max.toLocaleString("en"))
            }, but got ${input}.`,
        };
      }
      return { success: true, value };
    },
    format(value: number): string {
      return value.toString();
    },
  };
}

/**
 * Options for creating a {@link url} parser.
 */
export interface UrlOptions {
  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `URL` or `ENDPOINT`.
   * @default `"URL"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * List of allowed URL protocols (e.g., `["http:", "https:"]`).
   * If specified, the parsed URL must use one of these protocols.
   * Protocol names should include the trailing colon (e.g., `"https:"`).
   * If not specified, any protocol is allowed.
   */
  readonly allowedProtocols?: readonly string[];

  /**
   * Custom error messages for URL parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid URL.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidUrl?: Message | ((input: string) => Message);

    /**
     * Custom error message when URL protocol is not allowed.
     * Can be a static message or a function that receives the protocol and allowed protocols.
     * @since 0.5.0
     */
    disallowedProtocol?:
      | Message
      | ((protocol: string, allowedProtocols: readonly string[]) => Message);
  };
}

/**
 * Creates a {@link ValueParser} for URL values.
 *
 * This parser validates that the input is a well-formed URL and optionally
 * restricts the allowed protocols. The parsed result is a JavaScript `URL`
 * object.
 * @param options Configuration options for the URL parser.
 * @returns A {@link ValueParser} that converts string input to `URL` objects.
 */
export function url(options: UrlOptions = {}): ValueParser<"sync", URL> {
  const allowedProtocols = options.allowedProtocols?.map((p) =>
    p.toLowerCase()
  );
  const metavar = options.metavar ?? "URL";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<URL> {
      if (!URL.canParse(input)) {
        return {
          success: false,
          error: options.errors?.invalidUrl
            ? (typeof options.errors.invalidUrl === "function"
              ? options.errors.invalidUrl(input)
              : options.errors.invalidUrl)
            : message`Invalid URL: ${input}.`,
        };
      }
      const url = new URL(input);
      if (
        allowedProtocols != null && !allowedProtocols.includes(url.protocol)
      ) {
        return {
          success: false,
          error: options.errors?.disallowedProtocol
            ? (typeof options.errors.disallowedProtocol === "function"
              ? options.errors.disallowedProtocol(
                url.protocol,
                options.allowedProtocols!,
              )
              : options.errors.disallowedProtocol)
            : message`URL protocol ${url.protocol} is not allowed. Allowed protocols: ${
              allowedProtocols.join(", ")
            }.`,
        };
      }
      return { success: true, value: url };
    },
    format(value: URL): string {
      return value.href;
    },
    *suggest(prefix: string): Iterable<Suggestion> {
      if (allowedProtocols && prefix.length > 0 && !prefix.includes("://")) {
        // Suggest protocol completions if prefix doesn't contain ://
        for (const protocol of allowedProtocols) {
          // Remove trailing colon if present, then add ://
          const cleanProtocol = protocol.replace(/:+$/, "");
          if (cleanProtocol.startsWith(prefix.toLowerCase())) {
            yield {
              kind: "literal",
              text: `${cleanProtocol}://`,
            };
          }
        }
      }
    },
  };
}

/**
 * Options for creating a {@link locale} parser.
 */
export interface LocaleOptions {
  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `LOCALE` or `LANG`.
   * @default `"LOCALE"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for locale parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid locale identifier.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidLocale?: Message | ((input: string) => Message);
  };
}

/**
 * Creates a {@link ValueParser} for locale values.
 *
 * This parser validates that the input is a well-formed locale identifier
 * according to the Unicode Locale Identifier standard (BCP 47).
 * The parsed result is a JavaScript `Intl.Locale` object.
 * @param options Configuration options for the locale parser.
 * @returns A {@link ValueParser} that converts string input to `Intl.Locale`
 *          objects.
 */
export function locale(
  options: LocaleOptions = {},
): ValueParser<"sync", Intl.Locale> {
  const metavar = options.metavar ?? "LOCALE";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<Intl.Locale> {
      let locale: Intl.Locale;
      try {
        locale = new Intl.Locale(input);
      } catch (e) {
        if (e instanceof RangeError) {
          return {
            success: false,
            error: options.errors?.invalidLocale
              ? (typeof options.errors.invalidLocale === "function"
                ? options.errors.invalidLocale(input)
                : options.errors.invalidLocale)
              : message`Invalid locale: ${input}.`,
          };
        }
        throw e;
      }
      return { success: true, value: locale };
    },
    format(value: Intl.Locale): string {
      return value.baseName;
    },
    *suggest(prefix: string): Iterable<Suggestion> {
      // Since Intl.supportedValuesOf doesn't support 'locale', we use a curated list
      // of common locale identifiers based on Unicode CLDR and common usage patterns
      const commonLocales = [
        // English variants
        "en",
        "en-US",
        "en-GB",
        "en-CA",
        "en-AU",
        "en-NZ",
        "en-IE",
        "en-ZA",
        "en-IN",

        // Spanish variants
        "es",
        "es-ES",
        "es-MX",
        "es-AR",
        "es-CL",
        "es-CO",
        "es-PE",
        "es-VE",
        "es-EC",
        "es-GT",
        "es-CU",
        "es-BO",
        "es-DO",
        "es-HN",
        "es-PY",
        "es-SV",
        "es-NI",
        "es-CR",
        "es-PA",
        "es-UY",
        "es-PR",

        // French variants
        "fr",
        "fr-FR",
        "fr-CA",
        "fr-BE",
        "fr-CH",
        "fr-LU",
        "fr-MC",

        // German variants
        "de",
        "de-DE",
        "de-AT",
        "de-CH",
        "de-BE",
        "de-LU",
        "de-LI",

        // Italian variants
        "it",
        "it-IT",
        "it-CH",
        "it-SM",
        "it-VA",

        // Portuguese variants
        "pt",
        "pt-BR",
        "pt-PT",
        "pt-AO",
        "pt-MZ",
        "pt-CV",
        "pt-GW",
        "pt-ST",
        "pt-TL",

        // Russian and Slavic
        "ru",
        "ru-RU",
        "ru-BY",
        "ru-KZ",
        "ru-KG",
        "ru-MD",
        "uk",
        "uk-UA",
        "be",
        "be-BY",
        "bg",
        "bg-BG",
        "cs",
        "cs-CZ",
        "sk",
        "sk-SK",
        "sl",
        "sl-SI",
        "hr",
        "hr-HR",
        "sr",
        "sr-RS",
        "mk",
        "mk-MK",

        // East Asian
        "ja",
        "ja-JP",
        "ko",
        "ko-KR",
        "zh",
        "zh-CN",
        "zh-TW",
        "zh-HK",
        "zh-SG",
        "zh-MO",

        // Arabic variants
        "ar",
        "ar-SA",
        "ar-AE",
        "ar-BH",
        "ar-DZ",
        "ar-EG",
        "ar-IQ",
        "ar-JO",
        "ar-KW",
        "ar-LB",
        "ar-LY",
        "ar-MA",
        "ar-OM",
        "ar-QA",
        "ar-SY",
        "ar-TN",
        "ar-YE",

        // Indian subcontinent
        "hi",
        "hi-IN",
        "bn",
        "bn-BD",
        "bn-IN",
        "ur",
        "ur-PK",
        "ta",
        "ta-IN",
        "te",
        "te-IN",
        "mr",
        "mr-IN",
        "gu",
        "gu-IN",
        "kn",
        "kn-IN",
        "ml",
        "ml-IN",
        "pa",
        "pa-IN",

        // Turkish
        "tr",
        "tr-TR",
        "tr-CY",

        // Polish
        "pl",
        "pl-PL",

        // Dutch
        "nl",
        "nl-NL",
        "nl-BE",
        "nl-SR",

        // Nordic languages
        "sv",
        "sv-SE",
        "sv-FI",
        "da",
        "da-DK",
        "no",
        "no-NO",
        "nb",
        "nb-NO",
        "nn",
        "nn-NO",
        "fi",
        "fi-FI",
        "is",
        "is-IS",

        // Other European
        "el",
        "el-GR",
        "el-CY",
        "hu",
        "hu-HU",
        "ro",
        "ro-RO",
        "et",
        "et-EE",
        "lv",
        "lv-LV",
        "lt",
        "lt-LT",
        "mt",
        "mt-MT",
        "ga",
        "ga-IE",
        "cy",
        "cy-GB",
        "eu",
        "eu-ES",
        "ca",
        "ca-ES",
        "ca-AD",

        // Asian languages
        "th",
        "th-TH",
        "vi",
        "vi-VN",
        "id",
        "id-ID",
        "ms",
        "ms-MY",
        "ms-BN",
        "ms-SG",
        "tl",
        "tl-PH",
        "km",
        "km-KH",
        "my",
        "my-MM",
        "lo",
        "lo-LA",
        "si",
        "si-LK",
        "ne",
        "ne-NP",

        // African languages
        "sw",
        "sw-TZ",
        "sw-KE",
        "am",
        "am-ET",
        "ha",
        "ha-NG",
        "yo",
        "yo-NG",
        "ig",
        "ig-NG",
        "zu",
        "zu-ZA",
        "xh",
        "xh-ZA",
        "af",
        "af-ZA",

        // Hebrew
        "he",
        "he-IL",

        // Persian/Farsi
        "fa",
        "fa-IR",
        "fa-AF",
      ];

      for (const locale of commonLocales) {
        if (locale.toLowerCase().startsWith(prefix.toLowerCase())) {
          yield {
            kind: "literal",
            text: locale,
          };
        }
      }
    },
  };
}

/**
 * Type representing a UUID string.
 *
 * A UUID is a 36-character string in the format:
 * `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
 * where each `x` is a hexadecimal digit.
 */
export type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Options for creating a {@link uuid} parser.
 */
export interface UuidOptions {
  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `UUID` or `ID`.
   * @default `"UUID"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * List of allowed UUID versions (e.g., `[4, 5]` for UUIDs version 4 and 5).
   * If specified, the parser will validate that the UUID matches one of the
   * allowed versions. If not specified, any valid UUID format is accepted.
   */
  readonly allowedVersions?: readonly number[];

  /**
   * Custom error messages for UUID parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid UUID format.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidUuid?: Message | ((input: string) => Message);

    /**
     * Custom error message when UUID version is not allowed.
     * Can be a static message or a function that receives the version and allowed versions.
     * @since 0.5.0
     */
    disallowedVersion?:
      | Message
      | ((version: number, allowedVersions: readonly number[]) => Message);
  };
}

/**
 * Creates a {@link ValueParser} for UUID values.
 *
 * This parser validates that the input is a well-formed UUID string in the
 * standard format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` where each `x`
 * is a hexadecimal digit.  The parser can optionally restrict to specific
 * UUID versions.
 *
 * @param options Configuration options for the UUID parser.
 * @returns A {@link ValueParser} that converts string input to {@link Uuid}
 *          strings.
 */
export function uuid(options: UuidOptions = {}): ValueParser<"sync", Uuid> {
  // UUID regex pattern: 8-4-4-4-12 hex digits with dashes
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const metavar = options.metavar ?? "UUID";
  ensureNonEmptyString(metavar);

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<Uuid> {
      if (!uuidRegex.test(input)) {
        return {
          success: false,
          error: options.errors?.invalidUuid
            ? (typeof options.errors.invalidUuid === "function"
              ? options.errors.invalidUuid(input)
              : options.errors.invalidUuid)
            : message`Expected a valid UUID in format ${"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}, but got ${input}.`,
        };
      }

      // Check version if specified
      if (
        options.allowedVersions != null && options.allowedVersions.length > 0
      ) {
        // Extract version from the first character of the third group
        const versionChar = input.charAt(14); // Position of version digit
        const version = parseInt(versionChar, 16);

        if (!options.allowedVersions.includes(version)) {
          return {
            success: false,
            error: options.errors?.disallowedVersion
              ? (typeof options.errors.disallowedVersion === "function"
                ? options.errors.disallowedVersion(
                  version,
                  options.allowedVersions,
                )
                : options.errors.disallowedVersion)
              : (() => {
                let expectedVersions = message``;
                let i = 0;
                for (const v of options.allowedVersions) {
                  expectedVersions = i < 1
                    ? message`${expectedVersions}${v.toLocaleString("en")}`
                    : i + 1 >= options.allowedVersions.length
                    ? message`${expectedVersions}, or ${v.toLocaleString("en")}`
                    : message`${expectedVersions}, ${v.toLocaleString("en")}`;
                  i++;
                }
                return message`Expected UUID version ${expectedVersions}, but got version ${
                  version.toLocaleString("en")
                }.`;
              })(),
          };
        }
      }

      return { success: true, value: input as Uuid };
    },
    format(value: Uuid): string {
      return value;
    },
  };
}

/**
 * Options for creating a port parser that returns a JavaScript `number`.
 */
export interface PortOptionsNumber {
  /**
   * The type of value to return.
   * @default `"number"`
   */
  readonly type?: "number";

  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `PORT`.
   * @default `"PORT"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Minimum allowed port number (inclusive).
   * @default `1`
   */
  readonly min?: number;

  /**
   * Maximum allowed port number (inclusive).
   * @default `65535`
   */
  readonly max?: number;

  /**
   * If `true`, disallows well-known ports (1-1023).
   * These ports typically require root/administrator privileges on most systems.
   * @default `false`
   */
  readonly disallowWellKnown?: boolean;

  /**
   * Custom error messages for port parsing failures.
   * @since 0.10.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid port number.
     * Can be a static message or a function that receives the input.
     * @since 0.10.0
     */
    invalidPort?: Message | ((input: string) => Message);

    /**
     * Custom error message when port is below minimum value.
     * Can be a static message or a function that receives the port and minimum.
     * @since 0.10.0
     */
    belowMinimum?: Message | ((port: number, min: number) => Message);

    /**
     * Custom error message when port is above maximum value.
     * Can be a static message or a function that receives the port and maximum.
     * @since 0.10.0
     */
    aboveMaximum?: Message | ((port: number, max: number) => Message);

    /**
     * Custom error message when well-known port is used but disallowed.
     * Can be a static message or a function that receives the port.
     * @since 0.10.0
     */
    wellKnownNotAllowed?: Message | ((port: number) => Message);
  };
}

/**
 * Options for creating a port parser that returns a `bigint`.
 */
export interface PortOptionsBigInt {
  /**
   * Must be set to `"bigint"` to create a `bigint` parser.
   */
  readonly type: "bigint";

  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `PORT`.
   * @default `"PORT"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Minimum allowed port number (inclusive).
   * @default `1n`
   */
  readonly min?: bigint;

  /**
   * Maximum allowed port number (inclusive).
   * @default `65535n`
   */
  readonly max?: bigint;

  /**
   * If `true`, disallows well-known ports (1-1023).
   * These ports typically require root/administrator privileges on most systems.
   * @default `false`
   */
  readonly disallowWellKnown?: boolean;

  /**
   * Custom error messages for port parsing failures.
   * @since 0.10.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid port number.
     * Can be a static message or a function that receives the input.
     * @since 0.10.0
     */
    invalidPort?: Message | ((input: string) => Message);

    /**
     * Custom error message when port is below minimum value.
     * Can be a static message or a function that receives the port and minimum.
     * @since 0.10.0
     */
    belowMinimum?: Message | ((port: bigint, min: bigint) => Message);

    /**
     * Custom error message when port is above maximum value.
     * Can be a static message or a function that receives the port and maximum.
     * @since 0.10.0
     */
    aboveMaximum?: Message | ((port: bigint, max: bigint) => Message);

    /**
     * Custom error message when well-known port is used but disallowed.
     * Can be a static message or a function that receives the port.
     * @since 0.10.0
     */
    wellKnownNotAllowed?: Message | ((port: bigint) => Message);
  };
}

/**
 * Creates a ValueParser for TCP/UDP port numbers that returns JavaScript numbers.
 *
 * @param options Configuration options for the port parser.
 * @returns A {@link ValueParser} that parses strings into port numbers.
 * @since 0.10.0
 */
export function port(
  options?: PortOptionsNumber,
): ValueParser<"sync", number>;

/**
 * Creates a ValueParser for TCP/UDP port numbers that returns `bigint` values.
 *
 * @param options Configuration options for the `bigint` port parser.
 * @returns A {@link ValueParser} that parses strings into `bigint` port values.
 * @since 0.10.0
 */
export function port(
  options: PortOptionsBigInt,
): ValueParser<"sync", bigint>;

/**
 * Creates a ValueParser for TCP/UDP port numbers.
 *
 * This parser validates that the input is a valid port number (1-65535 by default)
 * and optionally enforces range constraints and well-known port restrictions.
 *
 * Port numbers are validated according to the following rules:
 * - Must be a valid integer (no decimals, no scientific notation)
 * - Must be within the range `[min, max]` (default `[1, 65535]`)
 * - If `disallowWellKnown` is `true`, ports 1-1023 are rejected
 *
 * The parser provides two modes of operation:
 * - Regular mode: Returns JavaScript numbers (safe for all port values)
 * - `bigint` mode: Returns `bigint` values for consistency with other numeric types
 *
 * @example
 * ```typescript
 * // Basic port parser (1-65535)
 * option("--port", port())
 *
 * // Custom range (non-privileged ports only)
 * option("--port", port({ min: 1024, max: 65535 }))
 *
 * // Disallow well-known ports (reject 1-1023)
 * option("--port", port({ disallowWellKnown: true }))
 *
 * // Development ports only
 * option("--dev-port", port({ min: 3000, max: 9000 }))
 *
 * // Using bigint type
 * option("--port", port({ type: "bigint" }))
 * ```
 *
 * @param options Configuration options specifying the type and constraints.
 * @returns A {@link ValueParser} that converts string input to port numbers.
 * @since 0.10.0
 */
export function port(
  options?: PortOptionsNumber | PortOptionsBigInt,
): ValueParser<"sync", number> | ValueParser<"sync", bigint> {
  if (options?.type === "bigint") {
    const metavar = options.metavar ?? "PORT";
    ensureNonEmptyString(metavar);
    const min = options.min ?? 1n;
    const max = options.max ?? 65535n;

    return {
      $mode: "sync",
      metavar,
      parse(input: string): ValueParserResult<bigint> {
        let value: bigint;
        try {
          value = BigInt(input);
        } catch (e) {
          if (e instanceof SyntaxError) {
            return {
              success: false,
              error: options.errors?.invalidPort
                ? (typeof options.errors.invalidPort === "function"
                  ? options.errors.invalidPort(input)
                  : options.errors.invalidPort)
                : message`Expected a valid port number, but got ${input}.`,
            };
          }
          throw e;
        }

        if (value < min) {
          return {
            success: false,
            error: options.errors?.belowMinimum
              ? (typeof options.errors.belowMinimum === "function"
                ? options.errors.belowMinimum(value, min)
                : options.errors.belowMinimum)
              : message`Expected a port number greater than or equal to ${
                text(min.toLocaleString("en"))
              }, but got ${input}.`,
          };
        }

        if (value > max) {
          return {
            success: false,
            error: options.errors?.aboveMaximum
              ? (typeof options.errors.aboveMaximum === "function"
                ? options.errors.aboveMaximum(value, max)
                : options.errors.aboveMaximum)
              : message`Expected a port number less than or equal to ${
                text(max.toLocaleString("en"))
              }, but got ${input}.`,
          };
        }

        if (options.disallowWellKnown && value >= 1n && value <= 1023n) {
          return {
            success: false,
            error: options.errors?.wellKnownNotAllowed
              ? (typeof options.errors.wellKnownNotAllowed === "function"
                ? options.errors.wellKnownNotAllowed(value)
                : options.errors.wellKnownNotAllowed)
              : message`Port ${
                value.toLocaleString("en")
              } is a well-known port (1-1023) and may require elevated privileges.`,
          };
        }

        return { success: true, value };
      },
      format(value: bigint): string {
        return value.toString();
      },
    };
  }

  const metavar = options?.metavar ?? "PORT";
  ensureNonEmptyString(metavar);
  const min = options?.min ?? 1;
  const max = options?.max ?? 65535;

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<number> {
      if (!input.match(/^-?\d+$/)) {
        return {
          success: false,
          error: options?.errors?.invalidPort
            ? (typeof options.errors.invalidPort === "function"
              ? options.errors.invalidPort(input)
              : options.errors.invalidPort)
            : message`Expected a valid port number, but got ${input}.`,
        };
      }

      const value = Number.parseInt(input);

      if (value < min) {
        return {
          success: false,
          error: options?.errors?.belowMinimum
            ? (typeof options.errors.belowMinimum === "function"
              ? options.errors.belowMinimum(value, min)
              : options.errors.belowMinimum)
            : message`Expected a port number greater than or equal to ${
              text(min.toLocaleString("en"))
            }, but got ${input}.`,
        };
      }

      if (value > max) {
        return {
          success: false,
          error: options?.errors?.aboveMaximum
            ? (typeof options.errors.aboveMaximum === "function"
              ? options.errors.aboveMaximum(value, max)
              : options.errors.aboveMaximum)
            : message`Expected a port number less than or equal to ${
              text(max.toLocaleString("en"))
            }, but got ${input}.`,
        };
      }

      if (options?.disallowWellKnown && value >= 1 && value <= 1023) {
        return {
          success: false,
          error: options.errors?.wellKnownNotAllowed
            ? (typeof options.errors.wellKnownNotAllowed === "function"
              ? options.errors.wellKnownNotAllowed(value)
              : options.errors.wellKnownNotAllowed)
            : message`Port ${
              value.toLocaleString("en")
            } is a well-known port (1-1023) and may require elevated privileges.`,
        };
      }

      return { success: true, value };
    },
    format(value: number): string {
      return value.toString();
    },
  };
}

/**
 * Options for the {@link ipv4} value parser.
 *
 * @since 0.10.0
 */
export interface Ipv4Options {
  /**
   * The metavariable name for this parser.
   *
   * @default "IPV4"
   */
  readonly metavar?: NonEmptyString;

  /**
   * If `true`, allows private IP ranges (10.0.0.0/8, 172.16.0.0/12,
   * 192.168.0.0/16).
   *
   * @default true
   */
  readonly allowPrivate?: boolean;

  /**
   * If `true`, allows loopback addresses (127.0.0.0/8).
   *
   * @default true
   */
  readonly allowLoopback?: boolean;

  /**
   * If `true`, allows link-local addresses (169.254.0.0/16).
   *
   * @default true
   */
  readonly allowLinkLocal?: boolean;

  /**
   * If `true`, allows multicast addresses (224.0.0.0/4).
   *
   * @default true
   */
  readonly allowMulticast?: boolean;

  /**
   * If `true`, allows the broadcast address (255.255.255.255).
   *
   * @default true
   */
  readonly allowBroadcast?: boolean;

  /**
   * If `true`, allows the zero address (0.0.0.0).
   *
   * @default true
   */
  readonly allowZero?: boolean;

  /**
   * Custom error messages for IPv4 parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid IPv4 address.
     * Can be a static message or a function that receives the input.
     */
    invalidIpv4?: Message | ((input: string) => Message);

    /**
     * Custom error message when private IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    privateNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when loopback IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    loopbackNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when link-local IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    linkLocalNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when multicast IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    multicastNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when broadcast IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    broadcastNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when zero IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    zeroNotAllowed?: Message | ((ip: string) => Message);
  };
}

function isPrivateIp(octets: readonly number[]): boolean {
  // 10.0.0.0/8
  if (octets[0] === 10) return true;
  // 172.16.0.0/12
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  // 192.168.0.0/16
  if (octets[0] === 192 && octets[1] === 168) return true;
  return false;
}

function isLoopbackIp(octets: readonly number[]): boolean {
  return octets[0] === 127;
}

function isLinkLocalIp(octets: readonly number[]): boolean {
  return octets[0] === 169 && octets[1] === 254;
}

function isMulticastIp(octets: readonly number[]): boolean {
  return octets[0] >= 224 && octets[0] <= 239;
}

function isBroadcastIp(octets: readonly number[]): boolean {
  return octets.every((o) => o === 255);
}

function isZeroIp(octets: readonly number[]): boolean {
  return octets.every((o) => o === 0);
}

/**
 * Creates a value parser for IPv4 addresses.
 *
 * This parser validates IPv4 addresses in dotted-decimal notation (e.g.,
 * "192.168.1.1") and provides options to filter specific IP address types
 * such as private, loopback, link-local, multicast, broadcast, and zero
 * addresses.
 *
 * @param options The parser options.
 * @returns A value parser for IPv4 addresses.
 * @throws {TypeError} If the metavar is an empty string.
 * @since 0.10.0
 * @example
 * ```typescript
 * import { ipv4 } from "@optique/core/valueparser";
 *
 * // Basic IPv4 parser (allows all types)
 * const address = ipv4();
 *
 * // Public IPs only (no private/loopback)
 * const publicIp = ipv4({
 *   allowPrivate: false,
 *   allowLoopback: false
 * });
 *
 * // Server binding (allow 0.0.0.0 and private IPs)
 * const bindAddress = ipv4({
 *   allowZero: true,
 *   allowPrivate: true
 * });
 * ```
 */
export function ipv4(options?: Ipv4Options): ValueParser<"sync", string> {
  const metavar: NonEmptyString = options?.metavar ?? "IPV4";
  ensureNonEmptyString(metavar);

  const allowPrivate = options?.allowPrivate ?? true;
  const allowLoopback = options?.allowLoopback ?? true;
  const allowLinkLocal = options?.allowLinkLocal ?? true;
  const allowMulticast = options?.allowMulticast ?? true;
  const allowBroadcast = options?.allowBroadcast ?? true;
  const allowZero = options?.allowZero ?? true;

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<string> {
      // Parse IPv4 address into octets
      const parts = input.split(".");
      if (parts.length !== 4) {
        const errorMsg = options?.errors?.invalidIpv4;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input)
          : errorMsg ??
            message`Expected a valid IPv4 address, but got ${input}.`;
        return { success: false, error: msg };
      }

      const octets: number[] = [];
      for (const part of parts) {
        // Check for empty octet
        if (part.length === 0) {
          const errorMsg = options?.errors?.invalidIpv4;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid IPv4 address, but got ${input}.`;
          return { success: false, error: msg };
        }

        // Check for whitespace
        if (part.trim() !== part) {
          const errorMsg = options?.errors?.invalidIpv4;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid IPv4 address, but got ${input}.`;
          return { success: false, error: msg };
        }

        // Check for leading zeros (except single "0")
        if (part.length > 1 && part[0] === "0") {
          const errorMsg = options?.errors?.invalidIpv4;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid IPv4 address, but got ${input}.`;
          return { success: false, error: msg };
        }

        const octet = Number(part);
        if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
          const errorMsg = options?.errors?.invalidIpv4;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid IPv4 address, but got ${input}.`;
          return { success: false, error: msg };
        }

        octets.push(octet);
      }

      const ipAddress = octets.join(".");

      // Check IP address type filters
      if (!allowPrivate && isPrivateIp(octets)) {
        const errorMsg = options?.errors?.privateNotAllowed;
        const msg = typeof errorMsg === "function"
          ? errorMsg(ipAddress)
          : errorMsg ?? message`${ipAddress} is a private IP address.`;
        return { success: false, error: msg };
      }

      if (!allowLoopback && isLoopbackIp(octets)) {
        const errorMsg = options?.errors?.loopbackNotAllowed;
        const msg = typeof errorMsg === "function"
          ? errorMsg(ipAddress)
          : errorMsg ?? message`${ipAddress} is a loopback address.`;
        return { success: false, error: msg };
      }

      if (!allowLinkLocal && isLinkLocalIp(octets)) {
        const errorMsg = options?.errors?.linkLocalNotAllowed;
        const msg = typeof errorMsg === "function"
          ? errorMsg(ipAddress)
          : errorMsg ?? message`${ipAddress} is a link-local address.`;
        return { success: false, error: msg };
      }

      if (!allowMulticast && isMulticastIp(octets)) {
        const errorMsg = options?.errors?.multicastNotAllowed;
        const msg = typeof errorMsg === "function"
          ? errorMsg(ipAddress)
          : errorMsg ?? message`${ipAddress} is a multicast address.`;
        return { success: false, error: msg };
      }

      if (!allowBroadcast && isBroadcastIp(octets)) {
        const errorMsg = options?.errors?.broadcastNotAllowed;
        const msg = typeof errorMsg === "function"
          ? errorMsg(ipAddress)
          : errorMsg ?? message`${ipAddress} is the broadcast address.`;
        return { success: false, error: msg };
      }

      if (!allowZero && isZeroIp(octets)) {
        const errorMsg = options?.errors?.zeroNotAllowed;
        const msg = typeof errorMsg === "function"
          ? errorMsg(ipAddress)
          : errorMsg ?? message`${ipAddress} is the zero address.`;
        return { success: false, error: msg };
      }

      return { success: true, value: ipAddress };
    },
    format(value: string): string {
      return value;
    },
  };
}

/**
 * Options for the {@link hostname} parser.
 *
 * @since 0.10.0
 */
export interface HostnameOptions {
  /**
   * The metavariable name for this parser.
   * @default "HOST"
   */
  readonly metavar?: NonEmptyString;

  /**
   * If `true`, allows wildcard hostnames (e.g., "*.example.com").
   * @default false
   */
  readonly allowWildcard?: boolean;

  /**
   * If `true`, allows underscores in hostnames.
   * Technically invalid per RFC 1123, but commonly used in some contexts
   * (e.g., service discovery records like "_service.example.com").
   * @default false
   */
  readonly allowUnderscore?: boolean;

  /**
   * If `true`, allows "localhost" as a hostname.
   * @default true
   */
  readonly allowLocalhost?: boolean;

  /**
   * Maximum hostname length in characters.
   * @default 253
   */
  readonly maxLength?: number;

  /**
   * Custom error messages for hostname parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid hostname.
     * Can be a static message or a function that receives the input.
     */
    invalidHostname?: Message | ((input: string) => Message);

    /**
     * Custom error message when wildcard hostname is used but disallowed.
     * Can be a static message or a function that receives the hostname.
     */
    wildcardNotAllowed?: Message | ((hostname: string) => Message);

    /**
     * Custom error message when underscore is used but disallowed.
     * Can be a static message or a function that receives the hostname.
     */
    underscoreNotAllowed?: Message | ((hostname: string) => Message);

    /**
     * Custom error message when "localhost" is used but disallowed.
     * Can be a static message or a function that receives the hostname.
     */
    localhostNotAllowed?: Message | ((hostname: string) => Message);

    /**
     * Custom error message when hostname is too long.
     * Can be a static message or a function that receives the hostname and max length.
     */
    tooLong?: Message | ((hostname: string, maxLength: number) => Message);
  };
}

/**
 * Creates a value parser for DNS hostnames.
 *
 * Validates hostnames according to RFC 1123:
 * - Labels separated by dots
 * - Each label: 1-63 characters
 * - Labels can contain alphanumeric characters and hyphens
 * - Labels cannot start or end with a hyphen
 * - Total length ≤ 253 characters (default)
 *
 * @param options - Options for hostname validation.
 * @returns A value parser for hostnames.
 * @since 0.10.0
 *
 * @example
 * ```typescript
 * import { hostname } from "@optique/core/valueparser";
 *
 * // Basic hostname parser
 * const host = hostname();
 *
 * // Allow wildcards for certificate validation
 * const domain = hostname({ allowWildcard: true });
 *
 * // Reject localhost
 * const remoteHost = hostname({ allowLocalhost: false });
 * ```
 */
export function hostname(
  options?: HostnameOptions,
): ValueParser<"sync", string> {
  const metavar: NonEmptyString = options?.metavar ?? "HOST";
  ensureNonEmptyString(metavar);

  const allowWildcard = options?.allowWildcard ?? false;
  const allowUnderscore = options?.allowUnderscore ?? false;
  const allowLocalhost = options?.allowLocalhost ?? true;
  const maxLength = options?.maxLength ?? 253;

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<string> {
      // Check length constraint first
      if (input.length > maxLength) {
        const errorMsg = options?.errors?.tooLong;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input, maxLength)
          : errorMsg ??
            message`Hostname ${input} is too long (maximum ${
              text(maxLength.toString())
            } characters).`;
        return { success: false, error: msg };
      }

      // Check for localhost
      if (!allowLocalhost && input === "localhost") {
        const errorMsg = options?.errors?.localhostNotAllowed;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input)
          : errorMsg ?? message`Hostname 'localhost' is not allowed.`;
        return { success: false, error: msg };
      }

      // Check for wildcard
      if (input.startsWith("*.")) {
        if (!allowWildcard) {
          const errorMsg = options?.errors?.wildcardNotAllowed;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Wildcard hostname ${input} is not allowed.`;
          return { success: false, error: msg };
        }

        // If wildcard is allowed, validate the rest of the hostname
        const rest = input.slice(2);
        if (!rest || rest.includes("*")) {
          const errorMsg = options?.errors?.invalidHostname;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid hostname, but got ${input}.`;
          return { success: false, error: msg };
        }
      }

      // Check for underscore
      if (!allowUnderscore && input.includes("_")) {
        const errorMsg = options?.errors?.underscoreNotAllowed;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input)
          : errorMsg ??
            message`Hostname ${input} contains underscore, which is not allowed.`;
        return { success: false, error: msg };
      }

      // RFC 1123 hostname validation
      // Must not be empty
      if (input.length === 0) {
        const errorMsg = options?.errors?.invalidHostname;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input)
          : errorMsg ?? message`Expected a valid hostname, but got ${input}.`;
        return { success: false, error: msg };
      }

      // Split into labels
      const labels = input.split(".");

      // Each label must be valid
      for (const label of labels) {
        // Label must not be empty
        if (label.length === 0) {
          const errorMsg = options?.errors?.invalidHostname;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid hostname, but got ${input}.`;
          return { success: false, error: msg };
        }

        // Label must not exceed 63 characters
        if (label.length > 63) {
          const errorMsg = options?.errors?.invalidHostname;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid hostname, but got ${input}.`;
          return { success: false, error: msg };
        }

        // Skip wildcard label (already validated above)
        if (label === "*") {
          continue;
        }

        // Label must not start or end with hyphen
        if (label.startsWith("-") || label.endsWith("-")) {
          const errorMsg = options?.errors?.invalidHostname;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid hostname, but got ${input}.`;
          return { success: false, error: msg };
        }

        // Label must contain only alphanumeric, hyphen, or underscore (if allowed)
        const allowedPattern = allowUnderscore
          ? /^[a-zA-Z0-9_-]+$/
          : /^[a-zA-Z0-9-]+$/;
        if (!allowedPattern.test(label)) {
          const errorMsg = options?.errors?.invalidHostname;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid hostname, but got ${input}.`;
          return { success: false, error: msg };
        }
      }

      return { success: true, value: input };
    },
    format(value: string): string {
      return value;
    },
  };
}

/**
 * Options for the {@link email} parser.
 *
 * @since 0.10.0
 */
export interface EmailOptions {
  /**
   * The metavariable name for this parser.
   * @default "EMAIL"
   */
  readonly metavar?: NonEmptyString;

  /**
   * If `true`, allows multiple email addresses separated by commas.
   * Returns an array of email addresses.
   * @default false
   */
  readonly allowMultiple?: boolean;

  /**
   * If `true`, allows display names in format "Name <email@example.com>".
   * When enabled, returns the email address only (strips display name).
   * @default false
   */
  readonly allowDisplayName?: boolean;

  /**
   * If `true`, converts email to lowercase.
   * @default false
   */
  readonly lowercase?: boolean;

  /**
   * List of allowed email domains (e.g., ["example.com", "test.org"]).
   * If specified, only emails from these domains are accepted.
   */
  readonly allowedDomains?: readonly string[];

  /**
   * Custom error messages for email parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid email address.
     * Can be a static message or a function that receives the input.
     */
    invalidEmail?: Message | ((input: string) => Message);

    /**
     * Custom error message when email domain is not allowed.
     * Can be a static message or a function that receives the email and allowed domains.
     */
    domainNotAllowed?:
      | Message
      | ((email: string, allowedDomains: readonly string[]) => Message);
  };
}

/**
 * Creates a value parser for email addresses according to RFC 5322 (simplified).
 *
 * Validates email addresses with support for:
 * - Simplified RFC 5322 addr-spec format (local-part@domain)
 * - Local part: alphanumeric, dots, hyphens, underscores, plus signs
 * - Quoted strings in local part
 * - Display names (when `allowDisplayName` is enabled)
 * - Multiple addresses (when `allowMultiple` is enabled)
 * - Domain filtering (when `allowedDomains` is specified)
 *
 * @param options - Options for email validation.
 * @returns A value parser for email addresses.
 * @since 0.10.0
 *
 * @example
 * ```typescript
 * import { email } from "@optique/core/valueparser";
 *
 * // Basic email parser
 * const userEmail = email();
 *
 * // Multiple emails
 * const recipients = email({ allowMultiple: true });
 *
 * // With display names
 * const from = email({ allowDisplayName: true });
 *
 * // Restrict to company domains
 * const workEmail = email({ allowedDomains: ["company.com"] });
 * ```
 */
export function email(
  options: EmailOptions & { allowMultiple: true },
): ValueParser<"sync", readonly string[]>;
export function email(
  options?: EmailOptions,
): ValueParser<"sync", string>;
export function email(
  options?: EmailOptions,
): ValueParser<"sync", string | readonly string[]> {
  const metavar: NonEmptyString = options?.metavar ?? "EMAIL";
  ensureNonEmptyString(metavar);

  const allowMultiple = options?.allowMultiple ?? false;
  const allowDisplayName = options?.allowDisplayName ?? false;
  const lowercase = options?.lowercase ?? false;
  const allowedDomains = options?.allowedDomains;

  // Simplified RFC 5322: alphanumeric, dots, hyphens, underscores, plus signs
  const atextRegex = /^[a-zA-Z0-9._+-]+$/;

  // Validate a single email address (RFC 5322 addr-spec)
  function validateEmail(input: string): string | null {
    const trimmed = input.trim();

    // Handle display name format: "Name <email@example.com>"
    let emailAddr = trimmed;
    if (allowDisplayName && trimmed.includes("<") && trimmed.endsWith(">")) {
      const match = trimmed.match(/<([^>]+)>$/);
      if (match) {
        emailAddr = match[1].trim();
      }
    }

    // Find the @ sign that separates local part from domain
    // Handle quoted local parts which may contain @ signs
    let atIndex = -1;
    if (emailAddr.startsWith('"')) {
      // Quoted local part - find closing quote, then find @ after it
      const closingQuoteIndex = emailAddr.indexOf('"', 1);
      if (closingQuoteIndex === -1) {
        return null; // Unclosed quote
      }
      atIndex = emailAddr.indexOf("@", closingQuoteIndex);
    } else {
      // Unquoted local part - find first @
      atIndex = emailAddr.indexOf("@");
    }

    if (atIndex === -1) {
      return null; // No @ sign found
    }

    // Ensure there's only one @ sign after the local part
    const lastAtIndex = emailAddr.lastIndexOf("@");
    if (atIndex !== lastAtIndex) {
      return null; // Multiple @ signs in domain
    }

    const localPart = emailAddr.substring(0, atIndex);
    const domain = emailAddr.substring(atIndex + 1);

    // Validate local part
    if (!localPart || localPart.length === 0) {
      return null;
    }

    // RFC 5322: local-part = dot-atom / quoted-string
    let isValidLocal = false;

    // Check if it's a quoted-string
    if (localPart.startsWith('"') && localPart.endsWith('"')) {
      // Quoted string - allow most characters
      // For simplicity, we accept quoted strings as-is (proper parsing would check escapes)
      isValidLocal = localPart.length >= 2;
    } else {
      // Must be dot-atom: 1*atext *("." 1*atext)
      const localParts = localPart.split(".");

      // Cannot start or end with dot
      if (localPart.startsWith(".") || localPart.endsWith(".")) {
        return null;
      }

      // Check each part is valid atext
      isValidLocal = localParts.length > 0 &&
        localParts.every((part) => part.length > 0 && atextRegex.test(part));
    }

    if (!isValidLocal) {
      return null;
    }

    // Validate domain part
    if (!domain || domain.length === 0) {
      return null;
    }

    // Domain must contain at least one dot (simplified RFC 5322)
    if (!domain.includes(".")) {
      return null;
    }

    // Domain cannot start or end with dot or hyphen
    if (
      domain.startsWith(".") || domain.endsWith(".") ||
      domain.startsWith("-") || domain.endsWith("-")
    ) {
      return null;
    }

    // Check domain labels
    const domainLabels = domain.split(".");
    for (const label of domainLabels) {
      if (label.length === 0 || label.length > 63) {
        return null;
      }
      // Labels can contain alphanumeric and hyphens, but not start/end with hyphen
      if (label.startsWith("-") || label.endsWith("-")) {
        return null;
      }
      if (!/^[a-zA-Z0-9-]+$/.test(label)) {
        return null;
      }
    }

    // Return the email (preserve original form or extracted from display name)
    const resultEmail = emailAddr;
    return lowercase ? resultEmail.toLowerCase() : resultEmail;
  }

  return {
    $mode: "sync" as const,
    metavar,
    parse(
      input: string,
    ): ValueParserResult<string> | ValueParserResult<readonly string[]> {
      if (allowMultiple) {
        // Parse multiple emails separated by commas
        const emails = input.split(",").map((e) => e.trim());
        const validatedEmails: string[] = [];

        for (const email of emails) {
          const validated = validateEmail(email);
          if (validated === null) {
            const errorMsg = options?.errors?.invalidEmail;
            const msg = typeof errorMsg === "function"
              ? errorMsg(email)
              : errorMsg ??
                message`Expected a valid email address, but got ${email}.`;
            return { success: false, error: msg };
          }

          // Check domain restriction
          if (allowedDomains && allowedDomains.length > 0) {
            const atIndex = validated.indexOf("@");
            const domain = validated.substring(atIndex + 1).toLowerCase();
            const isAllowed = allowedDomains.some((allowed) =>
              domain === allowed.toLowerCase()
            );
            if (!isAllowed) {
              const errorMsg = options?.errors?.domainNotAllowed;
              if (typeof errorMsg === "function") {
                return {
                  success: false,
                  error: errorMsg(validated, allowedDomains),
                };
              }
              const msg = errorMsg ?? [
                { type: "text", text: "Email domain " },
                { type: "value", value: domain },
                {
                  type: "text",
                  text: ` is not allowed. Allowed domains: ${
                    allowedDomains.join(", ")
                  }.`,
                },
              ] as Message;
              return { success: false, error: msg };
            }
          }

          validatedEmails.push(validated);
        }

        return { success: true, value: validatedEmails };
      } else {
        // Parse single email
        const validated = validateEmail(input);
        if (validated === null) {
          const errorMsg = options?.errors?.invalidEmail;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid email address, but got ${input}.`;
          return { success: false, error: msg };
        }

        // Check domain restriction
        if (allowedDomains && allowedDomains.length > 0) {
          const atIndex = validated.indexOf("@");
          const domain = validated.substring(atIndex + 1).toLowerCase();
          const isAllowed = allowedDomains.some((allowed) =>
            domain === allowed.toLowerCase()
          );
          if (!isAllowed) {
            const errorMsg = options?.errors?.domainNotAllowed;
            if (typeof errorMsg === "function") {
              return {
                success: false,
                error: errorMsg(validated, allowedDomains),
              };
            }
            const msg = errorMsg ?? [
              { type: "text", text: "Email domain " },
              { type: "value", value: domain },
              {
                type: "text",
                text: ` is not allowed. Allowed domains: ${
                  allowedDomains.join(", ")
                }.`,
              },
            ] as Message;
            return { success: false, error: msg };
          }
        }

        return { success: true, value: validated };
      }
    },
    format(value: string | readonly string[]): string {
      if (Array.isArray(value)) {
        return value.join(",");
      }
      return value as string;
    },
  } as ValueParser<"sync", string | readonly string[]>;
}

/**
 * Socket address value containing host and port.
 *
 * @since 0.10.0
 */
export interface SocketAddressValue {
  /**
   * The host portion (hostname or IP address).
   */
  readonly host: string;

  /**
   * The port number.
   */
  readonly port: number;
}

/**
 * Options for the {@link socketAddress} parser.
 *
 * @since 0.10.0
 */
export interface SocketAddressOptions {
  /**
   * The metavariable name for this parser.
   * @default "HOST:PORT"
   */
  readonly metavar?: NonEmptyString;

  /**
   * Separator character(s) between host and port.
   * @default ":"
   */
  readonly separator?: string;

  /**
   * Default port number if omitted from input.
   * If not specified, port is required.
   */
  readonly defaultPort?: number;

  /**
   * If `true`, requires port to be specified in input
   * (ignores `defaultPort`).
   * @default false
   */
  readonly requirePort?: boolean;

  /**
   * Options for hostname/IP validation.
   */
  readonly host?: {
    /**
     * Type of host to accept.
     * - `"hostname"`: Accept hostnames only
     * - `"ip"`: Accept IP addresses only
     * - `"both"`: Accept both hostnames and IP addresses
     * @default "both"
     */
    readonly type?: "hostname" | "ip" | "both";

    /**
     * Options for hostname validation (when type is "hostname" or "both").
     */
    readonly hostname?: Omit<HostnameOptions, "metavar" | "errors">;

    /**
     * Options for IP validation (when type is "ip" or "both").
     * Currently only supports IPv4.
     */
    readonly ip?: Omit<Ipv4Options, "metavar" | "errors">;
  };

  /**
   * Options for port validation.
   */
  readonly port?: Omit<PortOptionsNumber, "metavar" | "errors" | "type">;

  /**
   * Custom error messages for socket address parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input format is invalid.
     * Can be a static message or a function that receives the input.
     */
    invalidFormat?: Message | ((input: string) => Message);

    /**
     * Custom error message when port is missing but required.
     * Can be a static message or a function that receives the input.
     */
    missingPort?: Message | ((input: string) => Message);
  };
}

/**
 * Creates a value parser for socket addresses in "host:port" format.
 *
 * Validates socket addresses with support for:
 * - Hostnames and IPv4 addresses (IPv6 support coming in future versions)
 * - Configurable host:port separator
 * - Optional default port
 * - Host type filtering (hostname only, IP only, or both)
 * - Port range validation
 *
 * @param options - Options for socket address validation.
 * @returns A value parser for socket addresses.
 * @since 0.10.0
 *
 * @example
 * ```typescript
 * import { socketAddress } from "@optique/core/valueparser";
 *
 * // Basic socket address parser
 * const endpoint = socketAddress({ requirePort: true });
 *
 * // With default port
 * const server = socketAddress({ defaultPort: 80 });
 *
 * // IP addresses only
 * const bind = socketAddress({
 *   defaultPort: 8080,
 *   host: { type: "ip" }
 * });
 * ```
 */
export function socketAddress(
  options?: SocketAddressOptions,
): ValueParser<"sync", SocketAddressValue> {
  const metavar: NonEmptyString = options?.metavar ?? "HOST:PORT";
  ensureNonEmptyString(metavar);

  const separator = options?.separator ?? ":";
  const defaultPort = options?.defaultPort;
  const requirePort = options?.requirePort ?? false;
  const hostType = options?.host?.type ?? "both";

  // Create host parser based on type
  const hostnameParser = hostname({
    ...options?.host?.hostname,
    metavar: "HOST",
  });
  const ipParser = ipv4({
    ...options?.host?.ip,
    metavar: "HOST",
  });

  // Create port parser
  const portParser = port({
    ...options?.port,
    metavar: "PORT",
    type: "number",
  });

  function parseHost(hostInput: string): string | null {
    if (hostType === "hostname") {
      // Reject IP addresses when type is "hostname"
      const ipResult = ipParser.parse(hostInput);
      if (ipResult.success) {
        return null; // IP address not allowed
      }
      const result = hostnameParser.parse(hostInput);
      return result.success ? result.value : null;
    } else if (hostType === "ip") {
      const result = ipParser.parse(hostInput);
      return result.success ? result.value : null;
    } else {
      // Try IP first, then hostname
      const ipResult = ipParser.parse(hostInput);
      if (ipResult.success) {
        return ipResult.value;
      }
      const hostnameResult = hostnameParser.parse(hostInput);
      return hostnameResult.success ? hostnameResult.value : null;
    }
  }

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<SocketAddressValue> {
      const trimmed = input.trim();

      // Find separator
      const separatorIndex = trimmed.lastIndexOf(separator);

      let hostPart: string;
      let portPart: string | undefined;

      if (separatorIndex === -1) {
        // No separator found - host only
        hostPart = trimmed;
        portPart = undefined;
      } else {
        hostPart = trimmed.substring(0, separatorIndex);
        portPart = trimmed.substring(separatorIndex + separator.length);
      }

      // Validate host
      const validatedHost = parseHost(hostPart);
      if (validatedHost === null) {
        const errorMsg = options?.errors?.invalidFormat;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input)
          : errorMsg ??
            message`Expected a socket address in format host${separator}port, but got ${input}.`;
        return { success: false, error: msg };
      }

      // Validate port
      let validatedPort: number;

      if (portPart === undefined || portPart === "") {
        // Port is missing
        if (requirePort) {
          const errorMsg = options?.errors?.missingPort;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Port number is required but was not specified.`;
          return { success: false, error: msg };
        }

        if (defaultPort !== undefined) {
          validatedPort = defaultPort;
        } else {
          const errorMsg = options?.errors?.missingPort;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Port number is required but was not specified.`;
          return { success: false, error: msg };
        }
      } else {
        // Parse port
        const portResult = portParser.parse(portPart);
        if (!portResult.success) {
          const errorMsg = options?.errors?.invalidFormat;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a socket address in format host${separator}port, but got ${input}.`;
          return { success: false, error: msg };
        }
        validatedPort = portResult.value as number;
      }

      return {
        success: true,
        value: {
          host: validatedHost,
          port: validatedPort,
        },
      };
    },
    format(value: SocketAddressValue): string {
      return `${value.host}${separator}${value.port}`;
    },
  };
}

/**
 * Port range value with number type.
 *
 * @since 0.10.0
 */
export interface PortRangeValueNumber {
  /**
   * Starting port number (inclusive).
   */
  readonly start: number;

  /**
   * Ending port number (inclusive).
   */
  readonly end: number;
}

/**
 * Port range value with bigint type.
 *
 * @since 0.10.0
 */
export interface PortRangeValueBigInt {
  /**
   * Starting port number (inclusive).
   */
  readonly start: bigint;

  /**
   * Ending port number (inclusive).
   */
  readonly end: bigint;
}

/**
 * Options for the {@link portRange} parser that returns number values.
 *
 * @since 0.10.0
 */
export interface PortRangeOptionsNumber {
  /**
   * The type of values to return.
   * @default "number"
   */
  readonly type?: "number";

  /**
   * The metavariable name for this parser.
   * @default "PORT-PORT"
   */
  readonly metavar?: NonEmptyString;

  /**
   * Separator character(s) between start and end ports.
   * @default "-"
   */
  readonly separator?: string;

  /**
   * Minimum allowed port number (inclusive).
   * Applied to both start and end ports.
   * @default 1
   */
  readonly min?: number;

  /**
   * Maximum allowed port number (inclusive).
   * Applied to both start and end ports.
   * @default 65535
   */
  readonly max?: number;

  /**
   * If `true`, disallows well-known ports (1-1023).
   * Applied to both start and end ports.
   * @default false
   */
  readonly disallowWellKnown?: boolean;

  /**
   * If `true`, allows single port without range (e.g., "8080").
   * The result will have `start === end`.
   * @default false
   */
  readonly allowSingle?: boolean;

  /**
   * Custom error messages for port range parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input format is invalid.
     * Can be a static message or a function that receives the input.
     */
    invalidFormat?: Message | ((input: string) => Message);

    /**
     * Custom error message when start port is greater than end port.
     * Can be a static message or a function that receives start and end.
     */
    invalidRange?: Message | ((start: number, end: number) => Message);

    /**
     * Custom error message when port is invalid.
     * Inherited from PortOptions.
     */
    invalidPort?: Message | ((input: string) => Message);

    /**
     * Custom error message when port is below minimum.
     * Inherited from PortOptions.
     */
    belowMinimum?: Message | ((port: number, min: number) => Message);

    /**
     * Custom error message when port is above maximum.
     * Inherited from PortOptions.
     */
    aboveMaximum?: Message | ((port: number, max: number) => Message);

    /**
     * Custom error message when well-known port is not allowed.
     * Inherited from PortOptions.
     */
    wellKnownNotAllowed?: Message | ((port: number) => Message);
  };
}

/**
 * Options for the {@link portRange} parser that returns bigint values.
 *
 * @since 0.10.0
 */
export interface PortRangeOptionsBigInt {
  /**
   * Must be set to "bigint" to create a bigint parser.
   */
  readonly type: "bigint";

  /**
   * The metavariable name for this parser.
   * @default "PORT-PORT"
   */
  readonly metavar?: NonEmptyString;

  /**
   * Separator character(s) between start and end ports.
   * @default "-"
   */
  readonly separator?: string;

  /**
   * Minimum allowed port number (inclusive).
   * Applied to both start and end ports.
   * @default 1n
   */
  readonly min?: bigint;

  /**
   * Maximum allowed port number (inclusive).
   * Applied to both start and end ports.
   * @default 65535n
   */
  readonly max?: bigint;

  /**
   * If `true`, disallows well-known ports (1-1023).
   * Applied to both start and end ports.
   * @default false
   */
  readonly disallowWellKnown?: boolean;

  /**
   * If `true`, allows single port without range (e.g., "8080").
   * The result will have `start === end`.
   * @default false
   */
  readonly allowSingle?: boolean;

  /**
   * Custom error messages for port range parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input format is invalid.
     * Can be a static message or a function that receives the input.
     */
    invalidFormat?: Message | ((input: string) => Message);

    /**
     * Custom error message when start port is greater than end port.
     * Can be a static message or a function that receives start and end.
     */
    invalidRange?: Message | ((start: bigint, end: bigint) => Message);

    /**
     * Custom error message when port is invalid.
     * Inherited from PortOptions.
     */
    invalidPort?: Message | ((input: string) => Message);

    /**
     * Custom error message when port is below minimum.
     * Inherited from PortOptions.
     */
    belowMinimum?: Message | ((port: bigint, min: bigint) => Message);

    /**
     * Custom error message when port is above maximum.
     * Inherited from PortOptions.
     */
    aboveMaximum?: Message | ((port: bigint, max: bigint) => Message);

    /**
     * Custom error message when well-known port is not allowed.
     * Inherited from PortOptions.
     */
    wellKnownNotAllowed?: Message | ((port: bigint) => Message);
  };
}

/**
 * Creates a value parser for port ranges (e.g., "8000-8080").
 *
 * Validates port ranges with support for:
 * - Custom separator between start and end ports
 * - Single port mode (when `allowSingle` is enabled)
 * - Port number or bigint types
 * - Min/max constraints
 * - Well-known port restrictions
 *
 * @param options - Options for port range validation.
 * @returns A value parser for port ranges.
 * @since 0.10.0
 *
 * @example
 * ```typescript
 * import { portRange } from "@optique/core/valueparser";
 *
 * // Basic port range parser
 * const range = portRange();
 *
 * // Allow single port
 * const flexible = portRange({ allowSingle: true });
 *
 * // Non-privileged ports only
 * const safe = portRange({ min: 1024 });
 *
 * // Using bigint type
 * const bigRange = portRange({ type: "bigint" });
 * ```
 */
export function portRange(
  options: PortRangeOptionsBigInt,
): ValueParser<"sync", PortRangeValueBigInt>;
export function portRange(
  options?: PortRangeOptionsNumber,
): ValueParser<"sync", PortRangeValueNumber>;
export function portRange(
  options?: PortRangeOptionsNumber | PortRangeOptionsBigInt,
): ValueParser<"sync", PortRangeValueNumber | PortRangeValueBigInt> {
  const metavar: NonEmptyString = options?.metavar ?? "PORT-PORT";
  ensureNonEmptyString(metavar);

  const separator = options?.separator ?? "-";
  const allowSingle = options?.allowSingle ?? false;
  const isBigInt = options?.type === "bigint";

  // Create port parser for validation
  const portParser = isBigInt
    ? port({
      type: "bigint",
      min: (options as PortRangeOptionsBigInt).min,
      max: (options as PortRangeOptionsBigInt).max,
      disallowWellKnown: options.disallowWellKnown,
      errors: options.errors,
    })
    : port({
      type: "number",
      min: (options as PortRangeOptionsNumber | undefined)?.min,
      max: (options as PortRangeOptionsNumber | undefined)?.max,
      disallowWellKnown: options?.disallowWellKnown,
      errors: options?.errors,
    });

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<
      PortRangeValueNumber | PortRangeValueBigInt
    > {
      const trimmed = input.trim();

      // Find separator
      const separatorIndex = trimmed.indexOf(separator);

      if (separatorIndex === -1) {
        // No separator - check if single port is allowed
        if (!allowSingle) {
          const errorMsg = options?.errors?.invalidFormat;
          if (typeof errorMsg === "function") {
            return { success: false, error: errorMsg(input) };
          }
          const msg = errorMsg ?? [
            {
              type: "text",
              text:
                `Expected a port range in format start${separator}end, but got `,
            },
            { type: "value", value: input },
            { type: "text", text: "." },
          ] as Message;
          return { success: false, error: msg };
        }

        // Parse as single port
        const portResult = portParser.parse(trimmed);
        if (!portResult.success) {
          return portResult;
        }

        const portValue = portResult.value;
        return {
          success: true,
          value: isBigInt
            ? { start: portValue as bigint, end: portValue as bigint }
            : { start: portValue as number, end: portValue as number },
        };
      }

      // Parse range
      const startPart = trimmed.substring(0, separatorIndex);
      const endPart = trimmed.substring(separatorIndex + separator.length);

      // Validate start port
      const startResult = portParser.parse(startPart);
      if (!startResult.success) {
        return startResult;
      }

      // Validate end port
      const endResult = portParser.parse(endPart);
      if (!endResult.success) {
        return endResult;
      }

      const startValue = startResult.value;
      const endValue = endResult.value;

      // Check that start <= end
      if (isBigInt) {
        const start = startValue as bigint;
        const end = endValue as bigint;
        if (start > end) {
          const errorMsg = (options as PortRangeOptionsBigInt).errors
            ?.invalidRange;
          const msg = typeof errorMsg === "function"
            ? errorMsg(start, end)
            : errorMsg ??
              message`Start port ${startPart} must be less than or equal to end port ${endPart}.`;
          return { success: false, error: msg };
        }
        return {
          success: true,
          value: { start, end },
        };
      } else {
        const start = startValue as number;
        const end = endValue as number;
        if (start > end) {
          const errorMsg = (options as PortRangeOptionsNumber | undefined)
            ?.errors?.invalidRange;
          const msg = typeof errorMsg === "function"
            ? errorMsg(start, end)
            : errorMsg ??
              message`Start port ${startPart} must be less than or equal to end port ${endPart}.`;
          return { success: false, error: msg };
        }
        return {
          success: true,
          value: { start, end },
        };
      }
    },
    format(value: PortRangeValueNumber | PortRangeValueBigInt): string {
      return `${value.start}${separator}${value.end}`;
    },
  };
}

/**
 * Options for the {@link macAddress} parser.
 *
 * @since 0.10.0
 */
export interface MacAddressOptions {
  /**
   * The metavariable name for this parser.
   * @default "MAC"
   */
  readonly metavar?: NonEmptyString;

  /**
   * Separator format to accept.
   * - `":"`: Colon-separated (e.g., `00:1A:2B:3C:4D:5E`)
   * - `"-"`: Hyphen-separated (e.g., `00-1A-2B-3C-4D-5E`)
   * - `"."`: Dot-separated (e.g., `001A.2B3C.4D5E` - Cisco format)
   * - `"none"`: No separator (e.g., `001A2B3C4D5E`)
   * - `"any"`: Accept any of the above formats
   * @default "any"
   */
  readonly separator?: ":" | "-" | "." | "none" | "any";

  /**
   * Case for the output.
   * - `"preserve"`: Keep input case
   * - `"upper"`: Convert to uppercase
   * - `"lower"`: Convert to lowercase
   * @default "preserve"
   */
  readonly case?: "preserve" | "upper" | "lower";

  /**
   * Output separator format.
   * If not specified, uses the input separator (or ":" for "any").
   * @default undefined (uses input format)
   */
  readonly outputSeparator?: ":" | "-" | "." | "none";

  /**
   * Custom error messages for MAC address parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid MAC address.
     * Can be a static message or a function that receives the input.
     */
    invalidMacAddress?: Message | ((input: string) => Message);
  };
}

/**
 * Creates a value parser for MAC (Media Access Control) addresses.
 *
 * Validates MAC-48 addresses (6 octets, 12 hex digits) in various formats:
 * - Colon-separated: `00:1A:2B:3C:4D:5E`
 * - Hyphen-separated: `00-1A-2B-3C-4D-5E`
 * - Dot-separated (Cisco): `001A.2B3C.4D5E`
 * - No separator: `001A2B3C4D5E`
 *
 * Returns the MAC address as a formatted string according to `case` and
 * `outputSeparator` options.
 *
 * @param options Configuration options for the MAC address parser.
 * @returns A parser that validates MAC addresses and returns formatted strings.
 * @since 0.10.0
 *
 * @example
 * ```typescript
 * import { macAddress } from "@optique/core/valueparser";
 *
 * // Accept any format
 * const mac = macAddress();
 *
 * // Normalize to uppercase colon-separated
 * const normalizedMac = macAddress({
 *   outputSeparator: ":",
 *   case: "upper"
 * });
 * ```
 */
export function macAddress(
  options?: MacAddressOptions,
): ValueParser<"sync", string> {
  const separator = options?.separator ?? "any";
  const caseOption = options?.case ?? "preserve";
  const outputSeparator = options?.outputSeparator;
  const metavar = options?.metavar ?? "MAC";

  // Regular expressions for different formats
  const colonRegex =
    /^([0-9a-fA-F]{1,2}):([0-9a-fA-F]{1,2}):([0-9a-fA-F]{1,2}):([0-9a-fA-F]{1,2}):([0-9a-fA-F]{1,2}):([0-9a-fA-F]{1,2})$/;
  const hyphenRegex =
    /^([0-9a-fA-F]{1,2})-([0-9a-fA-F]{1,2})-([0-9a-fA-F]{1,2})-([0-9a-fA-F]{1,2})-([0-9a-fA-F]{1,2})-([0-9a-fA-F]{1,2})$/;
  const dotRegex = /^([0-9a-fA-F]{4})\.([0-9a-fA-F]{4})\.([0-9a-fA-F]{4})$/;
  const noneRegex = /^([0-9a-fA-F]{12})$/;

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<string> {
      let octets: string[] = [];
      let inputSeparator: ":" | "-" | "." | "none" | undefined;

      // Try to match based on separator option
      if (separator === ":" || separator === "any") {
        const match = colonRegex.exec(input);
        if (match) {
          octets = match.slice(1, 7);
          inputSeparator = ":";
        }
      }

      if (
        octets.length === 0 &&
        (separator === "-" || separator === "any")
      ) {
        const match = hyphenRegex.exec(input);
        if (match) {
          octets = match.slice(1, 7);
          inputSeparator = "-";
        }
      }

      if (
        octets.length === 0 &&
        (separator === "." || separator === "any")
      ) {
        const match = dotRegex.exec(input);
        if (match) {
          // Cisco format: split 3 groups of 4 hex digits into 6 octets
          const groups = match.slice(1, 4);
          octets = groups.flatMap((group) => [
            group.slice(0, 2),
            group.slice(2, 4),
          ]);
          inputSeparator = ".";
        }
      }

      if (
        octets.length === 0 &&
        (separator === "none" || separator === "any")
      ) {
        const match = noneRegex.exec(input);
        if (match) {
          // Split 12 hex digits into 6 octets
          const hex = match[1];
          octets = [];
          for (let i = 0; i < 12; i += 2) {
            octets.push(hex.slice(i, i + 2));
          }
          inputSeparator = "none";
        }
      }

      // If no match found, return error
      if (octets.length === 0) {
        const errorMsg = options?.errors?.invalidMacAddress;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(input) };
        }
        const msg = errorMsg ?? [
          { type: "text", text: "Expected a valid MAC address, but got " },
          { type: "value", value: input },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Apply case conversion
      let formattedOctets = octets;
      if (caseOption === "upper") {
        formattedOctets = octets.map((octet) => octet.toUpperCase());
      } else if (caseOption === "lower") {
        formattedOctets = octets.map((octet) => octet.toLowerCase());
      }

      // Format output based on outputSeparator (or input separator if not specified)
      const finalSeparator = outputSeparator ?? inputSeparator ?? ":";

      let result: string;
      if (finalSeparator === ":") {
        result = formattedOctets.join(":");
      } else if (finalSeparator === "-") {
        result = formattedOctets.join("-");
      } else if (finalSeparator === ".") {
        // Cisco format: 3 groups of 4 hex digits
        result = [
          formattedOctets[0] + formattedOctets[1],
          formattedOctets[2] + formattedOctets[3],
          formattedOctets[4] + formattedOctets[5],
        ].join(".");
      } else {
        // "none"
        result = formattedOctets.join("");
      }

      return { success: true, value: result };
    },
    format(): string {
      return metavar;
    },
  };
}

/**
 * Options for {@link domain} parser.
 *
 * @since 0.10.0
 */
export interface DomainOptions {
  /**
   * The metavariable name for this parser.
   *
   * @default "DOMAIN"
   */
  readonly metavar?: NonEmptyString;

  /**
   * If `true`, allows subdomains (e.g., "www.example.com").
   * If `false`, only accepts root domains (e.g., "example.com").
   *
   * @default true
   */
  readonly allowSubdomains?: boolean;

  /**
   * List of allowed top-level domains (e.g., ["com", "org", "net"]).
   * If specified, only domains with these TLDs are accepted.
   */
  readonly allowedTLDs?: readonly string[];

  /**
   * Minimum number of domain labels (parts separated by dots).
   *
   * @default 2
   */
  readonly minLabels?: number;

  /**
   * If `true`, converts domain to lowercase.
   *
   * @default false
   */
  readonly lowercase?: boolean;

  /**
   * Custom error messages for domain parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid domain.
     * Can be a static message or a function that receives the input.
     */
    invalidDomain?: Message | ((input: string) => Message);

    /**
     * Custom error message when subdomains are not allowed.
     * Can be a static message or a function that receives the domain.
     */
    subdomainsNotAllowed?: Message | ((domain: string) => Message);

    /**
     * Custom error message when TLD is not allowed.
     * Can be a static message or a function that receives the TLD
     * and allowed TLDs.
     */
    tldNotAllowed?:
      | Message
      | ((tld: string, allowedTLDs: readonly string[]) => Message);

    /**
     * Custom error message when domain has too few labels.
     * Can be a static message or a function that receives the domain
     * and minimum labels.
     */
    tooFewLabels?: Message | ((domain: string, minLabels: number) => Message);
  };
}

/**
 * Creates a value parser for domain names.
 *
 * Validates domain names according to RFC 1035 with configurable options for
 * subdomain filtering, TLD restrictions, minimum label requirements, and case
 * normalization.
 *
 * @param options Parser options for domain validation.
 * @returns A parser that accepts valid domain names as strings.
 *
 * @example
 * ``` typescript
 * import { option } from "@optique/core/primitives";
 * import { domain } from "@optique/core/valueparser";
 *
 * // Accept any valid domain
 * option("--domain", domain())
 *
 * // Root domains only (no subdomains)
 * option("--root", domain({ allowSubdomains: false }))
 *
 * // Restrict to specific TLDs
 * option("--domain", domain({ allowedTLDs: ["com", "org", "net"] }))
 *
 * // Normalize to lowercase
 * option("--domain", domain({ lowercase: true }))
 * ```
 *
 * @since 0.10.0
 */
export function domain(
  options?: DomainOptions & { readonly metavar?: NonEmptyString },
): ValueParser<"sync", string> {
  const metavar = options?.metavar ?? "DOMAIN";
  const allowSubdomains = options?.allowSubdomains ?? true;
  const allowedTLDs = options?.allowedTLDs;
  const minLabels = options?.minLabels ?? 2;
  const lowercase = options?.lowercase ?? false;
  const errors = options?.errors;

  // Domain label regex: 1-63 alphanumeric characters and hyphens,
  // cannot start or end with hyphen
  const labelRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<string> {
      // Basic validation
      if (input.length === 0 || input.startsWith(".") || input.endsWith(".")) {
        const errorMsg = errors?.invalidDomain;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(input) };
        }
        const msg = errorMsg ?? [
          { type: "text", text: "Expected a valid domain name, but got " },
          { type: "value", value: input },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Check for consecutive dots
      if (input.includes("..")) {
        const errorMsg = errors?.invalidDomain;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(input) };
        }
        const msg = errorMsg ?? [
          { type: "text", text: "Expected a valid domain name, but got " },
          { type: "value", value: input },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Split into labels
      const labels = input.split(".");

      // Validate each label
      for (const label of labels) {
        if (!labelRegex.test(label)) {
          const errorMsg = errors?.invalidDomain;
          if (typeof errorMsg === "function") {
            return { success: false, error: errorMsg(input) };
          }
          const msg = errorMsg ?? [
            { type: "text", text: "Expected a valid domain name, but got " },
            { type: "value", value: input },
            { type: "text", text: "." },
          ] as Message;
          return { success: false, error: msg };
        }
      }

      // Check minimum labels
      if (labels.length < minLabels) {
        const errorMsg = errors?.tooFewLabels;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(input, minLabels) };
        }
        const msg = errorMsg ?? [
          { type: "text", text: "Domain " },
          { type: "value", value: input },
          {
            type: "text",
            text: ` must have at least ${minLabels} labels.`,
          },
        ] as Message;
        return { success: false, error: msg };
      }

      // Check subdomain restriction
      if (!allowSubdomains && labels.length > 2) {
        const errorMsg = errors?.subdomainsNotAllowed;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(input) };
        }
        const msg = errorMsg ?? [
          { type: "text", text: "Subdomains are not allowed, but got " },
          { type: "value", value: input },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Check TLD restriction
      if (allowedTLDs !== undefined) {
        const tld = labels[labels.length - 1];
        const tldLower = tld.toLowerCase();
        const allowedTLDsLower = allowedTLDs.map((t) => t.toLowerCase());

        if (!allowedTLDsLower.includes(tldLower)) {
          const errorMsg = errors?.tldNotAllowed;
          if (typeof errorMsg === "function") {
            return { success: false, error: errorMsg(tld, allowedTLDs) };
          }
          const msg = errorMsg ?? [
            { type: "text", text: "Top-level domain " },
            { type: "value", value: tld },
            {
              type: "text",
              text: ` is not allowed. Allowed TLDs: ${allowedTLDs.join(", ")}.`,
            },
          ] as Message;
          return { success: false, error: msg };
        }
      }

      // Apply case conversion if needed
      const result = lowercase ? input.toLowerCase() : input;

      return { success: true, value: result };
    },
    format(): string {
      return metavar;
    },
  };
}
/**
 * Options for configuring the IPv6 address value parser.
 *
 * @since 0.10.0
 */
export interface Ipv6Options {
  /**
   * The metavariable name for this parser.
   *
   * @default `"IPV6"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * If `true`, allows loopback address (::1).
   *
   * @default `true`
   */
  readonly allowLoopback?: boolean;

  /**
   * If `true`, allows link-local addresses (fe80::/10).
   *
   * @default `true`
   */
  readonly allowLinkLocal?: boolean;

  /**
   * If `true`, allows unique local addresses (fc00::/7).
   *
   * @default `true`
   */
  readonly allowUniqueLocal?: boolean;

  /**
   * If `true`, allows multicast addresses (ff00::/8).
   *
   * @default `true`
   */
  readonly allowMulticast?: boolean;

  /**
   * If `true`, allows the zero address (::).
   *
   * @default `true`
   */
  readonly allowZero?: boolean;

  /**
   * Custom error messages for IPv6 parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid IPv6 address.
     * Can be a static message or a function that receives the input.
     */
    invalidIpv6?: Message | ((input: string) => Message);

    /**
     * Custom error message when loopback IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    loopbackNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when link-local IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    linkLocalNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when unique local IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    uniqueLocalNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when multicast IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    multicastNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when zero IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    zeroNotAllowed?: Message | ((ip: string) => Message);
  };
}

/**
 * Creates a value parser for IPv6 addresses.
 *
 * Validates and normalizes IPv6 addresses to canonical form (lowercase,
 * compressed using `::` notation where appropriate).
 *
 * @param options Configuration options for IPv6 validation.
 * @returns A value parser that validates IPv6 addresses.
 *
 * @example
 * ```typescript
 * // Basic IPv6 parser
 * option("--ipv6", ipv6())
 *
 * // Global unicast only (no link-local, no unique local)
 * option("--public-ipv6", ipv6({
 *   allowLinkLocal: false,
 *   allowUniqueLocal: false
 * }))
 * ```
 *
 * @since 0.10.0
 */
export function ipv6(
  options?: Ipv6Options,
): ValueParser<"sync", string> {
  const allowLoopback = options?.allowLoopback ?? true;
  const allowLinkLocal = options?.allowLinkLocal ?? true;
  const allowUniqueLocal = options?.allowUniqueLocal ?? true;
  const allowMulticast = options?.allowMulticast ?? true;
  const allowZero = options?.allowZero ?? true;
  const errors = options?.errors;
  const metavar = options?.metavar ?? "IPV6";

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<string> {
      // Parse and normalize IPv6 address
      const normalized = parseAndNormalizeIpv6(input);
      if (normalized === null) {
        const errorMsg = errors?.invalidIpv6;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(input) };
        }
        const msg = errorMsg ?? [
          { type: "text", text: "Expected a valid IPv6 address, but got " },
          { type: "value", value: input },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Check if it's the zero address
      if (!allowZero && normalized === "::") {
        const errorMsg = errors?.zeroNotAllowed;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(normalized) };
        }
        const msg = errorMsg ?? [
          { type: "value", value: normalized },
          { type: "text", text: " is the zero address." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Check if it's loopback (::1)
      if (!allowLoopback && normalized === "::1") {
        const errorMsg = errors?.loopbackNotAllowed;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(normalized) };
        }
        const msg = errorMsg ?? [
          { type: "value", value: normalized },
          { type: "text", text: " is a loopback address." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Get the raw groups for type checking
      const groups = expandIpv6(normalized);
      if (groups === null) {
        const errorMsg = errors?.invalidIpv6;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(input) };
        }
        const msg = errorMsg ?? [
          { type: "text", text: "Expected a valid IPv6 address, but got " },
          { type: "value", value: input },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      const firstGroup = parseInt(groups[0], 16);

      // Check link-local (fe80::/10)
      if (!allowLinkLocal && (firstGroup & 0xffc0) === 0xfe80) {
        const errorMsg = errors?.linkLocalNotAllowed;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(normalized) };
        }
        const msg = errorMsg ?? [
          { type: "value", value: normalized },
          { type: "text", text: " is a link-local address." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Check unique local (fc00::/7)
      if (!allowUniqueLocal && (firstGroup & 0xfe00) === 0xfc00) {
        const errorMsg = errors?.uniqueLocalNotAllowed;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(normalized) };
        }
        const msg = errorMsg ?? [
          { type: "value", value: normalized },
          { type: "text", text: " is a unique local address." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Check multicast (ff00::/8)
      if (!allowMulticast && (firstGroup & 0xff00) === 0xff00) {
        const errorMsg = errors?.multicastNotAllowed;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(normalized) };
        }
        const msg = errorMsg ?? [
          { type: "value", value: normalized },
          { type: "text", text: " is a multicast address." },
        ] as Message;
        return { success: false, error: msg };
      }

      return { success: true, value: normalized };
    },
    format(): string {
      return metavar;
    },
  };
}

/**
 * Parses and normalizes an IPv6 address to canonical form.
 * Returns null if the input is not a valid IPv6 address.
 */
function parseAndNormalizeIpv6(input: string): string | null {
  if (input.length === 0) return null;

  // Handle IPv4-mapped IPv6 addresses (::ffff:192.0.2.1)
  const ipv4MappedMatch = input.match(/^(.+):(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4MappedMatch) {
    const ipv6Part = ipv4MappedMatch[1];
    const ipv4Part = ipv4MappedMatch[2];

    // Parse the IPv4 part
    const ipv4Octets = ipv4Part.split(".");
    if (ipv4Octets.length !== 4) return null;
    const octets = ipv4Octets.map((o) => parseInt(o, 10));
    if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return null;

    // Convert IPv4 to two IPv6 groups
    const group1 = (octets[0] << 8) | octets[1];
    const group2 = (octets[2] << 8) | octets[3];

    // Reconstruct as full IPv6
    const fullAddress = `${ipv6Part}:${group1.toString(16)}:${
      group2.toString(16)
    }`;
    return parseAndNormalizeIpv6(fullAddress);
  }

  // Count :: occurrences (should be at most 1)
  const compressionCount = (input.match(/::/g) || []).length;
  if (compressionCount > 1) return null;

  let groups: string[];

  if (input.includes("::")) {
    // Handle compression
    const parts = input.split("::");
    if (parts.length > 2) return null;

    const leftGroups = parts[0] ? parts[0].split(":") : [];
    const rightGroups = parts[1] ? parts[1].split(":") : [];

    // Calculate how many zero groups are compressed
    const totalGroups = leftGroups.length + rightGroups.length;
    if (totalGroups > 8) return null;

    const zeroCount = 8 - totalGroups;
    const zeros = Array(zeroCount).fill("0");

    groups = [...leftGroups, ...zeros, ...rightGroups];
  } else {
    // No compression
    groups = input.split(":");
    if (groups.length !== 8) return null;
  }

  // Validate and normalize each group
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (group.length === 0 || group.length > 4) return null;
    if (!/^[0-9a-fA-F]+$/.test(group)) return null;

    // Normalize to remove leading zeros
    groups[i] = parseInt(group, 16).toString(16);
  }

  // Convert back to compressed form
  return compressIpv6(groups);
}

/**
 * Expands a compressed IPv6 address to 8 groups of 4 hex digits.
 * Returns null if the input is invalid.
 */
function expandIpv6(input: string): string[] | null {
  if (input.includes("::")) {
    const parts = input.split("::");
    if (parts.length > 2) return null;

    const leftGroups = parts[0] ? parts[0].split(":").filter((g) => g) : [];
    const rightGroups = parts[1] ? parts[1].split(":").filter((g) => g) : [];

    const totalGroups = leftGroups.length + rightGroups.length;
    if (totalGroups > 8) return null;

    const zeroCount = 8 - totalGroups;
    const zeros = Array(zeroCount).fill("0");

    const groups = [...leftGroups, ...zeros, ...rightGroups];

    // Pad each group to 4 digits
    return groups.map((g) => g.padStart(4, "0"));
  } else {
    const groups = input.split(":");
    if (groups.length !== 8) return null;
    return groups.map((g) => g.padStart(4, "0"));
  }
}

/**
 * Compresses an IPv6 address by replacing the longest sequence of zeros with ::.
 */
function compressIpv6(groups: string[]): string {
  // Find the longest sequence of zeros
  let longestStart = -1;
  let longestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === "0") {
      if (currentStart === -1) {
        currentStart = i;
        currentLength = 1;
      } else {
        currentLength++;
      }
    } else {
      if (currentLength > longestLength) {
        longestStart = currentStart;
        longestLength = currentLength;
      }
      currentStart = -1;
      currentLength = 0;
    }
  }

  // Check the last sequence
  if (currentLength > longestLength) {
    longestStart = currentStart;
    longestLength = currentLength;
  }

  // Don't compress if sequence is less than 2
  if (longestLength < 2) {
    return groups.join(":");
  }

  // Build compressed form
  const before = groups.slice(0, longestStart);
  const after = groups.slice(longestStart + longestLength);

  if (before.length === 0 && after.length === 0) {
    return "::";
  } else if (before.length === 0) {
    return "::" + after.join(":");
  } else if (after.length === 0) {
    return before.join(":") + "::";
  } else {
    return before.join(":") + "::" + after.join(":");
  }
}

/**
 * Options for configuring the universal IP address value parser.
 *
 * @since 0.10.0
 */
export interface IpOptions {
  /**
   * The metavariable name for this parser.
   *
   * @default `"IP"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * IP version to accept.
   * - `4`: IPv4 only
   * - `6`: IPv6 only
   * - `"both"`: Accept both IPv4 and IPv6
   *
   * @default `"both"`
   */
  readonly version?: 4 | 6 | "both";

  /**
   * Options for IPv4 validation (when version is 4 or "both").
   */
  readonly ipv4?: Omit<Ipv4Options, "metavar" | "errors">;

  /**
   * Options for IPv6 validation (when version is 6 or "both").
   */
  readonly ipv6?: Omit<Ipv6Options, "metavar" | "errors">;

  /**
   * Custom error messages for IP parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid IP address.
     * Can be a static message or a function that receives the input.
     */
    invalidIP?: Message | ((input: string) => Message);

    /**
     * Custom error message when private IP is used but disallowed (IPv4).
     * Can be a static message or a function that receives the IP.
     */
    privateNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when loopback IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    loopbackNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when link-local IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    linkLocalNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when multicast IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    multicastNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when broadcast IP is used but disallowed (IPv4).
     * Can be a static message or a function that receives the IP.
     */
    broadcastNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when zero IP is used but disallowed.
     * Can be a static message or a function that receives the IP.
     */
    zeroNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when unique local IP is used but disallowed (IPv6).
     * Can be a static message or a function that receives the IP.
     */
    uniqueLocalNotAllowed?: Message | ((ip: string) => Message);
  };
}

/**
 * Creates a value parser that accepts both IPv4 and IPv6 addresses.
 *
 * By default, accepts both IPv4 and IPv6 addresses. Use the `version` option
 * to restrict to a specific IP version.
 *
 * @param options Configuration options for IP validation.
 * @returns A value parser that validates IP addresses.
 *
 * @example
 * ```typescript
 * // Accept both IPv4 and IPv6
 * option("--ip", ip())
 *
 * // IPv4 only
 * option("--ipv4", ip({ version: 4 }))
 *
 * // Public IPs only (both versions)
 * option("--public-ip", ip({
 *   ipv4: { allowPrivate: false, allowLoopback: false },
 *   ipv6: { allowLinkLocal: false, allowUniqueLocal: false }
 * }))
 * ```
 *
 * @since 0.10.0
 */
export function ip(
  options?: IpOptions,
): ValueParser<"sync", string> {
  const version = options?.version ?? "both";
  const metavar = options?.metavar ?? "IP";
  const errors = options?.errors;

  // Create IPv4 parser if needed
  const ipv4Parser = (version === 4 || version === "both")
    ? ipv4({
      ...options?.ipv4,
      errors: {
        invalidIpv4: errors?.invalidIP,
        privateNotAllowed: errors?.privateNotAllowed,
        loopbackNotAllowed: errors?.loopbackNotAllowed,
        linkLocalNotAllowed: errors?.linkLocalNotAllowed,
        multicastNotAllowed: errors?.multicastNotAllowed,
        broadcastNotAllowed: errors?.broadcastNotAllowed,
        zeroNotAllowed: errors?.zeroNotAllowed,
      },
    })
    : null;

  // Create IPv6 parser if needed
  const ipv6Parser = (version === 6 || version === "both")
    ? ipv6({
      ...options?.ipv6,
      errors: {
        invalidIpv6: errors?.invalidIP,
        loopbackNotAllowed: errors?.loopbackNotAllowed,
        linkLocalNotAllowed: errors?.linkLocalNotAllowed,
        uniqueLocalNotAllowed: errors?.uniqueLocalNotAllowed,
        multicastNotAllowed: errors?.multicastNotAllowed,
        zeroNotAllowed: errors?.zeroNotAllowed,
      },
    })
    : null;

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<string> {
      let ipv4Error: ValueParserResult<string> | null = null;
      let ipv6Error: ValueParserResult<string> | null = null;

      // Try IPv4 first if allowed
      if (ipv4Parser !== null) {
        const result = ipv4Parser.parse(input);
        if (result.success) {
          return result;
        }
        ipv4Error = result;
        // If only IPv4 is allowed, return the error
        if (version === 4) {
          return result;
        }
      }

      // Try IPv6 if allowed
      if (ipv6Parser !== null) {
        const result = ipv6Parser.parse(input);
        if (result.success) {
          return result;
        }
        ipv6Error = result;
        // If only IPv6 is allowed, return the error
        if (version === 6) {
          return result;
        }
      }

      // Both failed - return the first non-generic error
      // Prefer errors from parsers that actually tried to parse
      // (e.g., "private not allowed" over "invalid IPv4")
      if (ipv4Error !== null && !ipv4Error.success) {
        // Check if it's a generic "invalid" error by looking for "Expected" text
        const isGeneric = ipv4Error.error.some((term) =>
          term.type === "text" && term.text.includes("Expected")
        );
        if (!isGeneric) {
          return ipv4Error;
        }
      }

      if (ipv6Error !== null && !ipv6Error.success) {
        const isGeneric = ipv6Error.error.some((term) =>
          term.type === "text" && term.text.includes("Expected")
        );
        if (!isGeneric) {
          return ipv6Error;
        }
      }

      // Return generic error if both returned generic errors or custom error is set
      const errorMsg = errors?.invalidIP;
      if (typeof errorMsg === "function") {
        return { success: false, error: errorMsg(input) };
      }
      const msg = errorMsg ?? [
        { type: "text", text: "Expected a valid IP address, but got " },
        { type: "value", value: input },
        { type: "text", text: "." },
      ] as Message;
      return { success: false, error: msg };
    },
    format(): string {
      return metavar;
    },
  };
}

/**
 * Value representing a CIDR notation (IP address with prefix length).
 *
 * @since 0.10.0
 */
export interface CidrValue {
  /**
   * The IP address portion (normalized).
   */
  readonly address: string;

  /**
   * The prefix length (0-32 for IPv4, 0-128 for IPv6).
   */
  readonly prefix: number;

  /**
   * IP version (4 or 6).
   */
  readonly version: 4 | 6;
}

/**
 * Options for configuring the CIDR notation value parser.
 *
 * @since 0.10.0
 */
export interface CidrOptions {
  /**
   * The metavariable name for this parser.
   *
   * @default `"CIDR"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * IP version to accept.
   * - `4`: IPv4 CIDR only
   * - `6`: IPv6 CIDR only
   * - `"both"`: Accept both IPv4 and IPv6 CIDR
   *
   * @default `"both"`
   */
  readonly version?: 4 | 6 | "both";

  /**
   * Minimum allowed prefix length.
   * For IPv4: 0-32, for IPv6: 0-128.
   */
  readonly minPrefix?: number;

  /**
   * Maximum allowed prefix length.
   * For IPv4: 0-32, for IPv6: 0-128.
   */
  readonly maxPrefix?: number;

  /**
   * Options for IPv4 validation (when version is 4 or "both").
   */
  readonly ipv4?: Omit<Ipv4Options, "metavar" | "errors">;

  /**
   * Options for IPv6 validation (when version is 6 or "both").
   */
  readonly ipv6?: Omit<Ipv6Options, "metavar" | "errors">;

  /**
   * Custom error messages for CIDR parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid CIDR notation.
     * Can be a static message or a function that receives the input.
     */
    invalidCidr?: Message | ((input: string) => Message);

    /**
     * Custom error message when prefix length is invalid.
     * Can be a static message or a function that receives the prefix and version.
     */
    invalidPrefix?: Message | ((prefix: number, version: 4 | 6) => Message);

    /**
     * Custom error message when prefix is below minimum.
     * Can be a static message or a function that receives the prefix and minimum.
     */
    prefixBelowMinimum?: Message | ((prefix: number, min: number) => Message);

    /**
     * Custom error message when prefix is above maximum.
     * Can be a static message or a function that receives the prefix and maximum.
     */
    prefixAboveMaximum?: Message | ((prefix: number, max: number) => Message);
  };
}

/**
 * Creates a value parser for CIDR notation (IP address with prefix length).
 *
 * Parses and validates CIDR notation like `192.168.0.0/24` or `2001:db8::/32`.
 * Returns a structured object with the normalized IP address, prefix length,
 * and IP version.
 *
 * @param options Configuration options for CIDR validation.
 * @returns A value parser that validates CIDR notation.
 *
 * @example
 * ```typescript
 * // Accept both IPv4 and IPv6 CIDR
 * option("--network", cidr())
 *
 * // IPv4 CIDR only with prefix constraints
 * option("--subnet", cidr({
 *   version: 4,
 *   minPrefix: 16,
 *   maxPrefix: 24
 * }))
 * ```
 *
 * @since 0.10.0
 */
export function cidr(
  options?: CidrOptions,
): ValueParser<"sync", CidrValue> {
  const version = options?.version ?? "both";
  const minPrefix = options?.minPrefix;
  const maxPrefix = options?.maxPrefix;
  const errors = options?.errors;
  const metavar = options?.metavar ?? "CIDR";

  // Create IP parsers for address validation
  const ipv4Parser = (version === 4 || version === "both")
    ? ipv4(options?.ipv4)
    : null;

  const ipv6Parser = (version === 6 || version === "both")
    ? ipv6(options?.ipv6)
    : null;

  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<CidrValue> {
      // Parse CIDR format: <ip>/<prefix>
      const slashIndex = input.lastIndexOf("/");
      if (slashIndex === -1) {
        const errorMsg = errors?.invalidCidr;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(input) };
        }
        const msg = errorMsg ?? [
          { type: "text", text: "Expected a valid CIDR notation, but got " },
          { type: "value", value: input },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      const ipPart = input.slice(0, slashIndex);
      const prefixPart = input.slice(slashIndex + 1);

      // Parse prefix length
      const prefix = parseInt(prefixPart, 10);
      if (
        !Number.isInteger(prefix) || prefixPart !== prefix.toString() ||
        prefix < 0
      ) {
        const errorMsg = errors?.invalidCidr;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(input) };
        }
        const msg = errorMsg ?? [
          { type: "text", text: "Expected a valid CIDR notation, but got " },
          { type: "value", value: input },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Try to parse as IPv4 first
      let ipVersion: 4 | 6 | null = null;
      let normalizedIp: string | null = null;

      if (ipv4Parser !== null) {
        const result = ipv4Parser.parse(ipPart);
        if (result.success) {
          ipVersion = 4;
          normalizedIp = result.value;

          // Validate IPv4 prefix range
          if (prefix > 32) {
            const errorMsg = errors?.invalidPrefix;
            if (typeof errorMsg === "function") {
              return { success: false, error: errorMsg(prefix, 4) };
            }
            const msg = errorMsg ?? [
              {
                type: "text",
                text: "Expected a prefix length between 0 and ",
              },
              { type: "text", text: "32" },
              { type: "text", text: " for IPv4, but got " },
              { type: "text", text: prefix.toString() },
              { type: "text", text: "." },
            ] as Message;
            return { success: false, error: msg };
          }
        }
      }

      // Try IPv6 if IPv4 failed
      if (ipVersion === null && ipv6Parser !== null) {
        const result = ipv6Parser.parse(ipPart);
        if (result.success) {
          ipVersion = 6;
          normalizedIp = result.value;

          // Validate IPv6 prefix range
          if (prefix > 128) {
            const errorMsg = errors?.invalidPrefix;
            if (typeof errorMsg === "function") {
              return { success: false, error: errorMsg(prefix, 6) };
            }
            const msg = errorMsg ?? [
              {
                type: "text",
                text: "Expected a prefix length between 0 and ",
              },
              { type: "text", text: "128" },
              { type: "text", text: " for IPv6, but got " },
              { type: "text", text: prefix.toString() },
              { type: "text", text: "." },
            ] as Message;
            return { success: false, error: msg };
          }
        }
      }

      // Neither IPv4 nor IPv6 worked
      if (ipVersion === null || normalizedIp === null) {
        const errorMsg = errors?.invalidCidr;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(input) };
        }
        const msg = errorMsg ?? [
          { type: "text", text: "Expected a valid CIDR notation, but got " },
          { type: "value", value: input },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Check minPrefix constraint
      if (minPrefix !== undefined && prefix < minPrefix) {
        const errorMsg = errors?.prefixBelowMinimum;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(prefix, minPrefix) };
        }
        const msg = errorMsg ?? [
          {
            type: "text",
            text: "Expected a prefix length greater than or equal to ",
          },
          { type: "text", text: minPrefix.toString() },
          { type: "text", text: ", but got " },
          { type: "text", text: prefix.toString() },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      // Check maxPrefix constraint
      if (maxPrefix !== undefined && prefix > maxPrefix) {
        const errorMsg = errors?.prefixAboveMaximum;
        if (typeof errorMsg === "function") {
          return { success: false, error: errorMsg(prefix, maxPrefix) };
        }
        const msg = errorMsg ?? [
          {
            type: "text",
            text: "Expected a prefix length less than or equal to ",
          },
          { type: "text", text: maxPrefix.toString() },
          { type: "text", text: ", but got " },
          { type: "text", text: prefix.toString() },
          { type: "text", text: "." },
        ] as Message;
        return { success: false, error: msg };
      }

      return {
        success: true,
        value: {
          address: normalizedIp,
          prefix,
          version: ipVersion,
        },
      };
    },
    format(): string {
      return metavar;
    },
  };
}
