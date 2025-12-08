import { option } from "@optique/core/primitives";
import { group, object } from "@optique/core/constructs";
import { withDefault } from "@optique/core/modifiers";
import type { Parser } from "@optique/core/parser";
import type { OptionName } from "@optique/core/usage";
import type { Config, LogLevel } from "@logtape/logtape";

import { logLevel } from "./loglevel.ts";
import { verbosity, type VerbosityOptions } from "./verbosity.ts";
import { debug, type DebugOptions } from "./debug.ts";
import {
  type ConsoleSinkOptions,
  createSink,
  type LogOutput,
  logOutput,
} from "./output.ts";

/**
 * Result type for the logging options parser.
 * @since 0.8.0
 */
export interface LoggingOptionsResult {
  /**
   * The configured log level.
   */
  readonly logLevel: LogLevel;

  /**
   * The configured log output destination.
   */
  readonly logOutput: LogOutput;
}

/**
 * Configuration for log output option in presets.
 * @since 0.8.0
 */
export interface LogOutputConfig {
  /**
   * Whether to enable the log output option.
   * @default `true`
   */
  readonly enabled?: boolean;

  /**
   * Long option name for the log output option.
   * @default `"--log-output"`
   */
  readonly long?: string;
}

/**
 * Configuration for logging options preset using `--log-level` option.
 * @since 0.8.0
 */
export interface LoggingOptionsWithLevel {
  /**
   * Use explicit log level option.
   */
  readonly level: "option";

  /**
   * Long option name for the log level option.
   * @default `"--log-level"`
   */
  readonly long?: string;

  /**
   * Short option name for the log level option.
   * @default `"-l"`
   */
  readonly short?: string;

  /**
   * Default log level when not specified.
   * @default `"info"`
   */
  readonly default?: LogLevel;

  /**
   * Configuration for log output option.
   */
  readonly output?: LogOutputConfig;

  /**
   * Label for the option group in help text.
   * @default `"Logging options"`
   */
  readonly groupLabel?: string;
}

/**
 * Configuration for logging options preset using `-v`/`-vv`/`-vvv` flags.
 * @since 0.8.0
 */
export interface LoggingOptionsWithVerbosity {
  /**
   * Use verbosity flags.
   */
  readonly level: "verbosity";

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
   * Base log level when no verbosity flags are provided.
   * @default `"warning"`
   */
  readonly baseLevel?: LogLevel;

  /**
   * Configuration for log output option.
   */
  readonly output?: LogOutputConfig;

  /**
   * Label for the option group in help text.
   * @default `"Logging options"`
   */
  readonly groupLabel?: string;
}

/**
 * Configuration for logging options preset using `--debug` flag.
 * @since 0.8.0
 */
export interface LoggingOptionsWithDebug {
  /**
   * Use debug flag.
   */
  readonly level: "debug";

  /**
   * Long option name for the debug flag.
   * @default `"--debug"`
   */
  readonly long?: string;

  /**
   * Short option name for the debug flag.
   * @default `"-d"`
   */
  readonly short?: string;

  /**
   * Log level when debug flag is present.
   * @default `"debug"`
   */
  readonly debugLevel?: LogLevel;

  /**
   * Log level when debug flag is not present.
   * @default `"info"`
   */
  readonly normalLevel?: LogLevel;

  /**
   * Configuration for log output option.
   */
  readonly output?: LogOutputConfig;

  /**
   * Label for the option group in help text.
   * @default `"Logging options"`
   */
  readonly groupLabel?: string;
}

/**
 * Configuration for logging options preset.
 *
 * This is a discriminated union type that determines how log level is
 * configured. Only one method can be used at a time:
 *
 * - `level: "option"`: Use `--log-level=LEVEL` option
 * - `level: "verbosity"`: Use `-v`/`-vv`/`-vvv` flags
 * - `level: "debug"`: Use `--debug` flag
 *
 * @since 0.8.0
 */
export type LoggingOptionsConfig =
  | LoggingOptionsWithLevel
  | LoggingOptionsWithVerbosity
  | LoggingOptionsWithDebug;

/**
 * Creates a logging options parser preset.
 *
 * This function creates a parser that combines log level and log output
 * options into a single group. The log level can be configured using one of
 * three methods (mutually exclusive):
 *
 * - `"option"`: Explicit `--log-level=LEVEL` option
 * - `"verbosity"`: `-v`/`-vv`/`-vvv` flags for increasing verbosity
 * - `"debug"`: Simple `--debug` flag toggle
 *
 * @param config Configuration for the logging options.
 * @returns A {@link Parser} that produces a {@link LoggingOptionsResult}.
 *
 * @example Using log level option
 * ```typescript
 * import { loggingOptions } from "@optique/logtape";
 * import { object } from "@optique/core/constructs";
 *
 * const parser = object({
 *   logging: loggingOptions({ level: "option" }),
 * });
 * // --log-level=debug --log-output=/var/log/app.log
 * ```
 *
 * @example Using verbosity flags
 * ```typescript
 * import { loggingOptions } from "@optique/logtape";
 * import { object } from "@optique/core/constructs";
 *
 * const parser = object({
 *   logging: loggingOptions({ level: "verbosity" }),
 * });
 * // -vv --log-output=-
 * ```
 *
 * @example Using debug flag
 * ```typescript
 * import { loggingOptions } from "@optique/logtape";
 * import { object } from "@optique/core/constructs";
 *
 * const parser = object({
 *   logging: loggingOptions({ level: "debug" }),
 * });
 * // --debug
 * ```
 *
 * @since 0.8.0
 */
export function loggingOptions(
  config: LoggingOptionsConfig,
): Parser<LoggingOptionsResult, unknown> {
  const groupLabel = config.groupLabel ?? "Logging options";
  const outputEnabled = config.output?.enabled !== false;
  const outputLong = config.output?.long ?? "--log-output";

  // Create log level parser based on the configuration
  let levelParser: Parser<LogLevel, unknown>;

  switch (config.level) {
    case "option": {
      const long = (config.long ?? "--log-level") as OptionName;
      const short = (config.short ?? "-l") as OptionName;
      const defaultLevel = config.default ?? "info";

      levelParser = withDefault(
        option(short, long, logLevel()),
        defaultLevel,
      );
      break;
    }

    case "verbosity": {
      const verbosityOptions: VerbosityOptions = {
        short: config.short,
        long: config.long,
        baseLevel: config.baseLevel,
      };
      levelParser = verbosity(verbosityOptions);
      break;
    }

    case "debug": {
      const debugOptions: DebugOptions = {
        short: config.short,
        long: config.long,
        debugLevel: config.debugLevel,
        normalLevel: config.normalLevel,
      };
      levelParser = debug(debugOptions);
      break;
    }
  }

  // Default log output is console
  const defaultOutput: LogOutput = { type: "console" };

  // Parser that always produces LogOutput (not undefined)
  // Use type assertion since withDefault(optional(x), y) guarantees non-undefined
  const outputParser = withDefault(
    logOutput({ long: outputLong }),
    defaultOutput,
  ) as unknown as Parser<LogOutput, unknown>;

  // If output is disabled, create a parser that always returns default
  if (!outputEnabled) {
    const constantOutputParser: Parser<LogOutput, unknown> = {
      $valueType: [] as readonly LogOutput[],
      $stateType: [],
      priority: 0,
      usage: [],
      initialState: undefined,
      parse: (context) => ({
        success: true as const,
        next: context,
        consumed: [],
      }),
      complete: () => ({ success: true as const, value: defaultOutput }),
      suggest: () => [],
      getDocFragments: () => ({ fragments: [] }),
    };

    return group(
      groupLabel,
      object({
        logLevel: levelParser,
        logOutput: constantOutputParser,
      }),
    );
  }

  // Combine into a grouped parser
  const innerParser = object({
    logLevel: levelParser,
    logOutput: outputParser,
  });

  return group(groupLabel, innerParser);
}

/**
 * Creates a LogTape configuration from parsed logging options.
 *
 * This helper function converts the result of {@link loggingOptions} parser
 * into a configuration object that can be passed to LogTape's `configure()`
 * function.
 *
 * @param options The parsed logging options.
 * @param consoleSinkOptions Options for console sink (only used when output is console).
 * @param additionalConfig Additional LogTape configuration to merge.
 * @returns A promise that resolves to a LogTape {@link Config}.
 *
 * @example Basic usage
 * ```typescript
 * import { loggingOptions, createLoggingConfig } from "@optique/logtape";
 * import { configure } from "@logtape/logtape";
 * import { object, parse } from "@optique/core";
 *
 * const parser = object({
 *   logging: loggingOptions({ level: "option" }),
 * });
 *
 * const result = parse(parser, ["--log-level=debug"]);
 * if (result.success) {
 *   const config = await createLoggingConfig(result.value.logging);
 *   await configure(config);
 * }
 * ```
 *
 * @example With additional configuration
 * ```typescript
 * import { loggingOptions, createLoggingConfig } from "@optique/logtape";
 * import { configure } from "@logtape/logtape";
 *
 * const config = await createLoggingConfig(result.value.logging, {
 *   stream: "stderr",
 * }, {
 *   loggers: [
 *     { category: ["my-app", "database"], lowestLevel: "debug", sinks: ["default"] },
 *   ],
 * });
 * await configure(config);
 * ```
 *
 * @since 0.8.0
 */
export async function createLoggingConfig(
  options: LoggingOptionsResult,
  consoleSinkOptions: ConsoleSinkOptions = {},
  additionalConfig: Partial<Config<string, string>> = {},
): Promise<Config<string, string>> {
  const sink = await createSink(options.logOutput, consoleSinkOptions);

  return {
    sinks: {
      default: sink,
      ...additionalConfig.sinks,
    },
    loggers: [
      {
        category: [],
        lowestLevel: options.logLevel,
        sinks: ["default"],
      },
      ...(additionalConfig.loggers ?? []),
    ],
    filters: additionalConfig.filters,
    reset: additionalConfig.reset,
  };
}
