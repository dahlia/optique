import { formatMessage, type Message, message, text } from "./message.ts";
import {
  createDependencySourceState,
  DependencyId,
  isPendingDependencySourceState,
  type PendingDependencySourceState,
  WrappedDependencySourceMarker,
} from "./dependency.ts";
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
  const innerState = typeof context.state === "undefined"
    ? parser.initialState
    : context.state[0];

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
  const innerState = typeof context.state === "undefined"
    ? parser.initialState
    : context.state[0];

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
  const isAsync = parser.$mode === "async";

  // Sync suggest helper
  function* suggestSync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): Generator<Suggestion> {
    const innerState = typeof context.state === "undefined"
      ? syncParser.initialState
      : context.state[0];
    yield* syncParser.suggest({ ...context, state: innerState }, prefix);
  }

  // Async suggest helper
  async function* suggestAsync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): AsyncGenerator<Suggestion> {
    const innerState = typeof context.state === "undefined"
      ? syncParser.initialState
      : context.state[0];
    const suggestions = parser.suggest(
      { ...context, state: innerState },
      prefix,
    ) as AsyncIterable<Suggestion>;
    for await (const s of suggestions) {
      yield s;
    }
  }

  // Type cast needed due to TypeScript's conditional type limitations with generic M
  return {
    $mode: parser.$mode,
    $valueType: [],
    $stateType: [],
    priority: parser.priority,
    usage: [{ type: "optional", terms: parser.usage }],
    initialState: undefined,
    parse(context: ParserContext<[TState] | undefined>) {
      if (isAsync) {
        return parseOptionalStyleAsync(context, parser);
      }
      return parseOptionalStyleSync(context, syncParser);
    },
    complete(state: [TState] | undefined) {
      if (typeof state === "undefined") {
        return { success: true, value: undefined };
      }
      if (!isAsync) {
        return syncParser.complete(state[0]);
      }
      return parser.complete(state[0]);
    },
    suggest(
      context: ParserContext<[TState] | undefined>,
      prefix: string,
    ) {
      if (isAsync) {
        return suggestAsync(context, prefix);
      }
      return suggestSync(context, prefix);
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
    // when M is a generic type parameter. Runtime behavior is correct via isAsync.
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
  const isAsync = parser.$mode === "async";

  // Sync suggest helper
  function* suggestSync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): Generator<Suggestion> {
    const innerState = typeof context.state === "undefined"
      ? syncParser.initialState
      : context.state[0];
    yield* syncParser.suggest({ ...context, state: innerState }, prefix);
  }

  // Async suggest helper
  async function* suggestAsync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): AsyncGenerator<Suggestion> {
    const innerState = typeof context.state === "undefined"
      ? syncParser.initialState
      : context.state[0];
    const suggestions = parser.suggest(
      { ...context, state: innerState },
      prefix,
    ) as AsyncIterable<Suggestion>;
    for await (const s of suggestions) {
      yield s;
    }
  }

  // Check if inner parser's initialState is a PendingDependencySourceState.
  // If so, we need to mark this parser so that object() can find it during
  // dependency resolution (Phase 1).
  const innerInitialState = syncParser.initialState;
  const wrappedDependencyMarker: {
    [WrappedDependencySourceMarker]?: PendingDependencySourceState;
  } = isPendingDependencySourceState(innerInitialState)
    ? { [WrappedDependencySourceMarker]: innerInitialState }
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
      if (isAsync) {
        return parseOptionalStyleAsync(context, parser);
      }
      return parseOptionalStyleSync(context, syncParser);
    },
    complete(state: [TState] | undefined) {
      if (typeof state === "undefined") {
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
      // We should use the default value and wrap it in a DependencySourceState
      // so that derived parsers can find the dependency value.
      if (isPendingDependencySourceState(state[0])) {
        try {
          const value = typeof defaultValue === "function"
            ? (defaultValue as () => TDefault)()
            : defaultValue;
          // Return a DependencySourceState with the default value so that
          // dependency resolution can find this value
          return createDependencySourceState(
            { success: true, value },
            state[0][DependencyId],
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
      if (!isAsync) {
        return syncParser.complete(state[0]);
      }
      return parser.complete(state[0]);
    },
    suggest(
      context: ParserContext<[TState] | undefined>,
      prefix: string,
    ) {
      if (isAsync) {
        return suggestAsync(context, prefix);
      }
      return suggestSync(context, prefix);
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
    // when M is a generic type parameter. Runtime behavior is correct via isAsync.
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

  return {
    ...parser,
    $valueType: [] as readonly U[],
    complete,
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
  const isAsync = parser.$mode === "async";

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
      if (isAsync) {
        // Cast needed: isAsync means parseAsync() returns Promise, but
        // TypeScript sees the declared return type as ParseResult
        return parseAsync(context) as unknown as ParseResult;
      }
      return parseSync(context);
    },
    complete(state: MultipleState) {
      if (!isAsync) {
        // Sync complete
        const result: TValue[] = [];
        for (const s of state) {
          const valueResult = syncParser.complete(s);
          if (valueResult.success) {
            result.push(valueResult.value);
          } else {
            return { success: false, error: valueResult.error };
          }
        }
        return validateMultipleResult(result);
      }

      // Async complete - use Promise.all for parallel execution
      // Type cast needed due to TypeScript's conditional type limitations
      return (async () => {
        const results = await Promise.all(state.map((s) => parser.complete(s)));
        const values: TValue[] = [];
        for (const valueResult of results) {
          if (valueResult.success) {
            values.push(valueResult.value);
          } else {
            return { success: false, error: valueResult.error };
          }
        }
        return validateMultipleResult(values);
      })() as unknown as ReturnType<typeof resultParser.complete>;
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

      if (isAsync) {
        return (async function* () {
          const suggestions = parser.suggest({
            ...context,
            state: innerState,
          }, prefix) as AsyncIterable<Suggestion>;
          for await (const s of suggestions) {
            if (shouldInclude(s)) yield s;
          }
        })();
      }
      return (function* () {
        for (
          const s of syncParser.suggest({
            ...context,
            state: innerState as TState,
          }, prefix)
        ) {
          if (shouldInclude(s)) yield s;
        }
      })();
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
    // when M is a generic type parameter. Runtime behavior is correct via isAsync.
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
