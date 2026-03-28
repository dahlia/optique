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
    case "optional":
      return inner;

    case "withDefault": {
      if (inner.source != null && inner.source.preservesSourceValue) {
        return {
          ...inner,
          source: {
            ...inner.source,
            getMissingSourceValue: options?.defaultValue,
          },
        };
      }
      return inner;
    }

    case "map": {
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
