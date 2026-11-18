/** Internal help request bridge; not a stable extension API. @module */
const helpRequestKey = Symbol.for("@optique/core/internal/help-request");
const defaultDispatchKey = Symbol.for(
  "@optique/core/internal/default-dispatch",
);

/** Command-tree queries for the Discover runner's opt-in default dispatch. @internal */
export interface DefaultDispatch {
  readonly isNamed: (token: string) => boolean;
  readonly helpNames: (path: readonly string[]) => readonly string[];
}

/**
 * Carries default dispatch queries on the parser without changing its type.
 * @param parser The full program parser.
 * @param dispatch Queries against the registered command tree.
 * @returns A parser carrying the internal runner policy.
 * @internal
 */
export function withDefaultDispatch<T extends object>(
  parser: T,
  dispatch: DefaultDispatch,
): T {
  return { ...parser, [defaultDispatchKey]: dispatch };
}

/**
 * Reads the default dispatch policy, if present.
 * @param parser The full program parser.
 * @returns The policy or undefined for ordinary parsers.
 * @internal
 */
export function getDefaultDispatch(
  parser: object,
): DefaultDispatch | undefined {
  return Reflect.get(parser, defaultDispatchKey) as DefaultDispatch | undefined;
}

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
