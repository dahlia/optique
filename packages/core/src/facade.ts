import { formatDocPage } from "./doc.ts";
import { formatMessage, message } from "./message.ts";
import {
  argument,
  command,
  constant,
  flag,
  getDocPage,
  type InferValue,
  longestMatch,
  merge,
  multiple,
  object,
  option,
  parse,
  type Parser,
} from "./parser.ts";
import { formatUsage } from "./usage.ts";
import { string } from "./valueparser.ts";

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
   * Function used to output error messages.
   *
   * @default `console.error`
   */
  readonly stderr?: (text: string) => void;

  /**
   * Function used to output help and usage messages.
   *
   * @default `console.log`
   */
  readonly stdout?: (text: string) => void;
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
  // Extract help configuration
  const helpMode = options.help?.mode ?? "option";
  const onHelp = options.help?.onShow ?? (() => ({} as THelp));

  // Extract version configuration
  const versionMode = options.version?.mode ?? "option";
  const versionValue = options.version?.value ?? "";
  const onVersion = options.version?.onShow ?? (() => ({} as THelp));

  let {
    colors,
    maxWidth,
    aboveError = "usage",
    onError = () => {
      throw new RunError("Failed to parse command line arguments.");
    },
    stderr = console.error,
    stdout = console.log,
  } = options;

  // Determine if help is enabled
  const help = options.help ? helpMode : "none";
  const contextualHelpParser = object({
    help: constant(true),
    version: constant(false),
    commands: multiple(argument(string({
      metavar: "COMMAND",
      pattern: /^[^-].*$/, // Reject strings starting with -
    }))),
    __help: flag("--help"),
  });
  const helpCommand = command(
    "help",
    multiple(argument(string({ metavar: "COMMAND" }))),
    {
      description: message`Show help information.`,
    },
  );
  const helpOption = option("--help", {
    description: message`Show help information.`,
  });

  // Determine if version is enabled
  const version = options.version ? versionMode : "none";
  const versionCommand = command(
    "version",
    object({}),
    {
      description: message`Show version information.`,
    },
  );
  const versionOption = option("--version", {
    description: message`Show version information.`,
  });
  // Build augmented parser with help and version functionality
  const augmentedParser = help === "none" && version === "none"
    ? parser
    : help === "none" && version === "command"
    ? longestMatch(
      object({
        help: constant(false),
        version: constant(true),
        result: versionCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
    )
    : help === "none" && version === "option"
    ? longestMatch(
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      merge(
        object({
          help: constant(false),
          version: constant(true),
        }),
        versionOption,
      ),
    )
    : help === "none" && version === "both"
    ? longestMatch(
      object({
        help: constant(false),
        version: constant(true),
        result: versionCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      merge(
        object({
          help: constant(false),
          version: constant(true),
        }),
        versionOption,
      ),
    )
    : help === "command" && version === "none"
    ? longestMatch(
      object({
        help: constant(true),
        version: constant(false),
        commands: helpCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
    )
    : help === "command" && version === "command"
    ? longestMatch(
      object({
        help: constant(true),
        version: constant(false),
        commands: helpCommand,
      }),
      object({
        help: constant(false),
        version: constant(true),
        result: versionCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
    )
    : help === "command" && version === "option"
    ? longestMatch(
      object({
        help: constant(true),
        version: constant(false),
        commands: helpCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      merge(
        object({
          help: constant(false),
          version: constant(true),
        }),
        versionOption,
      ),
    )
    : help === "command" && version === "both"
    ? longestMatch(
      object({
        help: constant(true),
        version: constant(false),
        commands: helpCommand,
      }),
      object({
        help: constant(false),
        version: constant(true),
        result: versionCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      merge(
        object({
          help: constant(false),
          version: constant(true),
        }),
        versionOption,
      ),
    )
    : help === "option" && version === "none"
    ? longestMatch(
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      contextualHelpParser,
      merge(
        object({
          help: constant(true),
          version: constant(false),
          commands: constant([]),
        }),
        helpOption,
      ),
    )
    : help === "option" && version === "command"
    ? longestMatch(
      object({
        help: constant(false),
        version: constant(true),
        result: versionCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      contextualHelpParser,
      merge(
        object({
          help: constant(true),
          version: constant(false),
          commands: constant([]),
        }),
        helpOption,
      ),
    )
    : help === "option" && version === "option"
    ? longestMatch(
      merge(
        object({
          help: constant(false),
          version: constant(true),
        }),
        versionOption,
      ),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      contextualHelpParser,
      merge(
        object({
          help: constant(true),
          version: constant(false),
          commands: constant([]),
        }),
        helpOption,
      ),
    )
    : help === "option" && version === "both"
    ? longestMatch(
      merge(
        object({
          help: constant(false),
          version: constant(true),
        }),
        versionOption,
      ),
      object({
        help: constant(false),
        version: constant(true),
        result: versionCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      contextualHelpParser,
      merge(
        object({
          help: constant(true),
          version: constant(false),
          commands: constant([]),
        }),
        helpOption,
      ),
    )
    : help === "both" && version === "none"
    ? longestMatch(
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      object({
        help: constant(true),
        version: constant(false),
        commands: helpCommand,
      }),
      contextualHelpParser,
      merge(
        object({
          help: constant(true),
          version: constant(false),
          commands: constant([]),
        }),
        helpOption,
      ),
    )
    : help === "both" && version === "command"
    ? longestMatch(
      object({
        help: constant(true),
        version: constant(false),
        commands: helpCommand,
      }),
      object({
        help: constant(false),
        version: constant(true),
        result: versionCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      contextualHelpParser,
      merge(
        object({
          help: constant(true),
          version: constant(false),
          commands: constant([]),
        }),
        helpOption,
      ),
    )
    : help === "both" && version === "option"
    ? longestMatch(
      merge(
        object({
          help: constant(false),
          version: constant(true),
        }),
        versionOption,
      ),
      object({
        help: constant(true),
        version: constant(false),
        commands: helpCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      contextualHelpParser,
      merge(
        object({
          help: constant(true),
          version: constant(false),
          commands: constant([]),
        }),
        helpOption,
      ),
    )
    : longestMatch(
      merge(
        object({
          help: constant(false),
          version: constant(true),
        }),
        versionOption,
      ),
      object({
        help: constant(false),
        version: constant(true),
        result: versionCommand,
      }),
      object({
        help: constant(true),
        version: constant(false),
        commands: helpCommand,
      }),
      object({
        help: constant(false),
        version: constant(false),
        result: parser,
      }),
      longestMatch(
        contextualHelpParser,
        merge(
          object({
            help: constant(true),
            version: constant(false),
            commands: constant([]),
          }),
          helpOption,
        ),
      ),
    );
  let result = parse(augmentedParser, args);

  // Special handling: if version/help parsers succeeded without actual input,
  // treat it as a failure and retry with original parser
  if (
    result.success && typeof result.value === "object" &&
    result.value != null &&
    "help" in result.value && "version" in result.value
  ) {
    const parsedValue = result.value as {
      help: boolean;
      version: boolean;
      result?: unknown;
    };

    const hasVersionInput = args.includes("--version") ||
      (args.length > 0 && args[0] === "version");
    const hasHelpInput = args.includes("--help") ||
      (args.length > 0 && args[0] === "help");

    // If version/help flags are set but no actual input was provided, use original parser
    if (
      (parsedValue.version && !hasVersionInput) ||
      (parsedValue.help && !hasHelpInput && !parsedValue.result)
    ) {
      result = parse(parser, args);
    }
  }

  if (result.success) {
    const value = result.value;
    if (help === "none" && version === "none") {
      return value;
    }

    // Type guard to check if value has help and version properties
    if (
      typeof value === "object" && value != null &&
      "help" in value && "version" in value
    ) {
      const parsedValue = value as {
        help: boolean;
        version: boolean;
        result?: unknown;
        commands?: unknown;
      };

      // Check if version was requested first (version has precedence)
      if (parsedValue.version) {
        // Only show version if explicitly requested via --version or version command
        const hasVersionOption = args.includes("--version");
        const hasVersionCommand = args.length > 0 && args[0] === "version";

        if (hasVersionOption || hasVersionCommand) {
          stdout(versionValue);
          try {
            return onVersion(0);
          } catch {
            return (onVersion as (() => THelp))();
          }
        }
      }

      // Check if help was requested
      if (parsedValue.help) {
        // Special case: if both --version and --help are present in args,
        // prioritize version over help
        if (version !== "none" && args.includes("--version")) {
          stdout(versionValue);
          try {
            return onVersion(0);
          } catch {
            return (onVersion as (() => THelp))();
          }
        }
        // Handle help request
        let commandContext: readonly string[] = [];

        if (Array.isArray(parsedValue.commands)) {
          // From contextualHelpParser: ["list"] from "list --help"
          commandContext = parsedValue.commands;
        } else if (
          typeof parsedValue.commands === "object" &&
          parsedValue.commands != null &&
          "length" in parsedValue.commands
        ) {
          // From helpCommand: array from "help list"
          commandContext = parsedValue.commands as readonly string[];
        }

        const doc = getDocPage(
          commandContext.length < 1 ? augmentedParser : parser,
          commandContext,
        );
        if (doc != null) {
          stdout(formatDocPage(programName, doc, {
            colors,
            maxWidth,
          }));
        }
        try {
          return onHelp(0);
        } catch {
          return (onHelp as (() => THelp))();
        }
      }

      // Neither help nor version requested, return the result
      return parsedValue.result ?? value;
    } else {
      // This shouldn't happen with proper parser setup, but handle gracefully
      return value;
    }
  }
  if (aboveError === "help") {
    const doc = getDocPage(args.length < 1 ? augmentedParser : parser, args);
    if (doc == null) aboveError = "usage";
    else {
      stderr(formatDocPage(programName, doc, {
        colors,
        maxWidth,
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
  stderr(`Error: ${formatMessage(result.error, { colors, quotes: !colors })}`);
  return onError(1);
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
