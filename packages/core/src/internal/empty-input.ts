/**
 * Static facts about how built-in parsers behave when they receive no
 * tokens.  Combinators use these facts to annotate the usage groups they
 * produce with {@link UsageTerm} `acceptsEmpty`, so that usage formatters
 * can draw a group as omissible exactly when its producer accepts an empty
 * argument list.
 *
 * The facts are *sound but incomplete*: every rule below returns an unknown
 * fact (`undefined`) for any input it does not explicitly handle, and
 * undeclared custom parsers carry no facts. Facts are never inferred from
 * usage notation.
 * @internal
 * @module
 */
/**
 * The parser members that empty-input facts are bound to.
 * @internal
 */
export interface FactsTarget {
  readonly mode?: unknown;
  readonly parse: unknown;
  readonly complete: unknown;
  readonly initialState: unknown;
}

/**
 * The result of calling `parse()` on an empty buffer from a parser's
 * initial state.
 * @internal
 */
export type EmptyInputStep = "success" | "provisional" | "failure";

/**
 * Facts about a parser's behavior on an empty argument list.  Every member
 * is optional; an absent member means the fact is unknown.
 * @internal
 */
export interface EmptyInputFacts {
  /**
   * Facts valid when completion is called as a parse-phase probe. An absent
   * override means the internal facts hold in both phases.
   */
  readonly probe?: EmptyInputFacts;

  /**
   * The outcome of `parse()` on an empty buffer from the initial state.
   */
  readonly step?: EmptyInputStep;

  /**
   * The state that a successful or provisional empty step produces: either
   * the unchanged state that was passed in, or an exemplar of a fresh state.
   */
  readonly next?: EmptyStepState;

  /**
   * Whether `complete()` succeeds on the state produced by a successful or
   * provisional empty step.
   */
  readonly afterStep?: boolean;

  /**
   * Whether `complete()` succeeds on the initial state.
   */
  readonly fromInitial?: boolean;
}

/**
 * The state produced by a successful empty step.
 * @internal
 */
export type EmptyStepState =
  | { readonly unchanged: true }
  | {
    /**
     * Builds an exemplar of the resulting state from the state the step
     * started from, so that parts the step left untouched keep their
     * identity, as they do at runtime.
     */
    readonly state: (initialState: unknown) => unknown;
  };

/**
 * The state of an empty step that leaves its input state unchanged.
 * @internal
 */
export const UNCHANGED: EmptyStepState = Object.freeze({ unchanged: true });

/**
 * Returns the state that an empty step produces from the given initial
 * state.
 * @param next The step's resulting state.
 * @param initialState The state the step started from.
 * @returns The resulting state.
 * @internal
 */
export function resolveEmptyStepState(
  next: EmptyStepState,
  initialState: unknown,
): unknown {
  return "unchanged" in next ? initialState : next.state(initialState);
}

const emptyInputFactsKey: unique symbol = Symbol("emptyInputFacts");

interface StoredFacts {
  readonly facts: EmptyInputFacts;
  readonly parse: unknown;
  readonly complete: unknown;
  readonly mode: unknown;
  readonly initialState: InitialStateBinding;
}

type InitialStateBinding =
  | { readonly kind: "data"; readonly value: unknown }
  | { readonly kind: "accessor"; readonly get: unknown };

function initialStateBinding(parser: FactsTarget): InitialStateBinding {
  let target: object | null = parser;
  while (target != null) {
    const descriptor = Object.getOwnPropertyDescriptor(target, "initialState");
    if (descriptor != null) {
      return "value" in descriptor
        ? { kind: "data", value: descriptor.value }
        : { kind: "accessor", get: descriptor.get };
    }
    target = Object.getPrototypeOf(target);
  }
  return { kind: "data", value: undefined };
}

function sameInitialState(
  a: InitialStateBinding,
  b: InitialStateBinding,
): boolean {
  return a.kind === "data" && b.kind === "data"
    ? Object.is(a.value, b.value)
    : a.kind === "accessor" && b.kind === "accessor" && a.get === b.get;
}

type ParserWithFacts = {
  readonly [emptyInputFactsKey]?: StoredFacts;
};

const UNKNOWN: EmptyInputFacts = Object.freeze({});

/**
 * Attaches empty-input facts to a parser.  The facts are stored as a
 * non-enumerable property, so object spread does not copy them, and they
 * are bound to the parser's current `parse`, `complete`, and
 * `initialState`, and mode, so replacing any of those invalidates them.
 * State accessors are bound by getter identity without invoking them.
 * @param parser The parser to annotate.
 * @param facts The facts to attach.
 * @internal
 */
export function defineEmptyInputFacts(
  parser: FactsTarget,
  facts: EmptyInputFacts,
): void {
  if (Object.keys(facts).length < 1) {
    if (!Reflect.deleteProperty(parser, emptyInputFactsKey)) {
      throw new TypeError("Cannot clear empty-input facts on this parser.");
    }
    return;
  }
  Object.defineProperty(parser, emptyInputFactsKey, {
    value: {
      facts: Object.freeze({ ...facts }),
      parse: parser.parse,
      complete: parser.complete,
      mode: parser.mode,
      initialState: initialStateBinding(parser),
    } satisfies StoredFacts,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

/**
 * Returns the empty-input facts of a parser, or an empty object when the
 * facts are unknown.
 * @param parser The parser to inspect.
 * @returns The facts known for the parser.
 * @internal
 */
export function getEmptyInputFacts(
  parser: FactsTarget,
): EmptyInputFacts {
  if (!Object.hasOwn(parser, emptyInputFactsKey)) return UNKNOWN;
  const stored = (parser as ParserWithFacts)[emptyInputFactsKey];
  if (
    stored == null || stored.parse !== parser.parse ||
    stored.complete !== parser.complete || stored.mode !== parser.mode ||
    !sameInitialState(stored.initialState, initialStateBinding(parser))
  ) {
    return UNKNOWN;
  }
  return stored.facts;
}

/**
 * Copies facts for an explicitly transparent wrapper, preserving internal
 * state information only when its execution members match the source.
 * @param wrapper The receiving parser.
 * @param inner The wrapped parser.
 * @internal
 */
export function inheritEmptyInputFacts(
  wrapper: FactsTarget,
  inner: FactsTarget,
): void {
  const facts = getEmptyInputFacts(inner);
  const identical = wrapper.parse === inner.parse &&
    wrapper.complete === inner.complete &&
    sameInitialState(initialStateBinding(wrapper), initialStateBinding(inner));
  defineEmptyInputFacts(
    wrapper,
    identical ? facts : {
      ...(Object.keys(facts).length < 1 ? {} : {
        probe: facts.step === undefined ? {} : { step: facts.step },
      }),
      ...(facts.step === undefined ? {} : { step: facts.step }),
      ...(facts.afterStep === undefined ? {} : { afterStep: facts.afterStep }),
      ...(facts.fromInitial === undefined
        ? {}
        : { fromInitial: facts.fromInitial }),
    },
  );
}

/**
 * Returns whether `parse(parser, [])` succeeds, when that is known from the
 * facts.
 * @param facts The parser's facts.
 * @returns `true` or `false` when known, `undefined` otherwise.
 * @internal
 */
export function acceptsEmptyInput(
  facts: EmptyInputFacts,
): boolean | undefined {
  if (facts.step === "failure") return false;
  if (facts.step == null) return undefined;
  return facts.afterStep;
}

/**
 * Returns the facts of a parser that fails its empty step and whose
 * completion from the initial state has the given outcome.
 * @param fromInitial Whether completion from the initial state succeeds.
 * @returns The facts.
 * @internal
 */
export function failingStepFacts(fromInitial: boolean): EmptyInputFacts {
  return { step: "failure", fromInitial };
}

/**
 * Returns whether `complete()` succeeds after the parser was offered an
 * empty step whose state change was kept (on success) or discarded (on
 * failure).
 * @param facts The parser's facts.
 * @returns The outcome, or `undefined` when unknown.
 * @internal
 */
export function completionAfterOptionalStep(
  facts: EmptyInputFacts,
): boolean | undefined {
  if (facts.step === "failure") return facts.fromInitial;
  if (facts.step == null) return undefined;
  return facts.afterStep;
}

/**
 * The state of a wrapper that stores its child's resulting state as the
 * only element of a fresh array.
 */
function wrapInFreshArray(
  child: EmptyStepState,
  childInitialState: unknown,
): EmptyStepState {
  return {
    state: () => [resolveEmptyStepState(child, childInitialState)],
  };
}

/**
 * Computes the facts of `optional(p)` and `withDefault(p, value)` when
 * completing the wrapper from its initial state is known to succeed.
 * @param child The facts of the wrapped parser.
 * @param childInitialState The wrapped parser's initial state.
 * @param fromInitial Whether completing the wrapper from its initial state
 *                    succeeds, or `undefined` when unknown.
 * @returns The facts of the wrapper.
 * @internal
 */
export function optionalLikeFacts(
  child: EmptyInputFacts,
  childInitialState: unknown,
  fromInitial: boolean | undefined,
): EmptyInputFacts {
  const facts = computeOptionalLikeFacts(child, childInitialState, fromInitial);
  return child.probe !== undefined
    ? {
      ...facts,
      probe: computeOptionalLikeFacts(
        probeFacts(child),
        childInitialState,
        fromInitial,
      ),
    }
    : facts;
}

function computeOptionalLikeFacts(
  child: EmptyInputFacts,
  childInitialState: unknown,
  fromInitial: boolean | undefined,
): EmptyInputFacts {
  if (child.step === "failure") {
    return {
      step: "success",
      next: UNCHANGED,
      afterStep: fromInitial,
      fromInitial,
    };
  }
  if (child.step == null) return { fromInitial };
  return {
    step: child.step,
    ...(child.next == null ? {} : {
      next: wrapInFreshArray(child.next, childInitialState),
    }),
    afterStep: child.afterStep,
    fromInitial,
  };
}

/**
 * Computes the facts of `multiple(p, { min })` without a `max` bound.
 * @param child The facts of the repeated parser.
 * @param retainsItem Whether a successful empty step of the child is kept
 *                    as a repetition item, or `undefined` when unknown.
 * @param childInitialState The repeated parser's initial state.
 * @param min The minimum number of items.
 * @returns The facts of the repetition.
 * @internal
 */
export function multipleFacts(
  child: EmptyInputFacts,
  retainsItem: boolean | undefined,
  childInitialState: unknown,
  min: number,
): EmptyInputFacts {
  const facts = computeMultipleFacts(
    child,
    retainsItem,
    childInitialState,
    min,
  );
  return child.probe !== undefined
    ? {
      ...facts,
      probe: computeMultipleFacts(
        probeFacts(child),
        retainsItem,
        childInitialState,
        min,
      ),
    }
    : facts;
}

function computeMultipleFacts(
  child: EmptyInputFacts,
  retainsItem: boolean | undefined,
  childInitialState: unknown,
  min: number,
): EmptyInputFacts {
  const fromInitial = min < 1;
  if (child.step === "failure") {
    return min < 1
      ? {
        step: "success",
        next: UNCHANGED,
        afterStep: true,
        fromInitial,
      }
      : { step: "failure", fromInitial };
  }
  if (child.step == null || retainsItem == null) return { fromInitial };
  if (!retainsItem) {
    return {
      step: "success",
      next: UNCHANGED,
      afterStep: min < 1,
      fromInitial,
    };
  }
  return {
    step: child.step,
    ...(child.next == null ? {} : {
      next: wrapInFreshArray(child.next, childInitialState),
    }),
    afterStep: child.afterStep == null ? undefined : min <= 1 &&
      child.afterStep,
    fromInitial,
  };
}

/**
 * A branch of an exclusive combinator as seen by the empty-input rules.
 * @internal
 */
export interface ExclusiveBranch {
  readonly facts: EmptyInputFacts;
  /** Whether the branch could match a token (named or catch-all). */
  readonly matchesTokens: boolean;
}

function selectZeroInputCandidate(
  branches: readonly ExclusiveBranch[],
): { readonly index: number } | null | undefined {
  let index = -1;
  let count = 0;
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    if (branch.matchesTokens) continue;
    if (branch.facts.step == null) return undefined;
    if (branch.facts.step !== "success") continue;
    if (index < 0) index = i;
    count++;
  }
  return count === 1 ? { index } : null;
}

/**
 * Computes the completion of `or()` and `longestMatch()` from their initial
 * state, which selects the unique zero-input candidate among the branches
 * that cannot match tokens.
 */
function exclusiveFromInitial(
  branches: readonly ExclusiveBranch[],
): boolean | undefined {
  const candidate = selectZeroInputCandidate(branches);
  if (candidate === undefined) return undefined;
  if (candidate === null) return false;
  return branches[candidate.index].facts.afterStep;
}

/**
 * An exemplar of an exclusive combinator's state after it selected a branch.
 * It is a fresh, non-nullish value, which is all that repetition item checks
 * look at.
 */
function exclusiveNextState(index: number): EmptyStepState {
  return { state: () => [index, { success: true, consumed: [] }] };
}

/**
 * Computes the facts of `or()`.
 * @param branches The branches of the exclusive combinator.
 * @returns The facts of the combinator.
 * @internal
 */
export function orFacts(
  branches: readonly ExclusiveBranch[],
): EmptyInputFacts {
  const facts = computeOrFacts(branches);
  return branches.some((c) => c.facts.probe !== undefined)
    ? {
      ...facts,
      probe: computeOrFacts(
        branches.map((b) => ({ ...b, facts: probeFacts(b.facts) })),
      ),
    }
    : facts;
}

function computeOrFacts(
  branches: readonly ExclusiveBranch[],
): EmptyInputFacts {
  const candidate = selectZeroInputCandidate(branches);
  if (candidate === undefined) return {};
  const fromInitial = exclusiveFromInitial(branches);
  if (candidate === null) return { step: "failure", fromInitial };
  return {
    step: "success",
    next: exclusiveNextState(candidate.index),
    afterStep: branches[candidate.index].facts.afterStep,
    fromInitial,
  };
}

/**
 * Computes the facts of `longestMatch()`, which selects the first branch
 * whose empty step succeeds, preferring a definitive success over a
 * provisional one.
 * @param branches The branches of the exclusive combinator.
 * @returns The facts of the combinator.
 * @internal
 */
export function longestMatchFacts(
  branches: readonly ExclusiveBranch[],
): EmptyInputFacts {
  const facts = computeLongestMatchFacts(branches);
  return branches.some((c) => c.facts.probe !== undefined)
    ? {
      ...facts,
      probe: computeLongestMatchFacts(
        branches.map((b) => ({ ...b, facts: probeFacts(b.facts) })),
      ),
    }
    : facts;
}

function computeLongestMatchFacts(
  branches: readonly ExclusiveBranch[],
): EmptyInputFacts {
  const fromInitial = exclusiveFromInitial(branches);
  let best: { readonly index: number; readonly facts: EmptyInputFacts } | null =
    null;
  for (let i = 0; i < branches.length; i++) {
    const facts = branches[i].facts;
    if (facts.step == null) return { fromInitial };
    if (facts.step === "failure") continue;
    if (
      best == null ||
      (best.facts.step === "provisional" && facts.step === "success")
    ) {
      best = { index: i, facts };
    }
    if (best.facts.step === "success") break;
  }
  if (best == null) return { step: "failure", fromInitial };
  return {
    // longestMatch() commits even a provisional candidate definitively.
    step: "success",
    next: exclusiveNextState(best.index),
    afterStep: best.facts.afterStep,
    fromInitial,
  };
}

function all(values: readonly (boolean | undefined)[]): boolean | undefined {
  let unknown = false;
  for (const value of values) {
    if (value === false) return false;
    if (value == null) unknown = true;
  }
  return unknown ? undefined : true;
}

/**
 * A child of a sequential combinator as seen by the empty-input rules.
 * @internal
 */
export interface SequentialChild {
  readonly facts: EmptyInputFacts;
  /** Whether the child could match a token (named or catch-all). */
  readonly matchesTokens: boolean;
}

/**
 * Computes the facts of `tuple()`.  On an empty buffer `tuple()` offers
 * each child one zero-token step, stores the state of every child whose
 * step succeeded in a fresh state array, and skips the rest.
 * @param children The children in declaration order.
 * @returns The facts of the tuple.
 * @internal
 */
export function tupleFacts(
  children: readonly SequentialChild[],
): EmptyInputFacts {
  const facts = computeTupleFacts(children);
  return children.some((c) => c.facts.probe !== undefined)
    ? {
      ...facts,
      probe: computeTupleFacts(
        children.map((c) => ({ ...c, facts: probeFacts(c.facts) })),
      ),
    }
    : facts;
}

function computeTupleFacts(
  children: readonly SequentialChild[],
): EmptyInputFacts {
  const fromInitial = all(children.map((c) => c.facts.fromInitial));
  if (children.some((c) => c.facts.step == null)) {
    return { step: "success", fromInitial };
  }
  const afterStep = all(
    children.map((c) => completionAfterOptionalStep(c.facts)),
  );
  let next: EmptyStepState | undefined;
  if (children.every((c) => c.facts.step === "failure")) {
    next = UNCHANGED;
  } else if (
    children.every((c) => c.facts.step === "failure" || c.facts.next != null)
  ) {
    // tuple() passes each child its slot of the tuple state and copies the
    // slots into a fresh array.
    const steps = children.map((c) =>
      c.facts.step === "failure" ? undefined : c.facts.next
    );
    next = {
      state: (initialState) => {
        const slots = Array.isArray(initialState) ? initialState : [];
        return steps.map((step, i) =>
          step == null ? slots[i] : resolveEmptyStepState(step, slots[i])
        );
      },
    };
  }
  return {
    step: "success",
    ...(next == null ? {} : { next }),
    afterStep,
    fromInitial,
  };
}

/**
 * The state of `object()` after an empty step: a committed field state makes
 * it store a fresh record with the other fields unchanged.
 */
function objectNextState(
  changed: readonly (readonly [PropertyKey, EmptyStepState])[],
): EmptyStepState {
  if (changed.length < 1) return UNCHANGED;
  return {
    state: (initialState) => {
      const record: Record<PropertyKey, unknown> =
        initialState != null && typeof initialState === "object"
          ? { ...initialState }
          : {};
      for (const [key, next] of changed) {
        record[key] = resolveEmptyStepState(next, record[key]);
      }
      return record;
    },
  };
}

/**
 * Computes the facts of a synchronous `object()`.  On an empty buffer
 * `object()` offers each field that cannot match tokens one zero-token
 * step, keeps the resulting state when it changed, and then succeeds only
 * if every field can complete.
 * @param children The fields.
 * @param keys The field keys, parallel to `children`.
 * @returns The facts of the object.
 * @internal
 */
export function objectFacts(
  children: readonly SequentialChild[],
  keys: readonly PropertyKey[],
): EmptyInputFacts {
  const completion = computeObjectFacts(children, keys);
  if (!children.some((c) => c.facts.probe !== undefined)) return completion;
  // object() decides its empty parse step using completion in the parse
  // phase. Public completion outcomes cannot prove that probe succeeds.
  const probe = computeObjectFacts(
    children.map((c) => ({ ...c, facts: probeFacts(c.facts) })),
    keys,
  );
  return {
    ...probe,
    fromInitial: completion.fromInitial,
    afterStep: probe.step === "success" ? completion.afterStep : undefined,
    probe,
  };
}

function computeObjectFacts(
  children: readonly SequentialChild[],
  keys: readonly PropertyKey[],
): EmptyInputFacts {
  const fromInitial = all(children.map((c) => c.facts.fromInitial));
  const outcomes: (boolean | undefined)[] = [];
  const changed: [PropertyKey, EmptyStepState][] = [];
  let nextKnown = true;
  for (const [i, child] of children.entries()) {
    const { step, next } = child.facts;
    if (child.matchesTokens || step === "failure") {
      outcomes.push(child.facts.fromInitial);
    } else if (step == null) {
      outcomes.push(undefined);
      nextKnown = false;
    } else if (next == null) {
      nextKnown = false;
      outcomes.push(
        child.facts.afterStep === child.facts.fromInitial
          ? child.facts.afterStep
          : undefined,
      );
    } else if ("unchanged" in next) {
      // object() keeps the field's initial state when the step left it
      // unchanged.
      outcomes.push(child.facts.fromInitial);
    } else {
      changed.push([keys[i], next]);
      outcomes.push(child.facts.afterStep);
    }
  }
  const accepted = all(outcomes);
  if (accepted == null) return { fromInitial };
  if (!accepted) return { step: "failure", fromInitial };
  return {
    step: "success",
    ...(nextKnown ? { next: objectNextState(changed) } : {}),
    afterStep: true,
    fromInitial,
  };
}

/**
 * Attaches empty-input facts to a parser and returns the parser.
 * @param parser The parser to annotate.
 * @param facts The facts to attach.
 * @returns The same parser.
 * @internal
 */
export function withEmptyInputFacts<P extends FactsTarget>(
  parser: P,
  facts: EmptyInputFacts,
): P {
  defineEmptyInputFacts(parser, facts);
  return parser;
}

function probeFacts(facts: EmptyInputFacts): EmptyInputFacts {
  return facts.probe ?? facts;
}
