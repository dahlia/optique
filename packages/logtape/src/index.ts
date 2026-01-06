/**
 * @module @optique/logtape
 *
 * LogTape logging integration for Optique CLI parser.
 *
 * This module provides parsers and utilities for integrating LogTape logging
 * library with Optique CLI applications. It offers various ways to configure
 * logging through command-line arguments.
 *
 * @example Basic usage with log level option
 * ```typescript
 * import { logLevel } from "@optique/logtape";
 * import { option, withDefault, object, parse } from "@optique/core";
 *
 * const parser = object({
 *   level: withDefault(option("--log-level", "-l", logLevel()), "info"),
 * });
 *
 * const result = parse(parser, ["--log-level=debug"]);
 * ```
 *
 * @example Using the logging options preset
 * ```typescript
 * import { loggingOptions, createLoggingConfig } from "@optique/logtape";
 * import { configure } from "@logtape/logtape";
 * import { object, parse } from "@optique/core";
 *
 * const parser = object({
 *   logging: loggingOptions({ level: "verbosity" }),
 * });
 *
 * const result = parse(parser, ["-vv"]);
 * if (result.success) {
 *   const config = await createLoggingConfig(result.value.logging);
 *   await configure(config);
 * }
 * ```
 *
 * @since 0.8.0
 */

// Re-export LogLevel type for convenience
export type { LogLevel, LogRecord, Sink } from "@logtape/logtape";

// Log level value parser
export { LOG_LEVELS, logLevel, type LogLevelOptions } from "./loglevel.ts";

// Verbosity parser
export { verbosity, type VerbosityOptions } from "./verbosity.ts";

// Debug flag parser
export { debug, type DebugOptions } from "./debug.ts";

// Log output parser and sink helpers
export {
  type ConsoleSinkOptions,
  createConsoleSink,
  createSink,
  type LogOutput,
  logOutput,
  type LogOutputOptions,
} from "./output.ts";

// Logging options preset
export {
  createLoggingConfig,
  loggingOptions,
  type LoggingOptionsConfig,
  type LoggingOptionsResult,
  type LoggingOptionsWithDebug,
  type LoggingOptionsWithLevel,
  type LoggingOptionsWithVerbosity,
  type LogOutputConfig,
} from "./preset.ts";
