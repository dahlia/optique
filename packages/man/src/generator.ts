import {
  getDocPageAsync,
  getDocPageSync,
  type Mode,
  type ModeValue,
  type Parser,
} from "@optique/core/parser";
import type { Program } from "@optique/core/program";
import { formatDocPageAsMan, type ManPageOptions } from "./man.ts";

/**
 * Options for generating a man page from a parser.
 * Extends {@link ManPageOptions} with the same configuration.
 * @since 0.10.0
 */
export interface GenerateManPageOptions extends ManPageOptions {}

/**
 * Options for generating a man page from a {@link Program}.
 *
 * This interface omits `name`, `version`, `author`, `bugs`, and `examples`
 * from {@link ManPageOptions} since they are extracted from the program's
 * metadata. You can still override them by providing values in this options
 * object.
 *
 * @since 0.11.0
 */
export interface GenerateManPageProgramOptions
  extends
    Partial<Omit<ManPageOptions, "section">>,
    Pick<ManPageOptions, "section"> {}

/**
 * Checks if the given value is a {@link Program} object.
 */
function isProgram<M extends Mode, T>(
  value: Parser<M, T, unknown> | Program<M, T>,
): value is Program<M, T> {
  return typeof value === "object" && value !== null &&
    "parser" in value && "metadata" in value;
}

/**
 * Extracts parser and merged options from a parser or program.
 */
function extractParserAndOptions<M extends Mode>(
  parserOrProgram: Parser<M, unknown, unknown> | Program<M, unknown>,
  options: GenerateManPageOptions | GenerateManPageProgramOptions,
): { parser: Parser<M, unknown, unknown>; mergedOptions: ManPageOptions } {
  if (isProgram(parserOrProgram)) {
    const { metadata } = parserOrProgram;
    const programOptions = options as GenerateManPageProgramOptions;
    return {
      parser: parserOrProgram.parser,
      mergedOptions: {
        name: programOptions.name ?? metadata.name,
        section: programOptions.section,
        date: programOptions.date,
        version: programOptions.version ?? metadata.version,
        manual: programOptions.manual,
        author: programOptions.author ?? metadata.author,
        bugs: programOptions.bugs ?? metadata.bugs,
        examples: programOptions.examples ?? metadata.examples,
        seeAlso: programOptions.seeAlso,
        environment: programOptions.environment,
        files: programOptions.files,
        exitStatus: programOptions.exitStatus,
      },
    };
  }
  return {
    parser: parserOrProgram,
    mergedOptions: options as ManPageOptions,
  };
}

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
 * @since 0.11.0 Added support for {@link Program} objects.
 */
export function generateManPageSync<T>(
  program: Program<"sync", T>,
  options: GenerateManPageProgramOptions,
): string;
export function generateManPageSync(
  parser: Parser<"sync", unknown, unknown>,
  options: GenerateManPageOptions,
): string;
export function generateManPageSync(
  parserOrProgram: Parser<"sync", unknown, unknown> | Program<"sync", unknown>,
  options: GenerateManPageOptions | GenerateManPageProgramOptions,
): string {
  const { parser, mergedOptions } = extractParserAndOptions(
    parserOrProgram,
    options,
  );
  const docPage = getDocPageSync(parser) ?? { sections: [] };
  return formatDocPageAsMan(docPage, mergedOptions);
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
 * @since 0.11.0 Added support for {@link Program} objects.
 */
export async function generateManPageAsync<M extends Mode, T>(
  program: Program<M, T>,
  options: GenerateManPageProgramOptions,
): Promise<string>;
export async function generateManPageAsync<M extends Mode>(
  parser: Parser<M, unknown, unknown>,
  options: GenerateManPageOptions,
): Promise<string>;
export async function generateManPageAsync<M extends Mode>(
  parserOrProgram: Parser<M, unknown, unknown> | Program<M, unknown>,
  options: GenerateManPageOptions | GenerateManPageProgramOptions,
): Promise<string> {
  const { parser, mergedOptions } = extractParserAndOptions(
    parserOrProgram,
    options,
  );
  const docPage = (await getDocPageAsync(parser)) ?? { sections: [] };
  return formatDocPageAsMan(docPage, mergedOptions);
}

/**
 * Generates a man page from a parser or program.
 *
 * This function extracts documentation from the parser's structure
 * and formats it as a complete man page in roff format.
 *
 * For sync parsers, it returns the man page directly.
 * For async parsers, it returns a Promise that resolves to the man page.
 *
 * @example Parser-based API
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
 * @example Program-based API
 * ```typescript
 * import { generateManPage } from "@optique/man";
 * import { defineProgram } from "@optique/core/program";
 * import { object, flag } from "@optique/core/primitives";
 * import { message } from "@optique/core/message";
 *
 * const prog = defineProgram({
 *   parser: object({
 *     verbose: flag("-v", "--verbose"),
 *   }),
 *   metadata: {
 *     name: "myapp",
 *     version: "1.0.0",
 *     author: message`Hong Minhee`,
 *   },
 * });
 *
 * // Metadata is automatically extracted from the program
 * const manPage = generateManPage(prog, { section: 1 });
 * ```
 *
 * @param parserOrProgram The parser or program to generate documentation from.
 * @param options The man page generation options.
 * @returns The complete man page in roff format, or a Promise for async parsers.
 * @since 0.10.0
 * @since 0.11.0 Added support for {@link Program} objects.
 */
// Overload: Program with sync parser
export function generateManPage<T>(
  program: Program<"sync", T>,
  options: GenerateManPageProgramOptions,
): string;

// Overload: Program with async parser
export function generateManPage<T>(
  program: Program<"async", T>,
  options: GenerateManPageProgramOptions,
): Promise<string>;

// Overload: Sync parser
export function generateManPage(
  parser: Parser<"sync", unknown, unknown>,
  options: GenerateManPageOptions,
): string;

// Overload: Async parser
export function generateManPage(
  parser: Parser<"async", unknown, unknown>,
  options: GenerateManPageOptions,
): Promise<string>;

// Overload: Generic mode parser
export function generateManPage<M extends Mode>(
  parser: Parser<M, unknown, unknown>,
  options: GenerateManPageOptions,
): ModeValue<M, string>;

// Implementation
export function generateManPage(
  parserOrProgram:
    | Parser<Mode, unknown, unknown>
    | Program<Mode, unknown>,
  options: GenerateManPageOptions | GenerateManPageProgramOptions,
): string | Promise<string> {
  const { parser, mergedOptions } = extractParserAndOptions(
    parserOrProgram,
    options,
  );
  if (parser.$mode === "async") {
    return generateManPageAsync(parser, mergedOptions);
  }
  return generateManPageSync(
    parser as Parser<"sync", unknown, unknown>,
    mergedOptions,
  );
}
