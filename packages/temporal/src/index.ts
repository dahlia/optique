import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import type { Suggestion } from "@optique/core/parser";
import { type Message, message } from "@optique/core/message";
import {
  ensureNonEmptyString,
  type NonEmptyString,
} from "@optique/core/nonempty";

function ensureTemporal(): void {
  if (typeof globalThis.Temporal === "undefined") {
    throw new TypeError(
      "Temporal API is not available. " +
        "Use a runtime with Temporal support or install a polyfill " +
        "like @js-temporal/polyfill.",
    );
  }
}

/**
 * IANA Time Zone Database identifier.
 *
 * Represents valid timezone identifiers that follow the IANA timezone naming
 * convention:
 *
 * - Two-level: `"Asia/Seoul"`, `"America/New_York"`, `"Europe/London"`
 * - Three-level: `"America/Argentina/Buenos_Aires"`,
 *   `"America/Kentucky/Louisville"`
 * - Standard single-segment: `"UTC"`, `"GMT"`, `"Universal"`
 * - POSIX abbreviations: `"EST"`, `"CET"`, `"EST5EDT"`
 * - Deprecated aliases: `"Japan"`, `"Singapore"`, `"Cuba"`
 *
 * @example
 * ```typescript
 * const seoul: TimeZone = "Asia/Seoul";
 * const utc: TimeZone = "UTC";
 * const gmt: TimeZone = "GMT";
 * const buenosAires: TimeZone = "America/Argentina/Buenos_Aires";
 * ```
 */
export type TimeZone =
  | `${string}/${string}/${string}`
  | `${string}/${string}`
  | SingleSegmentTimeZone;

/**
 * Options for creating an instant parser.
 */
export interface InstantOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `TIMESTAMP` or `INSTANT`.
   * @default `"TIMESTAMP"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for instant parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid instant format.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidFormat?: Message | ((input: string) => Message);
  };
}

/**
 * Options for creating a duration parser.
 */
export interface DurationOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `DURATION`.
   * @default `"DURATION"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for duration parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid duration format.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidFormat?: Message | ((input: string) => Message);
  };
}

/**
 * Options for creating a zoned datetime parser.
 */
export interface ZonedDateTimeOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `ZONED_DATETIME`.
   * @default `"ZONED_DATETIME"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for zoned datetime parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid zoned datetime format.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidFormat?: Message | ((input: string) => Message);
  };
}

/**
 * Options for creating a plain date parser.
 */
export interface PlainDateOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `DATE`.
   * @default `"DATE"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for plain date parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid date format.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidFormat?: Message | ((input: string) => Message);
  };
}

/**
 * Options for creating a plain time parser.
 */
export interface PlainTimeOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `TIME`.
   * @default `"TIME"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for plain time parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid time format.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidFormat?: Message | ((input: string) => Message);
  };
}

/**
 * Options for creating a plain datetime parser.
 */
export interface PlainDateTimeOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `DATETIME`.
   * @default `"DATETIME"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for plain datetime parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid datetime format.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidFormat?: Message | ((input: string) => Message);
  };
}

/**
 * Options for creating a plain year-month parser.
 */
export interface PlainYearMonthOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `YEAR-MONTH`.
   * @default `"YEAR-MONTH"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for plain year-month parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid year-month format.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidFormat?: Message | ((input: string) => Message);
  };
}

/**
 * Options for creating a plain month-day parser.
 */
export interface PlainMonthDayOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `MONTH-DAY`.
   * @default `"MONTH-DAY"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for plain month-day parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid month-day format.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidFormat?: Message | ((input: string) => Message);
  };
}

/**
 * Options for creating a timezone parser.
 */
export interface TimeZoneOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `TIMEZONE`.
   * @default `"TIMEZONE"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for timezone parsing failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid timezone identifier.
     * Can be a static message or a function that receives the input.
     * @since 0.5.0
     */
    invalidFormat?: Message | ((input: string) => Message);
  };
}

/**
 * Creates a ValueParser for parsing Temporal.Instant from ISO 8601 strings.
 *
 * Accepts strings like:
 *
 * - `"2020-01-23T17:04:36.491865121Z"`
 * - `"2020-01-23T17:04:36Z"`
 *
 * @param options Configuration options for the instant parser.
 * @returns A ValueParser that parses strings into Temporal.Instant values.
 * @throws {TypeError} (from `parse()`) If the Temporal API is not available
 *   at runtime.
 */
export function instant(
  options: InstantOptions = {},
): ValueParser<"sync", Temporal.Instant> {
  const metavar = options.metavar ?? "TIMESTAMP";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<Temporal.Instant> {
      ensureTemporal();
      try {
        const value = Temporal.Instant.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error: options.errors?.invalidFormat
            ? (typeof options.errors.invalidFormat === "function"
              ? options.errors.invalidFormat(input)
              : options.errors.invalidFormat)
            : message`Invalid instant: ${input}. Expected ISO 8601 format like ${"2020-01-23T17:04:36Z"}.`,
        };
      }
    },
    format(value: Temporal.Instant): string {
      return value.toString();
    },
  };
}

/**
 * Creates a ValueParser for parsing Temporal.Duration from ISO 8601 duration strings.
 *
 * Accepts strings like:
 *
 * - `"PT1H30M"`
 * - `"P1DT12H"`
 * - `"PT30S"`
 *
 * @param options Configuration options for the duration parser.
 * @returns A ValueParser that parses strings into Temporal.Duration values.
 * @throws {TypeError} (from `parse()`) If the Temporal API is not available
 *   at runtime.
 */
export function duration(
  options: DurationOptions = {},
): ValueParser<"sync", Temporal.Duration> {
  const metavar = options.metavar ?? "DURATION";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<Temporal.Duration> {
      ensureTemporal();
      try {
        const value = Temporal.Duration.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error: options.errors?.invalidFormat
            ? (typeof options.errors.invalidFormat === "function"
              ? options.errors.invalidFormat(input)
              : options.errors.invalidFormat)
            : message`Invalid duration: ${input}. Expected ISO 8601 format like ${"PT1H30M"}.`,
        };
      }
    },
    format(value: Temporal.Duration): string {
      return value.toString();
    },
  };
}

/**
 * Creates a ValueParser for parsing Temporal.ZonedDateTime from ISO 8601 strings with timezone.
 *
 * Accepts strings like:
 *
 * - `"2020-01-23T17:04:36.491865121+01:00[Europe/Paris]"`
 * - `"2020-01-23T17:04:36Z[UTC]"`
 *
 * @param options Configuration options for the zoned datetime parser.
 * @returns A ValueParser that parses strings into Temporal.ZonedDateTime values.
 * @throws {TypeError} (from `parse()`) If the Temporal API is not available
 *   at runtime.
 */
export function zonedDateTime(
  options: ZonedDateTimeOptions = {},
): ValueParser<"sync", Temporal.ZonedDateTime> {
  const metavar = options.metavar ?? "ZONED_DATETIME";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<Temporal.ZonedDateTime> {
      ensureTemporal();
      try {
        const value = Temporal.ZonedDateTime.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error: options.errors?.invalidFormat
            ? (typeof options.errors.invalidFormat === "function"
              ? options.errors.invalidFormat(input)
              : options.errors.invalidFormat)
            : message`Invalid zoned datetime: ${input}. Expected ISO 8601 format with timezone like ${"2020-01-23T17:04:36+01:00[Europe/Paris]"}.`,
        };
      }
    },
    format(value: Temporal.ZonedDateTime): string {
      return value.toString();
    },
  };
}

/**
 * Creates a ValueParser for parsing Temporal.PlainDate from ISO 8601 date strings.
 *
 * Accepts strings like:
 *
 * - `"2020-01-23"`
 * - `"2020-12-31"`
 *
 * @param options Configuration options for the plain date parser.
 * @returns A ValueParser that parses strings into Temporal.PlainDate values.
 * @throws {TypeError} (from `parse()`) If the Temporal API is not available
 *   at runtime.
 */
export function plainDate(
  options: PlainDateOptions = {},
): ValueParser<"sync", Temporal.PlainDate> {
  const metavar = options.metavar ?? "DATE";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<Temporal.PlainDate> {
      ensureTemporal();
      try {
        const value = Temporal.PlainDate.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error: options.errors?.invalidFormat
            ? (typeof options.errors.invalidFormat === "function"
              ? options.errors.invalidFormat(input)
              : options.errors.invalidFormat)
            : message`Invalid date: ${input}. Expected ISO 8601 format like ${"2020-01-23"}.`,
        };
      }
    },
    format(value: Temporal.PlainDate): string {
      return value.toString();
    },
  };
}

/**
 * Creates a ValueParser for parsing Temporal.PlainTime from ISO 8601 time strings.
 *
 * Accepts strings like:
 *
 * - `"17:04:36"`
 * - `"17:04:36.491865121"`
 *
 * @param options Configuration options for the plain time parser.
 * @returns A ValueParser that parses strings into Temporal.PlainTime values.
 * @throws {TypeError} (from `parse()`) If the Temporal API is not available
 *   at runtime.
 */
export function plainTime(
  options: PlainTimeOptions = {},
): ValueParser<"sync", Temporal.PlainTime> {
  const metavar = options.metavar ?? "TIME";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<Temporal.PlainTime> {
      ensureTemporal();
      try {
        const value = Temporal.PlainTime.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error: options.errors?.invalidFormat
            ? (typeof options.errors.invalidFormat === "function"
              ? options.errors.invalidFormat(input)
              : options.errors.invalidFormat)
            : message`Invalid time: ${input}. Expected ISO 8601 format like ${"17:04:36"}.`,
        };
      }
    },
    format(value: Temporal.PlainTime): string {
      return value.toString();
    },
  };
}

/**
 * Creates a ValueParser for parsing Temporal.PlainDateTime from ISO 8601 datetime strings.
 *
 * Accepts strings like:
 *
 * - `"2020-01-23T17:04:36"`
 * - `"2020-01-23T17:04:36.491865121"`
 *
 * @param options Configuration options for the plain datetime parser.
 * @returns A ValueParser that parses strings into Temporal.PlainDateTime values.
 * @throws {TypeError} (from `parse()`) If the Temporal API is not available
 *   at runtime.
 */
export function plainDateTime(
  options: PlainDateTimeOptions = {},
): ValueParser<"sync", Temporal.PlainDateTime> {
  const metavar = options.metavar ?? "DATETIME";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<Temporal.PlainDateTime> {
      ensureTemporal();
      try {
        const value = Temporal.PlainDateTime.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error: options.errors?.invalidFormat
            ? (typeof options.errors.invalidFormat === "function"
              ? options.errors.invalidFormat(input)
              : options.errors.invalidFormat)
            : message`Invalid datetime: ${input}. Expected ISO 8601 format like ${"2020-01-23T17:04:36"}.`,
        };
      }
    },
    format(value: Temporal.PlainDateTime): string {
      return value.toString();
    },
  };
}

/**
 * Creates a ValueParser for parsing Temporal.PlainYearMonth from ISO 8601 year-month strings.
 *
 * Accepts strings like:
 *
 * - `"2020-01"`
 * - `"2020-12"`
 *
 * @param options Configuration options for the plain year-month parser.
 * @returns A ValueParser that parses strings into Temporal.PlainYearMonth values.
 * @throws {TypeError} (from `parse()`) If the Temporal API is not available
 *   at runtime.
 */
export function plainYearMonth(
  options: PlainYearMonthOptions = {},
): ValueParser<"sync", Temporal.PlainYearMonth> {
  const metavar = options.metavar ?? "YEAR-MONTH";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<Temporal.PlainYearMonth> {
      ensureTemporal();
      try {
        const value = Temporal.PlainYearMonth.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error: options.errors?.invalidFormat
            ? (typeof options.errors.invalidFormat === "function"
              ? options.errors.invalidFormat(input)
              : options.errors.invalidFormat)
            : message`Invalid year-month: ${input}. Expected ISO 8601 format like ${"2020-01"}.`,
        };
      }
    },
    format(value: Temporal.PlainYearMonth): string {
      return value.toString();
    },
  };
}

/**
 * Creates a ValueParser for parsing Temporal.PlainMonthDay from ISO 8601 month-day strings.
 *
 * Accepts strings like:
 *
 * - `"01-23"`
 * - `"12-31"`
 *
 * @param options Configuration options for the plain month-day parser.
 * @returns A ValueParser that parses strings into Temporal.PlainMonthDay values.
 * @throws {TypeError} (from `parse()`) If the Temporal API is not available
 *   at runtime.
 */
export function plainMonthDay(
  options: PlainMonthDayOptions = {},
): ValueParser<"sync", Temporal.PlainMonthDay> {
  const metavar = options.metavar ?? "MONTH-DAY";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<Temporal.PlainMonthDay> {
      ensureTemporal();
      try {
        const value = Temporal.PlainMonthDay.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error: options.errors?.invalidFormat
            ? (typeof options.errors.invalidFormat === "function"
              ? options.errors.invalidFormat(input)
              : options.errors.invalidFormat)
            : message`Invalid month-day: ${input}. Expected ISO 8601 format like ${"01-23"}.`,
        };
      }
    },
    format(value: Temporal.PlainMonthDay): string {
      return value.toString();
    },
  };
}

/**
 * Single-segment IANA timezone identifiers accepted across all supported
 * runtimes (Deno, Node.js, Bun).  This tuple is the single source of truth:
 * {@link SingleSegmentTimeZone} is derived from it, and the runtime lookup
 * {@link singleSegmentTimeZoneLookup} is built from it.
 */
const singleSegmentTimeZoneList = [
  "UTC",
  "GMT",
  "GMT0",
  "GMT+0",
  "GMT-0",
  "UCT",
  "Universal",
  "Greenwich",
  "Zulu",
  "EST",
  "MST",
  "HST",
  "CET",
  "MET",
  "WET",
  "EET",
  "EST5EDT",
  "CST6CDT",
  "MST7MDT",
  "PST8PDT",
  "Cuba",
  "Egypt",
  "Eire",
  "GB",
  "GB-Eire",
  "Hongkong",
  "Iceland",
  "Iran",
  "Israel",
  "Jamaica",
  "Japan",
  "Kwajalein",
  "Libya",
  "Navajo",
  "NZ",
  "NZ-CHAT",
  "Poland",
  "Portugal",
  "PRC",
  "ROC",
  "ROK",
  "Singapore",
  "Turkey",
  "W-SU",
] as const;

type SingleSegmentTimeZone = typeof singleSegmentTimeZoneList[number];

const singleSegmentTimeZoneLookup: ReadonlyMap<string, SingleSegmentTimeZone> =
  new Map(
    singleSegmentTimeZoneList.map((timeZone) => [
      timeZone.toLowerCase(),
      timeZone,
    ]),
  );

/**
 * Creates a ValueParser for parsing IANA Time Zone Database identifiers.
 *
 * Accepts strings like:
 *
 * - `"Asia/Seoul"`
 * - `"America/New_York"`
 * - `"Europe/London"`
 * - `"UTC"`
 * - `"GMT"`
 * - `"EST"`
 *
 * @param options Configuration options for the timezone parser.
 * @returns A ValueParser that parses and validates timezone identifiers.
 * @throws {TypeError} (from `parse()`) If the Temporal API is not available
 *   at runtime.
 */
export function timeZone(
  options: TimeZoneOptions = {},
): ValueParser<"sync", TimeZone> {
  const metavar = options.metavar ?? "TIMEZONE";
  ensureNonEmptyString(metavar);
  return {
    $mode: "sync",
    metavar,
    parse(input: string): ValueParserResult<TimeZone> {
      ensureTemporal();
      try {
        // Validate by creating a ZonedDateTime with this timezone
        // This will throw if the timezone is invalid
        Temporal.ZonedDateTime.from({
          year: 2020,
          month: 1,
          day: 1,
          timeZone: input,
        });
        // For single-segment identifiers (no "/"), only accept those
        // in the curated allowlist to ensure cross-runtime consistency.
        // Some Temporal implementations accept identifiers (e.g.,
        // "Factory") that others reject.  The lookup is
        // case-insensitive and normalizes to canonical casing so the
        // returned value is always a valid SingleSegmentTimeZone member.
        if (!input.includes("/")) {
          const canonical = singleSegmentTimeZoneLookup.get(
            input.toLowerCase(),
          );
          if (canonical == null) {
            throw new RangeError();
          }
          return { success: true, value: canonical };
        }
        return { success: true, value: input as TimeZone };
      } catch {
        return {
          success: false,
          error: options.errors?.invalidFormat
            ? (typeof options.errors.invalidFormat === "function"
              ? options.errors.invalidFormat(input)
              : options.errors.invalidFormat)
            : message`Invalid timezone identifier: ${input}. Must be a valid IANA timezone like "Asia/Seoul" or "UTC".`,
        };
      }
    },
    format(value: TimeZone): string {
      return value;
    },
    *suggest(prefix: string): Iterable<Suggestion> {
      let timezones: string[];

      try {
        // Use the modern Intl API to get all supported timezones
        timezones = Intl.supportedValuesOf("timeZone");
      } catch {
        // If Intl.supportedValuesOf is not available, provide at least UTC and GMT
        timezones = ["UTC", "GMT"];
      }

      // Always ensure UTC and GMT are included if they're not already
      if (!timezones.includes("UTC")) timezones.unshift("UTC");
      if (!timezones.includes("GMT")) timezones.unshift("GMT");

      for (const timezone of timezones) {
        if (timezone.toLowerCase().startsWith(prefix.toLowerCase())) {
          yield {
            kind: "literal",
            text: timezone,
          };
        }
      }
    },
  };
}
