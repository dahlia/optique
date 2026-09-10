import type { TerminalStyle } from "./terminal.ts";
import type {
  Message,
  MessageFormatOptions,
  MessageFormatter,
} from "./message.ts";

export const messageRenderers = new WeakMap<
  MessageFormatter,
  (
    message: Message,
    options: MessageFormatOptions,
    ambient?: TerminalStyle,
  ) => string
>();
