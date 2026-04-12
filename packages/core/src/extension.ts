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

import type { Mode, Parser } from "./parser.ts";
import {
  annotationWrapperRequiresSourceBindingKey,
  composeWrappedSourceMetadata,
  defineInheritedAnnotationParser,
  getDelegatingSuggestRuntimeNodes,
  inheritParentAnnotationsKey,
  unmatchedNonCliDependencySourceStateMarker,
} from "./parser.ts";

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
