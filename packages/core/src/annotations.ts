/**
 * Runtime annotations for Optique parsers.
 *
 * This module exposes the supported read-side API for annotations that callers
 * attach through parse options or source contexts.
 *
 * @module
 * @since 0.10.0
 */

export type { Annotations, ParseOptions } from "./internal/annotations.ts";
export { getAnnotations } from "./internal/annotations.ts";
