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
 * Options for customizing error messages in the {@link or} parser.
 * @since 0.5.0
 */
export interface OrErrorOptions {
  /**
   * Custom error message when no parser matches.
   */
  noMatch?: Message;

  /**
   * Custom error message for unexpected input.
   * Can be a static message or a function that receives the unexpected token.
   */
  unexpectedInput?: Message | ((token: string) => Message);
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
        return {
          success: false,
          error: options?.errors?.noMatch ??
            message`No matching option or command found.`,
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
          ? (options?.errors?.noMatch ??
            message`No matching option or command found.`)
          : (() => {
            const token = context.buffer[0];
            const defaultMsg = message`Unexpected option or subcommand: ${
              eOptionName(token)
            }.`;
            return options?.errors?.unexpectedInput != null
              ? (typeof options.errors.unexpectedInput === "function"
                ? options.errors.unexpectedInput(token)
                : options.errors.unexpectedInput)
              : defaultMsg;
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
   */
  noMatch?: Message;

  /**
   * Custom error message for unexpected input.
   * Can be a static message or a function that receives the unexpected token.
   */
  unexpectedInput?: Message | ((token: string) => Message);
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
        return {
          success: false,
          error: options?.errors?.noMatch ??
            message`No matching option or command found.`,
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
          ? (options?.errors?.noMatch ??
            message`No matching option or command found.`)
          : (() => {
            const token = context.buffer[0];
            const defaultMsg = message`Unexpected option or subcommand: ${
              eOptionName(token)
            }.`;
            return options?.errors?.unexpectedInput != null
              ? (typeof options.errors.unexpectedInput === "function"
                ? options.errors.unexpectedInput(token)
                : options.errors.unexpectedInput)
              : defaultMsg;
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
          fragments = docResult.fragments;
        } else {
          fragments = parsers.flatMap((p) =>
            p.getDocFragments({ kind: "unavailable" }).fragments
          );
        }
      }

      return { description, fragments };
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
   */
  readonly endOfInput?: Message;
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
  const parserPairs = Object.entries(parsers);
  parserPairs.sort(([_, parserA], [__, parserB]) =>
    parserB.priority - parserA.priority
  );
  return {
    $valueType: [],
    $stateType: [],
    priority: Math.max(...Object.values(parsers).map((p) => p.priority)),
    usage: parserPairs.flatMap(([_, p]) => p.usage),
    initialState: Object.fromEntries(
      Object.entries(parsers).map(([key, parser]) => [
        key,
        parser.initialState,
      ]),
    ) as {
      readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U3)
        ? U3
        : never;
    },
    parse(context) {
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: context.buffer.length > 0
          ? (() => {
            const token = context.buffer[0];
            const customMessage = options.errors?.unexpectedInput;
            return customMessage
              ? (typeof customMessage === "function"
                ? customMessage(token)
                : customMessage)
              : message`Unexpected option or argument: ${token}.`;
          })()
          : (options.errors?.endOfInput ??
            message`Expected an option or argument, but got end of input.`),
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
      for (const field in state) {
        if (!(field in parsers)) continue;
        const valueResult = parsers[field].complete(state[field]);
        if (valueResult.success) result[field] = valueResult.value;
        else return { success: false, error: valueResult.error };
      }
      return { success: true, value: result };
    },
    suggest(context, prefix) {
      const suggestions = [];

      // Try getting suggestions from each parser based on their priority
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
 * Creates a parser that combines multiple parsers into a sequential tuple parser.
 * The parsers are applied in the order they appear in the array, and all must
 * succeed for the tuple parser to succeed.
 * @template T A readonly array type where each element is a {@link Parser}.
 * @param parsers An array of parsers that will be applied sequentially
 *                to create a tuple of their results.
 * @returns A {@link Parser} that produces a readonly tuple with the same length
 *          as the input array, where each element is the result of the
 *          corresponding parser.
 */
export function tuple<
  const T extends readonly Parser<unknown, unknown>[],
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
 * Creates a labeled parser that combines multiple parsers into a sequential
 * tuple parser with an associated label for documentation or error reporting.
 * @template T A readonly array type where each element is a {@link Parser}.
 * @param label A descriptive label for this parser group, used for
 *              documentation and error messages.
 * @param parsers An array of parsers that will be applied sequentially
 *                to create a tuple of their results.
 * @returns A {@link Parser} that produces a readonly tuple with the same length
 *          as the input array, where each element is the result of the
 *          corresponding parser.
 */
export function tuple<
  const T extends readonly Parser<unknown, unknown>[],
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

export function tuple<
  const T extends readonly Parser<unknown, unknown>[],
>(
  labelOrParsers: string | T,
  maybeParsers?: T,
): Parser<
  { readonly [K in keyof T]: unknown },
  { readonly [K in keyof T]: unknown }
> {
  const label: string | undefined = typeof labelOrParsers === "string"
    ? labelOrParsers
    : undefined;
  const parsers = typeof labelOrParsers === "string"
    ? maybeParsers!
    : labelOrParsers;
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
  ...args: [
    string,
    ...Parser<
      Record<string | symbol, unknown>,
      Record<string | symbol, unknown>
    >[],
  ] | Parser<
    Record<string | symbol, unknown>,
    Record<string | symbol, unknown>
  >[]
): Parser<
  Record<string | symbol, unknown>,
  Record<string | symbol, unknown>
> {
  // Check if first argument is a label
  const label = typeof args[0] === "string" ? args[0] : undefined;
  let parsers = typeof args[0] === "string"
    ? args.slice(1) as Parser<
      Record<string | symbol, unknown>,
      Record<string | symbol, unknown>
    >[]
    : args as Parser<
      Record<string | symbol, unknown>,
      Record<string | symbol, unknown>
    >[];

  parsers = parsers.toSorted((a, b) => b.priority - a.priority);
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
      for (let i = 0; i < parsers.length; i++) {
        const parser = parsers[i];
        // Extract the appropriate state for this parser
        let parserState: unknown;
        if (parser.initialState === undefined) {
          // For parsers with undefined initialState, they might still have state in the merged context
          // We need to pass undefined only if no relevant state exists
          parserState = undefined;
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
      const fragments = parsers.flatMap((p) => {
        // If parser has undefined initialState, indicate state unavailable;
        // otherwise pass the available state
        const parserState = p.initialState === undefined
          ? { kind: "unavailable" as const }
          : state.kind === "unavailable"
          ? { kind: "unavailable" as const }
          : { kind: "available" as const, state: state.state };
        return p.getDocFragments(parserState, undefined)
          .fragments;
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
