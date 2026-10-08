/**
 * Public helpers for parser-extension authors.
 *
 * This module exposes the stable coordination points that first-party and
 * custom parser extensions need when they preserve annotations, participate in
 * source-backed completion, or compose suggest-time dependency metadata.
 *
 * @module
 * @since 1.0.0
 */

import { inheritOptionScope as inheritScope } from "./short-option.ts";
import { defineReachableChildren } from "./internal/passthrough.ts";

import type { Mode, Parser } from "./parser.ts";
import {
  defineEmptyInputFacts,
  getEmptyInputFacts,
  inheritEmptyInputFacts,
} from "./internal/empty-input.ts";
import {
  annotationWrapperRequiresSourceBindingKey,
  composeWrappedSourceMetadata,
  defineInheritedAnnotationParser,
  getDelegatingSuggestRuntimeNodes,
  inheritParentAnnotationsKey,
  unmatchedNonCliDependencySourceStateMarker,
} from "./internal/parser.ts";

export {
  inheritAnnotations,
  injectAnnotations,
  isInjectedAnnotationState,
  unwrapInjectedAnnotationState,
} from "./internal/annotations.ts";
export { withAnnotationView } from "./annotation-state.ts";
export {
  dispatchByMode,
  mapModeValue,
  wrapForMode,
} from "./internal/mode-dispatch.ts";
export { extractPhase2SeedKey } from "./phase2-seed.ts";

/**
 * Stable trait flags for custom parser extensions.
 *
 * @since 1.0.0
 */
export interface ParserTraits {
  /**
   * Whether parent-state annotations should be injected into rebuilt child
   * states instead of relying on structural inheritance.
   */
  readonly inheritsAnnotations?: true;

  /**
   * Whether a missing CLI state can still complete from a source-backed
   * fallback such as config or environment data.
   */
  readonly completesFromSource?: true;

  /**
   * Whether annotation-only primitive states should count as completable only
   * when they come from a nested source-bound parser.
   */
  readonly requiresSourceBinding?: true;
}

/**
 * Suggest-time runtime node used to seed dependency-aware completion.
 *
 * @since 1.0.0
 */
export interface SuggestNode {
  /** Path from the root parser to this node. */
  readonly path: readonly PropertyKey[];

  /** The parser whose dependency metadata should be inspected. */
  readonly parser: Parser<Mode, unknown, unknown>;

  /** Current parser state for this node. */
  readonly state: unknown;

  /** Whether this node reflects explicit input consumption. */
  readonly matched?: boolean;

  /** Snapshotted default dependency values for derived parsers. */
  readonly defaultDependencyValues?: readonly unknown[];
}

/**
 * Public view of a parser's source capability metadata.
 *
 * @since 1.0.0
 */
export type ParserSourceMetadata<
  M extends Mode = Mode,
  TValue = unknown,
  TState = unknown,
> = NonNullable<
  NonNullable<Parser<M, TValue, TState>["dependencyMetadata"]>["source"]
>;

const emptyTraits: Readonly<ParserTraits> = Object.freeze({});

/**
 * Defines stable extension traits on a parser object.
 *
 * @param parser The parser object to annotate.
 * @param traits Traits to enable.
 * @throws {TypeError} If a trait property cannot be defined on `parser`.
 * @since 1.0.0
 */
export function defineTraits(parser: object, traits: ParserTraits): void {
  if (traits.inheritsAnnotations === true) {
    defineInheritedAnnotationParser(parser);
  }
  if (traits.completesFromSource === true) {
    Object.defineProperty(parser, unmatchedNonCliDependencySourceStateMarker, {
      value: true,
      configurable: true,
      // Keep this trait enumerable so wrappers cloned with object spread, such
      // as map(), preserve source-backed completion behavior.
      enumerable: true,
    });
  }
  if (traits.requiresSourceBinding === true) {
    Object.defineProperty(parser, annotationWrapperRequiresSourceBindingKey, {
      value: true,
      configurable: true,
      enumerable: false,
    });
  }
}

/**
 * Preserves a wrapped parser's reachable option names in the same parse path.
 * Call this when a transparent wrapper constructs a fresh parser object instead
 * of copying the inner parser with object spread.
 *
 * @param parser The wrapper parser to annotate.
 * @param innerParser The parser that handles the wrapper's CLI input.
 * @throws {TypeError} If scope metadata cannot be defined on the wrapper.
 * @since 1.4.0
 */
export function inheritOptionScope(
  parser: object,
  innerParser: Parser<Mode, unknown, unknown>,
): void {
  inheritScope(parser, innerParser);
}

/**
 * Reads the stable extension traits defined on a parser object.
 *
 * @param parser The parser object to inspect.
 * @returns The enabled traits.  Returns an empty object when none are set.
 * @since 1.0.0
 */
export function getTraits(parser: object): ParserTraits {
  const traits: ParserTraits = {
    ...(Reflect.get(parser, inheritParentAnnotationsKey) === true
      ? { inheritsAnnotations: true as const }
      : {}),
    ...(Reflect.get(parser, unmatchedNonCliDependencySourceStateMarker) === true
      ? { completesFromSource: true as const }
      : {}),
    ...(Reflect.get(parser, annotationWrapperRequiresSourceBindingKey) === true
      ? { requiresSourceBinding: true as const }
      : {}),
  };
  return Object.keys(traits).length > 0 ? traits : emptyTraits;
}

/**
 * Delegates suggest-time runtime nodes to an inner parser while preserving an
 * outer parser's own source metadata node.
 *
 * @param innerParser The wrapped parser that owns the underlying nodes.
 * @param outerParser The outer parser that may contribute its own source node.
 * @param state The outer parser state.
 * @param path The parser path within the parse tree.
 * @param innerState The state to use when collecting inner nodes.
 * @param position Whether the outer node is appended or prepended.
 * @returns The composed runtime nodes.
 * @since 1.0.0
 */
export function delegateSuggestNodes<TInnerState>(
  innerParser: Parser<Mode, unknown, TInnerState>,
  outerParser: Parser<Mode, unknown, unknown>,
  state: unknown,
  path: readonly PropertyKey[],
  innerState: TInnerState,
  position: "append" | "prepend" = "append",
): readonly SuggestNode[] {
  return getDelegatingSuggestRuntimeNodes(
    innerParser,
    outerParser,
    state,
    path,
    innerState,
    position,
  ) as readonly SuggestNode[];
}

/**
 * Maps the source capability of a parser's dependency metadata while
 * preserving any derived or transform capabilities unchanged.
 *
 * @param parser The parser whose source metadata should be transformed.
 * @param mapSource Function that transforms the source capability.
 * @returns The dependency metadata with its source capability transformed when
 *          present; otherwise the original dependency metadata, or
 *          `undefined` when the parser has no dependency metadata.
 * @since 1.0.0
 */
export function mapSourceMetadata<M extends Mode, TValue, TState>(
  parser: Pick<Parser<M, TValue, TState>, "dependencyMetadata">,
  mapSource: (
    source: ParserSourceMetadata<M, TValue, TState>,
  ) => ParserSourceMetadata<M, TValue, TState>,
): Parser<M, TValue, TState>["dependencyMetadata"] | undefined {
  return composeWrappedSourceMetadata(
    parser.dependencyMetadata,
    mapSource,
  ) as Parser<M, TValue, TState>["dependencyMetadata"] | undefined;
}

/**
 * Delegates CLI option matching and capture priority through a parser wrapper.
 * Use the same child-state projection as the wrapper's parse method. This
 * preserves selected command options without changing public leading names.
 *
 * @param wrapper The parser being constructed.
 * @param inner Its wrapped CLI parser.
 * @param getInnerState Projects the wrapper state to the CLI parser state.
 * @throws {TypeError} If metadata cannot be defined on the wrapper.
 * @since 1.0.11
 */
export function delegateOptionParsing<TOuterState, TInnerState>(
  wrapper: Parser<Mode, unknown, TOuterState>,
  inner: Parser<Mode, unknown, TInnerState>,
  getInnerState: (state: TOuterState) => TInnerState,
): void {
  defineReachableChildren(wrapper, [inner], (state) => [{
    parser: inner,
    state: getInnerState(state),
  }]);
}

/**
 * Static, context-independent facts about a parser's empty-input behavior.
 * An omitted field means unknown. Declarations are trusted without executing
 * the parser, its sources, or its completion callbacks.
 *
 * @since 1.4.0
 */
export interface EmptyInputBehavior {
  /**
   * The outcome of parse() from the initial state with an empty buffer and
   * options not terminated. "provisional" means success with provisional: true.
   * No tokens can be consumed from the empty buffer, including on failure.
   */
  readonly step?: "success" | "provisional" | "failure";
  /**
   * Whether complete() succeeds in the completion phase on the state left by
   * a successful or provisional empty step. Omit when step is "failure".
   */
  readonly afterStep?: boolean;
  /** Whether complete() succeeds in the completion phase from initialState. */
  readonly fromInitial?: boolean;
}

/**
 * Declares a parser's static empty-input behavior for usage-group formatting.
 * Facts must hold across runtime annotations and source contexts; omit outcomes
 * that depend on them. These facts do not change parsing or branch eligibility
 * (leadingNames and acceptingAnyToken still determine eligibility).
 *
 * The declaration replaces any prior facts, and an empty object clears them.
 * It is copied and frozen, bound to parse(), complete(), mode and initialState,
 * and not copied by object spread. State getters are bound by identity without
 * invoking them. Declare after finalizing methods and before composing parsers:
 * combinators capture facts and usage at construction. Later closure or in-place
 * state mutations cannot be detected. Initial-state getters must remain cheap,
 * side-effect free and semantically stable.
 *
 * State-shape information remains internal, so a declared successful empty step
 * alone cannot determine whether multiple() retains a repetition item.
 *
 * @param parser The parser to annotate.
 * @param behavior The known outcomes; omitted fields stay unknown.
 * @returns Nothing; updates the parser's metadata in place.
 * @throws {TypeError} If a value is invalid, afterStep is supplied for a failing
 *                    step, or the metadata cannot be defined or cleared.
 * @since 1.4.0
 */
export function defineEmptyInputBehavior(
  parser: Parser<Mode, unknown, unknown>,
  behavior: EmptyInputBehavior,
): void {
  if (
    behavior.step !== undefined && behavior.step !== "success" &&
    behavior.step !== "provisional" && behavior.step !== "failure"
  ) {
    throw new TypeError("Invalid empty-input step.");
  }
  if (
    (behavior.afterStep !== undefined &&
      typeof behavior.afterStep !== "boolean") ||
    (behavior.fromInitial !== undefined &&
      typeof behavior.fromInitial !== "boolean")
  ) {
    throw new TypeError("Empty-input completion outcomes must be booleans.");
  }
  if (behavior.step === "failure" && behavior.afterStep !== undefined) {
    throw new TypeError("A failing empty-input step has no completion state.");
  }
  const facts = projectEmptyInputBehavior(behavior);
  defineEmptyInputFacts(
    parser,
    Object.keys(facts).length < 1 ? {} : {
      ...facts,
      probe: facts.step === undefined ? {} : { step: facts.step },
    },
  );
}

/**
 * Reads known empty-input outcomes without executing the parser or its state
 * getter. Returns a frozen object; absent or invalidated facts read as unknown.
 * Internal state-shape information is never exposed.
 * @param parser The parser to inspect.
 * @returns The known public facts, with unknown fields omitted.
 * @since 1.4.0
 */
export function getEmptyInputBehavior(
  parser: Parser<Mode, unknown, unknown>,
): EmptyInputBehavior {
  return projectEmptyInputBehavior(getEmptyInputFacts(parser));
}

/**
 * Preserves empty-input facts when constructing a transparent parser wrapper.
 * Calling this asserts that the wrapper preserves the three public outcomes.
 * A wrapper that changes completion or empty-step semantics must instead use
 * getEmptyInputBehavior() and defineEmptyInputBehavior() for the valid subset.
 *
 * Internal probe-completion and repetition-state facts are preserved only
 * when parse(),
 * complete(), and the initial-state binding are identical. Spreading a parser
 * with a state getter snapshots its value and loses those facts; preserve
 * its property descriptors or delegate through its prototype to keep the getter.
 * Unknown source facts clear the destination. Finalize both parsers before
 * inheritance and keep them immutable after composing them.
 *
 * @param wrapper The parser receiving the facts.
 * @param inner The parser whose behavior is preserved.
 * @returns Nothing; updates the wrapper's metadata in place.
 * @throws {TypeError} If modes differ or metadata cannot be defined or cleared.
 * @since 1.4.0
 */
export function inheritEmptyInputBehavior(
  wrapper: Parser<Mode, unknown, unknown>,
  inner: Parser<Mode, unknown, unknown>,
): void {
  if (wrapper.mode !== inner.mode) {
    throw new TypeError(
      "Cannot inherit empty-input behavior across parser modes.",
    );
  }
  inheritEmptyInputFacts(wrapper, inner);
}

function projectEmptyInputBehavior(
  behavior: EmptyInputBehavior,
): EmptyInputBehavior {
  return Object.freeze({
    ...(behavior.step === undefined ? {} : { step: behavior.step }),
    ...(behavior.afterStep === undefined
      ? {}
      : { afterStep: behavior.afterStep }),
    ...(behavior.fromInitial === undefined
      ? {}
      : { fromInitial: behavior.fromInitial }),
  });
}
