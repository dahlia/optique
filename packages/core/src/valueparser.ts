import { type ErrorMessage, message } from "./error.ts";

/**
 * Interface for parsing CLI option values and arguments.
 *
 * A `ValueParser` is responsible for converting string input (typically from
 * CLI arguments or option values) into strongly-typed values of type `T`.
 *
 * @template T The type of value this parser produces.
 */
export interface ValueParser<T> {
  /**
   * The metavariable name for this parser.  Used in help messages
   * to indicate what kind of value this parser expects.  Usually
   * a single word in uppercase, like `PORT` or `FILE`.
   */
  readonly metavar: string;

  /**
   * Parses a string input into a value of type T.
   *
   * @param input The string input to parse
   *              (e.g., the `value` part of `--option=value`).
   * @returns A result object indicating success or failure with an error
   *          message.
   */
  parse(input: string): ValueParserResult<T>;
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
    readonly error: ErrorMessage;
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
  readonly metavar?: string;

  /**
   * Optional regular expression pattern that the string must match.
   */
  readonly pattern?: RegExp;
}

/**
 * Creates a {@link ValueParser} for strings.
 *
 * This parser validates that the input is a string and optionally checks
 * if it matches a specified regular expression pattern.
 * @param options Configuration options for the string parser.
 * @returns A {@link ValueParser} that parses strings according to the
 *          specified options.
 */
export function string(options: StringOptions = {}) {
  return {
    metavar: options.metavar ?? "STRING",
    parse(input: string): ValueParserResult<string> {
      if (options.pattern != null && !options.pattern.test(input)) {
        return {
          success: false,
          error:
            message`Expected a string matching pattern ${options.pattern}, but got ${input}.`,
        };
      }
      return { success: true, value: input };
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
  readonly metavar?: string;

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
  readonly metavar?: string;

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
}

/**
 * Creates a ValueParser for integers that returns JavaScript numbers.
 *
 * @param options Configuration options for the integer parser.
 * @returns A {@link ValueParser} that parses strings into numbers.
 */
export function integer(options?: IntegerOptionsNumber): ValueParser<number>;

/**
 * Creates a ValueParser for integers that returns `bigint` values.
 *
 * @param options Configuration options for the `bigint` parser.
 * @returns A {@link ValueParser} that parses strings into `bigint` values.
 */
export function integer(options: IntegerOptionsBigInt): ValueParser<bigint>;

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
 * const portParser = integer({ min: 1, max: 65535 });
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
): ValueParser<number> | ValueParser<bigint> {
  if (options?.type === "bigint") {
    return {
      metavar: options.metavar ?? "INTEGER",
      parse(input: string): ValueParserResult<bigint> {
        let value: bigint;
        try {
          value = BigInt(input);
        } catch (e) {
          if (e instanceof SyntaxError) {
            return {
              success: false,
              error: message`Expected a valid integer, but got ${input}.`,
            };
          }
          throw e;
        }
        if (options.min != null && value < options.min) {
          return {
            success: false,
            error:
              message`Expected a value greater than or equal to ${options.min}, but got ${value}.`,
          };
        } else if (options.max != null && value > options.max) {
          return {
            success: false,
            error:
              message`Expected a value less than or equal to ${options.max}, but got ${value}.`,
          };
        }
        return { success: true, value };
      },
    };
  }
  return {
    metavar: options?.metavar ?? "INTEGER",
    parse(input: string): ValueParserResult<number> {
      if (!input.match(/^\d+$/)) {
        return {
          success: false,
          error: message`Expected a valid integer, but got ${input}.`,
        };
      }
      const value = Number.parseInt(input);
      if (options?.min != null && value < options.min) {
        return {
          success: false,
          error:
            message`Expected a value greater than or equal to ${options.min}, but got ${value}.`,
        };
      } else if (options?.max != null && value > options.max) {
        return {
          success: false,
          error:
            message`Expected a value less than or equal to ${options.max}, but got ${value}.`,
        };
      }
      return { success: true, value };
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
  readonly metavar?: string;

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
export function float(options: FloatOptions = {}): ValueParser<number> {
  // Regular expression to match valid floating-point numbers
  // Matches: integers, decimals, scientific notation
  // Does not match: empty strings, whitespace-only, hex/bin/oct numbers
  const floatRegex = /^[+-]?(?:(?:\d+\.?\d*)|(?:\d*\.\d+))(?:[eE][+-]?\d+)?$/;

  return {
    metavar: options.metavar ?? "NUMBER",
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
            error: message`Expected a valid number, but got ${input}.`,
          };
        }
      } else {
        return {
          success: false,
          error: message`Expected a valid number, but got ${input}.`,
        };
      }

      if (options.min != null && value < options.min) {
        return {
          success: false,
          error:
            message`Expected a value greater than or equal to ${options.min}, but got ${value}.`,
        };
      } else if (options.max != null && value > options.max) {
        return {
          success: false,
          error:
            message`Expected a value less than or equal to ${options.max}, but got ${value}.`,
        };
      }
      return { success: true, value };
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
  readonly metavar?: string;

  /**
   * List of allowed URL protocols (e.g., `["http:", "https:"]`).
   * If specified, the parsed URL must use one of these protocols.
   * Protocol names should include the trailing colon (e.g., `"https:"`).
   * If not specified, any protocol is allowed.
   */
  readonly allowedProtocols?: readonly string[];
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
export function url(options: UrlOptions = {}): ValueParser<URL> {
  const allowedProtocols = options.allowedProtocols?.map((p) =>
    p.toLowerCase()
  );
  return {
    metavar: options.metavar ?? "URL",
    parse(input: string): ValueParserResult<URL> {
      if (!URL.canParse(input)) {
        return {
          success: false,
          error: message`Invalid URL: ${input}.`,
        };
      }
      const url = new URL(input);
      if (
        allowedProtocols != null && !allowedProtocols.includes(url.protocol)
      ) {
        return {
          success: false,
          error:
            message`URL protocol ${url.protocol} is not allowed. Allowed protocols: ${
              allowedProtocols.join(", ")
            }.`,
        };
      }
      return { success: true, value: url };
    },
  };
}
