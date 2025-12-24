/**
 * A string type that guarantees at least one character.
 * Used for `metavar` properties to ensure they are never empty.
 *
 * This type uses a template literal pattern that requires at least one
 * character, providing compile-time rejection of empty string literals.
 *
 * @since 0.9.0
 */
// deno-lint-ignore no-explicit-any
export type NonEmptyString = `${any}${string}`;

/**
 * Checks if a string is non-empty.
 * Can be used as a type guard for type narrowing.
 * @param value The string to check.
 * @returns `true` if the string is non-empty, `false` otherwise.
 * @since 0.9.0
 */
export function isNonEmptyString(value: string): value is NonEmptyString {
  return value !== "";
}

/**
 * Asserts that a string is non-empty.
 * Throws a `TypeError` if the string is empty.
 * @param value The string to validate.
 * @throws {TypeError} If the string is empty.
 * @since 0.9.0
 */
export function ensureNonEmptyString(
  value: string,
): asserts value is NonEmptyString {
  if (value === "") throw new TypeError("Expected a non-empty string.");
}
