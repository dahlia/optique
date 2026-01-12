import { type Message, message } from "./message.ts";
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
 * A unique symbol used to store multiple dependency IDs on derived parsers
 * that depend on multiple sources (created via {@link deriveFrom}).
 * @since 0.10.0
 */
export const DependencyIds: unique symbol = Symbol.for(
  "@optique/core/dependency/DependencyIds",
);

/**
 * A unique symbol used to access the parseWithDependency method on derived parsers.
 * @since 0.10.0
 */
export const ParseWithDependency: unique symbol = Symbol.for(
  "@optique/core/dependency/ParseWithDependency",
);

/**
 * Combines two modes into a single mode.
 * If either mode is async, the result is async.
 * @template M1 The first mode.
 * @template M2 The second mode.
 * @since 0.10.0
 */
export type CombineMode<M1 extends Mode, M2 extends Mode> = M1 extends "async"
  ? "async"
  : M2 extends "async" ? "async"
  : "sync";

/**
 * Options for creating a derived value parser.
 *
 * @template S The type of the source dependency value.
 * @template T The type of the derived parser value.
 * @template FM The mode of the factory's returned parser.
 * @since 0.10.0
 */
export interface DeriveOptions<S, T, FM extends Mode = Mode> {
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
  readonly factory: (sourceValue: S) => ValueParser<FM, T>;

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
 * Options for creating a derived value parser with a synchronous factory.
 *
 * @template S The type of the source dependency value.
 * @template T The type of the derived parser value.
 * @since 0.10.0
 */
export interface DeriveSyncOptions<S, T> {
  /**
   * The metavariable name for the derived parser.
   */
  readonly metavar: NonEmptyString;

  /**
   * Factory function that creates a synchronous {@link ValueParser}.
   */
  readonly factory: (sourceValue: S) => ValueParser<"sync", T>;

  /**
   * Default value to use when the dependency source is not provided.
   */
  readonly defaultValue: () => S;
}

/**
 * Options for creating a derived value parser with an asynchronous factory.
 *
 * @template S The type of the source dependency value.
 * @template T The type of the derived parser value.
 * @since 0.10.0
 */
export interface DeriveAsyncOptions<S, T> {
  /**
   * The metavariable name for the derived parser.
   */
  readonly metavar: NonEmptyString;

  /**
   * Factory function that creates an asynchronous {@link ValueParser}.
   */
  readonly factory: (sourceValue: S) => ValueParser<"async", T>;

  /**
   * Default value to use when the dependency source is not provided.
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
   * the source value. The factory can return either a sync or async parser,
   * and the resulting derived parser's mode will be the combination of
   * the source mode and the factory's returned parser mode.
   *
   * @template U The type of value the derived parser produces.
   * @template FM The mode of the factory's returned parser.
   * @param options Configuration for the derived parser.
   * @returns A {@link DerivedValueParser} that depends on this source.
   */
  derive<U, FM extends Mode = "sync">(
    options: DeriveOptions<T, U, FM>,
  ): DerivedValueParser<CombineMode<M, FM>, U, T>;

  /**
   * Creates a derived value parser with a synchronous factory.
   *
   * This is a convenience method that explicitly requires a sync factory,
   * making the type inference more predictable.
   *
   * @template U The type of value the derived parser produces.
   * @param options Configuration for the derived parser with sync factory.
   * @returns A {@link DerivedValueParser} that depends on this source.
   * @since 0.10.0
   */
  deriveSync<U>(options: DeriveSyncOptions<T, U>): DerivedValueParser<M, U, T>;

  /**
   * Creates a derived value parser with an asynchronous factory.
   *
   * This is a convenience method that explicitly requires an async factory,
   * making the type inference more predictable.
   *
   * @template U The type of value the derived parser produces.
   * @param options Configuration for the derived parser with async factory.
   * @returns A {@link DerivedValueParser} that depends on this source.
   * @since 0.10.0
   */
  deriveAsync<U>(
    options: DeriveAsyncOptions<T, U>,
  ): DerivedValueParser<"async", U, T>;
}

/**
 * Internal derive options with source type parameter.
 * @internal
 */
interface InternalDeriveOptions<S, T, FM extends Mode = Mode> {
  readonly metavar: NonEmptyString;
  readonly factory: (sourceValue: S) => ValueParser<FM, T>;
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
 * @template FM The mode of the factory's returned parser.
 * @since 0.10.0
 */
export interface DeriveFromOptions<
  Deps extends readonly AnyDependencySource[],
  T,
  FM extends Mode = Mode,
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
  ) => ValueParser<FM, T>;

  /**
   * Default values to use when the dependency sources are not provided.
   * Must return a tuple with the same length and types as the dependencies.
   *
   * @returns A tuple of default values for each dependency source.
   */
  readonly defaultValues: () => DependencyValues<Deps>;
}

/**
 * Options for creating a derived value parser from multiple dependencies
 * with a synchronous factory.
 *
 * @template Deps A tuple of DependencySource types.
 * @template T The type of the derived parser value.
 * @since 0.10.0
 */
export interface DeriveFromSyncOptions<
  Deps extends readonly AnyDependencySource[],
  T,
> {
  /**
   * The metavariable name for the derived parser.
   */
  readonly metavar: NonEmptyString;

  /**
   * The dependency sources that this derived parser depends on.
   */
  readonly dependencies: Deps;

  /**
   * Factory function that creates a synchronous {@link ValueParser}.
   */
  readonly factory: (
    ...values: DependencyValues<Deps>
  ) => ValueParser<"sync", T>;

  /**
   * Default values to use when the dependency sources are not provided.
   */
  readonly defaultValues: () => DependencyValues<Deps>;
}

/**
 * Options for creating a derived value parser from multiple dependencies
 * with an asynchronous factory.
 *
 * @template Deps A tuple of DependencySource types.
 * @template T The type of the derived parser value.
 * @since 0.10.0
 */
export interface DeriveFromAsyncOptions<
  Deps extends readonly AnyDependencySource[],
  T,
> {
  /**
   * The metavariable name for the derived parser.
   */
  readonly metavar: NonEmptyString;

  /**
   * The dependency sources that this derived parser depends on.
   */
  readonly dependencies: Deps;

  /**
   * Factory function that creates an asynchronous {@link ValueParser}.
   */
  readonly factory: (
    ...values: DependencyValues<Deps>
  ) => ValueParser<"async", T>;

  /**
   * Default values to use when the dependency sources are not provided.
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
   * For parsers created with {@link deriveFrom} that have multiple dependencies,
   * this is set to the first dependency's ID for backwards compatibility.
   * @internal
   */
  readonly [DependencyId]: symbol;

  /**
   * The unique identifiers of all dependency sources this parser depends on.
   * Present only for parsers created with {@link deriveFrom} that have multiple
   * dependencies. If present, this takes precedence over {@link DependencyId}
   * during dependency resolution.
   * @internal
   */
  readonly [DependencyIds]?: readonly symbol[];

  /**
   * Parses the input using the actual dependency value instead of the default.
   * This method is used during dependency resolution in `complete()`.
   *
   * @param input The raw input string to parse.
   * @param dependencyValue The resolved dependency value.
   * @returns The parse result.
   * @internal
   */
  readonly [ParseWithDependency]: (
    input: string,
    dependencyValue: S,
  ) => ValueParserResult<T> | Promise<ValueParserResult<T>>;
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
  // deno-lint-ignore no-explicit-any
  const result: any = {
    ...parser,
    [DependencySourceMarker]: true,
    [DependencyId]: id,
    derive<U, FM extends Mode = "sync">(
      options: DeriveOptions<T, U, FM>,
    ): DerivedValueParser<CombineMode<M, FM>, U, T> {
      return createDerivedValueParser(id, parser, options);
    },
    deriveSync<U>(
      options: DeriveSyncOptions<T, U>,
    ): DerivedValueParser<M, U, T> {
      // For sync factories, the mode is determined solely by the source mode
      if (parser.$mode === "async") {
        return createAsyncDerivedParserFromSyncFactory(
          id,
          options,
        ) as unknown as DerivedValueParser<M, U, T>;
      }
      return createSyncDerivedParser(
        id,
        options,
      ) as unknown as DerivedValueParser<M, U, T>;
    },
    deriveAsync<U>(
      options: DeriveAsyncOptions<T, U>,
    ): DerivedValueParser<"async", U, T> {
      return createDerivedValueParser(id, parser, options);
    },
  };
  return result as DependencySource<M, T>;
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
  FM extends Mode = "sync",
>(
  options: DeriveFromOptions<Deps, T, FM>,
): DerivedValueParser<
  CombineMode<CombinedDependencyMode<Deps>, FM>,
  T,
  DependencyValues<Deps>
> {
  // Check if any dependency is async
  const depsAsync = options.dependencies.some((dep) => dep.$mode === "async");

  // Check if factory returns async parser
  const factoryReturnsAsync = determineFactoryModeForDeriveFrom(options);

  // Create a combined dependency ID (using the first dependency's ID for now)
  // In a full implementation, we might want to track all dependency IDs
  const sourceId = options.dependencies.length > 0
    ? options.dependencies[0][DependencyId]
    : Symbol();

  const isAsync = depsAsync || factoryReturnsAsync;

  if (isAsync) {
    if (factoryReturnsAsync) {
      return createAsyncDerivedFromParserFromAsyncFactory(
        sourceId,
        options as DeriveFromOptions<Deps, T, "async">,
      ) as DerivedValueParser<
        CombineMode<CombinedDependencyMode<Deps>, FM>,
        T,
        DependencyValues<Deps>
      >;
    }
    return createAsyncDerivedFromParserFromSyncFactory(
      sourceId,
      options as DeriveFromOptions<Deps, T, "sync">,
    ) as DerivedValueParser<
      CombineMode<CombinedDependencyMode<Deps>, FM>,
      T,
      DependencyValues<Deps>
    >;
  }

  return createSyncDerivedFromParser(
    sourceId,
    options as DeriveFromOptions<Deps, T, "sync">,
  ) as DerivedValueParser<
    CombineMode<CombinedDependencyMode<Deps>, FM>,
    T,
    DependencyValues<Deps>
  >;
}

/**
 * Creates a derived value parser from multiple dependency sources
 * with a synchronous factory.
 *
 * This function allows creating a parser whose behavior depends on
 * multiple other parsers' values. The factory explicitly returns
 * a sync parser.
 *
 * @template Deps A tuple of DependencySource types.
 * @template T The type of value the derived parser produces.
 * @param options Configuration for the derived parser with sync factory.
 * @returns A {@link DerivedValueParser} that depends on the given sources.
 * @since 0.10.0
 */
export function deriveFromSync<
  Deps extends readonly AnyDependencySource[],
  T,
>(
  options: DeriveFromSyncOptions<Deps, T>,
): DerivedValueParser<CombinedDependencyMode<Deps>, T, DependencyValues<Deps>> {
  // Check if any dependency is async
  const depsAsync = options.dependencies.some((dep) => dep.$mode === "async");

  const sourceId = options.dependencies.length > 0
    ? options.dependencies[0][DependencyId]
    : Symbol();

  if (depsAsync) {
    return createAsyncDerivedFromParserFromSyncFactory(
      sourceId,
      options,
    ) as DerivedValueParser<
      CombinedDependencyMode<Deps>,
      T,
      DependencyValues<Deps>
    >;
  }

  return createSyncDerivedFromParser(
    sourceId,
    options,
  ) as DerivedValueParser<
    CombinedDependencyMode<Deps>,
    T,
    DependencyValues<Deps>
  >;
}

/**
 * Creates a derived value parser from multiple dependency sources
 * with an asynchronous factory.
 *
 * This function allows creating a parser whose behavior depends on
 * multiple other parsers' values. The factory explicitly returns
 * an async parser.
 *
 * @template Deps A tuple of DependencySource types.
 * @template T The type of value the derived parser produces.
 * @param options Configuration for the derived parser with async factory.
 * @returns A {@link DerivedValueParser} that depends on the given sources.
 * @since 0.10.0
 */
export function deriveFromAsync<
  Deps extends readonly AnyDependencySource[],
  T,
>(
  options: DeriveFromAsyncOptions<Deps, T>,
): DerivedValueParser<"async", T, DependencyValues<Deps>> {
  const sourceId = options.dependencies.length > 0
    ? options.dependencies[0][DependencyId]
    : Symbol();

  return createAsyncDerivedFromParserFromAsyncFactory(sourceId, options);
}

/**
 * Determines if the factory returns an async parser for deriveFrom options.
 */
function determineFactoryModeForDeriveFrom<
  Deps extends readonly AnyDependencySource[],
  T,
  FM extends Mode,
>(
  options: DeriveFromOptions<Deps, T, FM>,
): boolean {
  const defaultValues = options.defaultValues();
  const parser = options.factory(
    ...(defaultValues as DependencyValues<Deps>),
  );
  return parser.$mode === "async";
}

function createSyncDerivedFromParser<
  Deps extends readonly AnyDependencySource[],
  T,
>(
  sourceId: symbol,
  options: DeriveFromSyncOptions<Deps, T>,
): DerivedValueParser<"sync", T, DependencyValues<Deps>> {
  // Collect all dependency IDs for multi-dependency resolution
  const allDependencyIds = options.dependencies.map((dep) => dep[DependencyId]);

  return {
    $mode: "sync",
    metavar: options.metavar,
    [DerivedValueParserMarker]: true,
    [DependencyId]: sourceId,
    [DependencyIds]: allDependencyIds,

    parse(input: string): ValueParserResult<T> {
      const sourceValues = options.defaultValues();
      const derivedParser = options.factory(
        ...(sourceValues as DependencyValues<Deps>),
      );
      return derivedParser.parse(input);
    },

    [ParseWithDependency](
      input: string,
      dependencyValue: DependencyValues<Deps>,
    ): ValueParserResult<T> {
      let derivedParser;
      try {
        derivedParser = options.factory(
          ...(dependencyValue as DependencyValues<Deps>),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: message`Factory error: ${msg}` };
      }
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

/**
 * Creates an async derived parser from multiple dependencies when the
 * factory returns an async parser.
 */
function createAsyncDerivedFromParserFromAsyncFactory<
  Deps extends readonly AnyDependencySource[],
  T,
>(
  sourceId: symbol,
  options: DeriveFromAsyncOptions<Deps, T>,
): DerivedValueParser<"async", T, DependencyValues<Deps>> {
  // Collect all dependency IDs for multi-dependency resolution
  const allDependencyIds = options.dependencies.map((dep) => dep[DependencyId]);

  return {
    $mode: "async",
    metavar: options.metavar,
    [DerivedValueParserMarker]: true,
    [DependencyId]: sourceId,
    [DependencyIds]: allDependencyIds,

    parse(input: string): Promise<ValueParserResult<T>> {
      const sourceValues = options.defaultValues();
      const derivedParser = options.factory(
        ...(sourceValues as DependencyValues<Deps>),
      );
      return derivedParser.parse(input);
    },

    [ParseWithDependency](
      input: string,
      dependencyValue: DependencyValues<Deps>,
    ): Promise<ValueParserResult<T>> {
      let derivedParser;
      try {
        derivedParser = options.factory(
          ...(dependencyValue as DependencyValues<Deps>),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return Promise.resolve({
          success: false,
          error: message`Factory error: ${msg}`,
        });
      }
      return derivedParser.parse(input);
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
        for await (const suggestion of derivedParser.suggest(prefix)) {
          yield suggestion;
        }
      }
    },
  };
}

/**
 * Creates an async derived parser from multiple dependencies when the
 * sources are async but the factory returns a sync parser.
 */
function createAsyncDerivedFromParserFromSyncFactory<
  Deps extends readonly AnyDependencySource[],
  T,
>(
  sourceId: symbol,
  options: DeriveFromSyncOptions<Deps, T>,
): DerivedValueParser<"async", T, DependencyValues<Deps>> {
  // Collect all dependency IDs for multi-dependency resolution
  const allDependencyIds = options.dependencies.map((dep) => dep[DependencyId]);

  return {
    $mode: "async",
    metavar: options.metavar,
    [DerivedValueParserMarker]: true,
    [DependencyId]: sourceId,
    [DependencyIds]: allDependencyIds,

    parse(input: string): Promise<ValueParserResult<T>> {
      const sourceValues = options.defaultValues();
      const derivedParser = options.factory(
        ...(sourceValues as DependencyValues<Deps>),
      );
      return Promise.resolve(derivedParser.parse(input));
    },

    [ParseWithDependency](
      input: string,
      dependencyValue: DependencyValues<Deps>,
    ): Promise<ValueParserResult<T>> {
      let derivedParser;
      try {
        derivedParser = options.factory(
          ...(dependencyValue as DependencyValues<Deps>),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return Promise.resolve({
          success: false,
          error: message`Factory error: ${msg}`,
        });
      }
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

function createDerivedValueParser<
  M extends Mode,
  S,
  T,
  FM extends Mode,
>(
  sourceId: symbol,
  sourceParser: ValueParser<M, S>,
  options: InternalDeriveOptions<S, T, FM>,
): DerivedValueParser<CombineMode<M, FM>, T, S> {
  // Determine if the resulting parser should be async
  // It's async if either the source is async OR the factory returns async parser
  const factoryReturnsAsync = determineFactoryMode(options);
  const isAsync = sourceParser.$mode === "async" || factoryReturnsAsync;

  if (isAsync) {
    // Use the appropriate async parser based on factory mode
    if (factoryReturnsAsync) {
      return createAsyncDerivedParserFromAsyncFactory(
        sourceId,
        options as InternalDeriveOptions<S, T, "async">,
      ) as DerivedValueParser<CombineMode<M, FM>, T, S>;
    }
    return createAsyncDerivedParserFromSyncFactory(
      sourceId,
      options as InternalDeriveOptions<S, T, "sync">,
    ) as DerivedValueParser<CombineMode<M, FM>, T, S>;
  }

  return createSyncDerivedParser(
    sourceId,
    options as InternalDeriveOptions<S, T, "sync">,
  ) as DerivedValueParser<CombineMode<M, FM>, T, S>;
}

/**
 * Determines if the factory returns an async parser by calling it with
 * the default value and checking the mode.
 */
function determineFactoryMode<S, T, FM extends Mode>(
  options: InternalDeriveOptions<S, T, FM>,
): boolean {
  const defaultValue = options.defaultValue();
  const parser = options.factory(defaultValue);
  return parser.$mode === "async";
}

function createSyncDerivedParser<S, T>(
  sourceId: symbol,
  options: InternalDeriveOptions<S, T, "sync">,
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

    [ParseWithDependency](
      input: string,
      dependencyValue: S,
    ): ValueParserResult<T> {
      let derivedParser;
      try {
        derivedParser = options.factory(dependencyValue);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: message`Factory error: ${msg}` };
      }
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

/**
 * Creates an async derived parser when the factory returns an async parser.
 * The parse result is awaited since the factory returns an async parser.
 */
function createAsyncDerivedParserFromAsyncFactory<S, T>(
  sourceId: symbol,
  options: InternalDeriveOptions<S, T, "async">,
): DerivedValueParser<"async", T, S> {
  return {
    $mode: "async",
    metavar: options.metavar,
    [DerivedValueParserMarker]: true,
    [DependencyId]: sourceId,

    parse(input: string): Promise<ValueParserResult<T>> {
      const sourceValue = options.defaultValue();
      const derivedParser = options.factory(sourceValue);
      return derivedParser.parse(input);
    },

    [ParseWithDependency](
      input: string,
      dependencyValue: S,
    ): Promise<ValueParserResult<T>> {
      let derivedParser;
      try {
        derivedParser = options.factory(dependencyValue);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return Promise.resolve({
          success: false,
          error: message`Factory error: ${msg}`,
        });
      }
      return derivedParser.parse(input);
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
        for await (const suggestion of derivedParser.suggest(prefix)) {
          yield suggestion;
        }
      }
    },
  };
}

/**
 * Creates an async derived parser when the source is async but the factory
 * returns a sync parser. The sync result is wrapped in a Promise.
 */
function createAsyncDerivedParserFromSyncFactory<S, T>(
  sourceId: symbol,
  options: InternalDeriveOptions<S, T, "sync">,
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

    [ParseWithDependency](
      input: string,
      dependencyValue: S,
    ): Promise<ValueParserResult<T>> {
      let derivedParser;
      try {
        derivedParser = options.factory(dependencyValue);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return Promise.resolve({
          success: false,
          error: message`Factory error: ${msg}`,
        });
      }
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

// =============================================================================
// Deferred Parsing Types and Functions
// =============================================================================

/**
 * A unique symbol used to identify deferred parse states.
 * @since 0.10.0
 */
export const DeferredParseMarker: unique symbol = Symbol.for(
  "@optique/core/dependency/DeferredParseMarker",
);

/**
 * Represents a deferred parse state for a DerivedValueParser.
 *
 * When a DerivedValueParser is used in an option or argument, the raw
 * input string is stored along with the parser reference. The actual
 * parsing is deferred until `complete()` time when all dependencies
 * have been resolved.
 *
 * @template T The type of value this parser will produce after resolution.
 * @since 0.10.0
 */
export interface DeferredParseState<T = unknown> {
  /**
   * Marker to identify this as a deferred parse state.
   */
  readonly [DeferredParseMarker]: true;

  /**
   * The raw input string to be parsed.
   */
  readonly rawInput: string;

  /**
   * The DerivedValueParser that will parse the input.
   */
  readonly parser: DerivedValueParser<Mode, T, unknown>;

  /**
   * The dependency ID that this parser depends on (for single-dependency parsers).
   */
  readonly dependencyId: symbol;

  /**
   * The dependency IDs that this parser depends on (for multi-dependency parsers).
   * If present, this is used instead of `dependencyId`.
   */
  readonly dependencyIds?: readonly symbol[];

  /**
   * The preliminary parse result using the default dependency value.
   * This is used as a fallback if dependency resolution is not needed
   * or if the dependency was not provided.
   */
  readonly preliminaryResult: ValueParserResult<T>;
}

/**
 * Checks if a value is a {@link DeferredParseState}.
 *
 * @param value The value to check.
 * @returns `true` if the value is a deferred parse state, `false` otherwise.
 * @since 0.10.0
 */
export function isDeferredParseState<T>(
  value: unknown,
): value is DeferredParseState<T> {
  return typeof value === "object" &&
    value !== null &&
    DeferredParseMarker in value &&
    (value as DeferredParseState)[DeferredParseMarker] === true;
}

/**
 * Creates a deferred parse state for a DerivedValueParser.
 *
 * @template T The type of value the parser will produce.
 * @template S The type of the source dependency value.
 * @param rawInput The raw input string to be parsed.
 * @param parser The DerivedValueParser that will parse the input.
 * @param preliminaryResult The parse result using default dependency value.
 * @returns A DeferredParseState object.
 * @since 0.10.0
 */
export function createDeferredParseState<T, S>(
  rawInput: string,
  parser: DerivedValueParser<Mode, T, S>,
  preliminaryResult: ValueParserResult<T>,
): DeferredParseState<T> {
  // Check if parser has multiple dependency IDs (from deriveFrom)
  const multipleIds = DependencyIds in parser
    ? (parser as unknown as { [DependencyIds]: readonly symbol[] })[
      DependencyIds
    ]
    : undefined;

  return {
    [DeferredParseMarker]: true,
    rawInput,
    parser: parser as DerivedValueParser<Mode, T, unknown>,
    dependencyId: parser[DependencyId],
    dependencyIds: multipleIds,
    preliminaryResult,
  };
}

/**
 * A unique symbol used to identify dependency source parse states.
 * @since 0.10.0
 */
export const DependencySourceStateMarker: unique symbol = Symbol.for(
  "@optique/core/dependency/DependencySourceStateMarker",
);

/**
 * Represents a parse state from a DependencySource.
 * This wraps the normal ValueParserResult with the dependency ID so that
 * it can be matched with DeferredParseState during resolution.
 *
 * @template T The type of value this state contains.
 * @since 0.10.0
 */
export interface DependencySourceState<T = unknown> {
  /**
   * Marker to identify this as a dependency source state.
   */
  readonly [DependencySourceStateMarker]: true;

  /**
   * The dependency ID of the source.
   */
  readonly [DependencyId]: symbol;

  /**
   * The underlying parse result.
   */
  readonly result: ValueParserResult<T>;
}

/**
 * Checks if a value is a {@link DependencySourceState}.
 *
 * @param value The value to check.
 * @returns `true` if the value is a dependency source state, `false` otherwise.
 * @since 0.10.0
 */
export function isDependencySourceState<T>(
  value: unknown,
): value is DependencySourceState<T> {
  return typeof value === "object" &&
    value !== null &&
    DependencySourceStateMarker in value &&
    (value as DependencySourceState)[DependencySourceStateMarker] === true;
}

/**
 * Creates a dependency source state from a parse result.
 *
 * @template T The type of value the state contains.
 * @param result The parse result.
 * @param dependencyId The dependency ID.
 * @returns A DependencySourceState object.
 * @since 0.10.0
 */
export function createDependencySourceState<T>(
  result: ValueParserResult<T>,
  dependencyId: symbol,
): DependencySourceState<T> {
  return {
    [DependencySourceStateMarker]: true,
    [DependencyId]: dependencyId,
    result,
  };
}

/**
 * A unique symbol used to identify pending dependency source states.
 * @since 0.10.0
 */
export const PendingDependencySourceStateMarker: unique symbol = Symbol.for(
  "@optique/core/dependency/PendingDependencySourceStateMarker",
);

/**
 * Represents a pending dependency source state.
 * This is used when a dependency source option was not provided, but its
 * dependency ID still needs to be tracked for later resolution with a
 * default value.
 *
 * @since 0.10.0
 */
export interface PendingDependencySourceState {
  /**
   * Marker to identify this as a pending dependency source state.
   */
  readonly [PendingDependencySourceStateMarker]: true;

  /**
   * The dependency ID of the source.
   */
  readonly [DependencyId]: symbol;
}

/**
 * Checks if a value is a {@link PendingDependencySourceState}.
 *
 * @param value The value to check.
 * @returns `true` if the value is a pending dependency source state.
 * @since 0.10.0
 */
export function isPendingDependencySourceState(
  value: unknown,
): value is PendingDependencySourceState {
  return typeof value === "object" &&
    value !== null &&
    PendingDependencySourceStateMarker in value &&
    (value as PendingDependencySourceState)[
        PendingDependencySourceStateMarker
      ] === true;
}

/**
 * Creates a pending dependency source state.
 *
 * @param dependencyId The dependency ID.
 * @returns A PendingDependencySourceState object.
 * @since 0.10.0
 */
export function createPendingDependencySourceState(
  dependencyId: symbol,
): PendingDependencySourceState {
  return {
    [PendingDependencySourceStateMarker]: true,
    [DependencyId]: dependencyId,
  };
}

/**
 * A unique symbol used to identify parsers that wrap a dependency source.
 * This is used by withDefault to indicate it contains an inner parser
 * with a PendingDependencySourceState initialState.
 * @since 0.10.0
 */
export const WrappedDependencySourceMarker: unique symbol = Symbol.for(
  "@optique/core/dependency/WrappedDependencySourceMarker",
);

/**
 * A unique symbol used to indicate that a wrapper transforms the dependency
 * source value. This is used by withDefault to determine whether its default
 * value should be registered as the dependency value.
 *
 * When a wrapper has this marker set to `true`, it means the wrapper transforms
 * the dependency source value (e.g., via map()), so the wrapper's output is NOT
 * a valid dependency source value.
 *
 * @since 0.10.0
 */
export const TransformsDependencyValueMarker: unique symbol = Symbol.for(
  "@optique/core/dependency/TransformsDependencyValueMarker",
);

/**
 * Checks if a parser transforms the dependency value (has TransformsDependencyValueMarker).
 *
 * @param parser The parser to check.
 * @returns `true` if the parser transforms the dependency value.
 * @since 0.10.0
 */
export function transformsDependencyValue(
  parser: unknown,
): parser is { [TransformsDependencyValueMarker]: true } {
  return typeof parser === "object" &&
    parser !== null &&
    TransformsDependencyValueMarker in parser &&
    (parser as { [TransformsDependencyValueMarker]: boolean })[
        TransformsDependencyValueMarker
      ] === true;
}

/**
 * Checks if a parser wraps a dependency source (has WrappedDependencySourceMarker).
 *
 * @param parser The parser to check.
 * @returns `true` if the parser wraps a dependency source.
 * @since 0.10.0
 */
export function isWrappedDependencySource(
  parser: unknown,
): parser is { [WrappedDependencySourceMarker]: PendingDependencySourceState } {
  return typeof parser === "object" &&
    parser !== null &&
    WrappedDependencySourceMarker in parser;
}

/**
 * Represents a resolved dependency value stored during parsing.
 * @since 0.10.0
 */
export interface ResolvedDependency<T = unknown> {
  /**
   * The dependency ID.
   */
  readonly id: symbol;

  /**
   * The resolved value.
   */
  readonly value: T;
}

/**
 * A registry for storing resolved dependency values during parsing.
 * This is used to pass dependency values from DependencySource options
 * to DerivedValueParser options.
 * @since 0.10.0
 */
export class DependencyRegistry {
  private readonly values = new Map<symbol, unknown>();

  /**
   * Registers a resolved dependency value.
   * @param id The dependency ID.
   * @param value The resolved value.
   */
  set<T>(id: symbol, value: T): void {
    this.values.set(id, value);
  }

  /**
   * Gets a resolved dependency value.
   * @param id The dependency ID.
   * @returns The resolved value, or undefined if not found.
   */
  get<T>(id: symbol): T | undefined {
    return this.values.get(id) as T | undefined;
  }

  /**
   * Checks if a dependency has been resolved.
   * @param id The dependency ID.
   * @returns `true` if the dependency has been resolved.
   */
  has(id: symbol): boolean {
    return this.values.has(id);
  }

  /**
   * Creates a copy of the registry.
   */
  clone(): DependencyRegistry {
    const copy = new DependencyRegistry();
    for (const [id, value] of this.values) {
      copy.values.set(id, value);
    }
    return copy;
  }
}

/**
 * Error types for dependency resolution failures.
 * @since 0.10.0
 */
export type DependencyError =
  | {
    /**
     * The dependency was used in multiple locations.
     */
    readonly kind: "duplicate";
    readonly dependencyId: symbol;
    readonly locations: readonly string[];
  }
  | {
    /**
     * A derived parser references a dependency that was not provided.
     */
    readonly kind: "unresolved";
    readonly dependencyId: symbol;
    readonly derivedParserMetavar: string;
  }
  | {
    /**
     * Circular dependency detected.
     */
    readonly kind: "circular";
    readonly cycle: readonly symbol[];
  };

/**
 * Formats a {@link DependencyError} into a human-readable {@link Message}.
 *
 * @param error The dependency error to format.
 * @returns A Message describing the error.
 * @since 0.10.0
 */
export function formatDependencyError(error: DependencyError): Message {
  switch (error.kind) {
    case "duplicate":
      return [
        {
          type: "text" as const,
          text: `Dependency used in multiple locations: ${
            error.locations.join(", ")
          }.`,
        },
      ];
    case "unresolved":
      return [
        {
          type: "text" as const,
          text:
            `Unresolved dependency for ${error.derivedParserMetavar}: the dependency was not provided.`,
        },
      ];
    case "circular":
      return [{ type: "text" as const, text: `Circular dependency detected.` }];
  }
}
