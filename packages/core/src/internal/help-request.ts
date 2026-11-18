/** Internal help request bridge; not a stable extension API. @module */
import { longestMatch, type LongestMatchOptions } from "../constructs.ts";
import type { Mode, Parser } from "../parser.ts";
import { allowDuplicateLeadingCommandNamesKey } from "./command-alias.ts";

/**
 * Composes registered and default branches whose dispatch is mutually exclusive.
 * @param registered The already validated registered-command parser.
 * @param fallback The implicit default parser.
 * @returns A combined parser for usage and branch-state operations.
 * @internal
 */
export function composeDefaultBranches<T>(
  registered: Parser<Mode, T, unknown>,
  fallback: Parser<Mode, T, unknown>,
): Parser<Mode, T, unknown> {
  const options: LongestMatchOptions & {
    readonly [allowDuplicateLeadingCommandNamesKey]: true;
  } = { [allowDuplicateLeadingCommandNamesKey]: true };
  return longestMatch(registered, fallback, options);
}

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
