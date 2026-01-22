/**
 * CLI program metadata and structure definitions.
 *
 * This module provides interfaces for bundling a parser with its metadata
 * (name, version, description, etc.), creating a single source of truth for
 * CLI application information that can be shared across different
 * functionalities like running, help generation, and man page generation.
 *
 * @module
 * @since 0.11.0
 */

import type { Message } from "./message.ts";
import type { Mode, Parser } from "./parser.ts";

/**
 * Metadata for a CLI program.
 *
 * @since 0.11.0
 */
export interface ProgramMetadata {
  /**
   * The name of the program.
   */
  readonly name: string;

  /**
   * The version of the program.
   */
  readonly version?: string;

  /**
   * A brief one-line description of the program.
   */
  readonly brief?: Message;

  /**
   * A detailed description of the program.
   */
  readonly description?: Message;

  /**
   * Author information.
   */
  readonly author?: Message;

  /**
   * Information about where to report bugs.
   */
  readonly bugs?: Message;

  /**
   * Usage examples for the program.
   */
  readonly examples?: Message;

  /**
   * Footer text shown at the end of help output.
   */
  readonly footer?: Message;
}

/**
 * A CLI program consisting of a parser and its metadata.
 *
 * This interface bundles a parser with its metadata (name, version,
 * description, etc.), providing a single source of truth for CLI application
 * information that can be shared across different functionalities.
 *
 * @template M - The mode of the parser ("sync" or "async").
 * @template T - The type of value produced by the parser.
 *
 * @example
 * ```typescript
 * import type { Program } from "@optique/core/program";
 * import { command, option, string } from "@optique/core";
 * import { message } from "@optique/core/message";
 *
 * const prog: Program<"sync", { name: string }> = {
 *   parser: command("greet", () => ({
 *     name: option("name", string()).default("World"),
 *   })),
 *   metadata: {
 *     name: "greet",
 *     version: "1.0.0",
 *     brief: message`A simple greeting CLI tool`,
 *     author: message`Jane Doe <jane@example.com>`,
 *   },
 * };
 * ```
 *
 * @since 0.11.0
 */
export interface Program<M extends Mode, T> {
  /**
   * The parser for the program.
   */
  readonly parser: Parser<M, T, unknown>;

  /**
   * Metadata about the program.
   */
  readonly metadata: ProgramMetadata;
}

/**
 * Defines a CLI program with a parser and metadata.
 *
 * This is a helper function that returns its argument unchanged, but provides
 * automatic type inference for the program. This eliminates the need to
 * manually specify type parameters when defining a program.
 *
 * @template M - The mode of the parser ("sync" or "async").
 * @template T - The type of value produced by the parser.
 * @param program - The program definition with parser and metadata.
 * @returns The same program object with inferred types.
 *
 * @example
 * ```typescript
 * import { defineProgram } from "@optique/core/program";
 * import { object } from "@optique/core/constructs";
 * import { option } from "@optique/core/primitives";
 * import { string } from "@optique/core/valueparser";
 * import { message } from "@optique/core/message";
 *
 * const prog = defineProgram({
 *   parser: object({
 *     name: option("-n", "--name", string()),
 *   }),
 *   metadata: {
 *     name: "myapp",
 *     version: "1.0.0",
 *     brief: message`A simple CLI tool`,
 *   },
 * });
 * // TypeScript automatically infers:
 * // Program<"sync", { readonly name: string }>
 * ```
 *
 * @since 0.11.0
 */
export function defineProgram<M extends Mode, T>(
  program: Program<M, T>,
): Program<M, T> {
  return program;
}
