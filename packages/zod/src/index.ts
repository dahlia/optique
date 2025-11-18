import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
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
  readonly metavar?: string;

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
 * Creates a value parser from a Zod schema.
 *
 * This parser validates CLI argument strings using Zod schemas, enabling
 * powerful validation and transformation capabilities for command-line
 * interfaces.
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
): ValueParser<T> {
  return {
    metavar: options.metavar ?? "VALUE",

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
