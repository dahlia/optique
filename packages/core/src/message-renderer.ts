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
