/**
 * Type representing an error message that can include styled/colored values.
 *
 * ErrorMessage supports two formats:
 *
 * - A simple string for basic error messages
 * - A structured format with template strings and values for rich formatting
 *   (allows highlighting specific values in error messages with colors)
 */
export type ErrorMessage =
  | string
  | {
    readonly message: readonly string[];
    readonly values: readonly unknown[];
  };

/**
 * Creates a structured error message with template strings and values.
 *
 * This function allows creating error messages where specific values can be
 * highlighted or styled differently when displayed to the user.
 *
 * @example
 * ```typescript
 * const error = message`Expected number between ${min} and ${max}, got ${value}`;
 * ```
 *
 * @param message Template strings array (from template literal).
 * @param values Values to be interpolated into the template.
 * @returns A structured ErrorMessage object.
 */
export function message(
  message: TemplateStringsArray,
  ...values: readonly unknown[]
): ErrorMessage {
  return { message, values };
}

/**
 * Prepends a prefix to an {@link ErrorMessage}.
 *
 * @example
 * ```typescript
 * const error = message`Invalid input: ${123}`;
 * const prefixedError = prependErrorMessage("Error: ", error);
 * console.error(prefixedError);
 * // Result: {message: {"Error: Invalid input:", ""}, values: [123]}
 * ```
 *
 * @param prefix The prefix to prepend to the error message.
 * @param error The original error message to modify.
 * @returns A new {@link ErrorMessage} with the prefix added.
 */
export function prependErrorMessage(
  prefix: string,
  error: ErrorMessage,
): ErrorMessage {
  if (typeof error === "string") {
    return `${prefix}${error}`;
  } else {
    return {
      message: error.message.length > 0
        ? [`${prefix}${error.message[0]}`, ...error.message.slice(1)]
        : [prefix],
      values: error.values,
    };
  }
}
