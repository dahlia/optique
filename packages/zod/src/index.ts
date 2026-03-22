import type {
  NonEmptyString,
  ValueParser,
  ValueParserResult,
} from "@optique/core/valueparser";
import { type Message, message } from "@optique/core/message";
import { ensureNonEmptyString } from "@optique/core/nonempty";
import type { z } from "zod";

/**
 * Options for creating a Zod value parser.
 * @since 0.7.0
 */
export interface ZodParserOptions<T = unknown> {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `VALUE` or `SCHEMA`.
   * @default `"VALUE"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom formatter for displaying parsed values in help messages.
   * When not provided, the default formatter is used: primitives use
   * `String()`, valid `Date` values use `.toISOString()`, and objects
   * with a custom `toString()` use `String()` with `JSON.stringify()`
   * as a fallback for plain objects.
   *
   * @param value The parsed value to format.
   * @returns A string representation of the value.
   * @since 1.0.0
   */
  readonly format?: (value: T) => string;

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

interface ZodCheckInternal {
  readonly kind?: string;
  readonly format?: string;
  readonly version?: string;
  readonly isInt?: boolean;
}

interface ZodDefinitionInternal {
  readonly typeName?: string;
  readonly type?: string;
  readonly checks?: readonly ZodCheckInternal[];
  readonly innerType?: z.Schema<unknown>;
  readonly values?:
    | readonly (string | number | boolean | symbol | bigint)[]
    | Record<string, string | number>;
  readonly value?: string | number | boolean | symbol | bigint;
  readonly entries?: Record<string, string | number>;
  readonly options?: readonly z.Schema<unknown>[];
}

interface ZodSchemaInternal {
  readonly _def?: ZodDefinitionInternal;
  readonly constructor?: {
    readonly prettifyError?: (error: z.ZodError) => string;
  };
}

/**
 * Checks whether the given error is a Zod async-parse error.
 *
 * - **Zod v4** throws a dedicated `$ZodAsyncError` class.
 * - **Zod v3** (3.25+) throws a plain `Error` whose message starts with
 *   `"Async refinement encountered during synchronous parse operation"` for
 *   async refinements, or `"Asynchronous transform encountered during
 *   synchronous parse operation"` for async transforms.
 */
function isZodAsyncError(error: Error): boolean {
  // Zod v4: dedicated error class
  if (error.constructor.name === "$ZodAsyncError") return true;
  // Zod v3: exact error messages (not prefix-matched, to avoid masking
  // user errors that happen to start with similar text)
  if (
    error.message ===
      "Async refinement encountered during synchronous parse operation. Use .parseAsync instead." ||
    error.message ===
      "Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead." ||
    error.message === "Synchronous parse encountered promise."
  ) {
    return true;
  }
  return false;
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
  const def = (schema as ZodSchemaInternal)._def;

  if (!def) {
    return "VALUE";
  }

  // Get type name from either typeName property (Zod v4) or def.type (Zod v3)
  const typeName = def.typeName ?? def.type;

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

  // 5. Check for enum (including nativeEnum on Zod v4 which also reports
  //    type "enum").  Gate on inferChoices() so that numeric native enums
  //    fall back to "VALUE".
  if (
    typeName === "ZodEnum" || typeName === "enum" ||
    typeName === "ZodNativeEnum" || typeName === "nativeEnum"
  ) {
    return inferChoices(schema) != null ? "CHOICE" : "VALUE";
  }

  // 6. Check for literal
  if (typeName === "ZodLiteral" || typeName === "literal") {
    if (inferChoices(schema) != null) {
      return "CHOICE";
    }
    return "VALUE";
  }

  // 7. Check for union
  if (typeName === "ZodUnion" || typeName === "union") {
    if (inferChoices(schema) != null) {
      return "CHOICE";
    }
    return "VALUE";
  }

  // 8. Handle optional/nullable wrappers by unwrapping
  if (
    typeName === "ZodOptional" || typeName === "optional" ||
    typeName === "ZodNullable" || typeName === "nullable"
  ) {
    const innerType = def.innerType;
    if (innerType != null) {
      return inferMetavar(innerType);
    }
    return "VALUE";
  }

  // 9. Handle default wrapper by unwrapping
  if (typeName === "ZodDefault" || typeName === "default") {
    const innerType = def.innerType;
    if (innerType != null) {
      return inferMetavar(innerType);
    }
    return "VALUE";
  }

  // 10. Fallback for unknown types
  return "VALUE";
}

/**
 * Extracts valid choices from a Zod schema that represents a fixed set of
 * values (enum, literal, or union of literals).
 *
 * @param schema A Zod schema to analyze.
 * @returns An array of string representations of valid choices, or `undefined`
 *          if the schema does not represent a fixed set of values.
 */
function inferChoices(
  schema: z.Schema<unknown>,
): readonly string[] | undefined {
  const def = (schema as ZodSchemaInternal)._def;
  if (!def) return undefined;

  const typeName = def.typeName ?? def.type;

  // z.enum(["a", "b"]) or z.nativeEnum(StringEnum):
  //   Zod v3: _def.values is string[] for z.enum()
  //   Zod v4: _def.entries is Record<string, string | number> for both
  //           z.enum() and z.nativeEnum()
  // For Zod v4, z.nativeEnum() with a numeric TypeScript enum also reports
  // type "enum" with entries containing reverse mappings (e.g.,
  // { A: 0, 0: "A" }).  We must bail out when any entry value is not a
  // string, since safeParse() would reject string representations of those
  // values from CLI input.
  if (typeName === "ZodEnum" || typeName === "enum") {
    const values = def.values;
    if (Array.isArray(values)) {
      return values.map(String);
    }
    const entries = def.entries;
    if (entries != null && typeof entries === "object") {
      const result = new Set<string>();
      for (
        const val of Object.values(entries as Record<string, string | number>)
      ) {
        if (typeof val === "string") {
          result.add(val);
        } else {
          return undefined;
        }
      }
      return result.size > 0 ? [...result] : undefined;
    }
    return undefined;
  }

  // z.nativeEnum(MyEnum) → _def.values is an object.
  // Only expose choices when every member value is a string; numeric enums
  // have reverse-mapped names that safeParse() would reject from CLI input.
  if (typeName === "ZodNativeEnum" || typeName === "nativeEnum") {
    const values = def.values;
    if (
      values != null && typeof values === "object" && !Array.isArray(values)
    ) {
      const result = new Set<string>();
      for (
        const val of Object.values(values as Record<string, string | number>)
      ) {
        if (typeof val === "string") {
          result.add(val);
        } else {
          // Numeric member found — bail out entirely because the parser
          // validates via safeParse() which expects the actual number, not
          // its string representation.
          return undefined;
        }
      }
      return result.size > 0 ? [...result] : undefined;
    }
    return undefined;
  }

  // z.literal("x"):
  //   Zod v3: _def.value is the literal value
  //   Zod v4: _def.values is [value]
  // Only string literals are exposed; numeric literals would fail
  // safeParse() when given as CLI strings.
  if (typeName === "ZodLiteral" || typeName === "literal") {
    const value = def.value;
    if (typeof value === "string") {
      return [value];
    }
    const values = def.values;
    if (Array.isArray(values)) {
      const result: string[] = [];
      for (const v of values) {
        if (typeof v === "string") {
          result.push(v);
        } else {
          return undefined;
        }
      }
      return result.length > 0 ? result : undefined;
    }
    return undefined;
  }

  // z.union([...]) → _def.options is array of schemas
  if (typeName === "ZodUnion" || typeName === "union") {
    const options = def.options;
    if (!Array.isArray(options)) return undefined;
    const allChoices = new Set<string>();
    for (const opt of options) {
      const sub = inferChoices(opt);
      if (sub == null) return undefined;
      for (const choice of sub) {
        allChoices.add(choice);
      }
    }
    return allChoices.size > 0 ? [...allChoices] : undefined;
  }

  // Optional/nullable/default wrappers → unwrap
  if (
    typeName === "ZodOptional" || typeName === "optional" ||
    typeName === "ZodNullable" || typeName === "nullable" ||
    typeName === "ZodDefault" || typeName === "default"
  ) {
    const innerType = def.innerType;
    if (innerType != null) {
      return inferChoices(innerType);
    }
    return undefined;
  }

  return undefined;
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
 * @throws {TypeError} If the resolved `metavar` is an empty string.
 * @throws {TypeError} If the schema contains async refinements or other async
 *   operations that cannot be executed synchronously.
 * @since 0.7.0
 */
export function zod<T>(
  schema: z.Schema<T>,
  options: ZodParserOptions<T> = {},
): ValueParser<"sync", T> {
  const choices = inferChoices(schema);
  const metavar = options.metavar ?? inferMetavar(schema);
  ensureNonEmptyString(metavar);
  const parser: ValueParser<"sync", T> = {
    $mode: "sync",
    metavar,
    ...(choices != null && choices.length > 0
      ? {
        // Safe cast: inferChoices() only extracts values from schemas
        // that accept string input and return it as-is (enum, literal,
        // union of string literals).
        choices: Object.freeze(choices) as readonly T[],
        *suggest(prefix: string) {
          for (const c of choices) {
            if (c.startsWith(prefix)) {
              yield { kind: "literal" as const, text: c };
            }
          }
        },
      }
      : {}),

    parse(input: string): ValueParserResult<T> {
      let result;
      try {
        result = schema.safeParse(input);
      } catch (error) {
        if (error instanceof Error && isZodAsyncError(error)) {
          throw new TypeError(
            "Async Zod schemas (e.g., async refinements) are not supported " +
              "by zod(). Use synchronous schemas instead.",
          );
        }
        throw error;
      }

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
      const zodModule = schema as ZodSchemaInternal;
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
      if (options.format) return options.format(value);
      if (value instanceof Date) {
        return Number.isNaN(value.getTime())
          ? String(value)
          : value.toISOString();
      }
      if (typeof value !== "object" || value === null) return String(value);
      if (Array.isArray(value)) return String(value);
      const str = String(value);
      if (str !== "[object Object]") return str;
      try {
        return JSON.stringify(value) ?? str;
      } catch {
        return str;
      }
    },
  };
  return parser;
}
