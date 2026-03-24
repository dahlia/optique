import type {
  NonEmptyString,
  ValueParser,
  ValueParserResult,
} from "@optique/core/valueparser";
import { type Message, message } from "@optique/core/message";
import { ensureNonEmptyString } from "@optique/core/nonempty";
import type * as v from "valibot";
import { safeParse } from "valibot";

/**
 * Options for creating a Valibot value parser.
 * @since 0.7.0
 */
export interface ValibotParserOptions<T = unknown> {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `VALUE` or `SCHEMA`.
   * @default `"VALUE"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * A placeholder value of type `T` used as a sentinel for internal
   * bookkeeping.  Because the output type of a Valibot schema cannot be
   * inferred to a concrete default, callers must provide this explicitly.
   */
  readonly placeholder: T;

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

interface ValibotPipelineActionInternal {
  readonly type?: string;
}

interface ValibotSchemaInternal {
  readonly type?: string;
  readonly pipe?: readonly ValibotPipelineActionInternal[];
  readonly wrapped?: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
  readonly options?:
    | readonly (string | number)[]
    | readonly v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>[];
  readonly literal?: string | number | boolean | symbol | bigint;
  // Container members (object entries, array item, tuple items, etc.)
  readonly entries?: Record<
    string,
    v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>
  >;
  readonly item?: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
  readonly items?: readonly v.BaseSchema<
    unknown,
    unknown,
    v.BaseIssue<unknown>
  >[];
  readonly key?: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
  readonly value?: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
  readonly rest?: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;
}

/**
 * Valibot transformation action types that are known to be non-rejecting and
 * type-preserving (they transform a string into a string without ever adding
 * issues).  All other transformation types (transform, raw_transform,
 * parse_json, to_number, to_boolean, etc.) may reject input or change the
 * value type.
 */
const SAFE_TRANSFORMATION_TYPES: ReadonlySet<string> = new Set([
  "trim",
  "to_lower_case",
  "to_upper_case",
  "normalize",
  "to_min_value",
  "to_max_value",
  "trim_start",
  "trim_end",
  "readonly",
  "brand",
  "flavor",
]);

/**
 * Checks whether a schema synchronously accepts every possible input value.
 * This includes:
 * - `v.unknown()`, `v.any()` (accept everything regardless of input type)
 * - Bare `v.string()` without a pipe (accepts every string)
 * - Any wrapper with a `wrapped` field pointing to a catch-all schema
 *   (e.g., `v.optional()`, `v.nullable()`, `v.nonOptional()`, etc.)
 *
 * Piped schemas are considered catch-all only when the base type is
 * `string`/`unknown`/`any` and every pipe action is a non-rejecting
 * transformation (not a validation or nested schema).
 *
 * @param afterTransform When true, only type-agnostic catch-alls
 *   (`v.unknown()`, `v.any()`) are recognized.  String-based catch-alls
 *   are not trusted since the input type may no longer be a string.
 */
function isCatchAllSchema(
  schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
  afterTransform = false,
): boolean {
  const s = schema as ValibotSchemaInternal & {
    async?: boolean;
    fallback?: unknown;
  };
  if (s.async) return false;
  // v.fallback() always succeeds (returns fallback value on failure)
  if ("fallback" in s) return true;
  // v.unknown() and v.any() accept every value of any type
  if (s.type === "unknown" || s.type === "any") {
    if (!s.pipe) return true;
    return s.pipe.slice(1).every((action) => {
      const a = action as { kind?: string; type?: string };
      if (a.kind === "validation") return false;
      if (a.kind === "schema") {
        return isCatchAllSchema(
          action as v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
          afterTransform,
        );
      }
      return SAFE_TRANSFORMATION_TYPES.has(a.type ?? "");
    });
  }
  // String-based catch-alls only valid before transforms
  if (!afterTransform && s.type === "string") {
    if (!s.pipe) return true;
    return s.pipe.slice(1).every((action) => {
      const a = action as { kind?: string; type?: string };
      if (a.kind === "validation") return false;
      if (a.kind === "schema") {
        return isCatchAllSchema(
          action as v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
          afterTransform,
        );
      }
      return SAFE_TRANSFORMATION_TYPES.has(a.type ?? "");
    });
  }
  // Unwrap any schema with a wrapped field (optional, nullable, nullish,
  // nonOptional, exactOptional, etc.) — but only if there's no pipe,
  // since piped wrappers may have rejecting pipe actions.
  if (s.wrapped && !s.pipe) {
    return isCatchAllSchema(s.wrapped, afterTransform);
  }
  return false;
}

/**
 * Recursively checks whether a Valibot schema contains any async parts
 * (e.g., `pipeAsync`, `checkAsync`).  Wrapper schemas such as `optional()`,
 * `nullable()`, `nullish()`, and `union()` keep `async === false` on the
 * outer layer even when they wrap async inner schemas, so a shallow check
 * on the top-level `async` property is not sufficient.
 *
 * Known limitations:
 * - `v.variant()` arms are treated like union arms, but the catch-all
 *   detection does not recognize object-shaped variant arms.  Variant
 *   schemas with async arms after a broad discriminator will be
 *   conservatively rejected.
 * - `v.lazy()` schemas are not inspected because the getter depends on
 *   actual parse input, making static analysis unreliable.
 *
 * @param afterTransform When true, a preceding `v.transform()` may have
 *   changed the value type.  Container members become reachable and
 *   string-based union catch-all arms are no longer trusted.
 */
function containsAsyncSchema(
  schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
  visited: WeakMap<object, boolean> = new WeakMap(),
  afterTransform = false,
): boolean {
  // Cycle/dedup: skip if already visited at the same or deeper level.
  // A visit with afterTransform=true subsumes afterTransform=false,
  // but not vice versa (the afterTransform=true path checks containers).
  const prev = visited.get(schema);
  if (prev !== undefined && (prev || !afterTransform)) return false;
  visited.set(schema, (prev ?? false) || afterTransform);

  const s = schema as ValibotSchemaInternal & { async?: boolean };
  if (s.async) return true;

  // Unwrap optional/nullable/nullish wrappers — but only if there's no
  // pipe, since piped wrappers need their pipe actions inspected too.
  if (s.wrapped && !s.pipe) {
    return containsAsyncSchema(s.wrapped, visited, afterTransform);
  }

  // Check intersect options — all arms must match, so async arms are always
  // reachable and must be rejected.
  // For union/variant — Valibot evaluates arms left-to-right.  A catch-all
  // arm makes all *subsequent* arms unreachable, so we only suppress async
  // checking once a catch-all is found scanning in order.
  // After a transform, only type-agnostic catch-alls (unknown/any) are
  // reliable; string catch-alls are not trusted since the value may no
  // longer be a string.
  if (s.options && Array.isArray(s.options)) {
    if (s.type === "union") {
      for (const option of s.options) {
        if (typeof option !== "object" || option == null) continue;
        if (isCatchAllSchema(option, afterTransform)) break;
        if (containsAsyncSchema(option, visited, afterTransform)) return true;
      }
    } else if (s.type === "variant") {
      // Variant schemas only parse objects, so at top level (before
      // transform) string input fails the outer type check and arms
      // are unreachable.  Only inspect arms after a transform.
      if (afterTransform) {
        for (const option of s.options) {
          if (typeof option === "object" && option != null) {
            if (containsAsyncSchema(option, visited, true)) return true;
          }
        }
      }
    } else {
      for (const option of s.options) {
        if (typeof option === "object" && option != null) {
          if (containsAsyncSchema(option, visited, afterTransform)) {
            return true;
          }
        }
      }
    }
  }

  // Check pipeline actions for async flags and nested schemas.
  // Track transforms: after a transform/rawTransform, container members
  // become reachable and string catch-alls are no longer trusted.
  if (s.pipe && Array.isArray(s.pipe)) {
    let seenTransform = afterTransform;
    for (const action of s.pipe) {
      if ((action as { async?: boolean }).async) return true;
      const a = action as { kind?: string; type?: string };
      if (
        a.kind === "transformation" &&
        !SAFE_TRANSFORMATION_TYPES.has(a.type ?? "")
      ) {
        seenTransform = true;
      }
      if (a.kind === "schema") {
        if (
          containsAsyncSchema(
            action as v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
            visited,
            seenTransform,
          )
        ) {
          return true;
        }
        // A nested pipe schema may contain transforms that change the
        // value type for subsequent steps in the outer pipe.
        if (!seenTransform) {
          const innerPipe = (action as ValibotSchemaInternal).pipe;
          if (innerPipe && Array.isArray(innerPipe)) {
            for (const innerAction of innerPipe) {
              const ia = innerAction as { kind?: string; type?: string };
              if (
                ia.kind === "transformation" &&
                !SAFE_TRANSFORMATION_TYPES.has(ia.type ?? "")
              ) {
                seenTransform = true;
                break;
              }
            }
          }
        }
      }
    }
  }

  // Container members are only reachable after a transform changes the
  // value type.  At the top level, CLI input is always a string, so
  // container schemas (object, array, etc.) reject before visiting members.
  if (afterTransform) {
    if (s.entries) {
      for (const entry of Object.values(s.entries)) {
        if (containsAsyncSchema(entry, visited, true)) return true;
      }
    }
    if (s.item && containsAsyncSchema(s.item, visited, true)) return true;
    if (s.items && Array.isArray(s.items)) {
      for (const item of s.items) {
        if (containsAsyncSchema(item, visited, true)) return true;
      }
    }
    if (
      s.key && typeof s.key === "object" &&
      containsAsyncSchema(s.key, visited, true)
    ) {
      return true;
    }
    if (s.value && containsAsyncSchema(s.value, visited, true)) return true;
    if (s.rest && containsAsyncSchema(s.rest, visited, true)) return true;
    // v.promise() stores its inner schema in the overloaded `message` field
    if (s.type === "promise") {
      const promiseInner =
        (schema as unknown as Record<string, unknown>).message;
      if (
        typeof promiseInner === "object" && promiseInner != null &&
        "kind" in promiseInner &&
        containsAsyncSchema(
          promiseInner as v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
          visited,
          true,
        )
      ) {
        return true;
      }
    }
  }

  // NOTE: v.lazy() schemas are NOT inspected.  The getter receives the
  // actual parse input and may return different schemas depending on it
  // (e.g., sync for strings, async for other types).  Probing with no
  // argument would take the wrong branch and cause false positives for
  // input-dependent getters, and could also trigger user side effects.

  return false;
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
  const internalSchema = schema as ValibotSchemaInternal;
  const schemaType = internalSchema.type;

  if (!schemaType) {
    return "VALUE";
  }

  // 1. Check for string types with specific validations
  if (schemaType === "string") {
    // Check if there are pipeline actions that indicate specific string types
    const pipeline = internalSchema.pipe;
    if (Array.isArray(pipeline)) {
      for (const action of pipeline) {
        const actionType = action.type;
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
    const pipeline = internalSchema.pipe;
    if (Array.isArray(pipeline)) {
      for (const action of pipeline) {
        const actionType = action.type;
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
    if (inferChoices(schema) != null) {
      return "CHOICE";
    }
    return "VALUE";
  }

  // 7. Check for union
  if (schemaType === "union") {
    if (inferChoices(schema) != null) {
      return "CHOICE";
    }
    return "VALUE";
  }

  // 8. Check for variant (discriminated union — not suitable for choices)
  if (schemaType === "variant") {
    return "VALUE";
  }

  // 9. Handle optional/nullable wrappers by unwrapping
  if (
    schemaType === "optional" || schemaType === "nullable" ||
    schemaType === "nullish"
  ) {
    const wrapped = internalSchema.wrapped;
    if (wrapped) {
      return inferMetavar(wrapped);
    }
  }

  // 10. Fallback for unknown types
  return "VALUE";
}

/**
 * Extracts valid choices from a Valibot schema that represents a fixed set of
 * values (picklist, literal, or union of literals).
 *
 * @param schema A Valibot schema to analyze.
 * @returns An array of string representations of valid choices, or `undefined`
 *          if the schema does not represent a fixed set of values.
 */
function inferChoices(
  schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
): readonly string[] | undefined {
  const internalSchema = schema as ValibotSchemaInternal;
  const schemaType = internalSchema.type;
  if (!schemaType) return undefined;

  // v.picklist(["a", "b"]) → .options is primitive array.
  // Only string picklists are exposed; numeric values would fail
  // safeParse() when given as CLI strings.
  if (schemaType === "picklist") {
    const options = internalSchema.options;
    if (Array.isArray(options)) {
      const result: string[] = [];
      for (const opt of options) {
        if (typeof opt === "string") {
          result.push(opt);
        } else {
          return undefined;
        }
      }
      return result.length > 0 ? result : undefined;
    }
    return undefined;
  }

  // v.literal("x") → .literal
  // Only string literals are exposed; numeric literals would fail
  // safeParse() when given as CLI strings.
  if (schemaType === "literal") {
    const value = internalSchema.literal;
    if (typeof value === "string") {
      return [value];
    }
    return undefined;
  }

  // v.union([...]) → .options is array of schemas
  if (schemaType === "union") {
    const options = internalSchema.options;
    if (!Array.isArray(options)) return undefined;
    const allChoices = new Set<string>();
    for (const opt of options) {
      if (typeof opt === "object" && opt != null && "type" in opt) {
        const sub = inferChoices(
          opt as v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
        );
        if (sub == null) return undefined;
        for (const choice of sub) {
          allChoices.add(choice);
        }
      } else {
        return undefined;
      }
    }
    return allChoices.size > 0 ? [...allChoices] : undefined;
  }

  // Optional/nullable/nullish wrappers → unwrap
  if (
    schemaType === "optional" || schemaType === "nullable" ||
    schemaType === "nullish"
  ) {
    const wrapped = internalSchema.wrapped;
    if (wrapped) {
      return inferChoices(wrapped);
    }
  }

  return undefined;
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
 * @throws {TypeError} If the resolved `metavar` is an empty string.
 * @throws {TypeError} If the schema contains async validations that cannot be
 *   executed synchronously.
 * @since 0.7.0
 */
export function valibot<T>(
  schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>,
  options: ValibotParserOptions<T>,
): ValueParser<"sync", T> {
  if (options == null || typeof options !== "object") {
    throw new TypeError(
      "valibot() requires an options object with a placeholder property.",
    );
  }
  if (containsAsyncSchema(schema)) {
    throw new TypeError(
      "Async Valibot schemas (e.g., async validations) are not " +
        "supported by valibot(). Use synchronous schemas instead.",
    );
  }
  const choices = inferChoices(schema);
  const metavar = options.metavar ?? inferMetavar(schema);
  ensureNonEmptyString(metavar);
  const parser: ValueParser<"sync", T> = {
    $mode: "sync",
    metavar,
    placeholder: options.placeholder,
    ...(choices != null && choices.length > 0
      ? {
        // Safe cast: inferChoices() only extracts values from schemas
        // that accept string input and return it as-is (picklist, literal,
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
