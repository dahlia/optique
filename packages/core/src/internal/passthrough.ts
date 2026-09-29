import type { Message } from "../message.ts";
import type { Usage } from "../usage.ts";
import type { Parser, ParserContext } from "../parser.ts";

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
type PrioritySource = Pick<Parser, "priority" | "usage">;
interface CapturePriority {
  readonly ownerPriority: number;
  readonly priority: number;
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
export function getPassThroughPriority(
  parser: PrioritySource,
): number | undefined {
  if (!hasPassThroughUsage(parser.usage)) return undefined;
  const annotated: PrioritySource & {
    readonly [capturePriority]?: CapturePriority;
  } = parser;
  const hint = annotated[capturePriority];
  return hint != null && hint.ownerPriority === parser.priority
    ? hint.priority
    : parser.priority;
}

/**
 * Records capture priority separately from unrelated children's priorities.
 * @param parser The newly constructed parser.
 * @param children Its transparent children.
 * @internal
 */
export function definePassThroughPriority(
  parser: Pick<Parser, "priority">,
  children: readonly PrioritySource[],
): void {
  const priorities = children.map(getPassThroughPriority).filter((priority) =>
    priority != null
  );
  if (priorities.length === 0) return;
  Object.defineProperty(parser, capturePriority, {
    value: {
      ownerPriority: parser.priority,
      priority: Math.max(...priorities),
    } satisfies CapturePriority,
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
