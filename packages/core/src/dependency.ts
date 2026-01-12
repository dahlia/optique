import type { NonEmptyString } from "./nonempty.ts";
import type { Mode, Suggestion } from "./parser.ts";
import type { ValueParser, ValueParserResult } from "./valueparser.ts";

/**
 * A unique symbol used to identify dependency sources at compile time.
 * This marker is used to distinguish {@link DependencySource} from regular
 * {@link ValueParser} instances.
 * @since 0.10.0
 */
export const DependencySourceMarker: unique symbol = Symbol.for(
  "@optique/core/dependency/DependencySourceMarker",
);

/**
 * A unique symbol used to identify derived value parsers at compile time.
 * This marker is used to distinguish {@link DerivedValueParser} from regular
 * {@link ValueParser} instances.
 * @since 0.10.0
 */
export const DerivedValueParserMarker: unique symbol = Symbol.for(
  "@optique/core/dependency/DerivedValueParserMarker",
);

/**
 * A unique symbol used to store the dependency ID on value parsers.
 * @since 0.10.0
 */
export const DependencyId: unique symbol = Symbol.for(
  "@optique/core/dependency/DependencyId",
);

/**
 * Options for creating a derived value parser.
 *
 * @template S The type of the source dependency value.
 * @template T The type of the derived parser value.
 * @since 0.10.0
 */
export interface DeriveOptions<S, T> {
  /**
   * The metavariable name for the derived parser. Used in help messages
   * to indicate what kind of value this parser expects.
   */
  readonly metavar: NonEmptyString;

  /**
   * Factory function that creates a {@link ValueParser} based on the
   * dependency source's value.
   *
   * @param sourceValue The value parsed from the dependency source.
   * @returns A {@link ValueParser} for the derived value.
   */
  readonly factory: (sourceValue: S) => ValueParser<"sync", T>;

  /**
   * Default value to use when the dependency source is not provided.
   * This allows the derived parser to work even when the dependency
   * is optional.
   *
   * @returns The default value for the dependency source.
   */
  readonly defaultValue: () => S;
}

/**
 * Represents a dependency source that can be used to create derived parsers.
 *
 * A dependency source wraps a {@link ValueParser} and provides methods to
 * create derived parsers that depend on the parsed value. This enables
 * inter-option dependencies where one option's valid values depend on
 * another option's value.
 *
 * @template M The execution mode of the parser (`"sync"` or `"async"`).
 * @template T The type of value this dependency source produces.
 * @since 0.10.0
 */
export interface DependencySource<M extends Mode = "sync", T = unknown>
  extends ValueParser<M, T> {
  /**
   * Marker to identify this as a dependency source.
   * @internal
   */
  readonly [DependencySourceMarker]: true;

  /**
   * Unique identifier for this dependency source.
   * @internal
   */
  readonly [DependencyId]: symbol;

  /**
   * Creates a derived value parser whose behavior depends on this
   * dependency source's value.
   *
   * The derived parser uses a factory function to create parsers based on
   * the source value. Currently, only synchronous factory functions are
   * supported.
   *
   * @template U The type of value the derived parser produces.
   * @param options Configuration for the derived parser.
   * @returns A {@link DerivedValueParser} that depends on this source.
   */
  derive<U>(options: DeriveOptions<T, U>): DerivedValueParser<M, U, T>;
}

/**
 * Internal derive options with source type parameter.
 * @internal
 */
interface InternalDeriveOptions<S, T> {
  readonly metavar: NonEmptyString;
  readonly factory: (sourceValue: S) => ValueParser<"sync", T>;
  readonly defaultValue: () => S;
}

/**
 * Extracts the value type from a DependencySource.
 * @template D The DependencySource type.
 * @since 0.10.0
 */
export type DependencyValue<D> = D extends DependencySource<Mode, infer T> ? T
  : never;

/**
 * Extracts the mode from a DependencySource.
 * @template D The DependencySource type.
 * @since 0.10.0
 */
export type DependencyMode<D> = D extends DependencySource<infer M, unknown> ? M
  : never;

/**
 * Maps a tuple of DependencySources to a tuple of their value types.
 * @template T The tuple of DependencySource types.
 * @since 0.10.0
 */
export type DependencyValues<T extends readonly unknown[]> = {
  [K in keyof T]: T[K] extends DependencySource<Mode, infer V> ? V : never;
};

/**
 * Combines modes from multiple dependency sources.
 * If any source is async, the result is async.
 * @template T The tuple of DependencySource types.
 * @since 0.10.0
 */
export type CombinedDependencyMode<T extends readonly unknown[]> =
  "async" extends {
    [K in keyof T]: T[K] extends DependencySource<infer M, unknown> ? M : never;
  }[number] ? "async"
    : "sync";

/**
 * Represents any dependency source, used in type constraints.
 * @since 0.10.0
 */
// deno-lint-ignore no-explicit-any
export type AnyDependencySource = DependencySource<Mode, any>;

/**
 * Options for creating a derived value parser from multiple dependencies.
 *
 * @template Deps A tuple of DependencySource types.
 * @template T The type of the derived parser value.
 * @since 0.10.0
 */
export interface DeriveFromOptions<
  Deps extends readonly AnyDependencySource[],
  T,
> {
  /**
   * The metavariable name for the derived parser. Used in help messages
   * to indicate what kind of value this parser expects.
   */
  readonly metavar: NonEmptyString;

  /**
   * The dependency sources that this derived parser depends on.
   */
  readonly dependencies: Deps;

  /**
   * Factory function that creates a {@link ValueParser} based on the
   * dependency sources' values.
   *
   * @param values The values parsed from the dependency sources (in order).
   * @returns A {@link ValueParser} for the derived value.
   */
  readonly factory: (
    ...values: DependencyValues<Deps>
  ) => ValueParser<"sync", T>;

  /**
   * Default values to use when the dependency sources are not provided.
   * Must return a tuple with the same length and types as the dependencies.
   *
   * @returns A tuple of default values for each dependency source.
   */
  readonly defaultValues: () => DependencyValues<Deps>;
}

/**
 * A value parser that depends on another parser's value.
 *
 * A derived value parser cannot be nested (i.e., you cannot call
 * {@link DependencySource.derive} on a {@link DerivedValueParser}).
 *
 * @template M The execution mode of the parser (`"sync"` or `"async"`).
 * @template T The type of value this parser produces.
 * @template S The type of the source dependency value.
 * @since 0.10.0
 */
export interface DerivedValueParser<
  M extends Mode = "sync",
  T = unknown,
  S = unknown,
> extends ValueParser<M, T> {
  /**
   * Marker to identify this as a derived value parser.
   * @internal
   */
  readonly [DerivedValueParserMarker]: true;

  /**
   * The unique identifier of the dependency source this parser depends on.
   * @internal
   */
  readonly [DependencyId]: symbol;
}

/**
 * Creates a dependency source from a {@link ValueParser}.
 *
 * A dependency source wraps an existing value parser and enables creating
 * derived parsers that depend on the parsed value. This is useful for
 * scenarios where one option's valid values depend on another option's value.
 *
 * @template M The execution mode of the value parser.
 * @template T The type of value the parser produces.
 * @param parser The value parser to wrap as a dependency source.
 * @returns A {@link DependencySource} that can be used to create
 *          derived parsers.
 * @example
 * ```typescript
 * import { dependency } from "@optique/core/dependency";
 * import { string } from "@optique/core/valueparser";
 *
 * // Create a dependency source for a directory path
 * const cwdParser = dependency(string({ metavar: "DIR" }));
 *
 * // Create a derived parser that depends on the directory
 * const branchParser = cwdParser.derive({
 *   metavar: "BRANCH",
 *   factory: (dir) => gitBranch({ dir }),
 *   defaultValue: () => process.cwd(),
 * });
 * ```
 * @since 0.10.0
 */
export function dependency<M extends Mode, T>(
  parser: ValueParser<M, T>,
): DependencySource<M, T> {
  const id = Symbol();
  return {
    ...parser,
    [DependencySourceMarker]: true,
    [DependencyId]: id,
    derive<U>(options: DeriveOptions<T, U>): DerivedValueParser<M, U, T> {
      return createDerivedValueParser(id, parser, options);
    },
  };
}

/**
 * Checks if a value parser is a {@link DependencySource}.
 *
 * @param parser The value parser to check.
 * @returns `true` if the parser is a dependency source, `false` otherwise.
 * @since 0.10.0
 */
export function isDependencySource<M extends Mode, T>(
  parser: ValueParser<M, T>,
): parser is DependencySource<M, T> {
  return DependencySourceMarker in parser &&
    parser[DependencySourceMarker] === true;
}

/**
 * Checks if a value parser is a {@link DerivedValueParser}.
 *
 * @param parser The value parser to check.
 * @returns `true` if the parser is a derived value parser, `false` otherwise.
 * @since 0.10.0
 */
export function isDerivedValueParser<M extends Mode, T>(
  parser: ValueParser<M, T>,
): parser is DerivedValueParser<M, T, unknown> {
  return DerivedValueParserMarker in parser &&
    parser[DerivedValueParserMarker] === true;
}

/**
 * Creates a derived value parser from multiple dependency sources.
 *
 * This function allows creating a parser whose behavior depends on
 * multiple other parsers' values. This is useful for scenarios where
 * an option's valid values depend on a combination of other options.
 *
 * @template Deps A tuple of DependencySource types.
 * @template T The type of value the derived parser produces.
 * @param options Configuration for the derived parser.
 * @returns A {@link DerivedValueParser} that depends on the given sources.
 * @example
 * ```typescript
 * import { dependency, deriveFrom } from "@optique/core/dependency";
 * import { string, choice } from "@optique/core/valueparser";
 *
 * const dirParser = dependency(string({ metavar: "DIR" }));
 * const modeParser = dependency(choice(["dev", "prod"]));
 *
 * const configParser = deriveFrom({
 *   metavar: "CONFIG",
 *   dependencies: [dirParser, modeParser] as const,
 *   factory: (dir, mode) =>
 *     choice(mode === "dev"
 *       ? [`${dir}/dev.json`, `${dir}/dev.yaml`]
 *       : [`${dir}/prod.json`, `${dir}/prod.yaml`]),
 *   defaultValues: () => ["/config", "dev"],
 * });
 * ```
 * @since 0.10.0
 */
export function deriveFrom<
  Deps extends readonly AnyDependencySource[],
  T,
>(
  options: DeriveFromOptions<Deps, T>,
): DerivedValueParser<CombinedDependencyMode<Deps>, T, DependencyValues<Deps>> {
  // Check if any dependency is async
  const isAsync = options.dependencies.some((dep) => dep.$mode === "async");

  // Create a combined dependency ID (using the first dependency's ID for now)
  // In a full implementation, we might want to track all dependency IDs
  const sourceId = options.dependencies.length > 0
    ? options.dependencies[0][DependencyId]
    : Symbol();

  if (isAsync) {
    return createAsyncDerivedFromParser(
      sourceId,
      options,
    ) as DerivedValueParser<
      CombinedDependencyMode<Deps>,
      T,
      DependencyValues<Deps>
    >;
  }

  return createSyncDerivedFromParser(sourceId, options) as DerivedValueParser<
    CombinedDependencyMode<Deps>,
    T,
    DependencyValues<Deps>
  >;
}

function createSyncDerivedFromParser<
  Deps extends readonly AnyDependencySource[],
  T,
>(
  sourceId: symbol,
  options: DeriveFromOptions<Deps, T>,
): DerivedValueParser<"sync", T, DependencyValues<Deps>> {
  return {
    $mode: "sync",
    metavar: options.metavar,
    [DerivedValueParserMarker]: true,
    [DependencyId]: sourceId,

    parse(input: string): ValueParserResult<T> {
      const sourceValues = options.defaultValues();
      const derivedParser = options.factory(
        ...(sourceValues as DependencyValues<Deps>),
      );
      return derivedParser.parse(input);
    },

    format(value: T): string {
      const sourceValues = options.defaultValues();
      const derivedParser = options.factory(
        ...(sourceValues as DependencyValues<Deps>),
      );
      return derivedParser.format(value);
    },

    *suggest(prefix: string): Iterable<Suggestion> {
      const sourceValues = options.defaultValues();
      const derivedParser = options.factory(
        ...(sourceValues as DependencyValues<Deps>),
      );
      if (derivedParser.suggest) {
        yield* derivedParser.suggest(prefix);
      }
    },
  };
}

function createAsyncDerivedFromParser<
  Deps extends readonly AnyDependencySource[],
  T,
>(
  sourceId: symbol,
  options: DeriveFromOptions<Deps, T>,
): DerivedValueParser<"async", T, DependencyValues<Deps>> {
  return {
    $mode: "async",
    metavar: options.metavar,
    [DerivedValueParserMarker]: true,
    [DependencyId]: sourceId,

    parse(input: string): Promise<ValueParserResult<T>> {
      const sourceValues = options.defaultValues();
      const derivedParser = options.factory(
        ...(sourceValues as DependencyValues<Deps>),
      );
      return Promise.resolve(derivedParser.parse(input));
    },

    format(value: T): string {
      const sourceValues = options.defaultValues();
      const derivedParser = options.factory(
        ...(sourceValues as DependencyValues<Deps>),
      );
      return derivedParser.format(value);
    },

    async *suggest(prefix: string): AsyncIterable<Suggestion> {
      const sourceValues = options.defaultValues();
      const derivedParser = options.factory(
        ...(sourceValues as DependencyValues<Deps>),
      );
      if (derivedParser.suggest) {
        yield* derivedParser.suggest(prefix);
      }
    },
  };
}

function createDerivedValueParser<M extends Mode, S, T>(
  sourceId: symbol,
  sourceParser: ValueParser<M, S>,
  options: InternalDeriveOptions<S, T>,
): DerivedValueParser<M, T, S> {
  if (sourceParser.$mode === "async") {
    return createAsyncDerivedParser(sourceId, options) as DerivedValueParser<
      M,
      T,
      S
    >;
  }

  return createSyncDerivedParser(sourceId, options) as DerivedValueParser<
    M,
    T,
    S
  >;
}

function createSyncDerivedParser<S, T>(
  sourceId: symbol,
  options: InternalDeriveOptions<S, T>,
): DerivedValueParser<"sync", T, S> {
  return {
    $mode: "sync",
    metavar: options.metavar,
    [DerivedValueParserMarker]: true,
    [DependencyId]: sourceId,

    parse(input: string): ValueParserResult<T> {
      const sourceValue = options.defaultValue();
      const derivedParser = options.factory(sourceValue);
      return derivedParser.parse(input);
    },

    format(value: T): string {
      const sourceValue = options.defaultValue();
      const derivedParser = options.factory(sourceValue);
      return derivedParser.format(value);
    },

    *suggest(prefix: string): Iterable<Suggestion> {
      const sourceValue = options.defaultValue();
      const derivedParser = options.factory(sourceValue);
      if (derivedParser.suggest) {
        yield* derivedParser.suggest(prefix);
      }
    },
  };
}

function createAsyncDerivedParser<S, T>(
  sourceId: symbol,
  options: InternalDeriveOptions<S, T>,
): DerivedValueParser<"async", T, S> {
  return {
    $mode: "async",
    metavar: options.metavar,
    [DerivedValueParserMarker]: true,
    [DependencyId]: sourceId,

    parse(input: string): Promise<ValueParserResult<T>> {
      const sourceValue = options.defaultValue();
      const derivedParser = options.factory(sourceValue);
      return Promise.resolve(derivedParser.parse(input));
    },

    format(value: T): string {
      const sourceValue = options.defaultValue();
      const derivedParser = options.factory(sourceValue);
      return derivedParser.format(value);
    },

    async *suggest(prefix: string): AsyncIterable<Suggestion> {
      const sourceValue = options.defaultValue();
      const derivedParser = options.factory(sourceValue);
      if (derivedParser.suggest) {
        yield* derivedParser.suggest(prefix);
      }
    },
  };
}
