import {
  getDelegatedAnnotationState,
  hasDelegatedAnnotationCarrier,
  normalizeDelegatedAnnotationState,
  normalizeNestedDelegatedAnnotationState,
} from "./annotation-state.ts";
import { composeDependencyMetadata } from "./dependency-metadata.ts";
import { formatMessage, type Message, message, text } from "./message.ts";
import {
  annotateFreshArray,
  annotationKey,
  getAnnotations,
  inheritAnnotations,
  isInjectedAnnotationWrapper,
  unwrapInjectedAnnotationWrapper,
} from "./annotations.ts";
import {
  dispatchByMode,
  dispatchIterableByMode,
  mapModeValue,
  wrapForMode,
} from "./mode-dispatch.ts";
import {
  completeOrExtractPhase2Seed,
  extractPhase2Seed,
  extractPhase2SeedKey,
  phase2SeedFromValueResult,
} from "./phase2-seed.ts";
import {
  defineInheritedAnnotationParser,
  defineSourceBindingOnlyAnnotationCompletionParser,
  unmatchedNonCliDependencySourceStateMarker,
} from "./parser.ts";
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
    commandPath: child.commandPath ?? parent.commandPath,
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
  const unwrapped = unwrapMultipleItemState(state).value;
  return unwrapped != null && typeof unwrapped === "object" &&
    Object.hasOwn(unwrapped, "success") &&
    typeof (unwrapped as { success?: unknown }).success === "boolean";
}

function isUnstartedMultipleItemState(
  state: unknown,
  originalState?: unknown,
): boolean {
  const unwrappedState = unwrapMultipleItemState(state);
  if (unwrappedState.value == null) return true;

  if (originalState === undefined) return false;
  const unwrappedOriginalState = unwrapMultipleItemState(originalState);
  return unwrappedState.value === unwrappedOriginalState.value &&
    (
      unwrappedState.viaBoundCliWrapper ||
      unwrappedOriginalState.viaBoundCliWrapper ||
      (
        unwrappedOriginalState.value != null &&
        typeof unwrappedOriginalState.value === "object"
      )
    );
}

function isBoundCliWrapperState(
  state: unknown,
): state is {
  readonly hasCliValue: boolean;
  readonly cliState?: unknown;
} {
  return state != null &&
    typeof state === "object" &&
    Object.hasOwn(state, "hasCliValue") &&
    typeof (state as { readonly hasCliValue?: unknown }).hasCliValue ===
      "boolean" &&
    (
      Object.hasOwn(state, "cliState") ||
      (state as { readonly hasCliValue: boolean }).hasCliValue === false
    );
}

function unwrapMultipleItemState(
  state: unknown,
): {
  readonly value: unknown;
  readonly viaBoundCliWrapper: boolean;
} {
  let unwrapped = state;
  let viaBoundCliWrapper = false;
  while (true) {
    if (isInjectedAnnotationWrapper(unwrapped)) {
      unwrapped = unwrapInjectedAnnotationWrapper(unwrapped);
      continue;
    }
    if (Array.isArray(unwrapped) && unwrapped.length === 1) {
      unwrapped = unwrapped[0];
      continue;
    }
    if (isBoundCliWrapperState(unwrapped)) {
      viaBoundCliWrapper = true;
      unwrapped = unwrapped.cliState;
      continue;
    }
    return { value: unwrapped, viaBoundCliWrapper };
  }
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return value != null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (value as Record<string, unknown>).then === "function";
}

function normalizeOptionalLikeCompleteResult<T>(
  result: ValueParserResult<T>,
): ValueParserResult<T> {
  return result.success
    ? {
      ...result,
      value: normalizeNestedDelegatedAnnotationState(result.value),
    }
    : result;
}

function completeOptionalLikeSync<TValue, TState>(
  parser: Parser<"sync", TValue, TState>,
  state: TState,
  exec?: ExecutionContext,
): ValueParserResult<TValue> {
  const hasCarrier = hasDelegatedAnnotationCarrier(state);
  try {
    return normalizeOptionalLikeCompleteResult(parser.complete(state, exec));
  } catch (error) {
    if (!hasCarrier) {
      throw error;
    }
    const fallbackState = normalizeDelegatedAnnotationState(state);
    return normalizeOptionalLikeCompleteResult(
      parser.complete(fallbackState, exec),
    );
  }
}

async function completeOptionalLikeAsync<TValue, TState>(
  parser: Parser<Mode, TValue, TState>,
  state: TState,
  exec?: ExecutionContext,
): Promise<ValueParserResult<TValue>> {
  const hasCarrier = hasDelegatedAnnotationCarrier(state);
  try {
    return normalizeOptionalLikeCompleteResult(
      await parser.complete(state, exec),
    );
  } catch (error) {
    if (!hasCarrier) {
      throw error;
    }
    const fallbackState = normalizeDelegatedAnnotationState(state);
    return normalizeOptionalLikeCompleteResult(
      await parser.complete(fallbackState, exec),
    );
  }
}

function normalizeOptionalLikePhase2Seed<T>(
  seed: import("./phase2-seed.ts").Phase2Seed<T> | null,
): import("./phase2-seed.ts").Phase2Seed<T> | null {
  return seed == null ? null : {
    ...seed,
    value: normalizeNestedDelegatedAnnotationState(seed.value),
  };
}

function extractOptionalLikePhase2Seed<M extends Mode, TValue, TState>(
  parser: Parser<M, TValue, TState>,
  state: [TState] | TState | undefined,
  exec?: ExecutionContext,
): ModeValue<M, import("./phase2-seed.ts").Phase2Seed<TValue> | null> {
  if (
    !Array.isArray(state) &&
    !(state != null && typeof state === "object")
  ) {
    return wrapForMode(parser.$mode, null);
  }
  const innerState = normalizeOptionalLikeInnerState(
    state,
    parser.initialState,
    parser,
  );
  const hasCarrier = hasDelegatedAnnotationCarrier(innerState);
  return dispatchByMode(
    parser.$mode,
    () => {
      try {
        const result = (parser as Parser<"sync", TValue, TState>).complete(
          innerState,
          exec,
        );
        if (result.success) {
          return normalizeOptionalLikePhase2Seed(
            phase2SeedFromValueResult(result),
          );
        }
        const seed = extractPhase2Seed(
          parser as Parser<"sync", TValue, TState>,
          innerState,
          exec,
        );
        if (seed == null && hasCarrier) {
          const fallbackState = normalizeDelegatedAnnotationState(innerState);
          return normalizeOptionalLikePhase2Seed(
            extractPhase2Seed(
              parser as Parser<"sync", TValue, TState>,
              fallbackState,
              exec,
            ),
          );
        }
        return normalizeOptionalLikePhase2Seed(seed);
      } catch (error) {
        if (!hasCarrier) {
          throw error;
        }
        const fallbackState = normalizeDelegatedAnnotationState(innerState);
        const result = (parser as Parser<"sync", TValue, TState>).complete(
          fallbackState,
          exec,
        );
        if (result.success) {
          return normalizeOptionalLikePhase2Seed(
            phase2SeedFromValueResult(result),
          );
        }
        return normalizeOptionalLikePhase2Seed(
          extractPhase2Seed(
            parser as Parser<"sync", TValue, TState>,
            fallbackState,
            exec,
          ),
        );
      }
    },
    async () => {
      try {
        const result = await (
          parser as Parser<"async", TValue, TState>
        ).complete(innerState, exec);
        if (result.success) {
          return normalizeOptionalLikePhase2Seed(
            phase2SeedFromValueResult(result),
          );
        }
        const seed = await extractPhase2Seed(
          parser as Parser<"async", TValue, TState>,
          innerState,
          exec,
        );
        if (seed == null && hasCarrier) {
          const fallbackState = normalizeDelegatedAnnotationState(innerState);
          return normalizeOptionalLikePhase2Seed(
            await extractPhase2Seed(
              parser as Parser<"async", TValue, TState>,
              fallbackState,
              exec,
            ),
          );
        }
        return normalizeOptionalLikePhase2Seed(seed);
      } catch (error) {
        if (!hasCarrier) {
          throw error;
        }
        const fallbackState = normalizeDelegatedAnnotationState(innerState);
        const result = await (
          parser as Parser<"async", TValue, TState>
        ).complete(fallbackState, exec);
        if (result.success) {
          return normalizeOptionalLikePhase2Seed(
            phase2SeedFromValueResult(result),
          );
        }
        return normalizeOptionalLikePhase2Seed(
          await extractPhase2Seed(
            parser as Parser<"async", TValue, TState>,
            fallbackState,
            exec,
          ),
        );
      }
    },
  );
}

/**
 * Computes the inner state to pass through to the wrapped parser inside
 * {@link optional} / {@link withDefault}.  When the outer state is an
 * array, the inner state is `state[0]`.  Otherwise — including the
 * common case where `optional()` sits at top level and the outer state
 * is either `undefined` or an annotation wrapper from `parseOptionalLike`
 * / `parse({ annotations })` — we use the wrapped parser's
 * `initialState`, propagating annotations from the outer state so that
 * source-binding wrappers under `optional()` / `withDefault()` (e.g.,
 * `bindEnv()` / `bindConfig()`) can resolve their fallbacks.
 *
 * @internal
 */
function deriveOptionalInnerParseState<TState>(
  outerState: [TState] | undefined,
  parser: Parser<Mode, unknown, TState>,
): TState {
  if (Array.isArray(outerState)) {
    const innerState = outerState[0];
    // The outer optional-state array can pick up annotations from
    // `object()`'s `getAnnotatedChildState()` when the previous parse
    // iteration's wrapped state is re-committed to the parent object
    // (the parent stamps the array wrapper, not the inner element).
    // Mirror `normalizeOptionalLikeInnerState()`'s array handling so
    // that source-binding wrappers under `optional()` / `withDefault()`
    // see the same annotations on parse-time re-entry that they see in
    // complete-time, instead of dropping them on the way back into the
    // inner parser.
    if (
      getAnnotations(outerState) != null &&
      innerState != null &&
      typeof innerState === "object"
    ) {
      return inheritAnnotations(outerState, innerState) as TState;
    }
    return innerState;
  }
  // Propagate any annotations carried by the outer wrapper state into
  // the inner parser's initial state so that source-binding wrappers
  // like `bindEnv()` / `bindConfig()` placed under
  // `optional()` / `withDefault()` can resolve from annotations at top
  // level.  Non-nullish primitive initial states (e.g. `constant("v")`
  // whose `initialState` IS `"v"`) are returned verbatim: otherwise
  // `inheritAnnotations()` would wrap the primitive into an opaque
  // `injectAnnotations` wrapper object, and echo-semantics parsers
  // like `constant()` would return that wrapper from `complete()`
  // instead of the original primitive, leaking through `object()`
  // fields as an empty-looking object.  Nullish initial states
  // (`undefined` / `null`, the "no state yet" signal used by
  // `option()` / `argument()` / `bindEnv()` / `bindConfig()`) still go
  // through `inheritAnnotations()` so source-binding wrappers can read
  // the propagated annotations from their `parse()` context.
  const initial = parser.initialState;
  if (initial != null && typeof initial !== "object") {
    return initial;
  }
  return inheritAnnotations(outerState, initial) as TState;
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
  const innerState = deriveOptionalInnerParseState(context.state, parser);

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
  const innerState = deriveOptionalInnerParseState(context.state, parser);

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
        // Propagate provisional from the inner result so that
        // or() can detect tentative zero-consumed matches through
        // optional/withDefault/multiple wrappers.
        ...(result.provisional ? { provisional: true as const } : {}),
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
      ...(result.provisional ? { provisional: true as const } : {}),
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
  parser: Parser<Mode, unknown, TState>,
): (state: [TState] | undefined, exec?: ExecutionContext) => boolean {
  return (state: [TState] | undefined, exec?: ExecutionContext): boolean => {
    if (Array.isArray(state) || (state != null && typeof state === "object")) {
      const innerState = normalizeOptionalLikeInnerState(
        state,
        parser.initialState,
        parser,
      );
      try {
        return innerCheck(innerState, exec);
      } catch (error) {
        if (!hasDelegatedAnnotationCarrier(innerState)) {
          throw error;
        }
        return innerCheck(normalizeDelegatedAnnotationState(innerState), exec);
      }
    }
    return false;
  };
}

function isAnnotationOnlyObjectState(
  state: unknown,
): state is Record<typeof annotationKey, unknown> {
  if (
    state == null ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    isInjectedAnnotationWrapper(state)
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(state);
  return getAnnotations(state) != null &&
    keys.length === 1 &&
    keys[0] === annotationKey;
}

function normalizeOptionalLikeInnerState<TState>(
  state: [TState] | TState | undefined,
  initialState: TState,
  parser?: Parser<Mode, unknown, TState>,
): TState {
  if (Array.isArray(state)) {
    return getDelegatedAnnotationState(state, state[0]);
  }
  if (isAnnotationOnlyObjectState(state)) {
    if (
      parser != null &&
      (
        parser.dependencyMetadata?.source != null ||
        typeof parser.shouldDeferCompletion === "function"
      )
    ) {
      return getDelegatedAnnotationState(state, initialState);
    }
    return initialState;
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
      parser,
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
      parser,
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
    // Forward the non-CLI source-binding marker so that `optional()`'s
    // `complete()` method can delegate to the inner parser when the
    // wrapped parser is a `bindEnv()` / `bindConfig()` source binding.
    // This ensures source fallbacks resolve even when object()'s
    // zero-consumption pass skips `optional.parse()` because the inner
    // parser has leadingNames from its own wrapped `option()`.
    ...(parser[unmatchedNonCliDependencySourceStateMarker] === true
      ? { [unmatchedNonCliDependencySourceStateMarker]: true as const }
      : {}),
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
          parser,
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
        parser,
      );
      return parser.getSuggestRuntimeNodes?.(innerState, path) ??
        (parser.dependencyMetadata?.source != null
          ? [{ path, parser, state: innerState }]
          : []);
    },
    [extractPhase2SeedKey](
      state: [TState] | undefined,
      exec?: ExecutionContext,
    ) {
      return extractOptionalLikePhase2Seed(parser, state, exec);
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
        // Helper: delegate to inner.complete() with the optional's
        // inner state shape, wrapping any inner failure as
        // `{ success: true, value: undefined }` so optional always
        // reports success upstream.
        const delegateToInner = (
          resolvedInnerState: TState,
        ): ModeValue<M, ValueParserResult<TValue | undefined>> => {
          const innerResult = dispatchByMode(
            parser.$mode,
            () =>
              completeOptionalLikeSync(syncParser, resolvedInnerState, exec),
            async () =>
              await completeOptionalLikeAsync(
                parser,
                resolvedInnerState,
                exec,
              ) as ValueParserResult<TValue | undefined>,
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
        if (
          typeof parser.shouldDeferCompletion === "function" &&
          state != null &&
          typeof state === "object"
        ) {
          const innerState = normalizeOptionalLikeInnerState(
            state,
            parser.initialState,
            parser,
          );
          return delegateToInner(innerState);
        }
        // When the inner parser preserves an omitted-source default via
        // dependency metadata (e.g. optional(withDefault(source))), delegate
        // to it so the user-visible value matches the dependency runtime.
        const sourceMetadata = parser.dependencyMetadata?.source;
        if (
          sourceMetadata?.preservesSourceValue !== false &&
          sourceMetadata?.getMissingSourceValue != null
        ) {
          const delegatedState = normalizeOptionalLikeInnerState(
            state,
            parser.initialState,
            parser,
          );
          return dispatchByMode(
            parser.$mode,
            () => completeOptionalLikeSync(syncParser, delegatedState, exec),
            async () =>
              await completeOptionalLikeAsync(
                parser,
                delegatedState,
                exec,
              ) as ValueParserResult<TValue | undefined>,
          );
        }
        // When the inner parser is a non-CLI source binding (bindEnv,
        // bindConfig), give it a chance to satisfy the value from its
        // source even though object()'s zero-consumption pass skipped
        // calling our parse() (because the inner has leadingNames
        // from its own inner option()).  The guard here rejects a
        // bare `undefined` state because all supported entry points
        // that populate the active source registry (runWithSync /
        // runWithAsync) also inject annotations onto the outer state,
        // so by the time optional.complete() sees a non-array state
        // with source-resolvable data, that state is an annotation
        // wrapper (a non-null object).  If the inner parser fails or
        // returns undefined, we fall back to optional's undefined
        // result as before.
        if (
          parser[unmatchedNonCliDependencySourceStateMarker] === true &&
          state != null &&
          typeof state === "object"
        ) {
          const innerState = normalizeOptionalLikeInnerState(
            state,
            parser.initialState,
            parser,
          );
          return delegateToInner(innerState);
        }
        return { success: true, value: undefined };
      }
      const innerElement = normalizeOptionalLikeInnerState(
        state,
        parser.initialState,
        parser,
      );
      return dispatchByMode(
        parser.$mode,
        () =>
          completeOptionalLikeSync(syncParser, innerElement as TState, exec),
        async () =>
          await completeOptionalLikeAsync(
            parser,
            innerElement as TState,
            exec,
          ) as ValueParserResult<TValue | undefined>,
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
  // Forward value validation (see issue #414).  `undefined` always
  // passes; everything else delegates to the inner validator.
  if (typeof parser.validateValue === "function") {
    const innerValidate = parser.validateValue.bind(parser);
    Object.defineProperty(optionalParser, "validateValue", {
      value(
        v: TValue | undefined,
      ): ModeValue<M, ValueParserResult<TValue | undefined>> {
        if (v === undefined) {
          return wrapForMode<M, ValueParserResult<TValue | undefined>>(
            parser.$mode,
            { success: true as const, value: v },
          );
        }
        return innerValidate(v);
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
  defineInheritedAnnotationParser(optionalParser);
  defineSourceBindingOnlyAnnotationCompletionParser(optionalParser);
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
      parser,
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
      parser,
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
    // Forward the non-CLI source-binding marker.  See `optional()` for
    // the rationale — the same reasoning applies to `withDefault()`.
    ...(parser[unmatchedNonCliDependencySourceStateMarker] === true
      ? { [unmatchedNonCliDependencySourceStateMarker]: true as const }
      : {}),
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
          parser,
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
        parser,
      );
      return parser.getSuggestRuntimeNodes?.(innerState, path) ??
        (parser.dependencyMetadata?.source != null
          ? [{ path, parser, state: innerState }]
          : []);
    },
    [extractPhase2SeedKey](
      state: [TState] | undefined,
      exec?: ExecutionContext,
    ) {
      return extractOptionalLikePhase2Seed(parser, state, exec);
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
          const innerState = normalizeOptionalLikeInnerState(
            state,
            parser.initialState,
            parser,
          );
          const innerResult = dispatchByMode(
            parser.$mode,
            () => completeOptionalLikeSync(syncParser, innerState, exec),
            async () =>
              await completeOptionalLikeAsync(
                parser,
                innerState,
                exec,
              ) as ValueParserResult<TValue>,
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
        // Case: Inner parser is a non-CLI source binding (bindEnv /
        // bindConfig).  Give it a chance to resolve from its source
        // before falling back to the configured default, so that
        // `withDefault(bindEnv(...), fallback)` prefers the env value
        // over `fallback`.  This mirrors the branch in `optional()`.
        // The guard here rejects a bare `undefined` state for the
        // same reason the `optional()` branch does: runWithSync /
        // runWithAsync always inject annotations onto the outer
        // state, so a reachable source-resolvable state is always an
        // annotation wrapper (a non-null object).
        if (
          parser[unmatchedNonCliDependencySourceStateMarker] === true &&
          state != null &&
          typeof state === "object"
        ) {
          const innerState = normalizeOptionalLikeInnerState(
            state,
            parser.initialState,
            parser,
          );
          const innerResult = dispatchByMode(
            parser.$mode,
            () => completeOptionalLikeSync(syncParser, innerState, exec),
            async () =>
              await completeOptionalLikeAsync(
                parser,
                innerState,
                exec,
              ) as ValueParserResult<TValue>,
          );
          const handleInnerResult = (
            result: ValueParserResult<TValue>,
          ): ValueParserResult<TValue | TDefault> => {
            if (result.success && result.value !== undefined) {
              return result;
            }
            // Inner source binding returned nothing → fall back to the
            // configured default.
            try {
              return {
                success: true as const,
                value: evaluateDefault(),
              };
            } catch (error) {
              return {
                success: false as const,
                error: error instanceof WithDefaultError
                  ? error.errorMessage
                  : message`${text(String(error))}`,
              };
            }
          };
          return mapModeValue<
            M,
            ValueParserResult<TValue>,
            ValueParserResult<TValue | TDefault>
          >(
            parser.$mode,
            innerResult,
            handleInnerResult,
          );
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
      const innerElement = normalizeOptionalLikeInnerState(
        state,
        parser.initialState,
        parser,
      );
      return dispatchByMode(
        parser.$mode,
        () =>
          completeOptionalLikeSync(syncParser, innerElement as TState, exec),
        async () =>
          await completeOptionalLikeAsync(
            parser,
            innerElement as TState,
            exec,
          ) as ValueParserResult<TValue | TDefault>,
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
  // Forward value validation as non-enumerable (see issue #414).  The
  // inner validator already swallows exceptions from sentinel-default
  // format() calls, so we delegate directly without an extra try/catch.
  if (typeof parser.validateValue === "function") {
    const innerValidate = parser.validateValue.bind(parser);
    Object.defineProperty(withDefaultParser, "validateValue", {
      value(
        v: TValue | TDefault,
      ): ModeValue<M, ValueParserResult<TValue | TDefault>> {
        return innerValidate(v as TValue) as ModeValue<
          M,
          ValueParserResult<TValue | TDefault>
        >;
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
  defineInheritedAnnotationParser(withDefaultParser);
  defineSourceBindingOnlyAnnotationCompletionParser(withDefaultParser);
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
    [extractPhase2SeedKey](state: TState, exec?: ExecutionContext) {
      return mapModeValue(
        parser.$mode,
        completeOrExtractPhase2Seed(parser, state, exec),
        (seed) => {
          if (seed == null) return null;
          if (seed.deferred) {
            try {
              return {
                value: transform(seed.value as T),
                deferred: true as const,
              };
            } catch {
              return {
                value: undefined as unknown as U,
                deferred: true as const,
              };
            }
          }
          return { value: transform(seed.value as T) };
        },
      );
    },
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
  // Strip validateValue for the same reason (see issue #414): the
  // inner validator operates on type T, not the mapped type U, so
  // retaining it would attempt to format mapped outputs through the
  // inner ValueParser and produce wrong results or crashes.
  delete (mappedParser as { validateValue?: unknown }).validateValue;
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
  const extractPhase2SeedSyncWithUnwrappedFallback = (
    state: TState,
    exec?: ExecutionContext,
  ) => {
    try {
      const seed = completeOrExtractPhase2Seed(syncParser, state, exec);
      if (seed == null && isInjectedAnnotationWrapper(state)) {
        return completeOrExtractPhase2Seed(
          syncParser,
          unwrapInjectedWrapper(state),
          exec,
        );
      }
      return seed;
    } catch (error) {
      if (!isInjectedAnnotationWrapper(state)) {
        throw error;
      }
      return completeOrExtractPhase2Seed(
        syncParser,
        unwrapInjectedWrapper(state),
        exec,
      );
    }
  };
  const extractPhase2SeedAsyncWithUnwrappedFallback = async (
    state: TState,
    exec?: ExecutionContext,
  ) => {
    try {
      const seed = await completeOrExtractPhase2Seed(parser, state, exec);
      if (seed == null && isInjectedAnnotationWrapper(state)) {
        return await completeOrExtractPhase2Seed(
          parser,
          unwrapInjectedWrapper(state),
          exec,
        );
      }
      return seed;
    } catch (error) {
      if (!isInjectedAnnotationWrapper(state)) {
        throw error;
      }
      return await completeOrExtractPhase2Seed(
        parser,
        unwrapInjectedWrapper(state),
        exec,
      );
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
    const canOpenFreshItem = context.state.length < max;
    if (!canExtendCurrent && !canOpenFreshItem) {
      return {
        success: true,
        next: context,
        consumed: [],
      };
    }
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
      // Failures that consumed input must propagate so callers see the
      // real error depth (e.g., a mid-item validation failure).
      if (result.consumed !== 0) {
        return result;
      }
      if (!added && canOpenFreshItem) {
        // We were extending the current item and it failed without
        // consuming; retry by opening a fresh item instead.
        const nextInitialState = inheritAnnotations(
          context.state,
          syncParser.initialState,
        );
        itemIndex = context.state.length;
        result = parseSyncWithUnwrappedFallback(
          withChildContext(context, itemIndex, nextInitialState),
        );
        if (!result.success) {
          // Fresh-item attempt also failed.  When `min === 0` and the
          // buffer is empty we can absorb the zero-consumption failure
          // so complete() applies the documented zero-or-more
          // semantics (returning an empty array).  See
          // https://github.com/dahlia/optique/issues/408.  The
          // absorption is intentionally scoped to true end-of-input:
          // for non-empty buffers the inner parser's specific error
          // (e.g. "No matched option for `-x`" with suggestions) is
          // more informative than the outer stall fallback, and for
          // `min > 0` we propagate the failure so outer wrappers like
          // optional() and withDefault() can still absorb it via
          // their own processOptionalStyleResult fallback.
          if (
            min === 0 && context.buffer.length === 0 &&
            result.consumed === 0
          ) {
            return { success: true, next: context, consumed: [] };
          }
          return result;
        }
        added = true;
      } else if (min === 0 && context.buffer.length === 0) {
        // No fresh-item retry possible (either we already opened a
        // fresh item or we've hit max), the buffer is empty, and we
        // have no `min` to enforce.  Absorb the end-of-input failure
        // so complete() can return an empty array.  See
        // https://github.com/dahlia/optique/issues/408.
        return { success: true, next: context, consumed: [] };
      } else {
        // Either `min > 0` (so outer wrappers must get a chance to
        // absorb) or the buffer still has tokens (so the inner
        // parser's specific error message is more useful than the
        // outer stall fallback).  Propagate unchanged.  See
        // https://github.com/dahlia/optique/issues/408.
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
              trace: mergedExec.trace,
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
        ...(result.provisional ? { provisional: true as const } : {}),
        next: {
          ...result.next,
          state: context.state,
          ...(mergedExec != null
            ? {
              trace: mergedExec.trace,
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
      ...(result.provisional ? { provisional: true as const } : {}),
      next: {
        ...result.next,
        state: annotateFreshArray(context.state, [
          ...(added ? context.state : context.state.slice(0, -1)),
          nextItemState,
        ]),
        ...(mergedExec != null
          ? {
            trace: mergedExec.trace,
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
    const canOpenFreshItem = context.state.length < max;
    if (!canExtendCurrent && !canOpenFreshItem) {
      return {
        success: true,
        next: context,
        consumed: [],
      };
    }
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
      // Failures that consumed input must propagate so callers see the
      // real error depth (e.g., a mid-item validation failure).
      if (result.consumed !== 0) {
        return result;
      }
      if (!added && canOpenFreshItem) {
        // We were extending the current item and it failed without
        // consuming; retry by opening a fresh item instead.
        const nextInitialState = inheritAnnotations(
          context.state,
          parser.initialState,
        );
        itemIndex = context.state.length;
        result = await parseAsyncWithUnwrappedFallback(
          withChildContext(context, itemIndex, nextInitialState),
        );
        if (!result.success) {
          // Fresh-item attempt also failed.  When `min === 0` and the
          // buffer is empty we can absorb the zero-consumption failure
          // so complete() applies the documented zero-or-more
          // semantics (returning an empty array).  See
          // https://github.com/dahlia/optique/issues/408.  The
          // absorption is intentionally scoped to true end-of-input:
          // for non-empty buffers the inner parser's specific error
          // (e.g. "No matched option for `-x`" with suggestions) is
          // more informative than the outer stall fallback, and for
          // `min > 0` we propagate the failure so outer wrappers like
          // optional() and withDefault() can still absorb it via
          // their own processOptionalStyleResult fallback.
          if (
            min === 0 && context.buffer.length === 0 &&
            result.consumed === 0
          ) {
            return { success: true, next: context, consumed: [] };
          }
          return result;
        }
        added = true;
      } else if (min === 0 && context.buffer.length === 0) {
        // No fresh-item retry possible (either we already opened a
        // fresh item or we've hit max), the buffer is empty, and we
        // have no `min` to enforce.  Absorb the end-of-input failure
        // so complete() can return an empty array.  See
        // https://github.com/dahlia/optique/issues/408.
        return { success: true, next: context, consumed: [] };
      } else {
        // Either `min > 0` (so outer wrappers must get a chance to
        // absorb) or the buffer still has tokens (so the inner
        // parser's specific error message is more useful than the
        // outer stall fallback).  Propagate unchanged.  See
        // https://github.com/dahlia/optique/issues/408.
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
              trace: mergedExec.trace,
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
        ...(result.provisional ? { provisional: true as const } : {}),
        next: {
          ...result.next,
          state: context.state,
          ...(mergedExec != null
            ? {
              trace: mergedExec.trace,
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
      ...(result.provisional ? { provisional: true as const } : {}),
      next: {
        ...result.next,
        state: annotateFreshArray(context.state, [
          ...(added ? context.state : context.state.slice(0, -1)),
          nextItemState,
        ]),
        ...(mergedExec != null
          ? {
            trace: mergedExec.trace,
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
      const innerNodes = state.flatMap((item, i) => [
        ...getInnerSuggestRuntimeNodes(item as TState, [...path, i]),
      ]);
      return resultParser.dependencyMetadata?.source != null
        ? [{ path, parser: resultParser, state }, ...innerNodes]
        : innerNodes;
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
          const values: TValue[] = [];
          const deferredIndices = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          for (let i = 0; i < state.length; i++) {
            const valueResult = await completeAsyncWithUnwrappedFallback(
              state[i] as TState,
              withChildExecPath(exec, i),
            );
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
    [extractPhase2SeedKey](state: MultipleState, exec?: ExecutionContext) {
      return dispatchByMode(
        parser.$mode,
        () => {
          const values: TValue[] = [];
          const deferredIndices = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          let hasAnySeed = false;
          for (let i = 0; i < state.length; i++) {
            const seed = extractPhase2SeedSyncWithUnwrappedFallback(
              state[i] as TState,
              withChildExecPath(exec, i),
            );
            if (seed == null) continue;
            hasAnySeed = true;
            values[i] = seed.value;
            if (seed.deferred) {
              if (seed.deferredKeys) {
                deferredIndices.set(i, seed.deferredKeys);
              } else if (
                seed.value == null ||
                typeof seed.value !== "object"
              ) {
                deferredIndices.set(i, null);
              } else {
                hasDeferred = true;
              }
            }
          }
          if (!hasAnySeed) return null;
          return {
            value: values as readonly TValue[],
            ...(deferredIndices.size > 0 || hasDeferred
              ? {
                deferred: true as const,
                ...(deferredIndices.size > 0
                  ? { deferredKeys: deferredIndices as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
        async () => {
          const values: TValue[] = [];
          const deferredIndices = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          let hasAnySeed = false;
          for (let i = 0; i < state.length; i++) {
            const seed = await extractPhase2SeedAsyncWithUnwrappedFallback(
              state[i] as TState,
              withChildExecPath(exec, i),
            );
            if (seed == null) continue;
            hasAnySeed = true;
            values[i] = seed.value;
            if (seed.deferred) {
              if (seed.deferredKeys) {
                deferredIndices.set(i, seed.deferredKeys);
              } else if (
                seed.value == null ||
                typeof seed.value !== "object"
              ) {
                deferredIndices.set(i, null);
              } else {
                hasDeferred = true;
              }
            }
          }
          if (!hasAnySeed) return null;
          return {
            value: values as readonly TValue[],
            ...(deferredIndices.size > 0 || hasDeferred
              ? {
                deferred: true as const,
                ...(deferredIndices.size > 0
                  ? { deferredKeys: deferredIndices as DeferredMap }
                  : {}),
              }
              : {}),
          };
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
        for (let i = 0; i < context.state.length; i++) {
          const childContext = withChildContext(
            context,
            i,
            context.state[i] as TState,
          );
          const completed = await completeAsyncWithUnwrappedFallback(
            childContext.state,
            childContext.exec,
          );
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
  // Forward value validation (see issue #414): validate each element
  // through the inner parser's validateValue and also re-check the
  // multiple()'s own min/max rules against the array length.  Attached
  // unconditionally so that multiple()'s arity bounds are enforced on
  // fallback values even when the inner parser has no validateValue.
  // Non-enumerable so map()'s spread does not propagate it.
  {
    const innerValidate = typeof parser.validateValue === "function"
      ? parser.validateValue.bind(parser)
      : undefined;
    // Mirrors the arity branch of `validateMultipleResult` above so that
    // fallback validation failures look identical to CLI failures (same
    // number formatting via `toLocaleString("en")`, same "but got only"
    // phrasing, and the same `options.errors.tooFew` / `tooMany`
    // customization).
    const validateArity = (
      values: readonly TValue[],
    ): ValueParserResult<readonly TValue[]> => {
      if (values.length < min) {
        const customMessage = options.errors?.tooFew;
        return {
          success: false,
          error: customMessage
            ? (typeof customMessage === "function"
              ? customMessage(min, values.length)
              : customMessage)
            : message`Expected at least ${
              text(min.toLocaleString("en"))
            } values, but got only ${
              text(values.length.toLocaleString("en"))
            }.`,
        };
      }
      if (values.length > max) {
        const customMessage = options.errors?.tooMany;
        return {
          success: false,
          error: customMessage
            ? (typeof customMessage === "function"
              ? customMessage(max, values.length)
              : customMessage)
            : message`Expected at most ${
              text(max.toLocaleString("en"))
            } values, but got ${text(values.length.toLocaleString("en"))}.`,
        };
      }
      return { success: true as const, value: values };
    };
    Object.defineProperty(resultParser, "validateValue", {
      value(
        values: readonly TValue[],
      ): ModeValue<M, ValueParserResult<readonly TValue[]>> {
        // multiple() can never produce a non-array shape from CLI input,
        // so a non-array fallback (e.g., an `as never`-coerced default
        // or a mis-shaped config value) is always a type error and must
        // be rejected rather than silently passed through (#414).  The
        // error names the received type so users can locate the source.
        if (!Array.isArray(values)) {
          const actualType = values === null ? "null" : typeof values;
          return wrapForMode<M, ValueParserResult<readonly TValue[]>>(
            parser.$mode,
            {
              success: false as const,
              error:
                message`Expected an array of values, but received ${actualType}.`,
            },
          );
        }
        const arity = validateArity(values);
        if (!arity.success) {
          return wrapForMode<M, ValueParserResult<readonly TValue[]>>(
            parser.$mode,
            arity,
          );
        }
        if (innerValidate == null) {
          return wrapForMode<M, ValueParserResult<readonly TValue[]>>(
            parser.$mode,
            arity,
          );
        }
        // Preserve any canonicalization performed by the inner
        // parser's validateValue (e.g., a URL parser stripping
        // trailing slashes) so the fallback path matches CLI parsing
        // semantics.  Only allocate a new array when at least one
        // element actually changed to avoid needless churn on the
        // common "already canonical" case (see review r3048978718).
        return dispatchByMode<M, ValueParserResult<readonly TValue[]>>(
          parser.$mode,
          () => {
            let changed = false;
            const normalized: TValue[] = [];
            for (const v of values) {
              const r = innerValidate(v) as ValueParserResult<TValue>;
              if (!r.success) return r;
              normalized.push(r.value);
              if (r.value !== v) changed = true;
            }
            return {
              success: true as const,
              value: changed ? normalized : values,
            };
          },
          async () => {
            let changed = false;
            const normalized: TValue[] = [];
            for (const v of values) {
              const r = (await innerValidate(v)) as ValueParserResult<TValue>;
              if (!r.success) return r;
              normalized.push(r.value);
              if (r.value !== v) changed = true;
            }
            return {
              success: true as const,
              value: changed ? normalized : values,
            };
          },
        );
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
  Object.defineProperty(nonEmptyParser, extractPhase2SeedKey, {
    value(state: TState, exec?: ExecutionContext) {
      return extractPhase2Seed(parser, state, exec);
    },
    configurable: true,
    enumerable: false,
  });
  // Forward value normalization as non-enumerable.
  if (typeof parser.normalizeValue === "function") {
    Object.defineProperty(nonEmptyParser, "normalizeValue", {
      value: parser.normalizeValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  // Forward value validation as non-enumerable (see issue #414).
  // nonEmpty() is state-shape preserving and only constrains parse-time
  // token consumption, so it can pass validateValue through to the
  // inner parser unchanged.  Users who need an arity-1 enforcement on
  // fallback values should use `multiple(..., { min: 1 })` directly.
  if (typeof parser.validateValue === "function") {
    Object.defineProperty(nonEmptyParser, "validateValue", {
      value: parser.validateValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  return nonEmptyParser;
}
