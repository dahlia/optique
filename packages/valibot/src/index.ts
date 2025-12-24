import type {
  NonEmptyString,
  ValueParser,
  ValueParserResult,
} from "@optique/core/valueparser";
import { type Message, message } from "@optique/core/message";
import type * as v from "valibot";
import { safeParse } from "valibot";

/**
 * Options for creating a Valibot value parser.
 * @since 0.7.0
 */
export interface ValibotParserOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `VALUE` or `SCHEMA`.
   * @default `"VALUE"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for Valibot validation failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input fails Valibot validation.
     * Can be a static message or a function that receives the Valibot issues
     * and input string.
     * @since 0.7.0
     */
    valibotError?:
      | Message
      | ((
        issues: v.InferIssue<
          v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>
        >[],
        input: string,
      ) => Message);
  };
}

/**
 * Infers an appropriate metavar string from a Valibot schema.
 *
 * This function analyzes the Valibot schema's internal structure to determine
 * the most appropriate metavar string for help text generation.
 *
 * @param schema A Valibot schema to analyze.
 * @returns The inferred metavar string.
 *
 * @example
 * ```typescript
 * inferMetavar(v.string())           // "STRING"
 * inferMetavar(v.email())            // "EMAIL"
 * inferMetavar(v.number())           // "NUMBER"
 * inferMetavar(v.integer())          // "INTEGER"
 * inferMetavar(v.picklist(["a"]))    // "CHOICE"
 * ```
 *
 * @since 0.7.0
 */
function inferMetavar(
  schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
): NonEmptyString {
  // deno-lint-ignore no-explicit-any
  const schemaType = (schema as any).type;

  if (!schemaType) {
    return "VALUE";
  }

  // 1. Check for string types with specific validations
  if (schemaType === "string") {
    // Check if there are pipeline actions that indicate specific string types
    // deno-lint-ignore no-explicit-any
    const pipeline = (schema as any).pipe;
    if (Array.isArray(pipeline)) {
      for (const action of pipeline) {
        // deno-lint-ignore no-explicit-any
        const actionType = (action as any).type;
        // If there's a transform, return VALUE as the output type may differ
        if (actionType === "transform") return "VALUE";
        if (actionType === "email") return "EMAIL";
        if (actionType === "url") return "URL";
        if (actionType === "uuid") return "UUID";
        if (actionType === "ulid") return "ULID";
        if (actionType === "cuid2") return "CUID2";
        if (actionType === "iso_date") return "DATE";
        if (actionType === "iso_date_time") return "DATETIME";
        if (actionType === "iso_time") return "TIME";
        if (actionType === "iso_timestamp") return "TIMESTAMP";
        if (actionType === "ipv4") return "IPV4";
        if (actionType === "ipv6") return "IPV6";
        if (actionType === "ip") return "IP";
        if (actionType === "emoji") return "EMOJI";
        if (actionType === "base64") return "BASE64";
      }
    }
    return "STRING";
  }

  // 2. Check for number types
  if (schemaType === "number") {
    // Check if there's an integer validation in the pipeline
    // deno-lint-ignore no-explicit-any
    const pipeline = (schema as any).pipe;
    if (Array.isArray(pipeline)) {
      for (const action of pipeline) {
        // deno-lint-ignore no-explicit-any
        const actionType = (action as any).type;
        // If there's a transform, return VALUE as the output type may differ
        if (actionType === "transform") return "VALUE";
        if (actionType === "integer") return "INTEGER";
      }
    }
    return "NUMBER";
  }

  // 3. Check for boolean
  if (schemaType === "boolean") {
    return "BOOLEAN";
  }

  // 4. Check for date
  if (schemaType === "date") {
    return "DATE";
  }

  // 5. Check for picklist (enum equivalent)
  if (schemaType === "picklist") {
    return "CHOICE";
  }

  // 6. Check for literal
  if (schemaType === "literal") {
    return "VALUE";
  }

  // 7. Check for union
  if (schemaType === "union" || schemaType === "variant") {
    return "VALUE";
  }

  // 8. Handle optional/nullable wrappers by unwrapping
  if (
    schemaType === "optional" || schemaType === "nullable" ||
    schemaType === "nullish"
  ) {
    // deno-lint-ignore no-explicit-any
    const wrapped = (schema as any).wrapped;
    if (wrapped) {
      return inferMetavar(wrapped);
    }
  }

  // 9. Fallback for unknown types
  return "VALUE";
}

/**
 * Creates a value parser from a Valibot schema.
 *
 * This parser validates CLI argument strings using Valibot schemas, enabling
 * powerful validation and transformation capabilities with minimal bundle size
 * for command-line interfaces.
 *
 * The metavar is automatically inferred from the schema type unless explicitly
 * provided in options. For example:
 * - `v.string()` → `"STRING"`
 * - `v.pipe(v.string(), v.email())` → `"EMAIL"`
 * - `v.number()` → `"NUMBER"`
 * - `v.pipe(v.number(), v.integer())` → `"INTEGER"`
 * - `v.picklist([...])` → `"CHOICE"`
 *
 * @template T The output type of the Valibot schema.
 * @param schema A Valibot schema to validate input against.
 * @param options Optional configuration for the parser.
 * @returns A value parser that validates inputs using the provided schema.
 *
 * @example Basic string validation
 * ```typescript
 * import * as v from "valibot";
 * import { valibot } from "@optique/valibot";
 * import { option } from "@optique/core/primitives";
 *
 * const email = option("--email", valibot(v.pipe(v.string(), v.email())));
 * ```
 *
 * @example Number validation with pipeline
 * ```typescript
 * import * as v from "valibot";
 * import { valibot } from "@optique/valibot";
 * import { option } from "@optique/core/primitives";
 *
 * // Use v.pipe with v.transform for non-string types since CLI args are always strings
 * const port = option("-p", "--port",
 *   valibot(v.pipe(
 *     v.string(),
 *     v.transform(Number),
 *     v.number(),
 *     v.integer(),
 *     v.minValue(1024),
 *     v.maxValue(65535)
 *   ))
 * );
 * ```
 *
 * @example Picklist validation
 * ```typescript
 * import * as v from "valibot";
 * import { valibot } from "@optique/valibot";
 * import { option } from "@optique/core/primitives";
 *
 * const logLevel = option("--log-level",
 *   valibot(v.picklist(["debug", "info", "warn", "error"]))
 * );
 * ```
 *
 * @example Custom error messages
 * ```typescript
 * import * as v from "valibot";
 * import { valibot } from "@optique/valibot";
 * import { message } from "@optique/core/message";
 * import { option } from "@optique/core/primitives";
 *
 * const email = option("--email",
 *   valibot(v.pipe(v.string(), v.email()), {
 *     metavar: "EMAIL",
 *     errors: {
 *       valibotError: (issues, input) =>
 *         message`Please provide a valid email address, got ${input}.`
 *     }
 *   })
 * );
 * ```
 *
 * @since 0.7.0
 */
export function valibot<T>(
  schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>,
  options: ValibotParserOptions = {},
): ValueParser<T> {
  return {
    metavar: options.metavar ?? inferMetavar(schema),

    parse(input: string): ValueParserResult<T> {
      const result = safeParse(schema, input);

      if (result.success) {
        return { success: true, value: result.output };
      }

      // 1. Custom error message
      if (options.errors?.valibotError) {
        return {
          success: false,
          error: typeof options.errors.valibotError === "function"
            ? options.errors.valibotError(result.issues, input)
            : options.errors.valibotError,
        };
      }

      // 2. Default: use first issue message
      const firstIssue = result.issues[0];
      return {
        success: false,
        error: message`${firstIssue?.message ?? "Validation failed"}`,
      };
    },

    format(value: T): string {
      return String(value);
    },
  };
}
