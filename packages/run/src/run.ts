import type { ShellCompletion } from "@optique/core/completion";
import { runParser } from "@optique/core/facade";
import type {
  InferMode,
  InferValue,
  Mode,
  ModeValue,
  Parser,
} from "@optique/core/parser";
import type { Program } from "@optique/core/program";
import type { ShowDefaultOptions } from "@optique/core/doc";
import type { Message } from "@optique/core/message";
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
   * Whether and how to display default values for options and arguments.
   *
   * - `boolean`: When `true`, displays defaults using format `[value]`
   * - `ShowDefaultOptions`: Custom formatting with configurable prefix and suffix
   *
   * Default values are automatically dimmed when `colors` is enabled.
   *
   * @default `false`
   * @since 0.4.0
   */
  readonly showDefault?: boolean | ShowDefaultOptions;

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
   * Completion configuration. Determines how shell completion is made available:
   *
   * - `"command"`: Only the `completion` subcommand is available
   * - `"option"`: Only the `--completion` option is available
   * - `"both"`: Both `completion` subcommand and `--completion` option are available
   * - `object`: Advanced configuration with mode and custom shells
   *   - `mode`: "command" | "option" | "both" (default: "both")
   *   - `name`: "singular" | "plural" | "both" (default: "both")
   *   - `helpVisibility`: "singular" | "plural" | "both" | "none"
   *      (default: matches `name`)
   *   - `shells`: Custom shell completions (optional)
   *
   * When not provided, completion functionality is disabled.
   *
   * @since 0.6.0
   */
  readonly completion?: "command" | "option" | "both" | CompletionOptions;

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

  /**
   * Brief description shown at the top of help text.
   *
   * @since 0.4.0
   */
  readonly brief?: Message;

  /**
   * Detailed description shown after the usage line.
   *
   * @since 0.4.0
   */
  readonly description?: Message;

  /**
   * Usage examples for the program.
   *
   * @since 0.10.0
   */
  readonly examples?: Message;

  /**
   * Author information.
   *
   * @since 0.10.0
   */
  readonly author?: Message;

  /**
   * Information about where to report bugs.
   *
   * @since 0.10.0
   */
  readonly bugs?: Message;

  /**
   * Footer text shown at the bottom of help text.
   *
   * @since 0.4.0
   */
  readonly footer?: Message;
}

type CompletionHelpVisibility = "singular" | "plural" | "both" | "none";

type CompletionOptionsBase = {
  readonly mode?: "command" | "option" | "both";
  readonly shells?: Record<string, ShellCompletion>;
};

type CompletionOptionsBoth = CompletionOptionsBase & {
  readonly name?: "both";

  /**
   * Controls which completion aliases are shown in help and usage output.
   *
   * @since 0.10.0
   */
  readonly helpVisibility?: CompletionHelpVisibility;
};

type CompletionOptionsSingular = CompletionOptionsBase & {
  readonly name: "singular";

  /**
   * Controls which completion aliases are shown in help and usage output.
   *
   * @since 0.10.0
   */
  readonly helpVisibility?: "singular" | "none";
};

type CompletionOptionsPlural = CompletionOptionsBase & {
  readonly name: "plural";

  /**
   * Controls which completion aliases are shown in help and usage output.
   *
   * @since 0.10.0
   */
  readonly helpVisibility?: "plural" | "none";
};

type CompletionOptions =
  | CompletionOptionsBoth
  | CompletionOptionsSingular
  | CompletionOptionsPlural;

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
 *   completion: "both",     // Enable both completion command and --completion option
 *   colors: true,           // Force colored output
 *   errorExitCode: 2,       // Exit with code 2 on errors
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Shell completion usage
 * const result = run(parser, {
 *   completion: "both",
 * });
 *
 * // Users can then:
 * // myapp completion bash > ~/.bash_completion.d/myapp  # Generate script
 * // source ~/.bash_completion.d/myapp                   # Enable completion
 * // myapp --format=<TAB>                                # Use completion
 * ```
 *
 * @since 0.11.0 Added support for {@link Program} objects.
 */
// Overload: Program with sync parser
export function run<T>(
  program: Program<"sync", T>,
  options?: RunOptions,
): T;

// Overload: Program with async parser
export function run<T>(
  program: Program<"async", T>,
  options?: RunOptions,
): Promise<T>;

// Overload: sync parser returns sync result
export function run<T extends Parser<"sync", unknown, unknown>>(
  parser: T,
  options?: RunOptions,
): InferValue<T>;

// Overload: async parser returns Promise
export function run<T extends Parser<"async", unknown, unknown>>(
  parser: T,
  options?: RunOptions,
): Promise<InferValue<T>>;

// Overload: generic mode parser returns ModeValue
export function run<T extends Parser<Mode, unknown, unknown>>(
  parser: T,
  options?: RunOptions,
): ModeValue<InferMode<T>, InferValue<T>>;

// Implementation
export function run<T extends Parser<Mode, unknown, unknown>>(
  parserOrProgram: T | Program<Mode, unknown>,
  options: RunOptions = {},
): ModeValue<InferMode<T>, InferValue<T>> {
  return runImpl(parserOrProgram, options) as ModeValue<
    InferMode<T>,
    InferValue<T>
  >;
}

/**
 * Runs a synchronous command-line parser with automatic process integration.
 *
 * This is a type-safe version of {@link run} that only accepts sync parsers.
 * Use this when you know your parser is sync-only to get direct return values
 * without Promise wrappers.
 *
 * @template T The sync parser type being executed.
 * @param parser The synchronous command-line parser to execute.
 * @param options Configuration options for customizing behavior.
 * @returns The parsed result if successful.
 * @since 0.9.0
 */
// Overload: Program with sync parser
export function runSync<T>(
  program: Program<"sync", T>,
  options?: RunOptions,
): T;

// Overload: Sync parser
export function runSync<T extends Parser<"sync", unknown, unknown>>(
  parser: T,
  options?: RunOptions,
): InferValue<T>;

// Implementation
export function runSync<T extends Parser<"sync", unknown, unknown>>(
  parserOrProgram: T | Program<"sync", unknown>,
  options: RunOptions = {},
): InferValue<T> {
  return runImpl(parserOrProgram, options) as InferValue<T>;
}

/**
 * Runs an asynchronous command-line parser with automatic process integration.
 *
 * This function accepts any parser (sync or async) and always returns a
 * Promise. Use this when working with parsers that may contain async
 * value parsers.
 *
 * @template T The parser type being executed.
 * @param parser The command-line parser to execute.
 * @param options Configuration options for customizing behavior.
 * @returns A Promise of the parsed result if successful.
 * @since 0.9.0
 */
// Overload: Program with sync parser
export function runAsync<T>(
  program: Program<"sync", T>,
  options?: RunOptions,
): Promise<T>;

// Overload: Program with async parser
export function runAsync<T>(
  program: Program<"async", T>,
  options?: RunOptions,
): Promise<T>;

// Overload: Any parser
export function runAsync<T extends Parser<Mode, unknown, unknown>>(
  parser: T,
  options?: RunOptions,
): Promise<InferValue<T>>;

// Implementation
export function runAsync<T extends Parser<Mode, unknown, unknown>>(
  parserOrProgram: T | Program<Mode, unknown>,
  options: RunOptions = {},
): Promise<InferValue<T>> {
  const result = runImpl(parserOrProgram, options);
  return Promise.resolve(result) as Promise<InferValue<T>>;
}

function runImpl<T extends Parser<Mode, unknown, unknown>>(
  parserOrProgram: T | Program<Mode, unknown>,
  options: RunOptions = {},
): ModeValue<InferMode<T>, InferValue<T>> {
  // Determine if we're using the new Program API
  const isProgram = "parser" in parserOrProgram &&
    "metadata" in parserOrProgram;

  let parser: T;
  let programNameFromProgram: string | undefined;
  let programMetadata: {
    brief?: Message;
    description?: Message;
    examples?: Message;
    author?: Message;
    bugs?: Message;
    footer?: Message;
  } | undefined;

  if (isProgram) {
    const program = parserOrProgram as Program<Mode, unknown>;
    parser = program.parser as T;
    programNameFromProgram = program.metadata.name;
    programMetadata = {
      brief: program.metadata.brief,
      description: program.metadata.description,
      examples: program.metadata.examples,
      author: program.metadata.author,
      bugs: program.metadata.bugs,
      footer: program.metadata.footer,
    };
  } else {
    parser = parserOrProgram as T;
  }

  const {
    programName = programNameFromProgram ??
      path.basename(process.argv[1] || "cli"),
    args = process.argv.slice(2),
    colors = process.stdout.isTTY,
    maxWidth = process.stdout.columns,
    showDefault,
    help,
    version,
    completion,
    aboveError = "usage",
    errorExitCode = 1,
    brief = programMetadata?.brief,
    description = programMetadata?.description,
    examples = programMetadata?.examples,
    author = programMetadata?.author,
    bugs = programMetadata?.bugs,
    footer = programMetadata?.footer,
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

  // Convert completion configuration for the base run function
  const completionConfig = (() => {
    if (!completion) return undefined;

    if (typeof completion === "string") {
      return {
        mode: completion,
        shells: undefined,
        name: "both" as const,
        helpVisibility: "both" as const,
        onShow: () => process.exit(0) as never,
      };
    }

    const mode = completion.mode ?? "both";
    const shells = completion.shells;
    if (completion.name === "singular") {
      return {
        mode,
        shells,
        name: "singular" as const,
        helpVisibility: completion.helpVisibility ?? "singular",
        onShow: () => process.exit(0) as never,
      };
    }
    if (completion.name === "plural") {
      return {
        mode,
        shells,
        name: "plural" as const,
        helpVisibility: completion.helpVisibility ?? "plural",
        onShow: () => process.exit(0) as never,
      };
    }
    return {
      mode,
      shells,
      name: "both" as const,
      helpVisibility: completion.helpVisibility ?? "both",
      onShow: () => process.exit(0) as never,
    };
  })();

  return runParser(parser, programName, args, {
    stderr(line) {
      process.stderr.write(`${line}\n`);
    },
    stdout(line) {
      process.stdout.write(`${line}\n`);
    },
    colors,
    maxWidth,
    showDefault,
    help: helpConfig,
    version: versionConfig,
    completion: completionConfig,
    aboveError,
    brief,
    description,
    examples,
    author,
    bugs,
    footer,
    onError() {
      return process.exit(errorExitCode) as never;
    },
  });
}
