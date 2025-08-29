import {
  formatMessage,
  type Message,
  type MessageFormatOptions,
} from "@optique/core/message";
import process from "node:process";

/**
 * Options for the {@link print} function.
 * @since 0.3.0
 */
export interface PrintOptions extends MessageFormatOptions {
  /**
   * The output stream to write to.
   * @default `"stdout"`
   */
  readonly stream?: "stdout" | "stderr";
}

/**
 * Options for the {@link printError} function.
 * @since 0.3.0
 */
export interface PrintErrorOptions extends PrintOptions {
  /**
   * The output stream to write to.
   * @default `"stderr"`
   */
  readonly stream?: "stdout" | "stderr";

  /**
   * Exit code to use when exiting the process.
   * If specified, the process will exit with this code after printing the error.
   */
  readonly exitCode?: number;
}

/**
 * Options for creating a custom printer.
 * @since 0.3.0
 */
export interface PrinterOptions extends MessageFormatOptions {
  /**
   * The output stream to write to.
   * @default `"stdout"`
   */
  readonly stream?: "stdout" | "stderr";
}

/**
 * A printer function that outputs formatted messages.
 * @param message The structured message to print.
 * @since 0.3.0
 */
export type Printer = (message: Message) => void;

/**
 * Prints a formatted message to stdout with automatic terminal detection.
 *
 * This function automatically detects terminal capabilities (colors, width)
 * and formats the message accordingly. It's ideal for general application
 * output that should be visible to users.
 *
 * @param message The structured message to print.
 * @param options Optional formatting options to override defaults.
 *
 * @example
 * ```typescript
 * import { print } from "@optique/run";
 * import { message, optionName } from "@optique/core/message";
 *
 * const configFile = "config.json";
 * const port = 3000;
 *
 * print(message`Configuration loaded from ${configFile}`);
 * print(message`Using ${optionName("--port")} ${port}`);
 * ```
 *
 * @since 0.3.0
 */
export function print(message: Message, options: PrintOptions = {}): void {
  const printer = createPrinter({
    stream: options.stream ?? "stdout",
    colors: options.colors,
    quotes: options.quotes,
    maxWidth: options.maxWidth,
  });

  printer(message);
}

/**
 * Prints a formatted error message to stderr with automatic terminal detection.
 *
 * This function automatically detects terminal capabilities and formats error
 * messages with an "Error: " prefix. Optionally exits the process with a
 * specified exit code.
 *
 * @param message The structured error message to print.
 * @param options Optional formatting options and exit code.
 *
 * @example
 * ```typescript
 * import { printError } from "@optique/run";
 * import { message, optionName } from "@optique/core/message";
 *
 * const filename = "missing.txt";
 *
 * // Print error and continue
 * printError(message`File ${filename} not found`);
 *
 * // Print error and exit with code 2
 * printError(message`Invalid ${optionName("--config")} value`, { exitCode: 2 });
 * ```
 *
 * @since 0.3.0
 */
export function printError(
  message: Message,
  options: PrintErrorOptions & { exitCode: number },
): never;
export function printError(
  message: Message,
  options?: PrintErrorOptions,
): void;
export function printError(
  message: Message,
  options: PrintErrorOptions = {},
): void | never {
  const stream = options.stream ?? "stderr";
  const output = process[stream];

  // Special handling for printError: use quotes in non-TTY environments by default
  const quotes = options.quotes ?? !output.isTTY;

  const printer = createPrinter({
    stream,
    colors: options.colors,
    quotes,
    maxWidth: options.maxWidth,
  });

  // Format the message with Error prefix
  const errorMessage: Message = [
    { type: "text", text: "Error: " },
    ...message,
  ];

  printer(errorMessage);

  if (options.exitCode != null) {
    process.exit(options.exitCode);
  }
}

/**
 * Creates a custom printer function with predefined formatting options.
 *
 * This is useful when you need consistent formatting across multiple print
 * operations or when you want to override the automatic terminal detection.
 *
 * @param options Formatting options for the printer.
 * @returns A printer function that can be called with messages.
 *
 * @example
 * ```typescript
 * import { createPrinter } from "@optique/run";
 * import { message, metavar } from "@optique/core/message";
 *
 * // Create a printer with forced colors and no quotes
 * const printer = createPrinter({
 *   colors: true,
 *   quotes: false,
 *   stream: "stdout",
 * });
 *
 * printer(message`Starting server on ${metavar("PORT")}...`);
 * printer(message`Ready to accept connections`);
 * ```
 *
 * @since 0.3.0
 */
export function createPrinter(options: PrinterOptions = {}): Printer {
  const stream = options.stream ?? "stdout";
  const output = process[stream];

  const formatOptions: MessageFormatOptions = {
    colors: options.colors ?? output.isTTY,
    quotes: options.quotes,
    maxWidth: options.maxWidth ?? output.columns,
  };

  return (message: Message) => {
    const formatted = formatMessage(message, formatOptions);

    if (stream === "stderr") {
      console.error(formatted);
    } else {
      console.log(formatted);
    }
  };
}
