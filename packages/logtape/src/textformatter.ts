import {
  ansiColorFormatter,
  defaultTextFormatter,
  jsonLinesFormatter,
  logfmtFormatter,
  type TextFormatter,
} from "@logtape/logtape";
import { biject, type ValueParser } from "@optique/core/valueparser";

/**
 * The names accepted by {@link textFormatter}.
 * @since 1.2.0
 */
export type TextFormatterName = "jsonl" | "logfmt" | "color" | "plain";

const textFormatters: Record<TextFormatterName, TextFormatter> = {
  jsonl: jsonLinesFormatter,
  logfmt: logfmtFormatter,
  color: ansiColorFormatter,
  plain: defaultTextFormatter,
};

/**
 * Creates a {@link ValueParser} for LogTape text formatters.
 *
 * This parser accepts `"jsonl"`, `"logfmt"`, `"color"`, and `"plain"` and
 * maps them to LogTape's `jsonLinesFormatter`, `logfmtFormatter`,
 * `ansiColorFormatter`, and `defaultTextFormatter` respectively.
 *
 * @returns A {@link ValueParser} that converts formatter names to
 *   LogTape text formatter functions.
 *
 * @example
 * ```typescript
 * import { option } from "@optique/core";
 * import { textFormatter } from "@optique/logtape";
 *
 * const parser = option("--log-format", textFormatter());
 * ```
 *
 * @since 1.2.0
 */
export function textFormatter(): ValueParser<"sync", TextFormatter> {
  return biject(textFormatters);
}
