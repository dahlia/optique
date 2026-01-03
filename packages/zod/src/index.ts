import type {
  NonEmptyString,
  ValueParser,
  ValueParserResult,
} from "@optique/core/valueparser";
import { type Message, message } from "@optique/core/message";
import type { z } from "zod";

/**
 * Options for creating a Zod value parser.
 * @since 0.7.0
 */
export interface ZodParserOptions {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `VALUE` or `SCHEMA`.
   * @default `"VALUE"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for Zod validation failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input fails Zod validation.
     * Can be a static message or a function that receives the Zod error
     * and input string.
     * @since 0.7.0
     */
    zodError?: Message | ((error: z.ZodError, input: string) => Message);
  };
}

/**
 * Infers an appropriate metavar string from a Zod schema.
 *
 * This function analyzes the Zod schema's internal structure to determine
 * the most appropriate metavar string for help text generation.
 *
 * @param schema A Zod schema to analyze.
 * @returns The inferred metavar string.
 *
 * @example
 * ```typescript
 * inferMetavar(z.string())              // "STRING"
 * inferMetavar(z.string().email())      // "EMAIL"
 * inferMetavar(z.coerce.number())       // "NUMBER"
 * inferMetavar(z.coerce.number().int()) // "INTEGER"
 * inferMetavar(z.enum(["a", "b"]))      // "CHOICE"
 * ```
 *
 * @since 0.7.0
 */
function inferMetavar(schema: z.Schema<unknown>): NonEmptyString {
  // deno-lint-ignore no-explicit-any
  const def = (schema as any)._def;

  if (!def) {
    return "VALUE";
  }

  // Get type name from either typeName property (Zod v4) or def.type (Zod v3)
  const typeName = def.typeName || def.type;

  // 1. Check for string refinements first (highest priority)
  if (typeName === "ZodString" || typeName === "string") {
    if (Array.isArray(def.checks)) {
      for (const check of def.checks) {
        // Zod v4 uses check.kind, v3 uses check.format
        const kind = check.kind || check.format;

        if (kind === "email") return "EMAIL";
        if (kind === "url") return "URL";
        if (kind === "uuid") return "UUID";
        if (kind === "datetime") return "DATETIME";
        if (kind === "date") return "DATE";
        if (kind === "time") return "TIME";
        if (kind === "duration") return "DURATION";
        if (kind === "ip") {
          return check.version === "v4"
            ? "IPV4"
            : check.version === "v6"
            ? "IPV6"
            : "IP";
        }
        if (kind === "jwt") return "JWT";
        if (kind === "emoji") return "EMOJI";
        if (kind === "cuid") return "CUID";
        if (kind === "cuid2") return "CUID2";
        if (kind === "ulid") return "ULID";
        if (kind === "base64") return "BASE64";
      }
    }
    return "STRING";
  }

  // 2. Check for number types
  if (typeName === "ZodNumber" || typeName === "number") {
    // Check if it's an integer by looking at checks
    if (Array.isArray(def.checks)) {
      for (const check of def.checks) {
        // Zod v4 uses check.kind === "int"
        // Zod v3 uses check.isInt === true or check.format === "safeint"
        if (
          check.kind === "int" || check.isInt === true ||
          check.format === "safeint"
        ) {
          return "INTEGER";
        }
      }
    }
    return "NUMBER";
  }

  // 3. Check for boolean
  if (typeName === "ZodBoolean" || typeName === "boolean") {
    return "BOOLEAN";
  }

  // 4. Check for date
  if (typeName === "ZodDate" || typeName === "date") {
    return "DATE";
  }

  // 5. Check for enum
  if (
    typeName === "ZodEnum" || typeName === "enum" ||
    typeName === "ZodNativeEnum" || typeName === "nativeEnum"
  ) {
    return "CHOICE";
  }

  // 6. Check for union or literal
  if (
    typeName === "ZodUnion" || typeName === "union" ||
    typeName === "ZodLiteral" || typeName === "literal"
  ) {
    return "VALUE";
  }

  // 7. Handle optional/nullable wrappers by unwrapping
  if (
    typeName === "ZodOptional" || typeName === "optional" ||
    typeName === "ZodNullable" || typeName === "nullable"
  ) {
    return inferMetavar(def.innerType);
  }

  // 8. Handle default wrapper by unwrapping
  if (typeName === "ZodDefault" || typeName === "default") {
    return inferMetavar(def.innerType);
  }

  // 9. Fallback for unknown types
  return "VALUE";
}

/**
 * Creates a value parser from a Zod schema.
 *
 * This parser validates CLI argument strings using Zod schemas, enabling
 * powerful validation and transformation capabilities for command-line
 * interfaces.
 *
 * The metavar is automatically inferred from the schema type unless explicitly
 * provided in options. For example:
 * - `z.string()` → `"STRING"`
 * - `z.string().email()` → `"EMAIL"`
 * - `z.coerce.number()` → `"NUMBER"`
 * - `z.coerce.number().int()` → `"INTEGER"`
 * - `z.enum([...])` → `"CHOICE"`
 *
 * @template T The output type of the Zod schema.
 * @param schema A Zod schema to validate input against.
 * @param options Optional configuration for the parser.
 * @returns A value parser that validates inputs using the provided schema.
 *
 * @example Basic string validation
 * ```typescript
 * import { z } from "zod";
 * import { zod } from "@optique/zod";
 * import { option } from "@optique/core/primitives";
 *
 * const email = option("--email", zod(z.string().email()));
 * ```
 *
 * @example Number validation with coercion
 * ```typescript
 * import { z } from "zod";
 * import { zod } from "@optique/zod";
 * import { option } from "@optique/core/primitives";
 *
 * // Use z.coerce for non-string types since CLI args are always strings
 * const port = option("-p", "--port",
 *   zod(z.coerce.number().int().min(1024).max(65535))
 * );
 * ```
 *
 * @example Enum validation
 * ```typescript
 * import { z } from "zod";
 * import { zod } from "@optique/zod";
 * import { option } from "@optique/core/primitives";
 *
 * const logLevel = option("--log-level",
 *   zod(z.enum(["debug", "info", "warn", "error"]))
 * );
 * ```
 *
 * @example Custom error messages
 * ```typescript
 * import { z } from "zod";
 * import { zod } from "@optique/zod";
 * import { message } from "@optique/core/message";
 * import { option } from "@optique/core/primitives";
 *
 * const email = option("--email", zod(z.string().email(), {
 *   metavar: "EMAIL",
 *   errors: {
 *     zodError: (error, input) =>
 *       message`Please provide a valid email address, got ${input}.`
 *   }
 * }));
 * ```
 *
 * @since 0.7.0
 */
export function zod<T>(
  schema: z.Schema<T>,
  options: ZodParserOptions = {},
): ValueParser<"sync", T> {
  return {
    $mode: "sync",
    metavar: options.metavar ?? inferMetavar(schema),

    parse(input: string): ValueParserResult<T> {
      const result = schema.safeParse(input);

      if (result.success) {
        return { success: true, value: result.data };
      }

      // 1. Custom error message
      if (options.errors?.zodError) {
        return {
          success: false,
          error: typeof options.errors.zodError === "function"
            ? options.errors.zodError(result.error, input)
            : options.errors.zodError,
        };
      }

      // 2. Zod v4 prettifyError (if available)
      // deno-lint-ignore no-explicit-any
      const zodModule = schema as any;
      if (typeof zodModule.constructor?.prettifyError === "function") {
        try {
          const pretty = zodModule.constructor.prettifyError(result.error);
          return { success: false, error: message`${pretty}` };
        } catch {
          // Fall through to default error handling
        }
      }

      // 3. Default: use first error message
      const firstError = result.error.issues[0];
      return {
        success: false,
        error: message`${firstError?.message ?? "Validation failed"}`,
      };
    },

    format(value: T): string {
      return String(value);
    },
  };
}
