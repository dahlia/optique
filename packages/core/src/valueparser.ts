import {
  cloneMessage,
  lineBreak,
  type Message,
  message,
  type MessageTerm,
  metavar as metavarTerm,
  text,
  valueSet,
} from "./message.ts";
import { isDerivedValueParser } from "./internal/dependency.ts";
import { ensureNonEmptyString, type NonEmptyString } from "./nonempty.ts";
import type { Mode, ModeIterable, ModeValue, Suggestion } from "./parser.ts";
import { deduplicateSuggestions } from "./suggestion.ts";

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
  readonly mode: M;

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
   * Normalizes a value of type {@link T} according to this parser's
   * configuration.  This applies the same canonicalization that
   * {@link parse} would apply (e.g., case conversion, separator
   * normalization).  Built-in implementations delegate to {@link parse}
   * internally, so values that would fail validation are returned
   * unchanged rather than being canonicalized.
   *
   * When present, combinators like `withDefault()` call this method on
   * default values so that runtime defaults match the representation
   * that {@link parse} would produce.
   *
   * Parsers that do not apply any normalization during parsing do not
   * need to implement this method.
   *
   * **Limitation:** For dependency-derived value parsers (created via
   * `deriveFrom()` or `dependency().derive()`), this method uses the
   * default dependency value to build the inner parser, not the
   * dependency value resolved during the current parse.  This is the
   * same trade-off that {@link format} makes.  As a result, defaults
   * may not be normalized according to a non-default dependency value.
   *
   * @param value The value to normalize.
   * @returns The normalized value.
   * @since 1.0.0
   */
  normalize?(value: T): T;

  /**
   * Validates a value of type {@link T} as if it had been parsed from CLI
   * input, returning either a success result (with the possibly
   * canonicalized value) or a failure with an error message.
   *
   * When present, `option()` and `argument()` use this method to validate
   * fallback values (e.g. from `bindEnv()`/`bindConfig()`) instead of the
   * generic `format()`+`parse()` round-trip.  Implement it when the
   * round-trip cannot faithfully express validation for some values, as
   * with combinators like `firstOf()` whose constituents may produce
   * overlapping string representations.
   *
   * Like {@link normalize}, this method is synchronous regardless of the
   * parser's mode, so wrappers that spread a sync parser into an async
   * one inherit it unchanged.
   *
   * @param value The value to validate.
   * @returns A {@link ValueParserResult} indicating success or failure.
   * @since 1.1.0
   */
  validate?(value: T): ValueParserResult<T>;

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

  /**
   * An optional array of valid choices for this parser.  When present,
   * indicates that this parser accepts only a fixed set of values, which
   * can be displayed in help output via the `showChoices` formatting option.
   *
   * This field is populated automatically by the {@link choice} function.
   *
   * @since 0.10.0
   */
  readonly choices?: readonly T[];

  /**
   * A type-appropriate default value used as a stand-in during deferred
   * prompt resolution.  When an interactive prompt is deferred during
   * two-phase parsing, this value is used instead of an internal sentinel
   * so that `map()` transforms and two-pass contexts always receive a valid
   * value of type {@link T}.
   *
   * The placeholder does not need to be meaningful; it only needs to be
   * a valid inhabitant of the result type that will not crash downstream
   * transforms.  For example, `string()` uses `""`, `integer()` uses `0`,
   * and `choice(["a", "b", "c"])` uses `"a"`.
   *
   * @since 1.0.0
   */
  readonly placeholder: T;
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

    /**
     * When `true`, indicates that the value is a placeholder stand-in for
     * a deferred interactive prompt, not a real user-provided value.
     * Combinators propagate this flag so that the two-phase parsing
     * facade can strip deferred values before passing them to phase-two
     * contexts.
     *
     * @since 1.0.0
     */
    readonly deferred?: true;

    /**
     * A recursive map describing which property keys in {@link value} hold
     * deferred placeholder values.  Set by `object()`, `tuple()`, `merge()`,
     * and other combinators.  Intentionally not propagated by `map()` because
     * opaque transforms invalidate the inner key set.  Used by the two-phase
     * facade to selectively replace only deferred fields with `undefined`
     * while preserving non-deferred fields for phase-two context annotation
     * collection.
     *
     * Each entry maps a property key to either `null` (the entire field is
     * deferred) or another `DeferredMap` (the field is an object whose own
     * sub-fields are partially deferred).
     *
     * @since 1.0.0
     */
    readonly deferredKeys?: DeferredMap;
  }
  | {
    /** Indicates that the parsing operation failed. */
    readonly success: false;

    /** The error message describing why the parsing failed. */
    readonly error: Message;
  };

/**
 * A recursive map that tracks which fields in a parsed object hold deferred
 * placeholder values.  Each entry maps a property key to either `null`
 * (the field is fully deferred and should be replaced with `undefined`)
 * or another `DeferredMap` (the field is partially deferred—recurse into
 * its sub-fields).
 *
 * @since 1.0.0
 */
export type DeferredMap = ReadonlyMap<PropertyKey, DeferredMap | null>;

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
   * A custom placeholder value used during deferred prompt resolution.
   * Override the default `""` when a `pattern` constraint or downstream
   * `map()` transform requires a non-empty or specially shaped string.
   *
   * @since 1.0.0
   */
  readonly placeholder?: string;

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
 * @throws {TypeError} If the object looks like a value parser (has `mode`,
 *   `metavar`, `parse`, and `format`) but is missing the required
 *   `placeholder` property.
 */
export function isValueParser<M extends Mode, T>(
  object: unknown,
): object is ValueParser<M, T> {
  if (
    typeof object !== "object" || object == null ||
    !("mode" in object) ||
    ((object as ValueParser<M, T>).mode !== "sync" &&
      (object as ValueParser<M, T>).mode !== "async")
  ) {
    return false;
  }
  const hasMetavar = "metavar" in object &&
    typeof (object as ValueParser<M, T>).metavar === "string";
  const hasParse = "parse" in object &&
    typeof (object as ValueParser<M, T>).parse === "function";
  const hasFormat = "format" in object &&
    typeof (object as ValueParser<M, T>).format === "function";
  const hasPlaceholder = "placeholder" in object;
  if (hasMetavar && hasParse && hasFormat && !hasPlaceholder) {
    throw new TypeError(
      "Value parser is missing the required placeholder property. " +
        "All value parsers must define a placeholder value.",
    );
  }
  return hasMetavar && hasParse && hasFormat && hasPlaceholder;
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
 * @throws {TypeError} If the choices array is empty.
 * @throws {TypeError} If any choice is an empty string.
 * @throws {TypeError} If any choice is not a string.
 * @throws {TypeError} If choices contain a mix of strings and numbers.
 * @throws {TypeError} If `caseInsensitive` is not a boolean.
 * @throws {TypeError} If `caseInsensitive` is `true` and multiple choices
 *         normalize to the same lowercase value.
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
 * @throws {TypeError} If the choices array is empty.
 * @throws {TypeError} If any choice is not a number.
 * @throws {TypeError} If any choice is `NaN`.
 * @throws {TypeError} If choices contain a mix of strings and numbers.
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
  if (choices.length < 1) {
    throw new TypeError(
      "Expected at least one choice, but got an empty array.",
    );
  }
  if (choices.some((c) => c === "")) {
    throw new TypeError(
      "Empty strings are not allowed as choices.",
    );
  }
  for (const c of choices) {
    if (typeof c !== "string" && typeof c !== "number") {
      throw new TypeError(
        `Expected every choice to be a string or number, but got ${typeof c}.`,
      );
    }
  }
  const isNumber = typeof choices[0] === "number";
  for (const c of choices) {
    if (isNumber ? typeof c !== "number" : typeof c !== "string") {
      throw new TypeError(
        `Expected every choice to be the same type, but got both ${
          isNumber ? "number" : "string"
        } and ${typeof c}.`,
      );
    }
  }
  if (isNumber && (choices as readonly number[]).some((v) => Number.isNaN(v))) {
    throw new TypeError(
      "NaN is not allowed in number choices.",
    );
  }
  const metavar = options.metavar ?? "TYPE";
  ensureNonEmptyString(metavar);

  if (isNumber) {
    // Number choice implementation—deduplicate in a single pass,
    // using Object.is to distinguish 0 and -0
    const numberChoices: readonly number[] = (() => {
      const seen = new Set<number>();
      let hasPositiveZero = false;
      let hasNegativeZero = false;
      const result: number[] = [];
      for (const v of choices as readonly number[]) {
        if (Object.is(v, -0)) {
          if (hasNegativeZero) continue;
          hasNegativeZero = true;
        } else if (Object.is(v, 0)) {
          if (hasPositiveZero) continue;
          hasPositiveZero = true;
        } else {
          if (seen.has(v)) continue;
          seen.add(v);
        }
        result.push(v);
      }
      return result;
    })();
    const numberInvalidChoice = (options as ChoiceOptionsNumber).errors
      ?.invalidChoice;
    const numberStrings = numberChoices.map((v) =>
      Object.is(v, -0) ? "-0" : String(v)
    );
    const frozenNumberChoices = Object.freeze(numberChoices) as readonly T[];
    return {
      mode: "sync",
      metavar,
      placeholder: choices[0],
      choices: frozenNumberChoices,
      parse(input: string): ValueParserResult<T> {
        // Exact match against canonical string representations
        // (String(value) for most values, "-0" for negative zero).
        const index = numberStrings.indexOf(input);
        if (index >= 0) {
          return { success: true, value: numberChoices[index] as T };
        }
        // Fall back to strict decimal parsing for alternate spellings
        // (e.g., "1000000000000000000000" for 1e21, or "8.0" for 8).
        // Rejects hex, binary, octal, scientific notation, empty, and
        // whitespace inputs.
        if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(input)) {
          const parsed = Number(input);
          if (Number.isFinite(parsed)) {
            // Verify exact decimal equivalence: the input must normalize
            // to the same string as the canonical form, not merely round
            // to the same IEEE-754 double.
            const canonical = Object.is(parsed, -0) ? "-0" : String(parsed);
            const normalizedInput = normalizeDecimal(input);
            const normalizedCanonical = normalizeDecimal(
              expandScientific(canonical),
            );
            if (normalizedInput === normalizedCanonical) {
              const fallbackIndex = numberChoices.findIndex((v) =>
                Object.is(v, parsed)
              );
              if (fallbackIndex >= 0) {
                return {
                  success: true,
                  value: numberChoices[fallbackIndex] as T,
                };
              }
            }
            // When parsed is -0 but only 0 is in the list (or vice
            // versa), the normalization above won't match because
            // "-0" normalizes differently from "0". Treat -0 and 0
            // as interchangeable when the list does not distinguish
            // them (i.e., does not contain both 0 and -0).
            if (
              parsed === 0 &&
              normalizedInput.replace(/^-/, "") === "0" &&
              !numberChoices.some((v) => Object.is(v, -0))
            ) {
              // Use indexOf (===) which treats -0 and 0 as equal
              const zeroIndex = numberChoices.indexOf(0);
              if (zeroIndex >= 0) {
                return {
                  success: true,
                  value: numberChoices[zeroIndex] as T,
                };
              }
            }
          }
        }
        // Fall back to scientific notation parsing for alternate exponent
        // spellings (e.g., "1e21" for canonical "1e+21", "1.0e-7" for
        // "1e-7"). Only accepted when the canonical form also uses
        // scientific notation, so "2e0" for choice([2]) stays rejected.
        if (/^[+-]?(\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(input)) {
          const parsed = Number(input);
          if (Number.isFinite(parsed)) {
            const canonical = Object.is(parsed, -0) ? "-0" : String(parsed);
            if (/[eE]/.test(canonical)) {
              const normalizedInput = normalizeDecimal(
                expandScientific(input),
              );
              const normalizedCanonical = normalizeDecimal(
                expandScientific(canonical),
              );
              if (normalizedInput === normalizedCanonical) {
                const fallbackIndex = numberChoices.findIndex((v) =>
                  Object.is(v, parsed)
                );
                if (fallbackIndex >= 0) {
                  return {
                    success: true,
                    value: numberChoices[fallbackIndex] as T,
                  };
                }
              }
            }
          }
        }
        return {
          success: false,
          error: formatNumberChoiceError(
            input,
            numberChoices,
            numberChoices,
            numberInvalidChoice,
          ),
        };
      },
      format(value: T): string {
        return Object.is(value, -0) ? "-0" : String(value);
      },
      suggest(prefix: string) {
        return numberStrings
          .filter((valueStr, i) =>
            !Number.isNaN(numberChoices[i]) && valueStr.startsWith(prefix)
          )
          .map((valueStr) => ({ kind: "literal" as const, text: valueStr }));
      },
    };
  }

  // String choice implementation—deduplicate identical values
  const stringChoices: readonly string[] = Object.freeze([
    ...new Set(choices as readonly string[]),
  ]);
  const stringOptions = options as ChoiceOptionsString;
  checkBooleanOption(stringOptions, "caseInsensitive");
  const caseInsensitive = stringOptions.caseInsensitive ?? false;
  const normalizedValues = caseInsensitive
    ? stringChoices.map((v) => v.toLowerCase())
    : stringChoices;
  if (caseInsensitive) {
    const seen = new Map<string, string>();
    for (let i = 0; i < stringChoices.length; i++) {
      const nv = normalizedValues[i];
      const original = stringChoices[i];
      const prev = seen.get(nv);
      if (prev !== undefined && prev !== original) {
        throw new TypeError(
          `Ambiguous choices for case-insensitive matching: ` +
            `${JSON.stringify(prev)} and ${JSON.stringify(original)} ` +
            `both normalize to ${JSON.stringify(nv)}.`,
        );
      }
      seen.set(nv, original);
    }
  }
  const stringInvalidChoice = stringOptions.errors?.invalidChoice;
  return {
    mode: "sync",
    metavar,
    placeholder: choices[0],
    choices: stringChoices as readonly T[],
    parse(input: string): ValueParserResult<T> {
      const normalizedInput = caseInsensitive ? input.toLowerCase() : input;
      const index = normalizedValues.indexOf(normalizedInput);
      if (index < 0) {
        return {
          success: false,
          error: formatStringChoiceError(
            input,
            stringChoices,
            stringInvalidChoice,
          ),
        };
      }
      return { success: true, value: stringChoices[index] as T };
    },
    format(value: T): string {
      return String(value);
    },
    suggest(prefix: string) {
      const normalizedPrefix = caseInsensitive ? prefix.toLowerCase() : prefix;

      return stringChoices
        .filter((value) => {
          const normalizedValue = caseInsensitive ? value.toLowerCase() : value;
          return normalizedValue.startsWith(normalizedPrefix);
        })
        .map((value) => ({ kind: "literal" as const, text: value }));
    },
  };
}

/**
 * Validates that an option value, if present, is a boolean.
 * Throws a {@link TypeError} if the value is defined but not a boolean.
 *
 * @template T The type of the options object.
 * @param options The options object to check.
 * @param key The key of the option to validate.
 * @throws {TypeError} If the option value is defined but not a boolean.
 * @since 1.0.0
 */
export function checkBooleanOption<T extends object>(
  options: T | undefined,
  key: keyof T,
): void {
  const value = options?.[key];
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(
      `Expected ${String(key)} to be a boolean, but got ` +
        `${typeof value}: ${String(value)}.`,
    );
  }
}

/**
 * Validates that an option value, if present, is one of the allowed values.
 * Throws a {@link TypeError} if the value is defined but not in the allowed
 * list.
 *
 * @template T The type of the options object.
 * @param options The options object to check.
 * @param key The key of the option to validate.
 * @param allowed The list of allowed values.
 * @throws {TypeError} If the option value is defined but not in the allowed
 *   list.
 * @since 1.0.0
 */
export function checkEnumOption<T extends object>(
  options: T | undefined,
  key: keyof T,
  allowed: readonly string[],
): void {
  const value = options?.[key];
  if (
    value !== undefined &&
    (typeof value !== "string" || !allowed.includes(value))
  ) {
    const rendered = typeof value === "string"
      ? JSON.stringify(value)
      : typeof value === "symbol"
      ? value.toString()
      : String(value);
    throw new TypeError(
      `Expected ${String(key)} to be one of ${
        allowed.map((v) => JSON.stringify(v)).join(", ")
      }, but got ${typeof value}: ${rendered}.`,
    );
  }
}

/**
 * Expands a numeric string in scientific notation (e.g., `"1e+21"`,
 * `"1.5e-3"`, `".1e-6"`) into plain decimal form for normalization.
 * Used for both canonical `String(number)` output and user input.
 * Returns the input unchanged if it does not contain scientific notation.
 */
function expandScientific(s: string): string {
  const match = /^([+-]?)(\d+\.?\d*|\.\d+)[eE]([+-]?\d+)$/.exec(s);
  if (!match) return s;
  const [, rawSign, mantissa, expStr] = match;
  const sign = rawSign === "-" ? "-" : "";
  const exp = parseInt(expStr, 10);
  const dotPos = mantissa.indexOf(".");
  const digits = mantissa.replace(".", "");
  const intLen = dotPos >= 0 ? dotPos : digits.length;
  const newIntLen = intLen + exp;
  let result: string;
  if (newIntLen >= digits.length) {
    result = digits + "0".repeat(newIntLen - digits.length);
  } else if (newIntLen <= 0) {
    result = "0." + "0".repeat(-newIntLen) + digits;
  } else {
    result = digits.slice(0, newIntLen) + "." + digits.slice(newIntLen);
  }
  return sign + result;
}

/**
 * Normalizes a plain decimal string by stripping leading zeros from the
 * integer part and trailing zeros from the fractional part, so that two
 * strings representing the same mathematical value compare as equal.
 */
function normalizeDecimal(s: string): string {
  let sign = "";
  let str = s;
  if (str.startsWith("-") || str.startsWith("+")) {
    if (str[0] === "-") sign = "-";
    str = str.slice(1);
  }
  const dot = str.indexOf(".");
  let int: string;
  let frac: string;
  if (dot >= 0) {
    int = str.slice(0, dot);
    frac = str.slice(dot + 1);
  } else {
    int = str;
    frac = "";
  }
  int = int.replace(/^0+/, "") || "0";
  frac = frac.replace(/0+$/, "");
  return sign + (frac ? int + "." + frac : int);
}

/**
 * Formats error message for string choice parser.
 */
function formatStringChoiceError(
  input: string,
  choices: readonly string[],
  invalidChoice:
    | Message
    | ((input: string, choices: readonly string[]) => Message)
    | undefined,
): Message {
  if (invalidChoice) {
    return typeof invalidChoice === "function"
      ? invalidChoice(input, choices)
      : invalidChoice;
  }
  return formatDefaultChoiceError(input, choices);
}

/**
 * Formats error message for number choice parser.
 */
function formatNumberChoiceError(
  input: string,
  validChoices: readonly number[],
  allChoices: readonly number[],
  invalidChoice:
    | Message
    | ((input: string, choices: readonly number[]) => Message)
    | undefined,
): Message {
  if (invalidChoice) {
    return typeof invalidChoice === "function"
      ? invalidChoice(input, validChoices)
      : invalidChoice;
  }
  return formatDefaultChoiceError(input, allChoices);
}

/**
 * Formats default error message for choice parser.
 */
function formatDefaultChoiceError(
  input: string,
  choices: readonly (string | number)[],
): Message {
  const choiceStrings = choices
    .filter((c) => typeof c === "string" || !Number.isNaN(c))
    .map((c) => Object.is(c, -0) ? "-0" : String(c));
  if (choiceStrings.length === 0 && choices.length > 0) {
    return message`No valid choices are configured, but got ${input}.`;
  }
  return message`Expected one of ${
    valueSet(choiceStrings, { fallback: "", locale: "en-US" })
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
 * @throws {TypeError} If `options.pattern` is provided but is not a
 *         `RegExp` instance.
 */
export function string(
  options: StringOptions = {},
): ValueParser<"sync", string> {
  if (options.pattern != null && !(options.pattern instanceof RegExp)) {
    throw new TypeError(
      "Expected pattern to be a RegExp, but got: " +
        `${Object.prototype.toString.call(options.pattern)}`,
    );
  }
  const metavar = options.metavar ?? "STRING";
  ensureNonEmptyString(metavar);
  // Snapshot pattern source/flags at construction time to prevent
  // post-construction mutation, and avoid constructing an intermediate
  // RegExp that would just be cloned again at parse time.
  const patternSource = options.pattern?.source ?? null;
  const patternFlags = options.pattern?.flags ?? null;
  const patternMismatch = options.errors?.patternMismatch;
  return {
    mode: "sync",
    metavar,
    placeholder: options.placeholder ?? "",
    parse(input: string): ValueParserResult<string> {
      if (patternSource != null && patternFlags != null) {
        const pattern = new RegExp(patternSource, patternFlags);
        if (pattern.test(input)) {
          return { success: true, value: input };
        }

        return {
          success: false,
          error: patternMismatch
            ? (typeof patternMismatch === "function"
              ? patternMismatch(input, pattern)
              : patternMismatch)
            : message`Expected a string matching pattern ${
              text(patternSource)
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
   * A custom placeholder value used during deferred prompt resolution.
   * Override the default `0` when `min`/`max` constraints or downstream
   * `map()` transforms require a specific value.
   *
   * @since 1.0.0
   */
  readonly placeholder?: number;

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
     * Custom error message when integer is outside the safe integer range
     * (`Number.MIN_SAFE_INTEGER` to `Number.MAX_SAFE_INTEGER`).
     * Can be a static message or a function that receives the input string.
     * @since 1.0.0
     */
    unsafeInteger?: Message | ((input: string) => Message);

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
   * A custom placeholder value used during deferred prompt resolution.
   * Override the default `0n` when `min`/`max` constraints or downstream
   * `map()` transforms require a specific value.
   *
   * @since 1.0.0
   */
  readonly placeholder?: bigint;

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
 * @throws {TypeError} If `options.type` is provided but is neither `"number"`
 *   nor `"bigint"`.
 * @throws {RangeError} If the configured min/max range for number mode contains
 *   no safe integers.
 */
export function integer(
  options?: IntegerOptionsNumber | IntegerOptionsBigInt,
): ValueParser<"sync", number> | ValueParser<"sync", bigint> {
  if (
    options?.type !== undefined &&
    options.type !== "number" &&
    options.type !== "bigint"
  ) {
    throw new TypeError(
      `Expected type to be "number" or "bigint", but got: ${
        String(options.type)
      }.`,
    );
  }
  if (options?.type !== "bigint") {
    if (options?.min != null && !Number.isFinite(options.min)) {
      throw new RangeError(
        `Expected min to be a finite number, but got: ${options.min}`,
      );
    }
    if (options?.max != null && !Number.isFinite(options.max)) {
      throw new RangeError(
        `Expected max to be a finite number, but got: ${options.max}`,
      );
    }
  }
  if (
    options?.min != null && options?.max != null && options.min > options.max
  ) {
    throw new RangeError(
      `Expected min to be less than or equal to max, but got ` +
        `min: ${options.min} and max: ${options.max}.`,
    );
  }
  if (options?.type === "bigint") {
    const metavar = options.metavar ?? "INTEGER";
    ensureNonEmptyString(metavar);
    return {
      mode: "sync",
      metavar,
      placeholder: options?.placeholder ??
        (options?.min != null && options.min > 0n
          ? options.min
          : options?.max != null && options.max < 0n
          ? options.max
          : 0n),
      parse(input: string): ValueParserResult<bigint> {
        if (!input.match(/^-?\d+$/)) {
          return {
            success: false,
            error: options.errors?.invalidInteger
              ? (typeof options.errors.invalidInteger === "function"
                ? options.errors.invalidInteger(input)
                : options.errors.invalidInteger)
              : message`Expected a valid integer, but got ${input}.`,
          };
        }
        const value = BigInt(input);
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
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  const safeMin = Math.max(
    options?.min ?? Number.MIN_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
  );
  const safeMax = Math.min(
    options?.max ?? Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  // Snap to the integer intersection so the placeholder and range check
  // reflect actually parseable integer values.
  const firstAllowed = Math.ceil(safeMin);
  const lastAllowed = Math.floor(safeMax);
  if (firstAllowed > lastAllowed) {
    throw new RangeError(
      "The configured integer range contains no safe integers. " +
        'Use type: "bigint" instead.',
    );
  }
  const unsafeIntegerError = options?.errors?.unsafeInteger;
  function makeUnsafeIntegerError(
    input: string,
  ): ValueParserResult<number> {
    return {
      success: false,
      error: unsafeIntegerError
        ? (typeof unsafeIntegerError === "function"
          ? unsafeIntegerError(input)
          : unsafeIntegerError)
        : message`Expected a safe integer between ${
          text(Number.MIN_SAFE_INTEGER.toLocaleString("en"))
        } and ${
          text(Number.MAX_SAFE_INTEGER.toLocaleString("en"))
        }, but got ${input}. Use type: "bigint" for large values.`,
    };
  }
  return {
    mode: "sync",
    metavar,
    placeholder: options?.placeholder ??
      (firstAllowed > 0 ? firstAllowed : lastAllowed < 0 ? lastAllowed : 0),
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
      let n: bigint;
      try {
        n = BigInt(input);
      } catch {
        return makeUnsafeIntegerError(input);
      }
      if (n > maxSafe || n < minSafe) {
        return makeUnsafeIntegerError(input);
      }
      const value = Number(input);
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
   * A custom placeholder value used during deferred prompt resolution.
   * Override the default `0` when `min`/`max` constraints or downstream
   * `map()` transforms require a specific value.
   *
   * @since 1.0.0
   */
  readonly placeholder?: number;

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
  if (options.min != null && !Number.isFinite(options.min)) {
    throw new RangeError(
      `Expected min to be a finite number, but got: ${options.min}`,
    );
  }
  if (options.max != null && !Number.isFinite(options.max)) {
    throw new RangeError(
      `Expected max to be a finite number, but got: ${options.max}`,
    );
  }
  if (
    options.min != null && options.max != null && options.min > options.max
  ) {
    throw new RangeError(
      `Expected min to be less than or equal to max, but got ` +
        `min: ${options.min} and max: ${options.max}.`,
    );
  }
  // Regular expression to match valid floating-point numbers
  // Matches: integers, decimals, scientific notation
  // Does not match: empty strings, whitespace-only, hex/bin/oct numbers
  const floatRegex = /^[+-]?(?:(?:\d+\.?\d*)|(?:\d*\.\d+))(?:[eE][+-]?\d+)?$/;
  const metavar = options.metavar ?? "NUMBER";
  ensureNonEmptyString(metavar);

  return {
    mode: "sync",
    metavar,
    placeholder: options?.placeholder ??
      (options?.min != null && options.min > 0
        ? options.min
        : options?.max != null && options.max < 0
        ? options.max
        : 0),
    parse(input: string): ValueParserResult<number> {
      const invalidNumber = (i: string): ValueParserResult<number> => ({
        success: false,
        error: options.errors?.invalidNumber
          ? (typeof options.errors.invalidNumber === "function"
            ? options.errors.invalidNumber(i)
            : options.errors.invalidNumber)
          : message`Expected a valid number, but got ${i}.`,
      });

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
        if (!Number.isFinite(value) && !options.allowInfinity) {
          return invalidNumber(input);
        }
        // This should not happen with our regex, but let's be safe
        if (Number.isNaN(value)) {
          return invalidNumber(input);
        }
      } else {
        return invalidNumber(input);
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
 * A canonical file size unit string.  SI units use powers of 1 000 by
 * default; IEC units always use powers of 1 024.
 * @since 1.1.0
 */
export type FileSizeUnit =
  | "B"
  | "KB"
  | "MB"
  | "GB"
  | "TB"
  | "PB"
  | "EB"
  | "KiB"
  | "MiB"
  | "GiB"
  | "TiB"
  | "PiB"
  | "EiB";

/**
 * Options for creating a {@link fileSize} parser that returns `number`.
 * @since 1.1.0
 */
export interface FileSizeOptionsNumber {
  /**
   * The return type.  Defaults to `"number"`.
   * @default `"number"`
   */
  readonly type?: "number";

  /**
   * The metavariable name for this parser.  Used in help messages to
   * indicate what kind of value this parser expects.
   * @default `"SIZE"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * If `true`, negative byte values are accepted.  Most size-related CLI
   * options do not accept negative values, so this defaults to `false`.
   * @default `false`
   */
  readonly allowNegative?: boolean;

  /**
   * The unit to assume when the input contains only a number with no unit
   * suffix (e.g., `"100"` with `defaultUnit: "MB"` → 100 000 000 bytes).
   * When this option is absent, a bare number without a unit is rejected.
   */
  readonly defaultUnit?: FileSizeUnit;

  /**
   * When `true`, SI suffixes (`KB`, `MB`, `GB`, …) are interpreted as
   * binary powers of 1 024 rather than decimal powers of 1 000.  This
   * matches a widespread but technically incorrect convention where
   * "1 KB" means 1 024 bytes.  IEC suffixes (`KiB`, `MiB`, …) are
   * unaffected by this option.
   *
   * @default `false`
   * @since 1.1.0
   */
  readonly siAsBinary?: boolean;

  /**
   * A custom placeholder value used during deferred prompt resolution.
   * @default `0`
   * @since 1.1.0
   */
  readonly placeholder?: number;

  /**
   * Custom error messages for file size parsing failures.
   * @since 1.1.0
   */
  readonly errors?: {
    /**
     * Custom error message when the input is not a valid file size string.
     * Can be a static message or a function that receives the raw input.
     */
    readonly invalidFormat?: Message | ((input: string) => Message);

    /**
     * Custom error message when a negative value is provided but
     * {@link FileSizeOptionsNumber.allowNegative} is `false`.
     * Can be a static message or a function that receives the byte value.
     */
    readonly negativeNotAllowed?: Message | ((value: number) => Message);
  };
}

/**
 * Options for creating a {@link fileSize} parser that returns `bigint`.
 * Use this when byte counts may exceed `Number.MAX_SAFE_INTEGER` (roughly
 * 9 PB), for example when working with EB/EiB-range values.
 * @since 1.1.0
 */
export interface FileSizeOptionsBigInt {
  /**
   * Must be set to `"bigint"` to select bigint output.
   */
  readonly type: "bigint";

  /**
   * The metavariable name for this parser.  Used in help messages to
   * indicate what kind of value this parser expects.
   * @default `"SIZE"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * If `true`, negative byte values are accepted.
   * @default `false`
   */
  readonly allowNegative?: boolean;

  /**
   * The unit to assume when the input contains only a number with no unit
   * suffix.  When absent, a bare number is rejected.
   */
  readonly defaultUnit?: FileSizeUnit;

  /**
   * When `true`, SI suffixes (`KB`, `MB`, `GB`, …) are interpreted as
   * binary powers of 1 024 rather than decimal powers of 1 000.
   * @default `false`
   * @since 1.1.0
   */
  readonly siAsBinary?: boolean;

  /**
   * A custom placeholder value used during deferred prompt resolution.
   * @default `0n`
   * @since 1.1.0
   */
  readonly placeholder?: bigint;

  /**
   * Custom error messages for file size parsing failures.
   * @since 1.1.0
   */
  readonly errors?: {
    /**
     * Custom error message when the input is not a valid file size string.
     * Can be a static message or a function that receives the raw input.
     */
    readonly invalidFormat?: Message | ((input: string) => Message);

    /**
     * Custom error message when a negative value is provided but
     * {@link FileSizeOptionsBigInt.allowNegative} is `false`.
     * Can be a static message or a function that receives the byte value.
     */
    readonly negativeNotAllowed?: Message | ((value: bigint) => Message);
  };
}

/**
 * Options for creating a {@link fileSize} parser.
 * @since 1.1.0
 */
export type FileSizeOptions = FileSizeOptionsNumber | FileSizeOptionsBigInt;

// Multipliers for SI units (powers of 1 000)
const SI_MULTIPLIERS: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  tb: 1_000_000_000_000,
  pb: 1_000_000_000_000_000,
  eb: 1_000_000_000_000_000_000,
};

// Multipliers for IEC units (powers of 1 024)—also overrides SI when
// siAsBinary is true, making e.g. "kb" → 1 024.
const IEC_MULTIPLIERS: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1_024,
  mb: 1_024 ** 2,
  gb: 1_024 ** 3,
  tb: 1_024 ** 4,
  pb: 1_024 ** 5,
  eb: 1_024 ** 6,
  kib: 1_024,
  mib: 1_024 ** 2,
  gib: 1_024 ** 3,
  tib: 1_024 ** 4,
  pib: 1_024 ** 5,
  eib: 1_024 ** 6,
};

// IEC-only keys for normal mode (unit strings that always use powers of 1 024)
const IEC_ONLY_MULTIPLIERS: Readonly<Record<string, number>> = {
  kib: 1_024,
  mib: 1_024 ** 2,
  gib: 1_024 ** 3,
  tib: 1_024 ** 4,
  pib: 1_024 ** 5,
  eib: 1_024 ** 6,
};

const FILE_SIZE_REGEX = /^([+-]?(?:\d+\.?\d*|\d*\.\d+))\s*([a-zA-Z]*)$/;

/**
 * Formats `bytes` using the most readable unit from the given ordered list.
 * Falls back to `"${bytes}B"`.
 *
 * A unit is chosen only when the formatted value round-trips exactly: the
 * rounded quotient must lie in [1, 1000) and `rounded * size === bytes` must
 * hold in float64 arithmetic.  This guarantees `parse(format(x)) === x`.
 */
function formatWithUnits(
  bytes: number,
  units: readonly [string, number][],
): string {
  if (bytes === 0) return "0B";
  const absBytes = Math.abs(bytes);
  for (const [unit, size] of units) {
    if (absBytes < size) continue;
    const v = bytes / size;
    const rounded = Math.round(v * 100) / 100;
    const absRounded = Math.abs(rounded);
    if (absRounded >= 1 && absRounded < 1000 && rounded * size === bytes) {
      return `${rounded}${unit}`;
    }
  }
  return `${bytes}B`;
}

// Format order for default mode: IEC first (prefer binary for exact powers of
// 1 024), then SI.
const FORMAT_UNITS_DEFAULT: readonly [string, number][] = [
  ["EiB", 1_024 ** 6],
  ["PiB", 1_024 ** 5],
  ["TiB", 1_024 ** 4],
  ["GiB", 1_024 ** 3],
  ["MiB", 1_024 ** 2],
  ["KiB", 1_024],
  ["EB", 1_000_000_000_000_000_000],
  ["PB", 1_000_000_000_000_000],
  ["TB", 1_000_000_000_000],
  ["GB", 1_000_000_000],
  ["MB", 1_000_000],
  ["KB", 1_000],
];

// Format order for siAsBinary mode: SI suffixes come first (they are the
// user's preferred convention), using binary multipliers.
const FORMAT_UNITS_SI_AS_BINARY: readonly [string, number][] = [
  ["EB", 1_024 ** 6],
  ["PB", 1_024 ** 5],
  ["TB", 1_024 ** 4],
  ["GB", 1_024 ** 3],
  ["MB", 1_024 ** 2],
  ["KB", 1_024],
];

// Bigint multiplier maps—mirrors of the number maps above
const BIGINT_SI_MULTIPLIERS: Readonly<Record<string, bigint>> = {
  b: 1n,
  kb: 1_000n,
  mb: 1_000_000n,
  gb: 1_000_000_000n,
  tb: 1_000_000_000_000n,
  pb: 1_000_000_000_000_000n,
  eb: 1_000_000_000_000_000_000n,
};

const BIGINT_IEC_MULTIPLIERS: Readonly<Record<string, bigint>> = {
  b: 1n,
  kb: 1_024n,
  mb: 1_024n ** 2n,
  gb: 1_024n ** 3n,
  tb: 1_024n ** 4n,
  pb: 1_024n ** 5n,
  eb: 1_024n ** 6n,
  kib: 1_024n,
  mib: 1_024n ** 2n,
  gib: 1_024n ** 3n,
  tib: 1_024n ** 4n,
  pib: 1_024n ** 5n,
  eib: 1_024n ** 6n,
};

const BIGINT_IEC_ONLY_MULTIPLIERS: Readonly<Record<string, bigint>> = {
  kib: 1_024n,
  mib: 1_024n ** 2n,
  gib: 1_024n ** 3n,
  tib: 1_024n ** 4n,
  pib: 1_024n ** 5n,
  eib: 1_024n ** 6n,
};

// Bigint format unit lists
const BIGINT_FORMAT_UNITS_DEFAULT: readonly [string, bigint][] = [
  ["EiB", 1_024n ** 6n],
  ["PiB", 1_024n ** 5n],
  ["TiB", 1_024n ** 4n],
  ["GiB", 1_024n ** 3n],
  ["MiB", 1_024n ** 2n],
  ["KiB", 1_024n],
  ["EB", 1_000_000_000_000_000_000n],
  ["PB", 1_000_000_000_000_000n],
  ["TB", 1_000_000_000_000n],
  ["GB", 1_000_000_000n],
  ["MB", 1_000_000n],
  ["KB", 1_000n],
];

const BIGINT_FORMAT_UNITS_SI_AS_BINARY: readonly [string, bigint][] = [
  ["EB", 1_024n ** 6n],
  ["PB", 1_024n ** 5n],
  ["TB", 1_024n ** 4n],
  ["GB", 1_024n ** 3n],
  ["MB", 1_024n ** 2n],
  ["KB", 1_024n],
];

/**
 * Formats a bigint byte count using the most readable unit.  Falls back to
 * `"${value}B"`.  Tries exact integers, then 1 and 2 decimal places.
 */
function formatBigIntBytes(
  value: bigint,
  units: readonly [string, bigint][],
): string {
  if (value === 0n) return "0B";
  const absValue = value < 0n ? -value : value;
  for (const [unit, size] of units) {
    if (absValue < size) continue;
    // Exact integer
    if (value % size === 0n) {
      const v = value / size;
      const absV = v < 0n ? -v : v;
      if (absV >= 1n && absV < 1000n) return `${v}${unit}`;
    }
    // Up to 2 decimal places
    const v100 = value * 100n;
    if (v100 % size === 0n) {
      const q = v100 / size;
      const absQ = q < 0n ? -q : q;
      if (absQ >= 100n && absQ < 100_000n) {
        const intPart = q / 100n;
        const decPart = absQ % 100n;
        if (decPart % 10n === 0n) {
          return `${intPart}.${decPart / 10n}${unit}`;
        }
        return `${intPart}.${String(decPart).padStart(2, "0")}${unit}`;
      }
    }
  }
  return `${value}B`;
}

/**
 * Core computation: parses `numStr` as a decimal rational, multiplies by
 * `mBig`, and returns the exact integer result as a `bigint`, or `null` when
 * the result would be fractional.  The safe-integer range check is NOT applied
 * here; callers add it as needed.
 */
function parseExactBytesRaw(
  numStr: string,
  mBig: bigint,
): bigint | null {
  const negative = numStr.startsWith("-");
  const absStr = numStr.startsWith("+") || numStr.startsWith("-")
    ? numStr.slice(1)
    : numStr;
  const dotIdx = absStr.indexOf(".");
  const intPart = dotIdx < 0 ? absStr : absStr.slice(0, dotIdx);
  const fracPart = dotIdx < 0 ? "" : absStr.slice(dotIdx + 1);
  const numeratorStr = ((intPart || "0") + fracPart).replace(/^0+/, "") || "0";
  const numerator = BigInt(numeratorStr) * (negative ? -1n : 1n);
  const denominator = 10n ** BigInt(fracPart.length);
  const bytesNumerator = numerator * mBig;
  if (bytesNumerator % denominator !== 0n) return null;
  return bytesNumerator / denominator;
}

/**
 * Parses `numStr` as a decimal rational and multiplies by `multiplier`,
 * returning the exact integer result as a safe `number`, or `null` when the
 * result would be fractional or outside `Number.MAX_SAFE_INTEGER`.
 *
 * All arithmetic is performed with `bigint` to avoid float64 precision loss
 * (e.g. `"1.0000000000000001"` must not silently round to `1`).
 */
function parseExactBytes(
  numStr: string,
  multiplier: number,
): number | null {
  const bytes = parseExactBytesRaw(numStr, BigInt(multiplier));
  if (bytes == null) return null;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (bytes < -maxSafe || bytes > maxSafe) return null;
  return Number(bytes);
}

const FILE_SIZE_UNITS: readonly FileSizeUnit[] = [
  "B",
  "KB",
  "MB",
  "GB",
  "TB",
  "PB",
  "EB",
  "KiB",
  "MiB",
  "GiB",
  "TiB",
  "PiB",
  "EiB",
];

/**
 * Creates a {@link ValueParser} for human-readable file/data size strings
 * that returns a `number` byte count.
 *
 * @param options Configuration options for the file size parser.
 * @returns A {@link ValueParser} that parses file size strings into `number`
 *          byte counts.
 * @throws {TypeError} If {@link FileSizeOptionsNumber.metavar} is an empty
 *   string, if {@link FileSizeOptionsNumber.allowNegative} or
 *   {@link FileSizeOptionsNumber.siAsBinary} is not a boolean, or if
 *   {@link FileSizeOptionsNumber.defaultUnit} is not a valid
 *   {@link FileSizeUnit}.
 * @since 1.1.0
 */
export function fileSize(
  options?: FileSizeOptionsNumber,
): ValueParser<"sync", number>;

/**
 * Creates a {@link ValueParser} for human-readable file/data size strings
 * that returns a `bigint` byte count.  Use this when byte counts may exceed
 * `Number.MAX_SAFE_INTEGER` (~9 PB), for example with EB/EiB-range values.
 *
 * @param options Configuration options for the file size parser.
 * @returns A {@link ValueParser} that parses file size strings into `bigint`
 *          byte counts.
 * @throws {TypeError} If {@link FileSizeOptionsBigInt.metavar} is an empty
 *   string, if {@link FileSizeOptionsBigInt.allowNegative} or
 *   {@link FileSizeOptionsBigInt.siAsBinary} is not a boolean, or if
 *   {@link FileSizeOptionsBigInt.defaultUnit} is not a valid
 *   {@link FileSizeUnit}.
 * @since 1.1.0
 */
export function fileSize(
  options: FileSizeOptionsBigInt,
): ValueParser<"sync", bigint>;

/**
 * Creates a {@link ValueParser} for human-readable file/data size strings such
 * as `"10MB"`, `"1.5GiB"`, or `"512B"`.  The parsed value is a `number` or
 * `bigint` representing the equivalent byte count.
 *
 * Supported units:
 *
 * | Unit | Bytes (default) |
 * |------|----------------|
 * | B    | 1              |
 * | KB   | 1 000          |
 * | MB   | 1 000 000      |
 * | GB   | 1 000 000 000  |
 * | KiB  | 1 024          |
 * | MiB  | 1 048 576      |
 * | GiB  | 1 073 741 824  |
 * | …    | …              |
 *
 * Unit suffixes are matched case-insensitively, so `"1kb"`, `"1KB"`, and
 * `"1Kb"` are all equivalent.
 *
 * @param options Configuration options for the file size parser.
 * @returns A {@link ValueParser} that parses file size strings into byte
 *          counts.
 * @throws {TypeError} If `type` is neither `"number"` nor `"bigint"`, if
 *   `metavar` is an empty string, if `allowNegative` or `siAsBinary` is not
 *   a boolean, or if `defaultUnit` is not a valid {@link FileSizeUnit}.
 * @since 1.1.0
 */
export function fileSize(
  options: FileSizeOptionsNumber | FileSizeOptionsBigInt = {},
): ValueParser<"sync", number> | ValueParser<"sync", bigint> {
  if (
    options.type !== undefined &&
    options.type !== "number" &&
    options.type !== "bigint"
  ) {
    throw new TypeError(
      `Expected type to be "number" or "bigint", but got: ${
        String(options.type)
      }.`,
    );
  }
  const metavar = options.metavar ?? "SIZE";
  ensureNonEmptyString(metavar);
  checkBooleanOption(options, "allowNegative");
  checkBooleanOption(options, "siAsBinary");
  checkEnumOption(options, "defaultUnit", FILE_SIZE_UNITS);
  const siAsBinary = options.siAsBinary ?? false;

  function invalidFormatError(input: string): ValueParserResult<never> {
    return {
      success: false,
      error: options.errors?.invalidFormat
        ? (typeof options.errors.invalidFormat === "function"
          ? options.errors.invalidFormat(input)
          : options.errors.invalidFormat)
        : message`Expected a file size like ${"10MB"} or ${"1.5GiB"}, but got ${input}.`,
    };
  }

  // bigint branch
  if (options.type === "bigint") {
    const bigintMultiplierMap: Readonly<Record<string, bigint>> = siAsBinary
      ? BIGINT_IEC_MULTIPLIERS
      : {
        ...BIGINT_SI_MULTIPLIERS,
        ...BIGINT_IEC_ONLY_MULTIPLIERS,
      };
    const bigintFormatUnits = siAsBinary
      ? BIGINT_FORMAT_UNITS_SI_AS_BINARY
      : BIGINT_FORMAT_UNITS_DEFAULT;
    const numberFormatUnits = siAsBinary
      ? FORMAT_UNITS_SI_AS_BINARY
      : FORMAT_UNITS_DEFAULT;

    return {
      mode: "sync",
      metavar,
      placeholder: options.placeholder ?? 0n,
      parse(input: string): ValueParserResult<bigint> {
        const match = FILE_SIZE_REGEX.exec(input.trim());
        if (match == null) return invalidFormatError(input);
        const numStr = match[1];
        const unitStr = match[2].toLowerCase();
        let mBig: bigint;
        if (unitStr === "") {
          if (options.defaultUnit == null) return invalidFormatError(input);
          mBig = bigintMultiplierMap[options.defaultUnit.toLowerCase()];
        } else {
          const m = bigintMultiplierMap[unitStr];
          if (m == null) return invalidFormatError(input);
          mBig = m;
        }
        const bytes = parseExactBytesRaw(numStr, mBig);
        if (bytes == null) return invalidFormatError(input);
        if (!(options.allowNegative ?? false) && bytes < 0n) {
          return {
            success: false,
            error: options.errors?.negativeNotAllowed
              ? (typeof options.errors.negativeNotAllowed === "function"
                ? options.errors.negativeNotAllowed(bytes)
                : options.errors.negativeNotAllowed)
              : message`Expected a non-negative file size, but got ${input}.`,
          };
        }
        return { success: true, value: bytes };
      },
      format(value: bigint): string {
        const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
        if (value >= -maxSafe && value <= maxSafe) {
          return formatWithUnits(Number(value), numberFormatUnits);
        }
        return formatBigIntBytes(value, bigintFormatUnits);
      },
    };
  }

  // number branch (default)
  const multiplierMap = siAsBinary ? IEC_MULTIPLIERS : {
    ...SI_MULTIPLIERS,
    ...IEC_ONLY_MULTIPLIERS,
  };
  const formatUnits = siAsBinary
    ? FORMAT_UNITS_SI_AS_BINARY
    : FORMAT_UNITS_DEFAULT;

  return {
    mode: "sync",
    metavar,
    placeholder: options.placeholder ?? 0,
    parse(input: string): ValueParserResult<number> {
      const match = FILE_SIZE_REGEX.exec(input.trim());
      if (match == null) return invalidFormatError(input);
      const numStr = match[1];
      const unitStr = match[2].toLowerCase();
      let multiplier: number;
      if (unitStr === "") {
        if (options.defaultUnit == null) return invalidFormatError(input);
        multiplier = multiplierMap[options.defaultUnit.toLowerCase()];
      } else {
        const m = multiplierMap[unitStr];
        if (m == null) return invalidFormatError(input);
        multiplier = m;
      }
      const bytes = parseExactBytes(numStr, multiplier);
      if (bytes == null) return invalidFormatError(input);
      if (!(options.allowNegative ?? false) && bytes < 0) {
        return {
          success: false,
          error: options.errors?.negativeNotAllowed
            ? (typeof options.errors.negativeNotAllowed === "function"
              ? options.errors.negativeNotAllowed(bytes)
              : options.errors.negativeNotAllowed)
            : message`Expected a non-negative file size, but got ${input}.`,
        };
      }
      return { success: true, value: bytes };
    },
    format(value: number): string {
      return formatWithUnits(value, formatUnits);
    },
  };
}

// https://www.w3.org/TR/css-color-4/#named-colors
const CSS_NAMED_COLORS: Readonly<Record<string, Color>> = {
  aliceblue: { r: 240, g: 248, b: 255, a: 1 },
  antiquewhite: { r: 250, g: 235, b: 215, a: 1 },
  aqua: { r: 0, g: 255, b: 255, a: 1 },
  aquamarine: { r: 127, g: 255, b: 212, a: 1 },
  azure: { r: 240, g: 255, b: 255, a: 1 },
  beige: { r: 245, g: 245, b: 220, a: 1 },
  bisque: { r: 255, g: 228, b: 196, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  blanchedalmond: { r: 255, g: 235, b: 205, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  blueviolet: { r: 138, g: 43, b: 226, a: 1 },
  brown: { r: 165, g: 42, b: 42, a: 1 },
  burlywood: { r: 222, g: 184, b: 135, a: 1 },
  cadetblue: { r: 95, g: 158, b: 160, a: 1 },
  chartreuse: { r: 127, g: 255, b: 0, a: 1 },
  chocolate: { r: 210, g: 105, b: 30, a: 1 },
  coral: { r: 255, g: 127, b: 80, a: 1 },
  cornflowerblue: { r: 100, g: 149, b: 237, a: 1 },
  cornsilk: { r: 255, g: 248, b: 220, a: 1 },
  crimson: { r: 220, g: 20, b: 60, a: 1 },
  cyan: { r: 0, g: 255, b: 255, a: 1 },
  darkblue: { r: 0, g: 0, b: 139, a: 1 },
  darkcyan: { r: 0, g: 139, b: 139, a: 1 },
  darkgoldenrod: { r: 184, g: 134, b: 11, a: 1 },
  darkgray: { r: 169, g: 169, b: 169, a: 1 },
  darkgreen: { r: 0, g: 100, b: 0, a: 1 },
  darkgrey: { r: 169, g: 169, b: 169, a: 1 },
  darkkhaki: { r: 189, g: 183, b: 107, a: 1 },
  darkmagenta: { r: 139, g: 0, b: 139, a: 1 },
  darkolivegreen: { r: 85, g: 107, b: 47, a: 1 },
  darkorange: { r: 255, g: 140, b: 0, a: 1 },
  darkorchid: { r: 153, g: 50, b: 204, a: 1 },
  darkred: { r: 139, g: 0, b: 0, a: 1 },
  darksalmon: { r: 233, g: 150, b: 122, a: 1 },
  darkseagreen: { r: 143, g: 188, b: 143, a: 1 },
  darkslateblue: { r: 72, g: 61, b: 139, a: 1 },
  darkslategray: { r: 47, g: 79, b: 79, a: 1 },
  darkslategrey: { r: 47, g: 79, b: 79, a: 1 },
  darkturquoise: { r: 0, g: 206, b: 209, a: 1 },
  darkviolet: { r: 148, g: 0, b: 211, a: 1 },
  deeppink: { r: 255, g: 20, b: 147, a: 1 },
  deepskyblue: { r: 0, g: 191, b: 255, a: 1 },
  dimgray: { r: 105, g: 105, b: 105, a: 1 },
  dimgrey: { r: 105, g: 105, b: 105, a: 1 },
  dodgerblue: { r: 30, g: 144, b: 255, a: 1 },
  firebrick: { r: 178, g: 34, b: 34, a: 1 },
  floralwhite: { r: 255, g: 250, b: 240, a: 1 },
  forestgreen: { r: 34, g: 139, b: 34, a: 1 },
  fuchsia: { r: 255, g: 0, b: 255, a: 1 },
  gainsboro: { r: 220, g: 220, b: 220, a: 1 },
  ghostwhite: { r: 248, g: 248, b: 255, a: 1 },
  gold: { r: 255, g: 215, b: 0, a: 1 },
  goldenrod: { r: 218, g: 165, b: 32, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  greenyellow: { r: 173, g: 255, b: 47, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  honeydew: { r: 240, g: 255, b: 240, a: 1 },
  hotpink: { r: 255, g: 105, b: 180, a: 1 },
  indianred: { r: 205, g: 92, b: 92, a: 1 },
  indigo: { r: 75, g: 0, b: 130, a: 1 },
  ivory: { r: 255, g: 255, b: 240, a: 1 },
  khaki: { r: 240, g: 230, b: 140, a: 1 },
  lavender: { r: 230, g: 230, b: 250, a: 1 },
  lavenderblush: { r: 255, g: 240, b: 245, a: 1 },
  lawngreen: { r: 124, g: 252, b: 0, a: 1 },
  lemonchiffon: { r: 255, g: 250, b: 205, a: 1 },
  lightblue: { r: 173, g: 216, b: 230, a: 1 },
  lightcoral: { r: 240, g: 128, b: 128, a: 1 },
  lightcyan: { r: 224, g: 255, b: 255, a: 1 },
  lightgoldenrodyellow: { r: 250, g: 250, b: 210, a: 1 },
  lightgray: { r: 211, g: 211, b: 211, a: 1 },
  lightgreen: { r: 144, g: 238, b: 144, a: 1 },
  lightgrey: { r: 211, g: 211, b: 211, a: 1 },
  lightpink: { r: 255, g: 182, b: 193, a: 1 },
  lightsalmon: { r: 255, g: 160, b: 122, a: 1 },
  lightseagreen: { r: 32, g: 178, b: 170, a: 1 },
  lightskyblue: { r: 135, g: 206, b: 250, a: 1 },
  lightslategray: { r: 119, g: 136, b: 153, a: 1 },
  lightslategrey: { r: 119, g: 136, b: 153, a: 1 },
  lightsteelblue: { r: 176, g: 196, b: 222, a: 1 },
  lightyellow: { r: 255, g: 255, b: 224, a: 1 },
  lime: { r: 0, g: 255, b: 0, a: 1 },
  limegreen: { r: 50, g: 205, b: 50, a: 1 },
  linen: { r: 250, g: 240, b: 230, a: 1 },
  magenta: { r: 255, g: 0, b: 255, a: 1 },
  maroon: { r: 128, g: 0, b: 0, a: 1 },
  mediumaquamarine: { r: 102, g: 205, b: 170, a: 1 },
  mediumblue: { r: 0, g: 0, b: 205, a: 1 },
  mediumorchid: { r: 186, g: 85, b: 211, a: 1 },
  mediumpurple: { r: 147, g: 112, b: 219, a: 1 },
  mediumseagreen: { r: 60, g: 179, b: 113, a: 1 },
  mediumslateblue: { r: 123, g: 104, b: 238, a: 1 },
  mediumspringgreen: { r: 0, g: 250, b: 154, a: 1 },
  mediumturquoise: { r: 72, g: 209, b: 204, a: 1 },
  mediumvioletred: { r: 199, g: 21, b: 133, a: 1 },
  midnightblue: { r: 25, g: 25, b: 112, a: 1 },
  mintcream: { r: 245, g: 255, b: 250, a: 1 },
  mistyrose: { r: 255, g: 228, b: 225, a: 1 },
  moccasin: { r: 255, g: 228, b: 181, a: 1 },
  navajowhite: { r: 255, g: 222, b: 173, a: 1 },
  navy: { r: 0, g: 0, b: 128, a: 1 },
  oldlace: { r: 253, g: 245, b: 230, a: 1 },
  olive: { r: 128, g: 128, b: 0, a: 1 },
  olivedrab: { r: 107, g: 142, b: 35, a: 1 },
  orange: { r: 255, g: 165, b: 0, a: 1 },
  orangered: { r: 255, g: 69, b: 0, a: 1 },
  orchid: { r: 218, g: 112, b: 214, a: 1 },
  palegoldenrod: { r: 238, g: 232, b: 170, a: 1 },
  palegreen: { r: 152, g: 251, b: 152, a: 1 },
  paleturquoise: { r: 175, g: 238, b: 238, a: 1 },
  palevioletred: { r: 219, g: 112, b: 147, a: 1 },
  papayawhip: { r: 255, g: 239, b: 213, a: 1 },
  peachpuff: { r: 255, g: 218, b: 185, a: 1 },
  peru: { r: 205, g: 133, b: 63, a: 1 },
  pink: { r: 255, g: 192, b: 203, a: 1 },
  plum: { r: 221, g: 160, b: 221, a: 1 },
  powderblue: { r: 176, g: 224, b: 230, a: 1 },
  purple: { r: 128, g: 0, b: 128, a: 1 },
  rebeccapurple: { r: 102, g: 51, b: 153, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  rosybrown: { r: 188, g: 143, b: 143, a: 1 },
  royalblue: { r: 65, g: 105, b: 225, a: 1 },
  saddlebrown: { r: 139, g: 69, b: 19, a: 1 },
  salmon: { r: 250, g: 128, b: 114, a: 1 },
  sandybrown: { r: 244, g: 164, b: 96, a: 1 },
  seagreen: { r: 46, g: 139, b: 87, a: 1 },
  seashell: { r: 255, g: 245, b: 238, a: 1 },
  sienna: { r: 160, g: 82, b: 45, a: 1 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  skyblue: { r: 135, g: 206, b: 235, a: 1 },
  slateblue: { r: 106, g: 90, b: 205, a: 1 },
  slategray: { r: 112, g: 128, b: 144, a: 1 },
  slategrey: { r: 112, g: 128, b: 144, a: 1 },
  snow: { r: 255, g: 250, b: 250, a: 1 },
  springgreen: { r: 0, g: 255, b: 127, a: 1 },
  steelblue: { r: 70, g: 130, b: 180, a: 1 },
  tan: { r: 210, g: 180, b: 140, a: 1 },
  teal: { r: 0, g: 128, b: 128, a: 1 },
  thistle: { r: 216, g: 191, b: 216, a: 1 },
  tomato: { r: 255, g: 99, b: 71, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  turquoise: { r: 64, g: 224, b: 208, a: 1 },
  violet: { r: 238, g: 130, b: 238, a: 1 },
  wheat: { r: 245, g: 222, b: 179, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  whitesmoke: { r: 245, g: 245, b: 245, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
  yellowgreen: { r: 154, g: 205, b: 50, a: 1 },
};

const CSS_NAMED_COLOR_KEYS: readonly string[] = Object.keys(CSS_NAMED_COLORS);

function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
  ];
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l * 100];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) / 6;
  } else {
    h = ((rn - gn) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

const COLOR_HEX_SHORT_REGEX =
  /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])?$/;
const COLOR_HEX_LONG_REGEX =
  /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})?$/;
const COLOR_NUM_PATTERN = "(?:\\d+(?:\\.\\d*)?|\\d*\\.\\d+)";
const COLOR_HUE_PATTERN = `(?:-?${COLOR_NUM_PATTERN})`;
const COLOR_RGB_REGEX = new RegExp(
  `^rgba?\\(\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})` +
    `\\s*(?:,\\s*(${COLOR_NUM_PATTERN}))?\\s*\\)$`,
  "i",
);
const COLOR_HSL_REGEX = new RegExp(
  `^hsla?\\(\\s*(${COLOR_HUE_PATTERN})\\s*,\\s*(${COLOR_NUM_PATTERN})%` +
    `\\s*,\\s*(${COLOR_NUM_PATTERN})%\\s*(?:,\\s*(${COLOR_NUM_PATTERN}))?\\s*\\)$`,
  "i",
);

const VALID_COLOR_FORMATS = ["hex", "rgb", "hsl", "named"] as const;

/**
 * A structured CSS color value with normalized RGBA components.
 * @since 1.1.0
 */
export interface Color {
  /** Red channel, 0–255. */
  readonly r: number;
  /** Green channel, 0–255. */
  readonly g: number;
  /** Blue channel, 0–255. */
  readonly b: number;
  /** Alpha channel, 0–1 (1 = fully opaque). */
  readonly a: number;
}

/**
 * The CSS color notation a {@link color} parser accepts.
 * @since 1.1.0
 */
export type ColorFormat = "hex" | "rgb" | "hsl" | "named";

/**
 * Options for creating a {@link color} value parser.
 * @since 1.1.0
 */
export interface ColorOptions {
  /**
   * The metavariable name for this parser.  Used in help messages to
   * indicate what kind of value this parser expects.
   * @default `"COLOR"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Restricts which CSS color notations are accepted.  Defaults to all
   * four notations: `"hex"`, `"rgb"`, `"hsl"`, and `"named"`.
   * @default all formats
   */
  readonly formats?: readonly ColorFormat[];

  /**
   * A custom placeholder value used during deferred prompt resolution.
   * @default `{ r: 0, g: 0, b: 0, a: 1 }`
   * @since 1.1.0
   */
  readonly placeholder?: Color;

  /**
   * Custom error messages for color parsing failures.
   * @since 1.1.0
   */
  readonly errors?: {
    /**
     * Custom error message when the input is not a valid CSS color string.
     * Can be a static message or a function that receives the raw input.
     */
    readonly invalidFormat?: Message | ((input: string) => Message);
  };
}

/**
 * Creates a value parser that accepts CSS color strings and returns a
 * structured {@link Color} object with normalized RGBA components.
 *
 * Supported input notations by default:
 * - Hex: `#rgb`, `#rrggbb`, `#rgba`, `#rrggbbaa`
 * - RGB: `rgb(r, g, b)`, `rgba(r, g, b, a)`
 * - HSL: `hsl(h, s%, l%)`, `hsla(h, s%, l%, a)`
 * - Named: all 148 CSS Level 4 named colors (e.g., `red`, `rebeccapurple`)
 *
 * The `format()` method always outputs canonical lowercase hex
 * (`#rrggbb` when fully opaque, `#rrggbbaa` otherwise).
 *
 * @param options Configuration options for the parser.
 * @returns A sync value parser producing {@link Color} objects.
 * @throws {TypeError} If {@link ColorOptions.metavar} is an empty string, or
 *   if {@link ColorOptions.formats} contains an invalid format name.
 * @throws {RangeError} If {@link ValueParser.format} is called with a
 *   {@link Color} whose `r`, `g`, or `b` channel is not an integer in
 *   0–255, or whose `a` channel is not a finite number in 0–1.
 * @since 1.1.0
 */
export function color(options: ColorOptions = {}): ValueParser<"sync", Color> {
  const metavar = options.metavar ?? "COLOR";
  ensureNonEmptyString(metavar);

  if (options.formats !== undefined) {
    for (const fmt of options.formats) {
      if (!(VALID_COLOR_FORMATS as readonly string[]).includes(fmt)) {
        throw new TypeError(
          `Expected formats to contain only ${
            VALID_COLOR_FORMATS.map((v) => JSON.stringify(v)).join(", ")
          }, but got: ${JSON.stringify(fmt)}.`,
        );
      }
    }
  }

  const allowedFormats = options.formats ?? VALID_COLOR_FORMATS;
  const allowHex = allowedFormats.includes("hex");
  const allowRgb = allowedFormats.includes("rgb");
  const allowHsl = allowedFormats.includes("hsl");
  const allowNamed = allowedFormats.includes("named");

  const defaultPlaceholder: Color = { r: 0, g: 0, b: 0, a: 1 };

  const formatExamples: readonly string[] = [
    ...(allowHex ? ["#ff0000"] : []),
    ...(allowRgb ? ["rgb(255, 0, 0)"] : []),
    ...(allowHsl ? ["hsl(0, 100%, 50%)"] : []),
    ...(allowNamed ? ["red"] : []),
  ];

  function invalidFormatError(input: string): ValueParserResult<Color> {
    return {
      success: false,
      error: options.errors?.invalidFormat
        ? (typeof options.errors.invalidFormat === "function"
          ? options.errors.invalidFormat(input)
          : options.errors.invalidFormat)
        : message`Expected a CSS color like ${
          valueSet(formatExamples, {
            fallback: "a valid color",
            type: "disjunction",
          })
        }, but got ${input}.`,
    };
  }

  return {
    mode: "sync",
    metavar,
    placeholder: options.placeholder ?? defaultPlaceholder,

    parse(input: string): ValueParserResult<Color> {
      const trimmed = input.trim();

      if (allowHex) {
        let m = COLOR_HEX_LONG_REGEX.exec(trimmed);
        if (m != null) {
          const r = parseInt(m[1], 16);
          const g = parseInt(m[2], 16);
          const b = parseInt(m[3], 16);
          const a = m[4] !== undefined ? parseInt(m[4], 16) / 255 : 1;
          return { success: true, value: { r, g, b, a } };
        }
        m = COLOR_HEX_SHORT_REGEX.exec(trimmed);
        if (m != null) {
          const r = parseInt(m[1] + m[1], 16);
          const g = parseInt(m[2] + m[2], 16);
          const b = parseInt(m[3] + m[3], 16);
          const a = m[4] !== undefined ? parseInt(m[4] + m[4], 16) / 255 : 1;
          return { success: true, value: { r, g, b, a } };
        }
      }

      if (allowRgb) {
        const m = COLOR_RGB_REGEX.exec(trimmed);
        if (m != null) {
          const r = parseInt(m[1], 10);
          const g = parseInt(m[2], 10);
          const b = parseInt(m[3], 10);
          const aRaw = m[4] !== undefined ? parseFloat(m[4]) : 1;
          if (
            r > 255 || g > 255 || b > 255 ||
            !Number.isFinite(aRaw) || aRaw < 0 || aRaw > 1
          ) {
            return invalidFormatError(input);
          }
          const a = Math.round(aRaw * 255) / 255;
          return { success: true, value: { r, g, b, a } };
        }
      }

      if (allowHsl) {
        const m = COLOR_HSL_REGEX.exec(trimmed);
        if (m != null) {
          const h = parseFloat(m[1]);
          const s = parseFloat(m[2]);
          const l = parseFloat(m[3]);
          const aRaw = m[4] !== undefined ? parseFloat(m[4]) : 1;
          if (
            !Number.isFinite(h) ||
            !Number.isFinite(s) || s < 0 || s > 100 ||
            !Number.isFinite(l) || l < 0 || l > 100 ||
            !Number.isFinite(aRaw) || aRaw < 0 || aRaw > 1
          ) {
            return invalidFormatError(input);
          }
          const [r, g, b] = hslToRgb(h, s / 100, l / 100);
          const a = Math.round(aRaw * 255) / 255;
          return { success: true, value: { r, g, b, a } };
        }
      }

      if (allowNamed) {
        const key = trimmed.toLowerCase();
        if (Object.hasOwn(CSS_NAMED_COLORS, key)) {
          return { success: true, value: { ...CSS_NAMED_COLORS[key] } };
        }
      }

      return invalidFormatError(input);
    },

    format(value: Color): string {
      const { r, g, b, a } = value;
      if (
        !Number.isInteger(r) || r < 0 || r > 255 ||
        !Number.isInteger(g) || g < 0 || g > 255 ||
        !Number.isInteger(b) || b < 0 || b > 255 ||
        !Number.isFinite(a) || a < 0 || a > 1
      ) {
        throw new RangeError(
          `Color components out of range: r=${r}, g=${g}, b=${b}, a=${a}.`,
        );
      }
      const aStr = parseFloat(a.toFixed(4));
      if (allowHex) {
        const rh = r.toString(16).padStart(2, "0");
        const gh = g.toString(16).padStart(2, "0");
        const bh = b.toString(16).padStart(2, "0");
        if (a === 1) return `#${rh}${gh}${bh}`;
        const ah = Math.round(a * 255).toString(16).padStart(2, "0");
        return `#${rh}${gh}${bh}${ah}`;
      }
      if (allowRgb) {
        return a === 1
          ? `rgb(${r}, ${g}, ${b})`
          : `rgba(${r}, ${g}, ${b}, ${aStr})`;
      }
      if (allowHsl) {
        const [h, s, l] = rgbToHsl(r, g, b);
        const hStr = parseFloat(h.toFixed(4));
        const sStr = parseFloat(s.toFixed(4));
        const lStr = parseFloat(l.toFixed(4));
        return a === 1
          ? `hsl(${hStr}, ${sStr}%, ${lStr}%)`
          : `hsla(${hStr}, ${sStr}%, ${lStr}%, ${aStr})`;
      }
      // named-only: try reverse lookup
      for (const [name, c] of Object.entries(CSS_NAMED_COLORS)) {
        if (c.r === r && c.g === g && c.b === b && c.a === a) return name;
      }
      throw new RangeError(
        `No CSS named color matches { r: ${r}, g: ${g}, b: ${b}, a: ${a} }.`,
      );
    },

    normalize(value: Color): Color {
      if (
        !Number.isInteger(value.r) || value.r < 0 || value.r > 255 ||
        !Number.isInteger(value.g) || value.g < 0 || value.g > 255 ||
        !Number.isInteger(value.b) || value.b < 0 || value.b > 255 ||
        !Number.isFinite(value.a) || value.a < 0 || value.a > 1
      ) {
        return value;
      }
      const a = Math.round(value.a * 255) / 255;
      return a === value.a ? value : { ...value, a };
    },

    *suggest(prefix: string): Iterable<Suggestion> {
      if (allowNamed) {
        const lowerPrefix = prefix.toLowerCase();
        for (const name of CSS_NAMED_COLOR_KEYS) {
          if (name.startsWith(lowerPrefix)) {
            yield { kind: "literal", text: name };
          }
        }
      }
    },
  };
}

/**
 * The set of URL schemes that are considered "special" by the WHATWG URL
 * Standard.  These schemes always use the `://` authority syntax.
 * Non-special schemes use only `:` (e.g., `mailto:`, `urn:`).
 */
const SPECIAL_URL_SCHEMES: ReadonlySet<string> = new Set([
  "ftp",
  "file",
  "http",
  "https",
  "ws",
  "wss",
]);

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
 * @throws {TypeError} If any `allowedProtocols` entry is not a valid protocol
 *   string ending with a colon (e.g., `"https:"`).
 */
export function url(options: UrlOptions = {}): ValueParser<"sync", URL> {
  const originalProtocolsList: string[] = [];
  const normalizedProtocolsList: string[] = [];
  if (options.allowedProtocols != null) {
    const seen = new Set<string>();
    for (const protocol of options.allowedProtocols) {
      if (
        typeof protocol !== "string" ||
        !/^[a-z][a-z0-9+\-.]*:$/i.test(protocol)
      ) {
        const rendered = typeof protocol === "string"
          ? JSON.stringify(protocol)
          : String(protocol);
        throw new TypeError(
          `Each allowed protocol must be a valid protocol ending with a colon` +
            ` (e.g., "https:"), got: ${rendered}.`,
        );
      }
      const normalized = protocol.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      originalProtocolsList.push(protocol);
      normalizedProtocolsList.push(normalized);
    }
    if (originalProtocolsList.length === 0) {
      throw new TypeError("allowedProtocols must not be empty.");
    }
  }
  // Snapshot the original protocols for callback arguments (preserves casing),
  // and a normalized copy for internal matching.
  const originalProtocols = options.allowedProtocols != null
    ? Object.freeze(originalProtocolsList)
    : undefined;
  const allowedProtocols = options.allowedProtocols != null
    ? Object.freeze(normalizedProtocolsList)
    : undefined;
  const metavar = options.metavar ?? "URL";
  ensureNonEmptyString(metavar);
  const invalidUrl = options.errors?.invalidUrl;
  const disallowedProtocol = options.errors?.disallowedProtocol;
  return {
    mode: "sync",
    metavar,
    get placeholder() {
      return new URL(
        `${allowedProtocols?.[0] ?? "http:"}//0.invalid`,
      );
    },
    parse(input: string): ValueParserResult<URL> {
      if (!URL.canParse(input)) {
        return {
          success: false,
          error: invalidUrl
            ? (typeof invalidUrl === "function"
              ? invalidUrl(input)
              : invalidUrl)
            : message`Invalid URL: ${input}.`,
        };
      }
      const url = new URL(input);
      if (
        allowedProtocols != null && !allowedProtocols.includes(url.protocol)
      ) {
        return {
          success: false,
          error: disallowedProtocol
            ? (typeof disallowedProtocol === "function"
              ? disallowedProtocol(
                url.protocol,
                originalProtocols!,
              )
              : disallowedProtocol)
            : [
              { type: "text", text: "URL protocol " },
              { type: "value", value: url.protocol },
              { type: "text", text: " is not allowed. Allowed protocols: " },
              ...valueSet(originalProtocols!, {
                fallback: "",
                locale: "en-US",
              }),
              { type: "text", text: "." },
            ] as Message,
        };
      }
      return { success: true, value: url };
    },
    format(value: URL): string {
      return value.href;
    },
    *suggest(prefix: string): Iterable<Suggestion> {
      if (allowedProtocols && prefix.length > 0 && !prefix.includes(":")) {
        for (const protocol of allowedProtocols) {
          const cleanProtocol = protocol.replace(/:+$/, "");
          if (cleanProtocol.startsWith(prefix.toLowerCase())) {
            const suffix = SPECIAL_URL_SCHEMES.has(cleanProtocol) ? "://" : ":";
            yield {
              kind: "literal",
              text: `${cleanProtocol}${suffix}`,
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
    mode: "sync",
    metavar,
    placeholder: new Intl.Locale("und"),
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
      return value.toString();
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
   * Each version must be an integer between 1 and 8 (the standardized
   * [RFC 9562] versions).  Duplicate entries are automatically removed.
   * If specified, the parser will validate that the UUID matches one of the
   * allowed versions.  If not specified, the accepted versions depend on
   * the {@link strict} option.
   *
   * [RFC 9562]: https://www.rfc-editor.org/rfc/rfc9562
   */
  readonly allowedVersions?: readonly number[];

  /**
   * Whether to enforce strict [RFC 9562] validation.  When `true` (the
   * default), the parser validates that the version digit is one of the
   * currently standardized versions (1 through 8) and that the variant bits
   * follow the RFC 9562 layout (`10xx`, i.e., hex digits `8`, `9`, `a`,
   * or `b` at position 20 of the UUID string).
   *
   * The nil UUID (`00000000-0000-0000-0000-000000000000`) and max UUID
   * (`ffffffff-ffff-ffff-ffff-ffffffffffff`) are accepted as special
   * standard values regardless of this setting.
   *
   * When `false`, the parser only validates the UUID format without
   * checking version or variant fields.
   *
   * When {@link allowedVersions} is provided, it takes precedence over the
   * strict version check, but variant bit validation still applies if
   * `strict` is `true`.
   *
   * [RFC 9562]: https://www.rfc-editor.org/rfc/rfc9562
   * @default true
   * @since 1.0.0
   */
  readonly strict?: boolean;

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

    /**
     * Custom error message when UUID variant bits are not RFC 9562 compliant.
     * Can be a static message or a function that receives the input.
     * @since 1.0.0
     */
    invalidVariant?: Message | ((input: string) => Message);
  };
}

/**
 * Creates a {@link ValueParser} for UUID values.
 *
 * This parser validates that the input is a well-formed UUID string in the
 * standard format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` where each `x`
 * is a hexadecimal digit.
 *
 * By default, the parser enforces strict [RFC 9562] validation: it requires
 * a standardized version digit (1 through 8) and the RFC 9562 variant bits
 * (`10xx`).  The nil and max UUIDs are accepted as special standard values.
 * Set `strict: false` to disable the default RFC 9562 version/variant
 * checks.  An explicit {@link UuidOptions.allowedVersions} list still
 * constrains the version nibble even in lenient mode.
 *
 * [RFC 9562]: https://www.rfc-editor.org/rfc/rfc9562
 * @param options Configuration options for the UUID parser.
 * @returns A {@link ValueParser} that converts string input to {@link Uuid}
 *          strings.
 * @throws {TypeError} If any element of
 *   {@link UuidOptions.allowedVersions} is not an integer.
 * @throws {RangeError} If any element of
 *   {@link UuidOptions.allowedVersions} is outside the range 1 to 8.
 */
export function uuid(options: UuidOptions = {}): ValueParser<"sync", Uuid> {
  // UUID regex pattern: 8-4-4-4-12 hex digits with dashes
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const metavar = options.metavar ?? "UUID";
  ensureNonEmptyString(metavar);
  checkBooleanOption(options, "strict");
  // Snapshot mutable config at construction time
  const strict = options.strict !== false;
  const allowedVersions = options.allowedVersions != null
    ? (() => {
      const unique = new Set<number>();
      for (const v of options.allowedVersions) {
        if (!Number.isInteger(v)) {
          throw new TypeError(
            `Expected every element of allowedVersions to be an integer, but got value "${
              typeof v === "symbol" ? (v as symbol).toString() : String(v)
            }" of type "${
              Array.isArray(v) ? "array" : (v === null ? "null" : typeof v)
            }".`,
          );
        }
        if (v < 1 || v > 8) {
          throw new RangeError(
            `Expected every element of allowedVersions to be between 1 and 8, but got: ${v}.`,
          );
        }
        unique.add(v);
      }
      return Object.freeze([...unique]);
    })()
    : null;
  const invalidUuid = options.errors?.invalidUuid;
  const disallowedVersion = options.errors?.disallowedVersion;
  const invalidVariant = options.errors?.invalidVariant;

  return {
    mode: "sync",
    metavar,
    placeholder: "00000000-0000-0000-0000-000000000000" as Uuid,
    parse(input: string): ValueParserResult<Uuid> {
      if (!uuidRegex.test(input)) {
        return {
          success: false,
          error: invalidUuid
            ? (typeof invalidUuid === "function"
              ? invalidUuid(input)
              : invalidUuid)
            : message`Expected a valid UUID in format ${"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}, but got ${input}.`,
        };
      }

      // Accept nil and max UUIDs as special standard values
      const lower = input.toLowerCase();
      if (
        lower === "00000000-0000-0000-0000-000000000000" ||
        lower === "ffffffff-ffff-ffff-ffff-ffffffffffff"
      ) {
        return { success: true, value: input as Uuid };
      }

      // Extract version from the first character of the third group
      const versionChar = input.charAt(14);
      const version = parseInt(versionChar, 16);

      // Check version against allowedVersions if specified
      if (allowedVersions != null && allowedVersions.length > 0) {
        if (!allowedVersions.includes(version)) {
          return {
            success: false,
            error: disallowedVersion
              ? (typeof disallowedVersion === "function"
                ? disallowedVersion(version, allowedVersions)
                : disallowedVersion)
              : (() => {
                let expectedVersions = message``;
                let i = 0;
                for (const v of allowedVersions) {
                  expectedVersions = i < 1
                    ? message`${expectedVersions}${v.toLocaleString("en")}`
                    : i + 1 >= allowedVersions.length
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
      } else if (strict && (version < 1 || version > 8)) {
        // In strict mode without allowedVersions, require RFC 9562 versions
        return {
          success: false,
          error: disallowedVersion
            ? (typeof disallowedVersion === "function"
              ? disallowedVersion(version, [1, 2, 3, 4, 5, 6, 7, 8])
              : disallowedVersion)
            : message`Expected UUID version 1 through 8, but got version ${
              version.toLocaleString("en")
            }.`,
        };
      }

      // Validate RFC 9562 variant bits in strict mode
      if (strict) {
        const variantChar = input.charAt(19).toLowerCase();
        if (
          variantChar !== "8" && variantChar !== "9" &&
          variantChar !== "a" && variantChar !== "b"
        ) {
          return {
            success: false,
            error: invalidVariant
              ? (typeof invalidVariant === "function"
                ? invalidVariant(input)
                : invalidVariant)
              : message`Expected RFC 9562 variant (8, 9, a, or b at position 20), but got ${variantChar} in ${input}.`,
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
   * A custom placeholder value used during deferred prompt resolution.
   * Defaults to `min` (which itself defaults to `1`).
   *
   * @since 1.0.0
   */
  readonly placeholder?: number;

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
   * A custom placeholder value used during deferred prompt resolution.
   * Defaults to `min` (which itself defaults to `1n`).
   *
   * @since 1.0.0
   */
  readonly placeholder?: bigint;

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
 * @throws {TypeError} If `options.type` is provided but is neither `"number"`
 *   nor `"bigint"`.
 * @since 0.10.0
 */
export function port(
  options?: PortOptionsNumber | PortOptionsBigInt,
): ValueParser<"sync", number> | ValueParser<"sync", bigint> {
  checkBooleanOption(options, "disallowWellKnown");
  if (
    options?.type !== undefined &&
    options.type !== "number" &&
    options.type !== "bigint"
  ) {
    throw new TypeError(
      `Expected type to be "number" or "bigint", but got: ${
        String(options.type)
      }.`,
    );
  }
  if (options?.type === "bigint") {
    const metavar = options.metavar ?? "PORT";
    ensureNonEmptyString(metavar);
    const min = options.min ?? 1n;
    const max = options.max ?? 65535n;
    if (min > max) {
      throw new RangeError(
        `Expected min to be less than or equal to max, but got ` +
          `min: ${min} and max: ${max}.`,
      );
    }
    if (options.disallowWellKnown && min < 1024n && max < 1024n) {
      throw new RangeError(
        "disallowWellKnown is incompatible with the configured port range: " +
          `all ports ${min}..${max} are well-known.`,
      );
    }

    return {
      mode: "sync",
      metavar,
      placeholder: options.placeholder ??
        (options.disallowWellKnown && min < 1024n
          ? (1024n > min ? 1024n : min)
          : min),
      parse(input: string): ValueParserResult<bigint> {
        if (!input.match(/^-?\d+$/)) {
          return {
            success: false,
            error: options.errors?.invalidPort
              ? (typeof options.errors.invalidPort === "function"
                ? options.errors.invalidPort(input)
                : options.errors.invalidPort)
              : message`Expected a valid port number, but got ${input}.`,
          };
        }
        const value = BigInt(input);

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

  if (options?.min != null && !Number.isFinite(options.min)) {
    throw new RangeError(
      `Expected min to be a finite number, but got: ${options.min}`,
    );
  }
  if (options?.max != null && !Number.isFinite(options.max)) {
    throw new RangeError(
      `Expected max to be a finite number, but got: ${options.max}`,
    );
  }
  const metavar = options?.metavar ?? "PORT";
  ensureNonEmptyString(metavar);
  const min = options?.min ?? 1;
  const max = options?.max ?? 65535;
  if (min > max) {
    throw new RangeError(
      `Expected min to be less than or equal to max, but got ` +
        `min: ${min} and max: ${max}.`,
    );
  }
  if (options?.disallowWellKnown && min < 1024 && max < 1024) {
    throw new RangeError(
      "disallowWellKnown is incompatible with the configured port range: " +
        `all ports ${min}..${max} are well-known.`,
    );
  }

  return {
    mode: "sync",
    metavar,
    placeholder: options?.placeholder ??
      (options?.disallowWellKnown && min < 1024 ? Math.max(1024, min) : min),
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
    mode: "sync",
    metavar,
    placeholder: allowZero
      ? "0.0.0.0"
      : allowLoopback
      ? "127.0.0.1"
      : "192.0.2.1",
    parse(input: string): ValueParserResult<string> {
      const octets = parseIpv4Octets(input);
      if (octets === null) {
        const errorMsg = options?.errors?.invalidIpv4;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input)
          : errorMsg ??
            message`Expected a valid IPv4 address, but got ${input}.`;
        return { success: false, error: msg };
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
   * A custom placeholder value used during deferred prompt resolution.
   * Override when `allowLocalhost` or other constraints reject the default.
   *
   * @since 1.0.0
   */
  readonly placeholder?: string;

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
 * - Dotted all-numeric strings (e.g., `192.168.0.1`) are rejected as they
 *   resemble IPv4 addresses rather than DNS hostnames
 *
 * @param options - Options for hostname validation.
 * @returns A value parser for hostnames.
 * @throws {TypeError} If `allowWildcard`, `allowUnderscore`, or
 *   `allowLocalhost` is not a boolean.
 * @throws {RangeError} If `maxLength` is not a positive integer.
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

  checkBooleanOption(options, "allowWildcard");
  checkBooleanOption(options, "allowUnderscore");
  checkBooleanOption(options, "allowLocalhost");

  const allowWildcard = options?.allowWildcard ?? false;
  const allowUnderscore = options?.allowUnderscore ?? false;
  const allowLocalhost = options?.allowLocalhost ?? true;
  const maxLength = options?.maxLength ?? 253;
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError(
      "maxLength must be an integer greater than or equal to 1.",
    );
  }

  return {
    mode: "sync",
    metavar,
    placeholder: options?.placeholder ??
      (allowLocalhost
        ? (maxLength >= 9 ? "localhost" : "a.bc")
        : (maxLength >= 11 ? "example.com" : "a.bc")),
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
      if (!allowLocalhost && input.toLowerCase() === "localhost") {
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

        // Check for wildcard localhost (e.g., *.localhost)
        if (!allowLocalhost && rest.toLowerCase() === "localhost") {
          const errorMsg = options?.errors?.localhostNotAllowed;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ?? message`Hostname 'localhost' is not allowed.`;
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

        // Skip the leftmost wildcard label only when wildcard is allowed
        // and the input starts with "*." (already validated above)
        if (
          label === "*" && allowWildcard && input.startsWith("*.") &&
          label === labels[0]
        ) {
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

      // Reject dotted all-numeric strings (e.g., IPv4 addresses like
      // 192.168.0.1).  Single-label numeric names are allowed so that
      // hostname() can still accept values like "123".
      if (labels.length >= 2 && labels.every((l) => /^[0-9]+$/.test(l))) {
        const errorMsg = options?.errors?.invalidHostname;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input)
          : errorMsg ??
            message`Expected a valid hostname, but got ${input}.`;
        return { success: false, error: msg };
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
   * If `true`, converts the domain part of the email to lowercase.
   * The local part is preserved as-is, since it is technically
   * case-sensitive per RFC 5321.
   * @default false
   */
  readonly lowercase?: boolean;

  /**
   * List of allowed email domains (e.g., ["example.com", "test.org"]).
   * If specified, only emails from these domains are accepted.
   */
  readonly allowedDomains?: readonly string[];

  /**
   * Override the default placeholder value used for deferred parsing.
   * When not specified, the placeholder is derived from the first entry in
   * {@link allowedDomains} (or `"example.com"` when no domains are set).
   * @since 1.0.0
   */
  readonly placeholder?: string | readonly string[];

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
 * @throws {TypeError} If any `allowedDomains` entry is not a string, has
 *   leading/trailing whitespace, starts with `"@"`, is empty, lacks a dot,
 *   has invalid hostname label syntax, or is an IPv4-like dotted-quad.
 * @throws {TypeError} If `placeholder` type does not match `allowMultiple`
 *   mode (string for single, array for multiple).
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
  if (options?.placeholder != null) {
    if (allowMultiple && !Array.isArray(options.placeholder)) {
      throw new TypeError(
        "email() placeholder must be an array when allowMultiple is true.",
      );
    }
    if (!allowMultiple && typeof options.placeholder !== "string") {
      throw new TypeError(
        "email() placeholder must be a string when allowMultiple is false.",
      );
    }
  }
  const allowDisplayName = options?.allowDisplayName ?? false;
  const lowercase = options?.lowercase ?? false;
  const allowedDomains = options?.allowedDomains != null
    ? Object.freeze([...options.allowedDomains])
    : undefined;
  if (allowedDomains != null) {
    if (allowedDomains.length === 0) {
      throw new TypeError("allowedDomains must not be empty.");
    }
    for (let i = 0; i < allowedDomains.length; i++) {
      const entry = allowedDomains[i];
      if (typeof entry !== "string") {
        throw new TypeError(
          `allowedDomains[${i}] must be a string, got ${typeof entry}.`,
        );
      }
      if (entry !== entry.trim()) {
        throw new TypeError(
          `allowedDomains[${i}] must not have leading or trailing whitespace: ${
            JSON.stringify(entry)
          }`,
        );
      }
      if (entry.startsWith("@")) {
        throw new TypeError(
          `allowedDomains[${i}] must not start with "@": ${
            JSON.stringify(entry)
          }`,
        );
      }
      if (entry === "" || !entry.includes(".")) {
        throw new TypeError(
          `allowedDomains[${i}] is not a valid domain: ${
            JSON.stringify(entry)
          }`,
        );
      }
      if (
        entry.startsWith(".") || entry.endsWith(".") ||
        entry.startsWith("-") || entry.endsWith("-")
      ) {
        throw new TypeError(
          `allowedDomains[${i}] is not a valid domain: ${
            JSON.stringify(entry)
          }`,
        );
      }
      const labels = entry.split(".");
      for (const label of labels) {
        if (
          label.length === 0 || label.length > 63 ||
          label.startsWith("-") || label.endsWith("-") ||
          !/^[a-zA-Z0-9-]+$/.test(label)
        ) {
          throw new TypeError(
            `allowedDomains[${i}] is not a valid domain: ${
              JSON.stringify(entry)
            }`,
          );
        }
      }
      // Reject IPv4-like dotted-quad domains (e.g., 192.168.0.1)
      if (
        labels.length === 4 &&
        labels.every((label) => /^[0-9]+$/.test(label))
      ) {
        throw new TypeError(
          `allowedDomains[${i}] is not a valid domain: ${
            JSON.stringify(entry)
          }`,
        );
      }
    }
  }
  const invalidEmail = options?.errors?.invalidEmail;
  const domainNotAllowed = options?.errors?.domainNotAllowed;

  // Simplified RFC 5322: alphanumeric, dots, hyphens, underscores, plus signs
  const atextRegex = /^[a-zA-Z0-9._+-]+$/;
  const encoder = new TextEncoder();

  // Validate a single email address (RFC 5322 addr-spec)
  function validateEmail(input: string): string | null {
    const trimmed = input.trim();

    // Handle display name format: "Name <email@example.com>"
    let emailAddr = trimmed;
    if (allowDisplayName) {
      // Match well-formed display-name syntax per RFC 5322:
      //   Display Name <email>  (phrase may mix unquoted and quoted words)
      // The display name is a sequence of quoted strings (which may contain
      // angle brackets) and unquoted characters (which may not).  Rejects
      // bare <email>, multiple unquoted <...> groups, and trailing text.
      //
      // Regex breakdown:
      //   ^                          start of string
      //   (                          capture group 1: display name
      //     (?:                        one or more of:
      //       "(?:[^"\\]|\\.)*"          quoted string (may contain <> etc.)
      //       |                          or
      //       [^<>"]                     single char: not < > or "
      //     )+
      //   )
      //   \s*                         optional whitespace before <
      //   <([^<>]+)>                  capture group 2: email inside < >
      //   $                           end of string
      const displayNameMatch = trimmed.match(
        /^((?:"(?:[^"\\]|\\.)*"|[^<>"])+)\s*<([^<>]+)>$/,
      );
      // Ensure the display name contains real content, not just quotes
      // and whitespace (e.g., reject "" <email> and "   " <email>).
      // Strip surrounding quotes from each quoted phrase before testing.
      if (
        displayNameMatch &&
        /\S/.test(
          displayNameMatch[1].replace(
            /"((?:[^"\\]|\\.)*)"/g,
            (_match, inner: string) => inner,
          ),
        )
      ) {
        emailAddr = displayNameMatch[2].trim();
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

    // RFC 5321 §4.5.3.1.1: local-part max 64 octets
    if (encoder.encode(localPart).length > 64) {
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

    // Reject IPv4-like dotted-quad domains (e.g., 192.168.0.1)
    if (
      domainLabels.length === 4 &&
      domainLabels.every((label) => /^[0-9]+$/.test(label))
    ) {
      return null;
    }

    // RFC 5321 §4.5.3.1.3: path max 256 octets → address max 254 octets
    if (encoder.encode(emailAddr).length > 254) {
      return null;
    }

    // Return the email (preserve original form or extracted from display name)
    const resultEmail = emailAddr;
    if (!lowercase) return resultEmail;
    const lastAt = resultEmail.lastIndexOf("@");
    return resultEmail.slice(0, lastAt) +
      resultEmail.slice(lastAt).toLowerCase();
  }

  /**
   * Splits an input string on commas, respecting quoted segments and
   * angle-bracket display-name syntax per RFC 5322.
   */
  function splitEmails(input: string): readonly string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    let inAngleBrackets = false;
    let escaped = false;
    for (const char of input) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\" && inQuotes) {
        escaped = true;
      } else if (char === '"' && !inAngleBrackets) {
        if (inQuotes) {
          inQuotes = false;
        } else if (current.trim() === "") {
          inQuotes = true;
        }
      } else if (char === "<" && !inQuotes) {
        inAngleBrackets = true;
      } else if (char === ">" && !inQuotes) {
        inAngleBrackets = false;
      } else if (char === "," && !inQuotes && !inAngleBrackets) {
        result.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    result.push(current);
    return result;
  }

  return {
    mode: "sync" as const,
    metavar,
    placeholder: (options?.placeholder ?? (options?.allowMultiple
      ? ([
        `user@${options?.allowedDomains?.[0] ?? "example.com"}`,
      ] as readonly string[])
      : `user@${options?.allowedDomains?.[0] ?? "example.com"}`)) as
        & string
        & readonly string[],
    parse(
      input: string,
    ): ValueParserResult<string> | ValueParserResult<readonly string[]> {
      if (allowMultiple) {
        // Parse multiple emails separated by commas
        const emails = splitEmails(input).map((e) => e.trim());
        const validatedEmails: string[] = [];

        for (const email of emails) {
          const validated = validateEmail(email);
          if (validated === null) {
            const errorMsg = invalidEmail;
            const msg = typeof errorMsg === "function"
              ? errorMsg(email)
              : errorMsg ??
                message`Expected a valid email address, but got ${email}.`;
            return { success: false, error: msg };
          }

          // Check domain restriction
          if (allowedDomains != null) {
            const atIndex = validated.indexOf("@");
            const domain = validated.substring(atIndex + 1).toLowerCase();
            const isAllowed = allowedDomains.some((allowed) =>
              domain === allowed.toLowerCase()
            );
            if (!isAllowed) {
              const errorMsg = domainNotAllowed;
              if (typeof errorMsg === "function") {
                return {
                  success: false,
                  error: errorMsg(validated, allowedDomains),
                };
              }
              const msg = errorMsg ?? [
                { type: "text", text: "Email domain " },
                { type: "value", value: domain },
                { type: "text", text: " is not allowed. Allowed domains: " },
                ...valueSet(allowedDomains, { fallback: "", locale: "en-US" }),
                { type: "text", text: "." },
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
          const errorMsg = invalidEmail;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Expected a valid email address, but got ${input}.`;
          return { success: false, error: msg };
        }

        // Check domain restriction
        if (allowedDomains != null) {
          const atIndex = validated.indexOf("@");
          const domain = validated.substring(atIndex + 1).toLowerCase();
          const isAllowed = allowedDomains.some((allowed) =>
            domain === allowed.toLowerCase()
          );
          if (!isAllowed) {
            const errorMsg = domainNotAllowed;
            if (typeof errorMsg === "function") {
              return {
                success: false,
                error: errorMsg(validated, allowedDomains),
              };
            }
            const msg = errorMsg ?? [
              { type: "text", text: "Email domain " },
              { type: "value", value: domain },
              { type: "text", text: " is not allowed. Allowed domains: " },
              ...valueSet(allowedDomains, { fallback: "", locale: "en-US" }),
              { type: "text", text: "." },
            ] as Message;
            return { success: false, error: msg };
          }
        }

        return { success: true, value: validated };
      }
    },
    format(value: string | readonly string[]): string {
      if (Array.isArray(value)) {
        return value.join(", ");
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
   * The metavariable name for this parser.  If not specified, it is derived
   * from the {@link separator} (e.g., `"HOST:PORT"` for `":"`).
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
     * IP version to accept when `type` is `"ip"` or `"both"`.
     * - `4`: IPv4 only
     * - `6`: IPv6 only
     * - `"both"`: Accept both IPv4 and IPv6
     *
     * @default `"both"` unless only the legacy {@link ip} field is set, in
     * which case the default is `4` to preserve IPv4-only compatibility.
     * @since 1.1.0
     */
    readonly version?: 4 | 6 | "both";

    /**
     * Options for IPv4 validation (when type is "ip" or "both").
     * This is kept for backwards compatibility; prefer {@link ipv4} for
     * new code.
     */
    readonly ip?: Omit<Ipv4Options, "metavar" | "errors">;

    /**
     * Options for IPv4 validation (when type is "ip" or "both").
     *
     * @since 1.1.0
     */
    readonly ipv4?: Omit<Ipv4Options, "metavar" | "errors">;

    /**
     * Options for IPv6 validation (when type is "ip" or "both").
     *
     * @since 1.1.0
     */
    readonly ipv6?: Omit<Ipv6Options, "metavar" | "errors">;
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
 * - Hostnames, IPv4 addresses, and IPv6 addresses
 * - Configurable host:port separator
 * - Optional default port
 * - Host type filtering (hostname only, IP only, or both)
 * - Port range validation
 *
 * @param options - Options for socket address validation.
 * @returns A value parser for socket addresses.
 * @throws {TypeError} If `separator` is an empty string.
 * @throws {TypeError} If `separator` contains digit characters, since digits
 *   in the separator would cause ambiguous splitting of port input.
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
  const separator = options?.separator ?? ":";
  if (separator === "") {
    throw new TypeError("Expected separator to not be empty.");
  }
  if (/\p{Nd}/u.test(separator)) {
    throw new TypeError(
      `Expected separator to not contain digits, but got: ${
        JSON.stringify(separator)
      }.`,
    );
  }
  const formatExample = `host${JSON.stringify(separator).slice(1, -1)}port`;
  const metavar = options?.metavar ?? `HOST${separator}PORT`;
  ensureNonEmptyString(metavar);
  const defaultPort = options?.defaultPort;
  const requirePort = options?.requirePort ?? false;
  const hostType = options?.host?.type ?? "both";
  const rawHostVersion: unknown = options?.host?.version;
  if (
    rawHostVersion !== undefined &&
    rawHostVersion !== 4 &&
    rawHostVersion !== 6 &&
    rawHostVersion !== "both"
  ) {
    throw new TypeError(
      `Expected host.version to be 4, 6, or "both", but got ${
        Array.isArray(rawHostVersion) ? "array" : typeof rawHostVersion
      }: ${String(rawHostVersion)}.`,
    );
  }
  const hasLegacyIpOptions = options?.host?.ip !== undefined;
  const hasNewIpOptions = rawHostVersion !== undefined ||
    options?.host?.ipv4 !== undefined ||
    options?.host?.ipv6 !== undefined;
  const hostVersion = rawHostVersion ??
    (hasLegacyIpOptions && !hasNewIpOptions ? 4 : "both");

  // Create host parser based on type
  const hostnameParser = hostname({
    ...options?.host?.hostname,
    metavar: "HOST",
  });
  const ipv4Options = {
    ...options?.host?.ip,
    ...options?.host?.ipv4,
  };
  const ipv4Parser = ipv4({
    ...ipv4Options,
    metavar: "HOST",
  });
  const ipv6Parser = ipv6({
    ...options?.host?.ipv6,
    metavar: "HOST",
  });

  // Parser used to decide whether a split is ambiguous: if the
  // whole input is accepted as a hostname by this parser, the
  // separator might be part of the hostname and the split error
  // would be misleading.
  //
  // In "hostname" and "both" modes the user's own hostnameParser
  // is the right authority—its policy restrictions (maxLength,
  // allowUnderscore, etc.) determine which strings are valid
  // hostnames, so they should also determine split ambiguity.
  //
  // In "ip" mode hostname options are irrelevant, so a maximally
  // permissive syntax check is used instead to avoid leaking
  // hostname policy into IP-only parsing.
  const disambiguationParser = hostType === "ip"
    ? hostname({
      metavar: "HOST",
      allowWildcard: true,
      allowUnderscore: true,
      maxLength: Math.max(253, options?.host?.hostname?.maxLength ?? 0),
    })
    : hostnameParser;

  // Whether the separator consists of characters that can appear
  // inside valid hostnames (letters, digits, dot, hyphen).  When
  // true, a hostPart containing the separator might be a legitimate
  // dotted or hyphenated host, so only pure-separator hostParts are
  // treated as degenerate.  When false (e.g., ":" or " "), any
  // hostPart containing the separator is a structural artifact from
  // a multi-separator input like "foo:80:90".
  const separatorIsHostChar = /^[a-zA-Z0-9._-]+$/.test(separator);

  // Create port parser
  const portParser = port({
    ...options?.port,
    metavar: "PORT",
    type: "number",
  });

  function looksLikeIpv4(input: string): boolean {
    return /^\d+\.\d+\.\d+\.\d+$/.test(input);
  }

  function looksLikeIpv6(input: string): boolean {
    const colonCount = input.match(/:/g)?.length ?? 0;
    return colonCount >= 2 &&
      (input.includes("::") || /^[0-9a-fA-F:.]+$/.test(input));
  }

  function looksLikeBareIpv6(input: string): boolean {
    if (!looksLikeIpv6(input)) return false;
    if (parseAndNormalizeIpv6(input) !== null) return true;
    return input.includes("::") || !input.includes(".");
  }

  function looksLikeAltIpv4Literal(input: string): boolean {
    // Single hex integer within 32-bit IPv4 range: 0x7f000001.
    // Values above 0xFFFFFFFF cannot represent an IPv4 address and
    // are allowed as single-label hostnames.
    if (/^0[xX][0-9a-fA-F]+$/.test(input)) {
      const n = parseInt(input.slice(2), 16);
      return n <= 0xFFFFFFFF;
    }

    // Single octal integer within 32-bit IPv4 range: 017700000001.
    // A leading zero followed by octal digits is interpreted as octal
    // by WHATWG URL parsers and platform resolvers (e.g., Node's
    // dns.lookup).  Numbers containing digits 8-9 are not valid octal
    // and fall through to hostname validation.
    if (/^0[0-7]+$/.test(input)) {
      const n = parseInt(input.slice(1), 8);
      return n <= 0xFFFFFFFF;
    }

    // Dotted forms (2-4 parts) where at least one part uses hex or
    // octal notation.  Parts are parsed with WHATWG IPv4 number
    // semantics (0x → hex, leading 0 → octal, else decimal) and
    // checked against the WHATWG range: first N-1 parts must be ≤ 255,
    // last part < 256^(5-N).
    const parts = input.split(".");
    if (parts.length >= 2 && parts.length <= 4) {
      const numericOrHex = /^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/;
      if (
        parts.every((p) => numericOrHex.test(p)) &&
        parts.some((p) => /^0[xX]/i.test(p) || (p.length > 1 && p[0] === "0"))
      ) {
        const values: number[] = [];
        for (const p of parts) {
          if (/^0[xX]/i.test(p)) {
            values.push(parseInt(p.slice(2), 16));
          } else if (p.length > 1 && p[0] === "0") {
            // WHATWG treats leading-zero numbers as octal.  If the
            // part contains non-octal digits (8, 9), WHATWG's IPv4
            // number parser fails, so the whole form is not IPv4.
            if (/[89]/.test(p)) return false;
            values.push(parseInt(p, 8));
          } else {
            values.push(Number(p));
          }
        }
        const lastMax = 256 ** (5 - parts.length);
        return values.slice(0, -1).every((v) => v <= 255) &&
          values[values.length - 1] < lastMax;
      }
    }

    return false;
  }

  function parseIpHost(hostInput: string): ValueParserResult<string> {
    if (hostVersion === 4) return ipv4Parser.parse(hostInput);

    if (hostVersion === 6) return ipv6Parser.parse(hostInput);

    if (looksLikeIpv6(hostInput)) {
      const result = ipv6Parser.parse(hostInput);
      if (result.success) {
        const mappedOctets = extractIpv4FromMapped(result.value);
        if (mappedOctets !== null) {
          const restrictionError = checkIpv4MappedRestrictions(
            mappedOctets,
            result.value,
            ipv4Options,
            undefined,
          );
          if (restrictionError !== null) return restrictionError;
        }
      }
      return result;
    }

    return ipv4Parser.parse(hostInput);
  }

  function parseHost(hostInput: string): ValueParserResult<string> {
    if (hostType === "hostname") {
      // Reject IP-shaped input when type is "hostname".
      // Check alternate forms first so that octal-dotted inputs like
      // 0177.0.0.1 get the specific "non-standard notation" error
      // instead of the generic "expected a hostname" error.
      if (looksLikeAltIpv4Literal(hostInput)) {
        return {
          success: false,
          error:
            message`${hostInput} appears to be a non-standard IPv4 address notation.`,
        };
      }
      if (looksLikeIpv4(hostInput)) {
        return {
          success: false,
          error: message`Expected a valid hostname, but got ${hostInput}.`,
        };
      }
      return hostnameParser.parse(hostInput);
    } else if (hostType === "ip") {
      return parseIpHost(hostInput);
    } else {
      // "both" mode: route by lexical form, no fallback.
      // Check alternate forms first so that octal-dotted inputs get
      // the specific error instead of failing in ipv4().
      if (looksLikeAltIpv4Literal(hostInput)) {
        return {
          success: false,
          error:
            message`${hostInput} appears to be a non-standard IPv4 address notation.`,
        };
      }
      if (looksLikeIpv4(hostInput)) {
        // IP-shaped input: validate as IP only (enforces restrictions)
        return parseIpHost(hostInput);
      }
      if (looksLikeIpv6(hostInput)) {
        return parseIpHost(hostInput);
      }
      // Non-IP-shaped: validate as hostname only
      return hostnameParser.parse(hostInput);
    }
  }

  function makeInvalidFormatError(
    input: string,
  ): ValueParserResult<SocketAddressValue> {
    const errorMsg = options?.errors?.invalidFormat;
    const msg = typeof errorMsg === "function" ? errorMsg(input) : errorMsg ??
      message`Expected a socket address in format ${
        text(formatExample)
      }, but got ${input}.`;
    return { success: false, error: msg };
  }

  function makeMissingPortError(
    input: string,
  ): ValueParserResult<SocketAddressValue> {
    const errorMsg = options?.errors?.missingPort;
    const msg = typeof errorMsg === "function"
      ? errorMsg(input)
      : errorMsg ?? message`Port number is required but was not specified.`;
    return { success: false, error: msg };
  }

  function parseBracketedHost(
    input: string,
    trimmed: string,
    canOmitPort: boolean,
  ): ValueParserResult<SocketAddressValue> | undefined {
    if (!trimmed.startsWith("[")) return undefined;

    const closingBracket = trimmed.indexOf("]");
    if (closingBracket === -1) return makeInvalidFormatError(input);

    const hostInput = trimmed.slice(1, closingBracket);
    if (!looksLikeBareIpv6(hostInput)) return makeInvalidFormatError(input);

    const rest = trimmed.slice(closingBracket + 1).trimStart();
    const hostResult = parseHost(hostInput);

    if (rest === "") {
      if (!hostResult.success) {
        if (options?.errors?.invalidFormat) {
          return makeInvalidFormatError(input);
        }
        return { success: false, error: hostResult.error };
      }
      if (canOmitPort) {
        return {
          success: true,
          value: { host: hostResult.value, port: defaultPort! },
        };
      }
      return makeMissingPortError(input);
    }

    if (!rest.startsWith(separator)) return makeInvalidFormatError(input);

    const portPart = rest.slice(separator.length).trim();
    if (portPart === "") {
      if (!hostResult.success) {
        if (options?.errors?.invalidFormat) {
          return makeInvalidFormatError(input);
        }
        return { success: false, error: hostResult.error };
      }
      return makeMissingPortError(input);
    }

    const portResult = portParser.parse(portPart);
    if (!hostResult.success) {
      if (options?.errors?.invalidFormat) {
        return makeInvalidFormatError(input);
      }
      return { success: false, error: hostResult.error };
    }
    if (portResult.success) {
      return {
        success: true,
        value: { host: hostResult.value, port: portResult.value },
      };
    }
    if (options?.errors?.invalidFormat) return makeInvalidFormatError(input);
    if (/^[0-9]+$/.test(portPart)) {
      return { success: false, error: portResult.error };
    }
    return makeInvalidFormatError(input);
  }

  function isSocketAddressValue(value: unknown): value is SocketAddressValue {
    return typeof value === "object" && value !== null &&
      "host" in value && typeof value.host === "string" &&
      "port" in value && typeof value.port === "number";
  }

  function formatSocketAddressValue(value: SocketAddressValue): string {
    const ipv6Host = parseAndNormalizeIpv6(value.host);
    if (separator === ":" && ipv6Host !== null) {
      return `[${ipv6Host}]${separator}${value.port}`;
    }
    return `${value.host}${separator}${value.port}`;
  }

  const parser: ValueParser<"sync", SocketAddressValue> = {
    mode: "sync",
    metavar,
    get placeholder() {
      return {
        host: hostType === "ip"
          ? hostVersion === 6 ? ipv6Parser.placeholder : ipv4Parser.placeholder
          : hostnameParser.placeholder,
        port: defaultPort ?? portParser.placeholder,
      };
    },
    parse(input: string): ValueParserResult<SocketAddressValue> {
      const trimmed = input.trim();
      // Left-trimmed input preserves trailing content so that whitespace
      // separators (e.g., " ", "\t") at the end are not silently removed
      // before the separator search.
      const searchInput = input.trimStart();
      const canOmitPort = defaultPort !== undefined && !requirePort;

      if (separator === ":") {
        const bracketedResult = parseBracketedHost(
          input,
          trimmed,
          canOmitPort,
        );
        if (bracketedResult !== undefined) return bracketedResult;

        if (looksLikeBareIpv6(trimmed)) {
          const hostResult = parseHost(trimmed);
          if (hostResult.success) {
            if (canOmitPort) {
              return {
                success: true,
                value: { host: hostResult.value, port: defaultPort! },
              };
            }
            return makeMissingPortError(input);
          }
          if (options?.errors?.invalidFormat) {
            return makeInvalidFormatError(input);
          }
          return { success: false, error: hostResult.error };
        }
      }

      // Step 1: Try splitting at separator occurrences, rightmost first.
      // Accept the first split where both host and port are valid.
      // This must be tried before host-only to preserve the round-trip
      // property parse(format(v)) == v: format() appends separator+port,
      // and since the separator cannot contain digits, lastIndexOf()
      // always finds that boundary correctly.
      let firstHostError:
        | { readonly hostPart: string; readonly error: Message }
        | undefined;
      // Set to the port parser's error when a split produces a non-empty
      // host but an all-digit port part that fails validation (e.g., out
      // of range).  This prevents the host-only fallback from silently
      // masking port typos—even when the host part itself is invalid
      // (e.g., "db--70000" where host "db-" has a trailing hyphen).
      let validHostInvalidPortError: Message | undefined;
      // The validated host from the rightmost split with an empty port
      // part (trailing separator).  Used as a fallback when the whole
      // input is not a valid hostname by itself (e.g., "localhost:" where
      // the colon makes it invalid as a hostname).
      let trailingSepHost: string | undefined;
      // The failed host-validation result from the rightmost trailing
      // separator.  Used to propagate specific host errors (e.g.,
      // IP-shaped) when the trailing separator host is invalid.
      let trailingSepHostError:
        | { readonly hostPart: string; readonly error: Message }
        | undefined;
      // Whether any separator occurrence was found in the input at all.
      let anySeparatorFound = false;
      // True when a trailing separator was found in the region that
      // input.trim() would have removed (i.e., trailing whitespace).
      // When set, the host-only path must not take priority because the
      // trimmed input only appears to be a valid hostname—the trailing
      // separator was destroyed by trimming, not genuinely absent.
      let trailingSepInTrimmedRegion = false;
      let searchFrom = searchInput.length;
      while (searchFrom > 0) {
        const separatorIndex = searchInput.lastIndexOf(
          separator,
          searchFrom - 1,
        );
        if (separatorIndex === -1) break;
        anySeparatorFound = true;

        const hostPart = searchInput.substring(0, separatorIndex).trim();
        const portPart = searchInput.substring(
          separatorIndex + separator.length,
        ).trim();

        if (portPart === "") {
          // Trailing separator—potential omitted port.  Record the
          // first (rightmost) result so it can be used as a fallback
          // when the whole input is not a valid hostname.
          if (
            trailingSepHost === undefined && trailingSepHostError === undefined
          ) {
            if (separatorIndex + separator.length > trimmed.length) {
              trailingSepInTrimmedRegion = true;
            }
            const hostResult = parseHost(hostPart);
            if (hostResult.success) {
              trailingSepHost = hostResult.value;
            } else {
              trailingSepHostError = { hostPart, error: hostResult.error };
            }
          }
        } else {
          const portResult = portParser.parse(portPart);
          if (portResult.success) {
            const hostResult = parseHost(hostPart);
            if (hostResult.success) {
              return {
                success: true,
                value: {
                  host: hostResult.value,
                  port: portResult.value,
                },
              };
            }
            // Record the first host error, but let IP-shaped errors
            // replace non-IP ones so that specific IP diagnostics are
            // not shadowed by earlier generic hostname failures.
            if (
              firstHostError === undefined ||
              ((looksLikeIpv4(hostPart) ||
                looksLikeAltIpv4Literal(hostPart)) &&
                !looksLikeIpv4(firstHostError.hostPart) &&
                !looksLikeAltIpv4Literal(firstHostError.hostPart))
            ) {
              firstHostError = { hostPart, error: hostResult.error };
            }
          } else if (
            validHostInvalidPortError === undefined &&
            hostPart !== "" &&
            /^[0-9]+$/.test(portPart)
          ) {
            // Port part is all digits but failed validation (e.g., out
            // of range).  For IP-shaped hosts, validate the host first
            // so that specific IP errors (e.g., "private IP") are not
            // masked by the generic numeric-port rejection.  For
            // non-IP hosts, a non-empty hostPart is enough signal that
            // the user intended a split (even if the host itself is
            // invalid, like "db-" with a trailing hyphen).
            if (
              looksLikeIpv4(hostPart) ||
              looksLikeAltIpv4Literal(hostPart)
            ) {
              const hostResult = parseHost(hostPart);
              if (!hostResult.success) {
                if (
                  firstHostError === undefined ||
                  (!looksLikeIpv4(firstHostError.hostPart) &&
                    !looksLikeAltIpv4Literal(firstHostError.hostPart))
                ) {
                  firstHostError = { hostPart, error: hostResult.error };
                }
              } else {
                validHostInvalidPortError = portResult.error;
              }
            } else {
              // Always record the port error to prevent the host-only
              // fallback from silently masking port typos.  Also
              // validate the host so that host policy errors (e.g.,
              // allowLocalhost: false) can take priority later.
              validHostInvalidPortError = portResult.error;
              const hostResult = parseHost(hostPart);
              if (!hostResult.success && firstHostError === undefined) {
                firstHostError = { hostPart, error: hostResult.error };
              }
            }
          } else if (
            (firstHostError === undefined ||
              (!looksLikeIpv4(firstHostError.hostPart) &&
                !looksLikeAltIpv4Literal(firstHostError.hostPart))) &&
            (looksLikeIpv4(hostPart) ||
              looksLikeAltIpv4Literal(hostPart))
          ) {
            // Port is invalid and non-numeric (e.g., "abc").  If the
            // host part is IP-shaped, validate it anyway so that
            // specific IP errors (allowPrivate, allowLoopback, etc.)
            // are not lost.  Without this, "192.168.1.1:abc" with
            // allowPrivate: false would give a generic format error
            // instead of the specific "private IP" error.
            const hostResult = parseHost(hostPart);
            if (!hostResult.success) {
              firstHostError = { hostPart, error: hostResult.error };
            }
          }
        }

        searchFrom = separatorIndex;
      }

      // Step 2: No valid split found.

      // If a split had a valid host but a recognizably-invalid numeric
      // port, reject before trying host-only.
      if (validHostInvalidPortError !== undefined) {
        const errorMsg = options?.errors?.invalidFormat;
        if (errorMsg) {
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg;
          return { success: false, error: msg };
        }
        // When both host and port failed on the same split, prefer the
        // host error (more fundamental) over the port error, unless the
        // hostPart is a degenerate separator artifact.  For non-host-
        // compatible separators (e.g., ":"), any hostPart containing
        // the separator is an artifact from a multi-separator input
        // like "foo:80:70000".  For host-compatible separators (e.g.,
        // "-"), only pure-separator hostParts are degenerate—a
        // hostPart like "_foo-bar" legitimately contains the separator
        // and its host error should propagate.
        if (firstHostError !== undefined && firstHostError.hostPart !== "") {
          const portSplitHostIsDegenerate = separatorIsHostChar
            ? firstHostError.hostPart.replaceAll(separator, "") === ""
            : firstHostError.hostPart.includes(separator);
          if (portSplitHostIsDegenerate) {
            return {
              success: false,
              error: message`Expected a socket address in format ${
                text(formatExample)
              }, but got ${input}.`,
            };
          }
          if (!disambiguationParser.parse(trimmed).success) {
            return { success: false, error: firstHostError.error };
          }
        }
        // When the whole input is a valid hostname under the
        // disambiguation parser, the split is ambiguous and the port
        // error would be misleading.  Return the generic format error.
        if (disambiguationParser.parse(trimmed).success) {
          return {
            success: false,
            error: message`Expected a socket address in format ${
              text(formatExample)
            }, but got ${input}.`,
          };
        }
        return { success: false, error: validHostInvalidPortError };
      }

      // If a split found a valid port but an IP-shaped invalid host,
      // reject before trying host-only.  This prevents inputs like
      // "192.168.0.1-80" from being silently accepted as hostnames
      // when the IP is restricted.  Non-IP host errors are deferred
      // until after host-only so that generic syntax failures (like
      // "db-" with a trailing hyphen) don't block valid hostnames
      // (like "db-to80").
      if (firstHostError !== undefined) {
        if (
          looksLikeIpv4(firstHostError.hostPart) ||
          looksLikeAltIpv4Literal(firstHostError.hostPart)
        ) {
          const errorMsg = options?.errors?.invalidFormat;
          if (errorMsg) {
            const msg = typeof errorMsg === "function"
              ? errorMsg(input)
              : errorMsg;
            return { success: false, error: msg };
          }
          return { success: false, error: firstHostError.error };
        }
      }

      // Try host-only interpretation.  When port can be omitted, a
      // valid hostname is accepted with the default port.  When port
      // is required, the result is still needed to gate the trailing-
      // separator fallback: if the whole input is a valid hostname
      // (e.g., "toronto" with separator "to"), the trailing separator
      // should NOT fire—the "to" is part of the hostname, not a
      // separator with an omitted port.
      let hostOnlyResult: ValueParserResult<string> | undefined;
      if (
        !requirePort ||
        trailingSepHost !== undefined ||
        trailingSepHostError !== undefined
      ) {
        hostOnlyResult = parseHost(trimmed);
        if (
          canOmitPort && hostOnlyResult.success && !trailingSepInTrimmedRegion
        ) {
          return {
            success: true,
            value: { host: hostOnlyResult.value, port: defaultPort! },
          };
        }
      }

      // If the whole input is not a valid hostname (or the trailing
      // separator was in the whitespace-trimmed region) but a trailing
      // separator produced a valid host, the user explicitly typed the
      // separator but left the port empty (e.g., "localhost:").  This is
      // always a missing-port error—even when defaultPort is set—
      // because the explicit separator signals intent to specify a port.
      // Host-only input *without* a separator (e.g., "localhost") is
      // handled above and correctly uses defaultPort.
      if (
        trailingSepHost !== undefined &&
        hostOnlyResult !== undefined &&
        (!hostOnlyResult.success || trailingSepInTrimmedRegion)
      ) {
        const errorMsg = options?.errors?.missingPort;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input)
          : errorMsg ??
            message`Port number is required but was not specified.`;
        return { success: false, error: msg };
      }

      // If a trailing separator produced an invalid host, propagate
      // the specific host error (e.g., IP-shaped) instead of falling
      // through to the generic format error.
      if (
        trailingSepHostError !== undefined &&
        hostOnlyResult !== undefined &&
        (!hostOnlyResult.success || trailingSepInTrimmedRegion)
      ) {
        const errorMsg = options?.errors?.invalidFormat;
        if (errorMsg) {
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg;
          return { success: false, error: msg };
        }
        const trailingHostIsDegenerate = separatorIsHostChar
          ? trailingSepHostError.hostPart.replaceAll(separator, "") === ""
          : trailingSepHostError.hostPart.includes(separator);
        if (
          trailingSepHostError.hostPart !== "" &&
          !trailingHostIsDegenerate &&
          !disambiguationParser.parse(trimmed).success
        ) {
          return { success: false, error: trailingSepHostError.error };
        }
      }

      // When port is not required but no default exists, and the whole
      // input is a valid hostname, report missingPort (the hostname is
      // valid, the parser just needs a port that wasn't provided).
      if (
        !canOmitPort &&
        !requirePort &&
        hostOnlyResult !== undefined &&
        hostOnlyResult.success
      ) {
        const errorMsg = options?.errors?.missingPort;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input)
          : errorMsg ??
            message`Port number is required but was not specified.`;
        return { success: false, error: msg };
      }

      // When no separator was found at all, the user simply provided
      // a hostname without any port indication → missingPort.
      if (!canOmitPort && !anySeparatorFound) {
        hostOnlyResult = hostOnlyResult ?? parseHost(trimmed);
        if (hostOnlyResult.success) {
          const errorMsg = options?.errors?.missingPort;
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg ??
              message`Port number is required but was not specified.`;
          return { success: false, error: msg };
        }
      }

      // If a split had a valid port but a non-IP invalid host (e.g.,
      // generic syntax errors like a trailing hyphen), propagate the
      // custom invalidFormat now.  IP-shaped host errors were already
      // handled before the host-only path above.
      if (firstHostError !== undefined) {
        const errorMsg = options?.errors?.invalidFormat;
        if (errorMsg) {
          const msg = typeof errorMsg === "function"
            ? errorMsg(input)
            : errorMsg;
          return { success: false, error: msg };
        }
        // Only surface the split-host error when the hostPart is
        // non-empty, not a degenerate separator artifact, and the
        // whole input is not a valid hostname (which would make the
        // split ambiguous).
        //
        // The degenerate check depends on whether the separator can
        // appear inside hostnames: for host-compatible separators
        // (e.g., "-"), only pure-separator hostParts like "-" are
        // degenerate; for non-host-compatible separators (e.g., ":"),
        // any hostPart containing the separator is an artifact from
        // a multi-separator input like "foo:80:90".
        const hostPartIsDegenerate = separatorIsHostChar
          ? firstHostError.hostPart.replaceAll(separator, "") === ""
          : firstHostError.hostPart.includes(separator);
        if (
          firstHostError.hostPart !== "" &&
          !hostPartIsDegenerate &&
          !disambiguationParser.parse(trimmed).success
        ) {
          return { success: false, error: firstHostError.error };
        }
      }

      // Step 3: Neither valid split nor valid host-only.
      const errorMsg = options?.errors?.invalidFormat;
      if (errorMsg) {
        const msg = typeof errorMsg === "function" ? errorMsg(input) : errorMsg;
        return { success: false, error: msg };
      }

      if (hostOnlyResult !== undefined && !hostOnlyResult.success) {
        if (
          looksLikeIpv4(trimmed) || looksLikeAltIpv4Literal(trimmed)
        ) {
          return { success: false, error: hostOnlyResult.error };
        }
      }

      return {
        success: false,
        error: message`Expected a socket address in format ${
          text(formatExample)
        }, but got ${input}.`,
      };
    },
    format(value: SocketAddressValue): string {
      return formatSocketAddressValue(value);
    },
    normalize(value: SocketAddressValue): SocketAddressValue {
      if (!isSocketAddressValue(value)) return value;
      try {
        const result = parser.parse(formatSocketAddressValue(value));
        return result.success ? result.value : value;
      } catch {
        return value;
      }
    },
  };
  return parser;
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
   * The metavariable name for this parser.  If not specified, it is derived
   * from the {@link separator} (e.g., `"PORT-PORT"` for `"-"`).
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
   * The metavariable name for this parser.  If not specified, it is derived
   * from the {@link separator} (e.g., `"PORT-PORT"` for `"-"`).
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
 * @throws {TypeError} If `options.type` is provided but is neither `"number"`
 *   nor `"bigint"`.
 * @throws {TypeError} If `separator` is an empty string.
 * @throws {TypeError} If `separator` contains digit characters, since digits
 *   in the separator would cause ambiguous splitting of numeric port input.
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
  checkBooleanOption(options, "disallowWellKnown");
  checkBooleanOption(options, "allowSingle");
  if (
    options?.type !== undefined &&
    options.type !== "number" &&
    options.type !== "bigint"
  ) {
    throw new TypeError(
      `Expected type to be "number" or "bigint", but got: ${
        String(options.type)
      }.`,
    );
  }
  const separator = options?.separator ?? "-";
  if (separator === "") {
    throw new TypeError("Expected separator to not be empty.");
  }
  if (/\p{Nd}/u.test(separator)) {
    throw new TypeError(
      `Expected separator to not contain digits, but got: ${
        JSON.stringify(separator)
      }.`,
    );
  }
  const metavar = options?.metavar ?? `PORT${separator}PORT`;
  ensureNonEmptyString(metavar);
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
    mode: "sync",
    metavar,
    get placeholder(): PortRangeValueNumber | PortRangeValueBigInt {
      return (isBigInt
        ? {
          start: portParser.placeholder as bigint,
          end: portParser.placeholder as bigint,
        }
        : {
          start: portParser.placeholder as number,
          end: portParser.placeholder as number,
        }) as PortRangeValueNumber | PortRangeValueBigInt;
    },
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
 * - Colon-separated: `00:1A:2B:3C:4D:5E` (1–2 hex digits per octet)
 * - Hyphen-separated: `00-1A-2B-3C-4D-5E` (1–2 hex digits per octet)
 * - Dot-separated (Cisco): `001A.2B3C.4D5E` (exactly 4 hex digits per group)
 * - No separator: `001A2B3C4D5E` (exactly 12 hex digits)
 *
 * Colon-separated and hyphen-separated formats accept single-digit octets
 * (e.g., `0:1:2:3:4:5`), which are automatically zero-padded to canonical
 * two-digit form (e.g., `00:01:02:03:04:05`).
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
  checkEnumOption(options, "separator", [":", "-", ".", "none", "any"]);
  checkEnumOption(options, "outputSeparator", [":", "-", ".", "none"]);
  checkEnumOption(options, "case", ["preserve", "upper", "lower"]);
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

  // Shared formatting logic: applies case conversion and joins octets with
  // the given separator.  Used by parse() to guarantee consistent
  // normalization.
  function joinOctets(
    octets: readonly string[],
    sep: ":" | "-" | "." | "none",
  ): string {
    let formatted: readonly string[] = octets;
    if (caseOption === "upper") {
      formatted = octets.map((o) => o.toUpperCase());
    } else if (caseOption === "lower") {
      formatted = octets.map((o) => o.toLowerCase());
    }
    if (sep === ".") {
      return [
        formatted[0] + formatted[1],
        formatted[2] + formatted[3],
        formatted[4] + formatted[5],
      ].join(".");
    }
    if (sep === "none") return formatted.join("");
    return formatted.join(sep);
  }

  let macParsing = false;
  function normalizeMacValue(value: string, fallback: string): string {
    if (macParsing) return value;
    macParsing = true;
    try {
      const result = parserObj.parse(value);
      return result.success ? result.value : fallback;
    } catch {
      return fallback;
    } finally {
      macParsing = false;
    }
  }

  const parserObj: ValueParser<"sync", string> = {
    mode: "sync",
    metavar,
    get placeholder() {
      const octets = ["00", "00", "00", "00", "00", "00"];
      const sep = outputSeparator ?? (separator === "any" ? ":" : separator);
      if (sep === ".") {
        return `${octets[0]}${octets[1]}.${octets[2]}${octets[3]}.${octets[4]}${
          octets[5]
        }`;
      }
      if (sep === "none") return octets.join("");
      return octets.join(sep);
    },
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

      // Zero-pad each octet to canonical two-digit form
      octets = octets.map((o) => o.padStart(2, "0"));

      // Format output based on outputSeparator (or input separator if not specified)
      const finalSeparator = outputSeparator ?? inputSeparator ?? ":";
      return { success: true, value: joinOctets(octets, finalSeparator) };
    },
    format(value: string): string {
      if (typeof value !== "string") return metavar;
      return normalizeMacValue(value, value);
    },
    normalize(value: string): string {
      if (typeof value !== "string") return value;
      return normalizeMacValue(value, value);
    },
  };
  return parserObj;
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
  readonly allowedTlds?: readonly string[];

  /**
   * Minimum number of domain labels (parts separated by dots).
   *
   * @default 2
   */
  readonly minLabels?: number;

  /**
   * Maximum domain length in characters.
   * @default 253
   * @since 1.0.0
   */
  readonly maxLength?: number;

  /**
   * A custom placeholder value used during deferred prompt resolution.
   * Override when `allowedTlds`, `minLabels`, or other constraints
   * reject the default `"example.com"`.
   *
   * @since 1.0.0
   */
  readonly placeholder?: string;

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
      | ((tld: string, allowedTlds: readonly string[]) => Message);

    /**
     * Custom error message when domain has too few labels.
     * Can be a static message or a function that receives the domain
     * and minimum labels.
     */
    tooFewLabels?: Message | ((domain: string, minLabels: number) => Message);

    /**
     * Custom error message when domain is too long.
     * Can be a static message or a function that receives the domain
     * and max length.
     * @since 1.0.0
     */
    tooLong?: Message | ((domain: string, maxLength: number) => Message);
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
 * @throws {RangeError} If `maxLength` is not a positive integer.
 * @throws {RangeError} If `minLabels` is not a positive integer.
 * @throws {TypeError} If `allowSubdomains` or `lowercase` is not a boolean.
 * @throws {TypeError} If any `allowedTlds` entry is not a string, is empty,
 *   contains dots, has leading/trailing whitespace, or is not a valid DNS
 *   label.
 * @throws {TypeError} If `allowSubdomains` is `false` and `minLabels` is
 *   greater than 2, since non-subdomain domains have exactly 2 labels.
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
 * option("--domain", domain({ allowedTlds: ["com", "org", "net"] }))
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
  checkBooleanOption(options, "allowSubdomains");
  checkBooleanOption(options, "lowercase");
  const allowSubdomains = options?.allowSubdomains ?? true;
  const allowedTlds = options?.allowedTlds != null
    ? Object.freeze([...options.allowedTlds])
    : undefined;
  // Domain label regex: 1-63 alphanumeric characters and hyphens,
  // cannot start or end with hyphen
  const labelRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  if (allowedTlds !== undefined) {
    if (allowedTlds.length === 0) {
      throw new TypeError("allowedTlds must not be empty.");
    }
    for (const [i, tld] of allowedTlds.entries()) {
      if (typeof tld !== "string") {
        const actualType = Array.isArray(tld) ? "array" : typeof tld;
        throw new TypeError(
          `allowedTlds[${i}] must be a string, but got ${actualType}.`,
        );
      }
      if (tld.length === 0) {
        throw new TypeError(
          `allowedTlds[${i}] must not be an empty string.`,
        );
      }
      if (tld.includes(".")) {
        throw new TypeError(
          `allowedTlds[${i}] must not contain dots: ${JSON.stringify(tld)}.`,
        );
      }
      if (tld !== tld.trim()) {
        throw new TypeError(
          `allowedTlds[${i}] must not have leading or trailing whitespace: ${
            JSON.stringify(tld)
          }.`,
        );
      }
      if (!labelRegex.test(tld)) {
        throw new TypeError(
          `allowedTlds[${i}] is not a valid DNS label: ${JSON.stringify(tld)}.`,
        );
      }
    }
  }
  const allowedTldsLower = allowedTlds != null
    ? Object.freeze(allowedTlds.map((t) => t.toLowerCase()))
    : undefined;
  const minLabels = options?.minLabels ?? 2;
  const maxLength = options?.maxLength ?? 253;
  const lowercase = options?.lowercase ?? false;
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError(
      "maxLength must be an integer greater than or equal to 1.",
    );
  }
  if (!Number.isInteger(minLabels) || minLabels < 1) {
    throw new RangeError(
      "minLabels must be an integer greater than or equal to 1.",
    );
  }
  if (!allowSubdomains && minLabels > 2) {
    throw new TypeError(
      "allowSubdomains: false is incompatible with minLabels > 2, " +
        "as non-subdomain domains have exactly 2 labels.",
    );
  }
  const invalidDomain = options?.errors?.invalidDomain;
  const tooLong = options?.errors?.tooLong;
  const tooFewLabels = options?.errors?.tooFewLabels;
  const subdomainsNotAllowed = options?.errors?.subdomainsNotAllowed;
  const tldNotAllowed = options?.errors?.tldNotAllowed;

  const domainParserObj: ValueParser<"sync", string> = {
    mode: "sync",
    metavar,
    placeholder: options?.placeholder ??
      `example.${allowedTldsLower?.[0] ?? "com"}`,
    parse(input: string): ValueParserResult<string> {
      // Check length constraint first
      if (input.length > maxLength) {
        const errorMsg = tooLong;
        const msg = typeof errorMsg === "function"
          ? errorMsg(input, maxLength)
          : errorMsg ??
            message`Domain ${input} is too long (maximum ${
              text(maxLength.toString())
            } characters).`;
        return { success: false, error: msg };
      }

      // Basic validation
      if (input.length === 0 || input.startsWith(".") || input.endsWith(".")) {
        const errorMsg = invalidDomain;
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
        const errorMsg = invalidDomain;
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
          const errorMsg = invalidDomain;
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

      // Reject dotted all-numeric domains (e.g., IPv4 addresses like
      // 192.168.0.1).  Single-label numeric names are allowed so that
      // domain({ minLabels: 1 }) can still accept values like "123".
      if (labels.length >= 2 && labels.every((l) => /^[0-9]+$/.test(l))) {
        const errorMsg = invalidDomain;
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

      // Check minimum labels
      if (labels.length < minLabels) {
        const errorMsg = tooFewLabels;
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
        const errorMsg = subdomainsNotAllowed;
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
      if (allowedTlds !== undefined && allowedTldsLower !== undefined) {
        const tld = labels[labels.length - 1];
        const tldLower = tld.toLowerCase();

        if (!allowedTldsLower.includes(tldLower)) {
          const errorMsg = tldNotAllowed;
          if (typeof errorMsg === "function") {
            return { success: false, error: errorMsg(tld, allowedTlds) };
          }
          const msg = errorMsg ?? [
            { type: "text", text: "Top-level domain " },
            { type: "value", value: tld },
            { type: "text", text: " is not allowed. Allowed TLDs: " },
            ...valueSet(allowedTlds, { fallback: "", locale: "en-US" }),
            { type: "text", text: "." },
          ] as Message;
          return { success: false, error: msg };
        }
      }

      // Apply case conversion if needed
      const result = lowercase ? input.toLowerCase() : input;

      return { success: true, value: result };
    },
    format(value: string): string {
      if (typeof value !== "string") return metavar;
      if (!lowercase) return value;
      // Only lowercase values that look like domains (enough labels).
      // Sentinel strings like "LOCAL" are returned unchanged.
      return value.split(".").length >= minLabels ? value.toLowerCase() : value;
    },
  };
  // Both format and normalize use the full parse() pipeline so that
  // values parse() would reject (e.g., "A..B", disallowed TLDs) are
  // returned unchanged, keeping help text consistent with runtime.
  if (lowercase) {
    const domParser = domainParserObj;
    let domParsing = false;
    Object.defineProperty(domainParserObj, "format", {
      value(v: string): string {
        if (typeof v !== "string") return metavar;
        if (domParsing) return v;
        domParsing = true;
        try {
          const result = domParser.parse(v);
          return result.success ? result.value : v;
        } catch {
          return v;
        } finally {
          domParsing = false;
        }
      },
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(domainParserObj, "normalize", {
      value(v: string): string {
        if (typeof v !== "string") return v;
        if (domParsing) return v;
        domParsing = true;
        try {
          const result = domParser.parse(v);
          return result.success ? result.value : v;
        } catch {
          return v;
        } finally {
          domParsing = false;
        }
      },
      configurable: true,
      enumerable: true,
    });
  }
  return domainParserObj;
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

  const ipv6ParserObj: ValueParser<"sync", string> = {
    mode: "sync",
    metavar,
    placeholder: allowZero ? "::" : allowLoopback ? "::1" : "2001:db8::1",
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
    format(value: string): string {
      if (typeof value !== "string") return metavar;
      return parseAndNormalizeIpv6(value) ?? value;
    },
  };
  // Both format and normalize use parse() for validation, keeping
  // help text consistent with runtime defaults.
  let ipv6Parsing = false;
  Object.defineProperty(ipv6ParserObj, "format", {
    value(v: string): string {
      if (typeof v !== "string") return metavar;
      if (ipv6Parsing) return v;
      ipv6Parsing = true;
      try {
        const result = ipv6ParserObj.parse(v);
        return result.success ? result.value : v;
      } catch {
        return v;
      } finally {
        ipv6Parsing = false;
      }
    },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(ipv6ParserObj, "normalize", {
    value(v: string): string {
      if (typeof v !== "string") return v;
      if (ipv6Parsing) return v;
      ipv6Parsing = true;
      try {
        const result = ipv6ParserObj.parse(v);
        return result.success ? result.value : v;
      } catch {
        return v;
      } finally {
        ipv6Parsing = false;
      }
    },
    configurable: true,
    enumerable: true,
  });
  return ipv6ParserObj;
}

/**
 * Parses a dotted-decimal IPv4 string into four validated octets.
 * Returns null if the input is not a valid strict IPv4 address
 * (exactly four decimal octets 0–255, no leading zeros, no whitespace,
 * no non-decimal characters).
 */
function parseIpv4Octets(
  input: string,
): readonly [number, number, number, number] | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  const octets: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const part = parts[i];
    if (part.length === 0) return null;
    if (part.trim() !== part) return null;
    if (part.length > 1 && part[0] === "0") return null;
    if (!/^[0-9]+$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    octets[i] = octet;
  }
  return octets;
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

    // Parse the IPv4 part with strict validation
    const octets = parseIpv4Octets(ipv4Part);
    if (octets === null) return null;

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
    if (totalGroups >= 8) return null;

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
    if (totalGroups >= 8) return null;

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
 * Extracts IPv4 octets from an IPv4-mapped IPv6 address.
 * Returns null if the address is not an IPv4-mapped address
 * (i.e., not in the `::ffff:x.x.x.x` range).
 */
function extractIpv4FromMapped(
  normalizedIpv6: string,
): readonly number[] | null {
  const groups = expandIpv6(normalizedIpv6);
  if (groups === null) return null;

  // Check for ::ffff: prefix (groups 0-4 are 0, group 5 is ffff)
  for (let i = 0; i < 5; i++) {
    if (parseInt(groups[i], 16) !== 0) return null;
  }
  if (parseInt(groups[5], 16) !== 0xffff) return null;

  // Extract octets from groups 6 and 7
  const high = parseInt(groups[6], 16);
  const low = parseInt(groups[7], 16);
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ];
}

/**
 * Checks IPv4 restrictions against octets extracted from an IPv4-mapped
 * IPv6 address.  The check uses the base address, consistent with how
 * the `ipv4()` parser validates the address part of a regular IPv4 CIDR.
 *
 * Returns an error result if a restriction is violated, or null if all
 * checks pass.
 */
function checkIpv4MappedRestrictions(
  octets: readonly number[],
  normalizedIpv6: string,
  ipv4Opts: Omit<Ipv4Options, "metavar" | "errors"> | undefined,
  errors: {
    readonly privateNotAllowed?: Message | ((ip: string) => Message);
    readonly loopbackNotAllowed?: Message | ((ip: string) => Message);
    readonly linkLocalNotAllowed?: Message | ((ip: string) => Message);
    readonly multicastNotAllowed?: Message | ((ip: string) => Message);
    readonly broadcastNotAllowed?: Message | ((ip: string) => Message);
    readonly zeroNotAllowed?: Message | ((ip: string) => Message);
  } | undefined,
): { readonly success: false; readonly error: Message } | null {
  const allowPrivate = ipv4Opts?.allowPrivate ?? true;
  const allowLoopback = ipv4Opts?.allowLoopback ?? true;
  const allowLinkLocal = ipv4Opts?.allowLinkLocal ?? true;
  const allowMulticast = ipv4Opts?.allowMulticast ?? true;
  const allowBroadcast = ipv4Opts?.allowBroadcast ?? true;
  const allowZero = ipv4Opts?.allowZero ?? true;

  if (!allowPrivate && isPrivateIp(octets)) {
    const errorMsg = errors?.privateNotAllowed;
    const msg = typeof errorMsg === "function"
      ? errorMsg(normalizedIpv6)
      : errorMsg ?? message`${normalizedIpv6} is a private IP address.`;
    return { success: false, error: msg };
  }

  if (!allowLoopback && isLoopbackIp(octets)) {
    const errorMsg = errors?.loopbackNotAllowed;
    const msg = typeof errorMsg === "function"
      ? errorMsg(normalizedIpv6)
      : errorMsg ?? message`${normalizedIpv6} is a loopback address.`;
    return { success: false, error: msg };
  }

  if (!allowLinkLocal && isLinkLocalIp(octets)) {
    const errorMsg = errors?.linkLocalNotAllowed;
    const msg = typeof errorMsg === "function"
      ? errorMsg(normalizedIpv6)
      : errorMsg ?? message`${normalizedIpv6} is a link-local address.`;
    return { success: false, error: msg };
  }

  if (!allowMulticast && isMulticastIp(octets)) {
    const errorMsg = errors?.multicastNotAllowed;
    const msg = typeof errorMsg === "function"
      ? errorMsg(normalizedIpv6)
      : errorMsg ?? message`${normalizedIpv6} is a multicast address.`;
    return { success: false, error: msg };
  }

  if (!allowBroadcast && isBroadcastIp(octets)) {
    const errorMsg = errors?.broadcastNotAllowed;
    const msg = typeof errorMsg === "function"
      ? errorMsg(normalizedIpv6)
      : errorMsg ?? message`${normalizedIpv6} is the broadcast address.`;
    return { success: false, error: msg };
  }

  if (!allowZero && isZeroIp(octets)) {
    const errorMsg = errors?.zeroNotAllowed;
    const msg = typeof errorMsg === "function"
      ? errorMsg(normalizedIpv6)
      : errorMsg ?? message`${normalizedIpv6} is the zero address.`;
    return { success: false, error: msg };
  }

  return null;
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

  // Snapshot IPv4 restriction config for mapped IPv6 checking,
  // consistent with how ipv4Parser snapshots at construction time.
  const mappedIpv4Opts = version === "both"
    ? {
      allowPrivate: options?.ipv4?.allowPrivate,
      allowLoopback: options?.ipv4?.allowLoopback,
      allowLinkLocal: options?.ipv4?.allowLinkLocal,
      allowMulticast: options?.ipv4?.allowMulticast,
      allowBroadcast: options?.ipv4?.allowBroadcast,
      allowZero: options?.ipv4?.allowZero,
    }
    : undefined;
  const mappedIpv4Errors = version === "both"
    ? {
      privateNotAllowed: errors?.privateNotAllowed,
      loopbackNotAllowed: errors?.loopbackNotAllowed,
      linkLocalNotAllowed: errors?.linkLocalNotAllowed,
      multicastNotAllowed: errors?.multicastNotAllowed,
      broadcastNotAllowed: errors?.broadcastNotAllowed,
      zeroNotAllowed: errors?.zeroNotAllowed,
    }
    : undefined;

  const ipParserObj: ValueParser<"sync", string> = {
    mode: "sync",
    metavar,
    placeholder: version === 6
      ? ipv6Parser!.placeholder
      : ipv4Parser!.placeholder,
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
          // Check IPv4 restrictions for IPv4-mapped IPv6 addresses
          if (version === "both") {
            const mappedOctets = extractIpv4FromMapped(result.value);
            if (mappedOctets !== null) {
              const restrictionError = checkIpv4MappedRestrictions(
                mappedOctets,
                result.value,
                mappedIpv4Opts,
                mappedIpv4Errors,
              );
              if (restrictionError !== null) return restrictionError;
            }
          }
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
    format(value: string): string {
      if (typeof value !== "string") return metavar;
      // IPv4 addresses are already canonical; normalize IPv6 addresses
      return parseAndNormalizeIpv6(value) ?? value;
    },
  };
  let ipParsing = false;
  Object.defineProperty(ipParserObj, "format", {
    value(v: string): string {
      if (typeof v !== "string") return metavar;
      if (ipParsing) return v;
      ipParsing = true;
      try {
        const result = ipParserObj.parse(v);
        return result.success ? result.value : v;
      } catch {
        return v;
      } finally {
        ipParsing = false;
      }
    },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(ipParserObj, "normalize", {
    value(v: string): string {
      if (typeof v !== "string") return v;
      if (ipParsing) return v;
      ipParsing = true;
      try {
        const result = ipParserObj.parse(v);
        return result.success ? result.value : v;
      } catch {
        return v;
      } finally {
        ipParsing = false;
      }
    },
    configurable: true,
    enumerable: true,
  });
  return ipParserObj;
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

    /**
     * Custom error message when a private IPv4 address is used but disallowed.
     * Can be a static message or a function that receives the IP.
     * @since 1.0.0
     */
    privateNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when a loopback address is used but disallowed.
     * Can be a static message or a function that receives the IP.
     * @since 1.0.0
     */
    loopbackNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when a link-local address is used but disallowed.
     * Can be a static message or a function that receives the IP.
     * @since 1.0.0
     */
    linkLocalNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when a multicast address is used but disallowed.
     * Can be a static message or a function that receives the IP.
     * @since 1.0.0
     */
    multicastNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when the broadcast address is used but disallowed
     * (IPv4 only).
     * Can be a static message or a function that receives the IP.
     * @since 1.0.0
     */
    broadcastNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when the zero address is used but disallowed.
     * Can be a static message or a function that receives the IP.
     * @since 1.0.0
     */
    zeroNotAllowed?: Message | ((ip: string) => Message);

    /**
     * Custom error message when a unique local address is used but disallowed
     * (IPv6 only).
     * Can be a static message or a function that receives the IP.
     * @since 1.0.0
     */
    uniqueLocalNotAllowed?: Message | ((ip: string) => Message);
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
  if (options?.minPrefix != null && !Number.isFinite(options.minPrefix)) {
    throw new RangeError(
      `Expected minPrefix to be a finite number, but got: ${options.minPrefix}`,
    );
  }
  if (options?.maxPrefix != null && !Number.isFinite(options.maxPrefix)) {
    throw new RangeError(
      `Expected maxPrefix to be a finite number, but got: ${options.maxPrefix}`,
    );
  }
  if (
    options?.minPrefix != null && options?.maxPrefix != null &&
    options.minPrefix > options.maxPrefix
  ) {
    throw new RangeError(
      `Expected minPrefix to be less than or equal to maxPrefix, but got ` +
        `minPrefix: ${options.minPrefix} and maxPrefix: ${options.maxPrefix}.`,
    );
  }
  const version = options?.version ?? "both";
  const maxPrefixForVersion = version === 4 ? 32 : version === 6 ? 128 : 128;
  if (
    options?.minPrefix != null &&
    (options.minPrefix < 0 || options.minPrefix > maxPrefixForVersion)
  ) {
    throw new RangeError(
      `Expected minPrefix to be between 0 and ${maxPrefixForVersion} for IPv${
        version === "both" ? "4/6" : version
      }, but got minPrefix: ${options.minPrefix}.`,
    );
  }
  if (
    options?.maxPrefix != null &&
    (options.maxPrefix < 0 || options.maxPrefix > maxPrefixForVersion)
  ) {
    throw new RangeError(
      `Expected maxPrefix to be between 0 and ${maxPrefixForVersion} for IPv${
        version === "both" ? "4/6" : version
      }, but got maxPrefix: ${options.maxPrefix}.`,
    );
  }
  const minPrefix = options?.minPrefix;
  const maxPrefix = options?.maxPrefix;
  const errors = options?.errors;
  const metavar = options?.metavar ?? "CIDR";

  // Sentinel message passed as the invalidIpv4/invalidIpv6 error hook.
  // When ipv4()/ipv6() return a structural parse failure they return this
  // exact object, so we can distinguish generic failures from specific
  // restriction errors (private, loopback, etc.) via reference equality
  // instead of fragile text-content heuristics.
  const genericIpSentinel: Message = [];

  // Create IP parsers for address validation, forwarding restriction
  // error hooks from CidrOptions.errors to the nested parsers
  const ipv4Parser = (version === 4 || version === "both")
    ? ipv4({
      ...options?.ipv4,
      errors: {
        invalidIpv4: genericIpSentinel,
        privateNotAllowed: errors?.privateNotAllowed,
        loopbackNotAllowed: errors?.loopbackNotAllowed,
        linkLocalNotAllowed: errors?.linkLocalNotAllowed,
        multicastNotAllowed: errors?.multicastNotAllowed,
        broadcastNotAllowed: errors?.broadcastNotAllowed,
        zeroNotAllowed: errors?.zeroNotAllowed,
      },
    })
    : null;

  const ipv6Parser = (version === 6 || version === "both")
    ? ipv6({
      ...options?.ipv6,
      errors: {
        invalidIpv6: genericIpSentinel,
        loopbackNotAllowed: errors?.loopbackNotAllowed,
        linkLocalNotAllowed: errors?.linkLocalNotAllowed,
        multicastNotAllowed: errors?.multicastNotAllowed,
        zeroNotAllowed: errors?.zeroNotAllowed,
        uniqueLocalNotAllowed: errors?.uniqueLocalNotAllowed,
      },
    })
    : null;

  // Snapshot IPv4 restriction config for mapped IPv6 checking,
  // consistent with how ipv4Parser snapshots at construction time.
  const mappedIpv4Opts = version === "both"
    ? {
      allowPrivate: options?.ipv4?.allowPrivate,
      allowLoopback: options?.ipv4?.allowLoopback,
      allowLinkLocal: options?.ipv4?.allowLinkLocal,
      allowMulticast: options?.ipv4?.allowMulticast,
      allowBroadcast: options?.ipv4?.allowBroadcast,
      allowZero: options?.ipv4?.allowZero,
    }
    : undefined;
  const mappedIpv4Errors = version === "both"
    ? {
      privateNotAllowed: errors?.privateNotAllowed,
      loopbackNotAllowed: errors?.loopbackNotAllowed,
      linkLocalNotAllowed: errors?.linkLocalNotAllowed,
      multicastNotAllowed: errors?.multicastNotAllowed,
      broadcastNotAllowed: errors?.broadcastNotAllowed,
      zeroNotAllowed: errors?.zeroNotAllowed,
    }
    : undefined;

  const cidrParserObj: ValueParser<"sync", CidrValue> = {
    mode: "sync",
    metavar,
    get placeholder() {
      return version === 6 || (version === "both" && (minPrefix ?? 0) > 32)
        ? {
          address: ipv6Parser!.placeholder,
          prefix: minPrefix ?? 0,
          version: 6 as 4 | 6,
        }
        : {
          address: ipv4Parser!.placeholder,
          prefix: minPrefix ?? 0,
          version: 4 as 4 | 6,
        };
    },
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
      let ipv4Error: ValueParserResult<string> | null = null;
      let ipv6Error: ValueParserResult<string> | null = null;

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
        } else {
          ipv4Error = result;
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
        } else {
          ipv6Error = result;
        }
      }

      // Neither IPv4 nor IPv6 worked
      if (ipVersion === null || normalizedIp === null) {
        // Prefer specific restriction errors (private, loopback, multicast,
        // etc.) over the generic CIDR error, but only when the prefix is
        // also valid for the implied IP version.  Structural parse failures
        // are identified by reference equality with genericIpSentinel.
        const candidates: readonly [
          ValueParserResult<string> | null,
          4 | 6,
          number,
        ][] = [[ipv4Error, 4, 32], [ipv6Error, 6, 128]];
        for (const [err, ver, maxPfx] of candidates) {
          if (err !== null && !err.success && err.error !== genericIpSentinel) {
            // The IP was structurally valid but violated a restriction.
            // Validate the prefix before surfacing the restriction error,
            // so prefix errors take precedence over restriction diagnostics.
            if (prefix > maxPfx) {
              const errorMsg = errors?.invalidPrefix;
              if (typeof errorMsg === "function") {
                return { success: false, error: errorMsg(prefix, ver) };
              }
              const msg = errorMsg ?? [
                {
                  type: "text",
                  text: "Expected a prefix length between 0 and ",
                },
                { type: "text", text: maxPfx.toString() },
                { type: "text", text: ` for IPv${ver}, but got ` },
                { type: "text", text: prefix.toString() },
                { type: "text", text: "." },
              ] as Message;
              return { success: false, error: msg };
            }
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
            return err;
          }
        }

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

      // Check IPv4 restrictions for IPv4-mapped IPv6 addresses.
      // This runs after all prefix validations so that prefix errors
      // (invalidPrefix, minPrefix, maxPrefix) take precedence.
      // The base address is checked regardless of prefix length,
      // consistent with how ipv4() validates regular IPv4 CIDRs.
      if (version === "both" && ipVersion === 6 && normalizedIp !== null) {
        const mappedOctets = extractIpv4FromMapped(normalizedIp);
        if (mappedOctets !== null) {
          const restrictionError = checkIpv4MappedRestrictions(
            mappedOctets,
            normalizedIp,
            mappedIpv4Opts,
            mappedIpv4Errors,
          );
          if (restrictionError !== null) return restrictionError;
        }
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
    format: ((_: CidrValue) => metavar) as (value: CidrValue) => string,
  };
  let cidrParsing = false;
  Object.defineProperty(cidrParserObj, "format", {
    value(value: CidrValue): string {
      if (
        typeof value !== "object" || value == null ||
        !("address" in value) || !("prefix" in value) ||
        !("version" in value)
      ) {
        return metavar;
      }
      if (cidrParsing) return `${value.address}/${value.prefix}`;
      cidrParsing = true;
      try {
        const raw = `${value.address}/${value.prefix}`;
        const result = cidrParserObj.parse(raw);
        return result.success && result.value.version === value.version
          ? `${result.value.address}/${result.value.prefix}`
          : raw;
      } catch {
        return `${value.address}/${value.prefix}`;
      } finally {
        cidrParsing = false;
      }
    },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(cidrParserObj, "normalize", {
    value(v: CidrValue): CidrValue {
      if (
        typeof v !== "object" || v == null ||
        !("address" in v) || !("prefix" in v) ||
        !("version" in v)
      ) {
        return v;
      }
      if (cidrParsing) return v;
      cidrParsing = true;
      const formatted = `${v.address}/${v.prefix}`;
      try {
        const result = cidrParserObj.parse(formatted);
        if (result.success && result.value.version === v.version) {
          return result.value;
        }
        return v;
      } catch {
        return v;
      } finally {
        cidrParsing = false;
      }
    },
    configurable: true,
    enumerable: true,
  });
  return cidrParserObj;
}

/**
 * A normalized Semantic Versioning 2.0.0 string.
 *
 * Covers all four valid forms:
 *  - `MAJOR.MINOR.PATCH`
 *  - `MAJOR.MINOR.PATCH-preRelease`
 *  - `MAJOR.MINOR.PATCH+metadata`
 *  - `MAJOR.MINOR.PATCH-preRelease+metadata`
 *
 * Note: this type uses TypeScript template literals as a coarse structural
 * hint.  The `${number}` slots accept any JavaScript number serialization
 * (including negative numbers, decimals, and `Infinity`), so the type alone
 * does not guarantee full SemVer 2.0.0 validity.  Full validation is
 * enforced at parse time by {@link semVer}.  Only values returned by
 * `semVer().parse()` are guaranteed to conform to the specification.
 *
 * @since 1.1.0
 */
export type SemVerString =
  | `${number}.${number}.${number}`
  | `${number}.${number}.${number}-${string}`
  | `${number}.${number}.${number}+${string}`
  | `${number}.${number}.${number}-${string}+${string}`;

/**
 * A parsed Semantic Versioning 2.0.0 value as a structured object.
 *
 * @since 1.1.0
 */
export interface SemVer {
  /**
   * The major version number.
   *
   * This field is a JavaScript `number`, so it is limited to
   * {@link Number.MAX_SAFE_INTEGER} (2⁵³ − 1).  Inputs whose major
   * component exceeds this value are rejected by {@link semVer} in object
   * mode; use string mode to handle arbitrarily large version numbers.
   */
  readonly major: number;
  /**
   * The minor version number.
   *
   * Same safe-integer constraint as {@link major}.
   */
  readonly minor: number;
  /**
   * The patch version number.
   *
   * Same safe-integer constraint as {@link major}.
   */
  readonly patch: number;
  /**
   * The pre-release identifier (the part after `-`, before `+`), if present.
   * Example: `"alpha.1"` for `1.0.0-alpha.1`.
   */
  readonly preRelease?: string;
  /**
   * The build metadata (the part after `+`), if present.
   * Example: `"build.42"` for `1.0.0+build.42`.
   */
  readonly metadata?: string;
}

/** @internal */
interface SemVerOptionsBase {
  /**
   * The metavariable name for this parser.  Used in help messages.
   * @default `"SEMVER"`
   */
  readonly metavar?: NonEmptyString;
  /**
   * Whether to accept an optional leading `v` character (e.g. `v1.2.3`).
   * The `v` prefix is stripped; output is always the canonical unprefixed form.
   * @default false
   */
  readonly allowPrefix?: boolean;
  /**
   * Custom error messages for parse failures.
   * @since 1.1.0
   */
  readonly errors?: {
    /**
     * Message when input is not a valid SemVer string.
     * Can be a static message or a function receiving the rejected input.
     */
    readonly invalidSemVer?: Message | ((input: string) => Message);
  };
}

/**
 * Options for {@link semVer} in string mode (the default).
 *
 * @since 1.1.0
 */
export interface SemVerOptionsString extends SemVerOptionsBase {
  /** Return a {@link SemVerString} template-literal type. */
  readonly type?: "string";
}

/**
 * Options for {@link semVer} in object mode.
 *
 * In object mode, version components are stored as JavaScript `number`
 * values.  Components exceeding {@link Number.MAX_SAFE_INTEGER} (2⁵³ − 1)
 * cannot be represented exactly and are therefore rejected with a parse
 * error.  Use string mode (the default) if you need to handle version
 * numbers of arbitrary magnitude.
 *
 * @since 1.1.0
 */
export interface SemVerOptionsObject extends SemVerOptionsBase {
  /** Return a structured {@link SemVer} object. */
  readonly type: "object";
}

// Official SemVer 2.0.0 regex with optional leading "v" prefix capture group.
// Groups: prefix?, major, minor, patch, pre?, meta?
const SEMVER_REGEX =
  /^(?<prefix>v)?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<meta>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const SEMVER_SUGGESTIONS: readonly string[] = Object.freeze([
  "0.0.0",
  "1.0.0",
  "1.0.0-alpha",
  "1.0.0-alpha.1",
  "1.0.0+build.1",
  "1.0.0-alpha.1+build.1",
]);

const SEMVER_SUGGESTIONS_WITH_PREFIX: readonly string[] = Object.freeze([
  ...SEMVER_SUGGESTIONS,
  ...SEMVER_SUGGESTIONS.map((s) => `v${s}`),
]);

/**
 * Creates a {@link ValueParser} for [Semantic Versioning 2.0.0] strings.
 *
 * In string mode (the default), the parser returns a {@link SemVerString}
 * template-literal type.  String mode accepts any spec-valid SemVer input,
 * including version components of arbitrary magnitude.
 *
 * In object mode (`type: "object"`), the parser returns a structured
 * {@link SemVer} value with `major`, `minor`, `patch`, and optional
 * `preRelease` and `metadata` fields.  Because the numeric components are
 * stored as JavaScript `number`, object mode additionally rejects inputs
 * whose major, minor, or patch value exceeds
 * {@link Number.MAX_SAFE_INTEGER} (2⁵³ − 1).  Use string mode if you need
 * to handle arbitrarily large version numbers.
 *
 * Both modes strictly enforce the SemVer 2.0.0 specification: no leading
 * zeros in numeric components, no empty pre-release or build identifiers,
 * and no invalid characters.
 *
 * [Semantic Versioning 2.0.0]: https://semver.org/
 *
 * @param options Configuration options.
 * @returns A {@link ValueParser} that validates SemVer strings.
 * @throws {TypeError} If {@link SemVerOptionsBase.metavar} is an empty string.
 * @throws {TypeError} If {@link SemVerOptionsBase.allowPrefix} is not a
 *   boolean.
 * @throws {TypeError} If {@link SemVerOptionsString.type} is not `"string"`,
 *   `"object"`, or `undefined`.
 * @since 1.1.0
 */
export function semVer(
  options?: SemVerOptionsString,
): ValueParser<"sync", SemVerString>;
/**
 * Creates a {@link ValueParser} for [Semantic Versioning 2.0.0] strings,
 * returning a structured {@link SemVer} object.
 *
 * [Semantic Versioning 2.0.0]: https://semver.org/
 *
 * @param options Configuration options with `type: "object"`.
 * @returns A {@link ValueParser} that converts SemVer strings to {@link SemVer}
 *   objects.
 * @throws {TypeError} If {@link SemVerOptionsBase.metavar} is an empty string.
 * @throws {TypeError} If {@link SemVerOptionsBase.allowPrefix} is not a
 *   boolean.
 * @throws {TypeError} If {@link SemVerOptionsObject.type} is not `"string"`,
 *   `"object"`, or `undefined`.
 * @since 1.1.0
 */
export function semVer(
  options: SemVerOptionsObject,
): ValueParser<"sync", SemVer>;
export function semVer(
  options: SemVerOptionsString | SemVerOptionsObject = {},
): ValueParser<"sync", SemVerString> | ValueParser<"sync", SemVer> {
  const metavar = options.metavar ?? "SEMVER";
  ensureNonEmptyString(metavar);
  checkEnumOption(options, "type", ["string", "object"]);
  checkBooleanOption(options, "allowPrefix");
  const allowPrefix = options.allowPrefix ?? false;
  const objectMode = options.type === "object";
  const errorOption = options.errors?.invalidSemVer;

  const suggestions = allowPrefix
    ? SEMVER_SUGGESTIONS_WITH_PREFIX
    : SEMVER_SUGGESTIONS;

  function makeError(input: string): ValueParserResult<never> {
    return {
      success: false,
      error: errorOption
        ? (typeof errorOption === "function" ? errorOption(input) : errorOption)
        : message`Expected a valid Semantic Versioning 2.0.0 string (e.g. ${"1.0.0"}), but got ${input}.`,
    };
  }

  if (objectMode) {
    return {
      mode: "sync",
      metavar,
      placeholder: { major: 0, minor: 0, patch: 0 },
      parse(input: string): ValueParserResult<SemVer> {
        const m = SEMVER_REGEX.exec(input);
        if (m == null) return makeError(input);
        if (!allowPrefix && m.groups!.prefix != null) return makeError(input);
        const major = parseInt(m.groups!.major, 10);
        const minor = parseInt(m.groups!.minor, 10);
        const patch = parseInt(m.groups!.patch, 10);
        if (
          !Number.isSafeInteger(major) ||
          !Number.isSafeInteger(minor) ||
          !Number.isSafeInteger(patch)
        ) {
          return makeError(input);
        }
        const result: SemVer = {
          major,
          minor,
          patch,
          ...(m.groups!.pre != null ? { preRelease: m.groups!.pre } : {}),
          ...(m.groups!.meta != null ? { metadata: m.groups!.meta } : {}),
        };
        return { success: true, value: result };
      },
      format(value: SemVer): string {
        let s = `${value.major}.${value.minor}.${value.patch}`;
        if (value.preRelease != null) s += `-${value.preRelease}`;
        if (value.metadata != null) s += `+${value.metadata}`;
        return s;
      },
      *suggest(prefix: string): Iterable<Suggestion> {
        for (const s of suggestions) {
          if (s.startsWith(prefix)) yield { kind: "literal", text: s };
        }
      },
    };
  }

  return {
    mode: "sync",
    metavar,
    placeholder: "0.0.0" as SemVerString,
    parse(input: string): ValueParserResult<SemVerString> {
      const m = SEMVER_REGEX.exec(input);
      if (m == null) return makeError(input);
      if (!allowPrefix && m.groups!.prefix != null) return makeError(input);
      const canonical =
        `${m.groups!.major}.${m.groups!.minor}.${m.groups!.patch}` +
        (m.groups!.pre != null ? `-${m.groups!.pre}` : "") +
        (m.groups!.meta != null ? `+${m.groups!.meta}` : "");
      return { success: true, value: canonical as SemVerString };
    },
    format(value: SemVerString): string {
      return value;
    },
    *suggest(prefix: string): Iterable<Suggestion> {
      for (const s of suggestions) {
        if (s.startsWith(prefix)) yield { kind: "literal", text: s };
      }
    },
  };
}

/**
 * Any JSON-serializable value.
 *
 * This type is a TypeScript approximation of JSON data values.  Note that
 * certain JavaScript distinctions are not preserved through serialization:
 * for example, `-0` serializes as `"0"`, so a round-trip through
 * `format()` and `parse()` may return `0` instead.
 *
 * @since 1.1.0
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { readonly [property: string]: Json }
  | readonly Json[];

/**
 * Options for creating a {@link json} value parser.
 *
 * @since 1.1.0
 */
export interface JsonOptions {
  /**
   * The metavariable name for this parser.  This is used in help messages to
   * indicate what kind of value this parser expects.  Usually a single
   * word in uppercase, like `DATA` or `CONFIG`.
   * @default `"JSON"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * A custom placeholder value used during deferred prompt resolution.
   * @default Depends on `rootType`: `null` when unset, `""` for `"string"`,
   *   `0` for `"number"`, `false` for `"boolean"`, `null` for `"null"`,
   *   `{}` for `"object"`, `[]` for `"array"`.
   * @since 1.1.0
   */
  readonly placeholder?: Json;

  /**
   * Restricts the expected JSON root type.  When set, the parser rejects
   * JSON values whose root type does not match and narrows the TypeScript
   * return type accordingly.
   *
   * @since 1.1.0
   */
  readonly rootType?:
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "object"
    | "array";

  /**
   * Custom error messages for JSON parsing failures.
   *
   * @since 1.1.0
   */
  readonly errors?: {
    /**
     * Custom error message when the input is not valid JSON.
     * Can be a static message or a function that receives the raw input.
     * @since 1.1.0
     */
    readonly invalidJson?: Message | ((input: string) => Message);

    /**
     * Custom error message when the parsed JSON value does not match the
     * expected `rootType`.  Can be a static message or a function that
     * receives the parsed value and the expected root type name.
     * @since 1.1.0
     */
    readonly invalidRootType?:
      | Message
      | ((value: Json, expected: string) => Message);
  };
}

/**
 * Creates a {@link ValueParser} that parses JSON-encoded strings and returns
 * a `string`.
 *
 * @param options Configuration options including `rootType: "string"`.
 * @returns A parser whose successful value is typed as `string`.
 * @since 1.1.0
 */
export function json(
  options: JsonOptions & {
    readonly rootType: "string";
    readonly placeholder?: string;
  },
): ValueParser<"sync", string>;

/**
 * Creates a {@link ValueParser} that parses JSON-encoded strings and returns
 * a `number`.
 *
 * @param options Configuration options including `rootType: "number"`.
 * @returns A parser whose successful value is typed as `number`.
 * @since 1.1.0
 */
export function json(
  options: JsonOptions & {
    readonly rootType: "number";
    readonly placeholder?: number;
  },
): ValueParser<"sync", number>;

/**
 * Creates a {@link ValueParser} that parses JSON-encoded strings and returns
 * a `boolean`.
 *
 * @param options Configuration options including `rootType: "boolean"`.
 * @returns A parser whose successful value is typed as `boolean`.
 * @since 1.1.0
 */
export function json(
  options: JsonOptions & {
    readonly rootType: "boolean";
    readonly placeholder?: boolean;
  },
): ValueParser<"sync", boolean>;

/**
 * Creates a {@link ValueParser} that parses JSON-encoded strings and returns
 * `null`.
 *
 * @param options Configuration options including `rootType: "null"`.
 * @returns A parser whose successful value is typed as `null`.
 * @since 1.1.0
 */
export function json(
  options: JsonOptions & {
    readonly rootType: "null";
    readonly placeholder?: null;
  },
): ValueParser<"sync", null>;

/**
 * Creates a {@link ValueParser} that parses JSON-encoded strings and returns
 * a plain JSON object.
 *
 * @param options Configuration options including `rootType: "object"`.
 * @returns A parser whose successful value is typed as
 *   `{ readonly [property: string]: Json }`.
 * @since 1.1.0
 */
export function json(
  options: JsonOptions & {
    readonly rootType: "object";
    readonly placeholder?: { readonly [property: string]: Json };
  },
): ValueParser<"sync", { readonly [property: string]: Json }>;

/**
 * Creates a {@link ValueParser} that parses JSON-encoded strings and returns
 * a JSON array.
 *
 * @param options Configuration options including `rootType: "array"`.
 * @returns A parser whose successful value is typed as `readonly Json[]`.
 * @since 1.1.0
 */
export function json(
  options: JsonOptions & {
    readonly rootType: "array";
    readonly placeholder?: readonly Json[];
  },
): ValueParser<"sync", readonly Json[]>;

/**
 * Creates a {@link ValueParser} that parses JSON-encoded strings into any
 * {@link Json} value (object, array, string, number, boolean, or null).
 *
 * Also accepts a pre-typed `JsonOptions` variable when the `rootType` is not
 * known at compile time; the return type is the widened {@link Json} union.
 *
 * @param options Optional configuration for the parser.
 * @returns A parser whose successful value is typed as {@link Json}.
 * @since 1.1.0
 */
export function json(options?: JsonOptions): ValueParser<"sync", Json>;

/**
 * Creates a {@link ValueParser} for parsing JSON-encoded strings from the
 * command line.
 *
 * The parser accepts any well-formed JSON string by default.  Use the
 * `rootType` option to restrict which JSON root type is accepted and to
 * narrow the TypeScript return type accordingly.
 *
 * @example
 * ```typescript
 * // Accept any JSON value
 * const anyJson = json();
 *
 * // Accept only JSON objects (return type narrowed)
 * const objJson = json({ rootType: "object" });
 * ```
 *
 * @param options Optional configuration for the parser.
 * @returns A {@link ValueParser} that converts JSON-encoded strings to the
 *   appropriate JavaScript type.
 * @throws {TypeError} If `options.metavar` is provided but is an empty string.
 * @throws {TypeError} If `options.rootType` is provided but is not one of the
 *   six allowed values.
 * @throws {TypeError} If `options.placeholder` or any value nested within
 *   it is a non-finite number (`Infinity`, `-Infinity`, or `NaN`).
 * @throws {TypeError} If `options.placeholder` is provided with a `rootType`
 *   but its JSON type does not match the `rootType`.
 * @throws {TypeError} If the returned parser's `format()` method is called
 *   with a value that contains a non-finite number anywhere in its structure.
 * @since 1.1.0
 */
export function json(options?: JsonOptions): ValueParser<"sync", Json> {
  const metavar = options?.metavar ?? "JSON";
  ensureNonEmptyString(metavar);
  checkEnumOption(options, "rootType", [
    "string",
    "number",
    "boolean",
    "null",
    "object",
    "array",
  ]);
  const rootType = options?.rootType;
  const invalidJsonError = options?.errors?.invalidJson;
  const invalidRootTypeError = options?.errors?.invalidRootType;

  if (options?.placeholder !== undefined) {
    const p = options.placeholder;
    const nonFinitePlaceholder = findNonFiniteNumber(p);
    if (nonFinitePlaceholder !== undefined) {
      throw new TypeError(
        `Expected placeholder to contain only finite numbers, but found ${
          String(nonFinitePlaceholder)
        }.`,
      );
    }
    if (rootType != null && jsonTypeOf(p) !== rootType) {
      throw new TypeError(
        `Expected placeholder to be a JSON ${rootType}, but got ${
          jsonTypeOf(p)
        }.`,
      );
    }
  }

  const defaultPlaceholder: Json = rootType === "string"
    ? ""
    : rootType === "number"
    ? 0
    : rootType === "boolean"
    ? false
    : rootType === "object"
    ? {}
    : rootType === "array"
    ? []
    : null;
  const placeholder: Json = options?.placeholder ?? defaultPlaceholder;

  return {
    mode: "sync",
    metavar,
    placeholder,
    parse(input: string): ValueParserResult<Json> {
      let value: Json;
      try {
        value = JSON.parse(input) as Json;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        const error: Message = invalidJsonError instanceof Function
          ? invalidJsonError(input)
          : invalidJsonError ?? [text(`Not a valid JSON: ${err.message}`)];
        return { success: false, error };
      }
      const nonFinite = findNonFiniteNumber(value);
      if (nonFinite !== undefined) {
        const error: Message = invalidJsonError instanceof Function
          ? invalidJsonError(input)
          : invalidJsonError ??
            [text(`Not a valid JSON: number out of range.`)];
        return { success: false, error };
      }
      if (rootType != null) {
        const actual = jsonTypeOf(value);
        if (actual !== rootType) {
          const error: Message = invalidRootTypeError instanceof Function
            ? invalidRootTypeError(value, rootType)
            : invalidRootTypeError ??
              [text(`Expected JSON ${rootType}, but got ${actual}.`)];
          return { success: false, error };
        }
      }
      return { success: true, value };
    },
    format(value: Json): string {
      const nonFinite = findNonFiniteNumber(value);
      if (nonFinite !== undefined) {
        throw new TypeError(
          `Expected a finite JSON number, but got ${String(nonFinite)}.`,
        );
      }
      return JSON.stringify(value);
    },
  };
}

function jsonTypeOf(value: Json): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Finds the first non-finite number (`NaN`, `Infinity`, or `-Infinity`)
 * anywhere in a JSON structure.
 *
 * Uses an explicit stack rather than recursion to avoid call-stack overflows
 * on deeply nested inputs.  Tracks visited objects to handle circular
 * references without looping forever.
 *
 * @returns The first non-finite number found, or `undefined` if all numbers
 *   in the structure are finite.
 */
function findNonFiniteNumber(root: Json): number | undefined {
  const stack: Json[] = [root];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const value = stack.pop()!;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return value;
    } else if (Array.isArray(value)) {
      if (seen.has(value)) continue;
      seen.add(value);
      for (const item of value) {
        stack.push(item);
      }
    } else if (value !== null && typeof value === "object") {
      if (seen.has(value)) continue;
      seen.add(value);
      for (const item of Object.values(value)) {
        stack.push(item);
      }
    }
  }
  return undefined;
}

/**
 * Options for the {@link firstOf} combinator.
 * @since 1.1.0
 */
export interface FirstOfOptions {
  /**
   * The metavariable name for the combined parser.  This is used in help
   * messages to indicate what kind of value this parser expects.
   * @default The constituent metavars joined with `|`, e.g. `"TYPE|INTEGER"`.
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for firstOf parsing failures.
   * @since 1.1.0
   */
  readonly errors?: {
    /**
     * Custom error message when every constituent parser fails.  Can be a
     * static message or a function that receives the input and the
     * constituent errors in declaration order.
     * @since 1.1.0
     */
    readonly noMatch?:
      | Message
      | ((input: string, errors: readonly Message[]) => Message);
  };
}

/**
 * The trailing options argument of {@link firstOf}.  A {@link ValueParser}
 * structurally satisfies {@link FirstOfOptions} (its `metavar` field matches
 * the optional one), so the required `parse` method is excluded to keep
 * the overloads unambiguous.
 */
type FirstOfTailOptions = FirstOfOptions & { readonly parse?: never };

/**
 * Extracts the result type of a sync {@link ValueParser}.
 */
type ValueParserValue<P> = P extends ValueParser<"sync", infer T> ? T : never;

/**
 * Creates a {@link ValueParser} that tries two value parsers in declaration
 * order and returns the result of the first one that succeeds.
 *
 * The result type is the union of the constituent result types:
 *
 * ```typescript
 * const count = firstOf(choice(["auto"]), integer({ min: 1 }));
 * // Inferred type: ValueParser<"sync", "auto" | number>
 * ```
 *
 * When every constituent fails, the combined error lists each constituent's
 * error on its own line.
 * @template TA The result type of the first parser.
 * @template TB The result type of the second parser.
 * @param a The first value parser to try.
 * @param b The second value parser to try.
 * @param options Configuration options for the combined parser.
 * @returns A {@link ValueParser} that accepts values matching any of the
 *          constituent parsers.
 * @throws {TypeError} If any constituent is not a sync value parser.
 * @throws {TypeError} If any constituent is a dependency-derived value
 *         parser (created via `deriveFrom()` or `dependency().derive()`).
 * @since 1.1.0
 */
export function firstOf<TA, TB>(
  a: ValueParser<"sync", TA>,
  b: ValueParser<"sync", TB>,
  options?: FirstOfTailOptions,
): ValueParser<"sync", TA | TB>;

/**
 * Creates a {@link ValueParser} that tries three value parsers in declaration
 * order and returns the result of the first one that succeeds.
 * @template TA The result type of the first parser.
 * @template TB The result type of the second parser.
 * @template TC The result type of the third parser.
 * @param a The first value parser to try.
 * @param b The second value parser to try.
 * @param c The third value parser to try.
 * @param options Configuration options for the combined parser.
 * @returns A {@link ValueParser} that accepts values matching any of the
 *          constituent parsers.
 * @throws {TypeError} If any constituent is not a sync value parser.
 * @throws {TypeError} If any constituent is a dependency-derived value
 *         parser (created via `deriveFrom()` or `dependency().derive()`).
 * @since 1.1.0
 */
export function firstOf<TA, TB, TC>(
  a: ValueParser<"sync", TA>,
  b: ValueParser<"sync", TB>,
  c: ValueParser<"sync", TC>,
  options?: FirstOfTailOptions,
): ValueParser<"sync", TA | TB | TC>;

/**
 * Creates a {@link ValueParser} that tries four value parsers in declaration
 * order and returns the result of the first one that succeeds.
 * @template TA The result type of the first parser.
 * @template TB The result type of the second parser.
 * @template TC The result type of the third parser.
 * @template TD The result type of the fourth parser.
 * @param a The first value parser to try.
 * @param b The second value parser to try.
 * @param c The third value parser to try.
 * @param d The fourth value parser to try.
 * @param options Configuration options for the combined parser.
 * @returns A {@link ValueParser} that accepts values matching any of the
 *          constituent parsers.
 * @throws {TypeError} If any constituent is not a sync value parser.
 * @throws {TypeError} If any constituent is a dependency-derived value
 *         parser (created via `deriveFrom()` or `dependency().derive()`).
 * @since 1.1.0
 */
export function firstOf<TA, TB, TC, TD>(
  a: ValueParser<"sync", TA>,
  b: ValueParser<"sync", TB>,
  c: ValueParser<"sync", TC>,
  d: ValueParser<"sync", TD>,
  options?: FirstOfTailOptions,
): ValueParser<"sync", TA | TB | TC | TD>;

/**
 * Creates a {@link ValueParser} that tries five value parsers in declaration
 * order and returns the result of the first one that succeeds.
 * @template TA The result type of the first parser.
 * @template TB The result type of the second parser.
 * @template TC The result type of the third parser.
 * @template TD The result type of the fourth parser.
 * @template TE The result type of the fifth parser.
 * @param a The first value parser to try.
 * @param b The second value parser to try.
 * @param c The third value parser to try.
 * @param d The fourth value parser to try.
 * @param e The fifth value parser to try.
 * @param options Configuration options for the combined parser.
 * @returns A {@link ValueParser} that accepts values matching any of the
 *          constituent parsers.
 * @throws {TypeError} If any constituent is not a sync value parser.
 * @throws {TypeError} If any constituent is a dependency-derived value
 *         parser (created via `deriveFrom()` or `dependency().derive()`).
 * @since 1.1.0
 */
export function firstOf<TA, TB, TC, TD, TE>(
  a: ValueParser<"sync", TA>,
  b: ValueParser<"sync", TB>,
  c: ValueParser<"sync", TC>,
  d: ValueParser<"sync", TD>,
  e: ValueParser<"sync", TE>,
  options?: FirstOfTailOptions,
): ValueParser<"sync", TA | TB | TC | TD | TE>;

/**
 * Creates a {@link ValueParser} that tries any number of value parsers in
 * declaration order and returns the result of the first one that succeeds.
 * @template TParsers The tuple of constituent value parsers.
 * @param args The value parsers to try, followed by configuration options.
 * @returns A {@link ValueParser} that accepts values matching any of the
 *          constituent parsers.
 * @throws {TypeError} If any constituent is not a sync value parser.
 * @throws {TypeError} If any constituent is a dependency-derived value
 *         parser (created via `deriveFrom()` or `dependency().derive()`).
 * @since 1.1.0
 */
export function firstOf<
  const TParsers extends readonly [
    ValueParser<"sync", unknown>,
    ValueParser<"sync", unknown>,
    ...ValueParser<"sync", unknown>[],
  ],
>(
  ...args: [...parsers: TParsers, options: FirstOfTailOptions]
): ValueParser<"sync", ValueParserValue<TParsers[number]>>;

/**
 * Creates a {@link ValueParser} that tries any number of value parsers in
 * declaration order and returns the result of the first one that succeeds.
 * @template TParsers The tuple of constituent value parsers.
 * @param parsers The value parsers to try.
 * @returns A {@link ValueParser} that accepts values matching any of the
 *          constituent parsers.
 * @throws {TypeError} If any constituent is not a sync value parser.
 * @throws {TypeError} If any constituent is a dependency-derived value
 *         parser (created via `deriveFrom()` or `dependency().derive()`).
 * @since 1.1.0
 */
export function firstOf<
  const TParsers extends readonly [
    ValueParser<"sync", unknown>,
    ValueParser<"sync", unknown>,
    ...ValueParser<"sync", unknown>[],
  ],
>(
  ...parsers: TParsers
): ValueParser<"sync", ValueParserValue<TParsers[number]>>;

/**
 * Creates a {@link ValueParser} that tries the value parsers in the given
 * array in declaration order and returns the result of the first one that
 * succeeds.
 *
 * Unlike the variadic overloads, which require at least two statically
 * known arguments, this form accepts a dynamically built array:
 *
 * ```typescript
 * const parsers: ValueParser<"sync", string | number>[] = buildParsers();
 * const combined = firstOf(parsers);
 * ```
 * @template TParsers The array of constituent value parsers.
 * @param parsers The value parsers to try.  Must contain at least two
 *                parsers.
 * @param options Configuration options for the combined parser.
 * @returns A {@link ValueParser} that accepts values matching any of the
 *          constituent parsers.
 * @throws {TypeError} If the array contains fewer than two value parsers.
 * @throws {TypeError} If any constituent is not a sync value parser.
 * @throws {TypeError} If any constituent is a dependency-derived value
 *         parser (created via `deriveFrom()` or `dependency().derive()`).
 * @since 1.1.0
 */
export function firstOf<
  const TParsers extends readonly ValueParser<"sync", unknown>[],
>(
  parsers: TParsers,
  options?: FirstOfOptions,
): ValueParser<"sync", ValueParserValue<TParsers[number]>>;

/**
 * Implementation of the {@link firstOf} combinator.
 */
export function firstOf(
  ...rawArgs: readonly (
    | ValueParser<"sync", unknown>
    | FirstOfTailOptions
    | FirstOfOptions
    | readonly ValueParser<"sync", unknown>[]
    | undefined
  )[]
): ValueParser<"sync", unknown> {
  // The fixed-arity and array overloads declare the trailing options as
  // optional, so an explicit `undefined` may arrive as the last argument:
  const args = rawArgs.length > 0 && rawArgs.at(-1) === undefined
    ? rawArgs.slice(0, -1)
    : rawArgs;
  let parsers: readonly ValueParser<"sync", unknown>[];
  let options: FirstOfOptions;
  if (args.length > 0 && Array.isArray(args[0])) {
    // Snapshot the caller-provided array so later mutations cannot make
    // the parsing behavior diverge from the construction-time metadata
    // (metavar, choices, normalize/suggest presence).
    parsers = [...args[0]] as readonly ValueParser<"sync", unknown>[];
    options = (args[1] ?? {}) as FirstOfOptions;
  } else {
    const last = args.at(-1);
    if (
      args.length > 0 && typeof last === "object" && last != null &&
      !isValueParser(last)
    ) {
      options = last as FirstOfOptions;
      parsers = args.slice(0, -1) as readonly ValueParser<"sync", unknown>[];
    } else {
      options = {};
      parsers = args as readonly ValueParser<"sync", unknown>[];
    }
  }
  if (parsers.length < 2) {
    throw new TypeError("firstOf() requires at least two value parsers.");
  }
  for (const parser of parsers) {
    if (!isValueParser(parser)) {
      throw new TypeError(
        "Every firstOf() constituent must be a value parser.",
      );
    }
    if (parser.mode !== "sync") {
      throw new TypeError(
        "firstOf() only supports sync value parsers, " +
          "but an async one was given.",
      );
    }
    // A dependency-derived value parser parses with *default* dependency
    // values when invoked directly, and firstOf() cannot forward the
    // derived metadata that option()/argument() use to re-run it with the
    // dependency values resolved during the current parse.  Accepting one
    // would silently validate against the wrong branch.
    if (isDerivedValueParser(parser)) {
      throw new TypeError(
        "firstOf() does not support dependency-derived value parsers " +
          "(created via deriveFrom() or dependency().derive()); pass the " +
          "derived parser directly to option() or argument() instead.",
      );
    }
  }
  const metavar = options.metavar ??
    parsers.map((parser) => parser.metavar).join("|");
  ensureNonEmptyString(metavar);

  // A merged choices list is only meaningful when it is exhaustive, i.e.,
  // when every constituent enumerates its valid values.  Overlapping
  // choices are deduplicated with Object.is rather than a Set, which
  // would conflate values like 0 and -0 that choice() deliberately
  // distinguishes.
  const mergedChoices = parsers.every((parser) => parser.choices != null)
    ? Object.freeze(
      parsers
        .flatMap((parser) => [...parser.choices!])
        .filter(
          (value, index, all) =>
            all.findIndex((other) => Object.is(other, value)) === index,
        ),
    )
    : undefined;

  // Finds the constituent that produced the given value, along with its
  // canonical validation result.  A constituent's own validate() hook
  // decides membership authoritatively: it can accept values that its
  // format()+parse() round-trip cannot express, such as a nested firstOf()
  // whose valid value is shadowed by an earlier overlapping branch.
  // Hookless constituents are checked by round-tripping their format()
  // through their own parse(); those whose format() throws or returns a
  // non-string for a foreign value are skipped.
  //
  // Ownership resolves in two passes.  The first pass requires the
  // round-tripped value to faithfully preserve the original (exact
  // equality, the constituent's own normalize() result, or a recognized
  // canonicalization; see ownsRoundTrippedValue), so a constituent that
  // preserves the value always beats an earlier lossy one.  Only when no
  // constituent preserves the value does the second pass accept the first
  // same-primitive-type round trip as a parse-level canonicalization
  // (e.g. email({ allowDisplayName: true }) stripping a display name)—
  // the same acceptance the constituent alone would grant a fallback
  // value.  Object values are exempt from the second pass: structural
  // equality is the only way to tell canonicalization from data loss
  // there, and the first pass already covers it.
  function findOwner(
    value: unknown,
  ):
    | {
      readonly parser: ValueParser<"sync", unknown>;
      readonly result: ValueParserResult<unknown>;
    }
    | undefined {
    let canonicalizing:
      | {
        readonly parser: ValueParser<"sync", unknown>;
        readonly result: ValueParserResult<unknown>;
      }
      | undefined;
    for (const parser of parsers) {
      if (typeof parser.validate === "function") {
        // A constituent's validate() hook is typed for its own value
        // type, so it may throw when handed a foreign value from another
        // branch of the union; treat that as non-ownership, like a
        // throwing format().
        let result: ValueParserResult<unknown>;
        try {
          result = parser.validate(value);
        } catch {
          continue;
        }
        if (result.success) return { parser, result };
        continue;
      }
      let formatted: string;
      try {
        formatted = parser.format(value);
      } catch {
        continue;
      }
      if (typeof formatted !== "string") continue;
      const result = parser.parse(formatted);
      if (!result.success) continue;
      if (ownsRoundTrippedValue(parser, result.value, value)) {
        return { parser, result };
      }
      if (
        canonicalizing == null &&
        value !== null && typeof value !== "object" &&
        typeof result.value === typeof value
      ) {
        canonicalizing = { parser, result };
      }
    }
    return canonicalizing;
  }

  const hasNormalize = parsers.some(
    (parser) => typeof parser.normalize === "function",
  );
  const hasSuggest = parsers.some(
    (parser) => typeof parser.suggest === "function",
  );

  return {
    mode: "sync",
    metavar,
    placeholder: parsers[0].placeholder,
    ...(mergedChoices != null ? { choices: mergedChoices } : {}),
    parse(input: string): ValueParserResult<unknown> {
      const errors: Message[] = [];
      for (const parser of parsers) {
        const result = parser.parse(input);
        if (result.success) return result;
        errors.push(result.error);
      }
      const noMatch = options.errors?.noMatch;
      return {
        success: false,
        error: noMatch == null
          ? firstOfNoMatchError(errors)
          : typeof noMatch === "function"
          ? noMatch(input, errors)
          : noMatch,
      };
    },
    format(value: unknown): string {
      // format() is a display-oriented best effort: precise fallback
      // validation goes through validate() below, so this method only
      // needs to pick the most faithful string representation available.
      // Ownership mirrors findOwner(): a constituent's own validate()
      // hook decides authoritatively, faithful round trips win over
      // same-primitive-type canonicalizing ones, and unclaimed values
      // fall back to the first well-formed string.
      let canonicalizing: string | undefined;
      let fallback: string | undefined;
      let firstError: unknown;
      let hasError = false;
      for (const parser of parsers) {
        let formatted: string;
        try {
          formatted = parser.format(value);
        } catch (e) {
          if (!hasError) {
            firstError = e;
            hasError = true;
          }
          continue;
        }
        // A constituent's format() may return a non-string when handed a
        // value from another branch of the union; such results are not
        // usable as CLI input and must not be returned.
        if (typeof formatted !== "string") continue;
        if (typeof parser.validate === "function") {
          // A hook that throws on a foreign value counts as
          // non-ownership.
          let owned = false;
          try {
            owned = parser.validate(value).success;
          } catch {
            // Not this constituent's value.
          }
          if (owned) return formatted;
        } else {
          const result = parser.parse(formatted);
          if (result.success) {
            if (ownsRoundTrippedValue(parser, result.value, value)) {
              return formatted;
            }
            if (
              canonicalizing == null &&
              value !== null && typeof value !== "object" &&
              typeof result.value === typeof value
            ) {
              canonicalizing = formatted;
            }
          }
        }
        fallback ??= formatted;
      }
      if (canonicalizing !== undefined) return canonicalizing;
      if (fallback !== undefined) return fallback;
      if (hasError) throw firstError;
      throw new TypeError(
        "No constituent parser could format the given value.",
      );
    },
    validate(value: unknown): ValueParserResult<unknown> {
      const owner = findOwner(value);
      if (owner == null) {
        return {
          success: false,
          error: message`Expected a value matching ${metavarTerm(metavar)}.`,
        };
      }
      return owner.result;
    },
    ...(hasNormalize
      ? {
        normalize(value: unknown): unknown {
          const owner = findOwner(value);
          if (owner == null || typeof owner.parser.normalize !== "function") {
            return value;
          }
          return owner.parser.normalize(value);
        },
      }
      : {}),
    ...(hasSuggest
      ? {
        *suggest(prefix: string): Iterable<Suggestion> {
          const collected: Suggestion[] = [];
          for (const parser of parsers) {
            if (typeof parser.suggest !== "function") continue;
            for (const suggestion of parser.suggest(prefix)) {
              collected.push(suggestion);
            }
          }
          yield* deduplicateSuggestions(collected);
        },
      }
      : {}),
  };
}

/**
 * Builds the default error message for {@link firstOf} when every
 * constituent parser fails: a header followed by each constituent's error
 * on its own line.
 */
function firstOfNoMatchError(errors: readonly Message[]): Message {
  const terms: MessageTerm[] = [text("Expected one of the following:")];
  for (const error of errors) {
    terms.push(lineBreak(), text("- "), ...cloneMessage(error));
  }
  return terms;
}

/**
 * Determines whether a {@link firstOf} constituent owns a value, given the
 * result of round-tripping the value through the constituent's `format()`
 * and `parse()`.  The constituent owns the value when the round-trip
 * preserves it exactly, when it yields the constituent's own normalization
 * of it (e.g. a MAC address parser canonicalizing separators and case), or
 * when the round-trip is a recognized parse-level canonicalization: a
 * case-insensitive string match (e.g. a case-insensitive `choice()`
 * folding `"INFO"` to `"info"`) or numeric equality (a number parser
 * folding `-0` to `0`)—the same acceptance the constituent alone would
 * grant a fallback value through round-trip validation.  Parsers with
 * richer parse-level canonicalization should expose it via `normalize()`.
 * A merely *successful* round-trip is not enough otherwise: an arbitrary
 * same-type change means data loss rather than canonicalization (e.g. a
 * clamping `format()` folding 15 into 10), a round-trip that changes the
 * primitive type means the string form belongs to a different branch of
 * the union (e.g. `choice(["1"])` capturing the integer 1), and for
 * object values structural equality is the only way to tell
 * canonicalization from data loss (e.g. a lossy `color()` `format()`
 * dropping fields that belong to a later, more faithful constituent).
 */
function ownsRoundTrippedValue(
  parser: ValueParser<"sync", unknown>,
  roundTripped: unknown,
  value: unknown,
): boolean {
  if (valuesEqual(roundTripped, value)) return true;
  if (typeof parser.normalize === "function") {
    let normalized: unknown;
    try {
      normalized = parser.normalize(value);
    } catch {
      return false;
    }
    if (valuesEqual(roundTripped, normalized)) return true;
  }
  if (typeof value === "string" && typeof roundTripped === "string") {
    return value.toLowerCase() === roundTripped.toLowerCase();
  }
  if (typeof value === "number" && typeof roundTripped === "number") {
    // Object.is above already handled identical numbers; this only
    // accepts the remaining ±0 fold.
    return value === roundTripped;
  }
  return false;
}

/**
 * Structural equality for parsed CLI values: primitives compare with
 * `Object.is` (so `NaN` equals itself and `0` differs from `-0`, matching
 * the distinction `choice()` makes), `Date` and `URL` instances compare by
 * time value and href respectively, arrays and plain objects compare
 * recursively, and other class instances compare by their overridden
 * `toString()` serialization.  Recursion is bounded by the structure of
 * the second argument, which in {@link firstOf} is always a freshly
 * parsed (acyclic) value.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" || typeof b !== "object" || a == null || b == null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((item, i) => valuesEqual(item, b[i]));
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date &&
      a.getTime() === b.getTime();
  }
  if (a instanceof URL || b instanceof URL) {
    return a instanceof URL && b instanceof URL && a.href === b.href;
  }
  const prototypeA = Object.getPrototypeOf(a);
  const prototypeB = Object.getPrototypeOf(b);
  // Object.prototype and null are the same "plain object" category:
  // a null-prototype object (e.g. built with Object.create(null)) holds
  // the same JSON-style data as an ordinary object literal.
  const plainA = prototypeA === Object.prototype || prototypeA === null;
  const plainB = prototypeB === Object.prototype || prototypeB === null;
  if (plainA !== plainB) return false;
  if (!plainA) {
    if (prototypeA !== prototypeB) return false;
    // Class instances may expose state through enumerable own fields
    // (e.g. a `UserId` wrapper class assigning `this.id` in its
    // constructor), through private fields or internal slots that only an
    // overridden
    // toString() serializes (e.g. Temporal instances), or both.  Compare
    // whatever channels the objects provide: enumerable fields must match
    // structurally, and when toString() is overridden, both sides must
    // override it (an instance-level override on one side alone, e.g. on
    // a freshly parsed value, must not equate it with an object that
    // stringifies generically) and the serializations must agree.
    // Key-less objects without an overridden toString() expose no channel
    // to compare, so they are conservatively unequal.
    const overridesA = hasCustomToString(a);
    const overridesB = hasCustomToString(b);
    if (overridesA !== overridesB) return false;
    const hasKeys = Object.keys(a).length > 0 || Object.keys(b).length > 0;
    if (hasKeys && !plainObjectsEqual(a, b)) return false;
    if (!overridesA) return hasKeys;
    try {
      return String(a) === String(b);
    } catch {
      return false;
    }
  }
  return plainObjectsEqual(a, b);
}

/**
 * Checks whether an object provides a `toString()` implementation other
 * than the generic `Object.prototype.toString`.
 */
function hasCustomToString(value: object): boolean {
  // Reading the property can throw for exotic objects (a Proxy or a
  // throwing getter); treat those as having no usable toString().
  try {
    const toString = (value as { toString?: unknown }).toString;
    return typeof toString === "function" &&
      toString !== Object.prototype.toString;
  } catch {
    return false;
  }
}

/**
 * Compares two objects by their enumerable own keys, recursing into the
 * values with {@link valuesEqual}.
 */
function plainObjectsEqual(a: object, b: object): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const bRecord = b as Record<string, unknown>;
  return aKeys.every((key) =>
    Object.hasOwn(b, key) &&
    valuesEqual((a as Record<string, unknown>)[key], bRecord[key])
  );
}
