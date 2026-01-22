import {
  getDocPageAsync,
  getDocPageSync,
  type Mode,
  type ModeValue,
  type Parser,
} from "@optique/core/parser";
import { formatDocPageAsMan, type ManPageOptions } from "./man.ts";

/**
 * Options for generating a man page from a parser.
 * Extends {@link ManPageOptions} with the same configuration.
 * @since 0.10.0
 */
export interface GenerateManPageOptions extends ManPageOptions {}

/**
 * Generates a man page from a parser synchronously.
 *
 * This function extracts documentation from the parser's structure
 * and formats it as a complete man page in roff format.
 *
 * @example
 * ```typescript
 * import { generateManPageSync } from "@optique/man";
 * import { object, option, flag } from "@optique/core/primitives";
 * import { string } from "@optique/core/valueparser";
 *
 * const parser = object({
 *   verbose: flag("-v", "--verbose"),
 *   config: option("-c", "--config", string()),
 * });
 *
 * const manPage = generateManPageSync(parser, {
 *   name: "myapp",
 *   section: 1,
 *   version: "1.0.0",
 * });
 *
 * console.log(manPage);
 * ```
 *
 * @param parser The parser to generate documentation from.
 * @param options The man page generation options.
 * @returns The complete man page in roff format.
 * @since 0.10.0
 */
export function generateManPageSync(
  parser: Parser<"sync", unknown, unknown>,
  options: GenerateManPageOptions,
): string {
  const docPage = getDocPageSync(parser) ?? { sections: [] };
  return formatDocPageAsMan(docPage, options);
}

/**
 * Generates a man page from a parser asynchronously.
 *
 * This function extracts documentation from the parser's structure
 * and formats it as a complete man page in roff format. It supports
 * both sync and async parsers.
 *
 * @example
 * ```typescript
 * import { generateManPageAsync } from "@optique/man";
 * import { object, option } from "@optique/core/primitives";
 * import { string } from "@optique/core/valueparser";
 *
 * const parser = object({
 *   config: option("-c", "--config", string()),
 * });
 *
 * const manPage = await generateManPageAsync(parser, {
 *   name: "myapp",
 *   section: 1,
 * });
 * ```
 *
 * @param parser The parser to generate documentation from.
 * @param options The man page generation options.
 * @returns A promise that resolves to the complete man page in roff format.
 * @since 0.10.0
 */
export async function generateManPageAsync<M extends Mode>(
  parser: Parser<M, unknown, unknown>,
  options: GenerateManPageOptions,
): Promise<string> {
  const docPage = (await getDocPageAsync(parser)) ?? { sections: [] };
  return formatDocPageAsMan(docPage, options);
}

/**
 * Generates a man page from a parser.
 *
 * This function extracts documentation from the parser's structure
 * and formats it as a complete man page in roff format.
 *
 * For sync parsers, it returns the man page directly.
 * For async parsers, it returns a Promise that resolves to the man page.
 *
 * @example
 * ```typescript
 * import { generateManPage } from "@optique/man";
 * import { object, option, flag } from "@optique/core/primitives";
 * import { string, integer } from "@optique/core/valueparser";
 * import { message } from "@optique/core/message";
 *
 * const parser = object({
 *   verbose: flag("-v", "--verbose", {
 *     description: message`Enable verbose output.`,
 *   }),
 *   port: option("-p", "--port", integer(), {
 *     description: message`Port to listen on.`,
 *   }),
 * }, {
 *   brief: message`A sample CLI application`,
 * });
 *
 * const manPage = generateManPage(parser, {
 *   name: "myapp",
 *   section: 1,
 *   version: "1.0.0",
 *   date: new Date(),
 *   author: message`Hong Minhee`,
 * });
 *
 * // Write to file
 * import { writeFileSync } from "node:fs";
 * writeFileSync("myapp.1", manPage);
 * ```
 *
 * @param parser The parser to generate documentation from.
 * @param options The man page generation options.
 * @returns The complete man page in roff format, or a Promise for async parsers.
 * @since 0.10.0
 */
export function generateManPage(
  parser: Parser<"sync", unknown, unknown>,
  options: GenerateManPageOptions,
): string;
export function generateManPage(
  parser: Parser<"async", unknown, unknown>,
  options: GenerateManPageOptions,
): Promise<string>;
export function generateManPage<M extends Mode>(
  parser: Parser<M, unknown, unknown>,
  options: GenerateManPageOptions,
): ModeValue<M, string>;
export function generateManPage(
  parser: Parser<Mode, unknown, unknown>,
  options: GenerateManPageOptions,
): string | Promise<string> {
  if (parser.$mode === "async") {
    return generateManPageAsync(parser, options);
  }
  return generateManPageSync(
    parser as Parser<"sync", unknown, unknown>,
    options,
  );
}
