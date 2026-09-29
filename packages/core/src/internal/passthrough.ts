import type { Message } from "../message.ts";
import type { Usage } from "../usage.ts";
import type { Mode, Parser, ParserContext } from "../parser.ts";

/** A prioritized consuming failure at the current input position. */
export interface ConsumingFailure {
  readonly failure: {
    readonly success: false;
    readonly consumed: number;
    readonly error: Message;
  };
  readonly priority: number;
}

/** Retains the deepest diagnostic and highest matching lane priority. @internal */
export function retainConsumingFailure(
  current: ConsumingFailure | undefined,
  failure: ConsumingFailure["failure"],
  priority: number,
): ConsumingFailure {
  return {
    failure: current != null && current.failure.consumed >= failure.consumed
      ? current.failure
      : failure,
    priority: Math.max(current?.priority ?? -Infinity, priority),
  };
}

const passThroughFailure = Symbol("passThroughFailure");

interface FailureHint {
  readonly buffer: readonly string[];
  readonly optionsTerminated: boolean;
  readonly failure: ConsumingFailure;
  readonly own?: ConsumingFailure;
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
  capturePriority = -Infinity,
): ConsumingFailure | undefined {
  const hinted: HintedContext<TState> = context;
  const hint = hinted[passThroughFailure];
  return hint?.buffer === context.buffer &&
      hint.optionsTerminated === context.optionsTerminated &&
      hint.failure.priority >= capturePriority
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
  capturePriority = -Infinity,
): ParserContext<TState> {
  // Local provenance travels upward only. A sibling's blocking hint must
  // never become this child's own diagnostic just because it echoes context.
  const incoming: HintedContext<TState> = context;
  if (incoming[passThroughFailure]?.own != null) {
    const { own: _own, ...hint } = incoming[passThroughFailure];
    const stripped: HintedContext<TState> = {
      ...context,
      [passThroughFailure]: hint,
    };
    context = stripped;
  }
  const token = context.buffer[0];
  const existing = getPassThroughFailure(context);
  if (existing != null && existing.priority < capturePriority) {
    const hinted: HintedContext<TState> = context;
    const { [passThroughFailure]: _discarded, ...rest } = hinted;
    context = rest;
  }
  if (
    failure == null || failure.failure.consumed < 1 ||
    failure.priority < capturePriority ||
    context.optionsTerminated || token == null || token === "--" ||
    !/^[-/+]/.test(token)
  ) {
    return context;
  }
  const retained = getPassThroughFailure(context);
  const combined = retainConsumingFailure(
    retained,
    failure.failure,
    failure.priority,
  );
  const hinted: HintedContext<TState> = {
    ...context,
    [passThroughFailure]: {
      buffer: context.buffer,
      optionsTerminated: context.optionsTerminated,
      failure: combined,
    },
  };
  return hinted;
}

/** Reads locally originated diagnostics at the same cursor. @internal */
export function getOwnConsumingFailure<TState>(
  context: ParserContext<TState>,
): ConsumingFailure | undefined {
  const hinted: HintedContext<TState> = context;
  const hint = hinted[passThroughFailure];
  return hint?.buffer === context.buffer &&
      hint.optionsTerminated === context.optionsTerminated
    ? hint.own
    : undefined;
}

/**
 * Returns a successful child's local diagnostic to its parent without merging
 * its provenance with an inherited sibling diagnostic. Both share a cursor.
 * @internal
 */
export function withReturnedConsumingFailure<TState>(
  context: ParserContext<TState>,
  failure: ConsumingFailure | undefined,
): ParserContext<TState> {
  const next = withPassThroughFailure(context, failure);
  if (failure == null || getPassThroughFailure(next) == null) return next;
  const token = next.buffer[0];
  if (
    next.optionsTerminated || token == null || token === "--" ||
    !/^[-/+]/.test(token) || failure.failure.consumed < 1
  ) return next;
  const hinted: HintedContext<TState> = next;
  const hint = hinted[passThroughFailure];
  if (hint == null) return next;
  const returned: HintedContext<TState> = {
    ...next,
    [passThroughFailure]: { ...hint, own: failure },
  };
  return returned;
}

/** Retains a child's own rejected option failure at the parent's cursor. @internal */
export function retainConsumingFailureHint<TState, TChildState>(
  current: ConsumingFailure | undefined,
  context: ParserContext<TState>,
  next: ParserContext<TChildState>,
): ConsumingFailure | undefined {
  if (
    next.buffer !== context.buffer ||
    next.optionsTerminated !== context.optionsTerminated
  ) return current;
  const own = getOwnConsumingFailure(next);
  return own == null || own === getOwnConsumingFailure(context)
    ? current
    : retainConsumingFailure(current, own.failure, own.priority);
}

const capturePriority = Symbol("capturePriority");
type PrioritySource = Pick<
  Parser<Mode, unknown, unknown>,
  "priority" | "usage" | "initialState"
>;
interface CapturePriority<TState> {
  readonly ownerPriority: number;
  readonly priority: number;
  readonly getPriority?: (state: TState, token?: string) => number | undefined;
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
 * @param state The current parser state.
 * @param token The current token, omitted for an unfiltered priority lookup.
 * @returns The capture priority, or undefined when capture is absent.
 * @internal
 */
export function getPassThroughPriority<TState>(
  parser: Pick<
    Parser<Mode, unknown, TState>,
    "priority" | "usage" | "initialState"
  >,
  state: TState = parser.initialState,
  token?: string,
): number | undefined {
  if (!hasPassThroughUsage(parser.usage)) return undefined;
  const annotated: typeof parser & {
    readonly [capturePriority]?: CapturePriority<TState>;
  } = parser;
  const hint = annotated[capturePriority];
  if (hint == null) return parser.priority;
  const priority = hint.getPriority == null
    ? hint.priority
    : hint.getPriority(state, token);
  return priority == null
    ? undefined
    : hint.ownerPriority === parser.priority
    ? priority
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
  getPriority?: (state: TState, token?: string) => number | undefined,
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
  readonly value: (state: TState) => { readonly value: unknown } | undefined;
}

/** Marks a completion value that can be inspected without running user code. @internal */
export function defineKnownCompletion<TState>(
  parser: Pick<Parser<Mode, unknown, TState>, "complete">,
  value: (state: TState) => unknown,
): void {
  defineKnownCompletionLookup(parser, (state) => ({ value: value(state) }));
}

/** Registers a known-value lookup that may decline unknown completion. @internal */
export function defineKnownCompletionLookup<TState>(
  parser: Pick<Parser<Mode, unknown, TState>, "complete">,
  value: (state: TState) => { readonly value: unknown } | undefined,
): void {
  Object.defineProperty(parser, knownCompletionKey, {
    value: {
      complete: parser.complete,
      value,
    } satisfies KnownCompletion<
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
    ? hint.value(state)
    : undefined;
}

/** Combines the priorities of currently reachable capture lanes. @internal */
export function combinePassThroughPriorities(
  priorities: readonly (number | undefined)[],
): number | undefined {
  const found = priorities.filter((priority) => priority != null);
  return found.length === 0 ? undefined : Math.max(...found);
}

/** Forwards known completion through a state-preserving wrapper. @internal */
export function delegateKnownCompletion<TState>(
  wrapper: Pick<Parser<Mode, unknown, TState>, "complete">,
  inner: Pick<Parser<Mode, unknown, TState>, "complete">,
): void {
  Object.defineProperty(wrapper, knownCompletionKey, {
    value: {
      complete: wrapper.complete,
      value: (state: TState) => getKnownCompletion(inner, state),
    } satisfies KnownCompletion<TState>,
    enumerable: true,
  });
}

/** A structurally reachable child and its parse-time state. @internal */
export interface ReachableChild<TState> {
  readonly parser: Pick<
    Parser<Mode, unknown, TState>,
    "priority" | "initialState" | "usage" | "leadingNames"
  >;
  readonly state: TState;
  readonly continuesCommand?: boolean;
}

/**
 * Installs option and capture inspection from one pure child-state selector.
 * Static children retain capture metadata even when no child is selected yet.
 * Selection must not execute parsing, completion, or user callbacks. Potential
 * alternatives remain candidates until parse-time replay or canSkip resolves
 * them; inspection cannot safely predict opaque custom parser callbacks.
 * @internal
 */
export function defineReachableChildren<TOuterState, TChildState>(
  parser: Pick<Parser<Mode, unknown, TOuterState>, "priority" | "initialState">,
  children: readonly PrioritySource[],
  select: (state: TOuterState) => readonly ReachableChild<TChildState>[],
): void {
  defineOptionMatch(
    parser,
    (state, token) =>
      combineOptionMatches(
        select(state).map((child) => {
          const match = getOptionMatch(child.parser, child.state, token);
          return match == null || !child.continuesCommand
            ? match
            : { ...match, continuesCommand: true };
        }),
      ),
  );
  definePassThroughPriority(
    parser,
    children,
    (state, token) =>
      combinePassThroughPriorities(
        select(state).map((child) =>
          getPassThroughPriority(child.parser, child.state, token)
        ),
      ),
  );
}
