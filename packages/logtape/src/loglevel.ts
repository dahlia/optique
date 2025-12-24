import {
  choice,
  type NonEmptyString,
  type ValueParser,
} from "@optique/core/valueparser";
import type { Message } from "@optique/core/message";
import type { LogLevel } from "@logtape/logtape";

/**
 * All valid log levels in order from lowest to highest severity.
 */
export const LOG_LEVELS: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
] as const;

/**
 * Options for creating a log level value parser.
 * @since 0.8.0
 */
export interface LogLevelOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects.
   * @default `"LEVEL"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for log level parsing failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input is not a valid log level.
     * Can be a static message or a function that receives the input string.
     */
    invalidLevel?: Message | ((input: string) => Message);
  };
}

/**
 * Creates a {@link ValueParser} for LogTape log levels.
 *
 * This parser validates that the input is one of the valid LogTape severity
 * levels: `"trace"`, `"debug"`, `"info"`, `"warning"`, `"error"`, or `"fatal"`.
 * The parsing is case-insensitive.
 *
 * @param options Configuration options for the log level parser.
 * @returns A {@link ValueParser} that converts string input to {@link LogLevel}.
 *
 * @example Basic usage
 * ```typescript
 * import { logLevel } from "@optique/logtape";
 * import { option, withDefault } from "@optique/core";
 *
 * const parser = object({
 *   level: withDefault(
 *     option("--log-level", "-l", logLevel()),
 *     "info"
 *   ),
 * });
 * ```
 *
 * @example Custom metavar
 * ```typescript
 * import { logLevel } from "@optique/logtape";
 *
 * const parser = logLevel({ metavar: "LOG_LEVEL" });
 * ```
 *
 * @since 0.8.0
 */
export function logLevel(options: LogLevelOptions = {}): ValueParser<LogLevel> {
  return choice(LOG_LEVELS, {
    metavar: options.metavar ?? "LEVEL",
    caseInsensitive: true,
    errors: options.errors?.invalidLevel != null
      ? {
        invalidChoice: typeof options.errors.invalidLevel === "function"
          ? (input: string, _choices: readonly string[]) =>
            (options.errors!.invalidLevel as (input: string) => Message)(input)
          : options.errors.invalidLevel,
      }
      : undefined,
  });
}
