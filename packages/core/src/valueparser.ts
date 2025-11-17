import { type Message, message, text } from "./message.ts";
import type { Suggestion } from "./parser.ts";

/**
 * Interface for parsing CLI option values and arguments.
 *
 * A `ValueParser` is responsible for converting string input (typically from
 * CLI arguments or option values) into strongly-typed values of type {@link T}.
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
   * Parses a string input into a value of type {@link T}.
   *
   * @param input The string input to parse
   *              (e.g., the `value` part of `--option=value`).
   * @returns A result object indicating success or failure with an error
   *          message.
   */
  parse(input: string): ValueParserResult<T>;

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
   * @since 0.6.0
   */
  suggest?(prefix: string): Iterable<Suggestion>;
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
  readonly metavar?: string;

  /**
   * Optional regular expression pattern that the string must match.
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
 * Options for creating a {@link choice} parser.
 */
export interface ChoiceOptions {
  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `TYPE` or `MODE`.
   * @default `"TYPE"`
   */
  readonly metavar?: string;

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
 * A predicate function that checks if an object is a {@link ValueParser}.
 * @param object The object to check.
 * @return `true` if the object is a {@link ValueParser}, `false` otherwise.
 */
export function isValueParser<T>(object: unknown): object is ValueParser<T> {
  return typeof object === "object" && object != null &&
    "metavar" in object &&
    typeof (object as ValueParser<T>).metavar === "string" &&
    "parse" in object &&
    typeof (object as ValueParser<T>).parse === "function" &&
    "format" in object &&
    typeof (object as ValueParser<T>).format === "function";
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
  options: ChoiceOptions = {},
): ValueParser<T> {
  const normalizedValues = options.caseInsensitive
    ? choices.map((v) => v.toLowerCase())
    : choices as readonly string[];
  return {
    metavar: options.metavar ?? "TYPE",
    parse(input: string): ValueParserResult<T> {
      const normalizedInput = options.caseInsensitive
        ? input.toLowerCase()
        : input;
      const index = normalizedValues.indexOf(normalizedInput);
      if (index < 0) {
        // Format choices as "a", "b", "c" instead of "a, b, c"
        let choicesList: Message = [];
        for (let i = 0; i < choices.length; i++) {
          if (i > 0) {
            choicesList = [...choicesList, ...message`, `];
          }
          choicesList = [...choicesList, ...message`${choices[i]}`];
        }
        return {
          success: false,
          error: options.errors?.invalidChoice
            ? (typeof options.errors.invalidChoice === "function"
              ? options.errors.invalidChoice(input, choices)
              : options.errors.invalidChoice)
            : message`Expected one of ${choicesList}, but got ${input}.`,
        };
      }
      return { success: true, value: choices[index] };
    },
    format(value: T): string {
      return value;
    },
    suggest(prefix: string) {
      const normalizedPrefix = options.caseInsensitive
        ? prefix.toLowerCase()
        : prefix;

      return choices
        .filter((value) => {
          const normalizedValue = options.caseInsensitive
            ? value.toLowerCase()
            : value;
          return normalizedValue.startsWith(normalizedPrefix);
        })
        .map((value) => ({ kind: "literal", text: value }));
    },
  };
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
export function string(options: StringOptions = {}): ValueParser<string> {
  return {
    metavar: options.metavar ?? "STRING",
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
  return {
    metavar: options?.metavar ?? "INTEGER",
    parse(input: string): ValueParserResult<number> {
      if (!input.match(/^\d+$/)) {
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
  readonly metavar?: string;

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
  readonly metavar?: string;

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
export function locale(options: LocaleOptions = {}): ValueParser<Intl.Locale> {
  return {
    metavar: options.metavar ?? "LOCALE",
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
  readonly metavar?: string;

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
export function uuid(options: UuidOptions = {}): ValueParser<Uuid> {
  // UUID regex pattern: 8-4-4-4-12 hex digits with dashes
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return {
    metavar: options.metavar ?? "UUID",
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
