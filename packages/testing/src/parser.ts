/**
 * Helpers that exercise a parser without runner or process integration.
 *
 * @module
 * @since 1.3.0
 */
import {
  type DetailedParseResult,
  type InferValue,
  type Mode,
  parseDetailed,
  type ParseOptions,
  type Parser,
} from "@optique/core/parser";

/**
 * The result of parsing a complete argument list in a parser-layer test.
 *
 * @template T The inferred parser value type.
 * @since 1.3.0
 */
export type ParseArgsResult<T> = DetailedParseResult<T>;

/**
 * Parses a complete argument list and always returns a promise.
 *
 * Parser failures are returned as structured values.  Exceptions thrown by a
 * parser, or rejections from an asynchronous parser, reject the returned
 * promise.
 *
 * @template TParser The parser type, including its inferred result value.
 * @param parser The parser to exercise.
 * @param args The complete argument list to parse.
 * @param options Optional parser annotations.
 * @returns A promise resolving to the parsed value or structured failure.
 * @since 1.3.0
 */
export async function parseArgs<
  TParser extends Parser<Mode, unknown, unknown>,
>(
  parser: TParser,
  args: readonly string[],
  options?: ParseOptions,
): Promise<ParseArgsResult<InferValue<TParser>>> {
  return await parseDetailed<TParser["mode"], InferValue<TParser>>(
    parser,
    args,
    options,
  );
}

/**
 * Parses a complete argument list with a synchronous parser.
 *
 * Parser failures are returned as structured values.  Exceptions thrown by a
 * parser propagate to the caller.
 *
 * @template TParser The synchronous parser type, including its inferred result
 *                   value.
 * @param parser The synchronous parser to exercise.
 * @param args The complete argument list to parse.
 * @param options Optional parser annotations.
 * @returns The parsed value or structured failure.
 * @throws {TypeError} When called with an asynchronous parser at runtime.
 * @since 1.3.0
 */
export function parseArgsSync<
  TParser extends Parser<"sync", unknown, unknown>,
>(
  parser: TParser,
  args: readonly string[],
  options?: ParseOptions,
): ParseArgsResult<InferValue<TParser>> {
  if (parser.mode !== "sync") {
    throw new TypeError(
      "Cannot use an async parser with parseArgsSync(). Use parseArgs() instead.",
    );
  }
  return parseDetailed<"sync", InferValue<TParser>>(parser, args, options);
}
