import type { DocEntry, DocFragments, DocPage, DocSection } from "./doc.ts";
import { type Message, message } from "./message.ts";
import { normalizeUsage, type Usage, type UsageTerm } from "./usage.ts";
import type { ValueParserResult } from "./valueparser.ts";

/**
 * Represents the state passed to getDocFragments.
 * Can be either the actual parser state or an explicit indicator
 * that no state is available.
 * @template TState The type of the actual state when available.
 * @since 0.3.0
 */
export type DocState<TState> =
  | { readonly kind: "available"; readonly state: TState }
  | { readonly kind: "unavailable" };

/**
 * Parser interface for command-line argument parsing.
 * @template TValue The type of the value returned by the parser.
 * @template TState The type of the state used during parsing.
 */
export interface Parser<TValue, TState> {
  /**
   * A type tag for the result value of this parser, used for type inference.
   * Usually this is an empty array at runtime, but it does not matter
   * what it contains.
   * @internal
   */
  readonly $valueType: readonly TValue[];

  /**
   * A type tag for the state of this parser, used for type inference.
   * Usually this is an empty array at runtime, but it does not matter
   * what it contains.
   * @internal
   */
  readonly $stateType: readonly TState[];

  /**
   * The priority of this parser, which determines the order in which
   * parsers are applied when multiple parsers are available.  The greater
   * the number, the higher the priority.
   */
  readonly priority: number;

  /**
   * The usage information for this parser, which describes how
   * to use it in command-line interfaces.
   */
  readonly usage: Usage;

  /**
   * The initial state for this parser.  This is used to initialize the
   * state when parsing starts.
   */
  readonly initialState: TState;

  /**
   * Parses the input context and returns a result indicating
   * whether the parsing was successful or not.
   * @param context The context of the parser, which includes the input buffer
   *                and the current state.
   * @returns A result object indicating success or failure.
   */
  parse(context: ParserContext<TState>): ParserResult<TState>;

  /**
   * Transforms a {@link TState} into a {@link TValue}, if applicable.
   * If the transformation is not applicable, it should return
   * a `ValueParserResult` with `success: false` and an appropriate error
   * message.
   * @param state The current state of the parser, which may contain accumulated
   *              data or context needed to produce the final value.
   * @returns A result object indicating success or failure of
   *          the transformation.  If successful, it should contain
   *          the parsed value of type {@link TValue}.  If not applicable,
   *          it should return an error message.
   */
  complete(state: TState): ValueParserResult<TValue>;

  /**
   * Generates next-step suggestions based on the current context
   * and an optional prefix.  This can be used to provide shell completion
   * suggestions or to guide users in constructing valid commands.
   * @param context The context of the parser, which includes the input buffer
   *                and the current state.
   * @param prefix A prefix string that can be used to filter suggestions.
   *               Can be an empty string if no prefix is provided.
   * @returns An iterable of {@link Suggestion} objects, each containing
   *          a suggestion text and an optional description.
   * @since 0.6.0
   */
  suggest(context: ParserContext<TState>, prefix: string): Iterable<Suggestion>;

  /**
   * Generates a documentation fragment for this parser, which can be used
   * to describe the parser's usage, description, and default value.
   * @param state The current state of the parser, wrapped in a DocState
   *              to indicate whether the actual state is available or not.
   * @param defaultValue An optional default value that can be used
   *                     to provide a default value in the documentation.
   * @returns {@link DocFragments} object containing documentation
   *          fragments for this parser.
   */
  getDocFragments(state: DocState<TState>, defaultValue?: TValue): DocFragments;
}

/**
 * The context of the parser, which includes the input buffer and the state.
 * @template TState The type of the state used during parsing.
 */
export interface ParserContext<TState> {
  /**
   * The array of input strings that the parser is currently processing.
   */
  readonly buffer: readonly string[];

  /**
   * The current state of the parser, which is used to track
   * the progress of parsing and any accumulated data.
   */
  readonly state: TState;

  /**
   * A flag indicating whether no more options should be parsed and instead
   * the remaining input should be treated as positional arguments.
   * This is typically set when the parser encounters a `--` in the input,
   * which is a common convention in command-line interfaces to indicate
   * that no further options should be processed.
   */
  readonly optionsTerminated: boolean;

  /**
   * Usage information for the entire parser tree.
   * Used to provide better error messages with suggestions for typos.
   * When a parser encounters an invalid option or command, it can use
   * this information to suggest similar valid options.
   * @since 0.7.0
   */
  readonly usage: Usage;
}

/**
 * Represents a suggestion for command-line completion or guidance.
 * @since 0.6.0
 */
export type Suggestion =
  | {
    /**
     * A literal text suggestion.
     */
    readonly kind: "literal";
    /**
     * The suggestion text that can be used for completion or guidance.
     */
    readonly text: string;
    /**
     * An optional description providing additional context
     * or information about the suggestion.
     */
    readonly description?: Message;
  }
  | {
    /**
     * A file system completion suggestion that uses native shell completion.
     */
    readonly kind: "file";
    /**
     * The current prefix/pattern for fallback when native completion is unavailable.
     */
    readonly pattern?: string;
    /**
     * The type of file system entries to complete.
     */
    readonly type: "file" | "directory" | "any";
    /**
     * File extensions to filter by (e.g., [".ts", ".js"]).
     */
    readonly extensions?: readonly string[];
    /**
     * Whether to include hidden files (those starting with a dot).
     */
    readonly includeHidden?: boolean;
    /**
     * An optional description providing additional context
     * or information about the suggestion.
     */
    readonly description?: Message;
  };

/**
 * A discriminated union type representing the result of a parser operation.
 * It can either indicate a successful parse with the next state and context,
 * or a failure with an error message.
 * @template TState The type of the state after parsing.  It should match with
 *           the `TState` type of the {@link Parser} interface.
 */
export type ParserResult<TState> =
  | {
    /**
     * Indicates that the parsing operation was successful.
     */
    readonly success: true;

    /**
     * The next context after parsing, which includes the updated input buffer.
     */
    readonly next: ParserContext<TState>;

    /**
     * The input elements consumed by the parser during this operation.
     */
    readonly consumed: readonly string[];
  }
  | {
    /**
     * Indicates that the parsing operation failed.
     */
    readonly success: false;

    /**
     * The number of the consumed input elements.
     */
    readonly consumed: number;

    /**
     * The error message describing why the parsing failed.
     */
    readonly error: Message;
  };

/**
 * Infers the result value type of a {@link Parser}.
 * @template T The {@link Parser} to infer the result value type from.
 */
export type InferValue<T extends Parser<unknown, unknown>> =
  T["$valueType"][number];

/**
 * The result type of a whole parser operation, which can either be a successful
 * result with a value of type `T`, or a failure with an error message.
 * @template T The type of the value produced by the parser.
 */
export type Result<T> =
  | {
    /**
     * Indicates that the parsing operation was successful.
     */
    success: true;
    /**
     * The successfully parsed value of type {@link T}.
     * This is the final result of the parsing operation after all parsers
     * have been applied and completed.
     */
    value: T;
  }
  | {
    /**
     * Indicates that the parsing operation failed.
     */
    success: false;
    /**
     * The error message describing why the parsing failed.
     */
    error: Message;
  };

/**
 * Parses an array of command-line arguments using the provided combined parser.
 * This function processes the input arguments, applying the parser to each
 * argument until all arguments are consumed or an error occurs.
 * @template T The type of the value produced by the parser.
 * @param parser The combined {@link Parser} to use for parsing the input
 *               arguments.
 * @param args The array of command-line arguments to parse.  Usually this is
 *             `process.argv.slice(2)` in Node.js or `Deno.args` in Deno.
 * @returns A {@link Result} object indicating whether the parsing was
 *          successful or not.  If successful, it contains the parsed value of
 *          type `T`.  If not, it contains an error message describing the
 *          failure.
 */
export function parse<T>(
  parser: Parser<T, unknown>,
  args: readonly string[],
): Result<T> {
  let context: ParserContext<unknown> = {
    buffer: args,
    optionsTerminated: false,
    state: parser.initialState,
    usage: parser.usage,
  };
  do {
    const result = parser.parse(context);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    const previousBuffer = context.buffer;
    context = result.next;

    // If no progress was made (buffer completely unchanged), this indicates
    // a potential infinite loop where the parser succeeds but doesn't consume input
    if (
      context.buffer.length > 0 &&
      context.buffer.length === previousBuffer.length &&
      context.buffer.every((item, i) => item === previousBuffer[i])
    ) {
      return {
        success: false,
        error: message`Unexpected option or argument: ${context.buffer[0]}.`,
      };
    }
  } while (context.buffer.length > 0);
  const endResult = parser.complete(context.state);
  return endResult.success
    ? { success: true, value: endResult.value }
    : { success: false, error: endResult.error };
}

/**
 * Generates command-line suggestions based on current parsing state.
 * This function processes the input arguments up to the last argument,
 * then calls the parser's suggest method with the remaining prefix.
 * @template T The type of the value produced by the parser.
 * @param parser The {@link Parser} to use for generating suggestions.
 * @param args The array of command-line arguments including the partial
 *             argument to complete.  The last element is treated as
 *             the prefix for suggestions.
 * @returns An array of {@link Suggestion} objects containing completion
 *          candidates.
 * @example
 * ```typescript
 * const parser = object({
 *   verbose: option("-v", "--verbose"),
 *   format: option("-f", "--format", choice(["json", "yaml"]))
 * });
 *
 * // Get suggestions for options starting with "--"
 * const suggestions = suggest(parser, ["--"]);
 * // Returns: [{ text: "--verbose" }, { text: "--format" }]
 *
 * // Get suggestions after parsing some arguments
 * const suggestions2 = suggest(parser, ["-v", "--format="]);
 * // Returns: [{ text: "--format=json" }, { text: "--format=yaml" }]
 * ```
 * @since 0.6.0
 */
export function suggest<T>(
  parser: Parser<T, unknown>,
  args: readonly [string, ...readonly string[]],
): readonly Suggestion[] {
  const allButLast = args.slice(0, -1);
  const prefix = args[args.length - 1];

  let context: ParserContext<unknown> = {
    buffer: allButLast,
    optionsTerminated: false,
    state: parser.initialState,
    usage: parser.usage,
  };

  // Parse up to the prefix
  while (context.buffer.length > 0) {
    const result = parser.parse(context);
    if (!result.success) {
      // If parsing fails, we might still be able to provide suggestions
      // based on the current state. Try to get suggestions from the parser.
      return Array.from(parser.suggest(context, prefix));
    }
    const previousBuffer = context.buffer;
    context = result.next;

    // Check for infinite loop (same as in parse function)
    if (
      context.buffer.length > 0 &&
      context.buffer.length === previousBuffer.length &&
      context.buffer.every((item, i) => item === previousBuffer[i])
    ) {
      return [];
    }
  }

  // Get suggestions from the parser with the prefix
  return Array.from(parser.suggest(context, prefix));
}

/**
 * Recursively searches for a command within nested exclusive usage terms.
 * When the command is found, returns the expanded usage terms for that command.
 *
 * @param term The usage term to search in
 * @param commandName The command name to find
 * @returns The expanded usage terms if found, null otherwise
 */
function findCommandInExclusive(
  term: UsageTerm,
  commandName: string,
): Usage | null {
  if (term.type !== "exclusive") return null;

  for (const termGroup of term.terms) {
    const firstTerm = termGroup[0];

    // Direct match: first term is the command we're looking for
    if (firstTerm?.type === "command" && firstTerm.name === commandName) {
      return termGroup;
    }

    // Recursive case: first term is another exclusive (nested structure)
    if (firstTerm?.type === "exclusive") {
      const found = findCommandInExclusive(firstTerm, commandName);
      if (found) {
        // Replace the nested exclusive with the found terms,
        // then append the rest of termGroup (e.g., global options)
        return [...found, ...termGroup.slice(1)];
      }
    }
  }

  return null;
}

/**
 * Generates a documentation page for a parser based on its current state after
 * attempting to parse the provided arguments. This function is useful for
 * creating help documentation that reflects the current parsing context.
 *
 * The function works by:
 * 1. Attempting to parse the provided arguments to determine the current state
 * 2. Generating documentation fragments from the parser's current state
 * 3. Organizing fragments into entries and sections
 * 4. Resolving command usage terms based on parsed arguments
 *
 * @param parser The parser to generate documentation for
 * @param args Optional array of command-line arguments that have been parsed
 *             so far. Defaults to an empty array. This is used to determine
 *             the current parsing context and generate contextual documentation.
 * @returns A {@link DocPage} containing usage information, sections, and
 *          optional description, or `undefined` if no documentation can be
 *          generated.
 *
 * @example
 * ```typescript
 * const parser = object({
 *   verbose: option("-v", "--verbose"),
 *   port: option("-p", "--port", integer())
 * });
 *
 * // Get documentation for the root parser
 * const rootDoc = getDocPage(parser);
 *
 * // Get documentation after parsing some arguments
 * const contextDoc = getDocPage(parser, ["-v"]);
 * ```
 */
export function getDocPage(
  parser: Parser<unknown, unknown>,
  args: readonly string[] = [],
): DocPage | undefined {
  let context: ParserContext<unknown> = {
    buffer: args,
    optionsTerminated: false,
    state: parser.initialState,
    usage: parser.usage,
  };
  do {
    const result = parser.parse(context);
    if (!result.success) break;
    context = result.next;
  } while (context.buffer.length > 0);
  const { description, fragments, footer } = parser.getDocFragments(
    { kind: "available", state: context.state },
    undefined,
  );
  const entries: DocEntry[] = fragments.filter((f) => f.type === "entry");
  const sections: DocSection[] = [];
  for (const fragment of fragments) {
    if (fragment.type !== "section") continue;
    if (fragment.title == null) {
      entries.push(...fragment.entries);
    } else {
      sections.push(fragment);
    }
  }
  if (entries.length > 0) {
    sections.push({ entries });
  }
  const usage = [...normalizeUsage(parser.usage)];
  let i = 0;
  for (const arg of args) {
    if (i >= usage.length) break;
    const term = usage[i];
    if (term.type === "exclusive") {
      const found = findCommandInExclusive(term, arg);
      if (found) {
        usage.splice(i, 1, ...found);
      }
    }
    i++;
  }
  return {
    usage,
    sections,
    ...(description != null && { description }),
    ...(footer != null && { footer }),
  };
}

// Re-export all parser modules for backward compatibility
export * from "./constructs.ts";
export * from "./modifiers.ts";
export * from "./primitives.ts";
