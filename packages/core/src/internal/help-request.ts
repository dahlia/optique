/** Internal help request bridge; not a stable extension API. @module */
const helpRequestKey = Symbol.for("@optique/core/internal/help-request");

/**
 * Copies options with a help target independent of help entry-point names.
 * @param options The runner options to copy.
 * @param commands The canonical command path to display.
 * @returns Options carrying the internal request through transparent spreads.
 * @internal
 * @since 1.4.0
 */
export function withHelpRequest<T extends object>(
  options: T,
  commands: readonly string[],
): T {
  return { ...options, [helpRequestKey]: [...commands] };
}

/**
 * Reads an internal help target, including the empty root path.
 * @param options The runner options.
 * @returns The requested path, or undefined when no request exists.
 * @internal
 * @since 1.4.0
 */
export function getHelpRequest(options: object): readonly string[] | undefined {
  const value: unknown = Reflect.get(options, helpRequestKey);
  return Array.isArray(value) && value.every((part) => typeof part === "string")
    ? value
    : undefined;
}
