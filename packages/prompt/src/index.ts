/**
 * Generic prompt adapter support for Optique.
 *
 * @module
 * @since 1.2.0
 */
import { getAnnotations } from "@optique/core/annotations";
import {
  defineTraits,
  delegateSuggestNodes,
  getTraits,
  inheritAnnotations,
  injectAnnotations,
  mapSourceMetadata,
  type ParserSourceMetadata,
  unwrapInjectedAnnotationState,
  withAnnotationView,
} from "@optique/core/extension";
import { fluent, type FluentParser } from "@optique/core/fluent";
import type {
  ExecutionContext,
  Mode,
  ModeValue,
  Parser,
  ParserResult,
} from "@optique/core/parser";
import type { ValueParserResult } from "@optique/core/valueparser";

/**
 * Controls whether a prompt fallback runs at runtime.
 *
 * When `when` returns `false`, the prompt adapter is skipped and `otherwise`
 * is returned.  The condition runs only when parsing reaches the prompt
 * fallback, after CLI values and other configured value sources have been
 * exhausted.
 *
 * @typeParam TValue Value type produced by the wrapped parser.
 * @since 1.3.0
 */
export type PromptCondition<TValue> =
  | {
    readonly when?: never;
    readonly otherwise?: never;
  }
  | {
    readonly when: () => boolean | Promise<boolean>;
    readonly otherwise: NoInfer<TValue>;
  };

/**
 * Prompt adapter used by {@link createPromptAdapter}.
 *
 * The adapter owns library-specific prompt execution and maps the result into
 * Optique's value-parser result shape.  The shared parser wrapping behavior,
 * including CLI priority, source bindings, deferred completion, suggestions,
 * and usage metadata, is handled by *@optique/prompt*.
 *
 * @typeParam TConfig Prompt configuration accepted by the adapter.
 * @since 1.2.0
 */
export interface PromptAdapter<TConfig> {
  /**
   * Executes the library-specific prompt.
   *
   * @typeParam TValue Value type produced by the wrapped parser.
   * @param config Prompt configuration supplied to the generated `prompt()`
   *               wrapper.
   * @returns The prompted value or a prompt failure.
   * @throws Any unexpected prompt execution failure.
   */
  readonly execute: <TValue>(
    config: TConfig,
  ) => Promise<ValueParserResult<TValue>>;

  /**
   * Returns a default value from the prompt config for documentation purposes.
   *
   * If omitted, *@optique/prompt* reads a `default` property from object-shaped
   * configs when present.
   *
   * @param config Prompt configuration supplied to the generated `prompt()`
   *               wrapper.
   * @returns A default value to pass to the wrapped parser's documentation
   *          fragments.
   */
  readonly getDefaultValue?: (config: TConfig) => unknown;
}

function shouldDeferPrompt(
  parser: Parser<Mode, unknown, unknown>,
  state: unknown,
  exec?: ExecutionContext,
): boolean {
  return typeof parser.shouldDeferCompletion === "function" &&
    parser.shouldDeferCompletion(state, exec) === true;
}

function deferredPromptResult<TValue>(
  placeholderValue: TValue,
): ValueParserResult<TValue> {
  if (placeholderValue == null || typeof placeholderValue !== "object") {
    return {
      success: true,
      value: placeholderValue,
      deferred: true,
    };
  }

  const isArray = Array.isArray(placeholderValue);
  const keys = new Map<PropertyKey, null>();
  for (const key of Reflect.ownKeys(placeholderValue)) {
    if (isArray && key === "length") continue;
    keys.set(key, null);
  }

  return {
    success: true,
    value: placeholderValue,
    deferred: true,
    deferredKeys: keys,
  };
}

function withAnnotatedInnerState<TState, TResult>(
  sourceState: unknown,
  innerState: TState,
  run: (annotatedState: TState) => TResult,
  inheritPrimitiveAnnotations = false,
): TResult {
  const annotations = getAnnotations(sourceState);
  const innerStateIsObject = innerState != null &&
    typeof innerState === "object";
  if (
    annotations == null ||
    getAnnotations(innerState) != null ||
    (!innerStateIsObject && !inheritPrimitiveAnnotations)
  ) {
    return run(innerState);
  }

  const inheritedState = inheritAnnotations(sourceState, innerState);
  if (inheritedState !== innerState) {
    return run(inheritedState);
  }

  return innerStateIsObject
    ? run(withAnnotationView(innerState, annotations))
    : run(innerState);
}

function hasSourceBindingMarker(state: unknown): boolean {
  return state != null &&
    typeof state === "object" &&
    "hasCliValue" in state &&
    Object.getOwnPropertySymbols(state).length > 0;
}

function readDefaultValue<TConfig>(
  adapter: PromptAdapter<TConfig>,
  config: TConfig,
): unknown {
  if (adapter.getDefaultValue != null) return adapter.getDefaultValue(config);
  if (config != null && typeof config === "object" && "default" in config) {
    return (config as { readonly default?: unknown }).default;
  }
  return undefined;
}

function unwrapCompleteResult<TValue>(
  result: ValueParserResult<TValue>,
): ValueParserResult<TValue> {
  if (!result.success) return result;
  return {
    ...result,
    value: unwrapInjectedAnnotationState(result.value),
  };
}

/**
 * Creates a `prompt()` parser wrapper for a prompt library adapter.
 *
 * The generated wrapper tries the inner parser first.  If CLI tokens, source
 * bindings, or defaults satisfy the parser, the prompt is skipped.  Otherwise
 * the adapter runs during the real completion phase and provides a fallback
 * value.
 *
 * @typeParam TConfig Prompt configuration accepted by the adapter.
 * @param adapter Library-specific prompt executor.
 * @returns A `prompt(parser, config)` wrapper that always produces an async
 *          parser.
 * @since 1.2.0
 */
export function createPromptAdapter<TConfig>(
  adapter: PromptAdapter<TConfig>,
): <M extends Mode, TValue, TState>(
  parser: Parser<M, TValue, TState>,
  config: TConfig & PromptCondition<TValue>,
) => FluentParser<"async", TValue, TState> {
  return function prompt<M extends Mode, TValue, TState>(
    parser: Parser<M, TValue, TState>,
    config: TConfig & PromptCondition<TValue>,
  ): FluentParser<"async", TValue, TState> {
    const promptBindStateKey: unique symbol = Symbol(
      "@optique/prompt/promptState",
    );
    // Identifies this prompt wrapper occurrence in the run-scoped
    // effectful completion session.  The cache key combines the wrapper
    // instance (via this closure) with the completion path so that two
    // distinct prompts sharing one source (e.g., duplicate merge()
    // fields) and one instance reused at several positions (e.g.,
    // `tuple([p, p])`) each keep their own result, while the same
    // occurrence still reuses its result across the seed and final
    // passes of a runWith() run.
    const completionCacheKeys = new Map<string, symbol>();
    const completionCacheSymbolIds = new Map<symbol, number>();
    const completionCacheKeyFor = (
      path: readonly PropertyKey[] | undefined,
    ): symbol => {
      // Length-prefix each segment so no separator escaping is needed.
      const serialized = (path ?? []).map((segment) => {
        if (typeof segment === "symbol") {
          let id = completionCacheSymbolIds.get(segment);
          if (id == null) {
            id = completionCacheSymbolIds.size;
            completionCacheSymbolIds.set(segment, id);
          }
          return `y${id}:`;
        }
        const tag = typeof segment === "number" ? "n" : "s";
        const text = String(segment);
        return `${tag}${text.length}:${text}`;
      }).join("");
      let key = completionCacheKeys.get(serialized);
      if (key == null) {
        key = Symbol("@optique/prompt/completionCache");
        completionCacheKeys.set(serialized, key);
      }
      return key;
    };

    type PromptBindState =
      & { readonly [K in typeof promptBindStateKey]: true }
      & {
        readonly hasCliValue: boolean;
        readonly cliState?: TState;
      };

    function isPromptBindState(value: unknown): value is PromptBindState {
      return value != null &&
        typeof value === "object" &&
        promptBindStateKey in value;
    }

    function shouldAttemptInnerCompletion(
      cliState: unknown,
      state: unknown,
    ): boolean {
      if (cliState == null) {
        return false;
      }
      const cliStateHasAnnotations = getAnnotations(cliState) != null;
      if (cliStateHasAnnotations) {
        return true;
      }
      if (getAnnotations(state) == null || typeof cliState !== "object") {
        return false;
      }
      if ("hasCliValue" in cliState) {
        return true;
      }
      if (Array.isArray(cliState)) {
        return typeof parser.shouldDeferCompletion === "function";
      }
      const prototype = Object.getPrototypeOf(cliState);
      return prototype !== Object.prototype && prototype !== null;
    }

    function shouldCompleteFromSourceBinding(
      cliState: unknown,
      state: unknown,
    ): boolean {
      const cliStateIsInjectedAnnotationWrapper = cliState != null &&
        typeof cliState === "object" &&
        unwrapInjectedAnnotationState(cliState) !== cliState;
      const requiresSourceBindingForAnnotationWrapper =
        getTraits(parser).requiresSourceBinding === true;
      const hasNestedSourceBinding = hasSourceBindingMarker(cliState) ||
        (Array.isArray(cliState) &&
          cliState.length === 1 &&
          (hasSourceBindingMarker(cliState[0]) ||
            (
              cliState[0] != null &&
              typeof cliState[0] === "object" &&
              getAnnotations(cliState[0]) != null
            )));
      if (
        cliStateIsInjectedAnnotationWrapper &&
        requiresSourceBindingForAnnotationWrapper
      ) {
        return hasNestedSourceBinding;
      }
      return shouldAttemptInnerCompletion(cliState, state) ||
        hasNestedSourceBinding;
    }

    async function executePrompt(): Promise<ValueParserResult<TValue>> {
      if (config.when != null && !(await config.when())) {
        return { success: true, value: config.otherwise };
      }
      return adapter.execute<TValue>(config);
    }

    const parserInheritsAnnotations = getTraits(parser).inheritsAnnotations ===
      true;

    const promptedParser: Parser<"async", TValue, TState> = {
      mode: "async",
      $valueType: parser.$valueType,
      $stateType: parser.$stateType,
      priority: parser.priority,
      usage: parser.usage.length === 1 && parser.usage[0].type === "optional"
        ? parser.usage
        : [{ type: "optional", terms: parser.usage }],
      leadingNames: parser.leadingNames,
      acceptingAnyToken: parser.acceptingAnyToken,
      shouldDeferCompletion(state: TState): boolean {
        return !isPromptBindState(state) || !state.hasCliValue;
      },
      getSuggestRuntimeNodes(state: TState, path: readonly PropertyKey[]) {
        const innerState = isPromptBindState(state)
          ? (state.cliState === undefined
            ? parser.initialState
            : state.cliState as TState)
          : state;
        return delegateSuggestNodes(
          parser,
          promptedParser,
          state,
          path,
          innerState,
          "prepend",
        );
      },
      initialState: {
        [promptBindStateKey]: true as const,
        hasCliValue: false as const,
      } as TState,

      parse: (context): ModeValue<"async", ParserResult<TState>> => {
        const annotations = getAnnotations(context.state);
        const innerState = isPromptBindState(context.state)
          ? (context.state.hasCliValue
            ? (context.state.cliState as TState)
            : parser.initialState)
          : context.state;
        const baseInnerContext = innerState !== context.state
          ? { ...context, state: innerState }
          : context;
        const effectiveInnerState = annotations != null &&
            innerState == null &&
            parserInheritsAnnotations
          ? injectAnnotations(innerState, annotations)
          : innerState;
        const processResult = (
          result: ParserResult<TState>,
        ): ParserResult<TState> => {
          if (result.success) {
            const cliState = annotations != null &&
                result.next.state != null &&
                typeof result.next.state === "object" &&
                getAnnotations(result.next.state) !== annotations
              ? injectAnnotations(result.next.state, annotations)
              : result.next.state;
            const cliConsumed = result.consumed.length > 0;
            const nextState = injectAnnotations({
              [promptBindStateKey]: true as const,
              hasCliValue: cliConsumed,
              cliState,
            }, annotations);
            return {
              success: true,
              ...(result.provisional ? { provisional: true as const } : {}),
              next: { ...result.next, state: nextState as TState },
              consumed: result.consumed,
            };
          }

          if (result.consumed > 0) {
            return result;
          }

          const nextState = injectAnnotations({
            [promptBindStateKey]: true as const,
            hasCliValue: false,
          }, annotations);
          return {
            success: true,
            next: { ...baseInnerContext, state: nextState as TState },
            consumed: [],
          };
        };

        const result = withAnnotatedInnerState(
          context.state,
          effectiveInnerState,
          (annotatedInnerState) => {
            const innerContext = annotatedInnerState !== context.state
              ? { ...context, state: annotatedInnerState }
              : context;
            return parser.parse(innerContext);
          },
          parserInheritsAnnotations,
        );
        if (result instanceof Promise) {
          return result.then(processResult);
        }
        return Promise.resolve(processResult(result));
      },

      complete: (state, exec?): Promise<ValueParserResult<TValue>> => {
        if (isPromptBindState(state) && state.hasCliValue) {
          const r = withAnnotatedInnerState(
            state,
            state.cliState!,
            (annotatedInnerState) => parser.complete(annotatedInnerState, exec),
            parserInheritsAnnotations,
          );
          if (r instanceof Promise) {
            return (r as Promise<ValueParserResult<TValue>>).then(
              unwrapCompleteResult,
            );
          }
          return Promise.resolve(
            unwrapCompleteResult(r as ValueParserResult<TValue>),
          );
        }

        const isProbe = exec != null && exec.phase !== "complete";
        const annotations = getAnnotations(state);
        const innerInitialState = parser.initialState;
        const shouldInheritInitialStateAnnotations = annotations != null &&
          (innerInitialState == null ||
            typeof innerInitialState === "object" ||
            parserInheritsAnnotations);
        const effectiveInitialState = shouldInheritInitialStateAnnotations
          ? inheritAnnotations(state, innerInitialState)
          : innerInitialState;

        const readPlaceholder = (): TValue | undefined => {
          try {
            return "placeholder" in parser
              ? parser.placeholder as TValue
              : undefined;
          } catch {
            return undefined;
          }
        };

        const finalizePrompt = (): Promise<ValueParserResult<TValue>> => {
          const shouldDefer = withAnnotatedInnerState(
            state,
            effectiveInitialState,
            (annotatedInnerState) =>
              shouldDeferPrompt(parser, annotatedInnerState, exec),
            parserInheritsAnnotations,
          );
          if (shouldDefer) {
            return Promise.resolve(
              deferredPromptResult(readPlaceholder() as TValue),
            );
          }
          if (isProbe) {
            return Promise.resolve({
              success: true as const,
              value: readPlaceholder() as TValue,
            });
          }
          // When this prompt wraps a dependency source, its execution is
          // coordinated through the run-scoped effectful completion
          // session: a cached result (including a cancellation) is reused
          // so the prompt runs at most once per run, and under the
          // demand-only policy of the phase-two seed pass the prompt
          // defers unless a phase-one consumer demands its source.
          const session = exec?.effectfulCompletionSession;
          const sourceId = promptedParser.dependencyMetadata?.source?.sourceId;
          if (session != null && sourceId != null) {
            const cacheKey = completionCacheKeyFor(exec?.path);
            const cached = session.results.get(cacheKey);
            if (cached != null) {
              // A reused answer is still effectful in origin: mark the
              // source so a later prompted occurrence in the same pass
              // can overwrite it (last occurrence wins).
              session.effectfulSources.add(sourceId);
              return Promise.resolve(cached as ValueParserResult<TValue>);
            }
            if (
              session.policy === "demand-only" &&
              !session.demanded.has(sourceId)
            ) {
              return Promise.resolve(
                deferredPromptResult(readPlaceholder() as TValue),
              );
            }
            return executePrompt().then((result) => {
              session.results.set(
                cacheKey,
                result as ValueParserResult<unknown>,
              );
              // Record that this source's value now comes from an
              // effectful completion, so a later prompted occurrence of
              // the same source can still overwrite it (last occurrence
              // wins) while structural values keep their precedence.
              session.effectfulSources.add(sourceId);
              return result;
            });
          }
          return executePrompt();
        };

        const hasDeferHook = typeof parser.shouldDeferCompletion === "function";

        const decideFromParse = (
          parseResult: ParserResult<TState>,
        ): Promise<ValueParserResult<TValue>> => {
          const consumed = parseResult.success
            ? parseResult.consumed.length
            : 0;
          const cliState = parseResult.success && consumed === 0
            ? parseResult.next.state
            : undefined;
          const cliStateIsInjected = cliState != null &&
            typeof cliState === "object" &&
            unwrapInjectedAnnotationState(cliState) !== cliState;
          const isSourceBinding = shouldCompleteFromSourceBinding(
            cliState,
            state,
          );
          if (!isSourceBinding) {
            return finalizePrompt();
          }
          const completeState = parseResult.success
            ? parseResult.next.state
            : effectiveInitialState;
          const innerR = parser.complete(completeState as TState, exec);
          const handleCompleteResult = (
            res: ValueParserResult<TValue>,
          ): Promise<ValueParserResult<TValue>> => {
            const unwrapped = unwrapCompleteResult(res);
            if (
              unwrapped.success &&
              unwrapped.value === undefined &&
              cliStateIsInjected
            ) {
              return finalizePrompt();
            }
            if (!unwrapped.success) {
              return finalizePrompt();
            }
            return Promise.resolve(unwrapped);
          };
          if (innerR instanceof Promise) {
            return (innerR as Promise<ValueParserResult<TValue>>).then(
              handleCompleteResult,
            );
          }
          return handleCompleteResult(innerR as ValueParserResult<TValue>);
        };

        if (hasDeferHook) {
          const innerR = withAnnotatedInnerState(
            state,
            effectiveInitialState,
            (annotatedInnerState) => parser.complete(annotatedInnerState, exec),
            parserInheritsAnnotations,
          );
          const handleDeferHookResult = (
            res: ValueParserResult<TValue>,
          ): Promise<ValueParserResult<TValue>> => {
            const unwrapped = unwrapCompleteResult(res);
            if (unwrapped.success && unwrapped.value === undefined) {
              return finalizePrompt();
            }
            if (!unwrapped.success) {
              return finalizePrompt();
            }
            return Promise.resolve(unwrapped);
          };
          if (innerR instanceof Promise) {
            return (innerR as Promise<ValueParserResult<TValue>>).then(
              handleDeferHookResult,
            );
          }
          return handleDeferHookResult(innerR as ValueParserResult<TValue>);
        }

        const simParseR = withAnnotatedInnerState(
          state,
          effectiveInitialState,
          (annotatedState) =>
            parser.parse({
              buffer: [],
              state: annotatedState,
              optionsTerminated: false,
              usage: parser.usage,
            }),
          parserInheritsAnnotations,
        );
        if (simParseR instanceof Promise) {
          return (simParseR as Promise<ParserResult<TState>>).then(
            decideFromParse,
          );
        }
        return decideFromParse(simParseR as ParserResult<TState>);
      },

      suggest: (context, prefix) => {
        const innerState = isPromptBindState(context.state)
          ? (context.state.cliState === undefined
            ? parser.initialState
            : context.state.cliState as TState)
          : context.state;
        const innerContext = innerState !== context.state
          ? { ...context, state: innerState }
          : context;

        const innerResult = parser.suggest(innerContext, prefix) as
          | Iterable<unknown>
          | AsyncIterable<unknown>;

        return (async function* () {
          yield* innerResult;
        })() as AsyncIterable<never>;
      },

      getDocFragments(state, upperDefaultValue?) {
        const defaultValue = upperDefaultValue ??
          readDefaultValue(adapter, config);
        return parser.getDocFragments(state, defaultValue as TValue);
      },
    };
    defineTraits(promptedParser, {
      inheritsAnnotations: true,
      ...(getTraits(parser).completesFromSource === true
        ? { completesFromSource: true as const }
        : {}),
    });

    if ("placeholder" in parser) {
      Object.defineProperty(promptedParser, "placeholder", {
        get() {
          try {
            return parser.placeholder as TValue;
          } catch {
            return undefined;
          }
        },
        configurable: true,
        enumerable: false,
      });
    }
    if (typeof parser.normalizeValue === "function") {
      Object.defineProperty(promptedParser, "normalizeValue", {
        value: parser.normalizeValue.bind(parser),
        configurable: true,
        enumerable: false,
      });
    }
    const dependencyMetadata = mapSourceMetadata(
      parser,
      (source: ParserSourceMetadata<M, TValue, TState>) => ({
        ...source,
        extractSourceValue: (state: unknown) => {
          if (!isPromptBindState(state)) {
            return source.extractSourceValue(state);
          }
          return source.extractSourceValue(
            state.cliState ?? state,
          );
        },
        // Originate the effectful completion so the scheduler can run
        // the prompt before dependency replay and register its value.
        // The wrapper's own complete() already handles CLI delegation,
        // source-binding delegation, runtime conditions, deferral, and
        // adapter execution, so it is the completion in its entirety.
        //
        // When the wrapped parser transforms the source value (e.g.,
        // prompt() around a mapped source), the prompt's answer lives in
        // the transformed domain and the pre-transform source value is
        // unrecoverable, so no effectful completion is exposed: the
        // prompt keeps running in the ordinary completion phase and
        // never registers a transformed value under the raw source ID.
        completeSource: source.preservesSourceValue === false ? undefined : (
          state: unknown,
          exec?: ExecutionContext,
        ): Promise<ValueParserResult<unknown> | undefined> =>
          promptedParser.complete(state as TState, exec) as Promise<
            ValueParserResult<unknown>
          >,
      }),
    );
    if (dependencyMetadata != null) {
      Object.defineProperty(promptedParser, "dependencyMetadata", {
        value: dependencyMetadata,
        configurable: true,
        enumerable: false,
      });
    }

    return fluent(promptedParser);
  };
}
