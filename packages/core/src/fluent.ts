/**
 * Fluent parser modifier helpers.
 *
 * This module provides method-style access to parser modifiers without making
 * those methods part of the base {@link Parser} implementation contract.
 *
 * @module
 * @since 1.2.0
 */

import {
  map,
  multiple,
  type MultipleOptions,
  nonEmpty,
  optional,
  withDefault,
  type WithDefaultOptions,
} from "./modifiers.ts";
import type { Mode, Parser } from "./parser.ts";

const fluentParserMarker = Symbol("@optique/core/fluent");

/**
 * Method-style parser modifiers.
 *
 * These methods are a convenience layer over the standalone modifier
 * functions.  They are intentionally separate from {@link Parser} so custom
 * parser authors can keep implementing the smaller base parser contract.
 *
 * @template M The execution mode of the parser.
 * @template TValue The parser result value.
 * @template TState The parser state.
 * @since 1.2.0
 */
export interface ParserModifiers<
  M extends Mode = "sync",
  TValue = unknown,
  TState = unknown,
> {
  /**
   * Transforms the parsed value.
   *
   * @param transform Function that maps the parser value.
   * @returns A parser that produces the mapped value.
   */
  map<U>(transform: (value: TValue) => U): FluentParser<M, U, TState>;

  /**
   * Makes this parser optional.
   *
   * @returns A parser that produces this parser's value or `undefined`.
   */
  optional(): FluentParser<M, TValue | undefined, [TState] | undefined>;

  /**
   * Supplies a default value when this parser does not match.
   *
   * @param defaultValue Value or factory used as the default.
   * @param options Optional default display configuration.
   * @returns A parser that produces this parser's value or the default value.
   */
  withDefault<const TDefault = TValue>(
    defaultValue: TDefault | (() => TDefault),
    options?: WithDefaultOptions,
  ): FluentParser<M, TValue | TDefault, [TState] | undefined>;

  /**
   * Allows this parser to match multiple times.
   *
   * @param options Optional occurrence constraints.
   * @returns A parser that produces all matched values.
   */
  multiple(
    options?: MultipleOptions,
  ): FluentParser<M, readonly TValue[], readonly TState[]>;

  /**
   * Requires this parser to consume at least one token.
   *
   * @returns A parser with the same value and state types.
   */
  nonEmpty(): FluentParser<M, TValue, TState>;
}

/**
 * A parser decorated with method-style modifier helpers.
 *
 * @template M The execution mode of the parser.
 * @template TValue The parser result value.
 * @template TState The parser state.
 * @since 1.2.0
 */
export type FluentParser<
  M extends Mode = "sync",
  TValue = unknown,
  TState = unknown,
> = Parser<M, TValue, TState> & ParserModifiers<M, TValue, TState>;

/**
 * Decorates a parser with fluent modifier methods.
 *
 * The parser object is returned unchanged when it already has fluent methods.
 * Otherwise, the methods are defined as non-enumerable properties so object
 * spread and structural parser cloning continue to copy only parser data.
 *
 * @param parser The parser to decorate.
 * @returns The same parser object with fluent modifier methods.
 * @throws {TypeError} If the parser object is frozen and cannot be decorated.
 * @since 1.2.0
 */
export function fluent<M extends Mode, TValue, TState>(
  parser: Parser<M, TValue, TState>,
): FluentParser<M, TValue, TState> {
  const fluentParser = parser as FluentParser<M, TValue, TState>;
  if (fluentParserMarker in fluentParser) {
    return fluentParser;
  }
  Object.defineProperties(fluentParser, {
    [fluentParserMarker]: {
      value: true,
      configurable: true,
      enumerable: false,
    },
    map: {
      value<U>(transform: (value: TValue) => U) {
        return map(parser, transform);
      },
      configurable: true,
      enumerable: false,
    },
    optional: {
      value() {
        return optional(parser);
      },
      configurable: true,
      enumerable: false,
    },
    withDefault: {
      value<TDefault = TValue>(
        defaultValue: TDefault | (() => TDefault),
        options?: WithDefaultOptions,
      ) {
        return withDefault(parser, defaultValue, options);
      },
      configurable: true,
      enumerable: false,
    },
    multiple: {
      value(options?: MultipleOptions) {
        return multiple(parser, options);
      },
      configurable: true,
      enumerable: false,
    },
    nonEmpty: {
      value() {
        return nonEmpty(parser);
      },
      configurable: true,
      enumerable: false,
    },
  });
  return fluentParser;
}
