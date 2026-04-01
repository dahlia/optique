import { composeDependencyMetadata } from "./dependency-metadata.ts";
import type { RuntimeNode } from "./dependency-runtime.ts";
import { formatMessage, type Message, message, text } from "./message.ts";
import {
  annotateFreshArray,
  getAnnotations,
  inheritAnnotations,
  isInjectedAnnotationWrapper,
  unwrapInjectedAnnotationWrapper,
} from "./annotations.ts";
import {
  dispatchByMode,
  dispatchIterableByMode,
  mapModeValue,
} from "./mode-dispatch.ts";
import type {
  DocState,
  ExecutionContext,
  Mode,
  ModeValue,
  Parser,
  ParserContext,
  ParserResult,
  Suggestion,
} from "./parser.ts";
import type { DeferredMap, ValueParserResult } from "./valueparser.ts";

function withChildExecPath(
  exec: ExecutionContext | undefined,
  segment: PropertyKey,
): ExecutionContext | undefined {
  if (exec == null) return undefined;
  return {
    ...exec,
    path: [...(exec.path ?? []), segment],
  };
}

function mergeChildExec(
  parent: ExecutionContext | undefined,
  child: ExecutionContext | undefined,
): ExecutionContext | undefined {
  if (parent == null) return child;
  if (child == null) return parent;
  return {
    ...parent,
    trace: child.trace ?? parent.trace,
    dependencyRuntime: child.dependencyRuntime ?? parent.dependencyRuntime,
    dependencyRegistry: child.dependencyRegistry ?? parent.dependencyRegistry,
    preCompletedByParser: child.preCompletedByParser ??
      parent.preCompletedByParser,
    excludedSourceFields: child.excludedSourceFields ??
      parent.excludedSourceFields,
  };
}

function withChildContext<TState>(
  context: ParserContext<unknown>,
  segment: PropertyKey,
  state: TState,
): ParserContext<TState> {
  const exec = withChildExecPath(context.exec, segment);
  const dependencyRegistry = context.dependencyRegistry ??
    exec?.dependencyRegistry;
  return {
    ...context,
    state,
    ...(exec != null
      ? {
        exec: dependencyRegistry === exec.dependencyRegistry
          ? exec
          : { ...exec, dependencyRegistry },
        dependencyRegistry,
      }
      : {}),
  };
}

function isTerminalMultipleItemState(state: unknown): boolean {
  let unwrapped = state;
  while (true) {
    if (isInjectedAnnotationWrapper(unwrapped)) {
      unwrapped = unwrapInjectedAnnotationWrapper(unwrapped);
      continue;
    }
    if (Array.isArray(unwrapped) && unwrapped.length === 1) {
      unwrapped = unwrapped[0];
      continue;
    }
    return unwrapped != null && typeof unwrapped === "object" &&
      Object.hasOwn(unwrapped, "success") &&
      typeof (unwrapped as { success?: unknown }).success === "boolean";
  }
}

function isUnstartedMultipleItemState(
  state: unknown,
  originalState?: unknown,
): boolean {
  let unwrappedState = state;
  while (isInjectedAnnotationWrapper(unwrappedState)) {
    unwrappedState = unwrapInjectedAnnotationWrapper(unwrappedState);
  }
  if (unwrappedState == null) return true;

  if (originalState === undefined) return false;

  let unwrappedOriginalState = originalState;
  while (isInjectedAnnotationWrapper(unwrappedOriginalState)) {
    unwrappedOriginalState = unwrapInjectedAnnotationWrapper(
      unwrappedOriginalState,
    );
  }
  return unwrappedState === unwrappedOriginalState &&
    unwrappedOriginalState != null &&
    typeof unwrappedOriginalState === "object";
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return value != null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (value as Record<string, unknown>).then === "function";
}

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
 * Creates a `shouldDeferCompletion` adapter that unwraps the outer state
 * shape (`[TState] | undefined`) used by {@link optional} and
 * {@link withDefault} before delegating to the inner parser's hook.
 *
 * When state is an array, the adapter unwraps `state[0]` and propagates
 * annotations from the outer array.  Non-array objects (e.g., PromptBindState
 * from `prompt()`) are passed through directly.  `undefined` returns `false`
 * without calling the inner hook.
 *
 * @internal
 */
function adaptShouldDeferCompletion<TState>(
  innerCheck: (state: TState, exec?: ExecutionContext) => boolean,
): (state: [TState] | undefined, exec?: ExecutionContext) => boolean {
  return (state: [TState] | undefined, exec?: ExecutionContext): boolean => {
    if (Array.isArray(state)) {
      return innerCheck(
        normalizeOptionalLikeInnerState(state, state[0]),
        exec,
      );
    }
    if (state != null && typeof state === "object") {
      return innerCheck(state, exec);
    }
    return false;
  };
}

function normalizeOptionalLikeInnerState<TState>(
  state: [TState] | TState | undefined,
  initialState: TState,
): TState {
  if (Array.isArray(state)) {
    return getAnnotations(state) != null &&
        state[0] != null &&
        typeof state[0] === "object"
      ? inheritAnnotations(state, state[0]) as TState
      : state[0];
  }
  if (state != null && typeof state === "object") {
    return state;
  }
  return initialState;
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
    const innerState = normalizeOptionalLikeInnerState(
      context.state,
      syncParser.initialState,
    );
    yield* syncParser.suggest({ ...context, state: innerState }, prefix);
  }

  // Async suggest helper
  async function* suggestAsync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): AsyncGenerator<Suggestion> {
    const innerState = normalizeOptionalLikeInnerState(
      context.state,
      syncParser.initialState,
    );
    const suggestions = parser.suggest(
      { ...context, state: innerState },
      prefix,
    ) as AsyncIterable<Suggestion>;
    for await (const s of suggestions) {
      yield s;
    }
  }

  // Type cast needed due to TypeScript's conditional type limitations with generic M
  const optionalParser = {
    $mode: parser.$mode,
    $valueType: [],
    $stateType: [],
    placeholder: undefined as TValue | undefined,
    priority: parser.priority,
    usage: [{ type: "optional", terms: parser.usage }],
    leadingNames: parser.leadingNames,
    // optional/withDefault can succeed without consuming, so the inner
    // parser's catch-all status does not apply to the wrapper.
    acceptingAnyToken: false,
    initialState: undefined,
    // Forward completion deferral hook from inner parser, adapting the
    // outer state shape ([TState] | undefined) to the inner TState.
    ...(typeof parser.shouldDeferCompletion === "function"
      ? {
        shouldDeferCompletion: adaptShouldDeferCompletion<TState>(
          parser.shouldDeferCompletion.bind(parser),
        ),
      }
      : {}),
    getSuggestRuntimeNodes(
      state: [TState] | undefined,
      path: readonly PropertyKey[],
    ) {
      if (optionalParser.dependencyMetadata?.source != null) {
        return [{ path, parser: optionalParser, state }];
      }
      const innerState = normalizeOptionalLikeInnerState(
        state,
        parser.initialState,
      );
      return parser.getSuggestRuntimeNodes?.(innerState, path) ??
        (parser.dependencyMetadata?.source != null
          ? [{ path, parser, state: innerState }]
          : []);
    },
    parse(context: ParserContext<[TState] | undefined>) {
      return dispatchByMode(
        parser.$mode,
        () => parseOptionalStyleSync(context, syncParser),
        () => parseOptionalStyleAsync(context, parser),
      );
    },
    complete(state: [TState] | undefined, exec?: ExecutionContext) {
      if (!Array.isArray(state)) {
        if (
          typeof parser.shouldDeferCompletion === "function" &&
          state != null &&
          typeof state === "object"
        ) {
          const innerComplete = (): ModeValue<
            M,
            ValueParserResult<TValue | undefined>
          > => {
            const innerResult = dispatchByMode(
              parser.$mode,
              () => syncParser.complete(state as unknown as TState, exec),
              () =>
                parser.complete(state as unknown as TState, exec) as Promise<
                  ValueParserResult<TValue | undefined>
                >,
            );
            return mapModeValue(
              parser.$mode,
              innerResult,
              (result) =>
                result.success
                  ? result
                  : { success: true, value: undefined } as ValueParserResult<
                    TValue | undefined
                  >,
            );
          };
          return innerComplete();
        }
        // When the inner parser preserves an omitted-source default via
        // dependency metadata (e.g. optional(withDefault(source))), delegate
        // to it so the user-visible value matches the dependency runtime.
        const sourceMetadata = parser.dependencyMetadata?.source;
        if (
          sourceMetadata?.preservesSourceValue !== false &&
          sourceMetadata?.getMissingSourceValue != null
        ) {
          const delegatedState = state != null && typeof state === "object"
            ? state as TState
            : undefined as TState;
          return dispatchByMode(
            parser.$mode,
            () => syncParser.complete(delegatedState, exec),
            () =>
              parser.complete(
                delegatedState,
                exec,
              ) as Promise<ValueParserResult<TValue | undefined>>,
          );
        }
        return { success: true, value: undefined };
      }
      // Propagate annotations from the outer array state into the inner
      // element so that source-binding wrappers like bindConfig can read
      // them during phase-two resolution.  Only propagate when the inner
      // element is an object; primitive states cannot carry annotations
      // without changing their shape, which would break inner parsers.
      const innerElement = normalizeOptionalLikeInnerState(
        state,
        parser.initialState,
      );
      return dispatchByMode(
        parser.$mode,
        () => syncParser.complete(innerElement as TState, exec),
        // Cast needed: parser.complete() returns ModeValue<M, ...> but we know M is "async" here
        () =>
          parser.complete(innerElement as TState, exec) as Promise<
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
  // Forward value normalization as non-enumerable so that ...parser spread
  // in map() does not propagate it to the mapped type.
  if (typeof parser.normalizeValue === "function") {
    const innerNormalize = parser.normalizeValue.bind(parser);
    Object.defineProperty(optionalParser, "normalizeValue", {
      value(v: TValue | undefined): TValue | undefined {
        if (v == null) return v;
        return innerNormalize(v);
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Compose dependency metadata for the optional wrapper.
  if (parser.dependencyMetadata != null) {
    const composed = composeDependencyMetadata(
      parser.dependencyMetadata,
      "optional",
    );
    if (composed != null) {
      (optionalParser as unknown as Record<string, unknown>)
        .dependencyMetadata = composed;
    }
  }
  return optionalParser;
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
  const getDocDefaultValue = (
    upperDefaultValue?: TValue | TDefault,
  ): TValue | undefined => {
    if (upperDefaultValue != null) {
      return upperDefaultValue as TValue;
    }
    if (options?.message) {
      return undefined;
    }
    if (typeof defaultValue !== "function") {
      return defaultValue as unknown as TValue;
    }
    try {
      return (defaultValue as () => TDefault)() as unknown as TValue;
    } catch {
      return undefined;
    }
  };

  // Sync suggest helper
  function* suggestSync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): Generator<Suggestion> {
    const innerState = normalizeOptionalLikeInnerState(
      context.state,
      syncParser.initialState,
    );
    yield* syncParser.suggest({ ...context, state: innerState }, prefix);
  }

  // Async suggest helper
  async function* suggestAsync(
    context: ParserContext<[TState] | undefined>,
    prefix: string,
  ): AsyncGenerator<Suggestion> {
    const innerState = normalizeOptionalLikeInnerState(
      context.state,
      syncParser.initialState,
    );
    const suggestions = parser.suggest(
      { ...context, state: innerState },
      prefix,
    ) as AsyncIterable<Suggestion>;
    for await (const s of suggestions) {
      yield s;
    }
  }

  // Type cast needed due to TypeScript's conditional type limitations with generic M
  const withDefaultParser = {
    $mode: parser.$mode,
    $valueType: [],
    $stateType: [],
    priority: parser.priority,
    usage: [{ type: "optional", terms: parser.usage }],
    leadingNames: parser.leadingNames,
    // optional/withDefault can succeed without consuming, so the inner
    // parser's catch-all status does not apply to the wrapper.
    acceptingAnyToken: false,
    initialState: undefined,
    // Forward completion deferral hook from inner parser, adapting the
    // outer state shape ([TState] | undefined) to the inner TState.
    ...(typeof parser.shouldDeferCompletion === "function"
      ? {
        shouldDeferCompletion: adaptShouldDeferCompletion<TState>(
          parser.shouldDeferCompletion.bind(parser),
        ),
      }
      : {}),
    getSuggestRuntimeNodes(
      state: [TState] | undefined,
      path: readonly PropertyKey[],
    ) {
      if (withDefaultParser.dependencyMetadata?.source != null) {
        return [{ path, parser: withDefaultParser, state }];
      }
      const innerState = normalizeOptionalLikeInnerState(
        state,
        parser.initialState,
      );
      return parser.getSuggestRuntimeNodes?.(innerState, path) ??
        (parser.dependencyMetadata?.source != null
          ? [{ path, parser, state: innerState }]
          : []);
    },
    parse(context: ParserContext<[TState] | undefined>) {
      return dispatchByMode(
        parser.$mode,
        () => parseOptionalStyleSync(context, syncParser),
        () => parseOptionalStyleAsync(context, parser),
      );
    },
    complete(state: [TState] | undefined, exec?: ExecutionContext) {
      // Evaluate the default value (immediate or lazy) and normalize it
      // through the inner parser's value normalizer when available.
      function evaluateDefault(): TDefault {
        const raw = typeof defaultValue === "function"
          ? (defaultValue as () => TDefault)()
          : defaultValue;
        if (typeof parser.normalizeValue === "function") {
          try {
            return parser.normalizeValue(
              raw as unknown as TValue,
            ) as unknown as TDefault;
          } catch {
            // Normalization is best-effort; sentinel defaults whose type
            // differs from TValue (e.g., union defaults like { kind: "local" })
            // are returned as-is.
          }
        }
        return raw;
      }

      if (!Array.isArray(state)) {
        // Case: Inner parser has completion deferral hook (e.g.,
        // withDefault(bindConfig(...), val)). Delegate to inner parser so
        // it can resolve from config during phase-two completion.
        if (
          typeof parser.shouldDeferCompletion === "function" &&
          state != null &&
          typeof state === "object"
        ) {
          const innerResult = dispatchByMode(
            parser.$mode,
            () => syncParser.complete(state as unknown as TState, exec),
            () =>
              parser.complete(state as unknown as TState, exec) as Promise<
                ValueParserResult<TValue>
              >,
          );
          // Propagate the inner result as-is.  When wrapping
          // bindConfig(), success means config resolved; failure means
          // config is absent.  In both cases, prompt() needs to see the
          // raw result so it can defer in phase 1 and prompt in phase 2
          // instead of having the default value suppress the prompt.
          return innerResult as ModeValue<
            M,
            ValueParserResult<TValue | TDefault>
          >;
        }
        try {
          const value = evaluateDefault();
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
      // Propagate annotations from the outer array state into the inner
      // element so that source-binding wrappers like bindConfig can read
      // them during phase-two resolution.  Only propagate when the inner
      // element is an object; primitive states cannot carry annotations
      // without changing their shape, which would break inner parsers.
      const innerElement = normalizeOptionalLikeInnerState(
        state,
        parser.initialState,
      );
      return dispatchByMode(
        parser.$mode,
        () => syncParser.complete(innerElement as TState, exec),
        // Cast needed: parser.complete() returns ModeValue<M, ...> but we know M is "async" here
        () =>
          parser.complete(innerElement as TState, exec) as Promise<
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

      let docDefault: TValue | undefined = getDocDefaultValue(
        upperDefaultValue,
      );
      // Normalize the default for documentation so that help text matches
      // the representation that parse() would produce.
      if (
        docDefault != null && typeof parser.normalizeValue === "function"
      ) {
        try {
          docDefault = parser.normalizeValue(docDefault);
        } catch {
          // best-effort; sentinel defaults are shown as-is
        }
      }
      const fragments = syncParser.getDocFragments(
        innerState,
        docDefault,
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
  // Lazily forward placeholder from inner parser to avoid eagerly
  // evaluating derived value parser factories at construction time.
  if ("placeholder" in parser) {
    Object.defineProperty(withDefaultParser, "placeholder", {
      get() {
        return parser.placeholder;
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Forward value normalization as non-enumerable.  Guard with try/catch
  // because TDefault may be a sentinel type incompatible with the inner
  // parser's normalizer.
  if (typeof parser.normalizeValue === "function") {
    const innerNormalize = parser.normalizeValue.bind(parser);
    Object.defineProperty(withDefaultParser, "normalizeValue", {
      value(v: TValue | TDefault): TValue | TDefault {
        try {
          return innerNormalize(v as TValue) as TValue | TDefault;
        } catch {
          return v;
        }
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Compose dependency metadata: add getMissingSourceValue if the inner
  // parser preserves a dependency source.
  if (parser.dependencyMetadata != null) {
    const composed = composeDependencyMetadata(
      parser.dependencyMetadata,
      "withDefault",
      {
        defaultValue: () => {
          let v: TDefault;
          try {
            v = typeof defaultValue === "function"
              ? (defaultValue as () => TDefault)()
              : defaultValue;
          } catch (e) {
            // Dynamic default thunks may throw (validation, env checks).
            // Preserve the structured errorMessage from WithDefaultError,
            // matching withDefault.complete() which surfaces it directly.
            const error = e instanceof WithDefaultError
              ? e.errorMessage
              : message`${e instanceof Error ? e.message : String(e)}`;
            return { success: false as const, error };
          }
          // Normalize the default value to match what the inner parser's
          // value parser would produce, so that dependency source values
          // are consistent regardless of whether they came from explicit
          // input or a default.
          if (typeof parser.normalizeValue === "function") {
            try {
              v = parser.normalizeValue(v as unknown as TValue) as
                & TValue
                & TDefault;
            } catch {
              // Normalization may fail for sentinel types; keep raw value.
            }
          }
          return { success: true as const, value: v };
        },
      },
    );
    if (composed != null) {
      (withDefaultParser as unknown as Record<string, unknown>)
        .dependencyMetadata = composed;
    }
  }
  return withDefaultParser;
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
 * @throws Any exception thrown by `transform` when completing a non-deferred
 *   value.  Errors from deferred placeholder transforms are caught and the
 *   mapped result falls back to `undefined` with `deferred: true`.
 *
 * ### Deferred prompt interaction
 *
 * During two-phase parsing, `map()` propagates the `deferred` flag from
 * inner results but intentionally drops per-field `deferredKeys`.  The
 * inner key set describes the *input* shape, but `transform` produces an
 * arbitrary *output* shape where keys may be renamed, dropped, or reused
 * with different semantics.  For `object()` results that are *not*
 * wrapped in `map()`, per-field deferred stripping works normally.
 *
 * Because the `deferred` flag is propagated conservatively, mapped scalar
 * results are treated as missing (`undefined`) during phase-two context
 * collection — even when `transform` only used non-deferred fields.
 * For example, `map(object({ apiKey: prompt(...), mode: option(...) }),
 * v => v.mode)` makes phase-two contexts see `undefined` instead of the
 * real `mode` value.  This is the intentional trade-off: the alternative
 * (not propagating `deferred`) would leak placeholder values into context
 * resolution when `transform` *does* use deferred fields.  The final
 * parse always produces the correct result regardless.
 *
 * If the transform throws on a deferred placeholder value, the mapped
 * result falls back to `undefined` with `deferred: true`, so the first
 * pass does not abort.
 *
 * ### Transform purity
 *
 * The `transform` function must not mutate its input.  Object and array
 * values may be shared placeholder references during deferred prompt
 * resolution, and in-place mutations would corrupt the placeholder for
 * subsequent parses.  Always return a new value:
 *
 * ```typescript
 * // ✅ Correct — creates a new object
 * map(parser, v => ({ ...v, host: "override" }))
 *
 * // ❌ Wrong — mutates the input in place
 * map(parser, v => { v.host = "override"; return v; })
 * ```
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
  const complete = (
    state: TState,
    exec?: ExecutionContext,
  ): ModeValue<M, ValueParserResult<U>> => {
    return mapModeValue(
      parser.$mode,
      parser.complete(state, exec),
      (result) => {
        if (!result.success) return result;
        if (result.deferred) {
          // The value is a phase-1 placeholder that may not satisfy the
          // inner parser's normal guarantees (e.g., port() placeholder 0
          // fed into a positivity check).  Try the transform; if it
          // throws, fall back to undefined so the deferred flag still
          // propagates and phase-2 contexts treat the value as missing.
          try {
            return {
              success: true,
              value: transform(result.value),
              deferred: true as const,
              // deferredKeys is intentionally NOT propagated through
              // map().  The inner object()'s key set describes the INPUT
              // shape, but the transform produces an arbitrary OUTPUT
              // shape where keys may be renamed, dropped, or reused
              // with different semantics.  Forwarding stale keys would
              // cause prepareParsedForContexts() to strip the wrong
              // fields.  Instead, the deferred flag alone signals that
              // the mapped value may contain placeholder data, and the
              // facade falls back to passing the value through as-is.
            };
          } catch {
            return {
              success: true,
              value: undefined as unknown as U,
              deferred: true as const,
            };
          }
        }
        return { success: true, value: transform(result.value) };
      },
    );
  };

  const mappedParser = {
    ...parser,
    $valueType: [] as readonly U[],
    complete,
    getSuggestRuntimeNodes(state: TState, path: readonly PropertyKey[]) {
      if (mappedParser.dependencyMetadata?.source != null) {
        return [{ path, parser: mappedParser, state }];
      }
      return parser.getSuggestRuntimeNodes?.(state, path) ??
        (parser.dependencyMetadata?.source != null
          ? [{ path, parser, state }]
          : []);
    },
    getDocFragments(state: DocState<TState>, _defaultValue?: U) {
      // Since we can't reverse the transformation, we delegate to the original
      // parser with undefined default value. This is acceptable since
      // documentation typically shows the input format, not the transformed output.
      return parser.getDocFragments(state, undefined);
    },
  } as Parser<M, U, TState>;
  // Strip any normalizeValue inherited from the inner parser via ...parser
  // spread.  The inner normalizer operates on type T, not the mapped type U,
  // so keeping it would corrupt mapped defaults.
  delete mappedParser.normalizeValue;
  // Lazily compute the mapped placeholder.  Non-enumerable so that
  // further ...parser spreads in downstream wrappers do not eagerly
  // evaluate the getter and trigger inner factory side effects.
  if ("placeholder" in parser) {
    Object.defineProperty(mappedParser, "placeholder", {
      get() {
        try {
          return transform(parser.placeholder as T);
        } catch {
          return undefined;
        }
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Compose dependency metadata: mark transform and clear
  // preservesSourceValue.  Wrap replayParse to apply the map transform
  // so that replayed values match what complete() would produce.
  if (parser.dependencyMetadata != null) {
    let composed = composeDependencyMetadata(
      parser.dependencyMetadata,
      "map",
    );
    if (composed?.derived != null) {
      const innerReplay = composed.derived.replayParse;
      // Mirror map().complete() deferred handling: strip deferredKeys
      // (the inner shape is invalidated by the transform) and catch
      // transform errors for deferred placeholders.
      const applyMappedReplay = (
        r: ValueParserResult<unknown>,
      ): ValueParserResult<unknown> => {
        if (!r.success) return r;
        if (r.deferred) {
          try {
            return {
              success: true as const,
              value: transform(r.value as T),
              deferred: true as const,
            };
          } catch {
            return {
              success: true as const,
              value: undefined as unknown as U,
              deferred: true as const,
            };
          }
        }
        return { success: true as const, value: transform(r.value as T) };
      };
      composed = {
        ...composed,
        derived: {
          ...composed.derived,
          replayParse: (
            rawInput: string,
            depValues: readonly unknown[],
          ) => {
            const result = innerReplay(rawInput, depValues);
            return isPromiseLike(result)
              ? result.then(applyMappedReplay)
              : applyMappedReplay(result);
          },
        },
      };
    }
    if (composed != null) {
      (mappedParser as unknown as Record<string, unknown>).dependencyMetadata =
        composed;
    }
  }
  return mappedParser;
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

  const unwrapInjectedWrapper = unwrapInjectedAnnotationWrapper;
  const completeSyncWithUnwrappedFallback = (
    state: TState,
    exec?: ExecutionContext,
  ): ReturnType<typeof syncParser.complete> => {
    try {
      const result = syncParser.complete(state, exec);
      if (!result.success && isInjectedAnnotationWrapper(state)) {
        return syncParser.complete(unwrapInjectedWrapper(state), exec);
      }
      return result;
    } catch (error) {
      if (!isInjectedAnnotationWrapper(state)) {
        throw error;
      }
      return syncParser.complete(unwrapInjectedWrapper(state), exec);
    }
  };
  const parseSyncWithUnwrappedFallback = (
    context: ParserContext<TState>,
  ): ReturnType<typeof syncParser.parse> => {
    try {
      const result = syncParser.parse(context);
      if (
        result.success ||
        result.consumed !== 0 ||
        !isInjectedAnnotationWrapper(context.state)
      ) {
        return result;
      }
      return syncParser.parse({
        ...context,
        state: unwrapInjectedWrapper(context.state),
      });
    } catch (error) {
      if (!isInjectedAnnotationWrapper(context.state)) {
        throw error;
      }
      return syncParser.parse({
        ...context,
        state: unwrapInjectedWrapper(context.state),
      });
    }
  };
  const completeAsyncWithUnwrappedFallback = async (
    state: TState,
    exec?: ExecutionContext,
  ): Promise<Awaited<ReturnType<typeof parser.complete>>> => {
    try {
      const result = await parser.complete(state, exec);
      if (!result.success && isInjectedAnnotationWrapper(state)) {
        return await parser.complete(unwrapInjectedWrapper(state), exec);
      }
      return result;
    } catch (error) {
      if (!isInjectedAnnotationWrapper(state)) {
        throw error;
      }
      return await parser.complete(unwrapInjectedWrapper(state), exec);
    }
  };
  const parseAsyncWithUnwrappedFallback = async (
    context: ParserContext<TState>,
  ): Promise<Awaited<ReturnType<typeof parser.parse>>> => {
    try {
      const result = await parser.parse(context);
      if (
        result.success ||
        result.consumed !== 0 ||
        !isInjectedAnnotationWrapper(context.state)
      ) {
        return result;
      }
      return await parser.parse({
        ...context,
        state: unwrapInjectedWrapper(context.state),
      });
    } catch (error) {
      if (!isInjectedAnnotationWrapper(context.state)) {
        throw error;
      }
      return await parser.parse({
        ...context,
        state: unwrapInjectedWrapper(context.state),
      });
    }
  };
  const getInnerSuggestRuntimeNodes = (
    state: TState,
    path: readonly PropertyKey[],
  ) =>
    parser.getSuggestRuntimeNodes?.(state, path) ??
      (parser.dependencyMetadata?.source != null
        ? [{ path, parser, state }]
        : []);

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<MultipleState>,
  ): ParseResult => {
    const currentItemState = context.state.at(-1);
    const canExtendCurrent = currentItemState != null &&
      !isTerminalMultipleItemState(currentItemState);
    let added = !canExtendCurrent;
    let itemIndex = canExtendCurrent
      ? context.state.length - 1
      : context.state.length;
    const currentItemStateWithAnnotations = canExtendCurrent
      ? currentItemState
      : inheritAnnotations(context.state, syncParser.initialState);
    let result = parseSyncWithUnwrappedFallback(
      withChildContext(
        context,
        itemIndex,
        currentItemStateWithAnnotations as TState,
      ),
    );
    if (!result.success) {
      if (!added && result.consumed === 0) {
        const nextInitialState = inheritAnnotations(
          context.state,
          syncParser.initialState,
        );
        itemIndex = context.state.length;
        result = parseSyncWithUnwrappedFallback(
          withChildContext(context, itemIndex, nextInitialState),
        );
        if (!result.success) return result;
        added = true;
      } else {
        return result;
      }
    }
    const mergedExec = mergeChildExec(context.exec, result.next.exec);
    if (
      added &&
      result.consumed.length === 0 &&
      result.next.optionsTerminated === context.optionsTerminated &&
      isUnstartedMultipleItemState(
        result.next.state,
        currentItemStateWithAnnotations,
      )
    ) {
      return {
        success: true,
        next: {
          ...result.next,
          state: context.state,
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        },
        consumed: result.consumed,
      };
    }
    const itemAnnotationSource = added
      ? context.state
      : currentItemStateWithAnnotations;
    if (
      result.next.state === currentItemStateWithAnnotations &&
      result.consumed.length > 0 &&
      (
        !added ||
        result.next.optionsTerminated !== context.optionsTerminated
      )
    ) {
      return {
        success: true,
        next: {
          ...result.next,
          state: context.state,
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        },
        consumed: result.consumed,
      };
    }
    const nextItemState = inheritAnnotations(
      itemAnnotationSource,
      result.next.state,
    );
    return {
      success: true,
      next: {
        ...result.next,
        state: annotateFreshArray(context.state, [
          ...(added ? context.state : context.state.slice(0, -1)),
          nextItemState,
        ]),
        ...(mergedExec != null
          ? {
            exec: mergedExec,
            dependencyRegistry: mergedExec.dependencyRegistry,
          }
          : {}),
      },
      consumed: result.consumed,
    };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<MultipleState>,
  ): Promise<ParseResult> => {
    const currentItemState = context.state.at(-1);
    const canExtendCurrent = currentItemState != null &&
      !isTerminalMultipleItemState(currentItemState);
    let added = !canExtendCurrent;
    let itemIndex = canExtendCurrent
      ? context.state.length - 1
      : context.state.length;
    const currentItemStateWithAnnotations = canExtendCurrent
      ? currentItemState
      : inheritAnnotations(context.state, parser.initialState);
    let result = await parseAsyncWithUnwrappedFallback(
      withChildContext(
        context,
        itemIndex,
        currentItemStateWithAnnotations as TState,
      ),
    );
    if (!result.success) {
      if (!added && result.consumed === 0) {
        const nextInitialState = inheritAnnotations(
          context.state,
          parser.initialState,
        );
        itemIndex = context.state.length;
        result = await parseAsyncWithUnwrappedFallback(
          withChildContext(context, itemIndex, nextInitialState),
        );
        if (!result.success) return result;
        added = true;
      } else {
        return result;
      }
    }
    const mergedExec = mergeChildExec(context.exec, result.next.exec);
    if (
      added &&
      result.consumed.length === 0 &&
      result.next.optionsTerminated === context.optionsTerminated &&
      isUnstartedMultipleItemState(
        result.next.state,
        currentItemStateWithAnnotations,
      )
    ) {
      return {
        success: true,
        next: {
          ...result.next,
          state: context.state,
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        },
        consumed: result.consumed,
      };
    }
    const itemAnnotationSource = added
      ? context.state
      : currentItemStateWithAnnotations;
    if (
      result.next.state === currentItemStateWithAnnotations &&
      result.consumed.length > 0 &&
      (
        !added ||
        result.next.optionsTerminated !== context.optionsTerminated
      )
    ) {
      return {
        success: true,
        next: {
          ...result.next,
          state: context.state,
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        },
        consumed: result.consumed,
      };
    }
    const nextItemState = inheritAnnotations(
      itemAnnotationSource,
      result.next.state,
    );
    return {
      success: true,
      next: {
        ...result.next,
        state: annotateFreshArray(context.state, [
          ...(added ? context.state : context.state.slice(0, -1)),
          nextItemState,
        ]),
        ...(mergedExec != null
          ? {
            exec: mergedExec,
            dependencyRegistry: mergedExec.dependencyRegistry,
          }
          : {}),
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
    leadingNames: parser.leadingNames,
    // multiple(min=0) can succeed without consuming, so only propagate
    // catch-all status when at least one match is required.
    acceptingAnyToken: min > 0 && (parser.acceptingAnyToken ?? false),
    initialState: [] as readonly TState[],
    getSuggestRuntimeNodes(state: MultipleState, path: readonly PropertyKey[]) {
      const nodes: RuntimeNode[] =
        resultParser.dependencyMetadata?.source != null
          ? [{ path, parser: resultParser, state }]
          : [];
      for (let i = 0; i < state.length; i++) {
        nodes.push(...getInnerSuggestRuntimeNodes(state[i] as TState, [
          ...path,
          i,
        ]));
      }
      return nodes;
    },
    parse(context: ParserContext<MultipleState>) {
      return dispatchByMode(
        parser.$mode,
        () => parseSync(context),
        () => parseAsync(context),
      );
    },
    complete(state: MultipleState, exec?: ExecutionContext) {
      return dispatchByMode(
        parser.$mode,
        () => {
          // Sync complete
          const result: TValue[] = [];
          const deferredIndices = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          for (let i = 0; i < state.length; i++) {
            const valueResult = completeSyncWithUnwrappedFallback(
              state[i] as TState,
              withChildExecPath(exec, i),
            );
            if (valueResult.success) {
              const unwrappedValue = unwrapInjectedWrapper(valueResult.value);
              result.push(unwrappedValue);
              if (valueResult.deferred) {
                if (valueResult.deferredKeys) {
                  deferredIndices.set(i, valueResult.deferredKeys);
                } else if (
                  unwrappedValue == null ||
                  typeof unwrappedValue !== "object"
                ) {
                  deferredIndices.set(i, null);
                } else {
                  // Structured deferred without deferredKeys (e.g., from
                  // map()): preserve coarse deferred signal.
                  hasDeferred = true;
                }
              }
            } else {
              return { success: false as const, error: valueResult.error };
            }
          }
          return validateMultipleResult(result, deferredIndices, hasDeferred);
        },
        async () => {
          // Async complete - use Promise.all for parallel execution
          const results = await Promise.all(
            state.map((s, i) =>
              completeAsyncWithUnwrappedFallback(
                s,
                withChildExecPath(exec, i),
              )
            ),
          );
          const values: TValue[] = [];
          const deferredIndices = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          for (let i = 0; i < results.length; i++) {
            const valueResult = results[i];
            if (valueResult.success) {
              const unwrappedValue = unwrapInjectedWrapper(valueResult.value);
              values.push(unwrappedValue);
              if (valueResult.deferred) {
                if (valueResult.deferredKeys) {
                  deferredIndices.set(i, valueResult.deferredKeys);
                } else if (
                  unwrappedValue == null ||
                  typeof unwrappedValue !== "object"
                ) {
                  deferredIndices.set(i, null);
                } else {
                  hasDeferred = true;
                }
              }
            } else {
              return { success: false as const, error: valueResult.error };
            }
          }
          return validateMultipleResult(values, deferredIndices, hasDeferred);
        },
      );
    },
    suggest(context: ParserContext<MultipleState>, prefix: string) {
      // Extract already-selected values from completed states to exclude them
      // from suggestions (fixes https://github.com/dahlia/optique/issues/73)
      const currentItemState = context.state.at(-1);
      const canExtendCurrent = currentItemState != null &&
        !isTerminalMultipleItemState(currentItemState);
      const canOpenNew = context.state.length < max;
      if (!canExtendCurrent && !canOpenNew) {
        return dispatchIterableByMode(
          parser.$mode,
          function* () {},
          async function* () {},
        );
      }
      const itemIndex = canExtendCurrent
        ? context.state.length - 1
        : context.state.length;
      const suggestInitialState = canExtendCurrent
        ? currentItemState
        : inheritAnnotations(
          context.state,
          parser.initialState,
        );
      const suggestFallbackState = unwrapInjectedWrapper(
        suggestInitialState,
      ) as TState;
      const hasSuggestFallbackState = suggestFallbackState !==
        suggestInitialState;
      const collectSelectedValuesSync = () => {
        const selectedValues = new Set<string>();
        for (let i = 0; i < context.state.length; i++) {
          const childContext = withChildContext(
            context,
            i,
            context.state[i] as TState,
          );
          const completed = completeSyncWithUnwrappedFallback(
            childContext.state,
            childContext.exec,
          );
          if (completed.success) {
            selectedValues.add(String(unwrapInjectedWrapper(completed.value)));
          }
        }
        return selectedValues;
      };
      const collectSelectedValuesAsync = async () => {
        const selectedValues = new Set<string>();
        const results = await Promise.all(
          context.state.map(async (state, i) => {
            const childContext = withChildContext(context, i, state as TState);
            return await completeAsyncWithUnwrappedFallback(
              childContext.state,
              childContext.exec,
            );
          }),
        );
        for (const completed of results) {
          if (completed.success) {
            selectedValues.add(String(unwrapInjectedWrapper(completed.value)));
          }
        }
        return selectedValues;
      };

      // Helper to filter suggestions
      const shouldInclude = (
        selectedValues: ReadonlySet<string>,
        suggestion: Suggestion,
      ) => {
        if (suggestion.kind === "literal") {
          return !selectedValues.has(suggestion.text);
        }
        return true;
      };
      const suggestionKey = (suggestion: Suggestion): string => {
        const description = suggestion.description == null
          ? ""
          : formatMessage(suggestion.description);
        if (suggestion.kind === "literal") {
          return JSON.stringify(["literal", suggestion.text, description]);
        }
        return JSON.stringify([
          "file",
          suggestion.type,
          suggestion.pattern ?? "",
          suggestion.includeHidden === true,
          suggestion.extensions == null
            ? ""
            : suggestion.extensions.toSorted().join("\0"),
          description,
        ]);
      };

      return dispatchIterableByMode(
        parser.$mode,
        function* () {
          const selectedValues = collectSelectedValuesSync();
          const emitted = new Set<string>();
          const yieldUnique = function* (suggestions: Iterable<Suggestion>) {
            for (const s of suggestions) {
              const key = suggestionKey(s);
              if (shouldInclude(selectedValues, s) && !emitted.has(key)) {
                emitted.add(key);
                yield s;
              }
            }
          };
          let shouldTryFallback = false;
          try {
            yield* yieldUnique(
              syncParser.suggest(
                withChildContext(
                  context,
                  itemIndex,
                  suggestInitialState as TState,
                ),
                prefix,
              ),
            );
          } catch (error) {
            if (!hasSuggestFallbackState) throw error;
            shouldTryFallback = true;
          }
          if (shouldTryFallback) {
            yield* yieldUnique(
              syncParser.suggest(
                withChildContext(
                  context,
                  itemIndex,
                  suggestFallbackState,
                ),
                prefix,
              ),
            );
          }
        },
        async function* () {
          const selectedValues = await collectSelectedValuesAsync();
          const emitted = new Set<string>();
          const yieldUnique = async function* (
            suggestions: AsyncIterable<Suggestion>,
          ) {
            for await (const s of suggestions) {
              const key = suggestionKey(s);
              if (shouldInclude(selectedValues, s) && !emitted.has(key)) {
                emitted.add(key);
                yield s;
              }
            }
          };
          let shouldTryFallback = false;
          try {
            yield* yieldUnique(
              parser.suggest(
                withChildContext(
                  context,
                  itemIndex,
                  suggestInitialState,
                ),
                prefix,
              ) as AsyncIterable<Suggestion>,
            );
          } catch (error) {
            if (!hasSuggestFallbackState) throw error;
            shouldTryFallback = true;
          }
          if (shouldTryFallback) {
            yield* yieldUnique(
              parser.suggest(
                withChildContext(
                  context,
                  itemIndex,
                  suggestFallbackState,
                ),
                prefix,
              ) as AsyncIterable<Suggestion>,
            );
          }
        },
      );
    },
    getDocFragments(
      state: DocState<MultipleState>,
      defaultValue?: readonly TValue[],
    ) {
      const latestState = state.kind === "available" && state.state.length > 0
        ? state.state.at(-1)!
        : undefined;
      const latestInnerState = latestState != null &&
          isInjectedAnnotationWrapper(latestState)
        ? unwrapInjectedWrapper(latestState)
        : latestState;
      const innerState: DocState<TState> = state.kind === "unavailable"
        ? { kind: "unavailable" }
        : latestInnerState !== undefined
        ? { kind: "available", state: latestInnerState as TState }
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
  function validateMultipleResult(
    result: TValue[],
    deferredIndices: Map<PropertyKey, DeferredMap | null>,
    hasDeferred = false,
  ) {
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
    const isDeferred = deferredIndices.size > 0 || hasDeferred;
    return {
      success: true as const,
      value: result,
      ...(isDeferred
        ? {
          deferred: true as const,
          ...(deferredIndices.size > 0
            ? { deferredKeys: deferredIndices as DeferredMap }
            : {}),
        }
        : {}),
    };
  }

  // Placeholder contains min copies of the inner parser's placeholder so
  // that map() transforms over multiple() results see an array that
  // satisfies the declared minimum arity.
  Object.defineProperty(resultParser, "placeholder", {
    get() {
      try {
        if (min > 0 && "placeholder" in parser) {
          return Array.from(
            { length: min },
            () => parser.placeholder,
          ) as readonly TValue[];
        }
      } catch { /* inner placeholder may throw */ }
      return [] as readonly TValue[];
    },
    configurable: true,
    enumerable: false,
  });
  // Forward value normalization, mapping the inner normalizer over each
  // array element.  Non-enumerable so map()'s spread does not propagate it.
  if (typeof parser.normalizeValue === "function") {
    const innerNormalize = parser.normalizeValue.bind(parser);
    Object.defineProperty(resultParser, "normalizeValue", {
      value(values: readonly TValue[]): readonly TValue[] {
        if (!Array.isArray(values)) return values;
        let changed = false;
        const result = values.map((v) => {
          try {
            const n = innerNormalize(v);
            if (n !== v) changed = true;
            return n;
          } catch {
            return v;
          }
        });
        return changed ? result : values;
      },
      configurable: true,
      enumerable: false,
    });
  }
  if (parser.dependencyMetadata?.source != null) {
    const innerSource = parser.dependencyMetadata.source;
    Object.defineProperty(resultParser, "dependencyMetadata", {
      value: {
        ...parser.dependencyMetadata,
        source: {
          ...innerSource,
          preservesSourceValue: false,
          extractSourceValue: (
            state: unknown,
          ):
            | ValueParserResult<unknown>
            | Promise<ValueParserResult<unknown> | undefined>
            | undefined => {
            if (!Array.isArray(state)) {
              return innerSource.extractSourceValue(state);
            }
            const scan = (
              index: number,
            ):
              | ValueParserResult<unknown>
              | Promise<ValueParserResult<unknown> | undefined>
              | undefined => {
              for (let i = index; i >= 0; i--) {
                const result = innerSource.extractSourceValue(state[i]);
                if (result == null) continue;
                if (
                  isPromiseLike<ValueParserResult<unknown> | undefined>(
                    result,
                  )
                ) {
                  return Promise.resolve(result).then(
                    (resolved) => resolved ?? scan(i - 1),
                  );
                }
                return result;
              }
              return undefined;
            };
            return scan(state.length - 1);
          },
        },
      },
      configurable: true,
      enumerable: false,
    });
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

  const nonEmptyParser: Parser<M, T, TState> = {
    $mode: parser.$mode,
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    usage: parser.usage,
    leadingNames: parser.leadingNames,
    acceptingAnyToken: parser.acceptingAnyToken,
    initialState: parser.initialState,
    // Forward shouldDeferCompletion from inner parser so that prompt()
    // can defer through nonEmpty() wrappers.
    ...(typeof parser.shouldDeferCompletion === "function"
      ? { shouldDeferCompletion: parser.shouldDeferCompletion.bind(parser) }
      : {}),
    getSuggestRuntimeNodes(state: TState, path: readonly PropertyKey[]) {
      return parser.getSuggestRuntimeNodes?.(state, path) ??
        (parser.dependencyMetadata?.source != null
          ? [{ path, parser, state }]
          : []);
    },
    parse(context: ParserContext<TState>) {
      return dispatchByMode(
        parser.$mode,
        () => parseSync(context),
        () => parseAsync(context),
      );
    },
    complete(state: TState, exec?: ExecutionContext) {
      return parser.complete(state, exec);
    },
    suggest(context: ParserContext<TState>, prefix: string) {
      return parser.suggest(context, prefix);
    },
    getDocFragments(state: DocState<TState>, defaultValue?: T) {
      return syncParser.getDocFragments(state, defaultValue);
    },
  } as Parser<M, T, TState>;
  // Forward placeholder lazily from inner parser.
  if ("placeholder" in parser) {
    Object.defineProperty(nonEmptyParser, "placeholder", {
      get() {
        return parser.placeholder;
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Forward value normalization as non-enumerable.
  if (typeof parser.normalizeValue === "function") {
    Object.defineProperty(nonEmptyParser, "normalizeValue", {
      value: parser.normalizeValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  return nonEmptyParser;
}
