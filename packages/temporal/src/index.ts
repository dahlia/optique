import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

/**
 * IANA Time Zone Database identifier.
 *
 * Represents valid timezone identifiers that follow the IANA timezone naming
 * convention:
 *
 * - Two-level: `"Asia/Seoul"`, `"America/New_York"`, `"Europe/London"`
 * - Three-level: `"America/Argentina/Buenos_Aires"`, `"America/Kentucky/Louisville"`
 * - Special case: `"UTC"`
 *
 * @example
 * ```typescript
 * const seoul: TimeZone = "Asia/Seoul";
 * const utc: TimeZone = "UTC";
 * const buenosAires: TimeZone = "America/Argentina/Buenos_Aires";
 * ```
 */
export type TimeZone =
  | `${string}/${string}/${string}`
  | `${string}/${string}`
  | "UTC";

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
  readonly metavar?: string;
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
  readonly metavar?: string;
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
  readonly metavar?: string;
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
  readonly metavar?: string;
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
  readonly metavar?: string;
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
  readonly metavar?: string;
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
  readonly metavar?: string;
}

/**
 * Options for creating a plain month-day parser.
 */
export interface PlainMonthDayOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `--MONTH-DAY`.
   * @default `"--MONTH-DAY"`
   */
  readonly metavar?: string;
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
  readonly metavar?: string;
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
 */
export function instant(
  options: InstantOptions = {},
): ValueParser<Temporal.Instant> {
  return {
    metavar: options.metavar ?? "TIMESTAMP",
    parse(input: string): ValueParserResult<Temporal.Instant> {
      try {
        const value = Temporal.Instant.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error:
            message`Invalid instant: ${input}. Expected ISO 8601 format like ${"2020-01-23T17:04:36Z"}.`,
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
 */
export function duration(
  options: DurationOptions = {},
): ValueParser<Temporal.Duration> {
  return {
    metavar: options.metavar ?? "DURATION",
    parse(input: string): ValueParserResult<Temporal.Duration> {
      try {
        const value = Temporal.Duration.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error:
            message`Invalid duration: ${input}. Expected ISO 8601 format like ${"PT1H30M"}.`,
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
 */
export function zonedDateTime(
  options: ZonedDateTimeOptions = {},
): ValueParser<Temporal.ZonedDateTime> {
  return {
    metavar: options.metavar ?? "ZONED_DATETIME",
    parse(input: string): ValueParserResult<Temporal.ZonedDateTime> {
      try {
        const value = Temporal.ZonedDateTime.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error:
            message`Invalid zoned datetime: ${input}. Expected ISO 8601 format with timezone like ${"2020-01-23T17:04:36+01:00[Europe/Paris]"}.`,
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
 */
export function plainDate(
  options: PlainDateOptions = {},
): ValueParser<Temporal.PlainDate> {
  return {
    metavar: options.metavar ?? "DATE",
    parse(input: string): ValueParserResult<Temporal.PlainDate> {
      try {
        const value = Temporal.PlainDate.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error:
            message`Invalid date: ${input}. Expected ISO 8601 format like ${"2020-01-23"}.`,
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
 */
export function plainTime(
  options: PlainTimeOptions = {},
): ValueParser<Temporal.PlainTime> {
  return {
    metavar: options.metavar ?? "TIME",
    parse(input: string): ValueParserResult<Temporal.PlainTime> {
      try {
        const value = Temporal.PlainTime.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error:
            message`Invalid time: ${input}. Expected ISO 8601 format like ${"17:04:36"}.`,
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
 */
export function plainDateTime(
  options: PlainDateTimeOptions = {},
): ValueParser<Temporal.PlainDateTime> {
  return {
    metavar: options.metavar ?? "DATETIME",
    parse(input: string): ValueParserResult<Temporal.PlainDateTime> {
      try {
        const value = Temporal.PlainDateTime.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error:
            message`Invalid datetime: ${input}. Expected ISO 8601 format like ${"2020-01-23T17:04:36"}.`,
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
 */
export function plainYearMonth(
  options: PlainYearMonthOptions = {},
): ValueParser<Temporal.PlainYearMonth> {
  return {
    metavar: options.metavar ?? "YEAR-MONTH",
    parse(input: string): ValueParserResult<Temporal.PlainYearMonth> {
      try {
        const value = Temporal.PlainYearMonth.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error:
            message`Invalid year-month: ${input}. Expected ISO 8601 format like ${"2020-01"}.`,
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
 * - `"--01-23"`
 * - `"--12-31"`
 *
 * @param options Configuration options for the plain month-day parser.
 * @returns A ValueParser that parses strings into Temporal.PlainMonthDay values.
 */
export function plainMonthDay(
  options: PlainMonthDayOptions = {},
): ValueParser<Temporal.PlainMonthDay> {
  return {
    metavar: options.metavar ?? "--MONTH-DAY",
    parse(input: string): ValueParserResult<Temporal.PlainMonthDay> {
      try {
        const value = Temporal.PlainMonthDay.from(input);
        return { success: true, value };
      } catch {
        return {
          success: false,
          error:
            message`Invalid month-day: ${input}. Expected ISO 8601 format like ${"--01-23"}.`,
        };
      }
    },
    format(value: Temporal.PlainMonthDay): string {
      return value.toString();
    },
  };
}

/**
 * Creates a ValueParser for parsing IANA Time Zone Database identifiers.
 *
 * Accepts strings like:
 *
 * - `"Asia/Seoul"`
 * - `"America/New_York"`
 * - `"Europe/London"`
 * - `"UTC"`
 *
 * @param options Configuration options for the timezone parser.
 * @returns A ValueParser that parses and validates timezone identifiers.
 */
export function timeZone(options: TimeZoneOptions = {}): ValueParser<TimeZone> {
  return {
    metavar: options.metavar ?? "TIMEZONE",
    parse(input: string): ValueParserResult<TimeZone> {
      try {
        // Validate by creating a ZonedDateTime with this timezone
        // This will throw if the timezone is invalid
        Temporal.ZonedDateTime.from({
          year: 2020,
          month: 1,
          day: 1,
          timeZone: input,
        });
        return { success: true, value: input as TimeZone };
      } catch {
        return {
          success: false,
          error:
            message`Invalid timezone identifier: ${input}. Must be a valid IANA timezone like "Asia/Seoul" or "UTC".`,
        };
      }
    },
    format(value: TimeZone): string {
      return value;
    },
  };
}
