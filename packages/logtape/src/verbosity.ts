import { flag } from "@optique/core/primitives";
import { map, multiple } from "@optique/core/modifiers";
import type { Parser } from "@optique/core/parser";
import { type Message, message } from "@optique/core/message";
import type { OptionName } from "@optique/core/usage";
import type { LogLevel } from "@logtape/logtape";

/**
 * Options for creating a verbosity parser.
 * @since 0.8.0
 */
export interface VerbosityOptions {
  /**
   * Short option name for the verbosity flag.
   * @default `"-v"`
   */
  readonly short?: string;

  /**
   * Long option name for the verbosity flag.
   * @default `"--verbose"`
   */
  readonly long?: string;

  /**
   * The base log level when no verbosity flags are provided.
   * @default `"warning"`
   */
  readonly baseLevel?: LogLevel;

  /**
   * Description to show in help text.
   */
  readonly description?: Message;
}

/**
 * Mapping from verbosity count (offset from base) to log level.
 * Index 0 is base, 1 is base+1 flag, 2 is base+2 flags, etc.
 */
const VERBOSITY_LEVELS: readonly LogLevel[] = [
  "fatal", // -2 from warning (not reachable in practice)
  "error", // -1 from warning
  "warning", // base (0 flags)
  "info", // +1 flag
  "debug", // +2 flags
  "trace", // +3 flags
];

/**
 * Index of "warning" in VERBOSITY_LEVELS (the default base level).
 */
const WARNING_INDEX = 2;

/**
 * Creates a parser for verbosity flags (`-v`, `-vv`, `-vvv`, etc.).
 *
 * This parser accumulates `-v` flags to determine the log level.
 * Each additional `-v` flag increases the verbosity (decreases the log level
 * severity).
 *
 * Default level mapping with `baseLevel: "warning"`:
 * - No flags: `"warning"`
 * - `-v`: `"info"`
 * - `-vv`: `"debug"`
 * - `-vvv` or more: `"trace"`
 *
 * @param options Configuration options for the verbosity parser.
 * @returns A {@link Parser} that produces a {@link LogLevel}.
 *
 * @example Basic usage
 * ```typescript
 * import { verbosity } from "@optique/logtape";
 * import { object } from "@optique/core/constructs";
 *
 * const parser = object({
 *   logLevel: verbosity(),
 * });
 *
 * // No flags -> "warning"
 * // -v -> "info"
 * // -vv -> "debug"
 * // -vvv -> "trace"
 * ```
 *
 * @example Custom base level
 * ```typescript
 * import { verbosity } from "@optique/logtape";
 *
 * const parser = verbosity({ baseLevel: "error" });
 * // No flags -> "error"
 * // -v -> "warning"
 * // -vv -> "info"
 * // -vvv -> "debug"
 * // -vvvv -> "trace"
 * ```
 *
 * @since 0.8.0
 */
export function verbosity(
  options: VerbosityOptions = {},
): Parser<"sync", LogLevel, unknown> {
  const short = (options.short ?? "-v") as OptionName;
  const long = (options.long ?? "--verbose") as OptionName;
  const baseLevel = options.baseLevel ?? "warning";

  // Find the index of the base level
  const baseIndex = VERBOSITY_LEVELS.indexOf(baseLevel);
  const effectiveBaseIndex = baseIndex >= 0 ? baseIndex : WARNING_INDEX;

  const flagParser = flag(short, long, {
    description: options.description ??
      message`Be more verbose. Can be repeated.`,
  });

  // Create a parser that allows multiple occurrences of the flag
  // The flag parser returns `true` when present, so multiple() collects them
  const multipleFlags = multiple(flagParser);

  return map(
    multipleFlags,
    (flags: readonly true[]) => {
      // Count the number of flags that were actually provided
      const count = flags.length;
      // Calculate the target level index (higher index = more verbose)
      const targetIndex = Math.min(
        effectiveBaseIndex + count,
        VERBOSITY_LEVELS.length - 1,
      );
      return VERBOSITY_LEVELS[targetIndex];
    },
  );
}
