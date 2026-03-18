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
 * For Program inputs, `name`, `version`, `author`, `bugs`, `examples`,
 * `brief`, `description`, and `footer` default to values from
 * `program.metadata`.
 * These fields are optional here and may be provided to override metadata.
 *
 * @since 0.10.0
 */
export interface GenerateManPageProgramOptions
  extends
    Partial<Omit<ManPageOptions, "section">>,
    Pick<ManPageOptions, "section"> {}

/**
 * Checks if the given value looks like a {@link Parser} at runtime.
 */
function isParser(
  value: unknown,
): value is Parser<Mode, unknown, unknown> {
  try {
    if (value == null || typeof value !== "object") {
      return false;
    }
    const p = value as Record<string, unknown>;
    return (
      "parse" in p &&
      typeof p.parse === "function" &&
      "complete" in p &&
      typeof p.complete === "function" &&
      "$mode" in p &&
      (p.$mode === "sync" || p.$mode === "async") &&
      "usage" in p &&
      Array.isArray(p.usage) &&
      "initialState" in p &&
      "suggest" in p &&
      typeof p.suggest === "function" &&
      "getDocFragments" in p &&
      typeof p.getDocFragments === "function"
    );
  } catch {
    return false;
  }
}

/**
 * Checks if the given value is a {@link Program} object.
 */
function isProgram<M extends Mode, T>(
  value: Parser<M, T, unknown> | Program<M, T>,
): value is Program<M, T> {
  try {
    return typeof value === "object" && value !== null &&
      "parser" in value && "metadata" in value &&
      typeof value.metadata === "object" && value.metadata !== null &&
      "name" in value.metadata && typeof value.metadata.name === "string";
  } catch {
    return false;
  }
}

/**
 * Validates that the extracted parser is a genuine Optique parser.
 * @throws {TypeError} If the value is not a valid Parser.
 */
function validateParser(value: unknown): asserts value is Parser<
  Mode,
  unknown,
  unknown
> {
  if (!isParser(value)) {
    throw new TypeError(
      "The given value is not a valid Parser or Program.",
    );
  }
}

/**
 * Extracts parser and merged options from a parser or program.
 */
function extractParserAndOptions<M extends Mode>(
  parserOrProgram: Parser<M, unknown, unknown> | Program<M, unknown>,
  options: GenerateManPageOptions | GenerateManPageProgramOptions,
): { parser: Parser<M, unknown, unknown>; mergedOptions: ManPageOptions } {
  if (isProgram(parserOrProgram)) {
    validateParser(parserOrProgram.parser);
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
        brief: programOptions.brief ?? metadata.brief,
        description: programOptions.description ?? metadata.description,
        footer: programOptions.footer ?? metadata.footer,
        seeAlso: programOptions.seeAlso,
        environment: programOptions.environment,
        files: programOptions.files,
        exitStatus: programOptions.exitStatus,
      },
    };
  }
  validateParser(parserOrProgram);
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
 * @param parserOrProgram The parser or program to generate documentation from.
 * @param options The man page generation options.
 * @returns The complete man page in roff format.
 * @throws {TypeError} If the input is not a valid Parser or Program.
 * @since 0.10.0
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
  if ((parser as { readonly $mode: string }).$mode === "async") {
    throw new TypeError(
      "Cannot use an async parser with generateManPageSync(). " +
        "Use generateManPageAsync() or generateManPage() instead.",
    );
  }
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
 * @param parserOrProgram The parser or program to generate documentation from.
 * @param options The man page generation options.
 * @returns A promise that resolves to the complete man page in roff format.
 * @throws {TypeError} If the input is not a valid Parser or Program.
 * @since 0.10.0
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
 * @throws {TypeError} If the input is not a valid Parser or Program.
 * @since 0.10.0
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
