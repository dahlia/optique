import type { Message } from "../message.ts";
import type { ParserContext } from "../parser.ts";

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
 * @param failure The first consuming failure at this input position.
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
    getPassThroughFailure(context) != null
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
