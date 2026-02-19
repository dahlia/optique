import { formatMessage, type Message, message, text } from "./message.ts";
import {
  createDependencySourceState,
  dependencyId,
  isDependencySourceState,
  isPendingDependencySourceState,
  isWrappedDependencySource,
  type PendingDependencySourceState,
  transformsDependencyValue,
  transformsDependencyValueMarker,
  wrappedDependencySourceMarker,
} from "./dependency.ts";
import { dispatchByMode, dispatchIterableByMode } from "./mode-dispatch.ts";
import type {
  DocState,
  Mode,
  ModeValue,
  Parser,
  ParserContext,
  ParserResult,
  Suggestion,
} from "./parser.ts";
import type { ValueParserResult } from "./valueparser.ts";

/**
 * Internal helper for optional-style parsing logic shared by optional()
 * and withDefault(). Handles the common pattern of:
 * - Unwrapping optional state to inner parser state
 * - Detecting if inner parser actually matched (state changed or no consumption)
 * - Returning success with undefined state when inner parser fails without consuming
 * @internal
 */
function parseOptionalStyleSync<TState>(
  context: ParserContext<[TState] | undefined>,
  parser: Parser<"sync", unknown, TState>,
): ParserResult<[TState] | undefined> {
  const innerState = Array.isArray(context.state)
    ? context.state[0]
    : parser.initialState;

  const result = parser.parse({
    ...context,
    state: innerState,
  });

  return processOptionalStyleResult(result, innerState, context);
}

/**
 * Internal async helper for optional-style parsing logic.
 * @internal
 */
async function parseOptionalStyleAsync<TState>(
  context: ParserContext<[TState] | undefined>,
  parser: Parser<Mode, unknown, TState>,
): Promise<ParserResult<[TState] | undefined>> {
  const innerState = Array.isArray(context.state)
    ? context.state[0]
    : parser.initialState;

  const result = await parser.parse({
    ...context,
    state: innerState,
  });

  return processOptionalStyleResult(result, innerState, context);
}

/**
 * Internal helper to process optional-style parse results.
 * @internal
 */
function processOptionalStyleResult<TState>(
  result: ParserResult<TState>,
  innerState: TState,
  context: ParserContext<[TState] | undefined>,
): ParserResult<[TState] | undefined> {
  if (result.success) {
    // Check if inner parser actually matched something (state changed)
    // or if it consumed nothing (e.g., constant parser)
    if (
      result.next.state !== innerState || result.consumed.length === 0
    ) {
      return {
        success: true,
        next: {
          ...result.next,
          state: [result.next.state],
        },
        consumed: result.consumed,
      };
    }
    // Inner parser returned success but state unchanged while consuming input
    // (e.g., only consumed "--"). Treat as "not matched" but propagate side
    // effects (optionsTerminated, buffer)
    return {
      success: true,
      next: {
        ...result.next,
        state: context.state,
      },
      consumed: result.consumed,
    };
  }
  // If inner parser failed without consuming input, return success
  // with undefined state so complete() can provide the fallback value
  if (result.consumed === 0) {
    return {
      success: true,
      next: context,
      consumed: [],
    };
  }
  return result;
}

/**
 * Creates a parser that makes another parser optional, allowing it to succeed
 * without consuming input if the wrapped parser fails to match.
 * If the wrapped parser succeeds, this returns its value.
 * If the wrapped parser fails, this returns `undefined` without consuming input.
 * @template M The execution mode of the parser.
 * @template TValue The type of the value returned by the wrapped parser.
 * @template TState The type of the state used by the wrapped parser.
 * @param parser The {@link Parser} to make optional.
 * @returns A {@link Parser} that produces either the result of the wrapped parser
 *          or `undefined` if the wrapped parser fails to match.
 */
export function optional<M extends Mode, TValue, TState>(
  parser: Parser<M, TValue, TState>,
): Parser<M, TValue | undefined, [TState] | undefined> {
  // Cast to sync for implementation
  const syncParser = parser as Parser<"sync", TValue, TState>;

  // Sync suggest helper
  function* suggestSync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): Generator<Suggestion> {
    const innerState = Array.isArray(context.state)
      ? context.state[0]
      : syncParser.initialState;
    yield* syncParser.suggest({ ...context, state: innerState }, prefix);
  }

  // Async suggest helper
  async function* suggestAsync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): AsyncGenerator<Suggestion> {
    const innerState = Array.isArray(context.state)
      ? context.state[0]
      : syncParser.initialState;
    const suggestions = parser.suggest(
      { ...context, state: innerState },
      prefix,
    ) as AsyncIterable<Suggestion>;
    for await (const s of suggestions) {
      yield s;
    }
  }

  // Track whether the inner parser is a wrapped dependency source (via withDefault)
  // or a direct dependency source (option with dependency source as initialState).
  // This affects the behavior when the option is not provided:
  // - Direct dependency source: return undefined, don't register dependency
  // - Wrapped dependency source: delegate to inner parser to provide default and register dependency
  const innerHasWrappedDependency = isWrappedDependencySource(parser);
  const innerHasDirectDependency = isPendingDependencySourceState(
    syncParser.initialState,
  );

  // Propagate wrappedDependencySourceMarker so outer wrappers (like withDefault)
  // can detect that we wrap a dependency source.
  // For direct dependency sources, we set the marker from inner's initialState.
  // For wrapped dependency sources, we propagate the inner's marker.
  const wrappedDependencyMarker: {
    [wrappedDependencySourceMarker]?: PendingDependencySourceState;
  } = innerHasWrappedDependency
    ? { [wrappedDependencySourceMarker]: parser[wrappedDependencySourceMarker] }
    : innerHasDirectDependency
    ? { [wrappedDependencySourceMarker]: syncParser.initialState }
    : {};

  // Check if this optional parser wraps any dependency source
  const hasWrappedDependencySource = wrappedDependencySourceMarker in
    wrappedDependencyMarker;
  const wrappedPendingState = hasWrappedDependencySource
    ? wrappedDependencyMarker[wrappedDependencySourceMarker]
    : undefined;

  // Type cast needed due to TypeScript's conditional type limitations with generic M
  return {
    $mode: parser.$mode,
    $valueType: [],
    $stateType: [],
    priority: parser.priority,
    usage: [{ type: "optional", terms: parser.usage }],
    initialState: undefined,
    ...wrappedDependencyMarker,
    parse(context: ParserContext<[TState] | undefined>) {
      return dispatchByMode(
        parser.$mode,
        () => parseOptionalStyleSync(context, syncParser),
        () => parseOptionalStyleAsync(context, parser),
      );
    },
    complete(state: [TState] | undefined) {
      // If state was not wrapped (inner parser didn't match) and this
      // optional wraps a dependency source:
      if (!Array.isArray(state)) {
        // Case 1: Inner parser has a wrapped dependency source (e.g., optional(withDefault(...)))
        // Delegate to inner parser which will provide its default value and register dependency
        if (innerHasWrappedDependency && wrappedPendingState) {
          // Delegate to inner parser with the pending state wrapped in array
          // (inner parser like withDefault expects [PendingDependencySourceState])
          return dispatchByMode(
            parser.$mode,
            () =>
              syncParser.complete([wrappedPendingState] as unknown as TState),
            // Cast needed: parser.complete() returns ModeValue<M, ...> but we know M is "async" here
            () =>
              parser.complete(
                [wrappedPendingState] as unknown as TState,
              ) as Promise<ValueParserResult<TValue | undefined>>,
          );
        }
        // Case 2: Inner parser is a direct dependency source (e.g., optional(option(..., dep)))
        // Return undefined and DON'T register dependency - derived parsers use their defaultValue
        return { success: true, value: undefined };
      }
      // If state contains a PendingDependencySourceState:
      // This happens when object() calls complete with [pendingState] for wrapped dependency sources.
      if (
        Array.isArray(state) &&
        state.length === 1 &&
        isPendingDependencySourceState(state[0])
      ) {
        // Only pass through to inner parser if inner HAS its own wrapped dependency
        // (e.g., optional(withDefault(...))). Otherwise, return undefined.
        if (innerHasWrappedDependency) {
          // Pass the state as-is to the inner parser (it's already in the
          // right format [PendingDependencySourceState])
          return dispatchByMode(
            parser.$mode,
            () => syncParser.complete(state as unknown as TState),
            // Cast needed: parser.complete() returns ModeValue<M, ...> but we know M is "async" here
            () =>
              parser.complete(state as unknown as TState) as Promise<
                ValueParserResult<TValue | undefined>
              >,
          );
        }
        // Inner parser is a direct dependency source (e.g., optional(option(..., dep)))
        // Return undefined - the dependency is not provided
        return { success: true, value: undefined };
      }
      return dispatchByMode(
        parser.$mode,
        () => syncParser.complete(state[0]),
        // Cast needed: parser.complete() returns ModeValue<M, ...> but we know M is "async" here
        () =>
          parser.complete(state[0]) as Promise<
            ValueParserResult<TValue | undefined>
          >,
      );
    },
    suggest(
      context: ParserContext<[TState] | undefined>,
      prefix: string,
    ) {
      return dispatchIterableByMode(
        parser.$mode,
        () => suggestSync(context, prefix),
        () => suggestAsync(context, prefix),
      );
    },
    getDocFragments(
      state: DocState<[TState] | undefined>,
      defaultValue?: TValue,
    ) {
      const innerState: DocState<TState> = state.kind === "unavailable"
        ? { kind: "unavailable" }
        : state.state === undefined
        ? { kind: "unavailable" }
        : { kind: "available", state: state.state[0] };
      return syncParser.getDocFragments(innerState, defaultValue);
    },
    // Type assertion needed because TypeScript cannot verify ModeValue<M, T>
    // when M is a generic type parameter. Runtime behavior is correct via mode dispatch.
  } as unknown as Parser<M, TValue | undefined, [TState] | undefined>;
}

/**
 * Options for the {@link withDefault} parser.
 */
export interface WithDefaultOptions {
  /**
   * Custom message to display in help output instead of the formatted default value.
   * This allows showing descriptive text like "SERVICE_URL environment variable"
   * instead of the actual default value.
   *
   * @example
   * ```typescript
   * withDefault(
   *   option("--url", url()),
   *   process.env["SERVICE_URL"],
   *   { message: message`${envVar("SERVICE_URL")} environment variable` }
   * )
   * ```
   */
  readonly message?: Message;
}

/**
 * Error type for structured error messages in {@link withDefault} default value callbacks.
 * Unlike regular errors that only support string messages, this error type accepts
 * a {@link Message} object that supports rich formatting, colors, and structured content.
 *
 * @example
 * ```typescript
 * withDefault(option("--url", url()), () => {
 *   if (!process.env.INSTANCE_URL) {
 *     throw new WithDefaultError(
 *       message`Environment variable ${envVar("INSTANCE_URL")} is not set.`
 *     );
 *   }
 *   return new URL(process.env.INSTANCE_URL);
 * })
 * ```
 *
 * @since 0.5.0
 */
export class WithDefaultError extends Error {
  /**
   * The structured message associated with this error.
   */
  readonly errorMessage: Message;

  /**
   * Creates a new WithDefaultError with a structured message.
   * @param message The structured {@link Message} describing the error.
   */
  constructor(message: Message) {
    super(formatMessage(message));
    this.errorMessage = message;
    this.name = "WithDefaultError";
  }
}

/**
 * Creates a parser that makes another parser use a default value when it fails
 * to match or consume input. This is similar to {@link optional}, but instead
 * of returning `undefined` when the wrapped parser doesn't match, it returns
 * a specified default value.
 * @template M The execution mode of the parser.
 * @template TValue The type of the value returned by the wrapped parser.
 * @template TState The type of the state used by the wrapped parser.
 * @template TDefault The type of the default value.
 * @param parser The {@link Parser} to wrap with default behavior.
 * @param defaultValue The default value to return when the wrapped parser
 *                     doesn't match or consume input. Can be a value of type
 *                     {@link TDefault} or a function that returns such a value.
 * @returns A {@link Parser} that produces either the result of the wrapped parser
 *          or the default value if the wrapped parser fails to match
 *          (union type {@link TValue} | {@link TDefault}).
 */
export function withDefault<
  M extends Mode,
  TValue,
  TState,
  const TDefault = TValue,
>(
  parser: Parser<M, TValue, TState>,
  defaultValue: TDefault | (() => TDefault),
): Parser<M, TValue | TDefault, [TState] | undefined>;

/**
 * Creates a parser that makes another parser use a default value when it fails
 * to match or consume input. This is similar to {@link optional}, but instead
 * of returning `undefined` when the wrapped parser doesn't match, it returns
 * a specified default value.
 * @template M The execution mode of the parser.
 * @template TValue The type of the value returned by the wrapped parser.
 * @template TState The type of the state used by the wrapped parser.
 * @template TDefault The type of the default value.
 * @param parser The {@link Parser} to wrap with default behavior.
 * @param defaultValue The default value to return when the wrapped parser
 *                     doesn't match or consume input. Can be a value of type
 *                     {@link TDefault} or a function that returns such a value.
 * @param options Optional configuration including custom help display message.
 * @returns A {@link Parser} that produces either the result of the wrapped parser
 *          or the default value if the wrapped parser fails to match
 *          (union type {@link TValue} | {@link TDefault}).
 * @since 0.5.0
 */
export function withDefault<
  M extends Mode,
  TValue,
  TState,
  const TDefault = TValue,
>(
  parser: Parser<M, TValue, TState>,
  defaultValue: TDefault | (() => TDefault),
  options?: WithDefaultOptions,
): Parser<M, TValue | TDefault, [TState] | undefined>;

export function withDefault<
  M extends Mode,
  TValue,
  TState,
  const TDefault = TValue,
>(
  parser: Parser<M, TValue, TState>,
  defaultValue: TDefault | (() => TDefault),
  options?: WithDefaultOptions,
): Parser<M, TValue | TDefault, [TState] | undefined> {
  // Cast to sync for implementation
  const syncParser = parser as Parser<"sync", TValue, TState>;

  // Sync suggest helper
  function* suggestSync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): Generator<Suggestion> {
    const innerState = Array.isArray(context.state)
      ? context.state[0]
      : syncParser.initialState;
    yield* syncParser.suggest({ ...context, state: innerState }, prefix);
  }

  // Async suggest helper
  async function* suggestAsync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): AsyncGenerator<Suggestion> {
    const innerState = Array.isArray(context.state)
      ? context.state[0]
      : syncParser.initialState;
    const suggestions = parser.suggest(
      { ...context, state: innerState },
      prefix,
    ) as AsyncIterable<Suggestion>;
    for await (const s of suggestions) {
      yield s;
    }
  }

  // Check if inner parser's initialState is a PendingDependencySourceState,
  // or if inner parser has a wrappedDependencySourceMarker.
  // If so, we need to mark this parser so that object() can find it during
  // dependency resolution (Phase 1).
  const innerInitialState = syncParser.initialState;
  const wrappedDependencyMarker: {
    [wrappedDependencySourceMarker]?: PendingDependencySourceState;
  } = isPendingDependencySourceState(innerInitialState)
    ? { [wrappedDependencySourceMarker]: innerInitialState }
    : isWrappedDependencySource(parser)
    ? { [wrappedDependencySourceMarker]: parser[wrappedDependencySourceMarker] }
    : {};

  // Type cast needed due to TypeScript's conditional type limitations with generic M
  return {
    $mode: parser.$mode,
    $valueType: [],
    $stateType: [],
    priority: parser.priority,
    usage: [{ type: "optional", terms: parser.usage }],
    initialState: undefined,
    ...wrappedDependencyMarker,
    parse(context: ParserContext<[TState] | undefined>) {
      return dispatchByMode(
        parser.$mode,
        () => parseOptionalStyleSync(context, syncParser),
        () => parseOptionalStyleAsync(context, parser),
      );
    },
    complete(state: [TState] | undefined) {
      if (!Array.isArray(state)) {
        // If inner parser transforms the dependency value (e.g., map()),
        // we need to delegate to see if the chain actually wants to register.
        // A transform means our default value is NOT a valid dependency source value.
        if (transformsDependencyValue(parser)) {
          // Call inner parser's complete(undefined) to see if it returns
          // a DependencySourceState. If it does, we should also return one
          // with our default value. If not (e.g., optional returned undefined),
          // we should NOT register the dependency.
          const innerResult = dispatchByMode(
            parser.$mode,
            () => syncParser.complete(undefined as unknown as TState),
            // Cast needed: parser.complete() returns ModeValue<M, ...> but we know M is "async" here
            () =>
              parser.complete(undefined as unknown as TState) as Promise<
                ValueParserResult<TValue>
              >,
          );
          const handleInnerResult = (
            res: ValueParserResult<TValue>,
          ): ValueParserResult<TValue | TDefault> => {
            // If inner result is a DependencySourceState, we should also
            // return one with our default value (though this shouldn't happen
            // with transforms since they break the dependency chain)
            if (isDependencySourceState(res)) {
              try {
                const value = typeof defaultValue === "function"
                  ? (defaultValue as () => TDefault)()
                  : defaultValue;
                return createDependencySourceState(
                  { success: true, value },
                  res[dependencyId],
                ) as unknown as ValueParserResult<TValue | TDefault>;
              } catch (error) {
                return {
                  success: false,
                  error: error instanceof WithDefaultError
                    ? error.errorMessage
                    : message`${text(String(error))}`,
                };
              }
            }
            // Inner parser didn't return a DependencySourceState (e.g., optional
            // returned undefined). Return our default value WITHOUT registering
            // the dependency.
            try {
              const value = typeof defaultValue === "function"
                ? (defaultValue as () => TDefault)()
                : defaultValue;
              return { success: true, value };
            } catch (error) {
              return {
                success: false,
                error: error instanceof WithDefaultError
                  ? error.errorMessage
                  : message`${text(String(error))}`,
              };
            }
          };
          if (innerResult instanceof Promise) {
            return innerResult.then(handleInnerResult) as ModeValue<
              M,
              ValueParserResult<TValue | TDefault>
            >;
          }
          return handleInnerResult(innerResult) as ModeValue<
            M,
            ValueParserResult<TValue | TDefault>
          >;
        }
        // Inner parser does NOT transform the dependency value. If there's a
        // wrapped dependency source, we should register with the default value.
        if (isWrappedDependencySource(parser)) {
          try {
            const value = typeof defaultValue === "function"
              ? (defaultValue as () => TDefault)()
              : defaultValue;
            const pendingState = parser[wrappedDependencySourceMarker];
            return createDependencySourceState(
              { success: true, value },
              pendingState[dependencyId],
            ) as unknown as ValueParserResult<TValue | TDefault>;
          } catch (error) {
            return {
              success: false,
              error: error instanceof WithDefaultError
                ? error.errorMessage
                : message`${text(String(error))}`,
            };
          }
        }
        // No wrapped dependency source - just return the default value.
        try {
          const value = typeof defaultValue === "function"
            ? (defaultValue as () => TDefault)()
            : defaultValue;
          return { success: true, value };
        } catch (error) {
          return {
            success: false,
            error: error instanceof WithDefaultError
              ? error.errorMessage
              : message`${text(String(error))}`,
          };
        }
      }
      // Check if the inner state is a PendingDependencySourceState.
      // This means the option uses a DependencySource but wasn't provided.
      // We need to check if the inner chain wants to register the dependency.
      // For example, withDefault(map(optional(...))) should NOT register
      // the dependency when the optional's inner parser wasn't matched.
      if (isPendingDependencySourceState(state[0])) {
        // If inner parser transforms the dependency value (e.g., map()),
        // we need to delegate to see if the chain actually wants to register.
        // A transform means our default value is NOT a valid dependency source value.
        if (transformsDependencyValue(parser)) {
          const innerResult = dispatchByMode(
            parser.$mode,
            () => syncParser.complete(state as unknown as TState),
            // Cast needed: parser.complete() returns ModeValue<M, ...> but we know M is "async" here
            () =>
              parser.complete(state as unknown as TState) as Promise<
                ValueParserResult<TValue>
              >,
          );
          const handleInnerResult = (
            res: ValueParserResult<TValue>,
          ): ValueParserResult<TValue | TDefault> => {
            // If inner result is a DependencySourceState, return one with our default
            // (but this shouldn't normally happen since transforms break the chain)
            if (isDependencySourceState(res)) {
              try {
                const value = typeof defaultValue === "function"
                  ? (defaultValue as () => TDefault)()
                  : defaultValue;
                return createDependencySourceState(
                  { success: true, value },
                  res[dependencyId],
                ) as unknown as ValueParserResult<TValue | TDefault>;
              } catch (error) {
                return {
                  success: false,
                  error: error instanceof WithDefaultError
                    ? error.errorMessage
                    : message`${text(String(error))}`,
                };
              }
            }
            // Inner parser didn't return a DependencySourceState. Return default
            // value WITHOUT registering the dependency.
            try {
              const value = typeof defaultValue === "function"
                ? (defaultValue as () => TDefault)()
                : defaultValue;
              return { success: true, value };
            } catch (error) {
              return {
                success: false,
                error: error instanceof WithDefaultError
                  ? error.errorMessage
                  : message`${text(String(error))}`,
              };
            }
          };
          if (innerResult instanceof Promise) {
            return innerResult.then(handleInnerResult) as ModeValue<
              M,
              ValueParserResult<TValue | TDefault>
            >;
          }
          return handleInnerResult(innerResult) as ModeValue<
            M,
            ValueParserResult<TValue | TDefault>
          >;
        }
        // Inner parser does NOT transform the dependency value (e.g., optional()).
        // Register the dependency with default value.
        try {
          const value = typeof defaultValue === "function"
            ? (defaultValue as () => TDefault)()
            : defaultValue;
          // Return a DependencySourceState with the default value so that
          // dependency resolution can find this value
          return createDependencySourceState(
            { success: true, value },
            state[0][dependencyId],
          ) as unknown as ValueParserResult<TValue | TDefault>;
        } catch (error) {
          return {
            success: false,
            error: error instanceof WithDefaultError
              ? error.errorMessage
              : message`${text(String(error))}`,
          };
        }
      }
      return dispatchByMode(
        parser.$mode,
        () => syncParser.complete(state[0]),
        // Cast needed: parser.complete() returns ModeValue<M, ...> but we know M is "async" here
        () =>
          parser.complete(state[0]) as Promise<
            ValueParserResult<TValue | TDefault>
          >,
      );
    },
    suggest(
      context: ParserContext<[TState] | undefined>,
      prefix: string,
    ) {
      return dispatchIterableByMode(
        parser.$mode,
        () => suggestSync(context, prefix),
        () => suggestAsync(context, prefix),
      );
    },
    getDocFragments(
      state: DocState<[TState] | undefined>,
      upperDefaultValue?: TValue | TDefault,
    ) {
      const innerState: DocState<TState> = state.kind === "unavailable"
        ? { kind: "unavailable" }
        : state.state === undefined
        ? { kind: "unavailable" }
        : { kind: "available", state: state.state[0] };

      const actualDefaultValue = upperDefaultValue != null
        ? upperDefaultValue as TValue
        : typeof defaultValue === "function"
        ? (defaultValue as () => TDefault)() as unknown as TValue
        : defaultValue as unknown as TValue;

      const fragments = syncParser.getDocFragments(
        innerState,
        actualDefaultValue,
      );

      // If a custom message is provided, replace the default field in all entries
      if (options?.message) {
        const modifiedFragments = fragments.fragments.map((fragment) => {
          if (fragment.type === "entry") {
            return {
              ...fragment,
              default: options.message,
            };
          }
          return fragment;
        });
        return {
          ...fragments,
          fragments: modifiedFragments,
        };
      }

      return fragments;
    },
    // Type assertion needed because TypeScript cannot verify ModeValue<M, T>
    // when M is a generic type parameter. Runtime behavior is correct via mode dispatch.
  } as unknown as Parser<M, TValue | TDefault, [TState] | undefined>;
}

/**
 * Creates a parser that transforms the result value of another parser using
 * a mapping function. This enables value transformation while preserving
 * the original parser's parsing logic and state management.
 *
 * The `map()` function is useful for:
 * - Converting parsed values to different types
 * - Applying transformations like string formatting or boolean inversion
 * - Computing derived values from parsed input
 * - Creating reusable transformations that can be applied to any parser
 *
 * @template M The execution mode of the parser.
 * @template T The type of the value produced by the original parser.
 * @template U The type of the value produced by the mapping function.
 * @template TState The type of the state used by the original parser.
 * @param parser The {@link Parser} whose result will be transformed.
 * @param transform A function that transforms the parsed value from type T to type U.
 * @returns A {@link Parser} that produces the transformed value of type U
 *          while preserving the original parser's state type and parsing behavior.
 *
 * @example
 * ```typescript
 * // Transform boolean flag to its inverse
 * const parser = object({
 *   disallow: map(option("--allow"), b => !b)
 * });
 *
 * // Transform string to uppercase
 * const upperParser = map(argument(string()), s => s.toUpperCase());
 *
 * // Transform number to formatted string
 * const prefixedParser = map(option("-n", integer()), n => `value: ${n}`);
 * ```
 */
export function map<M extends Mode, T, U, TState>(
  parser: Parser<M, T, TState>,
  transform: (value: T) => U,
): Parser<M, U, TState> {
  const complete = (state: TState): ModeValue<M, ValueParserResult<U>> => {
    const res = parser.complete(state);

    if (res instanceof Promise) {
      return res.then((r) => {
        if (r.success) {
          return { success: true, value: transform(r.value) };
        }
        return r;
      }) as ModeValue<M, ValueParserResult<U>>;
    }

    if (res.success) {
      return { success: true, value: transform(res.value) } as ModeValue<
        M,
        ValueParserResult<U>
      >;
    }

    return res as ModeValue<M, ValueParserResult<U>>;
  };

  // Propagate wrappedDependencySourceMarker from inner parser, and mark
  // this wrapper as transforming the dependency value. This allows outer
  // wrappers like withDefault to know that the default value is NOT a valid
  // dependency source value.
  const dependencyMarkers: {
    [wrappedDependencySourceMarker]?: PendingDependencySourceState;
    [transformsDependencyValueMarker]?: true;
  } = isWrappedDependencySource(parser)
    ? {
      [wrappedDependencySourceMarker]: parser[wrappedDependencySourceMarker],
      [transformsDependencyValueMarker]: true,
    }
    : {};

  return {
    ...parser,
    $valueType: [] as readonly U[],
    complete,
    ...dependencyMarkers,
    getDocFragments(state: DocState<TState>, _defaultValue?: U) {
      // Since we can't reverse the transformation, we delegate to the original
      // parser with undefined default value. This is acceptable since
      // documentation typically shows the input format, not the transformed output.
      return parser.getDocFragments(state, undefined);
    },
  } as Parser<M, U, TState>;
}

/**
 * Options for the {@link multiple} parser.
 */
export interface MultipleOptions {
  /**
   * The minimum number of occurrences required for the parser to succeed.
   * If the number of occurrences is less than this value,
   * the parser will fail with an error.
   * @default `0`
   */
  readonly min?: number;

  /**
   * The maximum number of occurrences allowed for the parser.
   * If the number of occurrences exceeds this value,
   * the parser will fail with an error.
   * @default `Infinity`
   */
  readonly max?: number;

  /**
   * Error messages customization.
   * @since 0.5.0
   */
  readonly errors?: MultipleErrorOptions;
}

/**
 * Options for customizing error messages in the {@link multiple} parser.
 * @since 0.5.0
 */
export interface MultipleErrorOptions {
  /**
   * Error message when fewer than the minimum number of values are provided.
   */
  readonly tooFew?: Message | ((min: number, actual: number) => Message);

  /**
   * Error message when more than the maximum number of values are provided.
   */
  readonly tooMany?: Message | ((max: number, actual: number) => Message);
}

/**
 * Creates a parser that allows multiple occurrences of a given parser.
 * This parser can be used to parse multiple values of the same type,
 * such as multiple command-line arguments or options.
 * @template M The execution mode of the parser.
 * @template TValue The type of the value that the parser produces.
 * @template TState The type of the state used by the parser.
 * @param parser The {@link Parser} to apply multiple times.
 * @param options Optional configuration for the parser,
 *                allowing you to specify the minimum and maximum number of
 *                occurrences allowed.
 * @returns A {@link Parser} that produces an array of values
 *          of type {@link TValue} and an array of states
 *          of type {@link TState}.
 */
export function multiple<M extends Mode, TValue, TState>(
  parser: Parser<M, TValue, TState>,
  options: MultipleOptions = {},
): Parser<M, readonly TValue[], readonly TState[]> {
  // Cast to sync for sync operations
  const syncParser = parser as Parser<"sync", TValue, TState>;

  const { min = 0, max = Infinity } = options;

  type MultipleState = readonly TState[];
  type ParseResult = ParserResult<MultipleState>;

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<MultipleState>,
  ): ParseResult => {
    let added = context.state.length < 1;
    let result = syncParser.parse({
      ...context,
      state: context.state.at(-1) ?? syncParser.initialState,
    });
    if (!result.success) {
      if (!added) {
        result = syncParser.parse({
          ...context,
          state: syncParser.initialState,
        });
        if (!result.success) return result;
        added = true;
      } else {
        return result;
      }
    }
    return {
      success: true,
      next: {
        ...result.next,
        state: [
          ...(added ? context.state : context.state.slice(0, -1)),
          result.next.state,
        ],
      },
      consumed: result.consumed,
    };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<MultipleState>,
  ): Promise<ParseResult> => {
    let added = context.state.length < 1;
    let resultOrPromise = parser.parse({
      ...context,
      state: context.state.at(-1) ?? parser.initialState,
    });
    let result = await resultOrPromise;
    if (!result.success) {
      if (!added) {
        resultOrPromise = parser.parse({
          ...context,
          state: parser.initialState,
        });
        result = await resultOrPromise;
        if (!result.success) return result;
        added = true;
      } else {
        return result;
      }
    }
    return {
      success: true,
      next: {
        ...result.next,
        state: [
          ...(added ? context.state : context.state.slice(0, -1)),
          result.next.state,
        ],
      },
      consumed: result.consumed,
    };
  };

  const resultParser = {
    $mode: parser.$mode,
    $valueType: [] as readonly TValue[],
    $stateType: [] as readonly TState[],
    priority: parser.priority,
    usage: [{ type: "multiple", terms: parser.usage, min }],
    initialState: [] as readonly TState[],
    parse(context: ParserContext<MultipleState>) {
      return dispatchByMode(
        parser.$mode,
        () => parseSync(context),
        () => parseAsync(context),
      );
    },
    complete(state: MultipleState) {
      return dispatchByMode(
        parser.$mode,
        () => {
          // Sync complete
          const result: TValue[] = [];
          for (const s of state) {
            const valueResult = syncParser.complete(s);
            if (valueResult.success) {
              result.push(valueResult.value);
            } else {
              return { success: false as const, error: valueResult.error };
            }
          }
          return validateMultipleResult(result);
        },
        async () => {
          // Async complete - use Promise.all for parallel execution
          const results = await Promise.all(
            state.map((s) => parser.complete(s)),
          );
          const values: TValue[] = [];
          for (const valueResult of results) {
            if (valueResult.success) {
              values.push(valueResult.value);
            } else {
              return { success: false as const, error: valueResult.error };
            }
          }
          return validateMultipleResult(values);
        },
      );
    },
    suggest(context: ParserContext<MultipleState>, prefix: string) {
      // Use the most recent state for suggestions, or initial state if empty
      const innerState = context.state.length > 0
        ? context.state.at(-1)!
        : parser.initialState;

      // Extract already-selected values from completed states to exclude them
      // from suggestions (fixes https://github.com/dahlia/optique/issues/73)
      const selectedValues = new Set<string>();
      for (const s of context.state) {
        const completed = syncParser.complete(s as TState);
        if (completed.success) {
          // Convert value to string for comparison with suggestion text
          const valueStr = String(completed.value);
          selectedValues.add(valueStr);
        }
      }

      // Helper to filter suggestions
      const shouldInclude = (suggestion: Suggestion) => {
        if (suggestion.kind === "literal") {
          return !selectedValues.has(suggestion.text);
        }
        return true;
      };

      return dispatchIterableByMode(
        parser.$mode,
        function* () {
          for (
            const s of syncParser.suggest({
              ...context,
              state: innerState as TState,
            }, prefix)
          ) {
            if (shouldInclude(s)) yield s;
          }
        },
        async function* () {
          const suggestions = parser.suggest({
            ...context,
            state: innerState,
          }, prefix) as AsyncIterable<Suggestion>;
          for await (const s of suggestions) {
            if (shouldInclude(s)) yield s;
          }
        },
      );
    },
    getDocFragments(
      state: DocState<MultipleState>,
      defaultValue?: readonly TValue[],
    ) {
      const innerState: DocState<TState> = state.kind === "unavailable"
        ? { kind: "unavailable" }
        : state.state.length > 0
        ? { kind: "available", state: state.state.at(-1)! }
        : { kind: "unavailable" };
      return syncParser.getDocFragments(
        innerState,
        defaultValue != null && defaultValue.length > 0
          ? defaultValue[0]
          : undefined,
      );
    },
    // Type assertion needed because TypeScript cannot verify ModeValue<M, T>
    // when M is a generic type parameter. Runtime behavior is correct via mode dispatch.
  } as unknown as Parser<M, readonly TValue[], readonly TState[]>;

  // Helper function for validating multiple result count
  function validateMultipleResult(result: TValue[]) {
    if (result.length < min) {
      const customMessage = options.errors?.tooFew;
      return {
        success: false as const,
        error: customMessage
          ? (typeof customMessage === "function"
            ? customMessage(min, result.length)
            : customMessage)
          : message`Expected at least ${
            text(min.toLocaleString("en"))
          } values, but got only ${text(result.length.toLocaleString("en"))}.`,
      };
    } else if (result.length > max) {
      const customMessage = options.errors?.tooMany;
      return {
        success: false as const,
        error: customMessage
          ? (typeof customMessage === "function"
            ? customMessage(max, result.length)
            : customMessage)
          : message`Expected at most ${
            text(max.toLocaleString("en"))
          } values, but got ${text(result.length.toLocaleString("en"))}.`,
      };
    }
    return { success: true as const, value: result };
  }

  return resultParser;
}

/**
 * Creates a parser that requires the wrapped parser to consume at least one
 * input token to succeed. If the wrapped parser succeeds without consuming
 * any tokens, this parser fails with an error.
 *
 * This modifier is useful with `longestMatch()` for implementing conditional
 * default values. When used together, `nonEmpty()` prevents a parser with
 * only default values from matching when no input is provided, allowing
 * another branch (like a help command) to match instead.
 *
 * @template M The execution mode of the parser.
 * @template T The type of value produced by the wrapped parser.
 * @template TState The type of state used by the wrapped parser.
 * @param parser The {@link Parser} that must consume input to succeed.
 * @returns A {@link Parser} that fails if the wrapped parser consumes no input.
 *
 * @example
 * ```typescript
 * // Without nonEmpty(): activeParser always wins (consumes 0 tokens)
 * // With nonEmpty(): helpParser wins when no options are provided
 * const activeParser = nonEmpty(object({
 *   cwd: withDefault(option("--cwd", string()), "./default"),
 *   key: optional(option("--key", string())),
 * }));
 *
 * const helpParser = object({
 *   mode: constant("help"),
 * });
 *
 * const parser = longestMatch(activeParser, helpParser);
 *
 * // cli           → helpParser matches (activeParser fails with nonEmpty)
 * // cli --key foo → activeParser matches (consumes tokens)
 * ```
 *
 * @since 0.10.0
 */
export function nonEmpty<M extends Mode, T, TState>(
  parser: Parser<M, T, TState>,
): Parser<M, T, TState> {
  const syncParser = parser as Parser<"sync", T, TState>;

  // Helper to process the result of the inner parser
  const processNonEmptyResult = (
    result: ParserResult<TState>,
  ): ParserResult<TState> => {
    if (!result.success) {
      return result;
    }
    // Check if inner parser consumed at least one token
    if (result.consumed.length === 0) {
      return {
        success: false,
        consumed: 0,
        error: message`Parser must consume at least one token.`,
      };
    }
    return result;
  };

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<TState>,
  ): ParserResult<TState> => {
    const result = syncParser.parse(context);
    return processNonEmptyResult(result);
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<TState>,
  ): Promise<ParserResult<TState>> => {
    const result = await parser.parse(context);
    return processNonEmptyResult(result);
  };

  return {
    $mode: parser.$mode,
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    usage: parser.usage,
    initialState: parser.initialState,
    parse(context: ParserContext<TState>) {
      return dispatchByMode(
        parser.$mode,
        () => parseSync(context),
        () => parseAsync(context),
      );
    },
    complete(state: TState) {
      return parser.complete(state);
    },
    suggest(context: ParserContext<TState>, prefix: string) {
      return parser.suggest(context, prefix);
    },
    getDocFragments(state: DocState<TState>, defaultValue?: T) {
      return syncParser.getDocFragments(state, defaultValue);
    },
  } as Parser<M, T, TState>;
}
