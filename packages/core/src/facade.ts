import {
  bash,
  fish,
  nu,
  pwsh,
  type ShellCompletion,
  zsh,
} from "./completion.ts";
import { longestMatch, object } from "./constructs.ts";
import { formatDocPage, type ShowDefaultOptions } from "./doc.ts";
import {
  commandLine,
  formatMessage,
  type Message,
  message,
  type MessageTerm,
  optionName,
  text,
  value,
} from "./message.ts";
import { multiple, optional, withDefault } from "./modifiers.ts";
import {
  getDocPage,
  type InferValue,
  parse,
  type Parser,
  suggest,
} from "./parser.ts";
import { argument, command, constant, flag, option } from "./primitives.ts";
import { formatUsage } from "./usage.ts";
import { string } from "./valueparser.ts";

/**
 * Helper types for parser generation
 */
interface HelpParsers {
  readonly helpCommand: Parser<readonly string[], unknown> | null;
  readonly helpOption: Parser<boolean, unknown> | null;
}

interface VersionParsers {
  readonly versionCommand: Parser<Record<PropertyKey, never>, unknown> | null;
  readonly versionOption: Parser<boolean, unknown> | null;
}

/**
 * Creates help parsers based on the specified mode.
 */
function createHelpParser(mode: "command" | "option" | "both"): HelpParsers {
  const helpCommand = command(
    "help",
    multiple(
      argument(string({ metavar: "COMMAND" }), {
        description: message`Command name to show help for.`,
      }),
    ),
    {
      description: message`Show help information.`,
    },
  );

  const helpOption = flag("--help", {
    description: message`Show help information.`,
  });

  switch (mode) {
    case "command":
      return { helpCommand, helpOption: null };
    case "option":
      return { helpCommand: null, helpOption };
    case "both":
      return { helpCommand, helpOption };
  }
}

/**
 * Creates version parsers based on the specified mode.
 */
function createVersionParser(
  mode: "command" | "option" | "both",
): VersionParsers {
  const versionCommand = command(
    "version",
    object({}),
    {
      description: message`Show version information.`,
    },
  );

  const versionOption = flag("--version", {
    description: message`Show version information.`,
  });

  switch (mode) {
    case "command":
      return { versionCommand, versionOption: null };
    case "option":
      return { versionCommand: null, versionOption };
    case "both":
      return { versionCommand, versionOption };
  }
}

interface CompletionParsers {
  readonly completionCommand:
    | Parser<
      { shell: string | undefined; args: readonly string[] },
      unknown
    >
    | null;
  readonly completionOption:
    | Parser<
      { shell: string; args: readonly string[] },
      unknown
    >
    | null;
}

/**
 * Creates completion parsers based on the specified mode.
 */
function createCompletionParser(
  mode: "command" | "option" | "both",
  programName: string,
  availableShells: Record<string, ShellCompletion>,
): CompletionParsers {
  const shellList: MessageTerm[] = [];
  for (const shell in availableShells) {
    if (shellList.length > 0) shellList.push(text(", "));
    shellList.push(value(shell));
  }
  const completionCommand = command(
    "completion",
    object({
      shell: optional(
        argument(string({ metavar: "SHELL" }), {
          description:
            message`Shell type (${shellList}). Generate completion script when used alone, or provide completions when followed by arguments.`,
        }),
      ),
      args: multiple(
        argument(string({ metavar: "ARG" }), {
          description:
            message`Command line arguments for completion suggestions (used by shell integration; you usually don't need to provide this).`,
        }),
      ),
    }),
    {
      brief: message`Generate shell completion script or provide completions.`,
      description:
        message`Generate shell completion script or provide completions.`,
      footer: message`Examples:
  Bash:       ${commandLine(`eval "$(${programName} completion bash)"`)}
  zsh:        ${commandLine(`eval "$(${programName} completion zsh)"`)}
  fish:       ${commandLine(`eval "$(${programName} completion fish)"`)}
  PowerShell: ${
        commandLine(
          `${programName} completion pwsh > ${programName}-completion.ps1; . ./${programName}-completion.ps1`,
        )
      }
  Nushell:    ${
        commandLine(
          `${programName} completion nu | save ${programName}-completion.nu; source ./${programName}-completion.nu`,
        )
      }
`,
    },
  );

  const completionOption = option(
    "--completion",
    string({ metavar: "SHELL" }),
    {
      description: message`Generate shell completion script.`,
    },
  );

  switch (mode) {
    case "command":
      return {
        completionCommand,
        completionOption: null,
      };
    case "option":
      return {
        completionCommand: null,
        completionOption: object({
          shell: completionOption,
          args: withDefault(
            multiple(
              argument(string({ metavar: "ARG" }), {
                description:
                  message`Command line arguments for completion suggestions (used by shell integration; you usually don't need to provide this).`,
              }),
            ),
            [] as readonly string[],
          ),
        }),
      };
    case "both":
      return {
        completionCommand,
        completionOption: object({
          shell: completionOption,
          args: withDefault(
            multiple(
              argument(string({ metavar: "ARG" }), {
                description:
                  message`Command line arguments for completion suggestions (used by shell integration; you usually don't need to provide this).`,
              }),
            ),
            [] as readonly string[],
          ),
        }),
      };
  }
}

/**
 * Result classification types for cleaner control flow.
 */
type ParsedResult =
  | { readonly type: "success"; readonly value: unknown }
  | { readonly type: "help"; readonly commands: readonly string[] }
  | { readonly type: "version" }
  | {
    readonly type: "completion";
    readonly shell: string;
    readonly args: readonly string[];
  }
  | { readonly type: "error"; readonly error: Message };

/**
 * Systematically combines the original parser with help, version, and completion parsers.
 */
function combineWithHelpVersion(
  originalParser: Parser<unknown, unknown>,
  helpParsers: HelpParsers,
  versionParsers: VersionParsers,
  completionParsers: CompletionParsers,
): Parser<unknown, unknown> {
  const parsers: Parser<unknown, unknown>[] = [];

  // Add options FIRST - they are more specific and should have priority

  // Add help option (standalone) - accepts any mix of options and arguments
  if (helpParsers.helpOption) {
    // Create a lenient help parser that accepts help flag anywhere
    // and ignores all other options/arguments
    const lenientHelpParser: Parser<unknown, unknown> = {
      $valueType: [],
      $stateType: [],
      priority: 200, // Very high priority
      usage: helpParsers.helpOption.usage,
      initialState: null,

      parse(context) {
        const { buffer, optionsTerminated } = context;

        // If options are terminated (after --), don't match
        if (optionsTerminated) {
          return {
            success: false,
            error: message`Options terminated.`,
            consumed: 0,
          };
        }

        let helpFound = false;
        let helpIndex = -1;

        // Look for --help and --version to implement last-option-wins
        let versionIndex = -1;
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] === "--") break; // Stop at options terminator
          if (buffer[i] === "--help") {
            helpFound = true;
            helpIndex = i;
          }
          if (buffer[i] === "--version") {
            versionIndex = i;
          }
        }

        // If both --help and --version are present, but version comes last, don't match
        if (helpFound && versionIndex > helpIndex) {
          return {
            success: false,
            error: message`Version option wins.`,
            consumed: 0,
          };
        }

        // Multiple --help is OK - just show help

        if (helpFound) {
          // Extract command names that appear before --help
          const commands: string[] = [];
          for (let i = 0; i < helpIndex; i++) {
            const arg = buffer[i];
            // Include non-option arguments as commands (don't start with -)
            if (!arg.startsWith("-")) {
              commands.push(arg);
            }
          }

          // Consume all remaining arguments and return success
          return {
            success: true,
            next: {
              ...context,
              buffer: [],
              state: {
                help: true,
                version: false,
                commands,
                helpFlag: true,
              },
            },
            consumed: buffer.slice(0),
          };
        }

        // --help not found
        return {
          success: false,
          error: message`Flag ${optionName("--help")} not found.`,
          consumed: 0,
        };
      },

      complete(state) {
        return { success: true, value: state };
      },

      suggest(_context, prefix) {
        // Suggest --help if it matches the prefix
        if ("--help".startsWith(prefix)) {
          return [{ kind: "literal", text: "--help" }];
        }
        return [];
      },

      getDocFragments(state) {
        return helpParsers.helpOption?.getDocFragments(state) ??
          { fragments: [] };
      },
    };

    parsers.push(lenientHelpParser);
  }

  // Add version option (standalone) - accepts any mix of options and arguments
  if (versionParsers.versionOption) {
    // Create a lenient version parser that accepts version flag anywhere
    // and ignores all other options/arguments
    const lenientVersionParser: Parser<unknown, unknown> = {
      $valueType: [],
      $stateType: [],
      priority: 200, // Very high priority
      usage: versionParsers.versionOption.usage,
      initialState: null,

      parse(context) {
        const { buffer, optionsTerminated } = context;

        // If options are terminated (after --), don't match
        if (optionsTerminated) {
          return {
            success: false,
            error: message`Options terminated.`,
            consumed: 0,
          };
        }

        let versionFound = false;
        let versionIndex = -1;

        // Look for --version and --help to implement last-option-wins
        let helpIndex = -1;
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] === "--") break; // Stop at options terminator
          if (buffer[i] === "--version") {
            versionFound = true;
            versionIndex = i;
          }
          if (buffer[i] === "--help") {
            helpIndex = i;
          }
        }

        // If both --version and --help are present, but help comes last, don't match
        if (versionFound && helpIndex > versionIndex) {
          return {
            success: false,
            error: message`Help option wins.`,
            consumed: 0,
          };
        }

        // Multiple --version is OK - just show version

        if (versionFound) {
          // Consume all remaining arguments and return success
          return {
            success: true,
            next: {
              ...context,
              buffer: [],
              state: { help: false, version: true, versionFlag: true },
            },
            consumed: buffer.slice(0),
          };
        }

        // --version not found
        return {
          success: false,
          error: message`Flag ${optionName("--version")} not found.`,
          consumed: 0,
        };
      },

      complete(state) {
        return { success: true, value: state };
      },

      suggest(_context, prefix) {
        // Suggest --version if it matches the prefix
        if ("--version".startsWith(prefix)) {
          return [{ kind: "literal", text: "--version" }];
        }
        return [];
      },

      getDocFragments(state) {
        return versionParsers.versionOption?.getDocFragments(state) ??
          { fragments: [] };
      },
    };

    parsers.push(lenientVersionParser);
  }

  // Add version command with optional help flag (enables version --help)
  if (versionParsers.versionCommand) {
    parsers.push(object({
      help: constant(false),
      version: constant(true),
      completion: constant(false),
      result: versionParsers.versionCommand,
      helpFlag: helpParsers.helpOption
        ? optional(helpParsers.helpOption)
        : constant(false),
    }));
  }

  // Add completion command with optional help flag (enables completion --help)
  if (completionParsers.completionCommand) {
    parsers.push(object({
      help: constant(false),
      version: constant(false),
      completion: constant(true),
      completionData: completionParsers.completionCommand,
      helpFlag: helpParsers.helpOption
        ? optional(helpParsers.helpOption)
        : constant(false),
    }));
  }

  // Add help command
  if (helpParsers.helpCommand) {
    parsers.push(object({
      help: constant(true),
      version: constant(false),
      completion: constant(false),
      commands: helpParsers.helpCommand,
    }));
  }

  // Add main parser LAST - it's the most general
  parsers.push(object({
    help: constant(false),
    version: constant(false),
    completion: constant(false),
    result: originalParser,
  }));
  if (parsers.length === 1) {
    return parsers[0];
  } else if (parsers.length === 2) {
    return longestMatch(parsers[0], parsers[1]);
  } else {
    // Use variadic longestMatch for all parsers
    // Our lenient help/version parsers will win because they consume all input
    return (longestMatch as (
      ...parsers: Parser<unknown, unknown>[]
    ) => Parser<unknown, unknown>)(...parsers);
  }
}

/**
 * Classifies the parsing result into a discriminated union for cleaner handling.
 */
function classifyResult(
  result: ReturnType<typeof parse>,
  args: readonly string[],
): ParsedResult {
  if (!result.success) {
    return { type: "error", error: result.error };
  }

  const value = result.value;
  if (
    typeof value === "object" && value != null && "help" in value &&
    "version" in value
  ) {
    const parsedValue = value as {
      help: boolean;
      version: boolean;
      completion?: boolean;
      commands?: readonly string[];
      completionData?: { shell: string | undefined; args: readonly string[] };
      result?: unknown;
      helpFlag?: boolean;
      versionFlag?: boolean;
    };

    const hasVersionOption = args.includes("--version");
    const hasVersionCommand = args.length > 0 && args[0] === "version";
    const hasHelpOption = args.includes("--help");
    const hasHelpCommand = args.length > 0 && args[0] === "help";
    const hasCompletionCommand = args.length > 0 && args[0] === "completion";

    // Standard CLI behavior:
    // 1. `command --help` should show help for that command
    // 2. `--help --version` or `--version --help` should cause error (conflicting options)
    // 3. `--version` alone should show version
    // 4. `--help` alone should show help
    // 5. `completion --help` should show help for completion command

    // Check for conflicting options: both --version and --help flags
    if (
      hasVersionOption && hasHelpOption && !hasVersionCommand && !hasHelpCommand
    ) {
      // Both version and help options provided - this should be an error
      // Let the parser handle this naturally by not providing special handling
      // This will result in a parse error
    }

    // If we have both version command and help flag, help takes precedence (show help for version)
    if (hasVersionCommand && hasHelpOption && parsedValue.helpFlag) {
      return { type: "help", commands: ["version"] };
    }

    // If we have both completion command and help flag, help takes precedence (show help for completion)
    if (hasCompletionCommand && hasHelpOption && parsedValue.helpFlag) {
      return { type: "help", commands: ["completion"] };
    }

    // If we have help command or help option, show help
    if (parsedValue.help && (hasHelpOption || hasHelpCommand)) {
      let commandContext: readonly string[] = [];

      if (Array.isArray(parsedValue.commands)) {
        commandContext = parsedValue.commands;
      } else if (
        typeof parsedValue.commands === "object" &&
        parsedValue.commands != null &&
        "length" in parsedValue.commands
      ) {
        commandContext = parsedValue.commands as readonly string[];
      }

      return { type: "help", commands: commandContext };
    }

    // If version is present and help is not requested, show version
    if (
      (hasVersionOption || hasVersionCommand) &&
      (parsedValue.version || parsedValue.versionFlag)
    ) {
      return { type: "version" };
    }

    // If completion is present and help is not requested, show completion
    if (parsedValue.completion && parsedValue.completionData) {
      return {
        type: "completion",
        shell: parsedValue.completionData.shell || "",
        args: parsedValue.completionData.args || [],
      };
    }

    // Neither help nor version nor completion requested, return the actual result
    return { type: "success", value: parsedValue.result ?? value };
  }

  return { type: "success", value };
}

/**
 * Configuration options for the {@link run} function.
 *
 * @template THelp The return type when help is shown.
 * @template TError The return type when an error occurs.
 */
export interface RunOptions<THelp, TError> {
  /**
   * Enable colored output in help and error messages.
   *
   * @default `false`
   */
  readonly colors?: boolean;

  /**
   * Maximum width for output formatting. Text will be wrapped to fit within
   * this width.  If not specified, text will not be wrapped.
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
   * Help configuration. When provided, enables help functionality.
   */
  readonly help?: {
    /**
     * Determines how help is made available:
     *
     * - `"command"`: Only the `help` subcommand is available
     * - `"option"`: Only the `--help` option is available
     * - `"both"`: Both `help` subcommand and `--help` option are available
     *
     * @default `"option"`
     */
    readonly mode?: "command" | "option" | "both";

    /**
     * Callback function invoked when help is requested. The function can
     * optionally receive an exit code parameter.
     *
     * You usually want to pass `process.exit` on Node.js or Bun and `Deno.exit`
     * on Deno to this option.
     *
     * @default Returns `void` when help is shown.
     */
    readonly onShow?: (() => THelp) | ((exitCode: number) => THelp);
  };

  /**
   * Version configuration. When provided, enables version functionality.
   */
  readonly version?: {
    /**
     * Determines how version is made available:
     *
     * - `"command"`: Only the `version` subcommand is available
     * - `"option"`: Only the `--version` option is available
     * - `"both"`: Both `version` subcommand and `--version` option are available
     *
     * @default `"option"`
     */
    readonly mode?: "command" | "option" | "both";

    /**
     * The version string to display when version is requested.
     */
    readonly value: string;

    /**
     * Callback function invoked when version is requested. The function can
     * optionally receive an exit code parameter.
     *
     * You usually want to pass `process.exit` on Node.js or Bun and `Deno.exit`
     * on Deno to this option.
     *
     * @default Returns `void` when version is shown.
     */
    readonly onShow?: (() => THelp) | ((exitCode: number) => THelp);
  };

  /**
   * Completion configuration. When provided, enables shell completion functionality.
   * @since 0.6.0
   */
  readonly completion?: {
    /**
     * Determines how completion is made available:
     *
     * - `"command"`: Only the `completion` subcommand is available
     * - `"option"`: Only the `--completion` option is available
     * - `"both"`: Both `completion` subcommand and `--completion` option are available
     *
     * @default `"both"`
     */
    readonly mode?: "command" | "option" | "both";

    /**
     * Available shell completions. By default, includes `bash`, `fish`, `nu`,
     * `pwsh`, and `zsh`. You can provide additional custom shell completions or
     * override the defaults.
     *
     * @default `{ bash, fish, nu, pwsh, zsh }`
     */
    readonly shells?: Record<string, ShellCompletion>;

    /**
     * Callback function invoked when completion is requested. The function can
     * optionally receive an exit code parameter.
     *
     * You usually want to pass `process.exit` on Node.js or Bun and `Deno.exit`
     * on Deno to this option.
     *
     * @default Returns `void` when completion is shown.
     */
    readonly onShow?: (() => THelp) | ((exitCode: number) => THelp);
  };

  /**
   * What to display above error messages:
   * - `"usage"`: Show usage information
   * - `"help"`: Show help text (if available)
   * - `"none"`: Show nothing above errors
   *
   * @default `"usage"`
   */
  readonly aboveError?: "usage" | "help" | "none";

  /**
   * Callback function invoked when parsing fails. The function can
   * optionally receive an exit code parameter.
   *
   * You usually want to pass `process.exit` on Node.js or Bun and `Deno.exit`
   * on Deno to this option.
   * @default Throws a {@link RunError}.
   */
  readonly onError?: (() => TError) | ((exitCode: number) => TError);

  /**
   * Function used to output error messages.  Assumes it prints the ending
   * newline.
   *
   * @default `console.error`
   */
  readonly stderr?: (text: string) => void;

  /**
   * Function used to output help and usage messages.  Assumes it prints
   * the ending newline.
   *
   * @default `console.log`
   */
  readonly stdout?: (text: string) => void;

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
   * Footer text shown at the bottom of help text.
   *
   * @since 0.4.0
   */
  readonly footer?: Message;
}

/**
 * Handles shell completion requests.
 * @since 0.6.0
 */
function handleCompletion<THelp, TError>(
  completionArgs: readonly string[],
  programName: string,
  parser: Parser<unknown, unknown>,
  completionParser: Parser<unknown, unknown> | null,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
  onCompletion: (() => THelp) | ((exitCode: number) => THelp),
  onError: (() => TError) | ((exitCode: number) => TError),
  availableShells: Record<string, ShellCompletion>,
  colors?: boolean,
  maxWidth?: number,
  completionMode?: "command" | "option" | "both",
): THelp | TError {
  const shellName = completionArgs[0] || "";
  const args = completionArgs.slice(1);

  // Check if shell name is empty
  if (!shellName) {
    stderr("Error: Missing shell name for completion.\n");

    // Show help for completion command if parser is available
    if (completionParser) {
      const doc = getDocPage(completionParser, ["completion"]);
      if (doc) {
        stderr(formatDocPage(programName, doc, { colors, maxWidth }));
      }
    }

    try {
      return onError(1);
    } catch {
      return (onError as (() => TError))();
    }
  }

  const shell = availableShells[shellName];

  if (!shell) {
    const available: MessageTerm[] = [];
    for (const shell in availableShells) {
      if (available.length > 0) available.push(text(", "));
      available.push(value(shell));
    }
    stderr(
      formatMessage(
        message`Error: Unsupported shell ${shellName}. Available shells: ${available}.`,
        { colors, quotes: !colors },
      ),
    );
    return onError(1);
  }

  if (args.length === 0) {
    // Generate completion script
    const completionArg = completionMode === "option"
      ? "--completion"
      : "completion";
    const script = shell.generateScript(programName, [
      completionArg,
      shellName,
    ]);
    stdout(script);
  } else {
    // Provide completion suggestions
    // Add the current (incomplete) argument to the args array for suggest()
    const suggestions = suggest(parser, args as [string, ...string[]]);
    for (const chunk of shell.encodeSuggestions(suggestions)) {
      stdout(chunk);
    }
  }

  try {
    return onCompletion(0);
  } catch {
    return (onCompletion as (() => THelp))();
  }
}

/**
 * Runs a parser against command-line arguments with built-in help and error
 * handling.
 *
 * This function provides a complete CLI interface by automatically handling
 * help commands/options and displaying formatted error messages with usage
 * information when parsing fails. It augments the provided parser with help
 * functionality based on the configuration options.
 *
 * The function will:
 *
 * 1. Add help command/option support (unless disabled)
 * 2. Parse the provided arguments
 * 3. Display help if requested
 * 4. Show formatted error messages with usage/help info on parse failures
 * 5. Return the parsed result or invoke the appropriate callback
 *
 * @template TParser The parser type being run.
 * @template THelp Return type when help is shown (defaults to `void`).
 * @template TError Return type when an error occurs (defaults to `never`).
 * @param parser The parser to run against the command-line arguments.
 * @param programName Name of the program used in usage and help output.
 * @param args Command-line arguments to parse (typically from
 *             `process.argv.slice(2)` on Node.js or `Deno.args` on Deno).
 * @param options Configuration options for output formatting and callbacks.
 * @returns The parsed result value, or the return value of `onHelp`/`onError`
 *          callbacks.
 * @throws {RunError} When parsing fails and no `onError` callback is provided.
 */
export function run<
  TParser extends Parser<unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options: RunOptions<THelp, TError> = {},
): InferValue<TParser> {
  // Extract all options first
  let {
    colors,
    maxWidth,
    showDefault,
    aboveError = "usage",
    onError = () => {
      throw new RunError("Failed to parse command line arguments.");
    },
    stderr = console.error,
    stdout = console.log,
    brief,
    description,
    footer,
  } = options;

  // Extract help configuration
  const helpMode = options.help?.mode ?? "option";
  const onHelp = options.help?.onShow ?? (() => ({} as THelp));

  // Extract version configuration
  const versionMode = options.version?.mode ?? "option";
  const versionValue = options.version?.value ?? "";
  const onVersion = options.version?.onShow ?? (() => ({} as THelp));

  // Extract completion configuration
  const completionMode = options.completion?.mode ?? "both";
  const onCompletion = options.completion?.onShow ?? (() => ({} as THelp));

  // Get available shells (defaults + user-provided)
  const defaultShells: Record<string, ShellCompletion> = {
    bash,
    fish,
    nu,
    pwsh,
    zsh,
  };
  const availableShells = options.completion?.shells
    ? { ...defaultShells, ...options.completion.shells }
    : defaultShells;

  // Create help and version parsers using the helper functions
  const help = options.help ? helpMode : "none";
  const version = options.version ? versionMode : "none";
  const completion = options.completion ? completionMode : "none";

  const helpParsers = help === "none"
    ? { helpCommand: null, helpOption: null }
    : createHelpParser(help);

  const versionParsers = version === "none"
    ? { versionCommand: null, versionOption: null }
    : createVersionParser(version);

  // Completion parsers for help generation only (not for actual parsing)
  const completionParsers = completion === "none"
    ? { completionCommand: null, completionOption: null }
    : createCompletionParser(completion, programName, availableShells);

  // Early return for completion requests (avoids parser conflicts)
  // Exception: if --help is present, let the parser handle it
  if (options.completion) {
    const hasHelpOption = args.includes("--help");

    // Handle completion command format: "completion <shell> [args...]"
    if (
      (completionMode === "command" || completionMode === "both") &&
      args.length >= 1 && args[0] === "completion" &&
      !hasHelpOption // Let parser handle "completion --help"
    ) {
      return handleCompletion(
        args.slice(1),
        programName,
        parser,
        completionParsers.completionCommand,
        stdout,
        stderr,
        onCompletion,
        onError,
        availableShells,
        colors,
        maxWidth,
        completionMode,
      );
    }

    // Handle completion option format: "--completion=<shell> [args...]"
    if (completionMode === "option" || completionMode === "both") {
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("--completion=")) {
          const shell = arg.slice("--completion=".length);
          const completionArgs = args.slice(i + 1);
          return handleCompletion(
            [shell, ...completionArgs],
            programName,
            parser,
            completionParsers.completionCommand,
            stdout,
            stderr,
            onCompletion,
            onError,
            availableShells,
            colors,
            maxWidth,
            completionMode,
          );
        } else if (arg === "--completion" && i + 1 < args.length) {
          const shell = args[i + 1];
          const completionArgs = args.slice(i + 2);
          return handleCompletion(
            [shell, ...completionArgs],
            programName,
            parser,
            completionParsers.completionCommand,
            stdout,
            stderr,
            onCompletion,
            onError,
            availableShells,
            colors,
            maxWidth,
            completionMode,
          );
        }
      }
    }
  }

  // Build augmented parser with help, version, and completion functionality
  // Completion command is included for help support, but actual completion
  // requests are handled via early return to avoid parser conflicts
  const augmentedParser = help === "none" && version === "none" &&
      completion === "none"
    ? parser
    : combineWithHelpVersion(
      parser,
      helpParsers,
      versionParsers,
      completionParsers,
    );
  const result = parse(augmentedParser, args);
  const classified = classifyResult(result, args);

  switch (classified.type) {
    case "success":
      return classified.value;

    case "version":
      stdout(versionValue);
      try {
        return onVersion(0);
      } catch {
        return (onVersion as (() => THelp))();
      }

    case "completion":
      // This case should never be reached due to early return,
      // but keep it for type safety
      throw new RunError("Completion should be handled by early return");

    case "help": {
      // Handle help request - determine which parser to use for help generation
      // Include completion command in help even though it's handled via early return
      let helpGeneratorParser: Parser<unknown, unknown>;
      const helpAsCommand = help === "command" || help === "both";
      const versionAsCommand = version === "command" || version === "both";
      const completionAsCommand = completion === "command" ||
        completion === "both";

      // Check if user is requesting help for a specific meta-command
      const requestedCommand = classified.commands[0];
      if (
        requestedCommand === "completion" && completionAsCommand &&
        completionParsers.completionCommand
      ) {
        // User wants help for completion command specifically
        helpGeneratorParser = completionParsers.completionCommand;
      } else if (
        requestedCommand === "help" && helpAsCommand &&
        helpParsers.helpCommand
      ) {
        // User wants help for help command specifically
        helpGeneratorParser = helpParsers.helpCommand;
      } else if (
        requestedCommand === "version" && versionAsCommand &&
        versionParsers.versionCommand
      ) {
        // User wants help for version command specifically
        helpGeneratorParser = versionParsers.versionCommand;
      } else {
        // General help or help for user-defined commands
        // Collect all command parsers to include in help generation
        const commandParsers: Parser<unknown, unknown>[] = [parser];

        if (helpAsCommand) {
          if (helpParsers.helpCommand) {
            commandParsers.push(helpParsers.helpCommand);
          }
        }

        if (versionAsCommand) {
          if (versionParsers.versionCommand) {
            commandParsers.push(versionParsers.versionCommand);
          }
        }

        if (completionAsCommand) {
          // Include completion in help even though it's handled via early return
          if (completionParsers.completionCommand) {
            commandParsers.push(completionParsers.completionCommand);
          }
        }

        // Use longestMatch to combine all parsers
        if (commandParsers.length === 1) {
          helpGeneratorParser = commandParsers[0];
        } else if (commandParsers.length === 2) {
          helpGeneratorParser = longestMatch(
            commandParsers[0],
            commandParsers[1],
          );
        } else {
          helpGeneratorParser = (longestMatch as (
            ...parsers: Parser<unknown, unknown>[]
          ) => Parser<unknown, unknown>)(...commandParsers);
        }
      }

      const doc = getDocPage(
        helpGeneratorParser,
        classified.commands,
      );
      if (doc != null) {
        // Augment the doc page with provided options
        // But if showing help for a specific meta-command, don't override its description
        const isMetaCommandHelp = requestedCommand === "completion" ||
          requestedCommand === "help" ||
          requestedCommand === "version";
        const augmentedDoc = {
          ...doc,
          brief: !isMetaCommandHelp ? (brief ?? doc.brief) : doc.brief,
          description: !isMetaCommandHelp
            ? (description ?? doc.description)
            : doc.description,
          footer: !isMetaCommandHelp ? (footer ?? doc.footer) : doc.footer,
        };
        stdout(formatDocPage(programName, augmentedDoc, {
          colors,
          maxWidth,
          showDefault,
        }));
      }
      try {
        return onHelp(0);
      } catch {
        return (onHelp as (() => THelp))();
      }
    }

    case "error": {
      // Error handling
      if (aboveError === "help") {
        const doc = getDocPage(
          args.length < 1 ? augmentedParser : parser,
          args,
        );
        if (doc == null) aboveError = "usage";
        else {
          // Augment the doc page with provided options
          const augmentedDoc = {
            ...doc,
            brief: brief ?? doc.brief,
            description: description ?? doc.description,
            footer: footer ?? doc.footer,
          };
          stderr(formatDocPage(programName, augmentedDoc, {
            colors,
            maxWidth,
            showDefault,
          }));
        }
      }
      if (aboveError === "usage") {
        stderr(
          `Usage: ${
            indentLines(
              formatUsage(programName, augmentedParser.usage, {
                colors,
                maxWidth: maxWidth == null ? undefined : maxWidth - 7,
                expandCommands: true,
              }),
              7,
            )
          }`,
        );
      }
      // classified.error is now typed as Message
      const errorMessage = formatMessage(classified.error, {
        colors,
        quotes: !colors,
      });
      stderr(`Error: ${errorMessage}`);
      return onError(1);
    }

    default:
      // This shouldn't happen but TypeScript doesn't know that
      throw new RunError("Unexpected parse result type");
  }
}

/**
 * An error class used to indicate that the command line arguments
 * could not be parsed successfully.
 */
export class RunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunError";
  }
}

function indentLines(text: string, indent: number): string {
  return text.split("\n").join("\n" + " ".repeat(indent));
}
