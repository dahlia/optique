import type { Message } from "../message.ts";
import type { Usage } from "../usage.ts";
import type { Mode, Parser, ParserContext } from "../parser.ts";

/** A consuming failure from a sibling at the current input position. */
export interface ConsumingFailure {
  readonly success: false;
  readonly consumed: number;
  readonly error: Message;
}

const passThroughFailure = Symbol("passThroughFailure");

interface FailureHint {
  readonly buffer: readonly string[];
  readonly optionsTerminated: boolean;
  readonly failure: ConsumingFailure;
}

type HintedContext<TState> = ParserContext<TState> & {
  readonly [passThroughFailure]?: FailureHint;
};

/**
 * Gets the sibling failure that prevents pass-through capture at this cursor.
 * Stale hints inherited through a successful child do not block later input.
 * @param context The pass-through parser's context.
 * @returns The failure at this cursor, or undefined if capture is allowed.
 * @internal
 */
export function getPassThroughFailure<TState>(
  context: ParserContext<TState>,
): ConsumingFailure | undefined {
  const hinted: HintedContext<TState> = context;
  const hint = hinted[passThroughFailure];
  return hint?.buffer === context.buffer &&
      hint.optionsTerminated === context.optionsTerminated
    ? hint.failure
    : undefined;
}

/**
 * Carries a sibling's consuming failure into a child parse call. Only
 * passThrough consults the hint; ordinary alternatives may still recover.
 * @param context The child context, without modifying the parent's context.
 * @param failure The deepest matching consuming failure at this input position.
 * @returns A context with a hint for active option-like input, or the original.
 * @internal
 */
export function withPassThroughFailure<TState>(
  context: ParserContext<TState>,
  failure: ConsumingFailure | undefined,
): ParserContext<TState> {
  const token = context.buffer[0];
  if (
    failure == null || failure.consumed < 1 || context.optionsTerminated ||
    token == null || token === "--" || !/^[-/+]/.test(token) ||
    (getPassThroughFailure(context)?.consumed ?? 0) >= failure.consumed
  ) {
    return context;
  }
  const hinted: HintedContext<TState> = {
    ...context,
    [passThroughFailure]: {
      buffer: context.buffer,
      optionsTerminated: context.optionsTerminated,
      failure,
    },
  };
  return hinted;
}

const capturePriority = Symbol("capturePriority");
type PrioritySource = Pick<
  Parser<Mode, unknown, unknown>,
  "priority" | "usage" | "initialState"
>;
interface CapturePriority<TState> {
  readonly ownerPriority: number;
  readonly priority: number;
  readonly getPriority?: (state: TState) => number | undefined;
}

/** Checks for capture through usage-preserving wrappers. @internal */
export function hasPassThroughUsage(usage: Usage): boolean {
  return usage.some((term) =>
    term.type === "passthrough" ||
    ((term.type === "optional" || term.type === "multiple") &&
      hasPassThroughUsage(term.terms)) ||
    (term.type === "exclusive" && term.terms.some(hasPassThroughUsage))
  );
}

/**
 * Gets the priority of reachable capture, respecting an explicit override.
 * @param parser The parser whose capture priority is needed.
 * @returns The capture priority, or undefined when capture is absent.
 * @internal
 */
export function getPassThroughPriority<TState>(
  parser: Pick<
    Parser<Mode, unknown, TState>,
    "priority" | "usage" | "initialState"
  >,
  state: TState = parser.initialState,
): number | undefined {
  if (!hasPassThroughUsage(parser.usage)) return undefined;
  const annotated: typeof parser & {
    readonly [capturePriority]?: CapturePriority<TState>;
  } = parser;
  const hint = annotated[capturePriority];
  return hint != null && hint.ownerPriority === parser.priority
    ? hint.getPriority == null ? hint.priority : hint.getPriority(state)
    : parser.priority;
}

/**
 * Records capture priority separately from unrelated children's priorities.
 * @param parser The newly constructed parser.
 * @param children Its transparent children.
 * @param getPriority Optional state-aware capture priority lookup.
 * @internal
 */
export function definePassThroughPriority<TState>(
  parser: Pick<Parser<Mode, unknown, TState>, "priority" | "initialState">,
  children: readonly PrioritySource[],
  getPriority?: (state: TState) => number | undefined,
): void {
  const priorities = children.filter((child) =>
    hasPassThroughUsage(child.usage)
  )
    .map((child) => getPassThroughPriority(child) ?? child.priority);
  if (priorities.length === 0) return;
  Object.defineProperty(parser, capturePriority, {
    value: {
      ownerPriority: parser.priority,
      priority: Math.max(...priorities),
      getPriority,
    } satisfies CapturePriority<TState>,
    enumerable: true,
  });
}

/**
 * Copies only a cursor-valid hint when rebuilding a child context.
 * @param context The successful child's context.
 * @returns Private hint properties, or an empty object for stale hints.
 * @internal
 */
export function getPassThroughFailureHint<TState>(
  context: ParserContext<TState>,
): {
  readonly [passThroughFailure]?: FailureHint;
} {
  const hinted: HintedContext<TState> = context;
  const hint = hinted[passThroughFailure];
  return hint != null && getPassThroughFailure(context) != null
    ? { [passThroughFailure]: hint }
    : {};
}

/** Finds a Boolean option through usage-preserving wrappers. */
function hasFlagUsage(usage: Usage, name: string): boolean {
  return usage.some((term) =>
    (term.type === "option" && term.metavar == null &&
      term.names.some((optionName) => optionName === name)) ||
    ((term.type === "optional" || term.type === "multiple") &&
      hasFlagUsage(term.terms, name)) ||
    (term.type === "exclusive" &&
      term.terms.some((terms) => hasFlagUsage(terms, name)))
  );
}

/** Matches exact options, attached values, and leading bundled flags. */
export function matchesOptionToken(
  parser: Pick<Parser, "leadingNames" | "usage">,
  token: string | undefined,
): boolean {
  if (token == null || token === "--" || !/^[-/+]/.test(token)) return false;
  if (parser.leadingNames.has(token)) return true;

  // Long and slash options can include attached values, whose complete token
  // is not itself a leading name.
  const slashOption = token.startsWith("/");
  const separator = slashOption
    ? token.indexOf(":")
    : token.startsWith("-")
    ? token.indexOf("=")
    : -1;
  if (
    separator > (slashOption ? 0 : 2) &&
    parser.leadingNames.has(token.slice(0, separator))
  ) return true;

  // Only Boolean short options accept bundles. A value option such as -m
  // does not recognize -mhello as an attached value.
  const shortName = token.slice(0, 2);
  return token.length > 2 && /^-[^-]$/.test(shortName) &&
    parser.leadingNames.has(shortName) && hasFlagUsage(parser.usage, shortName);
}

/** A known option reachable at the current parser state. @internal */
export interface OptionMatch {
  readonly priority: number;
  readonly continuesCommand: boolean;
}
const optionMatchKey = Symbol("optionMatch");
interface OptionMatcher<TState> {
  readonly ownerPriority: number;
  match(state: TState, token: string): OptionMatch | undefined;
}

/**
 * Records state-aware option matching without changing public leading names.
 * @param parser The newly constructed transparent parser.
 * @param match Finds a reachable known-option lane.
 * @internal
 */
export function defineOptionMatch<TState>(
  parser: Pick<Parser<Mode, unknown, TState>, "priority" | "initialState">,
  match: (state: TState, token: string) => OptionMatch | undefined,
): void {
  Object.defineProperty(parser, optionMatchKey, {
    value: { ownerPriority: parser.priority, match } satisfies OptionMatcher<
      TState
    >,
    enumerable: true,
  });
}

/**
 * Finds a matching option's actual priority, including selected command children.
 * @param parser The parser to inspect.
 * @param state Its current state.
 * @param token The current token.
 * @returns A reachable option match, or undefined.
 * @internal
 */
export function getOptionMatch<TState>(
  parser: Pick<
    Parser<Mode, unknown, TState>,
    "priority" | "initialState" | "usage" | "leadingNames"
  >,
  state: TState,
  token: string | undefined,
): OptionMatch | undefined {
  if (token == null || token === "--" || !/^[-/+]/.test(token)) {
    return undefined;
  }
  const annotated: typeof parser & {
    readonly [optionMatchKey]?: OptionMatcher<TState>;
  } = parser;
  const matcher = annotated[optionMatchKey];
  if (matcher != null) {
    const match = matcher.match(state, token);
    return match == null || matcher.ownerPriority === parser.priority
      ? match
      : { ...match, priority: parser.priority };
  }
  return matchesOptionToken(parser, token)
    ? { priority: parser.priority, continuesCommand: false }
    : undefined;
}

/**
 * Combines option matches while retaining active command continuation.
 * @param matches Matches from transparent children.
 * @returns Their highest priority and whether any matching command continues.
 * @internal
 */
export function combineOptionMatches(
  matches: readonly (OptionMatch | undefined)[],
): OptionMatch | undefined {
  const found = matches.filter((match) => match != null);
  return found.length === 0 ? undefined : {
    priority: Math.max(...found.map((match) => match.priority)),
    continuesCommand: found.some((match) => match.continuesCommand),
  };
}

const knownCompletionKey = Symbol("knownCompletion");
interface KnownCompletion<TState> {
  readonly complete: unknown;
  readonly value: (state: TState) => unknown;
}

/** Marks a completion value that can be inspected without running user code. @internal */
export function defineKnownCompletion<TState>(
  parser: Pick<Parser<Mode, unknown, TState>, "complete">,
  value: (state: TState) => unknown,
): void {
  Object.defineProperty(parser, knownCompletionKey, {
    value: { complete: parser.complete, value } satisfies KnownCompletion<
      TState
    >,
    enumerable: true,
  });
}

/** Looks up a known value only while the original completion is intact. @internal */
export function getKnownCompletion<TState>(
  parser: Pick<Parser<Mode, unknown, TState>, "complete">,
  state: TState,
): { readonly value: unknown } | undefined {
  const annotated: typeof parser & {
    readonly [knownCompletionKey]?: KnownCompletion<TState>;
  } = parser;
  const hint = annotated[knownCompletionKey];
  return hint != null && hint.complete === parser.complete
    ? { value: hint.value(state) }
    : undefined;
}

/** Combines the priorities of currently reachable capture lanes. @internal */
export function combinePassThroughPriorities(
  priorities: readonly (number | undefined)[],
): number | undefined {
  const found = priorities.filter((priority) => priority != null);
  return found.length === 0 ? undefined : Math.max(...found);
}
