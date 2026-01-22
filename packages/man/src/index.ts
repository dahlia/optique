/**
 * @optique/man - Man page generator for Optique CLI parsers
 *
 * This package provides functions to generate Unix man pages from
 * Optique's structured parser metadata.
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
 * console.log(manPage);
 * ```
 *
 * @module
 * @since 0.10.0
 */

// Re-export from roff.ts
export { escapeHyphens, escapeRoff, formatMessageAsRoff } from "./roff.ts";

// Re-export from man.ts
export {
  formatDateForMan,
  formatDocPageAsMan,
  formatUsageTermAsRoff,
  type ManPageOptions,
} from "./man.ts";

// Re-export from generator.ts
export {
  generateManPage,
  generateManPageAsync,
  type GenerateManPageOptions,
  generateManPageSync,
} from "./generator.ts";
