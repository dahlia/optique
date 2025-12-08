import { option } from "@optique/core/primitives";
import { optional } from "@optique/core/modifiers";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import type { Parser, Suggestion } from "@optique/core/parser";
import { type Message, message } from "@optique/core/message";
import type { OptionName } from "@optique/core/usage";
import type { LogLevel, LogRecord, Sink } from "@logtape/logtape";

/**
 * Represents a log output destination.
 *
 * This is a discriminated union type that represents either console output
 * or file output.
 * @since 0.8.0
 */
export type LogOutput =
  | { readonly type: "console" }
  | { readonly type: "file"; readonly path: string };

/**
 * Options for configuring console sink creation.
 * @since 0.8.0
 */
export interface ConsoleSinkOptions {
  /**
   * The stream to write to. Either `"stdout"` or `"stderr"`.
   * @default `"stderr"`
   */
  readonly stream?: "stdout" | "stderr";

  /**
   * A function that determines which stream to use based on the log level.
   * If provided, this takes precedence over the `stream` option.
   *
   * @example
   * ```typescript
   * // Write warnings and above to stderr, info and below to stdout
   * streamResolver: (level) =>
   *   level === "warning" || level === "error" || level === "fatal"
   *     ? "stderr"
   *     : "stdout"
   * ```
   */
  readonly streamResolver?: (level: LogLevel) => "stdout" | "stderr";
}

/**
 * Options for creating a log output parser.
 * @since 0.8.0
 */
export interface LogOutputOptions {
  /**
   * Long option name for the log output option.
   * @default `"--log-output"`
   */
  readonly long?: string;

  /**
   * Short option name for the log output option.
   */
  readonly short?: string;

  /**
   * The metavariable name shown in help text.
   * @default `"FILE"`
   */
  readonly metavar?: string;

  /**
   * Description to show in help text.
   */
  readonly description?: Message;

  /**
   * Custom error messages.
   */
  readonly errors?: {
    /**
     * Error message when the output path is empty.
     */
    emptyPath?: Message | ((input: string) => Message);
  };
}

/**
 * Creates a value parser for log output destinations.
 *
 * This parser accepts either `-` for console output or a file path for file
 * output. The `-` value follows the common CLI convention for representing
 * standard output/error.
 *
 * @param options Configuration options for the parser.
 * @returns A {@link ValueParser} that produces a {@link LogOutput}.
 */
function logOutputValueParser(
  options: LogOutputOptions = {},
): ValueParser<LogOutput> {
  return {
    metavar: options.metavar ?? "FILE",
    parse(input: string): ValueParserResult<LogOutput> {
      if (input === "-") {
        return { success: true, value: { type: "console" } };
      }
      if (input.trim() === "") {
        return {
          success: false,
          error: options.errors?.emptyPath
            ? typeof options.errors.emptyPath === "function"
              ? options.errors.emptyPath(input)
              : options.errors.emptyPath
            : message`Log output path cannot be empty.`,
        };
      }
      return { success: true, value: { type: "file", path: input } };
    },
    format(value: LogOutput): string {
      return value.type === "console" ? "-" : value.path;
    },
    *suggest(prefix: string): Iterable<Suggestion> {
      // Suggest "-" for console output
      if ("-".startsWith(prefix)) {
        yield { kind: "literal", text: "-" };
      }
      // Also suggest file completion
      yield { kind: "file", type: "file", pattern: prefix };
    },
  };
}

/**
 * Creates a parser for log output destination (`--log-output`).
 *
 * This parser accepts either `-` for console output (following CLI convention)
 * or a file path for file output.
 *
 * @param options Configuration options for the log output parser.
 * @returns A {@link Parser} that produces a {@link LogOutput} or `undefined`.
 *
 * @example Basic usage
 * ```typescript
 * import { logOutput } from "@optique/logtape";
 * import { object } from "@optique/core/constructs";
 *
 * const parser = object({
 *   output: logOutput(),
 * });
 *
 * // --log-output=- -> console output
 * // --log-output=/var/log/app.log -> file output
 * ```
 *
 * @since 0.8.0
 */
export function logOutput(
  options: LogOutputOptions = {},
): Parser<LogOutput | undefined, unknown> {
  const long = (options.long ?? "--log-output") as OptionName;
  const valueParser = logOutputValueParser(options);

  if (options.short) {
    const short = options.short as OptionName;
    return optional(
      option(short, long, valueParser, { description: options.description }),
    );
  }
  return optional(
    option(long, valueParser, { description: options.description }),
  );
}

/**
 * Creates a console sink with configurable stream selection.
 *
 * This function creates a LogTape sink that writes to the console. The target
 * stream (stdout or stderr) can be configured statically or dynamically per
 * log record.
 *
 * @param options Configuration options for the console sink.
 * @returns A {@link Sink} function.
 *
 * @example Static stream selection
 * ```typescript
 * import { createConsoleSink } from "@optique/logtape";
 *
 * const sink = createConsoleSink({ stream: "stderr" });
 * ```
 *
 * @example Dynamic stream selection based on level
 * ```typescript
 * import { createConsoleSink } from "@optique/logtape";
 *
 * const sink = createConsoleSink({
 *   streamResolver: (level) =>
 *     level === "error" || level === "fatal" ? "stderr" : "stdout"
 * });
 * ```
 *
 * @since 0.8.0
 */
export function createConsoleSink(options: ConsoleSinkOptions = {}): Sink {
  const defaultStream = options.stream ?? "stderr";
  const streamResolver = options.streamResolver;

  return (record: LogRecord): void => {
    const stream = streamResolver
      ? streamResolver(record.level)
      : defaultStream;

    // Format the message
    const messageParts: string[] = [];
    for (let i = 0; i < record.message.length; i++) {
      const part = record.message[i];
      if (typeof part === "string") {
        messageParts.push(part);
      } else {
        // It's a placeholder value from template literal
        messageParts.push(String(part));
      }
    }
    const formattedMessage = messageParts.join("");

    // Format the log line
    const timestamp = record.timestamp
      ? new Date(record.timestamp).toISOString()
      : new Date().toISOString();
    const category = record.category.join(".");
    const level = record.level.toUpperCase().padEnd(7);
    const line = `${timestamp} [${level}] ${category}: ${formattedMessage}`;

    if (stream === "stderr") {
      console.error(line);
    } else {
      console.log(line);
    }
  };
}

/**
 * Creates a sink from a {@link LogOutput} destination.
 *
 * For console output, this creates a console sink. For file output, this
 * dynamically imports `@logtape/file` and creates a file sink.
 *
 * @param output The log output destination.
 * @param consoleSinkOptions Options for console sink (only used when output is console).
 * @returns A promise that resolves to a {@link Sink}.
 * @throws {Error} If file output is requested but `@logtape/file` is not installed.
 *
 * @example Console output
 * ```typescript
 * import { createSink } from "@optique/logtape";
 *
 * const sink = await createSink({ type: "console" }, { stream: "stderr" });
 * ```
 *
 * @example File output
 * ```typescript
 * import { createSink } from "@optique/logtape";
 *
 * const sink = await createSink({ type: "file", path: "/var/log/app.log" });
 * ```
 *
 * @since 0.8.0
 */
export async function createSink(
  output: LogOutput,
  consoleSinkOptions: ConsoleSinkOptions = {},
): Promise<Sink> {
  if (output.type === "console") {
    return createConsoleSink(consoleSinkOptions);
  }

  // Dynamic import for optional @logtape/file dependency
  try {
    const { getFileSink } = await import("@logtape/file");
    return getFileSink(output.path);
  } catch (e) {
    throw new Error(
      `File sink requires @logtape/file package. Install it with:\n` +
        `  npm install @logtape/file\n` +
        `  # or\n` +
        `  deno add jsr:@logtape/file\n\n` +
        `Original error: ${e}`,
    );
  }
}
