import type { DocEntry, DocFragment, DocSection } from "./doc.ts";
import {
  type Message,
  message,
  optionName as eOptionName,
  values,
} from "./message.ts";
import type {
  DocState,
  Parser,
  ParserContext,
  ParserResult,
} from "./parser.ts";
import { createErrorWithSuggestions } from "./suggestion.ts";
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
  parsers: Parser<unknown, unknown>[],
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
 * Creates a parser that combines two mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @returns A {@link Parser} that tries to parse using the provided parsers
 *          in order, returning the result of the first successful parser.
 */
export function or<TA, TB, TStateA, TStateB>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
): Parser<
  TA | TB,
  undefined | [0, ParserResult<TStateA>] | [1, ParserResult<TStateB>]
>;

/**
 * Creates a parser that combines three mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
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
export function or<TA, TB, TC, TStateA, TStateB, TStateC>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
): Parser<
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
export function or<TA, TB, TC, TD, TStateA, TStateB, TStateC, TStateD>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
): Parser<
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
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
): Parser<
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
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
  f: Parser<TF, TStateF>,
): Parser<
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
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
  f: Parser<TF, TStateF>,
  g: Parser<TG, TStateG>,
): Parser<
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
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
  f: Parser<TF, TStateF>,
  g: Parser<TG, TStateG>,
  h: Parser<TH, TStateH>,
): Parser<
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
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
  f: Parser<TF, TStateF>,
  g: Parser<TG, TStateG>,
  h: Parser<TH, TStateH>,
  i: Parser<TI, TStateI>,
): Parser<
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
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
  f: Parser<TF, TStateF>,
  g: Parser<TG, TStateG>,
  h: Parser<TH, TStateH>,
  i: Parser<TI, TStateI>,
  j: Parser<TJ, TStateJ>,
): Parser<
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

export function or(
  ...parsers: Parser<unknown, unknown>[]
): Parser<unknown, undefined | [number, ParserResult<unknown>]>;

/**
 * Creates a parser that tries each parser in sequence until one succeeds,
 * with custom error message options.
 * @param parser1 The first parser to try.
 * @param rest Additional parsers and {@link OrOptions} for error customization.
 * @returns A parser that succeeds if any of the input parsers succeed.
 * @since 0.5.0
 */
export function or(
  parser1: Parser<unknown, unknown>,
  ...rest: [...parsers: Parser<unknown, unknown>[], options: OrOptions]
): Parser<unknown, undefined | [number, ParserResult<unknown>]>;
/**
 * @since 0.5.0
 */
export function or(
  ...args: Array<Parser<unknown, unknown> | OrOptions>
): Parser<unknown, undefined | [number, ParserResult<unknown>]> {
  // Extract parsers and options from arguments
  let parsers: Parser<unknown, unknown>[];
  let options: OrOptions | undefined;

  if (
    args.length > 0 && args[args.length - 1] &&
    typeof args[args.length - 1] === "object" &&
    !("$valueType" in args[args.length - 1])
  ) {
    // Last argument is options
    options = args[args.length - 1] as OrOptions;
    parsers = args.slice(0, -1) as Parser<unknown, unknown>[];
  } else {
    // No options provided
    parsers = args as Parser<unknown, unknown>[];
    options = undefined;
  }

  // Analyze context once for error message generation
  const noMatchContext = analyzeNoMatchContext(parsers);

  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: [{ type: "exclusive", terms: parsers.map((p) => p.usage) }],
    initialState: undefined,
    complete(
      state: undefined | [number, ParserResult<unknown>],
    ): ValueParserResult<unknown> {
      if (state == null) {
        const customNoMatch = options?.errors?.noMatch;
        const error = customNoMatch
          ? (typeof customNoMatch === "function"
            ? customNoMatch(noMatchContext)
            : customNoMatch)
          : generateNoMatchError(noMatchContext);
        return {
          success: false,
          error,
        };
      }
      const [i, result] = state;
      if (result.success) return parsers[i].complete(result.next.state);
      return { success: false, error: result.error };
    },
    parse(
      context: ParserContext<[number, ParserResult<unknown>]>,
    ): ParserResult<[number, ParserResult<unknown>]> {
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: context.buffer.length < 1
          ? (() => {
            const customNoMatch = options?.errors?.noMatch;
            return customNoMatch
              ? (typeof customNoMatch === "function"
                ? customNoMatch(noMatchContext)
                : customNoMatch)
              : generateNoMatchError(noMatchContext);
          })()
          : (() => {
            const token = context.buffer[0];
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
              context.usage,
              "both",
              options?.errors?.suggestions,
            );
          })(),
      };
      const orderedParsers = parsers.map((p, i) =>
        [p, i] as [Parser<unknown, unknown>, number]
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
            return {
              success: false,
              consumed: context.buffer.length - result.next.buffer.length,
              error: message`${values(context.state[1].consumed)} and ${
                values(result.consumed)
              } cannot be used together.`,
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
    },
    suggest(context, prefix) {
      const suggestions = [];

      if (context.state == null) {
        // No parser has been selected yet, get suggestions from all parsers
        for (const parser of parsers) {
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
          const parserSuggestions = parsers[index].suggest({
            ...context,
            state: parserResult.next.state,
          }, prefix);
          suggestions.push(...parserSuggestions);
        }
      }

      // Remove duplicates by text/pattern
      const seen = new Set<string>();
      return suggestions.filter((suggestion) => {
        const key = suggestion.kind === "literal"
          ? suggestion.text
          : `__FILE__:${suggestion.type}:${
            suggestion.extensions?.join(",")
          }:${suggestion.pattern}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    },
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
export function longestMatch<TA, TB, TStateA, TStateB>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
): Parser<
  TA | TB,
  undefined | [0, ParserResult<TStateA>] | [1, ParserResult<TStateB>]
>;

/**
 * Creates a parser that combines three mutually exclusive parsers into one,
 * selecting the parser that consumes the most tokens.
 * The resulting parser will try all parsers and return the result
 * of the parser that consumed the most input tokens.
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
export function longestMatch<TA, TB, TC, TStateA, TStateB, TStateC>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
): Parser<
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
  TA,
  TB,
  TC,
  TD,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
): Parser<
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
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
): Parser<
  TA | TB | TC | TD | TE,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
>;

export function longestMatch(
  ...parsers: Parser<unknown, unknown>[]
): Parser<unknown, undefined | [number, ParserResult<unknown>]>;

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
  parser1: Parser<unknown, unknown>,
  ...rest: [
    ...parsers: Parser<unknown, unknown>[],
    options: LongestMatchOptions,
  ]
): Parser<unknown, undefined | [number, ParserResult<unknown>]>;
/**
 * @since 0.5.0
 */
export function longestMatch(
  ...args: Array<Parser<unknown, unknown> | LongestMatchOptions>
): Parser<unknown, undefined | [number, ParserResult<unknown>]> {
  // Extract parsers and options from arguments
  let parsers: Parser<unknown, unknown>[];
  let options: LongestMatchOptions | undefined;

  if (
    args.length > 0 && args[args.length - 1] &&
    typeof args[args.length - 1] === "object" &&
    !("$valueType" in args[args.length - 1])
  ) {
    // Last argument is options
    options = args[args.length - 1] as LongestMatchOptions;
    parsers = args.slice(0, -1) as Parser<unknown, unknown>[];
  } else {
    // No options provided
    parsers = args as Parser<unknown, unknown>[];
    options = undefined;
  }

  // Analyze context once for error message generation
  const noMatchContext = analyzeNoMatchContext(parsers);

  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: [{ type: "exclusive", terms: parsers.map((p) => p.usage) }],
    initialState: undefined,
    complete(
      state: undefined | [number, ParserResult<unknown>],
    ): ValueParserResult<unknown> {
      if (state == null) {
        const customNoMatch = options?.errors?.noMatch;
        const error = customNoMatch
          ? (typeof customNoMatch === "function"
            ? customNoMatch(noMatchContext)
            : customNoMatch)
          : generateNoMatchError(noMatchContext);
        return {
          success: false,
          error,
        };
      }
      const [i, result] = state;
      if (result.success) return parsers[i].complete(result.next.state);
      return { success: false, error: result.error };
    },
    parse(
      context: ParserContext<[number, ParserResult<unknown>]>,
    ): ParserResult<[number, ParserResult<unknown>]> {
      let bestMatch: {
        index: number;
        result: ParserResult<unknown>;
        consumed: number;
      } | null = null;
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: context.buffer.length < 1
          ? (() => {
            const customNoMatch = options?.errors?.noMatch;
            return customNoMatch
              ? (typeof customNoMatch === "function"
                ? customNoMatch(noMatchContext)
                : customNoMatch)
              : generateNoMatchError(noMatchContext);
          })()
          : (() => {
            const token = context.buffer[0];
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
              context.usage,
              "both",
              options?.errors?.suggestions,
            );
          })(),
      };

      // Try all parsers and find the one with longest match
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
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
    },
    suggest(context, prefix) {
      const suggestions = [];

      if (context.state == null) {
        // No parser has been selected yet, get suggestions from all parsers
        for (const parser of parsers) {
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
          const parserSuggestions = parsers[index].suggest({
            ...context,
            state: parserResult.next.state,
          }, prefix);
          suggestions.push(...parserSuggestions);
        }
      }

      // Remove duplicates by text/pattern
      const seen = new Set<string>();
      return suggestions.filter((suggestion) => {
        const key = suggestion.kind === "literal"
          ? suggestion.text
          : `__FILE__:${suggestion.type}:${
            suggestion.extensions?.join(",")
          }:${suggestion.pattern}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    },
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
  T extends { readonly [key: string | symbol]: Parser<unknown, unknown> },
>(
  parsers: T,
): Parser<
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
  T extends { readonly [key: string | symbol]: Parser<unknown, unknown> },
>(
  parsers: T,
  options: ObjectOptions,
): Parser<
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
  T extends { readonly [key: string | symbol]: Parser<unknown, unknown> },
>(
  label: string,
  parsers: T,
): Parser<
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
  T extends { readonly [key: string | symbol]: Parser<unknown, unknown> },
>(
  label: string,
  parsers: T,
  options: ObjectOptions,
): Parser<
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
  T extends { readonly [key: string | symbol]: Parser<unknown, unknown> },
>(
  labelOrParsers: string | T,
  maybeParsersOrOptions?: T | ObjectOptions,
  maybeOptions?: ObjectOptions,
): Parser<
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
  const parserPairs = parserKeys.map((k) => [k, parsers[k]] as const);
  parserPairs.sort(([_, parserA], [__, parserB]) =>
    parserB.priority - parserA.priority
  );
  const initialState: Record<string | symbol, unknown> = {};
  for (const key of parserKeys) {
    initialState[key as string | symbol] = parsers[key].initialState;
  }

  // Analyze context once for error message generation
  const noMatchContext = analyzeNoMatchContext(
    parserKeys.map((k) => parsers[k]),
  );
  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parserKeys.map((k) => parsers[k].priority)),
    usage: parserPairs.flatMap(([_, p]) => p.usage),
    initialState: initialState as {
      readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U3)
        ? U3
        : never;
    },
    parse(context) {
      // Check for duplicate option names unless explicitly allowed
      if (!options.allowDuplicates) {
        const optionNameSources = new Map<string, (string | symbol)[]>();

        for (const [field, parser] of parserPairs) {
          const names = extractOptionNames(parser.usage);
          for (const name of names) {
            if (!optionNameSources.has(name)) {
              optionNameSources.set(name, []);
            }
            optionNameSources.get(name)!.push(field as string | symbol);
          }
        }

        // Check for duplicates
        for (const [name, sources] of optionNameSources) {
          if (sources.length > 1) {
            return {
              success: false,
              consumed: 0,
              error: message`Duplicate option name ${
                eOptionName(
                  name,
                )
              } found in fields: ${
                values(
                  sources.map((s) =>
                    typeof s === "symbol" ? s.description ?? s.toString() : s
                  ),
                )
              }. Each option name must be unique within a parser combinator.`,
            };
          }
        }
      }

      let error: { consumed: number; error: Message } = {
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
      };

      // Try greedy parsing: attempt to consume as many fields as possible
      let currentContext = context;
      let anySuccess = false;
      const allConsumed: string[] = [];

      // Keep trying to parse fields until no more can be matched
      let madeProgress = true;
      while (madeProgress && currentContext.buffer.length > 0) {
        madeProgress = false;

        for (const [field, parser] of parserPairs) {
          const result = parser.parse({
            ...currentContext,
            state: (currentContext.state &&
                typeof currentContext.state === "object" &&
                field in currentContext.state)
              ? currentContext.state[field]
              : parser.initialState,
          });

          if (result.success && result.consumed.length > 0) {
            currentContext = {
              ...currentContext,
              buffer: result.next.buffer,
              optionsTerminated: result.next.optionsTerminated,
              state: {
                ...currentContext.state,
                [field]: result.next.state,
              },
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
              ? context.state[field]
              : parser.initialState;
          const completeResult = parser.complete(fieldState);
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
    },
    complete(state) {
      const result: { [K in keyof T]: T[K]["$valueType"][number] } =
        // deno-lint-ignore no-explicit-any
        {} as any;
      for (const field of parserKeys) {
        const valueResult = parsers[field].complete(
          (state as Record<string | symbol, unknown>)[field as string | symbol],
        );
        if (valueResult.success) {
          (result as Record<string | symbol, unknown>)[
            field as string | symbol
          ] = valueResult.value;
        } else return { success: false, error: valueResult.error };
      }
      return { success: true, value: result };
    },
    suggest(context, prefix) {
      const suggestions = [];

      // Check if the last token in the buffer is an option that requires a value.
      // If so, only suggest values for that specific option parser, not all parsers.
      // This prevents positional argument suggestions from appearing when completing
      // an option value.
      // See: https://github.com/dahlia/optique/issues/55
      if (context.buffer.length > 0) {
        const lastToken = context.buffer[context.buffer.length - 1];

        // Find if any parser has this token as an option requiring a value
        for (const [field, parser] of parserPairs) {
          if (isOptionRequiringValue(parser.usage, lastToken)) {
            // Only get suggestions from the parser that owns this option
            const fieldState =
              (context.state && typeof context.state === "object" &&
                  field in context.state)
                ? context.state[field]
                : parser.initialState;

            return Array.from(parser.suggest({
              ...context,
              state: fieldState,
            }, prefix));
          }
        }
      }

      // Default behavior: try getting suggestions from each parser
      for (const [field, parser] of parserPairs) {
        const fieldState =
          (context.state && typeof context.state === "object" &&
              field in context.state)
            ? context.state[field]
            : parser.initialState;

        const fieldSuggestions = parser.suggest({
          ...context,
          state: fieldState,
        }, prefix);

        suggestions.push(...fieldSuggestions);
      }

      // Remove duplicates by text/pattern
      const seen = new Set<string>();
      return suggestions.filter((suggestion) => {
        const key = suggestion.kind === "literal"
          ? suggestion.text
          : `__FILE__:${suggestion.type}:${
            suggestion.extensions?.join(",")
          }:${suggestion.pattern}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    },
    getDocFragments(
      state: DocState<{ readonly [K in keyof T]: unknown }>,
      defaultValue?,
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
  };
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
  const T extends readonly Parser<unknown, unknown>[],
>(
  parsers: T,
  options?: TupleOptions,
): Parser<
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
  const T extends readonly Parser<unknown, unknown>[],
>(
  label: string,
  parsers: T,
  options?: TupleOptions,
): Parser<
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
  const T extends readonly Parser<unknown, unknown>[],
>(
  labelOrParsers: string | T,
  maybeParsersOrOptions?: T | TupleOptions,
  maybeOptions?: TupleOptions,
): Parser<
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
  return {
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
    parse(context) {
      // Check for duplicate option names unless explicitly allowed
      if (!options.allowDuplicates) {
        const optionNameSources = new Map<string, number[]>();

        for (let i = 0; i < parsers.length; i++) {
          const names = extractOptionNames(parsers[i].usage);
          for (const name of names) {
            if (!optionNameSources.has(name)) {
              optionNameSources.set(name, []);
            }
            optionNameSources.get(name)!.push(i);
          }
        }

        // Check for duplicates
        for (const [name, indices] of optionNameSources) {
          if (indices.length > 1) {
            return {
              success: false,
              consumed: 0,
              error: message`Duplicate option name ${
                eOptionName(
                  name,
                )
              } found at positions: ${
                values(indices.map(String))
              }. Each option name must be unique within a parser combinator.`,
            };
          }
        }
      }

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

        // Create priority-ordered list of remaining parsers
        const remainingParsers = parsers
          .map((parser, index) => [parser, index] as [typeof parser, number])
          .filter(([_, index]) => !matchedParsers.has(index))
          .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

        for (const [parser, index] of remainingParsers) {
          const result = parser.parse({
            ...currentContext,
            state: currentContext.state[index],
          });

          if (result.success && result.consumed.length > 0) {
            // Parser succeeded and consumed input - take this match
            currentContext = {
              ...currentContext,
              buffer: result.next.buffer,
              optionsTerminated: result.next.optionsTerminated,
              state: currentContext.state.map((s, idx) =>
                idx === index ? result.next.state : s
              ) as {
                readonly [K in keyof T]: T[K]["$stateType"][number] extends (
                  infer U4
                ) ? U4
                  : never;
              },
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
              state: currentContext.state[index],
            });

            if (result.success && result.consumed.length < 1) {
              // Parser succeeded without consuming input (like optional)
              currentContext = {
                ...currentContext,
                state: currentContext.state.map((s, idx) =>
                  idx === index ? result.next.state : s
                ) as {
                  readonly [K in keyof T]: T[K]["$stateType"][number] extends (
                    infer U5
                  ) ? U5
                    : never;
                },
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
    },
    complete(state) {
      const result: { [K in keyof T]: T[K]["$valueType"][number] } =
        // deno-lint-ignore no-explicit-any
        [] as any;

      for (let i = 0; i < parsers.length; i++) {
        const valueResult = parsers[i].complete(state[i]);
        if (valueResult.success) {
          // deno-lint-ignore no-explicit-any
          (result as any)[i] = valueResult.value;
        } else {
          return { success: false, error: valueResult.error };
        }
      }

      return { success: true, value: result };
    },
    suggest(context, prefix) {
      const suggestions = [];

      // For tuple parser, try each parser in sequence until one matches
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        const parserState = context.state && Array.isArray(context.state)
          ? context.state[i]
          : parser.initialState;

        const parserSuggestions = parser.suggest({
          ...context,
          state: parserState,
        }, prefix);

        suggestions.push(...parserSuggestions);
      }

      // Remove duplicates by text/pattern
      const seen = new Set<string>();
      return suggestions.filter((suggestion) => {
        const key = suggestion.kind === "literal"
          ? suggestion.text
          : `__FILE__:${suggestion.type}:${
            suggestion.extensions?.join(",")
          }:${suggestion.pattern}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    },
    getDocFragments(
      state: DocState<{ readonly [K in keyof T]: unknown }>,
      defaultValue?,
    ) {
      const fragments = parsers.flatMap((p, i) => {
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
  } satisfies Parser<
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
type ExtractObjectTypes<P> = P extends Parser<infer V, unknown>
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
): Parser<
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
  options: MergeOptions,
): Parser<
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
>(
  label: string,
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
): Parser<
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
  c: ExtractObjectTypes<TC> extends never ? never : TC,
): Parser<
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
>(
  label: string,
  a: TA,
  b: TB,
  c: TC,
): ExtractObjectTypes<TA> extends never ? never
  : ExtractObjectTypes<TB> extends never ? never
  : ExtractObjectTypes<TC> extends never ? never
  : Parser<
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
>(
  a: ExtractObjectTypes<TA> extends never ? never : TA,
  b: ExtractObjectTypes<TB> extends never ? never : TB,
  c: ExtractObjectTypes<TC> extends never ? never : TC,
  d: ExtractObjectTypes<TD> extends never ? never : TD,
  e: ExtractObjectTypes<TE> extends never ? never : TE,
): Parser<
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
  TI extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
  TI extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
  TI extends Parser<unknown, unknown>,
  TJ extends Parser<unknown, unknown>,
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
  TA extends Parser<unknown, unknown>,
  TB extends Parser<unknown, unknown>,
  TC extends Parser<unknown, unknown>,
  TD extends Parser<unknown, unknown>,
  TE extends Parser<unknown, unknown>,
  TF extends Parser<unknown, unknown>,
  TG extends Parser<unknown, unknown>,
  TH extends Parser<unknown, unknown>,
  TI extends Parser<unknown, unknown>,
  TJ extends Parser<unknown, unknown>,
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
        Record<string | symbol, unknown>,
        Record<string | symbol, unknown>
      >[],
    ]
    | Parser<
      Record<string | symbol, unknown>,
      Record<string | symbol, unknown>
    >[]
    | [
      ...Parser<
        Record<string | symbol, unknown>,
        Record<string | symbol, unknown>
      >[],
      MergeOptions,
    ]
): Parser<
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
    Record<string | symbol, unknown>,
    Record<string | symbol, unknown>
  >[];

  // Keep track of original indices before sorting
  const withIndex = rawParsers.map((p, i) => [p, i] as const);
  const sorted = withIndex.toSorted(([a], [b]) => b.priority - a.priority);
  const parsers = sorted.map(([p]) => p);

  const initialState: Record<string | symbol, unknown> = {};
  for (const parser of parsers) {
    if (parser.initialState && typeof parser.initialState === "object") {
      for (const field in parser.initialState) {
        initialState[field] = parser.initialState[field];
      }
    }
  }
  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: parsers.flatMap((p) => p.usage),
    initialState,
    parse(context) {
      // Check for duplicate option names unless explicitly allowed
      if (!options.allowDuplicates) {
        const optionNameSources = new Map<string, number[]>();

        for (const [parser, originalIndex] of sorted) {
          const names = extractOptionNames(parser.usage);
          for (const name of names) {
            if (!optionNameSources.has(name)) {
              optionNameSources.set(name, []);
            }
            optionNameSources.get(name)!.push(originalIndex);
          }
        }

        // Check for duplicates
        for (const [name, indices] of optionNameSources) {
          if (indices.length > 1) {
            return {
              success: false,
              consumed: 0,
              error: message`Duplicate option name ${
                eOptionName(
                  name,
                )
              } found in merged parsers at positions: ${
                values(indices.map(String))
              }. Each option name must be unique within a parser combinator.`,
            };
          }
        }
      }

      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        // Extract the appropriate state for this parser
        let parserState: unknown;
        if (parser.initialState === undefined) {
          // For parsers with undefined initialState (like or()),
          // check if they have accumulated state during parsing
          const key = `__parser_${i}`;
          if (
            context.state && typeof context.state === "object" &&
            key in context.state
          ) {
            parserState = context.state[key];
          } else {
            parserState = undefined;
          }
        } else if (
          parser.initialState && typeof parser.initialState === "object"
        ) {
          // For object parsers, extract matching fields from context state
          if (context.state && typeof context.state === "object") {
            const extractedState: Record<string | symbol, unknown> = {};
            for (const field in parser.initialState) {
              extractedState[field] = field in context.state
                ? context.state[field]
                : parser.initialState[field];
            }
            parserState = extractedState;
          } else {
            parserState = parser.initialState;
          }
        } else {
          parserState = parser.initialState;
        }

        const result = parser.parse({
          ...context,
          state: parserState as Parameters<typeof parser.parse>[0]["state"],
        });
        if (result.success) {
          // Handle state merging based on parser type
          let newState: Record<string | symbol, unknown>;
          if (parser.initialState === undefined) {
            // For parsers with undefined initialState (like withDefault()),
            // store their state separately to avoid conflicts with object merging
            newState = {
              ...context.state,
              [`__parser_${i}`]: result.next.state,
            };
          } else {
            // For regular object parsers, use the original merging approach
            newState = {
              ...context.state,
              ...result.next.state,
            };
          }

          return {
            success: true,
            next: {
              ...context,
              buffer: result.next.buffer,
              optionsTerminated: result.next.optionsTerminated,
              state: newState,
            },
            consumed: result.consumed,
          };
        } else if (result.consumed < 1) continue;
        else return result;
      }
      return {
        success: false,
        consumed: 0,
        error: message`No matching option or argument found.`,
      };
    },
    complete(state) {
      const object: Record<string | symbol, unknown> = {};
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        // Each parser should get its appropriate state for completion
        let parserState: unknown;
        if (parser.initialState === undefined) {
          // For parsers with undefined initialState (like withDefault()),
          // check if they have accumulated state during parsing
          const key = `__parser_${i}`;
          if (state && typeof state === "object" && key in state) {
            parserState = state[key];
          } else {
            parserState = undefined;
          }
        } else if (
          parser.initialState && typeof parser.initialState === "object"
        ) {
          // For object() parsers, extract their portion of the state
          if (state && typeof state === "object") {
            const extractedState: Record<string | symbol, unknown> = {};
            for (const field in parser.initialState) {
              extractedState[field] = field in state
                ? state[field]
                : parser.initialState[field];
            }
            parserState = extractedState;
          } else {
            parserState = parser.initialState;
          }
        } else {
          parserState = parser.initialState;
        }

        // Type assertion is safe here because we're matching each parser with its expected state type
        const result = parser.complete(
          parserState as Parameters<typeof parser.complete>[0],
        );
        if (!result.success) return result;
        for (const field in result.value) object[field] = result.value[field];
      }
      return { success: true, value: object };
    },
    suggest(context, prefix) {
      const suggestions = [];

      // For merge parser, get suggestions from all parsers
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        let parserState: unknown;

        if (parser.initialState === undefined) {
          const key = `__parser_${i}`;
          if (
            context.state && typeof context.state === "object" &&
            key in context.state
          ) {
            parserState = context.state[key];
          } else {
            parserState = undefined;
          }
        } else if (
          parser.initialState && typeof parser.initialState === "object"
        ) {
          if (context.state && typeof context.state === "object") {
            const extractedState: Record<string | symbol, unknown> = {};
            for (const field in parser.initialState) {
              extractedState[field] = field in context.state
                ? context.state[field]
                : parser.initialState[field];
            }
            parserState = extractedState;
          } else {
            parserState = parser.initialState;
          }
        } else {
          parserState = parser.initialState;
        }

        const parserSuggestions = parser.suggest({
          ...context,
          state: parserState as Parameters<typeof parser.suggest>[0]["state"],
        }, prefix);

        suggestions.push(...parserSuggestions);
      }

      // Remove duplicates by text/pattern
      const seen = new Set<string>();
      return suggestions.filter((suggestion) => {
        const key = suggestion.kind === "literal"
          ? suggestion.text
          : `__FILE__:${suggestion.type}:${
            suggestion.extensions?.join(",")
          }:${suggestion.pattern}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
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
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TStateA,
  TStateB,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
): Parser<[...TA, ...TB], [TStateA, TStateB]>;

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
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TC extends readonly unknown[],
  TStateA,
  TStateB,
  TStateC,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
): Parser<[...TA, ...TB, ...TC], [TStateA, TStateB, TStateC]>;

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
  TA extends readonly unknown[],
  TB extends readonly unknown[],
  TC extends readonly unknown[],
  TD extends readonly unknown[],
  TStateA,
  TStateB,
  TStateC,
  TStateD,
>(
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
): Parser<[...TA, ...TB, ...TC, ...TD], [TStateA, TStateB, TStateC, TStateD]>;

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
  a: Parser<TA, TStateA>,
  b: Parser<TB, TStateB>,
  c: Parser<TC, TStateC>,
  d: Parser<TD, TStateD>,
  e: Parser<TE, TStateE>,
): Parser<
  [...TA, ...TB, ...TC, ...TD, ...TE],
  [TStateA, TStateB, TStateC, TStateD, TStateE]
>;

export function concat(
  ...parsers: Parser<readonly unknown[], unknown>[]
): Parser<readonly unknown[], readonly unknown[]> {
  const initialState = parsers.map((parser) => parser.initialState);
  return {
    $valueType: [],
    $stateType: [],
    priority: parsers.length > 0
      ? Math.max(...parsers.map((p) => p.priority))
      : 0,
    usage: parsers.flatMap((p) => p.usage),
    initialState,
    parse(context) {
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

        // Create priority-ordered list of remaining parsers
        const remainingParsers = parsers
          .map((parser, index) => [parser, index] as [typeof parser, number])
          .filter(([_, index]) => !matchedParsers.has(index))
          .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

        for (const [parser, index] of remainingParsers) {
          const result = parser.parse({
            ...currentContext,
            state: currentContext.state[index],
          });

          if (result.success && result.consumed.length > 0) {
            // Parser succeeded and consumed input - take this match
            currentContext = {
              ...currentContext,
              buffer: result.next.buffer,
              optionsTerminated: result.next.optionsTerminated,
              state: currentContext.state.map((s, idx) =>
                idx === index ? result.next.state : s
              ),
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
              state: currentContext.state[index],
            });

            if (result.success && result.consumed.length < 1) {
              // Parser succeeded without consuming input (like optional)
              currentContext = {
                ...currentContext,
                state: currentContext.state.map((s, idx) =>
                  idx === index ? result.next.state : s
                ),
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
    },
    complete(state) {
      const results: unknown[] = [];
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        const parserState = state[i];
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
    },
    suggest(context, prefix) {
      const suggestions = [];

      // For concat parser, get suggestions from all parsers
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        const parserState = context.state && Array.isArray(context.state)
          ? context.state[i]
          : parser.initialState;

        const parserSuggestions = parser.suggest({
          ...context,
          state: parserState,
        }, prefix);

        suggestions.push(...parserSuggestions);
      }

      // Remove duplicates by text/pattern
      const seen = new Set<string>();
      return suggestions.filter((suggestion) => {
        const key = suggestion.kind === "literal"
          ? suggestion.text
          : `__FILE__:${suggestion.type}:${
            suggestion.extensions?.join(",")
          }:${suggestion.pattern}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    },
    getDocFragments(state: DocState<readonly unknown[]>, _defaultValue?) {
      const fragments = parsers.flatMap((p, index) => {
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
export function group<TValue, TState>(
  label: string,
  parser: Parser<TValue, TState>,
): Parser<TValue, TState> {
  return {
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
