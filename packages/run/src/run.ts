import { run as runBase } from "@optique/core/facade";
import type { InferValue, Parser } from "@optique/core/parser";
import path from "node:path";
import process from "node:process";

/**
 * Configuration options for the {@link run} function.
 */
export interface RunOptions {
  /**
   * The name of the program to display in usage and help messages.
   *
   * @default The basename of `process.argv[1]` (the script filename)
   */
  readonly programName?: string;

  /**
   * The command-line arguments to parse.
   *
   * @default `process.argv.slice(2)` (arguments after the script name)
   */
  readonly args?: readonly string[];

  /**
   * Whether to enable colored output in help and error messages.
   *
   * @default `process.stdout.isTTY` (auto-detect based on terminal)
   */
  readonly colors?: boolean;

  /**
   * Maximum width for output formatting. Text will be wrapped to fit within
   * this width. If not specified, uses the terminal width.
   *
   * @default `process.stdout.columns` (auto-detect terminal width)
   */
  readonly maxWidth?: number;

  /**
   * Help configuration. Determines how help is made available:
   *
   * - `"command"`: Only the `help` subcommand is available
   * - `"option"`: Only the `--help` option is available
   * - `"both"`: Both `help` subcommand and `--help` option are available
   *
   * When not provided, help functionality is disabled.
   */
  readonly help?: "command" | "option" | "both";

  /**
   * Version configuration. Determines how version is made available:
   *
   * - `string`: Version value with default `"option"` mode (--version only)
   * - `object`: Advanced configuration with version value and mode
   *   - `value`: The version string to display
   *   - `mode`: "command" | "option" | "both" (default: "option")
   *
   * When not provided, version functionality is disabled.
   */
  readonly version?: string | {
    readonly value: string;
    readonly mode?: "command" | "option" | "both";
  };

  /**
   * What to display above error messages:
   *
   * - `"usage"`: Show usage line before error message
   * - `"help"`: Show full help page before error message
   * - `"none"`: Show only the error message
   *
   * @default `"usage"`
   */
  readonly aboveError?: "usage" | "help" | "none";

  /**
   * The exit code to use when the parser encounters an error.
   *
   * @default `1`
   */
  readonly errorExitCode?: number;
}

/**
 * Runs a command-line parser with automatic process integration.
 *
 * This function provides a convenient high-level interface for parsing
 * command-line arguments in Node.js, Bun, and Deno environments. It
 * automatically handles `process.argv`, `process.exit()`, and terminal
 * output formatting, eliminating the need to manually pass these values
 * as the lower-level `run()` function (from `@optique/core/facade`) requires.
 *
 * The function will automatically:
 *
 * - Extract arguments from `process.argv`
 * - Detect terminal capabilities for colors and width
 * - Exit the process with appropriate codes on help or error
 * - Format output according to terminal capabilities
 *
 * @template T The parser type being executed.
 * @param parser The command-line parser to execute.
 * @param options Configuration options for customizing behavior.
 *                See {@link RunOptions} for available settings.
 * @returns The parsed result if successful. On help display or parse errors,
 *          the function will call `process.exit()` and not return.
 *
 * @example
 * ```typescript
 * import { object, option, run } from "@optique/run";
 * import { string, integer } from "@optique/core/valueparser";
 *
 * const parser = object({
 *   name: option("-n", "--name", string()),
 *   port: option("-p", "--port", integer()),
 * });
 *
 * // Automatically uses process.argv, handles errors/help, exits on completion
 * const config = run(parser);
 * console.log(`Starting server ${config.name} on port ${config.port}`);
 * ```
 *
 * @example
 * ```typescript
 * // With custom options
 * const result = run(parser, {
 *   programName: "myapp",
 *   help: "both",           // Enable both --help option and help command
 *   colors: true,           // Force colored output
 *   errorExitCode: 2,       // Exit with code 2 on errors
 * });
 * ```
 */
export function run<T extends Parser<unknown, unknown>>(
  parser: T,
  options: RunOptions = {},
): InferValue<T> {
  const {
    programName = path.basename(process.argv[1] || "cli"),
    args = process.argv.slice(2),
    colors = process.stdout.isTTY,
    maxWidth = process.stdout.columns,
    help,
    version,
    aboveError = "usage",
    errorExitCode = 1,
  } = options;

  // Convert help configuration for the base run function
  const helpConfig = help
    ? {
      mode: help,
      onShow: () => process.exit(0) as never,
    }
    : undefined;

  // Convert version configuration for the base run function
  const versionConfig = version
    ? {
      mode: typeof version === "string"
        ? "option" as const
        : (version.mode ?? "option"),
      value: typeof version === "string" ? version : version.value,
      onShow: () => process.exit(0) as never,
    }
    : undefined;

  return runBase<T, never, never>(parser, programName, args, {
    colors,
    maxWidth,
    help: helpConfig,
    version: versionConfig,
    aboveError,
    onError() {
      return process.exit(errorExitCode) as never;
    },
  });
}
