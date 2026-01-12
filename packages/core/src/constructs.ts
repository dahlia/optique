import {
  type DeferredParseState,
  DependencyId,
  DependencyRegistry,
  isDeferredParseState,
  isDependencySourceState,
  isPendingDependencySourceState,
  isWrappedDependencySource,
  ParseWithDependency,
  WrappedDependencySourceMarker,
} from "./dependency.ts";
import type { DocEntry, DocFragment, DocSection } from "./doc.ts";
import {
  type Message,
  message,
  optionName as eOptionName,
  values,
} from "./message.ts";
import type {
  CombineModes,
  DocState,
  InferValue,
  Mode,
  ModeIterable,
  Parser,
  ParserContext,
  ParserResult,
  Suggestion,
} from "./parser.ts";

/**
 * Helper type to extract Mode from a Parser.
 * @internal
 */
type ExtractMode<T> = T extends Parser<infer M, unknown, unknown> ? M : never;

/**
 * Helper type to combine modes from an object of parsers.
 * Returns "async" if any parser is async, otherwise "sync".
 * @internal
 */
type CombineObjectModes<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
> = CombineModes<
  { [K in keyof T]: ExtractMode<T[K]> }[keyof T] extends infer M
    ? M extends Mode ? readonly [M] : never
    : never
>;

/**
 * Helper type to combine modes from a tuple of parsers.
 * Returns "async" if any parser is async, otherwise "sync".
 * @internal
 */
type CombineTupleModes<T extends readonly Parser<Mode, unknown, unknown>[]> =
  CombineModes<{ readonly [K in keyof T]: ExtractMode<T[K]> }>;
import {
  createErrorWithSuggestions,
  deduplicateSuggestions,
} from "./suggestion.ts";
import {
  extractArgumentMetavars,
  extractCommandNames,
  extractOptionNames,
  type Usage,
  type UsageTerm,
} from "./usage.ts";

/**
 * Checks if the given token is an option name that requires a value
 * (i.e., has a metavar) within the given usage terms.
 * @param usage The usage terms to search through.
 * @param token The token to check.
 * @returns `true` if the token is an option that requires a value, `false` otherwise.
 */
function isOptionRequiringValue(usage: Usage, token: string): boolean {
  function traverse(terms: Usage): boolean {
    if (!terms || !Array.isArray(terms)) return false;
    for (const term of terms) {
      if (term.type === "option") {
        // Option requires a value if it has a metavar
        if (term.metavar && term.names.includes(token)) {
          return true;
        }
      } else if (term.type === "optional" || term.type === "multiple") {
        if (traverse(term.terms)) return true;
      } else if (term.type === "exclusive") {
        for (const exclusiveUsage of term.terms) {
          if (traverse(exclusiveUsage)) return true;
        }
      }
    }
    return false;
  }

  return traverse(usage);
}
import type { ValueParserResult } from "./valueparser.ts";

/**
 * Options for customizing error messages in the {@link or} combinator.
 * @since 0.5.0
 */
export interface OrOptions {
  /**
   * Error message customization options.
   */
  errors?: OrErrorOptions;
}

/**
 * Context information about what types of inputs are expected,
 * used for generating contextual error messages.
 * @since 0.9.0
 */
export interface NoMatchContext {
  /**
   * Whether any of the parsers expect options.
   */
  readonly hasOptions: boolean;

  /**
   * Whether any of the parsers expect commands.
   */
  readonly hasCommands: boolean;

  /**
   * Whether any of the parsers expect arguments.
   */
  readonly hasArguments: boolean;
}

/**
 * Options for customizing error messages in the {@link or} parser.
 * @since 0.5.0
 */
export interface OrErrorOptions {
  /**
   * Custom error message when no parser matches.
   * Can be a static message or a function that receives context about what
   * types of inputs are expected, allowing for more precise error messages.
   *
   * @example
   * ```typescript
   * // Static message (overrides all cases)
   * { noMatch: message`Invalid input.` }
   *
   * // Dynamic message based on context (for i18n, etc.)
   * {
   *   noMatch: ({ hasOptions, hasCommands, hasArguments }) => {
   *     if (hasArguments && !hasOptions && !hasCommands) {
   *       return message`인수가 필요합니다.`; // Korean: "Argument required"
   *     }
   *     // ... other cases
   *   }
   * }
   * ```
   * @since 0.9.0 - Function form added
   */
  noMatch?: Message | ((context: NoMatchContext) => Message);

  /**
   * Custom error message for unexpected input.
   * Can be a static message or a function that receives the unexpected token.
   */
  unexpectedInput?: Message | ((token: string) => Message);

  /**
   * Custom function to format suggestion messages.
   * If provided, this will be used instead of the default "Did you mean?"
   * formatting. The function receives an array of similar valid options/commands
   * and should return a formatted message to append to the error.
   *
   * @param suggestions Array of similar valid option/command names
   * @returns Formatted message to append to the error (can be empty array for no suggestions)
   * @since 0.7.0
   */
  suggestions?: (suggestions: readonly string[]) => Message;
}

/**
 * Extracts required (non-optional) usage terms from a usage array.
 * @param usage The usage to extract required terms from
 * @returns Usage containing only required (non-optional) terms
 */
function extractRequiredUsage(usage: Usage): Usage {
  const required: UsageTerm[] = [];

  for (const term of usage) {
    if (term.type === "optional") {
      // Skip optional terms
      continue;
    } else if (term.type === "exclusive") {
      // For exclusive terms, recursively extract required usage from each branch
      const requiredBranches = term.terms
        .map((branch) => extractRequiredUsage(branch))
        .filter((branch) => branch.length > 0);
      if (requiredBranches.length > 0) {
        required.push({ type: "exclusive", terms: requiredBranches });
      }
    } else if (term.type === "multiple") {
      // For multiple terms, only include if min > 0 (required)
      if (term.min > 0) {
        const requiredTerms = extractRequiredUsage(term.terms);
        if (requiredTerms.length > 0) {
          required.push({
            type: "multiple",
            terms: requiredTerms,
            min: term.min,
          });
        }
      }
    } else {
      // Include other terms (argument, option, command) as-is
      required.push(term);
    }
  }

  return required;
}

/**
 * Analyzes parsers to determine what types of inputs are expected.
 * @param parsers The parsers being combined
 * @returns Context about what types of inputs are expected
 */
function analyzeNoMatchContext(
  parsers: Parser<Mode, unknown, unknown>[],
): NoMatchContext {
  // Collect usage information from all child parsers
  const combinedUsage = [
    { type: "exclusive" as const, terms: parsers.map((p) => p.usage) },
  ];

  // Extract only required (non-optional) terms for more accurate error messages
  const requiredUsage = extractRequiredUsage(combinedUsage);

  return {
    hasOptions: extractOptionNames(requiredUsage).size > 0,
    hasCommands: extractCommandNames(requiredUsage).size > 0,
    hasArguments: extractArgumentMetavars(requiredUsage).size > 0,
  };
}

/**
 * Error class thrown when duplicate option names are detected during parser
 * construction. This is a programmer error, not a user error.
 */
export class DuplicateOptionError extends Error {
  constructor(
    public readonly optionName: string,
    public readonly sources: readonly (string | symbol)[],
  ) {
    const sourceNames = sources.map((s) =>
      typeof s === "symbol" ? s.description ?? s.toString() : s
    );
    super(
      `Duplicate option name "${optionName}" found in fields: ` +
        `${sourceNames.join(", ")}. Each option name must be unique within a ` +
        `parser combinator.`,
    );
    this.name = "DuplicateOptionError";
  }
}

/**
 * Checks for duplicate option names across parser sources and throws an error
 * if duplicates are found. This should be called at construction time.
 * @param parserSources Array of [source, usage] tuples
 * @throws DuplicateOptionError if duplicate option names are found
 */
function checkDuplicateOptionNames(
  parserSources: ReadonlyArray<readonly [string | symbol, Usage]>,
): void {
  const optionNameSources = new Map<string, (string | symbol)[]>();

  for (const [source, usage] of parserSources) {
    const names = extractOptionNames(usage);
    for (const name of names) {
      if (!optionNameSources.has(name)) {
        optionNameSources.set(name, []);
      }
      optionNameSources.get(name)!.push(source);
    }
  }

  // Check for duplicates
  for (const [name, sources] of optionNameSources) {
    if (sources.length > 1) {
      throw new DuplicateOptionError(name, sources);
    }
  }
}

/**
 * Generates a contextual error message based on what types of inputs
 * the parsers expect (options, commands, or arguments).
 * @param context Context about what types of inputs are expected
 * @returns An appropriate error message
 */
function generateNoMatchError(context: NoMatchContext): Message {
  const { hasOptions, hasCommands, hasArguments } = context;

  // Generate specific message based on what's expected
  if (hasArguments && !hasOptions && !hasCommands) {
    return message`Missing required argument.`;
  } else if (hasCommands && !hasOptions && !hasArguments) {
    return message`No matching command found.`;
  } else if (hasOptions && !hasCommands && !hasArguments) {
    return message`No matching option found.`;
  } else if (hasCommands && hasOptions && !hasArguments) {
    return message`No matching option or command found.`;
  } else if (hasArguments && hasOptions && !hasCommands) {
    return message`No matching option or argument found.`;
  } else if (hasArguments && hasCommands && !hasOptions) {
    return message`No matching command or argument found.`;
  } else {
    // All three types present
    return message`No matching option, command, or argument found.`;
  }
}

/**
 * Shared state type for or() and longestMatch() combinators.
 * @internal
 */
type ExclusiveState = undefined | [number, ParserResult<unknown>];

/**
 * Options type for exclusive combinators (or/longestMatch).
 * @internal
 */
interface ExclusiveErrorOptions {
  noMatch?: Message | ((context: NoMatchContext) => Message);
  unexpectedInput?: Message | ((token: string) => Message);
  suggestions?: (suggestions: readonly string[]) => Message;
}

/**
 * Creates a complete() method shared by or() and longestMatch().
 * @internal
 */
function createExclusiveComplete(
  parsers: Parser<Mode, unknown, unknown>[],
  options: { errors?: ExclusiveErrorOptions } | undefined,
  noMatchContext: NoMatchContext,
  isAsync: boolean,
): (
  state: ExclusiveState,
) => ValueParserResult<unknown> | Promise<ValueParserResult<unknown>> {
  // Cast to sync parsers for sync operations
  const syncParsers = parsers as Parser<"sync", unknown, unknown>[];
  return (state) => {
    if (state == null) {
      return {
        success: false,
        error: getNoMatchError(options, noMatchContext),
      };
    }
    const [i, result] = state;
    if (!result.success) {
      return { success: false, error: result.error };
    }

    if (isAsync) {
      // For async mode, await the inner parser's complete
      return (async () => {
        const completeResult = await parsers[i].complete(result.next.state);
        return completeResult;
      })();
    }

    // For sync mode, call complete directly
    return syncParsers[i].complete(result.next.state);
  };
}

/**
 * Creates a suggest() method shared by or() and longestMatch().
 * @internal
 */
function createExclusiveSuggest(
  parsers: Parser<Mode, unknown, unknown>[],
  isAsync: boolean,
): (
  context: ParserContext<ExclusiveState>,
  prefix: string,
) => ModeIterable<Mode, Suggestion> {
  // Cast to sync parsers for sync operations
  const syncParsers = parsers as Parser<"sync", unknown, unknown>[];

  if (isAsync) {
    return (context, prefix) => {
      return (async function* () {
        const suggestions: Suggestion[] = [];

        if (context.state == null) {
          // No parser has been selected yet, get suggestions from all parsers
          for (const parser of parsers) {
            const parserSuggestions = parser.suggest({
              ...context,
              state: parser.initialState,
            }, prefix);
            if (parser.$mode === "async") {
              for await (
                const s of parserSuggestions as AsyncIterable<Suggestion>
              ) {
                suggestions.push(s);
              }
            } else {
              suggestions.push(...(parserSuggestions as Iterable<Suggestion>));
            }
          }
        } else {
          // A parser has been selected, delegate to that parser
          const [index, parserResult] = context.state;
          if (parserResult.success) {
            const parser = parsers[index];
            const parserSuggestions = parser.suggest({
              ...context,
              state: parserResult.next.state,
            }, prefix);
            if (parser.$mode === "async") {
              for await (
                const s of parserSuggestions as AsyncIterable<Suggestion>
              ) {
                suggestions.push(s);
              }
            } else {
              suggestions.push(...(parserSuggestions as Iterable<Suggestion>));
            }
          }
        }

        yield* deduplicateSuggestions(suggestions);
      })();
    };
  }

  return (context, prefix) => {
    return (function* () {
      const suggestions: Suggestion[] = [];

      if (context.state == null) {
        // No parser has been selected yet, get suggestions from all parsers
        for (const parser of syncParsers) {
          const parserSuggestions = parser.suggest({
            ...context,
            state: parser.initialState,
          }, prefix);
          suggestions.push(...parserSuggestions);
        }
      } else {
        // A parser has been selected, delegate to that parser
        const [index, parserResult] = context.state;
        if (parserResult.success) {
          const parserSuggestions = syncParsers[index].suggest({
            ...context,
            state: parserResult.next.state,
          }, prefix);
          suggestions.push(...parserSuggestions);
        }
      }

      yield* deduplicateSuggestions(suggestions);
    })();
  };
}

/**
 * Gets the no-match error, either from custom options or default.
 * Shared by or() and longestMatch().
 * @internal
 */
function getNoMatchError(
  options: { errors?: ExclusiveErrorOptions } | undefined,
  noMatchContext: NoMatchContext,
): Message {
  const customNoMatch = options?.errors?.noMatch;
  return customNoMatch
    ? (typeof customNoMatch === "function"
      ? customNoMatch(noMatchContext)
      : customNoMatch)
    : generateNoMatchError(noMatchContext);
}

/**
 * Creates default error for parse() method when buffer is not empty.
 * Shared by or() and longestMatch().
 * @internal
 */
function createUnexpectedInputError(
  token: string,
  usage: Usage,
  options: { errors?: ExclusiveErrorOptions } | undefined,
): Message {
  const defaultMsg = message`Unexpected option or subcommand: ${
    eOptionName(token)
  }.`;

  // If custom error is provided, use it
  if (options?.errors?.unexpectedInput != null) {
    return typeof options.errors.unexpectedInput === "function"
      ? options.errors.unexpectedInput(token)
      : options.errors.unexpectedInput;
  }

  // Otherwise, add suggestions to the default message
  return createErrorWithSuggestions(
    defaultMsg,
    token,
    usage,
    "both",
    options?.errors?.suggestions,
  );
}

/**
 * Creates a parser that combines two mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @returns A {@link Parser} that tries to parse using the provided parsers
 *          in order, returning the result of the first successful parser.
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  TA,
  TB,
  TStateA,
  TStateB,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
): Parser<
  CombineModes<readonly [MA, MB]>,
  TA | TB,
  undefined | [0, ParserResult<TStateA>] | [1, ParserResult<TStateB>]
>;

/**
 * Creates a parser that combines three mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  TA,
  TB,
  TC,
  TStateA,
  TStateB,
  TStateC,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
): Parser<
  CombineModes<readonly [MA, MB, MC]>,
  TA | TB | TC,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
>;

/**
 * Creates a parser that combines four mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  TA,
  TB,
  TC,
  TD,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD]>,
  TA | TB | TC | TD,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
>;

/**
 * Creates a parser that combines five mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME]>,
  TA | TB | TC | TD | TE,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
>;

/**
 * Creates a parser that combines six mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF]>,
  TA | TB | TC | TD | TE | TF,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
>;

/**
 * Creates a parser that combines seven mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF, MG]>,
  TA | TB | TC | TD | TE | TF | TG,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
>;

/**
 * Creates a parser that combines eight mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF, MG, MH]>,
  TA | TB | TC | TD | TE | TF | TG | TH,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
>;

/**
 * Creates a parser that combines nine mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template MI The mode of the ninth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  MI extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
  i: Parser<MI, TI, TStateI>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF, MG, MH, MI]>,
  TA | TB | TC | TD | TE | TF | TG | TH | TI,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
>;

/**
 * Creates a parser that combines ten mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template MI The mode of the ninth parser.
 * @template MJ The mode of the tenth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TJ The type of the value returned by the tenth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @template TStateJ The type of the state used by the tenth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @param j The tenth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  MI extends Mode,
  MJ extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TJ,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
  TStateJ,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
  i: Parser<MI, TI, TStateI>,
  j: Parser<MJ, TJ, TStateJ>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF, MG, MH, MI, MJ]>,
  TA | TB | TC | TD | TE | TF | TG | TH | TI | TJ,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
  | [9, ParserResult<TStateJ>]
>;

/**
 * Creates a parser that combines two mutually exclusive parsers into one,
 * with custom error message options.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param options Custom error message options.
 * @return A {@link Parser} that tries to parse using the provided parsers.
 * @since 0.5.0
 */
export function or<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
>(
  a: TA,
  b: TB,
  options: OrOptions,
): Parser<
  CombineModes<readonly [ExtractMode<TA>, ExtractMode<TB>]>,
  InferValue<TA> | InferValue<TB>,
  undefined | [number, ParserResult<unknown>]
>;

/**
 * Creates a parser that combines three mutually exclusive parsers into one,
 * with custom error message options.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param options Custom error message options.
 * @return A {@link Parser} that tries to parse using the provided parsers.
 * @since 0.5.0
 */
export function or<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  options: OrOptions,
): Parser<
  CombineModes<readonly [ExtractMode<TA>, ExtractMode<TB>, ExtractMode<TC>]>,
  InferValue<TA> | InferValue<TB> | InferValue<TC>,
  undefined | [number, ParserResult<unknown>]
>;

export function or(
  ...parsers: Parser<Mode, unknown, unknown>[]
): Parser<Mode, unknown, undefined | [number, ParserResult<unknown>]>;

/**
 * Creates a parser that tries each parser in sequence until one succeeds,
 * with custom error message options.
 * @param parser1 The first parser to try.
 * @param rest Additional parsers and {@link OrOptions} for error customization.
 * @returns A parser that succeeds if any of the input parsers succeed.
 * @since 0.5.0
 */
export function or(
  parser1: Parser<Mode, unknown, unknown>,
  ...rest: [...parsers: Parser<Mode, unknown, unknown>[], options: OrOptions]
): Parser<Mode, unknown, undefined | [number, ParserResult<unknown>]>;
/**
 * @since 0.5.0
 */
export function or(
  ...args: Array<Parser<Mode, unknown, unknown> | OrOptions>
): Parser<Mode, unknown, undefined | [number, ParserResult<unknown>]> {
  // Extract parsers and options from arguments
  let parsers: Parser<Mode, unknown, unknown>[];
  let options: OrOptions | undefined;

  if (
    args.length > 0 && args[args.length - 1] &&
    typeof args[args.length - 1] === "object" &&
    !("$valueType" in args[args.length - 1])
  ) {
    // Last argument is options
    options = args[args.length - 1] as OrOptions;
    parsers = args.slice(0, -1) as Parser<Mode, unknown, unknown>[];
  } else {
    // No options provided
    parsers = args as Parser<Mode, unknown, unknown>[];
    options = undefined;
  }

  // Analyze context once for error message generation
  const noMatchContext = analyzeNoMatchContext(parsers);

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = parsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  const isAsync = combinedMode === "async";

  // Cast to sync parsers for sync operations
  const syncParsers = parsers as Parser<"sync", unknown, unknown>[];

  type OrState = undefined | [number, ParserResult<unknown>];
  type ParseResult = ParserResult<OrState>;

  const getInitialError = (
    context: ParserContext<OrState>,
  ): { consumed: number; error: Message } => ({
    consumed: 0,
    error: context.buffer.length < 1
      ? getNoMatchError(options, noMatchContext)
      : createUnexpectedInputError(
        context.buffer[0],
        context.usage,
        options,
      ),
  });

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<OrState>,
  ): ParseResult => {
    let error = getInitialError(context);
    const orderedParsers = syncParsers.map((p, i) =>
      [p, i] as [Parser<"sync", unknown, unknown>, number]
    );
    orderedParsers.sort(([_, a], [__, b]) =>
      context.state?.[0] === a ? -1 : context.state?.[0] === b ? 1 : a - b
    );
    for (const [parser, i] of orderedParsers) {
      const result = parser.parse({
        ...context,
        state: context.state == null || context.state[0] !== i ||
            !context.state[1].success
          ? parser.initialState
          : context.state[1].next.state,
      });
      if (result.success && result.consumed.length > 0) {
        if (context.state?.[0] !== i && context.state?.[1].success) {
          // Different branch succeeded. Check if the new branch can also
          // consume the previously consumed input (shared options case).
          const previouslyConsumed = context.state[1].consumed;
          const checkResult = parser.parse({
            ...context,
            buffer: previouslyConsumed,
            state: parser.initialState,
          });
          // If the new branch can consume exactly the same input,
          // this is a shared option - allow branch switch.
          const canConsumeShared = checkResult.success &&
            checkResult.consumed.length === previouslyConsumed.length &&
            checkResult.consumed.every((c, idx) =>
              c === previouslyConsumed[idx]
            );
          if (!canConsumeShared) {
            return {
              success: false,
              consumed: context.buffer.length - result.next.buffer.length,
              error: message`${values(context.state[1].consumed)} and ${
                values(result.consumed)
              } cannot be used together.`,
            };
          }
          // Branch switch allowed - re-parse current input with state from
          // shared options to ensure dependency values are available.
          const replayedResult = parser.parse({
            ...context,
            state: checkResult.next.state,
          });
          if (!replayedResult.success) {
            return replayedResult;
          }
          return {
            success: true,
            next: {
              ...context,
              buffer: replayedResult.next.buffer,
              optionsTerminated: replayedResult.next.optionsTerminated,
              state: [i, {
                ...replayedResult,
                consumed: [...previouslyConsumed, ...replayedResult.consumed],
              }],
            },
            consumed: replayedResult.consumed,
          };
        }
        return {
          success: true,
          next: {
            ...context,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: [i, result],
          },
          consumed: result.consumed,
        };
      } else if (!result.success && error.consumed < result.consumed) {
        error = result;
      }
    }
    return { ...error, success: false };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<OrState>,
  ): Promise<ParseResult> => {
    let error = getInitialError(context);
    const orderedParsers = parsers.map((p, i) =>
      [p, i] as [Parser<Mode, unknown, unknown>, number]
    );
    orderedParsers.sort(([_, a], [__, b]) =>
      context.state?.[0] === a ? -1 : context.state?.[0] === b ? 1 : a - b
    );
    for (const [parser, i] of orderedParsers) {
      const resultOrPromise = parser.parse({
        ...context,
        state: context.state == null || context.state[0] !== i ||
            !context.state[1].success
          ? parser.initialState
          : context.state[1].next.state,
      });
      const result = await resultOrPromise;
      if (result.success && result.consumed.length > 0) {
        if (context.state?.[0] !== i && context.state?.[1].success) {
          // Different branch succeeded. Check if the new branch can also
          // consume the previously consumed input (shared options case).
          const previouslyConsumed = context.state[1].consumed;
          const checkResultOrPromise = parser.parse({
            ...context,
            buffer: previouslyConsumed,
            state: parser.initialState,
          });
          const checkResult = await checkResultOrPromise;
          // If the new branch can consume exactly the same input,
          // this is a shared option - allow branch switch.
          const canConsumeShared = checkResult.success &&
            checkResult.consumed.length === previouslyConsumed.length &&
            checkResult.consumed.every((c, idx) =>
              c === previouslyConsumed[idx]
            );
          if (!canConsumeShared) {
            return {
              success: false,
              consumed: context.buffer.length - result.next.buffer.length,
              error: message`${values(context.state[1].consumed)} and ${
                values(result.consumed)
              } cannot be used together.`,
            };
          }
          // Branch switch allowed - re-parse current input with state from
          // shared options to ensure dependency values are available.
          const replayedResultOrPromise = parser.parse({
            ...context,
            state: checkResult.next.state,
          });
          const replayedResult = await replayedResultOrPromise;
          if (!replayedResult.success) {
            return replayedResult;
          }
          return {
            success: true,
            next: {
              ...context,
              buffer: replayedResult.next.buffer,
              optionsTerminated: replayedResult.next.optionsTerminated,
              state: [i, {
                ...replayedResult,
                consumed: [...previouslyConsumed, ...replayedResult.consumed],
              }],
            },
            consumed: replayedResult.consumed,
          };
        }
        return {
          success: true,
          next: {
            ...context,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: [i, result],
          },
          consumed: result.consumed,
        };
      } else if (!result.success && error.consumed < result.consumed) {
        error = result;
      }
    }
    return { ...error, success: false };
  };

  return {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: [{ type: "exclusive", terms: parsers.map((p) => p.usage) }],
    initialState: undefined,
    complete: createExclusiveComplete(
      parsers,
      options,
      noMatchContext,
      isAsync,
    ),
    parse(context: ParserContext<OrState>) {
      if (isAsync) {
        return parseAsync(context);
      }
      return parseSync(context);
    },
    suggest: createExclusiveSuggest(parsers, isAsync),
    getDocFragments(
      state: DocState<undefined | [number, ParserResult<unknown>]>,
      _defaultValue?,
    ) {
      let description: Message | undefined;
      let fragments: readonly DocFragment[];

      if (state.kind === "unavailable" || state.state == null) {
        // When state is unavailable or null, show all parser options
        fragments = parsers.flatMap((p) =>
          p.getDocFragments({ kind: "unavailable" }, undefined).fragments
        );
      } else {
        // When state is available and has a value, show only the selected parser
        const [index, parserResult] = state.state;
        const innerState: DocState<unknown> = parserResult.success
          ? { kind: "available", state: parserResult.next.state }
          : { kind: "unavailable" };
        const docFragments = parsers[index].getDocFragments(
          innerState,
          undefined,
        );
        description = docFragments.description;
        fragments = docFragments.fragments;
      }
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
      return {
        description,
        fragments: [
          ...sections.map<DocFragment>((s) => ({ ...s, type: "section" })),
          { type: "section", entries },
        ],
      };
    },
  };
}

/**
 * Options for customizing error messages in the {@link longestMatch}
 * combinator.
 * @since 0.5.0
 */
export interface LongestMatchOptions {
  /**
   * Error message customization options.
   */
  errors?: LongestMatchErrorOptions;
}

/**
 * Options for customizing error messages in the {@link longesMatch} parser.
 * @since 0.5.0
 */
export interface LongestMatchErrorOptions {
  /**
   * Custom error message when no parser matches.
   * Can be a static message or a function that receives context about what
   * types of inputs are expected, allowing for more precise error messages.
   *
   * @example
   * ```typescript
   * // Static message (overrides all cases)
   * { noMatch: message`Invalid input.` }
   *
   * // Dynamic message based on context (for i18n, etc.)
   * {
   *   noMatch: ({ hasOptions, hasCommands, hasArguments }) => {
   *     if (hasArguments && !hasOptions && !hasCommands) {
   *       return message`引数が必要です。`; // Japanese: "Argument required"
   *     }
   *     // ... other cases
   *   }
   * }
   * ```
   * @since 0.9.0 - Function form added
   */
  noMatch?: Message | ((context: NoMatchContext) => Message);

  /**
   * Custom error message for unexpected input.
   * Can be a static message or a function that receives the unexpected token.
   */
  unexpectedInput?: Message | ((token: string) => Message);

  /**
   * Custom function to format suggestion messages.
   * If provided, this will be used instead of the default "Did you mean?"
   * formatting. The function receives an array of similar valid options/commands
   * and should return a formatted message to append to the error.
   *
   * @param suggestions Array of similar valid option/command names
   * @returns Formatted message to append to the error (can be empty array for no suggestions)
   * @since 0.7.0
   */
  suggestions?: (suggestions: readonly string[]) => Message;
}

/**
 * Creates a parser that combines two mutually exclusive parsers into one,
 * selecting the parser that consumes the most tokens.
 * The resulting parser will try both parsers and return the result
 * of the parser that consumed more input tokens.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @returns A {@link Parser} that tries to parse using both parsers
 *          and returns the result of the parser that consumed more tokens.
 * @since 0.3.0
 */
export function longestMatch<
  MA extends Mode,
  MB extends Mode,
  TA,
  TB,
  TStateA,
  TStateB,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
): Parser<
  CombineModes<readonly [MA, MB]>,
  TA | TB,
  undefined | [0, ParserResult<TStateA>] | [1, ParserResult<TStateB>]
>;

/**
 * Creates a parser that combines three mutually exclusive parsers into one,
 * selecting the parser that consumes the most tokens.
 * The resulting parser will try all parsers and return the result
 * of the parser that consumed the most input tokens.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @returns A {@link Parser} that tries to parse using all parsers
 *          and returns the result of the parser that consumed the most tokens.
 * @since 0.3.0
 */
export function longestMatch<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  TA,
  TB,
  TC,
  TStateA,
  TStateB,
  TStateC,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
): Parser<
  CombineModes<readonly [MA, MB, MC]>,
  TA | TB | TC,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
>;

/**
 * Creates a parser that combines four mutually exclusive parsers into one,
 * selecting the parser that consumes the most tokens.
 * The resulting parser will try all parsers and return the result
 * of the parser that consumed the most input tokens.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @returns A {@link Parser} that tries to parse using all parsers
 *          and returns the result of the parser that consumed the most tokens.
 * @since 0.3.0
 */
export function longestMatch<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  TA,
  TB,
  TC,
  TD,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD]>,
  TA | TB | TC | TD,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
>;

/**
 * Creates a parser that combines five mutually exclusive parsers into one,
 * selecting the parser that consumes the most tokens.
 * The resulting parser will try all parsers and return the result
 * of the parser that consumed the most input tokens.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @returns A {@link Parser} that tries to parse using all parsers
 *          and returns the result of the parser that consumed the most tokens.
 * @since 0.3.0
 */
export function longestMatch<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME]>,
  TA | TB | TC | TD | TE,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
>;

/**
 * Creates a parser that combines two mutually exclusive parsers into one,
 * with custom error message options.
 * @since 0.5.0
 */
export function longestMatch<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
>(
  a: TA,
  b: TB,
  options: LongestMatchOptions,
): Parser<
  CombineModes<readonly [ExtractMode<TA>, ExtractMode<TB>]>,
  InferValue<TA> | InferValue<TB>,
  undefined | [number, ParserResult<unknown>]
>;

/**
 * Creates a parser that combines three mutually exclusive parsers into one,
 * with custom error message options.
 * @since 0.5.0
 */
export function longestMatch<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  options: LongestMatchOptions,
): Parser<
  CombineModes<readonly [ExtractMode<TA>, ExtractMode<TB>, ExtractMode<TC>]>,
  InferValue<TA> | InferValue<TB> | InferValue<TC>,
  undefined | [number, ParserResult<unknown>]
>;

export function longestMatch(
  ...parsers: Parser<Mode, unknown, unknown>[]
): Parser<Mode, unknown, undefined | [number, ParserResult<unknown>]>;

/**
 * Creates a parser that tries all parsers and selects the one that consumes
 * the most input, with custom error message options.
 * @param parser1 The first parser to try.
 * @param rest Additional parsers and {@link LongestMatchOptions} for error customization.
 * @returns A parser that succeeds with the result from the parser that
 *          consumed the most input.
 * @since 0.5.0
 */
export function longestMatch(
  parser1: Parser<Mode, unknown, unknown>,
  ...rest: [
    ...parsers: Parser<Mode, unknown, unknown>[],
    options: LongestMatchOptions,
  ]
): Parser<Mode, unknown, undefined | [number, ParserResult<unknown>]>;
/**
 * @since 0.5.0
 */
export function longestMatch(
  ...args: Array<Parser<Mode, unknown, unknown> | LongestMatchOptions>
): Parser<Mode, unknown, undefined | [number, ParserResult<unknown>]> {
  // Extract parsers and options from arguments
  let parsers: Parser<Mode, unknown, unknown>[];
  let options: LongestMatchOptions | undefined;

  if (
    args.length > 0 && args[args.length - 1] &&
    typeof args[args.length - 1] === "object" &&
    !("$valueType" in args[args.length - 1])
  ) {
    // Last argument is options
    options = args[args.length - 1] as LongestMatchOptions;
    parsers = args.slice(0, -1) as Parser<Mode, unknown, unknown>[];
  } else {
    // No options provided
    parsers = args as Parser<Mode, unknown, unknown>[];
    options = undefined;
  }

  // Analyze context once for error message generation
  const noMatchContext = analyzeNoMatchContext(parsers);

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = parsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  const isAsync = combinedMode === "async";

  // Cast to sync parsers for sync operations
  const syncParsers = parsers as Parser<"sync", unknown, unknown>[];

  type LongestMatchState = undefined | [number, ParserResult<unknown>];
  type ParseResult = ParserResult<LongestMatchState>;

  const getInitialError = (
    context: ParserContext<LongestMatchState>,
  ): { consumed: number; error: Message } => ({
    consumed: 0,
    error: context.buffer.length < 1
      ? getNoMatchError(options, noMatchContext)
      : createUnexpectedInputError(
        context.buffer[0],
        context.usage,
        options,
      ),
  });

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<LongestMatchState>,
  ): ParseResult => {
    let bestMatch: {
      index: number;
      result: ParserResult<unknown>;
      consumed: number;
    } | null = null;
    let error = getInitialError(context);

    // Try all parsers and find the one with longest match
    for (let i = 0; i < syncParsers.length; i++) {
      const parser = syncParsers[i];
      const result = parser.parse({
        ...context,
        state: context.state == null || context.state[0] !== i ||
            !context.state[1].success
          ? parser.initialState
          : context.state[1].next.state,
      });

      if (result.success) {
        const consumed = context.buffer.length - result.next.buffer.length;
        if (bestMatch === null || consumed > bestMatch.consumed) {
          bestMatch = { index: i, result, consumed };
        }
      } else if (error.consumed < result.consumed) {
        error = result;
      }
    }

    if (bestMatch && bestMatch.result.success) {
      return {
        success: true,
        next: {
          ...context,
          buffer: bestMatch.result.next.buffer,
          optionsTerminated: bestMatch.result.next.optionsTerminated,
          state: [bestMatch.index, bestMatch.result],
        },
        consumed: bestMatch.result.consumed,
      };
    }

    return { ...error, success: false };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<LongestMatchState>,
  ): Promise<ParseResult> => {
    let bestMatch: {
      index: number;
      result: ParserResult<unknown>;
      consumed: number;
    } | null = null;
    let error = getInitialError(context);

    // Try all parsers and find the one with longest match
    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      const resultOrPromise = parser.parse({
        ...context,
        state: context.state == null || context.state[0] !== i ||
            !context.state[1].success
          ? parser.initialState
          : context.state[1].next.state,
      });
      const result = await resultOrPromise;

      if (result.success) {
        const consumed = context.buffer.length - result.next.buffer.length;
        if (bestMatch === null || consumed > bestMatch.consumed) {
          bestMatch = { index: i, result, consumed };
        }
      } else if (error.consumed < result.consumed) {
        error = result;
      }
    }

    if (bestMatch && bestMatch.result.success) {
      return {
        success: true,
        next: {
          ...context,
          buffer: bestMatch.result.next.buffer,
          optionsTerminated: bestMatch.result.next.optionsTerminated,
          state: [bestMatch.index, bestMatch.result],
        },
        consumed: bestMatch.result.consumed,
      };
    }

    return { ...error, success: false };
  };

  return {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: [{ type: "exclusive", terms: parsers.map((p) => p.usage) }],
    initialState: undefined,
    complete: createExclusiveComplete(
      parsers,
      options,
      noMatchContext,
      isAsync,
    ),
    parse(context: ParserContext<LongestMatchState>) {
      if (isAsync) {
        return parseAsync(context);
      }
      return parseSync(context);
    },
    suggest: createExclusiveSuggest(parsers, isAsync),
    getDocFragments(
      state: DocState<undefined | [number, ParserResult<unknown>]>,
      _defaultValue?,
    ) {
      let description: Message | undefined;
      let footer: Message | undefined;
      let fragments: readonly DocFragment[];

      if (state.kind === "unavailable" || state.state == null) {
        // When state is unavailable or null, show all parser options
        fragments = parsers.flatMap((p) =>
          p.getDocFragments({ kind: "unavailable" }).fragments
        );
      } else {
        const [i, result] = state.state;
        if (result.success) {
          const docResult = parsers[i].getDocFragments(
            { kind: "available", state: result.next.state },
          );
          description = docResult.description;
          footer = docResult.footer;
          fragments = docResult.fragments;
        } else {
          fragments = parsers.flatMap((p) =>
            p.getDocFragments({ kind: "unavailable" }).fragments
          );
        }
      }

      return { description, fragments, footer };
    },
  };
}

/**
 * Options for the {@link object} parser.
 * @since 0.5.0
 */
export interface ObjectOptions {
  /**
   * Error messages customization.
   */
  readonly errors?: ObjectErrorOptions;

  /**
   * When `true`, allows duplicate option names across different fields.
   * By default (`false`), duplicate option names will cause a parse error.
   *
   * @default `false`
   * @since 0.7.0
   */
  readonly allowDuplicates?: boolean;
}

/**
 * Options for customizing error messages in the {@link object} parser.
 * @since 0.5.0
 */
export interface ObjectErrorOptions {
  /**
   * Error message when an unexpected option or argument is encountered.
   */
  readonly unexpectedInput?: Message | ((token: string) => Message);

  /**
   * Error message when end of input is reached unexpectedly.
   * Can be a static message or a function that receives context about what
   * types of inputs are expected, allowing for more precise error messages.
   *
   * @example
   * ```typescript
   * // Static message (overrides all cases)
   * { endOfInput: message`Invalid input.` }
   *
   * // Dynamic message based on context (for i18n, etc.)
   * {
   *   endOfInput: ({ hasOptions, hasCommands, hasArguments }) => {
   *     if (hasArguments && !hasOptions && !hasCommands) {
   *       return message`Argument manquant.`; // French: "Missing argument"
   *     }
   *     // ... other cases
   *   }
   * }
   * ```
   * @since 0.9.0 - Function form added
   */
  readonly endOfInput?: Message | ((context: NoMatchContext) => Message);

  /**
   * Custom function to format suggestion messages.
   * If provided, this will be used instead of the default "Did you mean?"
   * formatting. The function receives an array of similar valid options/commands
   * and should return a formatted message to append to the error.
   *
   * @param suggestions Array of similar valid option/command names
   * @returns Formatted message to append to the error (can be empty array for no suggestions)
   * @since 0.7.0
   */
  readonly suggestions?: (suggestions: readonly string[]) => Message;
}

/**
 * Internal sync helper for object suggest functionality.
 * @internal
 */
function* suggestObjectSync<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  context: ParserContext<{ readonly [K in keyof T]: unknown }>,
  prefix: string,
  parserPairs: [string | symbol, Parser<"sync", unknown, unknown>][],
): Generator<Suggestion> {
  // Build dependency registry from all parsed fields
  const registry = context.dependencyRegistry instanceof DependencyRegistry
    ? context.dependencyRegistry
    : new DependencyRegistry();

  // Collect dependency values from the current state
  if (context.state && typeof context.state === "object") {
    collectDependencies(context.state, registry);
  }

  // Create context with dependency registry for child parsers
  const contextWithRegistry = { ...context, dependencyRegistry: registry };

  // Check if the last token in the buffer is an option that requires a value.
  // If so, only suggest values for that specific option parser, not all parsers.
  // This prevents positional argument suggestions from appearing when completing
  // an option value. See: https://github.com/dahlia/optique/issues/55
  if (context.buffer.length > 0) {
    const lastToken = context.buffer[context.buffer.length - 1];

    // Find if any parser has this token as an option requiring a value
    for (const [field, parser] of parserPairs) {
      if (isOptionRequiringValue(parser.usage, lastToken)) {
        // Only get suggestions from the parser that owns this option
        const fieldState =
          (context.state && typeof context.state === "object" &&
              field in context.state)
            ? (context.state as Record<string | symbol, unknown>)[field]
            : parser.initialState;

        yield* parser.suggest(
          { ...contextWithRegistry, state: fieldState },
          prefix,
        );
        return;
      }
    }
  }

  // Default behavior: try getting suggestions from each parser
  const suggestions: Suggestion[] = [];
  for (const [field, parser] of parserPairs) {
    const fieldState = (context.state && typeof context.state === "object" &&
        field in context.state)
      ? (context.state as Record<string | symbol, unknown>)[field]
      : parser.initialState;

    const fieldSuggestions = parser.suggest({
      ...contextWithRegistry,
      state: fieldState,
    }, prefix);

    suggestions.push(...fieldSuggestions);
  }

  yield* deduplicateSuggestions(suggestions);
}

/**
 * Internal async helper for object suggest functionality.
 * @internal
 */
async function* suggestObjectAsync<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  context: ParserContext<{ readonly [K in keyof T]: unknown }>,
  prefix: string,
  parserPairs: readonly [string | symbol, Parser<Mode, unknown, unknown>][],
): AsyncGenerator<Suggestion> {
  // Build dependency registry from all parsed fields
  const registry = context.dependencyRegistry instanceof DependencyRegistry
    ? context.dependencyRegistry
    : new DependencyRegistry();

  // Collect dependency values from the current state
  if (context.state && typeof context.state === "object") {
    collectDependencies(context.state, registry);
  }

  // Create context with dependency registry for child parsers
  const contextWithRegistry = { ...context, dependencyRegistry: registry };

  // Check if the last token in the buffer is an option that requires a value.
  if (context.buffer.length > 0) {
    const lastToken = context.buffer[context.buffer.length - 1];

    // Find if any parser has this token as an option requiring a value
    for (const [field, parser] of parserPairs) {
      if (isOptionRequiringValue(parser.usage, lastToken)) {
        // Only get suggestions from the parser that owns this option
        const fieldState =
          (context.state && typeof context.state === "object" &&
              field in context.state)
            ? (context.state as Record<string | symbol, unknown>)[field]
            : parser.initialState;

        const suggestions = parser.suggest(
          { ...contextWithRegistry, state: fieldState },
          prefix,
        ) as AsyncIterable<Suggestion>;
        for await (const s of suggestions) {
          yield s;
        }
        return;
      }
    }
  }

  // Default behavior: try getting suggestions from each parser
  const suggestions: Suggestion[] = [];
  for (const [field, parser] of parserPairs) {
    const fieldState = (context.state && typeof context.state === "object" &&
        field in context.state)
      ? (context.state as Record<string | symbol, unknown>)[field]
      : parser.initialState;

    const fieldSuggestions = parser.suggest(
      { ...contextWithRegistry, state: fieldState },
      prefix,
    );

    // Handle both sync and async suggestions
    for await (const s of fieldSuggestions as AsyncIterable<Suggestion>) {
      suggestions.push(s);
    }
  }

  yield* deduplicateSuggestions(suggestions);
}

/**
 * Resolves deferred parse states in an object's field states.
 * This function builds a dependency registry from DependencySourceState fields
 * and re-parses DeferredParseState fields using the actual dependency values.
 *
 * @param fieldStates A record of field names to their state values
 * @returns The field states with deferred states resolved to their actual values
 * @internal
 */
/**
 * Recursively collects dependency values from DependencySourceState objects
 * found anywhere in the state tree.
 */
function collectDependencies(
  state: unknown,
  registry: DependencyRegistry,
): void {
  if (state === null || state === undefined) return;

  // Check if this is a DependencySourceState
  if (isDependencySourceState(state)) {
    const depId = state[DependencyId];
    const result = state.result;
    if (result.success) {
      registry.set(depId, result.value);
    }
    return;
  }

  // Recursively search in arrays
  if (Array.isArray(state)) {
    for (const item of state) {
      collectDependencies(item, registry);
    }
    return;
  }

  // Recursively search in objects (but skip DeferredParseState internals)
  if (typeof state === "object" && !isDeferredParseState(state)) {
    for (const key of Reflect.ownKeys(state)) {
      collectDependencies(
        (state as Record<string | symbol, unknown>)[key],
        registry,
      );
    }
  }
}

/**
 * Checks if a value is a plain object (created with `{}` or `Object.create(null)`).
 * Class instances like `Temporal.PlainDate`, `URL`, `Date`, etc. return false.
 * This is used to determine whether to recursively traverse an object when
 * resolving deferred parse states - we only want to traverse plain objects
 * that are part of the parser state structure, not user values.
 */
function isPlainObject(
  value: unknown,
): value is Record<string | symbol, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively resolves DeferredParseState objects found anywhere in the state tree.
 * Returns the resolved state (sync version).
 *
 * Only traverses:
 * - DeferredParseState (to resolve it)
 * - DependencySourceState (skipped, kept as-is)
 * - Arrays (to find nested deferred states)
 * - Plain objects (to find nested deferred states in parser state structures)
 *
 * Does NOT traverse class instances (e.g., Temporal.PlainDate, URL) since these
 * are user values that should be preserved as-is.
 */
function resolveDeferred(
  state: unknown,
  registry: DependencyRegistry,
): unknown {
  if (state === null || state === undefined) return state;

  // Check if this is a DeferredParseState - resolve it
  if (isDeferredParseState(state)) {
    const deferredState = state as DeferredParseState<unknown>;
    const parser = deferredState.parser;

    // Check if this parser has multiple dependencies (from deriveFrom)
    const depIds = deferredState.dependencyIds;
    if (depIds && depIds.length > 0) {
      // Multi-dependency case: collect all dependency values in order,
      // using default values for missing dependencies
      const defaults = deferredState.defaultValues;
      const dependencyValues: unknown[] = [];

      for (let i = 0; i < depIds.length; i++) {
        const depId = depIds[i];
        if (registry.has(depId)) {
          dependencyValues.push(registry.get(depId));
        } else if (defaults && i < defaults.length) {
          // Use the default value for this missing dependency
          dependencyValues.push(defaults[i]);
        } else {
          // No default available, fall back to preliminary result
          return deferredState.preliminaryResult;
        }
      }

      const reParseResult = parser[ParseWithDependency](
        deferredState.rawInput,
        dependencyValues,
      );

      // Handle sync vs async result
      if (reParseResult instanceof Promise) {
        // For async, use preliminary result (will be handled by async version)
        return deferredState.preliminaryResult;
      }
      return reParseResult;
    }

    // Single dependency case (from derive)
    const depId = deferredState.dependencyId;
    if (registry.has(depId)) {
      const dependencyValue = registry.get(depId);
      const reParseResult = parser[ParseWithDependency](
        deferredState.rawInput,
        dependencyValue,
      );

      // Handle sync vs async result
      if (reParseResult instanceof Promise) {
        // For async, use preliminary result (will be handled by async version)
        return deferredState.preliminaryResult;
      }
      return reParseResult;
    }
    // Dependency not found, use preliminary result
    return deferredState.preliminaryResult;
  }

  // Skip DependencySourceState - it's a marker, not something to resolve
  if (isDependencySourceState(state)) {
    return state;
  }

  // Recursively resolve in arrays
  if (Array.isArray(state)) {
    return state.map((item) => resolveDeferred(item, registry));
  }

  // Only traverse plain objects (parser state structures)
  // Skip class instances (user values like Temporal.PlainDate, URL, etc.)
  if (isPlainObject(state)) {
    const resolved: Record<string | symbol, unknown> = {};
    for (const key of Reflect.ownKeys(state)) {
      resolved[key] = resolveDeferred(state[key], registry);
    }
    return resolved;
  }

  // Everything else (primitives, class instances) - return as-is
  return state;
}

function resolveDeferredParseStates<
  T extends Record<string | symbol, unknown> | unknown[],
>(
  fieldStates: T,
): T {
  // First pass: Build dependency registry from all DependencySourceState fields
  // (recursively searching through nested structures)
  const registry = new DependencyRegistry();
  collectDependencies(fieldStates, registry);

  // Second pass: Resolve all DeferredParseState fields recursively
  return resolveDeferred(fieldStates, registry) as T;
}

/**
 * Recursively resolves DeferredParseState objects found anywhere in the state tree.
 * Returns the resolved state (async version).
 *
 * Only traverses:
 * - DeferredParseState (to resolve it)
 * - DependencySourceState (skipped, kept as-is)
 * - Arrays (to find nested deferred states)
 * - Plain objects (to find nested deferred states in parser state structures)
 *
 * Does NOT traverse class instances (e.g., Temporal.PlainDate, URL) since these
 * are user values that should be preserved as-is.
 */
async function resolveDeferredAsync(
  state: unknown,
  registry: DependencyRegistry,
): Promise<unknown> {
  if (state === null || state === undefined) return state;

  // Check if this is a DeferredParseState - resolve it
  if (isDeferredParseState(state)) {
    const deferredState = state as DeferredParseState<unknown>;
    const parser = deferredState.parser;

    // Check if this parser has multiple dependencies (from deriveFrom)
    const depIds = deferredState.dependencyIds;
    if (depIds && depIds.length > 0) {
      // Multi-dependency case: collect all dependency values in order,
      // using default values for missing dependencies
      const defaults = deferredState.defaultValues;
      const dependencyValues: unknown[] = [];

      for (let i = 0; i < depIds.length; i++) {
        const depId = depIds[i];
        if (registry.has(depId)) {
          dependencyValues.push(registry.get(depId));
        } else if (defaults && i < defaults.length) {
          // Use the default value for this missing dependency
          dependencyValues.push(defaults[i]);
        } else {
          // No default available, fall back to preliminary result
          return deferredState.preliminaryResult;
        }
      }

      const reParseResult = parser[ParseWithDependency](
        deferredState.rawInput,
        dependencyValues,
      );

      // Handle both sync and async results
      return Promise.resolve(reParseResult);
    }

    // Single dependency case (from derive)
    const depId = deferredState.dependencyId;
    if (registry.has(depId)) {
      const dependencyValue = registry.get(depId);
      const reParseResult = parser[ParseWithDependency](
        deferredState.rawInput,
        dependencyValue,
      );

      // Handle both sync and async results
      return Promise.resolve(reParseResult);
    }
    // Dependency not found, use preliminary result
    return deferredState.preliminaryResult;
  }

  // Skip DependencySourceState - it's a marker, not something to resolve
  if (isDependencySourceState(state)) {
    return state;
  }

  // Recursively resolve in arrays
  if (Array.isArray(state)) {
    return Promise.all(
      state.map((item) => resolveDeferredAsync(item, registry)),
    );
  }

  // Only traverse plain objects (parser state structures)
  // Skip class instances (user values like Temporal.PlainDate, URL, etc.)
  if (isPlainObject(state)) {
    const resolved: Record<string | symbol, unknown> = {};
    const keys = Reflect.ownKeys(state);
    await Promise.all(
      keys.map(async (key) => {
        resolved[key] = await resolveDeferredAsync(state[key], registry);
      }),
    );
    return resolved;
  }

  return state;
}

/**
 * Async version of resolveDeferredParseStates for async parsers.
 * @internal
 */
async function resolveDeferredParseStatesAsync<
  T extends Record<string | symbol, unknown> | unknown[],
>(
  fieldStates: T,
): Promise<T> {
  // First pass: Build dependency registry from all DependencySourceState fields
  // (recursively searching through nested structures)
  const registry = new DependencyRegistry();
  collectDependencies(fieldStates, registry);

  // Second pass: Resolve all DeferredParseState fields recursively
  return await resolveDeferredAsync(fieldStates, registry) as T;
}

/**
 * Creates a parser that combines multiple parsers into a single object parser.
 * Each parser in the object is applied to parse different parts of the input,
 * and the results are combined into an object with the same structure.
 * @template T A record type where each value is a {@link Parser}.
 * @param parsers An object containing named parsers that will be combined
 *                into a single object parser.
 * @returns A {@link Parser} that produces an object with the same keys as
 *          the input, where each value is the result of the corresponding
 *          parser.
 */
export function object<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  parsers: T,
): Parser<
  CombineObjectModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

/**
 * Creates a parser that combines multiple parsers into a single object parser.
 * Each parser in the object is applied to parse different parts of the input,
 * and the results are combined into an object with the same structure.
 * @template T A record type where each value is a {@link Parser}.
 * @param parsers An object containing named parsers that will be combined
 *                into a single object parser.
 * @param options Optional configuration for error customization.
 *                See {@link ObjectOptions}.
 * @returns A {@link Parser} that produces an object with the same keys as
 *          the input, where each value is the result of the corresponding
 *          parser.
 * @since 0.5.0
 */
export function object<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  parsers: T,
  options: ObjectOptions,
): Parser<
  CombineObjectModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

/**
 * Creates a labeled parser that combines multiple parsers into a single
 * object parser with an associated label for documentation or error reporting.
 * @template T A record type where each value is a {@link Parser}.
 * @param label A descriptive label for this parser group, used for
 *              documentation and error messages.
 * @param parsers An object containing named parsers that will be combined
 *                into a single object parser.
 * @returns A {@link Parser} that produces an object with the same keys as
 *          the input, where each value is the result of the corresponding
 *          parser.
 */
export function object<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  label: string,
  parsers: T,
): Parser<
  CombineObjectModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

/**
 * Creates a labeled parser that combines multiple parsers into a single
 * object parser with an associated label for documentation or error reporting.
 * @template T A record type where each value is a {@link Parser}.
 * @param label A descriptive label for this parser group, used for
 *              documentation and error messages.
 * @param parsers An object containing named parsers that will be combined
 *                into a single object parser.
 * @param options Optional configuration for error customization.
 *                See {@link ObjectOptions}.
 * @returns A {@link Parser} that produces an object with the same keys as
 *          the input, where each value is the result of the corresponding
 *          parser.
 * @since 0.5.0
 */
export function object<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  label: string,
  parsers: T,
  options: ObjectOptions,
): Parser<
  CombineObjectModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

export function object<
  T extends {
    readonly [key: string | symbol]: Parser<Mode, unknown, unknown>;
  },
>(
  labelOrParsers: string | T,
  maybeParsersOrOptions?: T | ObjectOptions,
  maybeOptions?: ObjectOptions,
): Parser<
  Mode,
  { readonly [K in keyof T]: unknown },
  { readonly [K in keyof T]: unknown }
> {
  const label: string | undefined = typeof labelOrParsers === "string"
    ? labelOrParsers
    : undefined;

  let parsers: T;
  let options: ObjectOptions = {};

  if (typeof labelOrParsers === "string") {
    // object(label, parsers) or object(label, parsers, options)
    parsers = maybeParsersOrOptions as T;
    options = maybeOptions ?? {};
  } else {
    // object(parsers) or object(parsers, options)
    parsers = labelOrParsers;
    options = (maybeParsersOrOptions as ObjectOptions) ?? {};
  }
  const parserKeys = Reflect.ownKeys(parsers) as (keyof T)[];
  const parserPairs = parserKeys.map((k) =>
    [k, parsers[k]] as [keyof T, Parser<Mode, unknown, unknown>]
  );
  parserPairs.sort(([_, parserA], [__, parserB]) =>
    parserB.priority - parserA.priority
  );
  const initialState: Record<string | symbol, unknown> = {};
  for (const key of parserKeys) {
    initialState[key as string | symbol] = parsers[key].initialState;
  }

  // Check for duplicate option names at construction time unless explicitly allowed
  if (!options.allowDuplicates) {
    checkDuplicateOptionNames(
      parserPairs.map(([field, parser]) =>
        [field as string | symbol, parser.usage] as const
      ),
    );
  }

  // Analyze context once for error message generation
  const noMatchContext = analyzeNoMatchContext(
    parserKeys.map((k) => parsers[k]),
  );

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = parserKeys.some(
      (k) => parsers[k].$mode === "async",
    )
    ? "async"
    : "sync";

  const isAsync = combinedMode === "async";

  // Helper function for sync parsing of a single field
  type ParseResult = ParserResult<{ readonly [K in keyof T]: unknown }>;
  const getInitialError = (
    context: ParserContext<{ readonly [K in keyof T]: unknown }>,
  ): { consumed: number; error: Message } => ({
    consumed: 0,
    error: context.buffer.length > 0
      ? (() => {
        const token = context.buffer[0];
        const customMessage = options.errors?.unexpectedInput;

        // If custom error message is provided, use it
        if (customMessage) {
          return typeof customMessage === "function"
            ? customMessage(token)
            : customMessage;
        }

        // Generate default error with suggestions
        const baseError = message`Unexpected option or argument: ${token}.`;
        return createErrorWithSuggestions(
          baseError,
          token,
          context.usage,
          "both",
          options.errors?.suggestions,
        );
      })()
      : (() => {
        const customEndOfInput = options.errors?.endOfInput;
        return customEndOfInput
          ? (typeof customEndOfInput === "function"
            ? customEndOfInput(noMatchContext)
            : customEndOfInput)
          : generateNoMatchError(noMatchContext);
      })(),
  });

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<{ readonly [K in keyof T]: unknown }>,
  ): ParseResult => {
    let error = getInitialError(context);

    // Try greedy parsing: attempt to consume as many fields as possible
    let currentContext = context;
    let anySuccess = false;
    const allConsumed: string[] = [];

    // Keep trying to parse fields until no more can be matched
    let madeProgress = true;
    while (madeProgress && currentContext.buffer.length > 0) {
      madeProgress = false;

      for (const [field, parser] of parserPairs) {
        const result = (parser as Parser<"sync", unknown, unknown>).parse({
          ...currentContext,
          state: (currentContext.state &&
              typeof currentContext.state === "object" &&
              field in currentContext.state)
            ? (currentContext.state as Record<string | symbol, unknown>)[
              field as string | symbol
            ]
            : parser.initialState,
        });

        if (result.success && result.consumed.length > 0) {
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: {
              ...(currentContext.state as Record<string | symbol, unknown>),
              [field as string | symbol]: result.next.state,
            } as { readonly [K in keyof T]: unknown },
          };
          allConsumed.push(...result.consumed);
          anySuccess = true;
          madeProgress = true;
          break; // Restart the field loop with updated context
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }
    }

    // If we consumed any input, return success
    if (anySuccess) {
      return {
        success: true,
        next: currentContext,
        consumed: allConsumed,
      };
    }

    // If buffer is empty and no parser consumed input, check if all parsers can complete
    if (context.buffer.length === 0) {
      let allCanComplete = true;
      for (const [field, parser] of parserPairs) {
        const fieldState =
          (context.state && typeof context.state === "object" &&
              field in context.state)
            ? (context.state as Record<string | symbol, unknown>)[
              field as string | symbol
            ]
            : parser.initialState;
        const completeResult = (parser as Parser<"sync", unknown, unknown>)
          .complete(fieldState);
        if (!completeResult.success) {
          allCanComplete = false;
          break;
        }
      }

      if (allCanComplete) {
        return {
          success: true,
          next: context,
          consumed: [],
        };
      }
    }

    return { ...error, success: false };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<{ readonly [K in keyof T]: unknown }>,
  ): Promise<ParseResult> => {
    let error = getInitialError(context);

    // Try greedy parsing: attempt to consume as many fields as possible
    let currentContext = context;
    let anySuccess = false;
    const allConsumed: string[] = [];

    // Keep trying to parse fields until no more can be matched
    let madeProgress = true;
    while (madeProgress && currentContext.buffer.length > 0) {
      madeProgress = false;

      for (const [field, parser] of parserPairs) {
        const resultOrPromise = parser.parse({
          ...currentContext,
          state: (currentContext.state &&
              typeof currentContext.state === "object" &&
              field in currentContext.state)
            ? (currentContext.state as Record<string | symbol, unknown>)[
              field as string | symbol
            ]
            : parser.initialState,
        });
        const result = await resultOrPromise;

        if (result.success && result.consumed.length > 0) {
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: {
              ...(currentContext.state as Record<string | symbol, unknown>),
              [field as string | symbol]: result.next.state,
            } as { readonly [K in keyof T]: unknown },
          };
          allConsumed.push(...result.consumed);
          anySuccess = true;
          madeProgress = true;
          break; // Restart the field loop with updated context
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }
    }

    // If we consumed any input, return success
    if (anySuccess) {
      return {
        success: true,
        next: currentContext,
        consumed: allConsumed,
      };
    }

    // If buffer is empty and no parser consumed input, check if all parsers can complete
    if (context.buffer.length === 0) {
      let allCanComplete = true;
      for (const [field, parser] of parserPairs) {
        const fieldState =
          (context.state && typeof context.state === "object" &&
              field in context.state)
            ? (context.state as Record<string | symbol, unknown>)[
              field as string | symbol
            ]
            : parser.initialState;
        const completeResult = await parser.complete(fieldState);
        if (!completeResult.success) {
          allCanComplete = false;
          break;
        }
      }

      if (allCanComplete) {
        return {
          success: true,
          next: context,
          consumed: [],
        };
      }
    }

    return { ...error, success: false };
  };

  return {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parserKeys.map((k) => parsers[k].priority)),
    usage: parserPairs.flatMap(([_, p]) => p.usage),
    initialState: initialState as {
      readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U3)
        ? U3
        : never;
    },
    parse(
      context: ParserContext<{ readonly [K in keyof T]: unknown }>,
    ) {
      if (isAsync) {
        return parseAsync(context);
      }
      return parseSync(context);
    },
    complete(state: { readonly [K in keyof T]: unknown }) {
      // For sync mode, complete synchronously
      if (!isAsync) {
        // Phase 1: Pre-complete fields with PendingDependencySourceState to get
        // DependencySourceState with default values. This is needed for
        // withDefault(option(..., dependencySource), defaultValue) pattern.
        const preCompletedState: Record<string | symbol, unknown> = {};
        for (const field of parserKeys) {
          const fieldKey = field as string | symbol;
          const fieldState =
            (state as Record<string | symbol, unknown>)[fieldKey];
          const fieldParser = parsers[field] as Parser<
            "sync",
            unknown,
            unknown
          >;

          // Check if this is a withDefault state containing PendingDependencySourceState
          // Case 1: state is [PendingDependencySourceState] (option was not provided)
          if (
            Array.isArray(fieldState) &&
            fieldState.length === 1 &&
            isPendingDependencySourceState(fieldState[0])
          ) {
            // Call complete to get DependencySourceState with default value
            const completed = fieldParser.complete(fieldState);
            // The result might be a DependencySourceState (from withDefault)
            preCompletedState[fieldKey] = completed;
          } // Case 2: state is undefined but parser's initialState is PendingDependencySourceState
          // This happens with withDefault(option(..., dependencySource), ...) when no input was parsed
          else if (
            fieldState === undefined &&
            isPendingDependencySourceState(fieldParser.initialState)
          ) {
            // Call complete with [initialState] to get DependencySourceState
            const completed = fieldParser.complete([fieldParser.initialState]);
            preCompletedState[fieldKey] = completed;
          } // Case 3: state is undefined and parser has WrappedDependencySourceMarker
          // This happens with withDefault(option(..., dependencySource), defaultValue) when
          // no input was parsed. The withDefault parser wraps the inner dependency source
          // and stores the PendingDependencySourceState in WrappedDependencySourceMarker.
          // Also handles optional(withDefault(...)) and withDefault(optional(...), default).
          else if (
            fieldState === undefined &&
            isWrappedDependencySource(fieldParser)
          ) {
            // Call complete with [PendingDependencySourceState] to trigger withDefault's
            // special handling that returns DependencySourceState with the default value
            const pendingState = fieldParser[WrappedDependencySourceMarker];
            const completed = fieldParser.complete([pendingState]);
            // Only use the pre-completed result if it's a DependencySourceState.
            // If the wrapper returns a regular result (e.g., optional returning undefined),
            // keep the original state so Phase 3 handles it normally.
            if (isDependencySourceState(completed)) {
              preCompletedState[fieldKey] = completed;
            } else {
              preCompletedState[fieldKey] = fieldState;
            }
          } else {
            preCompletedState[fieldKey] = fieldState;
          }
        }

        // Phase 2: Resolve any deferred parse states with actual dependency values
        // (using pre-completed state which now contains DependencySourceState for
        // withDefault'd dependency sources)
        const resolvedState = resolveDeferredParseStates(preCompletedState);

        // Phase 3: Complete remaining fields
        const result: { [K in keyof T]: T[K]["$valueType"][number] } =
          // deno-lint-ignore no-explicit-any
          {} as any;
        for (const field of parserKeys) {
          const fieldKey = field as string | symbol;
          const fieldResolvedState =
            (resolvedState as Record<string | symbol, unknown>)[fieldKey];
          const fieldParser = parsers[field] as Parser<
            "sync",
            unknown,
            unknown
          >;

          // If this field was pre-completed from withDefault and is a DependencySourceState,
          // we need to handle it specially: the state for the inner parser should be
          // the DependencySourceState wrapped in an array (withDefault's state structure).
          // However, if the original state already had this structure (i.e., field was
          // parsed normally), we should use the resolved state as-is.
          const originalFieldState =
            (state as Record<string | symbol, unknown>)[fieldKey];
          const wasPreCompletedCase1 = Array.isArray(originalFieldState) &&
            originalFieldState.length === 1 &&
            isPendingDependencySourceState(originalFieldState[0]);
          const wasPreCompletedCase2 = originalFieldState === undefined &&
            isPendingDependencySourceState(fieldParser.initialState);
          const wasPreCompletedCase3 = originalFieldState === undefined &&
            isWrappedDependencySource(fieldParser);

          if (
            isDependencySourceState(fieldResolvedState) &&
            (wasPreCompletedCase1 || wasPreCompletedCase2 ||
              wasPreCompletedCase3)
          ) {
            // This is a pre-completed withDefault field. Extract the value directly
            // since complete() was already called and returned DependencySourceState.
            const depResult = fieldResolvedState.result;
            if (depResult.success) {
              (result as Record<string | symbol, unknown>)[fieldKey] =
                depResult.value;
            } else {
              return { success: false, error: depResult.error };
            }
            continue;
          }

          const valueResult = fieldParser.complete(fieldResolvedState);
          if (valueResult.success) {
            (result as Record<string | symbol, unknown>)[fieldKey] =
              valueResult.value;
          } else return { success: false, error: valueResult.error };
        }
        return { success: true, value: result };
      }

      // For async mode, complete asynchronously
      return (async () => {
        // Phase 1: Pre-complete fields with PendingDependencySourceState
        const preCompletedState: Record<string | symbol, unknown> = {};
        for (const field of parserKeys) {
          const fieldKey = field as string | symbol;
          const fieldState =
            (state as Record<string | symbol, unknown>)[fieldKey];
          const fieldParser = parsers[field];

          // Check if this is a withDefault state containing PendingDependencySourceState
          // Case 1: state is [PendingDependencySourceState] (option was not provided)
          if (
            Array.isArray(fieldState) &&
            fieldState.length === 1 &&
            isPendingDependencySourceState(fieldState[0])
          ) {
            // Call complete to get DependencySourceState with default value
            const completed = await fieldParser.complete(fieldState);
            // The result might be a DependencySourceState (from withDefault)
            preCompletedState[fieldKey] = completed;
          } // Case 2: state is undefined but parser's initialState is PendingDependencySourceState
          // This happens with withDefault(option(..., dependencySource), ...) when no input was parsed
          else if (
            fieldState === undefined &&
            isPendingDependencySourceState(fieldParser.initialState)
          ) {
            // Call complete with [initialState] to get DependencySourceState
            const completed = await fieldParser.complete([
              fieldParser.initialState,
            ]);
            preCompletedState[fieldKey] = completed;
          } // Case 3: state is undefined and parser has WrappedDependencySourceMarker
          // This happens with withDefault(option(..., dependencySource), defaultValue) when
          // no input was parsed. The withDefault parser wraps the inner dependency source
          // and stores the PendingDependencySourceState in WrappedDependencySourceMarker.
          // Also handles optional(withDefault(...)) and withDefault(optional(...), default).
          else if (
            fieldState === undefined &&
            isWrappedDependencySource(fieldParser)
          ) {
            // Call complete with [PendingDependencySourceState] to trigger withDefault's
            // special handling that returns DependencySourceState with the default value
            const pendingState = fieldParser[WrappedDependencySourceMarker];
            const completed = await fieldParser.complete([pendingState]);
            // Only use the pre-completed result if it's a DependencySourceState.
            // If the wrapper returns a regular result (e.g., optional returning undefined),
            // keep the original state so Phase 3 handles it normally.
            if (isDependencySourceState(completed)) {
              preCompletedState[fieldKey] = completed;
            } else {
              preCompletedState[fieldKey] = fieldState;
            }
          } else {
            preCompletedState[fieldKey] = fieldState;
          }
        }

        // Phase 2: Resolve any deferred parse states with actual dependency values
        const resolvedState = await resolveDeferredParseStatesAsync(
          preCompletedState,
        );

        // Phase 3: Complete remaining fields
        const result: { [K in keyof T]: T[K]["$valueType"][number] } =
          // deno-lint-ignore no-explicit-any
          {} as any;
        for (const field of parserKeys) {
          const fieldKey = field as string | symbol;
          const fieldResolvedState =
            (resolvedState as Record<string | symbol, unknown>)[fieldKey];
          const fieldParser = parsers[field];

          // Similar to sync version: handle pre-completed withDefault fields
          const originalFieldState =
            (state as Record<string | symbol, unknown>)[fieldKey];
          const wasPreCompletedCase1 = Array.isArray(originalFieldState) &&
            originalFieldState.length === 1 &&
            isPendingDependencySourceState(originalFieldState[0]);
          const wasPreCompletedCase2 = originalFieldState === undefined &&
            isPendingDependencySourceState(fieldParser.initialState);
          const wasPreCompletedCase3 = originalFieldState === undefined &&
            isWrappedDependencySource(fieldParser);

          if (
            isDependencySourceState(fieldResolvedState) &&
            (wasPreCompletedCase1 || wasPreCompletedCase2 ||
              wasPreCompletedCase3)
          ) {
            const depResult = fieldResolvedState.result;
            if (depResult.success) {
              (result as Record<string | symbol, unknown>)[fieldKey] =
                depResult.value;
            } else {
              return { success: false, error: depResult.error };
            }
            continue;
          }

          const valueResult = await fieldParser.complete(fieldResolvedState);
          if (valueResult.success) {
            (result as Record<string | symbol, unknown>)[fieldKey] =
              valueResult.value;
          } else return { success: false, error: valueResult.error };
        }
        return { success: true, value: result };
      })();
    },
    suggest(
      context: ParserContext<{ readonly [K in keyof T]: unknown }>,
      prefix: string,
    ) {
      // For async parsers, use async generator; for sync parsers, use sync
      if (isAsync) {
        return suggestObjectAsync(
          context,
          prefix,
          parserPairs as [string | symbol, Parser<Mode, unknown, unknown>][],
        );
      }
      const syncParserPairs = parserPairs as [
        string | symbol,
        Parser<"sync", unknown, unknown>,
      ][];
      return suggestObjectSync(context, prefix, syncParserPairs);
    },
    getDocFragments(
      state: DocState<{ readonly [K in keyof T]: unknown }>,
      defaultValue?: { readonly [K in keyof T]: unknown },
    ) {
      const fragments = parserPairs.flatMap(([field, p]) => {
        const fieldState: DocState<unknown> = state.kind === "unavailable"
          ? { kind: "unavailable" }
          : { kind: "available", state: state.state[field] };
        return p.getDocFragments(fieldState, defaultValue?.[field]).fragments;
      });
      const entries: DocEntry[] = fragments.filter((d) => d.type === "entry");
      const sections: DocSection[] = [];
      for (const fragment of fragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }
      const section: DocSection = { title: label, entries };
      sections.push(section);
      return { fragments: sections.map((s) => ({ ...s, type: "section" })) };
    },
    // Type assertion needed because TypeScript cannot verify the combined mode
    // of multiple parsers at compile time. Runtime behavior is correct via isAsync.
  } as unknown as Parser<
    Mode,
    { readonly [K in keyof T]: unknown },
    { readonly [K in keyof T]: unknown }
  >;
}

/**
 * Options for the {@link tuple} parser.
 * @since 0.7.0
 */
export interface TupleOptions {
  /**
   * When `true`, allows duplicate option names across different parsers.
   * By default (`false`), duplicate option names will cause a parse error.
   *
   * @default `false`
   * @since 0.7.0
   */
  readonly allowDuplicates?: boolean;
}

function suggestTupleSync(
  context: ParserContext<readonly unknown[]>,
  prefix: string,
  parsers: readonly Parser<"sync", unknown, unknown>[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const stateArray = context.state as unknown[] | undefined;

  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    const parserState = stateArray && Array.isArray(stateArray)
      ? stateArray[i]
      : parser.initialState;

    const parserSuggestions = parser.suggest({
      ...context,
      state: parserState,
    }, prefix);

    suggestions.push(...parserSuggestions);
  }

  return deduplicateSuggestions(suggestions);
}

async function* suggestTupleAsync(
  context: ParserContext<readonly unknown[]>,
  prefix: string,
  parsers: readonly Parser<Mode, unknown, unknown>[],
): AsyncGenerator<Suggestion> {
  const suggestions: Suggestion[] = [];
  const stateArray = context.state as unknown[] | undefined;

  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    const parserState = stateArray && Array.isArray(stateArray)
      ? stateArray[i]
      : parser.initialState;

    const parserSuggestions = parser.suggest({
      ...context,
      state: parserState,
    }, prefix);

    if (parser.$mode === "async") {
      for await (const s of parserSuggestions as AsyncIterable<Suggestion>) {
        suggestions.push(s);
      }
    } else {
      suggestions.push(...(parserSuggestions as Iterable<Suggestion>));
    }
  }

  yield* deduplicateSuggestions(suggestions);
}

/**
 * Creates a parser that combines multiple parsers into a sequential tuple parser.
 * The parsers are applied in the order they appear in the array, and all must
 * succeed for the tuple parser to succeed.
 * @template T A readonly array type where each element is a {@link Parser}.
 * @param parsers An array of parsers that will be applied sequentially
 *                to create a tuple of their results.
 * @param options Optional configuration for the tuple parser.
 * @returns A {@link Parser} that produces a readonly tuple with the same length
 *          as the input array, where each element is the result of the
 *          corresponding parser.
 */
export function tuple<
  const T extends readonly Parser<Mode, unknown, unknown>[],
>(
  parsers: T,
  options?: TupleOptions,
): Parser<
  CombineTupleModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

/**
 * Creates a labeled parser that combines multiple parsers into a sequential
 * tuple parser with an associated label for documentation or error reporting.
 * @template T A readonly array type where each element is a {@link Parser}.
 * @param label A descriptive label for this parser group, used for
 *              documentation and error messages.
 * @param parsers An array of parsers that will be applied sequentially
 *                to create a tuple of their results.
 * @param options Optional configuration for the tuple parser.
 * @returns A {@link Parser} that produces a readonly tuple with the same length
 *          as the input array, where each element is the result of the
 *          corresponding parser.
 */
export function tuple<
  const T extends readonly Parser<Mode, unknown, unknown>[],
>(
  label: string,
  parsers: T,
  options?: TupleOptions,
): Parser<
  CombineTupleModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

export function tuple<
  const T extends readonly Parser<Mode, unknown, unknown>[],
>(
  labelOrParsers: string | T,
  maybeParsersOrOptions?: T | TupleOptions,
  maybeOptions?: TupleOptions,
): Parser<
  Mode,
  { readonly [K in keyof T]: unknown },
  { readonly [K in keyof T]: unknown }
> {
  const label: string | undefined = typeof labelOrParsers === "string"
    ? labelOrParsers
    : undefined;

  let parsers: T;
  let options: TupleOptions = {};

  if (typeof labelOrParsers === "string") {
    // tuple(label, parsers) or tuple(label, parsers, options)
    parsers = maybeParsersOrOptions as T;
    options = maybeOptions ?? {};
  } else {
    // tuple(parsers) or tuple(parsers, options)
    parsers = labelOrParsers;
    options = (maybeParsersOrOptions as TupleOptions) ?? {};
  }

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = parsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  const isAsync = combinedMode === "async";

  // Cast to sync parsers for suggest (suggest is always synchronous)
  const syncParsers = parsers as readonly Parser<"sync", unknown, unknown>[];

  // Check for duplicate option names at construction time unless explicitly allowed
  if (!options.allowDuplicates) {
    checkDuplicateOptionNames(
      parsers.map((parser, index) => [String(index), parser.usage] as const),
    );
  }

  type TupleState = { readonly [K in keyof T]: unknown };
  type ParseResult = ParserResult<TupleState>;

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<TupleState>,
  ): ParseResult => {
    let currentContext = context;
    const allConsumed: string[] = [];
    const matchedParsers = new Set<number>();

    // Similar to object(), try parsers in priority order but maintain tuple semantics
    while (matchedParsers.size < syncParsers.length) {
      let foundMatch = false;
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: message`No remaining parsers could match the input.`,
      };

      // Get current state array from context (may have been updated in previous iterations)
      const stateArray = currentContext.state as unknown[];

      // Create priority-ordered list of remaining parsers
      const remainingParsers = syncParsers
        .map((parser, index) => [parser, index] as [typeof parser, number])
        .filter(([_, index]) => !matchedParsers.has(index))
        .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

      for (const [parser, index] of remainingParsers) {
        const result = parser.parse({
          ...currentContext,
          state: stateArray[index],
        });

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = stateArray.map((s: unknown, idx: number) =>
            idx === index ? result.next.state : s
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as TupleState,
          };

          allConsumed.push(...result.consumed);
          matchedParsers.add(index);
          foundMatch = true;
          break; // Take the first (highest priority) match that consumes input
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }

      // If no consuming parser matched, try non-consuming ones (like optional)
      // or mark failing optional parsers as matched
      if (!foundMatch) {
        for (const [parser, index] of remainingParsers) {
          const result = parser.parse({
            ...currentContext,
            state: stateArray[index],
          });

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = stateArray.map((s: unknown, idx: number) =>
              idx === index ? result.next.state : s
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as TupleState,
            };

            matchedParsers.add(index);
            foundMatch = true;
            break;
          } else if (!result.success && result.consumed < 1) {
            // Parser failed without consuming input - this could be
            // an optional parser that doesn't match.
            // Check if we can safely skip it.
            // For now, mark it as matched to continue processing
            matchedParsers.add(index);
            foundMatch = true;
            break;
          }
        }
      }

      if (!foundMatch) {
        return { ...error, success: false };
      }
    }

    return {
      success: true,
      next: currentContext,
      consumed: allConsumed,
    };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<TupleState>,
  ): Promise<ParseResult> => {
    let currentContext = context;
    const allConsumed: string[] = [];
    const matchedParsers = new Set<number>();

    // Similar to object(), try parsers in priority order but maintain tuple semantics
    while (matchedParsers.size < parsers.length) {
      let foundMatch = false;
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: message`No remaining parsers could match the input.`,
      };

      // Get current state array from context (may have been updated in previous iterations)
      const stateArray = currentContext.state as unknown[];

      // Create priority-ordered list of remaining parsers
      const remainingParsers = parsers
        .map((parser, index) => [parser, index] as [typeof parser, number])
        .filter(([_, index]) => !matchedParsers.has(index))
        .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

      for (const [parser, index] of remainingParsers) {
        const resultOrPromise = parser.parse({
          ...currentContext,
          state: stateArray[index],
        });
        const result = await resultOrPromise;

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = stateArray.map((s: unknown, idx: number) =>
            idx === index ? result.next.state : s
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as TupleState,
          };

          allConsumed.push(...result.consumed);
          matchedParsers.add(index);
          foundMatch = true;
          break; // Take the first (highest priority) match that consumes input
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }

      // If no consuming parser matched, try non-consuming ones (like optional)
      // or mark failing optional parsers as matched
      if (!foundMatch) {
        for (const [parser, index] of remainingParsers) {
          const resultOrPromise = parser.parse({
            ...currentContext,
            state: stateArray[index],
          });
          const result = await resultOrPromise;

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = stateArray.map((s: unknown, idx: number) =>
              idx === index ? result.next.state : s
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as TupleState,
            };

            matchedParsers.add(index);
            foundMatch = true;
            break;
          } else if (!result.success && result.consumed < 1) {
            // Parser failed without consuming input - this could be
            // an optional parser that doesn't match.
            // Check if we can safely skip it.
            // For now, mark it as matched to continue processing
            matchedParsers.add(index);
            foundMatch = true;
            break;
          }
        }
      }

      if (!foundMatch) {
        return { ...error, success: false };
      }
    }

    return {
      success: true,
      next: currentContext,
      consumed: allConsumed,
    };
  };

  return {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    usage: parsers
      .toSorted((a, b) => b.priority - a.priority)
      .flatMap((p) => p.usage),
    priority: parsers.length > 0
      ? Math.max(...parsers.map((p) => p.priority))
      : 0,
    initialState: parsers.map((parser) => parser.initialState) as {
      readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U3)
        ? U3
        : never;
    },
    parse(context: ParserContext<TupleState>) {
      if (isAsync) {
        return parseAsync(context);
      }
      return parseSync(context);
    },
    complete(state: TupleState) {
      // For sync mode, complete synchronously
      if (!isAsync) {
        const stateArray = state as unknown[];

        // Phase 1: Pre-complete elements with PendingDependencySourceState
        const preCompletedState: unknown[] = [];
        for (let i = 0; i < syncParsers.length; i++) {
          const elementState = stateArray[i];
          const elementParser = syncParsers[i];

          // Case 1: state is [PendingDependencySourceState] (option was not provided)
          if (
            Array.isArray(elementState) &&
            elementState.length === 1 &&
            isPendingDependencySourceState(elementState[0])
          ) {
            // Call complete to get DependencySourceState with default value
            const completed = elementParser.complete(elementState);
            preCompletedState[i] = completed;
          } // Case 2: state is undefined but parser's initialState is PendingDependencySourceState
          else if (
            elementState === undefined &&
            isPendingDependencySourceState(elementParser.initialState)
          ) {
            // Call complete with [initialState] to get DependencySourceState
            const completed = elementParser.complete([
              elementParser.initialState,
            ]);
            preCompletedState[i] = completed;
          } // Case 3: state is undefined and parser has WrappedDependencySourceMarker
          else if (
            elementState === undefined &&
            isWrappedDependencySource(elementParser)
          ) {
            const pendingState = elementParser[WrappedDependencySourceMarker];
            const completed = elementParser.complete([pendingState]);
            preCompletedState[i] = completed;
          } else {
            preCompletedState[i] = elementState;
          }
        }

        // Phase 2: Resolve any deferred parse states with actual dependency values
        const resolvedState = resolveDeferredParseStates(preCompletedState);
        const resolvedArray = resolvedState as unknown[];

        // Phase 3: Complete remaining elements
        const result: { [K in keyof T]: T[K]["$valueType"][number] } =
          // deno-lint-ignore no-explicit-any
          [] as any;

        for (let i = 0; i < syncParsers.length; i++) {
          const elementResolvedState = resolvedArray[i];
          const elementParser = syncParsers[i];
          const originalElementState = stateArray[i];

          // Check if this element was pre-completed
          const wasPreCompletedCase1 = Array.isArray(originalElementState) &&
            originalElementState.length === 1 &&
            isPendingDependencySourceState(originalElementState[0]);
          const wasPreCompletedCase2 = originalElementState === undefined &&
            isPendingDependencySourceState(elementParser.initialState);
          const wasPreCompletedCase3 = originalElementState === undefined &&
            isWrappedDependencySource(elementParser);

          if (
            isDependencySourceState(elementResolvedState) &&
            (wasPreCompletedCase1 || wasPreCompletedCase2 ||
              wasPreCompletedCase3)
          ) {
            // This is a pre-completed withDefault element. Extract the value directly.
            const depResult = elementResolvedState.result;
            if (depResult.success) {
              // deno-lint-ignore no-explicit-any
              (result as any)[i] = depResult.value;
            } else {
              return { success: false, error: depResult.error };
            }
            continue;
          }

          const valueResult = elementParser.complete(elementResolvedState);
          if (valueResult.success) {
            // deno-lint-ignore no-explicit-any
            (result as any)[i] = valueResult.value;
          } else {
            return { success: false, error: valueResult.error };
          }
        }

        return { success: true, value: result };
      }

      // For async mode, complete asynchronously
      return (async () => {
        const stateArray = state as unknown[];

        // Phase 1: Pre-complete elements with PendingDependencySourceState
        const preCompletedState: unknown[] = [];
        for (let i = 0; i < parsers.length; i++) {
          const elementState = stateArray[i];
          const elementParser = parsers[i];

          // Case 1: state is [PendingDependencySourceState] (option was not provided)
          if (
            Array.isArray(elementState) &&
            elementState.length === 1 &&
            isPendingDependencySourceState(elementState[0])
          ) {
            const completed = await elementParser.complete(elementState);
            preCompletedState[i] = completed;
          } // Case 2: state is undefined but parser's initialState is PendingDependencySourceState
          else if (
            elementState === undefined &&
            isPendingDependencySourceState(elementParser.initialState)
          ) {
            const completed = await elementParser.complete([
              elementParser.initialState,
            ]);
            preCompletedState[i] = completed;
          } // Case 3: state is undefined and parser has WrappedDependencySourceMarker
          else if (
            elementState === undefined &&
            isWrappedDependencySource(elementParser)
          ) {
            const pendingState = elementParser[WrappedDependencySourceMarker];
            const completed = await elementParser.complete([pendingState]);
            preCompletedState[i] = completed;
          } else {
            preCompletedState[i] = elementState;
          }
        }

        // Phase 2: Resolve any deferred parse states with actual dependency values
        const resolvedState = await resolveDeferredParseStatesAsync(
          preCompletedState,
        );
        const resolvedArray = resolvedState as unknown[];

        // Phase 3: Complete remaining elements
        const result: { [K in keyof T]: T[K]["$valueType"][number] } =
          // deno-lint-ignore no-explicit-any
          [] as any;

        for (let i = 0; i < parsers.length; i++) {
          const elementResolvedState = resolvedArray[i];
          const elementParser = parsers[i];
          const originalElementState = stateArray[i];

          // Check if this element was pre-completed
          const wasPreCompletedCase1 = Array.isArray(originalElementState) &&
            originalElementState.length === 1 &&
            isPendingDependencySourceState(originalElementState[0]);
          const wasPreCompletedCase2 = originalElementState === undefined &&
            isPendingDependencySourceState(elementParser.initialState);
          const wasPreCompletedCase3 = originalElementState === undefined &&
            isWrappedDependencySource(elementParser);

          if (
            isDependencySourceState(elementResolvedState) &&
            (wasPreCompletedCase1 || wasPreCompletedCase2 ||
              wasPreCompletedCase3)
          ) {
            // This is a pre-completed withDefault element. Extract the value directly.
            const depResult = elementResolvedState.result;
            if (depResult.success) {
              // deno-lint-ignore no-explicit-any
              (result as any)[i] = depResult.value;
            } else {
              return { success: false, error: depResult.error };
            }
            continue;
          }

          const valueResult = await elementParser.complete(
            elementResolvedState,
          );
          if (valueResult.success) {
            // deno-lint-ignore no-explicit-any
            (result as any)[i] = valueResult.value;
          } else {
            return { success: false, error: valueResult.error };
          }
        }

        return { success: true, value: result };
      })();
    },
    suggest(
      context: ParserContext<TupleState>,
      prefix: string,
    ) {
      if (isAsync) {
        return suggestTupleAsync(context, prefix, parsers);
      }
      return suggestTupleSync(context, prefix, syncParsers);
    },
    getDocFragments(
      state: DocState<TupleState>,
      defaultValue?: TupleState,
    ) {
      const fragments = syncParsers.flatMap((p, i) => {
        const indexState: DocState<unknown> = state.kind === "unavailable"
          ? { kind: "unavailable" }
          : {
            kind: "available",
            state: (state.state as readonly unknown[])[i],
          };
        return p.getDocFragments(indexState, defaultValue?.[i]).fragments;
      });
      const entries: DocEntry[] = fragments.filter((d) => d.type === "entry");
      const sections: DocSection[] = [];
      for (const fragment of fragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }
      const section: DocSection = { title: label, entries };
      sections.push(section);
      return { fragments: sections.map((s) => ({ ...s, type: "section" })) };
    },
    [Symbol.for("Deno.customInspect")]() {
      const parsersStr = parsers.length === 1
        ? `[1 parser]`
        : `[${parsers.length} parsers]`;
      return label
        ? `tuple(${JSON.stringify(label)}, ${parsersStr})`
        : `tuple(${parsersStr})`;
    },
    // Type assertion needed because TypeScript cannot verify the combined mode
    // of multiple parsers at compile time. Runtime behavior is correct via isAsync.
  } as unknown as Parser<
    Mode,
    { readonly [K in keyof T]: unknown },
    { readonly [K in keyof T]: unknown }
  >;
}

/**
 * Helper type to check if all members of a union are object-like.
 * This allows merge() to work with parsers like withDefault() that produce union types.
 */
type AllObjectLike<T> = T extends readonly unknown[] ? never
  : T extends Record<string | symbol, unknown> ? T
  : never;

/**
 * Helper type to extract object-like types from parser value types,
 * including union types where all members are objects.
 */
type ExtractObjectTypes<P> = P extends Parser<Mode, infer V, unknown>
  ? [AllObjectLike<V>] extends [never] ? never
  : V
  : never;

/**
 * Options for the {@link merge} parser.
 * @since 0.7.0
 */
export interface MergeOptions {
  /**
   * When `true`, allows duplicate option names across merged parsers.
   * By default (`false`), duplicate option names will cause a parse error.
   *
   * @default `false`
   * @since 0.7.0
   */
  readonly allowDuplicates?: boolean;
}

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
): Parser<
  CombineModes<readonly [ExtractMode<TA>, ExtractMode<TB>]>,
  & ExtractObjectTypes<TA>
  & ExtractObjectTypes<TB>,
  Record<string | symbol, unknown>
>;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param options Optional configuration for the merge parser.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
  options: MergeOptions,
): Parser<
  CombineModes<readonly [ExtractMode<TA>, ExtractMode<TB>]>,
  & ExtractObjectTypes<TA>
  & ExtractObjectTypes<TB>,
  Record<string | symbol, unknown>
>;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
>(
  label: string,
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
): Parser<
  CombineModes<readonly [ExtractMode<TA>, ExtractMode<TB>]>,
  & ExtractObjectTypes<TA>
  & ExtractObjectTypes<TB>,
  Record<string | symbol, unknown>
>;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
  c: ExtractObjectTypes<TC> extends never ? never : TC,
): Parser<
  CombineModes<readonly [ExtractMode<TA>, ExtractMode<TB>, ExtractMode<TC>]>,
  & ExtractObjectTypes<TA>
  & ExtractObjectTypes<TB>
  & ExtractObjectTypes<TC>,
  Record<string | symbol, unknown>
>;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : Parser<
    CombineModes<readonly [ExtractMode<TA>, ExtractMode<TB>, ExtractMode<TC>]>,
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : Parser<
    CombineModes<
      readonly [
        ExtractMode<TA>,
        ExtractMode<TB>,
        ExtractMode<TC>,
        ExtractMode<TD>,
      ]
    >,
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : Parser<
    CombineModes<
      readonly [
        ExtractMode<TA>,
        ExtractMode<TB>,
        ExtractMode<TC>,
        ExtractMode<TD>,
      ]
    >,
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
  c: ExtractObjectTypes<TC> extends never ? never : TC,
  d: ExtractObjectTypes<TD> extends never ? never : TD,
  e: ExtractObjectTypes<TE> extends never ? never : TE,
): Parser<
  CombineModes<
    readonly [
      ExtractMode<TA>,
      ExtractMode<TB>,
      ExtractMode<TC>,
      ExtractMode<TD>,
      ExtractMode<TE>,
    ]
  >,
  & ExtractObjectTypes<TA>
  & ExtractObjectTypes<TB>
  & ExtractObjectTypes<TC>
  & ExtractObjectTypes<TD>
  & ExtractObjectTypes<TE>,
  Record<string | symbol, unknown>
>;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the two parsers into a single object.
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : Parser<
    CombineModes<
      readonly [
        ExtractMode<TA>,
        ExtractMode<TB>,
        ExtractMode<TC>,
        ExtractMode<TD>,
        ExtractMode<TE>,
      ]
    >,
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
  TF extends Parser<Mode, unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
  TF extends Parser<Mode, unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
  TF extends Parser<Mode, unknown, unknown>,
  TG extends Parser<Mode, unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
  TF extends Parser<Mode, unknown, unknown>,
  TG extends Parser<Mode, unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
  TF extends Parser<Mode, unknown, unknown>,
  TG extends Parser<Mode, unknown, unknown>,
  TH extends Parser<Mode, unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
  TF extends Parser<Mode, unknown, unknown>,
  TG extends Parser<Mode, unknown, unknown>,
  TH extends Parser<Mode, unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @template TI The type of the ninth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @param i The ninth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
  TF extends Parser<Mode, unknown, unknown>,
  TG extends Parser<Mode, unknown, unknown>,
  TH extends Parser<Mode, unknown, unknown>,
  TI extends Parser<Mode, unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
  i: TI,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : ExtractObjectTypes<TI> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>
    & ExtractObjectTypes<TI>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @template TI The type of the ninth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @param i The ninth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
  TF extends Parser<Mode, unknown, unknown>,
  TG extends Parser<Mode, unknown, unknown>,
  TH extends Parser<Mode, unknown, unknown>,
  TI extends Parser<Mode, unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
  i: TI,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : ExtractObjectTypes<TI> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>
    & ExtractObjectTypes<TI>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @template TI The type of the ninth parser.
 * @template TJ The type of the tenth parser.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @param i The ninth {@link object} parser to merge.
 * @param j The tenth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
  TF extends Parser<Mode, unknown, unknown>,
  TG extends Parser<Mode, unknown, unknown>,
  TH extends Parser<Mode, unknown, unknown>,
  TI extends Parser<Mode, unknown, unknown>,
  TJ extends Parser<Mode, unknown, unknown>,
>(
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
  i: TI,
  j: TJ,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : ExtractObjectTypes<TI> extends never ? never
  : ExtractObjectTypes<TJ> extends never ? never
  : Parser<
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>
    & ExtractObjectTypes<TI>
    & ExtractObjectTypes<TJ>,
    Record<string | symbol, unknown>
  >;

/**
 * Merges multiple {@link object} parsers into a single {@link object} parser
 * with a label for documentation and help text organization.
 * It is useful for combining multiple {@link object} parsers so that
 * the unified parser produces a single object containing all the values
 * from the individual parsers while separating the fields into multiple
 * groups.
 * @template TA The type of the first parser.
 * @template TB The type of the second parser.
 * @template TC The type of the third parser.
 * @template TD The type of the fourth parser.
 * @template TE The type of the fifth parser.
 * @template TF The type of the sixth parser.
 * @template TG The type of the seventh parser.
 * @template TH The type of the eighth parser.
 * @template TI The type of the ninth parser.
 * @template TJ The type of the tenth parser.
 * @param label A descriptive label for this merged group, used for
 *              documentation and help messages.
 * @param a The first {@link object} parser to merge.
 * @param b The second {@link object} parser to merge.
 * @param c The third {@link object} parser to merge.
 * @param d The fourth {@link object} parser to merge.
 * @param e The fifth {@link object} parser to merge.
 * @param f The sixth {@link object} parser to merge.
 * @param g The seventh {@link object} parser to merge.
 * @param h The eighth {@link object} parser to merge.
 * @param i The ninth {@link object} parser to merge.
 * @param j The tenth {@link object} parser to merge.
 * @return A new {@link object} parser that combines the values and states
 *         of the parsers into a single object.
 * @since 0.4.0
 */
export function merge<
  TA extends Parser<Mode, unknown, unknown>,
  TB extends Parser<Mode, unknown, unknown>,
  TC extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, unknown, unknown>,
  TE extends Parser<Mode, unknown, unknown>,
  TF extends Parser<Mode, unknown, unknown>,
  TG extends Parser<Mode, unknown, unknown>,
  TH extends Parser<Mode, unknown, unknown>,
  TI extends Parser<Mode, unknown, unknown>,
  TJ extends Parser<Mode, unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
  d: TD,
  e: TE,
  f: TF,
  g: TG,
  h: TH,
  i: TI,
  j: TJ,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : ExtractObjectTypes<TD> extends never ? never
  : ExtractObjectTypes<TE> extends never ? never
  : ExtractObjectTypes<TF> extends never ? never
  : ExtractObjectTypes<TG> extends never ? never
  : ExtractObjectTypes<TH> extends never ? never
  : ExtractObjectTypes<TI> extends never ? never
  : ExtractObjectTypes<TJ> extends never ? never
  : Parser<
    CombineModes<
      readonly [
        ExtractMode<TA>,
        ExtractMode<TB>,
        ExtractMode<TC>,
        ExtractMode<TD>,
        ExtractMode<TE>,
        ExtractMode<TF>,
        ExtractMode<TG>,
        ExtractMode<TH>,
        ExtractMode<TI>,
        ExtractMode<TJ>,
      ]
    >,
    & ExtractObjectTypes<TA>
    & ExtractObjectTypes<TB>
    & ExtractObjectTypes<TC>
    & ExtractObjectTypes<TD>
    & ExtractObjectTypes<TE>
    & ExtractObjectTypes<TF>
    & ExtractObjectTypes<TG>
    & ExtractObjectTypes<TH>
    & ExtractObjectTypes<TI>
    & ExtractObjectTypes<TJ>,
    Record<string | symbol, unknown>
  >;

export function merge(
  ...args:
    | [
      string,
      ...Parser<
        Mode,
        Record<string | symbol, unknown>,
        Record<string | symbol, unknown>
      >[],
    ]
    | Parser<
      Mode,
      Record<string | symbol, unknown>,
      Record<string | symbol, unknown>
    >[]
    | [
      ...Parser<
        Mode,
        Record<string | symbol, unknown>,
        Record<string | symbol, unknown>
      >[],
      MergeOptions,
    ]
): Parser<
  Mode,
  Record<string | symbol, unknown>,
  Record<string | symbol, unknown>
> {
  // Check if first argument is a label
  const label = typeof args[0] === "string" ? args[0] : undefined;

  // Check if last argument is options
  const lastArg = args[args.length - 1];
  const options: MergeOptions = (lastArg && typeof lastArg === "object" &&
      !("parse" in lastArg) && !("complete" in lastArg))
    ? lastArg as MergeOptions
    : {};

  // Extract parsers (excluding label and options)
  const startIndex = typeof args[0] === "string" ? 1 : 0;
  const endIndex = (lastArg && typeof lastArg === "object" &&
      !("parse" in lastArg) && !("complete" in lastArg))
    ? args.length - 1
    : args.length;

  const rawParsers = args.slice(startIndex, endIndex) as Parser<
    Mode,
    Record<string | symbol, unknown>,
    Record<string | symbol, unknown>
  >[];

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = rawParsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  const isAsync = combinedMode === "async";

  // Cast to sync parsers for sync operations
  const syncRawParsers = rawParsers as Parser<
    "sync",
    Record<string | symbol, unknown>,
    Record<string | symbol, unknown>
  >[];

  // Keep track of original indices before sorting
  const withIndex = rawParsers.map((p, i) => [p, i] as const);
  const sorted = withIndex.toSorted(([a], [b]) => b.priority - a.priority);
  const parsers = sorted.map(([p]) => p);

  // Sync parsers for sync operations
  const syncWithIndex = syncRawParsers.map((p, i) => [p, i] as const);
  const syncSorted = syncWithIndex.toSorted(([a], [b]) =>
    b.priority - a.priority
  );
  const syncParsers = syncSorted.map(([p]) => p);

  // Check for duplicate option names at construction time unless explicitly allowed
  if (!options.allowDuplicates) {
    checkDuplicateOptionNames(
      sorted.map(([parser, originalIndex]) =>
        [String(originalIndex), parser.usage] as const
      ),
    );
  }

  const initialState: Record<string | symbol, unknown> = {};
  for (const parser of parsers) {
    if (parser.initialState && typeof parser.initialState === "object") {
      for (const field in parser.initialState) {
        initialState[field] = parser.initialState[field];
      }
    }
  }
  type MergeState = Record<string | symbol, unknown>;
  type MergeParseResult = ParserResult<MergeState>;

  // Helper function to extract the appropriate state for a parser
  const extractParserState = (
    parser: Parser<Mode, MergeState, MergeState>,
    context: ParserContext<MergeState>,
    index: number,
  ): unknown => {
    if (parser.initialState === undefined) {
      // For parsers with undefined initialState (like or()),
      // check if they have accumulated state during parsing
      const key = `__parser_${index}`;
      if (
        context.state && typeof context.state === "object" &&
        key in context.state
      ) {
        return context.state[key];
      }
      return undefined;
    } else if (
      parser.initialState && typeof parser.initialState === "object"
    ) {
      // For object parsers, extract matching fields from context state
      if (context.state && typeof context.state === "object") {
        const extractedState: MergeState = {};
        for (const field in parser.initialState) {
          extractedState[field] = field in context.state
            ? context.state[field]
            : parser.initialState[field];
        }
        return extractedState;
      }
      return parser.initialState;
    }
    return parser.initialState;
  };

  // Helper function to merge result state into context state
  const mergeResultState = (
    parser: Parser<Mode, MergeState, MergeState>,
    context: ParserContext<MergeState>,
    result: ParserResult<unknown>,
    index: number,
  ): MergeState => {
    if (parser.initialState === undefined) {
      // For parsers with undefined initialState (like withDefault()),
      // store their state separately to avoid conflicts with object merging.
      const key = `__parser_${index}`;
      if (result.success) {
        if (
          result.consumed.length > 0 || result.next.state !== undefined
        ) {
          return {
            ...context.state,
            [key]: result.next.state,
          };
        }
      }
      // Parser succeeded with zero consumption and undefined state
      return { ...context.state };
    }
    // For regular object parsers, use the original merging approach
    return result.success
      ? { ...context.state, ...result.next.state as MergeState }
      : { ...context.state };
  };

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<MergeState>,
  ): MergeParseResult => {
    let currentContext = context;
    let zeroConsumedSuccess: {
      context: ParserContext<MergeState>;
      consumed: string[];
    } | null = null;

    for (let i = 0; i < syncParsers.length; i++) {
      const parser = syncParsers[i];
      const parserState = extractParserState(parser, currentContext, i);

      const result = parser.parse({
        ...currentContext,
        state: parserState as Parameters<typeof parser.parse>[0]["state"],
      });

      if (result.success) {
        const newState = mergeResultState(parser, currentContext, result, i);
        const newContext = {
          ...currentContext,
          buffer: result.next.buffer,
          optionsTerminated: result.next.optionsTerminated,
          state: newState,
        };

        if (result.consumed.length > 0) {
          return {
            success: true,
            next: newContext,
            consumed: result.consumed,
          };
        }

        currentContext = newContext;
        if (zeroConsumedSuccess === null) {
          zeroConsumedSuccess = { context: newContext, consumed: [] };
        } else {
          zeroConsumedSuccess.context = newContext;
        }
      } else if (result.consumed < 1) {
        continue;
      } else {
        return result as MergeParseResult;
      }
    }

    if (zeroConsumedSuccess !== null) {
      return {
        success: true,
        next: zeroConsumedSuccess.context,
        consumed: zeroConsumedSuccess.consumed,
      };
    }

    return {
      success: false,
      consumed: 0,
      error: message`No matching option or argument found.`,
    };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<MergeState>,
  ): Promise<MergeParseResult> => {
    let currentContext = context;
    let zeroConsumedSuccess: {
      context: ParserContext<MergeState>;
      consumed: string[];
    } | null = null;

    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      const parserState = extractParserState(parser, currentContext, i);

      const resultOrPromise = parser.parse({
        ...currentContext,
        state: parserState as Parameters<typeof parser.parse>[0]["state"],
      });
      const result = await resultOrPromise;

      if (result.success) {
        const newState = mergeResultState(parser, currentContext, result, i);
        const newContext = {
          ...currentContext,
          buffer: result.next.buffer,
          optionsTerminated: result.next.optionsTerminated,
          state: newState,
        };

        if (result.consumed.length > 0) {
          return {
            success: true,
            next: newContext,
            consumed: result.consumed,
          };
        }

        currentContext = newContext;
        if (zeroConsumedSuccess === null) {
          zeroConsumedSuccess = { context: newContext, consumed: [] };
        } else {
          zeroConsumedSuccess.context = newContext;
        }
      } else if (result.consumed < 1) {
        continue;
      } else {
        return result as MergeParseResult;
      }
    }

    if (zeroConsumedSuccess !== null) {
      return {
        success: true,
        next: zeroConsumedSuccess.context,
        consumed: zeroConsumedSuccess.consumed,
      };
    }

    return {
      success: false,
      consumed: 0,
      error: message`No matching option or argument found.`,
    };
  };

  return {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: parsers.flatMap((p) => p.usage),
    initialState,
    parse(context: ParserContext<MergeState>) {
      if (isAsync) {
        return parseAsync(context);
      }
      return parseSync(context);
    },
    complete(state: MergeState) {
      // Helper function to extract parser state for completion
      const extractCompleteState = (
        parser: Parser<Mode, MergeState, MergeState>,
        resolvedState: MergeState,
        index: number,
      ): unknown => {
        if (parser.initialState === undefined) {
          const key = `__parser_${index}`;
          if (
            resolvedState && typeof resolvedState === "object" &&
            key in resolvedState
          ) {
            return resolvedState[key];
          }
          return undefined;
        } else if (
          parser.initialState && typeof parser.initialState === "object"
        ) {
          if (resolvedState && typeof resolvedState === "object") {
            const extractedState: MergeState = {};
            for (const field in parser.initialState) {
              extractedState[field] = field in resolvedState
                ? resolvedState[field]
                : parser.initialState[field];
            }
            return extractedState;
          }
          return parser.initialState;
        }
        return parser.initialState;
      };

      // For sync mode, complete synchronously
      if (!isAsync) {
        // Resolve deferred parse states across the entire merged state first.
        // This ensures dependencies from one merged parser are available to
        // derived parsers in other merged parsers.
        const resolvedState = resolveDeferredParseStates(state);

        const object: MergeState = {};
        for (let i = 0; i < syncParsers.length; i++) {
          const parser = syncParsers[i];
          const parserState = extractCompleteState(parser, resolvedState, i);
          const result = parser.complete(
            parserState as Parameters<typeof parser.complete>[0],
          );
          if (!result.success) return result;
          for (const field in result.value) object[field] = result.value[field];
        }
        return { success: true, value: object };
      }

      // For async mode, complete asynchronously
      return (async () => {
        // Resolve deferred parse states across the entire merged state first.
        // This ensures dependencies from one merged parser are available to
        // derived parsers in other merged parsers.
        const resolvedState = await resolveDeferredParseStatesAsync(state);

        const object: MergeState = {};
        for (let i = 0; i < parsers.length; i++) {
          const parser = parsers[i];
          const parserState = extractCompleteState(parser, resolvedState, i);
          const result = await parser.complete(
            parserState as Parameters<typeof parser.complete>[0],
          );
          if (!result.success) return result;
          for (const field in result.value) object[field] = result.value[field];
        }
        return { success: true, value: object };
      })();
    },
    suggest(
      context: ParserContext<MergeState>,
      prefix: string,
    ) {
      // Helper to extract parser state for a given index
      const extractState = (
        p: Parser<Mode, Record<string | symbol, unknown>, unknown>,
        i: number,
      ): unknown => {
        if (p.initialState === undefined) {
          const key = `__parser_${i}`;
          if (
            context.state && typeof context.state === "object" &&
            key in context.state
          ) {
            return context.state[key];
          }
          return undefined;
        } else if (
          p.initialState && typeof p.initialState === "object"
        ) {
          if (context.state && typeof context.state === "object") {
            const extractedState: MergeState = {};
            for (const field in p.initialState) {
              extractedState[field] = field in context.state
                ? context.state[field]
                : (p.initialState as Record<string, unknown>)[field];
            }
            return extractedState;
          }
          return p.initialState;
        }
        return p.initialState;
      };

      if (isAsync) {
        return (async function* () {
          const suggestions: Suggestion[] = [];

          for (let i = 0; i < parsers.length; i++) {
            const parser = parsers[i];
            const parserState = extractState(parser, i);

            const parserSuggestions = parser.suggest({
              ...context,
              state: parserState as Parameters<
                typeof parser.suggest
              >[0]["state"],
            }, prefix);

            if (parser.$mode === "async") {
              for await (
                const s of parserSuggestions as AsyncIterable<Suggestion>
              ) {
                suggestions.push(s);
              }
            } else {
              suggestions.push(...(parserSuggestions as Iterable<Suggestion>));
            }
          }

          yield* deduplicateSuggestions(suggestions);
        })();
      }

      return (function* () {
        const suggestions: Suggestion[] = [];

        for (let i = 0; i < syncParsers.length; i++) {
          const parser = syncParsers[i];
          const parserState = extractState(parser, i);

          const parserSuggestions = parser.suggest({
            ...context,
            state: parserState as Parameters<typeof parser.suggest>[0]["state"],
          }, prefix);

          suggestions.push(...parserSuggestions);
        }

        yield* deduplicateSuggestions(suggestions);
      })();
    },
    getDocFragments(
      state: DocState<Record<string | symbol, unknown>>,
      _defaultValue?,
    ) {
      const fragments = parsers.flatMap((p, i) => {
        let parserState: DocState<unknown>;

        if (p.initialState === undefined) {
          // For parsers with undefined initialState (like or()),
          // check if they have accumulated state during parsing
          const key = `__parser_${i}`;
          if (
            state.kind === "available" &&
            state.state &&
            typeof state.state === "object" &&
            key in state.state
          ) {
            parserState = {
              kind: "available",
              state: (state.state as Record<string | symbol, unknown>)[key],
            };
          } else {
            parserState = { kind: "unavailable" };
          }
        } else {
          // If parser has defined initialState (like object()),
          // pass the available state directly as it shares the merged state object
          parserState = state.kind === "unavailable"
            ? { kind: "unavailable" }
            : { kind: "available", state: state.state };
        }

        // Cast parserState to any because the generic type constraints on p.getDocFragments
        // are strictly typed to the parser's expected state, but here we are dealing with 'unknown'
        // due to the way merge() handles disparate parser types.
        // The runtime logic ensures we are passing the correct state slice or unavailable.
        // deno-lint-ignore no-explicit-any
        return p.getDocFragments(parserState as any, undefined).fragments;
      });
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

      // If label is provided, wrap all content in a labeled section
      if (label) {
        const labeledSection: DocSection = { title: label, entries };
        sections.push(labeledSection);
        return {
          fragments: sections.map<DocFragment>((s) => ({
            ...s,
            type: "section",
          })),
        };
      }

      return {
        fragments: [
          ...sections.map<DocFragment>((s) => ({ ...s, type: "section" })),
          { type: "section", entries },
        ],
      };
    },
  };
}

/**
 * Concatenates two {@link tuple} parsers into a single parser that produces
 * a flattened tuple containing the values from both parsers in order.
 *
 * This is similar to {@link merge} for object parsers, but operates on tuple
 * parsers and preserves the sequential, positional nature of tuples by
 * flattening the results into a single tuple array.
 *
 * @example
 * ```typescript
 * const basicTuple = tuple([
 *   option("-v", "--verbose"),
 *   option("-p", "--port", integer()),
 * ]);
 *
 * const serverTuple = tuple([
 *   option("-h", "--host", string()),
 *   option("-d", "--debug"),
 * ]);
 *
 * const combined = concat(basicTuple, serverTuple);
 * // Type: Parser<[boolean, number, string, boolean], [BasicState, ServerState]>
 *
 * const result = parse(combined, ["-v", "-p", "8080", "-h", "localhost", "-d"]);
 * // result.value: [true, 8080, "localhost", true]
 * ```
 *
 * @template TA The value type of the first tuple parser.
 * @template TB The value type of the second tuple parser.
 * @template TStateA The state type of the first tuple parser.
 * @template TStateB The state type of the second tuple parser.
 * @param a The first {@link tuple} parser to concatenate.
 * @param b The second {@link tuple} parser to concatenate.
 * @return A new {@link tuple} parser that combines the values of both parsers
 *         into a single flattened tuple.
 * @since 0.2.0
 */
export function concat<
  MA extends Mode,
  MB extends Mode,
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TStateA,
  TStateB,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
): Parser<CombineModes<readonly [MA, MB]>, [...TA, ...TB], [TStateA, TStateB]>;

/**
 * Concatenates three {@link tuple} parsers into a single parser that produces
 * a flattened tuple containing the values from all parsers in order.
 *
 * @template TA The value type of the first tuple parser.
 * @template TB The value type of the second tuple parser.
 * @template TC The value type of the third tuple parser.
 * @template TStateA The state type of the first tuple parser.
 * @template TStateB The state type of the second tuple parser.
 * @template TStateC The state type of the third tuple parser.
 * @param a The first {@link tuple} parser to concatenate.
 * @param b The second {@link tuple} parser to concatenate.
 * @param c The third {@link tuple} parser to concatenate.
 * @return A new {@link tuple} parser that combines the values of all parsers
 *         into a single flattened tuple.
 * @since 0.2.0
 */
export function concat<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TC extends readonly unknown[],
  TStateA,
  TStateB,
  TStateC,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
): Parser<
  CombineModes<readonly [MA, MB, MC]>,
  [...TA, ...TB, ...TC],
  [TStateA, TStateB, TStateC]
>;

/**
 * Concatenates four {@link tuple} parsers into a single parser that produces
 * a flattened tuple containing the values from all parsers in order.
 *
 * @template TA The value type of the first tuple parser.
 * @template TB The value type of the second tuple parser.
 * @template TC The value type of the third tuple parser.
 * @template TD The value type of the fourth tuple parser.
 * @template TStateA The state type of the first tuple parser.
 * @template TStateB The state type of the second tuple parser.
 * @template TStateC The state type of the third tuple parser.
 * @template TStateD The state type of the fourth tuple parser.
 * @param a The first {@link tuple} parser to concatenate.
 * @param b The second {@link tuple} parser to concatenate.
 * @param c The third {@link tuple} parser to concatenate.
 * @param d The fourth {@link tuple} parser to concatenate.
 * @return A new {@link tuple} parser that combines the values of all parsers
 *         into a single flattened tuple.
 * @since 0.2.0
 */
export function concat<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TC extends readonly unknown[],
  TD extends readonly unknown[],
  TStateA,
  TStateB,
  TStateC,
  TStateD,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD]>,
  [...TA, ...TB, ...TC, ...TD],
  [TStateA, TStateB, TStateC, TStateD]
>;

/**
 * Concatenates five {@link tuple} parsers into a single parser that produces
 * a flattened tuple containing the values from all parsers in order.
 *
 * @template TA The value type of the first tuple parser.
 * @template TB The value type of the second tuple parser.
 * @template TC The value type of the third tuple parser.
 * @template TD The value type of the fourth tuple parser.
 * @template TE The value type of the fifth tuple parser.
 * @template TStateA The state type of the first tuple parser.
 * @template TStateB The state type of the second tuple parser.
 * @template TStateC The state type of the third tuple parser.
 * @template TStateD The state type of the fourth tuple parser.
 * @template TStateE The state type of the fifth tuple parser.
 * @param a The first {@link tuple} parser to concatenate.
 * @param b The second {@link tuple} parser to concatenate.
 * @param c The third {@link tuple} parser to concatenate.
 * @param d The fourth {@link tuple} parser to concatenate.
 * @param e The fifth {@link tuple} parser to concatenate.
 * @return A new {@link tuple} parser that combines the values of all parsers
 *         into a single flattened tuple.
 * @since 0.2.0
 */
export function concat<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TC extends readonly unknown[],
  TD extends readonly unknown[],
  TE extends readonly unknown[],
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME]>,
  [...TA, ...TB, ...TC, ...TD, ...TE],
  [TStateA, TStateB, TStateC, TStateD, TStateE]
>;

export function concat(
  ...parsers: Parser<Mode, readonly unknown[], unknown>[]
): Parser<Mode, readonly unknown[], readonly unknown[]> {
  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = parsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  const isAsync = combinedMode === "async";

  // Cast to sync parsers for sync operations
  const syncParsers = parsers as Parser<"sync", readonly unknown[], unknown>[];

  const initialState = parsers.map((parser) => parser.initialState);

  type ConcatContext = ParserContext<readonly unknown[]>;
  type ConcatResult = ParserResult<readonly unknown[]>;

  // Sync parse implementation
  const parseSync = (context: ConcatContext): ConcatResult => {
    let currentContext = context;
    const allConsumed: string[] = [];
    const matchedParsers = new Set<number>();

    // Use the exact same logic as tuple() to avoid infinite loops
    while (matchedParsers.size < syncParsers.length) {
      let foundMatch = false;
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: message`No remaining parsers could match the input.`,
      };

      // Get current state array from context (may have been updated in previous iterations)
      const stateArray = currentContext.state as unknown[];

      // Create priority-ordered list of remaining parsers
      const remainingParsers = syncParsers
        .map((parser, index) => [parser, index] as [typeof parser, number])
        .filter(([_, index]) => !matchedParsers.has(index))
        .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

      for (const [parser, index] of remainingParsers) {
        const result = parser.parse({
          ...currentContext,
          state: stateArray[index],
        });

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = stateArray.map((s, idx) =>
            idx === index ? result.next.state : s
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as readonly unknown[],
          };

          allConsumed.push(...result.consumed);
          matchedParsers.add(index);
          foundMatch = true;
          break; // Take the first (highest priority) match that consumes input
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }

      // If no consuming parser matched, try non-consuming ones (like optional)
      // or mark failing optional parsers as matched
      if (!foundMatch) {
        for (const [parser, index] of remainingParsers) {
          const result = parser.parse({
            ...currentContext,
            state: stateArray[index],
          });

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = stateArray.map((s, idx) =>
              idx === index ? result.next.state : s
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as readonly unknown[],
            };

            matchedParsers.add(index);
            foundMatch = true;
            break;
          } else if (!result.success && result.consumed < 1) {
            // Parser failed without consuming input - this could be
            // an optional parser that doesn't match.
            // Check if we can safely skip it.
            // For now, mark it as matched to continue processing
            matchedParsers.add(index);
            foundMatch = true;
            break;
          }
        }
      }

      if (!foundMatch) {
        return { ...error, success: false };
      }
    }

    return {
      success: true,
      next: currentContext,
      consumed: allConsumed,
    };
  };

  // Async parse implementation
  const parseAsync = async (context: ConcatContext): Promise<ConcatResult> => {
    let currentContext = context;
    const allConsumed: string[] = [];
    const matchedParsers = new Set<number>();

    // Use the exact same logic as tuple() to avoid infinite loops
    while (matchedParsers.size < parsers.length) {
      let foundMatch = false;
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: message`No remaining parsers could match the input.`,
      };

      // Get current state array from context (may have been updated in previous iterations)
      const stateArray = currentContext.state as unknown[];

      // Create priority-ordered list of remaining parsers
      const remainingParsers = parsers
        .map((parser, index) => [parser, index] as [typeof parser, number])
        .filter(([_, index]) => !matchedParsers.has(index))
        .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

      for (const [parser, index] of remainingParsers) {
        const result = await parser.parse({
          ...currentContext,
          state: stateArray[index],
        });

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = stateArray.map((s, idx) =>
            idx === index ? result.next.state : s
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as readonly unknown[],
          };

          allConsumed.push(...result.consumed);
          matchedParsers.add(index);
          foundMatch = true;
          break; // Take the first (highest priority) match that consumes input
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }

      // If no consuming parser matched, try non-consuming ones (like optional)
      // or mark failing optional parsers as matched
      if (!foundMatch) {
        for (const [parser, index] of remainingParsers) {
          const result = await parser.parse({
            ...currentContext,
            state: stateArray[index],
          });

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = stateArray.map((s, idx) =>
              idx === index ? result.next.state : s
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as readonly unknown[],
            };

            matchedParsers.add(index);
            foundMatch = true;
            break;
          } else if (!result.success && result.consumed < 1) {
            // Parser failed without consuming input - this could be
            // an optional parser that doesn't match.
            // Check if we can safely skip it.
            // For now, mark it as matched to continue processing
            matchedParsers.add(index);
            foundMatch = true;
            break;
          }
        }
      }

      if (!foundMatch) {
        return { ...error, success: false };
      }
    }

    return {
      success: true,
      next: currentContext,
      consumed: allConsumed,
    };
  };

  type CompleteResult = ValueParserResult<readonly unknown[]>;

  // Sync complete implementation
  const completeSync = (state: readonly unknown[]): CompleteResult => {
    const stateArray = state as unknown[];

    // Phase 1: Build a combined state object for dependency resolution
    // This allows DependencySourceState from one tuple to be used by
    // DeferredParseState in another tuple.
    const combinedState: Record<number, unknown> = {};
    for (let i = 0; i < stateArray.length; i++) {
      combinedState[i] = stateArray[i];
    }

    // Phase 2: Resolve deferred parse states across all tuples
    const resolvedCombinedState = resolveDeferredParseStates(combinedState);

    // Phase 3: Complete each parser with resolved state
    const results: unknown[] = [];
    for (let i = 0; i < syncParsers.length; i++) {
      const parser = syncParsers[i];
      const parserState = resolvedCombinedState[i];
      const result = parser.complete(parserState);
      if (!result.success) return result;

      // Flatten the tuple results
      if (Array.isArray(result.value)) {
        results.push(...result.value);
      } else {
        results.push(result.value);
      }
    }
    return { success: true, value: results };
  };

  // Async complete implementation
  const completeAsync = async (
    state: readonly unknown[],
  ): Promise<CompleteResult> => {
    const stateArray = state as unknown[];

    // Phase 1: Build a combined state object for dependency resolution
    const combinedState: Record<number, unknown> = {};
    for (let i = 0; i < stateArray.length; i++) {
      combinedState[i] = stateArray[i];
    }

    // Phase 2: Resolve deferred parse states across all tuples
    const resolvedCombinedState = await resolveDeferredParseStatesAsync(
      combinedState,
    );

    // Phase 3: Complete each parser with resolved state
    const results: unknown[] = [];
    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      const parserState = resolvedCombinedState[i];
      const result = await parser.complete(parserState);
      if (!result.success) return result;

      // Flatten the tuple results
      if (Array.isArray(result.value)) {
        results.push(...result.value);
      } else {
        results.push(result.value);
      }
    }
    return { success: true, value: results };
  };

  return {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    priority: parsers.length > 0
      ? Math.max(...parsers.map((p) => p.priority))
      : 0,
    usage: parsers.flatMap((p) => p.usage),
    initialState,
    parse(context) {
      if (isAsync) {
        return parseAsync(context);
      }
      return parseSync(context);
    },
    complete(state) {
      if (isAsync) {
        return completeAsync(state);
      }
      return completeSync(state);
    },
    suggest(context, prefix) {
      const stateArray = context.state as unknown[] | undefined;

      if (isAsync) {
        return (async function* () {
          const suggestions: Suggestion[] = [];

          for (let i = 0; i < parsers.length; i++) {
            const parser = parsers[i];
            const parserState = stateArray && Array.isArray(stateArray)
              ? stateArray[i]
              : parser.initialState;

            const parserSuggestions = parser.suggest({
              ...context,
              state: parserState,
            }, prefix);

            if (parser.$mode === "async") {
              for await (
                const s of parserSuggestions as AsyncIterable<Suggestion>
              ) {
                suggestions.push(s);
              }
            } else {
              suggestions.push(...(parserSuggestions as Iterable<Suggestion>));
            }
          }

          yield* deduplicateSuggestions(suggestions);
        })();
      }

      return (function* () {
        const suggestions: Suggestion[] = [];

        for (let i = 0; i < syncParsers.length; i++) {
          const parser = syncParsers[i];
          const parserState = stateArray && Array.isArray(stateArray)
            ? stateArray[i]
            : parser.initialState;

          const parserSuggestions = parser.suggest({
            ...context,
            state: parserState,
          }, prefix);

          suggestions.push(...parserSuggestions);
        }

        yield* deduplicateSuggestions(suggestions);
      })();
    },
    getDocFragments(state: DocState<readonly unknown[]>, _defaultValue?) {
      const fragments = syncParsers.flatMap((p, index) => {
        const indexState: DocState<unknown> = state.kind === "unavailable"
          ? { kind: "unavailable" }
          : { kind: "available", state: state.state[index] };
        return p.getDocFragments(indexState, undefined).fragments;
      });
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
      const result: DocFragment[] = [
        ...sections.map<DocFragment>((s) => ({ ...s, type: "section" })),
      ];
      if (entries.length > 0) {
        result.push({ type: "section", entries });
      }
      return { fragments: result };
    },
  };
}

/**
 * Wraps a parser with a group label for documentation purposes.
 *
 * The `group()` function is a documentation-only wrapper that applies a label
 * to any parser for help text organization. This allows you to use clean code
 * structure with combinators like {@link merge} while maintaining well-organized
 * help text through group labeling.
 *
 * The wrapped parser has identical parsing behavior but generates documentation
 * fragments wrapped in a labeled section. This is particularly useful when
 * combining parsers using {@link merge}—you can wrap the merged result with
 * `group()` to add a section header in help output.
 *
 * @example
 * ```typescript
 * const apiOptions = merge(
 *   object({ endpoint: option("--endpoint", string()) }),
 *   object({ timeout: option("--timeout", integer()) })
 * );
 *
 * const groupedApiOptions = group("API Options", apiOptions);
 * // Now produces a labeled "API Options" section in help text
 * ```
 *
 * @example
 * ```typescript
 * // Can be used with any parser, not just merge()
 * const verboseGroup = group("Verbosity", object({
 *   verbose: option("-v", "--verbose"),
 *   quiet: option("-q", "--quiet")
 * }));
 * ```
 *
 * @template TValue The value type of the wrapped parser.
 * @template TState The state type of the wrapped parser.
 * @param label A descriptive label for this parser group, used for
 *              documentation and help text organization.
 * @param parser The parser to wrap with a group label.
 * @returns A new parser that behaves identically to the input parser
 *          but generates documentation within a labeled section.
 * @since 0.4.0
 */
export function group<M extends Mode, TValue, TState>(
  label: string,
  parser: Parser<M, TValue, TState>,
): Parser<M, TValue, TState> {
  return {
    $mode: parser.$mode,
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    usage: parser.usage,
    initialState: parser.initialState,
    parse: (context) => parser.parse(context),
    complete: (state) => parser.complete(state),
    suggest: (context, prefix) => parser.suggest(context, prefix),
    getDocFragments: (state, defaultValue) => {
      const { description, fragments } = parser.getDocFragments(
        state,
        defaultValue,
      );

      // Collect all entries and titled sections
      const allEntries: DocEntry[] = [];
      const titledSections: DocSection[] = [];

      for (const fragment of fragments) {
        if (fragment.type === "entry") {
          allEntries.push(fragment);
        } else if (fragment.type === "section") {
          if (fragment.title) {
            // Preserve sections with titles (nested groups)
            titledSections.push(fragment);
          } else {
            // Merge entries from sections without titles into our labeled section
            allEntries.push(...fragment.entries);
          }
        }
      }

      // Create our labeled section with all collected entries
      const labeledSection: DocSection = { title: label, entries: allEntries };

      return {
        description,
        fragments: [
          ...titledSections.map<DocFragment>((s) => ({
            ...s,
            type: "section",
          })),
          { type: "section", ...labeledSection },
        ],
      };
    },
  };
}

/**
 * Tagged union type representing which branch is selected.
 * Uses tagged union to avoid collision with discriminator values.
 * @internal
 */
type SelectedBranch<TDiscriminator extends string> =
  | { readonly kind: "branch"; readonly key: TDiscriminator }
  | { readonly kind: "default" };

/**
 * State type for the conditional parser.
 * @internal
 */
interface ConditionalState<TDiscriminator extends string> {
  readonly discriminatorState: unknown;
  readonly discriminatorValue: TDiscriminator | undefined;
  readonly selectedBranch: SelectedBranch<TDiscriminator> | undefined;
  readonly branchState: unknown;
}

/**
 * Options for customizing error messages in the {@link conditional} combinator.
 * @since 0.8.0
 */
export interface ConditionalErrorOptions {
  /**
   * Custom error message when branch parser fails.
   * Receives the discriminator value for context.
   */
  branchError?: (
    discriminatorValue: string | undefined,
    error: Message,
  ) => Message;

  /**
   * Custom error message for no matching input.
   */
  noMatch?: Message | ((context: NoMatchContext) => Message);
}

/**
 * Options for customizing the {@link conditional} combinator behavior.
 * @since 0.8.0
 */
export interface ConditionalOptions {
  /**
   * Custom error messages.
   */
  errors?: ConditionalErrorOptions;
}

/**
 * Helper type to infer result type without default branch.
 * @internal
 */
type ConditionalResultWithoutDefault<
  TDiscriminator extends string,
  TBranches extends Record<string, Parser<Mode, unknown, unknown>>,
> = {
  [K in keyof TBranches & string]: readonly [K, InferValue<TBranches[K]>];
}[keyof TBranches & string];

/**
 * Helper type to infer result type with default branch.
 * @internal
 */
type ConditionalResultWithDefault<
  TDiscriminator extends string,
  TBranches extends Record<string, Parser<Mode, unknown, unknown>>,
  TDefault extends Parser<Mode, unknown, unknown>,
> =
  | ConditionalResultWithoutDefault<TDiscriminator, TBranches>
  | readonly [undefined, InferValue<TDefault>];

/**
 * Creates a conditional parser without a default branch.
 * The discriminator option is required; parsing fails if not provided.
 *
 * @template TDiscriminator The string literal union type of discriminator values.
 * @template TBranches Record mapping discriminator values to branch parsers.
 * @param discriminator Parser for the discriminator option (typically using choice()).
 * @param branches Object mapping each discriminator value to its branch parser.
 * @returns A parser that produces a tuple `[discriminatorValue, branchResult]`.
 * @since 0.8.0
 */
export function conditional<
  TDiscriminator extends string,
  TBranches extends { [K in TDiscriminator]: Parser<Mode, unknown, unknown> },
  TD extends Parser<Mode, TDiscriminator, unknown>,
>(
  discriminator: TD,
  branches: TBranches,
): Parser<
  CombineModes<
    readonly [
      ExtractMode<TD>,
      ...{
        [K in keyof TBranches]: ExtractMode<TBranches[K]>;
      }[keyof TBranches][],
    ]
  >,
  ConditionalResultWithoutDefault<TDiscriminator, TBranches>,
  ConditionalState<TDiscriminator>
>;

/**
 * Creates a conditional parser with a default branch.
 * The default branch is used when the discriminator option is not provided.
 *
 * @template TDiscriminator The string literal union type of discriminator values.
 * @template TBranches Record mapping discriminator values to branch parsers.
 * @template TDefault The default branch parser type.
 * @param discriminator Parser for the discriminator option (typically using choice()).
 * @param branches Object mapping each discriminator value to its branch parser.
 * @param defaultBranch Parser to use when discriminator is not provided.
 * @param options Optional configuration for error messages.
 * @returns A parser that produces a tuple `[discriminatorValue | undefined, branchResult]`.
 * @since 0.8.0
 */
export function conditional<
  TDiscriminator extends string,
  TBranches extends { [K in TDiscriminator]: Parser<Mode, unknown, unknown> },
  TDefault extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, TDiscriminator, unknown>,
>(
  discriminator: TD,
  branches: TBranches,
  defaultBranch: TDefault,
  options?: ConditionalOptions,
): Parser<
  CombineModes<
    readonly [
      ExtractMode<TD>,
      ExtractMode<TDefault>,
      ...{
        [K in keyof TBranches]: ExtractMode<TBranches[K]>;
      }[keyof TBranches][],
    ]
  >,
  ConditionalResultWithDefault<TDiscriminator, TBranches, TDefault>,
  ConditionalState<TDiscriminator>
>;

/**
 * Creates a conditional parser that selects different branch parsers based on
 * a discriminator option value. This enables discriminated union patterns where
 * certain options are only required or available when a specific discriminator
 * value is selected.
 *
 * The result type is a tuple: `[discriminatorValue, branchResult]`
 *
 * @example
 * ```typescript
 * // Basic conditional parsing
 * const parser = conditional(
 *   option("--reporter", choice(["console", "junit"])),
 *   {
 *     console: object({}),
 *     junit: object({ outputFile: option("--output-file", string()) }),
 *   },
 *   object({}) // default when --reporter is not provided
 * );
 *
 * const result = parse(parser, ["--reporter", "junit", "--output-file", "out.xml"]);
 * // result.value = ["junit", { outputFile: "out.xml" }]
 *
 * // Without --reporter, uses default branch:
 * const defaultResult = parse(parser, []);
 * // defaultResult.value = [undefined, {}]
 * ```
 *
 * @since 0.8.0
 */
export function conditional(
  discriminator: Parser<Mode, string, unknown>,
  branches: Record<string, Parser<Mode, unknown, unknown>>,
  defaultBranch?: Parser<Mode, unknown, unknown>,
  options?: ConditionalOptions,
): Parser<
  Mode,
  readonly [string | undefined, unknown],
  ConditionalState<string>
> {
  const branchParsers = Object.entries(branches);
  const allBranchParsers = defaultBranch
    ? [...branchParsers.map(([_, p]) => p), defaultBranch]
    : branchParsers.map(([_, p]) => p);

  // Compute combined mode
  const combinedMode: Mode = discriminator.$mode === "async" ||
      allBranchParsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  const isAsync = combinedMode === "async";

  const maxPriority = Math.max(
    discriminator.priority,
    ...allBranchParsers.map((p) => p.priority),
  );

  // Helper to replace metavar with literal value after the option in usage
  function appendLiteralToUsage(usage: Usage, literalValue: string): Usage {
    const result: UsageTerm[] = [];
    for (const term of usage) {
      if (term.type === "option" && term.metavar !== undefined) {
        // Add option without metavar, then add a literal term
        const { metavar: _, ...optionWithoutMetavar } = term;
        result.push(optionWithoutMetavar);
        result.push({ type: "literal", value: literalValue });
      } else if (term.type === "optional") {
        result.push({
          ...term,
          terms: appendLiteralToUsage(term.terms, literalValue),
        });
      } else if (term.type === "multiple") {
        result.push({
          ...term,
          terms: appendLiteralToUsage(term.terms, literalValue),
        });
      } else if (term.type === "exclusive") {
        result.push({
          ...term,
          terms: term.terms.map((t) => appendLiteralToUsage(t, literalValue)),
        });
      } else {
        result.push(term);
      }
    }
    return result;
  }

  // Build usage: discriminator (with literal value) + exclusive branches
  const branchUsages: Usage[] = branchParsers.map(([key, p]) => [
    ...appendLiteralToUsage(discriminator.usage, key),
    ...p.usage,
  ]);
  if (defaultBranch) {
    branchUsages.push(defaultBranch.usage);
  }

  const usage: Usage = branchUsages.length > 1
    ? [{ type: "exclusive", terms: branchUsages }]
    : branchUsages[0] ?? [];

  const initialState: ConditionalState<string> = {
    discriminatorState: discriminator.initialState,
    discriminatorValue: undefined,
    selectedBranch: undefined,
    branchState: undefined,
  };

  // Helper to generate no-match error
  const getNoMatchError = (): Message => {
    const noMatchContext = analyzeNoMatchContext([
      discriminator,
      ...allBranchParsers,
    ]);
    return options?.errors?.noMatch
      ? typeof options.errors.noMatch === "function"
        ? options.errors.noMatch(noMatchContext)
        : options.errors.noMatch
      : generateNoMatchError(noMatchContext);
  };

  type ParseResult = ParserResult<ConditionalState<string>>;

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<ConditionalState<string>>,
  ): ParseResult => {
    const state = context.state ?? initialState;
    const syncDiscriminator = discriminator as Parser<"sync", string, unknown>;
    const syncBranches = branches as Record<
      string,
      Parser<"sync", unknown, unknown>
    >;
    const syncDefaultBranch = defaultBranch as
      | Parser<"sync", unknown, unknown>
      | undefined;

    // If branch already selected, delegate to it
    if (state.selectedBranch !== undefined) {
      const branchParser = state.selectedBranch.kind === "default"
        ? syncDefaultBranch!
        : syncBranches[state.selectedBranch.key];

      const branchResult = branchParser.parse({
        ...context,
        state: state.branchState,
        usage: branchParser.usage,
      });

      if (branchResult.success) {
        return {
          success: true,
          next: {
            ...branchResult.next,
            state: {
              ...state,
              branchState: branchResult.next.state,
            },
          },
          consumed: branchResult.consumed,
        };
      }
      return branchResult;
    }

    // Try to parse discriminator first
    const discriminatorResult = syncDiscriminator.parse({
      ...context,
      state: state.discriminatorState,
    });

    if (
      discriminatorResult.success && discriminatorResult.consumed.length > 0
    ) {
      // Complete discriminator to get the value
      const completionResult = syncDiscriminator.complete(
        discriminatorResult.next.state,
      );

      if (completionResult.success) {
        const value = completionResult.value;
        const branchParser = syncBranches[value];

        if (branchParser) {
          // Try to parse more from the branch
          const branchParseResult = branchParser.parse({
            ...context,
            buffer: discriminatorResult.next.buffer,
            optionsTerminated: discriminatorResult.next.optionsTerminated,
            state: branchParser.initialState,
            usage: branchParser.usage,
          });

          if (branchParseResult.success) {
            return {
              success: true,
              next: {
                ...branchParseResult.next,
                state: {
                  discriminatorState: discriminatorResult.next.state,
                  discriminatorValue: value,
                  selectedBranch: { kind: "branch", key: value },
                  branchState: branchParseResult.next.state,
                },
              },
              consumed: [
                ...discriminatorResult.consumed,
                ...branchParseResult.consumed,
              ],
            };
          }

          // Branch parse failed but discriminator succeeded
          return {
            success: true,
            next: {
              ...discriminatorResult.next,
              state: {
                discriminatorState: discriminatorResult.next.state,
                discriminatorValue: value,
                selectedBranch: { kind: "branch", key: value },
                branchState: branchParser.initialState,
              },
            },
            consumed: discriminatorResult.consumed,
          };
        }
      }
    }

    // Discriminator didn't match, try default branch
    if (syncDefaultBranch !== undefined) {
      const defaultResult = syncDefaultBranch.parse({
        ...context,
        state: state.branchState ?? syncDefaultBranch.initialState,
        usage: syncDefaultBranch.usage,
      });

      if (defaultResult.success && defaultResult.consumed.length > 0) {
        return {
          success: true,
          next: {
            ...defaultResult.next,
            state: {
              ...state,
              selectedBranch: { kind: "default" },
              branchState: defaultResult.next.state,
            },
          },
          consumed: defaultResult.consumed,
        };
      }
    }

    // Nothing matched
    return {
      success: false,
      consumed: 0,
      error: getNoMatchError(),
    };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<ConditionalState<string>>,
  ): Promise<ParseResult> => {
    const state = context.state ?? initialState;

    // If branch already selected, delegate to it
    if (state.selectedBranch !== undefined) {
      const branchParser = state.selectedBranch.kind === "default"
        ? defaultBranch!
        : branches[state.selectedBranch.key];

      const branchResult = await branchParser.parse({
        ...context,
        state: state.branchState,
        usage: branchParser.usage,
      });

      if (branchResult.success) {
        return {
          success: true,
          next: {
            ...branchResult.next,
            state: {
              ...state,
              branchState: branchResult.next.state,
            },
          },
          consumed: branchResult.consumed,
        };
      }
      return branchResult;
    }

    // Try to parse discriminator first
    const discriminatorResult = await discriminator.parse({
      ...context,
      state: state.discriminatorState,
    });

    if (
      discriminatorResult.success && discriminatorResult.consumed.length > 0
    ) {
      // Complete discriminator to get the value
      const completionResult = await discriminator.complete(
        discriminatorResult.next.state,
      );

      if (completionResult.success) {
        const value = completionResult.value;
        const branchParser = branches[value];

        if (branchParser) {
          // Try to parse more from the branch
          const branchParseResult = await branchParser.parse({
            ...context,
            buffer: discriminatorResult.next.buffer,
            optionsTerminated: discriminatorResult.next.optionsTerminated,
            state: branchParser.initialState,
            usage: branchParser.usage,
          });

          if (branchParseResult.success) {
            return {
              success: true,
              next: {
                ...branchParseResult.next,
                state: {
                  discriminatorState: discriminatorResult.next.state,
                  discriminatorValue: value,
                  selectedBranch: { kind: "branch", key: value },
                  branchState: branchParseResult.next.state,
                },
              },
              consumed: [
                ...discriminatorResult.consumed,
                ...branchParseResult.consumed,
              ],
            };
          }

          // Branch parse failed but discriminator succeeded
          return {
            success: true,
            next: {
              ...discriminatorResult.next,
              state: {
                discriminatorState: discriminatorResult.next.state,
                discriminatorValue: value,
                selectedBranch: { kind: "branch", key: value },
                branchState: branchParser.initialState,
              },
            },
            consumed: discriminatorResult.consumed,
          };
        }
      }
    }

    // Discriminator didn't match, try default branch
    if (defaultBranch !== undefined) {
      const defaultResult = await defaultBranch.parse({
        ...context,
        state: state.branchState ?? defaultBranch.initialState,
        usage: defaultBranch.usage,
      });

      if (defaultResult.success && defaultResult.consumed.length > 0) {
        return {
          success: true,
          next: {
            ...defaultResult.next,
            state: {
              ...state,
              selectedBranch: { kind: "default" },
              branchState: defaultResult.next.state,
            },
          },
          consumed: defaultResult.consumed,
        };
      }
    }

    // Nothing matched
    return {
      success: false,
      consumed: 0,
      error: getNoMatchError(),
    };
  };

  type CompleteResult = ValueParserResult<
    readonly [string | undefined, unknown]
  >;

  // Sync complete implementation
  const completeSync = (state: ConditionalState<string>): CompleteResult => {
    const syncDiscriminator = discriminator as Parser<"sync", string, unknown>;
    const syncDefaultBranch = defaultBranch as
      | Parser<"sync", unknown, unknown>
      | undefined;
    const syncBranches = branches as Record<
      string,
      Parser<"sync", unknown, unknown>
    >;

    // No branch selected yet
    if (state.selectedBranch === undefined) {
      // If we have default branch, use it
      if (syncDefaultBranch !== undefined) {
        const branchState = state.branchState ?? syncDefaultBranch.initialState;
        const defaultResult = syncDefaultBranch.complete(branchState);
        if (!defaultResult.success) {
          return defaultResult;
        }
        return {
          success: true,
          value: [undefined, defaultResult.value] as const,
        };
      }

      // No default branch, discriminator is required
      return {
        success: false,
        error: message`Missing required discriminator option.`,
      };
    }

    // Complete selected branch
    const branchParser = state.selectedBranch.kind === "default"
      ? syncDefaultBranch!
      : syncBranches[state.selectedBranch.key];

    // First, complete the discriminator to get DependencySourceState if applicable
    const discriminatorCompleteResult = syncDiscriminator.complete(
      state.discriminatorState,
    );
    // discriminatorCompleteResult may be { success: true, value: ... } or DependencySourceState

    // To propagate dependency from discriminator to branch:
    // 1. Wrap discriminator state and branch state together
    // 2. Resolve deferred parse states with dependency registry populated from discriminator
    const combinedState = {
      _discriminator: state.discriminatorState,
      _branch: state.branchState,
    };
    const resolvedCombinedState = resolveDeferredParseStates(combinedState);
    const resolvedBranchState = resolvedCombinedState._branch;

    const branchResult = branchParser.complete(resolvedBranchState);

    if (!branchResult.success) {
      // Add context to error message
      if (
        state.discriminatorValue !== undefined &&
        options?.errors?.branchError
      ) {
        return {
          success: false,
          error: options.errors.branchError(
            state.discriminatorValue,
            branchResult.error,
          ),
        };
      }
      return branchResult;
    }

    // Get the discriminator value: either from DependencySourceState or regular completion
    let discriminatorValue: string | undefined;
    if (state.selectedBranch.kind === "default") {
      discriminatorValue = undefined;
    } else if (isDependencySourceState(discriminatorCompleteResult)) {
      discriminatorValue = discriminatorCompleteResult.result.success
        ? discriminatorCompleteResult.result.value as string
        : state.selectedBranch.key;
    } else if (discriminatorCompleteResult.success) {
      discriminatorValue = discriminatorCompleteResult.value;
    } else {
      discriminatorValue = state.selectedBranch.key;
    }

    return {
      success: true,
      value: [discriminatorValue, branchResult.value] as const,
    };
  };

  // Async complete implementation
  const completeAsync = async (
    state: ConditionalState<string>,
  ): Promise<CompleteResult> => {
    // No branch selected yet
    if (state.selectedBranch === undefined) {
      // If we have default branch, use it
      if (defaultBranch !== undefined) {
        const branchState = state.branchState ?? defaultBranch.initialState;
        const defaultResult = await defaultBranch.complete(branchState);
        if (!defaultResult.success) {
          return defaultResult;
        }
        return {
          success: true,
          value: [undefined, defaultResult.value] as const,
        };
      }

      // No default branch, discriminator is required
      return {
        success: false,
        error: message`Missing required discriminator option.`,
      };
    }

    // Complete selected branch
    const branchParser = state.selectedBranch.kind === "default"
      ? defaultBranch!
      : branches[state.selectedBranch.key];

    // First, complete the discriminator to get DependencySourceState if applicable
    const discriminatorCompleteResult = await discriminator.complete(
      state.discriminatorState,
    );

    // To propagate dependency from discriminator to branch:
    // 1. Wrap discriminator state and branch state together
    // 2. Resolve deferred parse states with dependency registry populated from discriminator
    const combinedState = {
      _discriminator: state.discriminatorState,
      _branch: state.branchState,
    };
    const resolvedCombinedState = await resolveDeferredParseStatesAsync(
      combinedState,
    );
    const resolvedBranchState = resolvedCombinedState._branch;

    const branchResult = await branchParser.complete(resolvedBranchState);

    if (!branchResult.success) {
      // Add context to error message
      if (
        state.discriminatorValue !== undefined &&
        options?.errors?.branchError
      ) {
        return {
          success: false,
          error: options.errors.branchError(
            state.discriminatorValue,
            branchResult.error,
          ),
        };
      }
      return branchResult;
    }

    // Get the discriminator value: either from DependencySourceState or regular completion
    let discriminatorValue: string | undefined;
    if (state.selectedBranch.kind === "default") {
      discriminatorValue = undefined;
    } else if (isDependencySourceState(discriminatorCompleteResult)) {
      discriminatorValue = discriminatorCompleteResult.result.success
        ? discriminatorCompleteResult.result.value as string
        : state.selectedBranch.key;
    } else if (discriminatorCompleteResult.success) {
      discriminatorValue = discriminatorCompleteResult.value;
    } else {
      discriminatorValue = state.selectedBranch.key;
    }

    return {
      success: true,
      value: [discriminatorValue, branchResult.value] as const,
    };
  };

  // Sync suggest implementation
  function* suggestSync(
    context: ParserContext<ConditionalState<string>>,
    prefix: string,
  ): Iterable<Suggestion> {
    const state = context.state ?? initialState;
    const syncDiscriminator = discriminator as Parser<"sync", string, unknown>;
    const syncBranches = branches as Record<
      string,
      Parser<"sync", unknown, unknown>
    >;
    const syncDefaultBranch = defaultBranch as
      | Parser<"sync", unknown, unknown>
      | undefined;

    // If no branch selected, suggest discriminator and default branch options
    if (state.selectedBranch === undefined) {
      // Discriminator suggestions
      yield* syncDiscriminator.suggest(
        { ...context, state: state.discriminatorState },
        prefix,
      );

      // Default branch suggestions if available
      if (syncDefaultBranch !== undefined) {
        yield* syncDefaultBranch.suggest(
          {
            ...context,
            state: state.branchState ?? syncDefaultBranch.initialState,
          },
          prefix,
        );
      }
    } else {
      // Delegate to selected branch
      const branchParser = state.selectedBranch.kind === "default"
        ? syncDefaultBranch!
        : syncBranches[state.selectedBranch.key];

      yield* branchParser.suggest(
        { ...context, state: state.branchState },
        prefix,
      );
    }
  }

  // Async suggest implementation
  async function* suggestAsync(
    context: ParserContext<ConditionalState<string>>,
    prefix: string,
  ): AsyncIterable<Suggestion> {
    const state = context.state ?? initialState;

    // If no branch selected, suggest discriminator and default branch options
    if (state.selectedBranch === undefined) {
      // Discriminator suggestions
      yield* discriminator.suggest(
        { ...context, state: state.discriminatorState },
        prefix,
      );

      // Default branch suggestions if available
      if (defaultBranch !== undefined) {
        yield* defaultBranch.suggest(
          {
            ...context,
            state: state.branchState ?? defaultBranch.initialState,
          },
          prefix,
        );
      }
    } else {
      // Delegate to selected branch
      const branchParser = state.selectedBranch.kind === "default"
        ? defaultBranch!
        : branches[state.selectedBranch.key];

      yield* branchParser.suggest(
        { ...context, state: state.branchState },
        prefix,
      );
    }
  }

  return {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    priority: maxPriority,
    usage,
    initialState,

    parse(context) {
      if (isAsync) {
        return parseAsync(context);
      }
      return parseSync(context);
    },

    complete(state) {
      if (isAsync) {
        return completeAsync(state);
      }
      return completeSync(state);
    },

    suggest(context, prefix) {
      if (isAsync) {
        return suggestAsync(context, prefix);
      }
      return suggestSync(context, prefix);
    },

    getDocFragments(_state, _defaultValue?) {
      const fragments: DocFragment[] = [];

      // Add discriminator documentation
      const discriminatorFragments = discriminator.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      fragments.push(...discriminatorFragments.fragments);

      // Add branch-specific documentation
      for (const [key, branchParser] of branchParsers) {
        const branchFragments = branchParser.getDocFragments(
          { kind: "unavailable" },
          undefined,
        );

        const entries: DocEntry[] = branchFragments.fragments
          .filter((f): f is DocEntry & { type: "entry" } => f.type === "entry");

        // Also collect entries from sections
        for (const fragment of branchFragments.fragments) {
          if (fragment.type === "section") {
            entries.push(...fragment.entries);
          }
        }

        if (entries.length > 0) {
          fragments.push({
            type: "section",
            title: `Options when ${key}`,
            entries,
          });
        }
      }

      // Add default branch documentation if present
      if (defaultBranch !== undefined) {
        const defaultFragments = defaultBranch.getDocFragments(
          { kind: "unavailable" },
          undefined,
        );

        const entries: DocEntry[] = defaultFragments.fragments
          .filter((f): f is DocEntry & { type: "entry" } => f.type === "entry");

        for (const fragment of defaultFragments.fragments) {
          if (fragment.type === "section") {
            entries.push(...fragment.entries);
          }
        }

        if (entries.length > 0) {
          fragments.push({
            type: "section",
            title: "Default options",
            entries,
          });
        }
      }

      return { fragments };
    },
  };
}
