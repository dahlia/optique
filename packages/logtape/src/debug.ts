import { flag } from "@optique/core/primitives";
import { map, optional } from "@optique/core/modifiers";
import type { Parser } from "@optique/core/parser";
import type { Message } from "@optique/core/message";
import type { OptionName } from "@optique/core/usage";
import type { LogLevel } from "@logtape/logtape";

/**
 * Options for creating a debug flag parser.
 * @since 0.8.0
 */
export interface DebugOptions {
  /**
   * Short option name for the debug flag.
   * @default `"-d"`
   */
  readonly short?: string;

  /**
   * Long option name for the debug flag.
   * @default `"--debug"`
   */
  readonly long?: string;

  /**
   * The log level to use when the debug flag is present.
   * @default `"debug"`
   */
  readonly debugLevel?: LogLevel;

  /**
   * The log level to use when the debug flag is not present.
   * @default `"info"`
   */
  readonly normalLevel?: LogLevel;

  /**
   * Description to show in help text.
   */
  readonly description?: Message;
}

/**
 * Creates a parser for a debug flag (`-d`, `--debug`).
 *
 * This parser provides a simple boolean toggle for enabling debug-level
 * logging. When the flag is present, it returns the debug level; otherwise,
 * it returns the normal level.
 *
 * @param options Configuration options for the debug flag parser.
 * @returns A {@link Parser} that produces a {@link LogLevel}.
 *
 * @example Basic usage
 * ```typescript
 * import { debug } from "@optique/logtape";
 * import { object } from "@optique/core/constructs";
 *
 * const parser = object({
 *   logLevel: debug(),
 * });
 *
 * // No flag -> "info"
 * // --debug or -d -> "debug"
 * ```
 *
 * @example Custom levels
 * ```typescript
 * import { debug } from "@optique/logtape";
 *
 * const parser = debug({
 *   debugLevel: "trace",
 *   normalLevel: "warning",
 * });
 * // No flag -> "warning"
 * // --debug -> "trace"
 * ```
 *
 * @since 0.8.0
 */
export function debug(
  options: DebugOptions = {},
): Parser<LogLevel, unknown> {
  const short = (options.short ?? "-d") as OptionName;
  const long = (options.long ?? "--debug") as OptionName;
  const debugLevel = options.debugLevel ?? "debug";
  const normalLevel = options.normalLevel ?? "info";

  const flagParser = flag(short, long, {
    description: options.description,
  });

  return map(
    optional(flagParser),
    (value: true | undefined) => {
      return value === true ? debugLevel : normalLevel;
    },
  );
}
