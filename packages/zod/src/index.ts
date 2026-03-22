import type {
  NonEmptyString,
  ValueParser,
  ValueParserResult,
} from "@optique/core/valueparser";
import { type Message, message, valueSet } from "@optique/core/message";
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
   * `String()`, valid `Date` values use `.toISOString()`, and plain
   * objects use `JSON.stringify()`.  All other objects (arrays, class
   * instances, etc.) use `String()`.
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
  readonly schema?: z.Schema<unknown>;
  readonly effect?: { readonly type?: string };
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

const BOOL_TRUE_LITERALS = ["true", "1", "yes", "on"] as const;
const BOOL_FALSE_LITERALS = ["false", "0", "no", "off"] as const;

interface BooleanSchemaInfo {
  /** Whether the schema is a boolean type (possibly wrapped). */
  readonly isBoolean: boolean;
  /** Whether it is safe to expose `choices` and `suggest()`. */
  readonly exposeChoices: boolean;
}

/**
 * Analyzes whether the given Zod schema represents a boolean type,
 * unwrapping all known Zod wrappers.  Also determines whether it is
 * safe to expose `choices` and `suggest()` — wrappers that can narrow
 * the accepted domain (effects, catch) suppress choice exposure.
 */
function analyzeBooleanSchema(
  schema: z.Schema<unknown>,
): BooleanSchemaInfo {
  return analyzeBooleanInner(schema, true);
}

function analyzeBooleanInner(
  schema: z.Schema<unknown>,
  canExposeChoices: boolean,
): BooleanSchemaInfo {
  const def = (schema as ZodSchemaInternal)._def;
  if (!def) return { isBoolean: false, exposeChoices: false };
  const typeName = def.typeName ?? def.type;

  if (typeName === "ZodBoolean" || typeName === "boolean") {
    // Zod v4 inlines refinements as checks on the schema itself.
    // When custom checks are present, the accepted domain may be
    // narrowed, so suppress choices.
    const hasCustomChecks = Array.isArray(def.checks) &&
      def.checks.some((c) =>
        c.kind === "custom" ||
        (c as unknown as { type?: string }).type === "custom"
      );
    return {
      isBoolean: true,
      exposeChoices: canExposeChoices && !hasCustomChecks,
    };
  }

  // optional/nullable/default preserve choice exposure
  if (
    typeName === "ZodOptional" || typeName === "optional" ||
    typeName === "ZodNullable" || typeName === "nullable" ||
    typeName === "ZodDefault" || typeName === "default"
  ) {
    const innerType = def.innerType;
    if (innerType != null) {
      return analyzeBooleanInner(innerType, canExposeChoices);
    }
  }

  // effects (refine/transform) — suppress choices.
  // Preprocess effects are excluded: they receive the raw input string
  // and handle conversion themselves, so boolean pre-conversion must
  // not interfere.  (Zod v3 only; Zod v4 uses pipe for preprocess.)
  if (typeName === "ZodEffects" || typeName === "effects") {
    if (def.effect?.type === "preprocess") {
      return { isBoolean: false, exposeChoices: false };
    }
    const innerSchema = def.schema;
    if (innerSchema != null) {
      return analyzeBooleanInner(innerSchema, false);
    }
  }

  // catch — suppress choices
  if (typeName === "ZodCatch" || typeName === "catch") {
    const innerType = def.innerType;
    if (innerType != null) {
      return analyzeBooleanInner(innerType, false);
    }
  }

  // branded — suppress choices (refinements may be involved)
  if (typeName === "ZodBranded" || typeName === "branded") {
    const innerType = def.innerType;
    if (innerType != null) {
      return analyzeBooleanInner(innerType, false);
    }
  }

  // pipeline — suppress choices
  if (typeName === "ZodPipeline" || typeName === "pipeline") {
    const innerType = def.innerType;
    if (innerType != null) {
      return analyzeBooleanInner(innerType, false);
    }
  }

  return { isBoolean: false, exposeChoices: false };
}

/**
 * Pre-converts a CLI string input to an actual boolean value using
 * CLI-friendly literals (true/false, 1/0, yes/no, on/off).
 */
function preConvertBoolean(
  input: string,
): ValueParserResult<boolean> {
  const normalized = input.trim().toLowerCase();
  if (
    BOOL_TRUE_LITERALS.includes(
      normalized as (typeof BOOL_TRUE_LITERALS)[number],
    )
  ) {
    return { success: true, value: true };
  }
  if (
    BOOL_FALSE_LITERALS.includes(
      normalized as (typeof BOOL_FALSE_LITERALS)[number],
    )
  ) {
    return { success: true, value: false };
  }
  return {
    success: false,
    error: message`Invalid Boolean value: ${input}. Expected one of ${
      valueSet([...BOOL_TRUE_LITERALS, ...BOOL_FALSE_LITERALS], {
        locale: "en-US",
      })
    }.`,
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
  const boolInfo = analyzeBooleanSchema(schema);
  const metavar = options.metavar ?? inferMetavar(schema);
  ensureNonEmptyString(metavar);

  function doSafeParse(
    input: unknown,
    rawInput: string,
  ): ValueParserResult<T> {
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
          ? options.errors.zodError(result.error, rawInput)
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
  }

  /**
   * Handles a failed boolean literal pre-conversion, respecting custom
   * `zodError` overrides when provided.  For function-style overrides,
   * passes the raw input through `safeParse()` to obtain a real
   * `ZodError`; if `safeParse()` succeeds (coerced boolean case),
   * constructs a synthetic error with a compatible shape so the
   * callback is always invoked.
   *
   * Also re-throws async schema errors so that unsupported schemas are
   * detected consistently regardless of the input value.
   */
  function handleBooleanLiteralError(
    boolResult: ValueParserResult<boolean>,
    rawInput: string,
  ): ValueParserResult<T> {
    // Always probe safeParse() with the raw input so that async
    // schema errors are detected even for invalid boolean literals.
    // For non-coerced z.boolean(), this also provides a real ZodError
    // for function-style zodError callbacks.
    let probeResult;
    try {
      probeResult = schema.safeParse(rawInput);
    } catch (error) {
      if (error instanceof Error && isZodAsyncError(error)) {
        throw new TypeError(
          "Async Zod schemas (e.g., async refinements) are not supported " +
            "by zod(). Use synchronous schemas instead.",
        );
      }
      throw error;
    }

    if (options.errors?.zodError) {
      if (typeof options.errors.zodError !== "function") {
        return { success: false, error: options.errors.zodError };
      }
      // For non-coerced z.boolean(), safeParse(string) gives a real
      // ZodError we can forward.  For z.coerce.boolean(), safeParse
      // succeeds (JS truthiness), so we construct a synthetic error
      // with a compatible shape so the callback is always invoked.
      const zodError = probeResult && !probeResult.success
        ? probeResult.error
        : Object.assign(
          new Error(`Invalid Boolean value: ${rawInput}`),
          {
            issues: [{
              code: "custom" as const,
              message: `Invalid Boolean value: ${rawInput}`,
              path: [] as PropertyKey[],
            }],
            name: "ZodError",
          },
        ) as unknown as z.ZodError;
      return {
        success: false,
        error: options.errors.zodError(zodError, rawInput),
      };
    }
    return boolResult as ValueParserResult<T>;
  }

  const parser: ValueParser<"sync", T> = {
    $mode: "sync",
    metavar,
    ...(boolInfo.exposeChoices
      ? {
        choices: Object.freeze([true, false]) as readonly T[],
        suggest(prefix: string) {
          const allLiterals = [
            ...BOOL_TRUE_LITERALS,
            ...BOOL_FALSE_LITERALS,
          ];
          const normalizedPrefix = prefix.toLowerCase();
          return allLiterals
            .filter((lit) => lit.startsWith(normalizedPrefix))
            .map((lit) => ({ kind: "literal" as const, text: lit }));
        },
      }
      : choices != null && choices.length > 0
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
      if (boolInfo.isBoolean) {
        const boolResult = preConvertBoolean(input);
        if (!boolResult.success) {
          return handleBooleanLiteralError(boolResult, input);
        }
        return doSafeParse(boolResult.value, input);
      }
      return doSafeParse(input, input);
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
      const proto = Object.getPrototypeOf(value);
      if (proto === Object.prototype || proto === null) {
        try {
          return JSON.stringify(value) ?? str;
        } catch {
          // Falls through to str below
        }
      }
      return str;
    },
  };
  return parser;
}
