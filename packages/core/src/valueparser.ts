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
