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
   * Determines how help is made available:
   *
   * - `"command"`: Only the `help` subcommand is available
   * - `"option"`: Only the `--help` option is available
   * - `"both"`: Both `help` subcommand and `--help` option are available
   * - `"none"`: No help functionality is provided
   *
   * @default `"none"`
   */
  readonly help?: "command" | "option" | "both" | "none";

  /**
   * Callback function invoked when help is requested. The function can
   * optionally receive an exit code parameter.
   *
   * You usually want to pass `process.exit` on Node.js or Bun and `Deno.exit`
   * on Deno to this option.
   *
   * @default Returns `void` when help is shown.
   */
  readonly onHelp?: (() => THelp) | ((exitCode: number) => THelp);

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
  let {
    colors,
    maxWidth,
    help = "none",
    onHelp = () => {},
    aboveError = "usage",
    onError = () => {
      throw new RunError("Failed to parse command line arguments.");
    },
    stderr = console.error,
    stdout = console.log,
  } = options;
  const contextualHelpParser = object({
    help: constant(true),
    commands: multiple(argument(string({ metavar: "COMMAND" }))),
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
  const augmentedParser = help === "none"
    ? parser
    : help === "command"
    ? longestMatch(
      object({
        help: constant(true),
        commands: helpCommand,
      }),
      object({ help: constant(false), result: parser }),
    )
    : help === "option"
    ? longestMatch(
      object({ help: constant(false), result: parser }),
      contextualHelpParser,
      merge(
        object({
          help: constant(true),
          commands: constant([]),
        }),
        helpOption,
      ),
    )
    : longestMatch(
      object({ help: constant(false), result: parser }),
      object({
        help: constant(true),
        commands: helpCommand,
      }),
      contextualHelpParser,
      merge(
        object({
          help: constant(true),
          commands: constant([]),
        }),
        helpOption,
      ),
    );
  const result = parse(augmentedParser, args);
  if (result.success) {
    const value = result.value;
    if (help === "none") {
      return value;
    }

    // Type guard to check if value has help property
    if (typeof value === "object" && value != null && "help" in value) {
      const helpValue = value as {
        help: boolean;
        result?: unknown;
        commands?: unknown;
      };
      if (!helpValue.help) {
        return helpValue.result;
      }
    } else {
      // This shouldn't happen with proper parser setup, but handle gracefully
      return value;
    }

    // Handle help request
    let commandContext: readonly string[] = [];

    const helpValue = value as { help: boolean; commands?: unknown };
    if (Array.isArray(helpValue.commands)) {
      // From contextualHelpParser: ["list"] from "list --help"
      commandContext = helpValue.commands;
    } else if (
      typeof helpValue.commands === "object" && helpValue.commands != null &&
      "length" in helpValue.commands
    ) {
      // From helpCommand: array from "help list"
      commandContext = helpValue.commands as readonly string[];
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
    return onHelp(0);
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
