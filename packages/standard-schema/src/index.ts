import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  NonEmptyString,
  ValueParser,
  ValueParserResult,
} from "@optique/core/valueparser";
import { type Message, message, text } from "@optique/core/message";
import { ensureNonEmptyString } from "@optique/core/nonempty";

/**
 * Options for creating a Standard Schema value parser.
 *
 * @template T The output type of the Standard Schema validator.
 * @since 1.2.0
 */
export interface StandardSchemaParserOptions<T = unknown> {
  /**
   * The metavariable name for this parser. This is used in help messages to
   * indicate what kind of value this parser expects. Usually a single
   * word in uppercase, like `VALUE` or `SCHEMA`.
   * @default `"VALUE"`
   */
  readonly metavar?: NonEmptyString;

  /**
   * A phase-one stand-in value of type `T` used during deferred prompt
   * resolution. Because the output type of a Standard Schema validator cannot
   * be inferred to a concrete default, callers must provide this explicitly.
   */
  readonly placeholder: T;

  /**
   * Custom formatter for displaying parsed values in help messages.
   * When not provided, the default formatter is used: primitives use
   * `String()`, valid `Date` values use `.toISOString()`, and plain
   * objects use `JSON.stringify()` when possible. All other objects use
   * `String()`.
   *
   * @param value The parsed value to format.
   * @returns A string representation of the value.
   */
  readonly format?: (value: T) => string;

  /**
   * Custom error messages for Standard Schema validation failures.
   */
  readonly errors?: {
    /**
     * Custom error message when input fails Standard Schema validation. Can be
     * a static message or a function that receives the Standard Schema issues
     * and input string.
     */
    readonly schemaError?:
      | Message
      | ((
        issues: readonly StandardSchemaV1.Issue[],
        input: string,
      ) => Message);
  };
}

function validateOptions<T>(
  functionName: string,
  options: unknown,
): asserts options is StandardSchemaParserOptions<T> {
  if (options == null || typeof options !== "object") {
    throw new TypeError(
      `${functionName}() requires an options object.`,
    );
  }
  if (Array.isArray(options)) {
    throw new TypeError(
      `${functionName}() requires an options object, got array.`,
    );
  }
  if (!("placeholder" in options)) {
    throw new TypeError(
      `${functionName}() options must include a placeholder property.`,
    );
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value != null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (value as Record<string, unknown>).then === "function";
}

function formatValue<T>(value: T, format?: (value: T) => string): string {
  if (format) return format(value);

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
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
      // Falls through to str below.
    }
  }
  return str;
}

function validationFailure<T>(
  issues: readonly StandardSchemaV1.Issue[],
  input: string,
  error:
    | Message
    | ((issues: readonly StandardSchemaV1.Issue[], input: string) => Message)
    | undefined,
): ValueParserResult<T> {
  if (error) {
    return {
      success: false,
      error: typeof error === "function" ? error(issues, input) : error,
    };
  }
  return {
    success: false,
    error: message`${text(issues[0]?.message ?? "Validation failed.")}`,
  };
}

function processValidationResult<T>(
  result: StandardSchemaV1.Result<T>,
  input: string,
  options: StandardSchemaParserOptions<T>,
): ValueParserResult<T> {
  if (result.issues) {
    return validationFailure(result.issues, input, options.errors?.schemaError);
  }
  return { success: true, value: result.value };
}

/**
 * Creates a value parser from a Standard Schema-compatible validator.
 *
 * The returned parser validates CLI argument strings with
 * `schema["~standard"].validate(input)`. Standard Schema does not expose
 * library-specific metadata such as enum choices, Boolean parser shape, or
 * preferred metavars, so this generic adapter stays conservative. Use
 * dedicated adapters such as *@optique/zod* or *@optique/valibot* when their
 * richer CLI behavior is useful.
 *
 * @template T The output type of the Standard Schema validator.
 * @param schema A Standard Schema-compatible validator.
 * @param options Configuration for the parser, including a required
 *   `placeholder` value used during deferred prompt resolution.
 * @returns A value parser that validates inputs using the provided schema.
 *
 * @throws {TypeError} If `options` is missing, not an object, or does not
 *   include `placeholder`.
 * @throws {TypeError} If the resolved `metavar` is an empty string.
 * @throws {TypeError} If the validator returns a promise during parsing.
 * @since 1.2.0
 */
export function standardSchema<T>(
  schema: StandardSchemaV1<unknown, T>,
  options: StandardSchemaParserOptions<T>,
): ValueParser<"sync", T> {
  validateOptions("standardSchema", options);
  const metavar = options.metavar ?? "VALUE";
  ensureNonEmptyString(metavar);

  const parser: ValueParser<"sync", T> = {
    mode: "sync",
    metavar,
    placeholder: options.placeholder,

    parse(input: string): ValueParserResult<T> {
      const result = schema["~standard"].validate(input);
      if (isPromiseLike(result)) {
        void result.then(undefined, () => undefined);
        throw new TypeError(
          "Async Standard Schema validators are not supported by " +
            "standardSchema(). Use standardSchemaAsync() instead.",
        );
      }
      return processValidationResult(result, input, options);
    },

    format(value: T): string {
      return formatValue(value, options.format);
    },
  };
  return parser;
}

/**
 * Creates an async value parser from a Standard Schema-compatible validator.
 *
 * Use this helper when the validator may return a promise from
 * `schema["~standard"].validate(input)`, such as schemas with asynchronous
 * refinements or checks. Synchronous validators are also accepted.
 *
 * @template T The output type of the Standard Schema validator.
 * @param schema A Standard Schema-compatible validator.
 * @param options Configuration for the parser, including a required
 *   `placeholder` value used during deferred prompt resolution.
 * @returns An async value parser that validates inputs using the provided
 *   schema.
 *
 * @throws {TypeError} If `options` is missing, not an object, or does not
 *   include `placeholder`.
 * @throws {TypeError} If the resolved `metavar` is an empty string.
 * @since 1.2.0
 */
export function standardSchemaAsync<T>(
  schema: StandardSchemaV1<unknown, T>,
  options: StandardSchemaParserOptions<T>,
): ValueParser<"async", T> {
  validateOptions("standardSchemaAsync", options);
  const metavar = options.metavar ?? "VALUE";
  ensureNonEmptyString(metavar);

  const parser: ValueParser<"async", T> = {
    mode: "async",
    metavar,
    placeholder: options.placeholder,

    async parse(input: string): Promise<ValueParserResult<T>> {
      const result = await schema["~standard"].validate(input);
      return processValidationResult(result, input, options);
    },

    format(value: T): string {
      return formatValue(value, options.format);
    },
  };
  return parser;
}
