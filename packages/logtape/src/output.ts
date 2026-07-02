import { basename } from "node:path";
import { option } from "@optique/core/primitives";
import { optional } from "@optique/core/modifiers";
import { object } from "@optique/core/constructs";
import type { FluentParser } from "@optique/core/fluent";
import { ensureNonEmptyString } from "@optique/core/nonempty";
import type {
  NonEmptyString,
  ValueParser,
  ValueParserResult,
} from "@optique/core/valueparser";
import type { Suggestion } from "@optique/core/parser";
import { type Message, message } from "@optique/core/message";
import type { OptionName } from "@optique/core/usage";
import type {
  ConsoleFormatter,
  LogLevel,
  LogRecord,
  Sink,
  TextFormatter,
} from "@logtape/logtape";
import { textFormatter } from "./textformatter.ts";

/**
 * Represents a log output destination.
 *
 * This is a discriminated union type that represents either console output
 * or file output.
 * @since 0.8.0
 */
export type LogOutput =
  | { readonly type: "console"; readonly formatter?: TextFormatter }
  | {
    readonly type: "file";
    readonly path: string;
    readonly formatter?: TextFormatter;
  };

/**
 * Options for configuring console sink creation.
 * @since 0.8.0
 */
export interface ConsoleSinkOptions {
  /**
   * The stream to write to. Either `"stdout"` or `"stderr"`.
   * If `null` or `undefined`, defaults to `"stderr"`.
   * @default `"stderr"`
   */
  readonly stream?: "stdout" | "stderr" | null;

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

  /**
   * A formatter for converting log records to console output.
   * Text formatters return one string argument, while console formatters
   * return the full argument list passed to the selected console method.
   *
   * If omitted, records are formatted as
   * `ISO_TIMESTAMP [LEVEL] category: message`.
   * @since 1.2.0
   */
  readonly formatter?: TextFormatter | ConsoleFormatter;
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
  readonly metavar?: NonEmptyString;

  /**
   * Description to show in help text.
   */
  readonly description?: Message;

  /**
   * Text formatter to apply to the selected log output, or a long option name
   * for selecting the text formatter from the command line.
   *
   * When a string is specified, this adds an option that accepts `"jsonl"`,
   * `"logfmt"`, `"color"`, and `"plain"` and stores the selected formatter in
   * the resulting {@link LogOutput}. If the formatter option is specified
   * without a log output option, the output defaults to console.
   *
   * When a formatter function is specified, it is applied to the resulting
   * {@link LogOutput} only when the log output option itself is present.
   *
   * @example
   * ```typescript
   * logOutput({ formatter: "--log-format" })
   * ```
   *
   * @since 1.2.0
   */
  readonly formatter?: string | TextFormatter;

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
 * @throws {TypeError} If `options.metavar` is an empty string.
 */
function logOutputValueParser(
  options: LogOutputOptions = {},
): ValueParser<"sync", LogOutput> {
  const metavar = options.metavar ?? "FILE";
  ensureNonEmptyString(metavar);
  return {
    mode: "sync",
    metavar,
    placeholder: { type: "console" },
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
      yield {
        kind: "file",
        type: "file",
        pattern: prefix,
        includeHidden: basename(prefix).startsWith(".") &&
          basename(prefix) !== "..",
      };
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
 * @throws {TypeError} If `options.metavar` is an empty string.
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
): FluentParser<"sync", LogOutput | undefined, unknown> {
  const long = (options.long ?? "--log-output") as OptionName;
  const valueParser = logOutputValueParser(options);
  const description = options.description ??
    message`Log output destination. Use ${"-"} for console.`;

  if (options.short) {
    const short = options.short as OptionName;
    const outputParser = optional(
      option(short, long, valueParser, { description }),
    );
    return withFormatter(outputParser, options.formatter);
  }
  const outputParser = optional(
    option(long, valueParser, { description }),
  );
  return withFormatter(outputParser, options.formatter);
}

function withFormatter(
  outputParser: FluentParser<"sync", LogOutput | undefined, unknown>,
  formatter: string | TextFormatter | undefined,
): FluentParser<"sync", LogOutput | undefined, unknown> {
  if (formatter == null) return outputParser;
  if (typeof formatter !== "string") {
    return outputParser.map((output) =>
      output == null ? undefined : { ...output, formatter }
    );
  }

  const formatterParser = createTextFormatterOption(formatter);
  return object({
    output: outputParser,
    formatter: formatterParser,
  }).map(({ output, formatter }) => {
    if (formatter == null) return output;
    return { ...(output ?? { type: "console" as const }), formatter };
  });
}

/**
 * Creates an optional parser for a text formatter option.
 *
 * @param long The long option name for selecting the formatter.
 * @returns A parser that produces the selected {@link TextFormatter}, or
 *   `undefined` when the option is not present.
 * @throws {TypeError} If `long` is not a valid option name.
 * @since 1.2.0
 */
export function createTextFormatterOption(
  long: string,
): FluentParser<"sync", TextFormatter | undefined, unknown> {
  return optional(
    option(long as OptionName, textFormatter(), {
      description: message`Log output format.`,
    }),
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
 * @throws {TypeError} If `options.stream` is not `"stdout"` or `"stderr"`
 *   when `streamResolver` is not provided.
 * @throws {TypeError} If `streamResolver` returns a value other than
 *   `"stdout"` or `"stderr"`.
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
  const streamResolver = options.streamResolver;
  const defaultStream = options.stream ?? "stderr";
  const formatter = options.formatter ?? defaultConsoleFormatter;

  const invalidStreamError = (value: unknown): TypeError => {
    let repr: string;
    if (typeof value === "string") {
      repr = JSON.stringify(value);
    } else if (value === null || typeof value !== "object") {
      repr = String(value);
    } else {
      try {
        repr = JSON.stringify(value) ?? String(value);
      } catch {
        repr = String(value);
      }
    }
    return new TypeError(
      `Invalid stream: expected "stdout" or "stderr", got ${repr}.`,
    );
  };

  if (
    !streamResolver && defaultStream !== "stdout" && defaultStream !== "stderr"
  ) {
    throw invalidStreamError(defaultStream);
  }

  return (record: LogRecord): void => {
    const stream = streamResolver
      ? streamResolver(record.level)
      : defaultStream;
    if (stream !== "stdout" && stream !== "stderr") {
      throw invalidStreamError(stream);
    }

    const args = toConsoleArgs(formatter(record));

    if (stream === "stderr") {
      console.error(...args);
    } else {
      console.log(...args);
    }
  };
}

function toConsoleArgs(value: string | readonly unknown[]): readonly unknown[] {
  return typeof value === "string" ? [value.replace(/\r?\n$/, "")] : value;
}

function defaultConsoleFormatter(record: LogRecord): string {
  const messageParts: string[] = [];
  for (let i = 0; i < record.message.length; i++) {
    const part = record.message[i];
    if (typeof part === "string") {
      messageParts.push(part);
    } else {
      messageParts.push(String(part));
    }
  }
  const formattedMessage = messageParts.join("");

  const ts = record.timestamp;
  const timestamp = new Date(
    ts != null && !Number.isNaN(ts) ? ts : Date.now(),
  ).toISOString();
  const category = record.category.join(".");
  const level = record.level.toUpperCase().padEnd(7);
  return `${timestamp} [${level}] ${category}: ${formattedMessage}`;
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
 * @throws {Error} If file output is requested but `@logtape/file` is not
 *   installed.
 * @throws If `@logtape/file` is installed but `getFileSink(output.path)` fails
 *   at runtime (e.g., the target directory does not exist), the original error
 *   propagates as-is.
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
    return createConsoleSink({
      ...consoleSinkOptions,
      formatter: consoleSinkOptions.formatter ?? output.formatter,
    });
  }

  let getFileSink: (
    path: string,
    options?: { readonly formatter?: TextFormatter },
  ) => Sink;
  try {
    ({ getFileSink } = await import("@logtape/file"));
  } catch (e) {
    throw new Error(
      `File sink requires @logtape/file package. Install it with:\n` +
        `  npm install @logtape/file\n` +
        `  # or\n` +
        `  deno add jsr:@logtape/file\n\n` +
        `Original error: ${e}`,
    );
  }
  return getFileSink(
    output.path,
    output.formatter == null ? undefined : {
      formatter: output.formatter,
    },
  );
}
