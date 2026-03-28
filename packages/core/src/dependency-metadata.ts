/**
 * Parser dependency metadata and capability interfaces.
 *
 * Wrappers and parsers describe dependency behavior through metadata and
 * capabilities instead of manufacturing or forwarding dependency-state
 * wrappers.  This module defines the capability types and provides bridge
 * functions that extract metadata from the existing old-protocol markers.
 *
 * @internal
 * @since 1.0.0
 * @module
 */
import type { Suggestion } from "./parser.ts";
import {
  defaultValues,
  dependencyId,
  dependencyIds,
  isDependencySource,
  isDependencySourceState,
  isDerivedValueParser,
  parseWithDependency,
  singleDefaultValue,
  suggestWithDependency,
} from "./dependency.ts";
import type { Mode, ValueParser, ValueParserResult } from "./valueparser.ts";

// =============================================================================
// Capability interfaces
// =============================================================================

/**
 * Metadata for a parser that is a dependency source.
 *
 * @internal
 * @since 1.0.0
 */
export interface DependencySourceCapability {
  /** Discriminant tag. */
  readonly kind: "source";

  /** The unique dependency source identifier. */
  readonly sourceId: symbol;

  /**
   * Extracts the dependency source parse result from the parser's state.
   *
   * Each wrapper composes this method to handle its state shape:
   * - plain source: reads from `DependencySourceState`
   * - `optional()` / `withDefault()`: unwraps `[innerState]` first
   * - `map()`: reads the pre-transform value from inner state
   *
   * Returns the `ValueParserResult` (which may be successful with any
   * value including `undefined`, or failed), or `undefined` if the state
   * does not contain a source result at all (unpopulated / wrong shape).
   */
  readonly extractSourceValue: (
    state: unknown,
  ) => ValueParserResult<unknown> | undefined;

  /**
   * When present, provides a missing-source value (e.g., from a
   * `withDefault()` wrapper).  Called during the `fillMissingSourceDefaults`
   * phase of the dependency runtime.
   */
  readonly getMissingSourceValue?: () =>
    | ValueParserResult<unknown>
    | Promise<ValueParserResult<unknown>>;

  /**
   * Whether the parser's output value is the actual dependency source value.
   * `false` when a transform like `map()` has been applied.
   */
  readonly preservesSourceValue: boolean;
}

/**
 * Metadata for a parser that depends on one or more dependency sources.
 *
 * @internal
 * @since 1.0.0
 */
export interface DerivedDependencyCapability {
  /** Discriminant tag. */
  readonly kind: "derived";

  /** The dependency source IDs this parser depends on. */
  readonly dependencyIds: readonly symbol[];

  /**
   * Returns default values for each dependency, used when the
   * corresponding sources are not provided.
   */
  readonly getDefaultDependencyValues?: () => readonly unknown[];

  /**
   * Replays a parse with the given raw input and resolved dependency values.
   */
  readonly replayParse: (
    rawInput: string,
    dependencyValues: readonly unknown[],
  ) => ValueParserResult<unknown> | Promise<ValueParserResult<unknown>>;

  /**
   * Replays suggestions with the given prefix and resolved dependency values.
   */
  readonly replaySuggest?: (
    prefix: string,
    dependencyValues: readonly unknown[],
  ) => Iterable<Suggestion> | AsyncIterable<Suggestion>;
}

/**
 * Metadata indicating that a wrapper transforms the dependency source value.
 *
 * @internal
 * @since 1.0.0
 */
export interface DependencyTransformCapability {
  /** Whether the wrapper transforms the source value. */
  readonly transformsSourceValue: boolean;
}

/**
 * Composed dependency metadata for a parser node.
 *
 * A parser may have any combination of source, derived, and transform
 * capabilities.  In practice, a parser is typically either a source or
 * derived, never both.
 *
 * @internal
 * @since 1.0.0
 */
export interface ParserDependencyMetadata {
  /** Present if the parser is (or wraps) a dependency source. */
  readonly source?: DependencySourceCapability;

  /** Present if the parser depends on one or more sources. */
  readonly derived?: DerivedDependencyCapability;

  /** Present if a transform has been applied. */
  readonly transform?: DependencyTransformCapability;
}

// =============================================================================
// Bridge: extract metadata from old-protocol markers
// =============================================================================

/**
 * Extracts {@link ParserDependencyMetadata} from a value parser by reading
 * old-protocol markers (`dependencySourceMarker`, `derivedValueParserMarker`,
 * etc.).
 *
 * Returns `undefined` if the parser has no dependency-related markers.
 *
 * @param valueParser The value parser to inspect.
 * @returns Metadata, or `undefined` for plain parsers.
 * @internal
 * @since 1.0.0
 */
export function extractDependencyMetadata<M extends Mode, T>(
  valueParser: ValueParser<M, T>,
): ParserDependencyMetadata | undefined {
  if (isDependencySource(valueParser)) {
    return {
      source: {
        kind: "source",
        sourceId: valueParser[dependencyId],
        extractSourceValue: extractFromBareState,
        preservesSourceValue: true,
      },
    };
  }

  if (isDerivedValueParser(valueParser)) {
    // Collect all dependency IDs
    const allIds: readonly symbol[] = dependencyIds in valueParser &&
        valueParser[dependencyIds] != null
      ? valueParser[dependencyIds]!
      : [valueParser[dependencyId]];

    // Get default values function if available.
    // Multi-source (deriveFrom): uses [defaultValues] → () => readonly unknown[]
    // Single-source (derive):    uses [singleDefaultValue] → () => S
    let defaultValuesFn: (() => readonly unknown[]) | undefined;
    if (defaultValues in valueParser && valueParser[defaultValues] != null) {
      defaultValuesFn = valueParser[defaultValues] as () => readonly unknown[];
    } else if (
      singleDefaultValue in valueParser &&
      valueParser[singleDefaultValue] != null
    ) {
      const singleFn = valueParser[singleDefaultValue] as () => unknown;
      defaultValuesFn = () => [singleFn()];
    }

    // Build replayParse from parseWithDependency
    const parser = valueParser;
    const replayParse = (
      rawInput: string,
      depValues: readonly unknown[],
    ): ValueParserResult<unknown> | Promise<ValueParserResult<unknown>> => {
      // For single-dependency parsers, pass the single value directly.
      // For multi-dependency parsers, pass the tuple.
      const depArg = allIds.length === 1 ? depValues[0] : depValues;
      return parser[parseWithDependency](rawInput, depArg);
    };

    // Build replaySuggest from suggestWithDependency if available
    const suggestFn = suggestWithDependency in parser
      ? parser[suggestWithDependency]
      : undefined;
    const replaySuggest = suggestFn != null
      ? (
        prefix: string,
        depValues: readonly unknown[],
      ): Iterable<Suggestion> | AsyncIterable<Suggestion> => {
        const depArg = allIds.length === 1 ? depValues[0] : depValues;
        return suggestFn(prefix, depArg);
      }
      : undefined;

    return {
      derived: {
        kind: "derived",
        dependencyIds: allIds,
        getDefaultDependencyValues: defaultValuesFn,
        replayParse,
        replaySuggest,
      },
    };
  }

  return undefined;
}

// =============================================================================
// Source value extraction helpers
// =============================================================================

/**
 * Extracts the source parse result from a bare `DependencySourceState`.
 * Used as the base `extractSourceValue` for plain dependency sources.
 */
function extractFromBareState(
  state: unknown,
): ValueParserResult<unknown> | undefined {
  if (!isDependencySourceState(state)) return undefined;
  return state.result;
}

type ExtractFn = (state: unknown) => ValueParserResult<unknown> | undefined;

/**
 * Wraps an inner `extractSourceValue` to unwrap `[innerState]` first.
 * Used by `optional()` and `withDefault()` which wrap state in a
 * single-element array.
 */
function unwrapArrayThenExtract(innerExtract: ExtractFn): ExtractFn {
  return (state: unknown): ValueParserResult<unknown> | undefined => {
    if (Array.isArray(state) && state.length === 1) {
      return innerExtract(state[0]);
    }
    // Also try the bare state in case it's already unwrapped.
    return innerExtract(state);
  };
}

// =============================================================================
// Composition: modify metadata through modifier wrappers
// =============================================================================

/**
 * Options for `composeDependencyMetadata` when the wrapper kind is
 * `"withDefault"`.
 *
 * @internal
 * @since 1.0.0
 */
export interface WithDefaultCompositionOptions {
  /** Thunk returning the default value as a `ValueParserResult`. */
  readonly defaultValue: () =>
    | ValueParserResult<unknown>
    | Promise<ValueParserResult<unknown>>;
}

/**
 * Composes dependency metadata through a modifier wrapper.
 *
 * - `"optional"`: preserves inner metadata unchanged.
 * - `"withDefault"`: adds `getMissingSourceValue` if the inner parser
 *   preserves a dependency source.
 * - `"map"`: sets `transformsSourceValue` and clears
 *   `preservesSourceValue`.
 *
 * Returns `undefined` if `inner` is `undefined`.
 *
 * @param inner The inner parser's metadata.
 * @param wrapperKind The type of modifier being applied.
 * @param options Additional options for certain wrapper kinds.
 * @returns Composed metadata, or `undefined`.
 * @internal
 * @since 1.0.0
 */
export function composeDependencyMetadata(
  inner: ParserDependencyMetadata | undefined,
  wrapperKind: "optional" | "withDefault" | "map",
  options?: WithDefaultCompositionOptions,
): ParserDependencyMetadata | undefined {
  if (inner === undefined) return undefined;

  switch (wrapperKind) {
    case "optional": {
      if (inner.source?.extractSourceValue != null) {
        return {
          ...inner,
          source: {
            ...inner.source,
            extractSourceValue: unwrapArrayThenExtract(
              inner.source.extractSourceValue,
            ),
          },
        };
      }
      return inner;
    }

    case "withDefault": {
      const wrappedExtract = inner.source?.extractSourceValue != null
        ? unwrapArrayThenExtract(inner.source.extractSourceValue)
        : undefined;
      if (inner.source != null && inner.source.preservesSourceValue) {
        return {
          ...inner,
          source: {
            ...inner.source,
            ...(wrappedExtract != null && {
              extractSourceValue: wrappedExtract,
            }),
            getMissingSourceValue: options?.defaultValue,
          },
        };
      }
      if (wrappedExtract != null && inner.source != null) {
        return {
          ...inner,
          source: { ...inner.source, extractSourceValue: wrappedExtract },
        };
      }
      return inner;
    }

    case "map": {
      // map() does not wrap state — it passes through the inner state
      // unchanged.  extractSourceValue is inherited as-is from inner.
      const result: ParserDependencyMetadata = {
        ...inner,
        transform: { transformsSourceValue: true },
      };
      if (inner.source != null) {
        return {
          ...result,
          source: {
            ...inner.source,
            preservesSourceValue: false,
          },
        };
      }
      return result;
    }
  }
}
