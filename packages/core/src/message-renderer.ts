import { hasAutomaticWidth, reportAutomaticWidth } from "./terminal-width.ts";
import { renderTerminalTerm } from "./terminal-internal.ts";
import { measureText, placeText, spaceAfterLabel } from "./text-layout.ts";
import {
  createMessageFormatter,
  formatMessage,
  type Message,
  type MessageFormatOptions,
  type MessageFormatter,
} from "./message.ts";
import type { TerminalStyle, TerminalTheme } from "./terminal.ts";
import { messageRenderers } from "./message-registry.ts";
/**
 * Resolves a presentation surface's formatter while preserving built-in
 * ambient styling and normalizing legacy color options for custom formatters.
 * @param options The surface's explicit formatter and fallback theme.
 * @returns A formatter that accepts legacy options and an ambient style.
 * @since 1.3.0
 * @internal
 */
export function resolveMessageFormatter(
  options: {
    readonly messageFormatter?: MessageFormatter;
    readonly theme?: TerminalTheme;
  },
): (
  message: Message,
  options?: MessageFormatOptions,
  ambient?: TerminalStyle,
) => string {
  const formatter = options.messageFormatter ??
    (options.theme == null
      ? formatMessage
      : createMessageFormatter(options.theme));
  return (message, options = {}, ambient) => {
    const builtin = messageRenderers.get(formatter);
    if (builtin != null) return builtin(message, options, ambient);
    return formatter(message, {
      ...options,
      colors: typeof options.colors === "object" ? true : options.colors,
    });
  };
}

/**
 * Assembles a themed error prefix and a message at one layout boundary.
 * Callers own streams, trailing newlines, and the default quoting policy.
 * Opaque formatter output is appended unchanged, including empty output.
 * @param message The original, unprefixed error message.
 * @param options Theme, formatter, and physical-line layout options.
 * @returns The prefixed message without an added trailing newline.
 * @throws {TypeError} If initialWidth is not a finite integer.
 * @throws {RangeError} If initialWidth is negative or a theme color is invalid.
 * @internal
 */
export function renderErrorMessage(
  message: Message,
  options: MessageFormatOptions & {
    readonly theme?: TerminalTheme;
    readonly messageFormatter?: MessageFormatter;
  } = {},
): string {
  const occupied = options.initialWidth ?? 0;
  if (!Number.isFinite(occupied) || !Number.isInteger(occupied)) {
    throw new TypeError("Initial width must be a finite integer.");
  }
  if (occupied < 0) throw new RangeError("Initial width must be nonnegative.");
  const colors = options.colors;
  const label = spaceAfterLabel(renderTerminalTerm(
    { type: "errorLabel", label: "Error:" },
    options.theme,
    typeof colors === "object" ? true : colors,
    undefined,
    undefined,
    typeof colors === "object" ? colors.resetSuffix : undefined,
  ));
  if (hasAutomaticWidth(options) && options.maxWidth != null) {
    const size = measureText(label);
    if (
      options.maxWidth <
        Math.max(size.maxLineWidth, occupied + size.lastLineWidth + 1)
    ) {
      options = { ...options, maxWidth: undefined };
    }
  }
  reportAutomaticWidth(options, options.maxWidth);
  const prefix = placeText(
    label,
    { line: "", column: occupied },
    options.maxWidth,
  );
  const formatted = resolveMessageFormatter(options)(message, {
    colors,
    quotes: options.quotes,
    maxWidth: options.maxWidth,
    initialWidth: prefix.cursor.column,
  });
  return prefix.text + formatted;
}
