import type { ShellCompletion } from "@optique/core/completion";
import type { SourceContext } from "@optique/core/context";
import { runParser, runWith, runWithSync } from "@optique/core/facade";
import type {
  CommandSubConfig,
  ExtractRequiredOptions,
  OptionSubConfig,
  RunOptions as CoreRunOptions,
} from "@optique/core/facade";
import type {
  InferMode,
  InferValue,
  Mode,
  ModeValue,
  Parser,
} from "@optique/core/parser";
import type { Program } from "@optique/core/program";
import type {
  DocSection,
  ShowChoicesOptions,
  ShowDefaultOptions,
} from "@optique/core/doc";
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
   * Function used to output help and usage messages.  Assumes it prints the
   * ending newline.
   *
   * @default Writes to `process.stdout` with a trailing newline
   */
  readonly stdout?: (text: string) => void;

  /**
   * Function used to output error messages.  Assumes it prints the ending
   * newline.
   *
   * @default Writes to `process.stderr` with a trailing newline
   */
  readonly stderr?: (text: string) => void;

  /**
   * Function used to exit the process on help/version display or parse error.
   *
   * @default `process.exit`
   */
  readonly onExit?: (exitCode: number) => never;

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
   * Whether and how to display valid choices for options and arguments
   * backed by enumerated value parsers (e.g., `choice()`).
   *
   * - `boolean`: When `true`, displays choices using format
   *   `(choices: a, b, c)`
   * - `ShowChoicesOptions`: Custom formatting with configurable prefix,
   *   suffix, label, and maximum number of items
   *
   * Choice values are automatically dimmed when `colors` is enabled.
   *
   * @default `false`
   * @since 0.10.0
   */
  readonly showChoices?: boolean | ShowChoicesOptions;

  /**
   * A custom comparator function to control the order of sections in the
   * help output.  When provided, it is used instead of the default smart
   * sort (command-only sections first, then mixed, then option/argument-only
   * sections).  Sections that compare equal (return `0`) preserve their
   * original relative order.
   *
   * @param a The first section to compare.
   * @param b The second section to compare.
   * @returns A negative number if `a` should appear before `b`, a positive
   *   number if `a` should appear after `b`, or `0` if they are equal.
   * @since 1.0.0
   */
  readonly sectionOrder?: (a: DocSection, b: DocSection) => number;

  /**
   * Help configuration. Determines how help is made available:
   *
   * - `"command"`: Only the `help` subcommand is available
   * - `"option"`: Only the `--help` option is available
   * - `"both"`: Both `help` subcommand and `--help` option are available
   * - `object`: Advanced configuration with `command` and/or `option`
   *   sub-configs.  At least one of `command` or `option` must be specified.
   *
   * When not provided, help functionality is disabled.
   *
   * @since 1.0.0
   */
  readonly help?:
    | "command"
    | "option"
    | "both"
    | ((
      | {
        readonly command: true | CommandSubConfig;
        readonly option?: true | OptionSubConfig;
      }
      | {
        readonly option: true | OptionSubConfig;
        readonly command?: true | CommandSubConfig;
      }
    ));

  /**
   * Version configuration. Determines how version is made available:
   *
   * - `string`: Version value with default `"option"` mode (--version only)
   * - `object`: Advanced configuration with version value and `command`
   *   and/or `option` sub-configs.  At least one of `command` or `option`
   *   must be specified.
   *
   * When not provided, version functionality is disabled.
   *
   * @since 1.0.0
   */
  readonly version?:
    | string
    | (
      & { readonly value: string }
      & (
        | {
          readonly command: true | CommandSubConfig;
          readonly option?: true | OptionSubConfig;
        }
        | {
          readonly option: true | OptionSubConfig;
          readonly command?: true | CommandSubConfig;
        }
      )
    );

  /**
   * Completion configuration. Determines how shell completion is made
   * available:
   *
   * - `"command"`: Only the `completion` subcommand is available
   * - `"option"`: Only the `--completion` option is available
   * - `"both"`: Both `completion` subcommand and `--completion` option
   *   are available
   * - `object`: Advanced configuration with `command` and/or `option`
   *   sub-configs and optional custom shells.  At least one of `command`
   *   or `option` must be specified.
   *
   * When not provided, completion functionality is disabled.
   *
   * @since 1.0.0
   */
  readonly completion?:
    | "command"
    | "option"
    | "both"
    | (
      & {
        readonly shells?: Record<string, ShellCompletion>;
      }
      & (
        | {
          readonly command: true | CommandSubConfig;
          readonly option?: true | OptionSubConfig;
        }
        | {
          readonly option: true | OptionSubConfig;
          readonly command?: true | CommandSubConfig;
        }
      )
    );

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

  /**
   * Source contexts to use for two-phase parsing.  When provided, the
   * runner delegates to `runWith()` (or `runWithSync()` for sync parsers)
   * from `@optique/core/facade`, which handles annotation collection and
   * multi-phase parsing automatically.
   *
   * @since 1.0.0
   */
  readonly contexts?: readonly SourceContext<unknown>[];

  /**
   * Options to forward to source contexts.  When contexts declare
   * required options (via `$requiredOptions`), pass them here to
   * avoid name collisions with runner-level options such as `help`,
   * `programName`, or `version`.
   *
   * @since 1.0.0
   */
  readonly contextOptions?: Record<string, unknown>;
}

type ProgramHelpMetadata = {
  readonly brief?: Message;
  readonly description?: Message;
  readonly examples?: Message;
  readonly author?: Message;
  readonly bugs?: Message;
  readonly footer?: Message;
};

/**
 * Rejects context tuples that are statically known to be empty so those calls
 * fall back to the no-context overloads.
 */
type RejectEmptyContexts<TContexts extends readonly SourceContext<unknown>[]> =
  TContexts extends readonly [] ? never
    : unknown;

/**
 * Represents a context tuple that is statically known to contain at least one
 * source context.
 */
type NonEmptySourceContexts = readonly [
  SourceContext<unknown>,
  ...SourceContext<unknown>[],
];

/**
 * Rejects option shapes that may carry a non-empty `contexts` array so plain
 * Program overloads do not bypass the context-aware overloads.
 */
type ContextsFromOptions<TOptions> = [Exclude<TOptions, undefined>] extends
  [never] ? undefined
  : Exclude<TOptions, undefined> extends {
    readonly contexts?: infer TContexts extends
      | readonly SourceContext<unknown>[]
      | undefined;
  } ? TContexts
  : undefined;

type RejectContextfulOptions<TOptions> = [ContextsFromOptions<TOptions>] extends
  [undefined | readonly []] ? unknown
  : never;

/**
 * Rejects option shapes that introduce keys outside the public `RunOptions`
 * contract, preserving typo detection for direct object literals and wider
 * option variables.
 */
type RejectUnknownRunOptionKeys<TOptions> = [TOptions] extends [undefined]
  ? unknown
  : Exclude<keyof TOptions, keyof RunOptions> extends never ? unknown
  : never;

/**
 * When contexts require options, demands a `contextOptions` property
 * typed to those requirements.  When no context needs options,
 * resolves to `unknown` (intersection no-op).
 */
type ContextOptionsParam<
  TContexts extends readonly SourceContext<unknown>[],
  TValue,
> = [unknown] extends [ExtractRequiredOptions<TContexts, TValue>] ? unknown
  : { readonly contextOptions: ExtractRequiredOptions<TContexts, TValue> };

/**
 * Accepts only values typed exactly as `RunOptions`, which are widened to the
 * conservative fallback overloads because they may hide context presence.
 */
type AcceptExactRunOptions<TOptions> = [TOptions] extends [RunOptions]
  ? [RunOptions] extends [TOptions] ? unknown
  : never
  : never;

/**
 * Accepts only values typed exactly as `RunOptions | undefined`, which model
 * optional forwarding wrappers without widening generic Program overloads.
 */
type AcceptExactOptionalRunOptions<TOptions> = [TOptions] extends
  [RunOptions | undefined]
  ? [RunOptions | undefined] extends [TOptions] ? unknown
  : never
  : never;

function getProgramHelpMetadata(
  metadata: Program<Mode, unknown>["metadata"],
): ProgramHelpMetadata {
  return {
    brief: metadata.brief,
    description: metadata.description,
    examples: metadata.examples,
    author: metadata.author,
    bugs: metadata.bugs,
    footer: metadata.footer,
  };
}

function resolveProgramInput<
  M extends Mode,
  T extends Parser<M, unknown, unknown>,
>(
  parserOrProgram: T | Program<M, unknown>,
  options: RunOptions,
): {
  readonly parser: T;
  readonly options: RunOptions;
  readonly programMetadata?: ProgramHelpMetadata;
} {
  if ("parser" in parserOrProgram && "metadata" in parserOrProgram) {
    return {
      parser: parserOrProgram.parser as T,
      options: options.programName == null
        ? { ...options, programName: parserOrProgram.metadata.name }
        : options,
      programMetadata: getProgramHelpMetadata(parserOrProgram.metadata),
    };
  }
  return {
    parser: parserOrProgram,
    options,
  };
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
// Overload: parser with statically non-empty contexts — returns Promise
export function run<
  T extends Parser<Mode, unknown, unknown>,
  const TContexts extends NonEmptySourceContexts,
>(
  parser: T,
  options:
    & RunOptions
    & { readonly contexts: TContexts }
    & ContextOptionsParam<TContexts, InferValue<T>>,
): Promise<InferValue<T>>;

// Overload: parser with dynamic non-empty-or-empty contexts
export function run<
  T extends Parser<Mode, unknown, unknown>,
  const TContexts extends readonly SourceContext<unknown>[],
>(
  parser: T,
  options:
    & RunOptions
    & { readonly contexts: TContexts }
    & RejectEmptyContexts<TContexts>
    & ContextOptionsParam<TContexts, InferValue<T>>,
): ModeValue<InferMode<T>, InferValue<T>> | Promise<InferValue<T>>;

// Overload: Program with statically non-empty contexts — returns Promise
export function run<
  M extends Mode,
  T,
  const TContexts extends NonEmptySourceContexts,
>(
  program: Program<M, T>,
  options:
    & RunOptions
    & { readonly contexts: TContexts }
    & ContextOptionsParam<TContexts, T>,
): Promise<T>;

// Overload: sync Program with dynamic non-empty-or-empty contexts
export function run<
  T,
  const TContexts extends readonly SourceContext<unknown>[],
>(
  program: Program<"sync", T>,
  options:
    & RunOptions
    & { readonly contexts: TContexts }
    & RejectEmptyContexts<TContexts>
    & ContextOptionsParam<TContexts, T>,
): T | Promise<T>;

// Overload: async Program with dynamic non-empty-or-empty contexts
export function run<
  T,
  const TContexts extends readonly SourceContext<unknown>[],
>(
  program: Program<"async", T>,
  options:
    & RunOptions
    & { readonly contexts: TContexts }
    & RejectEmptyContexts<TContexts>
    & ContextOptionsParam<TContexts, T>,
): Promise<T>;

// Overload: Program with sync parser
export function run<T, const TOptions extends RunOptions | undefined>(
  program: Program<"sync", T>,
  options?:
    & TOptions
    & RejectContextfulOptions<TOptions>
    & RejectUnknownRunOptionKeys<TOptions>,
): T;

// Overload: Program with sync parser and exact RunOptions
export function run<T, TOptions extends RunOptions>(
  program: Program<"sync", T>,
  options: TOptions & AcceptExactRunOptions<TOptions>,
): T | Promise<T>;

// Overload: Program with async parser
export function run<T, const TOptions extends RunOptions | undefined>(
  program: Program<"async", T>,
  options?:
    & TOptions
    & RejectContextfulOptions<TOptions>
    & RejectUnknownRunOptionKeys<TOptions>,
): Promise<T>;

// Overload: Program with async parser and exact RunOptions
export function run<T, TOptions extends RunOptions>(
  program: Program<"async", T>,
  options: TOptions & AcceptExactRunOptions<TOptions>,
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
): ModeValue<InferMode<T>, InferValue<T>> | Promise<InferValue<T>> {
  return runImpl(parserOrProgram, options) as
    | ModeValue<InferMode<T>, InferValue<T>>
    | Promise<InferValue<T>>;
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
// Overload: parser with contexts
export function runSync<
  T extends Parser<"sync", unknown, unknown>,
  TContexts extends readonly SourceContext<unknown>[],
>(
  parser: T,
  options:
    & RunOptions
    & { readonly contexts: TContexts }
    & ContextOptionsParam<TContexts, InferValue<T>>,
): InferValue<T>;

// Overload: Program with contexts
export function runSync<
  T,
  const TContexts extends readonly SourceContext<unknown>[],
>(
  program: Program<"sync", T>,
  options:
    & RunOptions
    & { readonly contexts: TContexts }
    & RejectEmptyContexts<TContexts>
    & ContextOptionsParam<TContexts, T>,
): T;

// Overload: Program with sync parser
export function runSync<T, const TOptions extends RunOptions | undefined>(
  program: Program<"sync", T>,
  options?:
    & TOptions
    & RejectContextfulOptions<TOptions>
    & RejectUnknownRunOptionKeys<TOptions>,
): T;

// Overload: Program with sync parser and exact RunOptions
export function runSync<T, TOptions extends RunOptions>(
  program: Program<"sync", T>,
  options: TOptions & AcceptExactRunOptions<TOptions>,
): T;

// Overload: Program with sync parser and exact optional RunOptions
export function runSync<T, TOptions extends RunOptions | undefined>(
  program: Program<"sync", T>,
  options: TOptions & AcceptExactOptionalRunOptions<TOptions>,
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
  // For sync parsers with contexts, use runWithSync() instead of async runWith()
  const contexts = options.contexts;
  if (contexts && contexts.length > 0) {
    const resolved = resolveProgramInput(parserOrProgram, options);
    const { parser, programMetadata } = resolved;
    options = resolved.options;

    const { programName, args, coreOptions } = buildCoreOptions(
      options,
      programMetadata,
    );

    // Extract context-required options from the dedicated namespace
    const contextOptions = options.contextOptions ?? {};

    const runWithOptions = {
      ...coreOptions,
      ...contextOptions,
      args,
    };

    return runWithSync(
      parser,
      programName,
      contexts,
      runWithOptions as Parameters<typeof runWithSync>[3],
    ) as InferValue<T>;
  }

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
// Overload: parser with contexts
export function runAsync<
  T extends Parser<Mode, unknown, unknown>,
  TContexts extends readonly SourceContext<unknown>[],
>(
  parser: T,
  options:
    & RunOptions
    & { readonly contexts: TContexts }
    & ContextOptionsParam<TContexts, InferValue<T>>,
): Promise<InferValue<T>>;

// Overload: Program with contexts
export function runAsync<
  M extends Mode,
  T,
  const TContexts extends readonly SourceContext<unknown>[],
>(
  program: Program<M, T>,
  options:
    & RunOptions
    & { readonly contexts: TContexts }
    & RejectEmptyContexts<TContexts>
    & ContextOptionsParam<TContexts, T>,
): Promise<T>;

// Overload: Program with sync parser
export function runAsync<T, const TOptions extends RunOptions | undefined>(
  program: Program<"sync", T>,
  options?:
    & TOptions
    & RejectContextfulOptions<TOptions>
    & RejectUnknownRunOptionKeys<TOptions>,
): Promise<T>;

// Overload: Program with async parser
export function runAsync<T, const TOptions extends RunOptions | undefined>(
  program: Program<"async", T>,
  options?:
    & TOptions
    & RejectContextfulOptions<TOptions>
    & RejectUnknownRunOptionKeys<TOptions>,
): Promise<T>;

// Overload: Program with exact RunOptions
export function runAsync<T, TOptions extends RunOptions>(
  program: Program<Mode, T>,
  options: TOptions & AcceptExactRunOptions<TOptions>,
): Promise<T>;

// Overload: Program with exact optional RunOptions
export function runAsync<T, TOptions extends RunOptions | undefined>(
  program: Program<Mode, T>,
  options: TOptions & AcceptExactOptionalRunOptions<TOptions>,
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

/**
 * Builds core run options from the simplified RunOptions format.
 *
 * Converts the user-friendly RunOptions (string-based help/version/completion)
 * into the verbose CoreRunOptions format expected by `runParser()`, `runWith()`,
 * and `runWithSync()` from `@optique/core/facade`.
 *
 * @internal
 */
function buildCoreOptions(
  options: RunOptions,
  programMetadata?: ProgramHelpMetadata,
): {
  programName: string;
  args: readonly string[];
  coreOptions: CoreRunOptions<never, never>;
} {
  const programName = options.programName ??
    path.basename(process.argv[1] ?? "cli");
  const args = options.args ?? process.argv.slice(2);
  const stdout = options.stdout ?? ((line: string) => {
    process.stdout.write(`${line}\n`);
  });
  const stderr = options.stderr ?? ((line: string) => {
    process.stderr.write(`${line}\n`);
  });
  const onExit = options.onExit ??
    ((exitCode: number) => process.exit(exitCode) as never);
  const colors = options.colors ?? process.stdout.isTTY;
  const maxWidth = options.maxWidth ?? process.stdout.columns;
  const showDefault = options.showDefault;
  const showChoices = options.showChoices;
  const sectionOrder = options.sectionOrder;
  const help = options.help;
  const version = options.version;
  const completion = options.completion;
  const aboveError = options.aboveError ?? "usage";
  const errorExitCode = options.errorExitCode ?? 1;
  const brief = options.brief ?? programMetadata?.brief;
  const description = options.description ?? programMetadata?.description;
  const examples = options.examples ?? programMetadata?.examples;
  const author = options.author ?? programMetadata?.author;
  const bugs = options.bugs ?? programMetadata?.bugs;
  const footer = options.footer ?? programMetadata?.footer;

  const onShow = () => onExit(0);

  // Convert help shorthand strings to sub-config objects, then pass through
  // object configs with onShow injected.
  const helpConfig: CoreRunOptions<never, never>["help"] = (() => {
    if (!help) return undefined;
    if (typeof help === "string") {
      switch (help) {
        case "command":
          return { command: true as const, onShow };
        case "option":
          return { option: true as const, onShow };
        case "both":
          return { command: true as const, option: true as const, onShow };
      }
    }
    return { ...help, onShow };
  })() as CoreRunOptions<never, never>["help"];

  // Convert version shorthand (string = option-only) to sub-config objects.
  const versionConfig: CoreRunOptions<never, never>["version"] = (() => {
    if (!version) return undefined;
    if (typeof version === "string") {
      return { value: version, option: true as const, onShow };
    }
    return { ...version, onShow };
  })() as CoreRunOptions<never, never>["version"];

  // Convert completion shorthand strings to sub-config objects.
  const completionConfig: CoreRunOptions<never, never>["completion"] = (() => {
    if (!completion) return undefined;
    if (typeof completion === "string") {
      switch (completion) {
        case "command":
          return { command: true as const, onShow };
        case "option":
          return { option: true as const, onShow };
        case "both":
          return { command: true as const, option: true as const, onShow };
      }
    }
    return { ...completion, onShow };
  })() as CoreRunOptions<never, never>["completion"];

  const coreOptions: CoreRunOptions<never, never> = {
    stderr,
    stdout,
    colors,
    maxWidth,
    showDefault,
    showChoices,
    sectionOrder,
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
      return onExit(errorExitCode);
    },
  };

  return { programName, args, coreOptions };
}

/**
 * Set of known RunOptions field names.  Used by `runImpl()` to separate
 * RunOptions fields from context-required options via rest-spread.
 */
const knownRunOptionsKeyList = [
  "programName",
  "args",
  "stdout",
  "stderr",
  "onExit",
  "colors",
  "maxWidth",
  "showDefault",
  "showChoices",
  "sectionOrder",
  "help",
  "version",
  "completion",
  "aboveError",
  "errorExitCode",
  "brief",
  "description",
  "examples",
  "author",
  "bugs",
  "footer",
  "contexts",
  "contextOptions",
  // Keep this list exhaustive with RunOptions so that the compile-time
  // exhaustiveness check below catches missing entries.
] as const satisfies readonly (keyof RunOptions)[];

type MissingKnownRunOptionsKeys = Exclude<
  keyof RunOptions,
  (typeof knownRunOptionsKeyList)[number]
>;
const _knownRunOptionsKeysAreExhaustive: MissingKnownRunOptionsKeys extends
  never ? true : never = true;
void _knownRunOptionsKeysAreExhaustive;

function runImpl<T extends Parser<Mode, unknown, unknown>>(
  parserOrProgram: T | Program<Mode, unknown>,
  options: RunOptions = {},
): ModeValue<InferMode<T>, InferValue<T>> | Promise<InferValue<T>> {
  const resolved = resolveProgramInput(parserOrProgram, options);
  const { parser, programMetadata } = resolved;
  options = resolved.options;

  // If contexts are present, delegate to runWith() (always async)
  const contexts = options.contexts;
  if (contexts && contexts.length > 0) {
    const { programName, args, coreOptions } = buildCoreOptions(
      options,
      programMetadata,
    );

    // Extract context-required options from the dedicated namespace
    const contextOptions = options.contextOptions ?? {};

    // Build RunWithOptions = CoreRunOptions + { args }
    const runWithOptions = {
      ...coreOptions,
      ...contextOptions,
      args,
    };

    // Context-aware parsing is always async (runWith returns Promise)
    return runWith(
      parser,
      programName,
      contexts,
      runWithOptions as Parameters<typeof runWith>[3],
    ) as Promise<InferValue<T>>;
  }

  // No contexts — use runParser directly
  const { programName, args, coreOptions } = buildCoreOptions(
    options,
    programMetadata,
  );

  return runParser(parser, programName, args, coreOptions);
}
