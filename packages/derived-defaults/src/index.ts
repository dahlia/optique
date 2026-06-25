/**
 * Derived default support for Optique.
 *
 * @module
 * @since 1.2.0
 */

import type { Message } from "@optique/core/message";
import { message } from "@optique/core/message";
import type { DocFragment } from "@optique/core/doc";
import {
  defineTraits,
  delegateSuggestNodes,
  extractPhase2SeedKey,
  inheritAnnotations,
  injectAnnotations,
  mapModeValue,
  mapSourceMetadata,
  type ParserSourceMetadata,
  withAnnotationView,
  wrapForMode,
} from "@optique/core/extension";
import { fluent, type FluentParser } from "@optique/core/fluent";
import type {
  ExecutionContext,
  Mode,
  ModeValue,
  Parser,
  ParserResult,
  Result,
} from "@optique/core/parser";
import { getAnnotations } from "@optique/core/annotations";
import type {
  Annotations,
  SourceContext,
  SourceContextRequest,
} from "@optique/core/context";
import type { ValueParserResult } from "@optique/core/valueparser";

/**
 * Resolver function for a derived default value.
 *
 * @since 1.2.0
 */
export type DerivedDefaultResolver<TParsed, TValue> = (
  parsed: TParsed,
) => TValue | undefined | Promise<TValue | undefined>;

/**
 * Values produced by a derived-default resolver map.
 *
 * @since 1.2.0
 */
export type DerivedDefaultValues<TResolvers> = {
  readonly [K in keyof TResolvers]: TResolvers[K] extends
    (parsed: infer _TParsed) => infer TValue
    ? Exclude<Awaited<TValue>, undefined>
    : never;
};

/**
 * Keys whose derived default values are assignable to a parser value type.
 *
 * @since 1.2.0
 */
export type DerivedDefaultKey<TValues extends object, TValue> = {
  readonly [K in keyof TValues]: TValues[K] extends TValue ? K : never;
}[keyof TValues];

/**
 * Source context for derived defaults.
 *
 * @since 1.2.0
 */
export interface DerivedDefaultsContext<TValues extends object>
  extends SourceContext {
  readonly phase: "two-pass";
  readonly $values?: TValues;
}

/**
 * Derived-default context bundle.
 *
 * @since 1.2.0
 */
export interface DerivedDefaults<TValues extends object> {
  readonly context: DerivedDefaultsContext<TValues>;
}

/**
 * Options for binding a parser to a derived default value.
 *
 * @since 1.2.0
 */
export interface BindDerivedDefaultOptions<
  TValues extends object,
  TValue,
  TKey extends DerivedDefaultKey<TValues, TValue>,
> {
  readonly context: DerivedDefaultsContext<TValues>;
  readonly key: TKey;
  readonly default?: TValue;
  readonly defaultDescription?: Message;
}

interface DerivedDefaultAnnotationData<TValues extends object> {
  readonly values: TValues;
}

const phase1DerivedDefaultAnnotationMarker = Symbol(
  "@optique/derived-defaults/phase1Annotation",
);

function getTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return value != null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (value as Record<string, unknown>).then === "function";
}

function validateSourceContextRequest(request: unknown): asserts request is
  | undefined
  | SourceContextRequest {
  if (request === undefined) return;
  if (
    request === null ||
    typeof request !== "object" ||
    !("phase" in request) ||
    (request.phase !== "phase1" && request.phase !== "phase2") ||
    (request.phase === "phase2" && !("parsed" in request))
  ) {
    throw new TypeError(
      "Expected getAnnotations() to receive no request or a " +
        'SourceContextRequest ({ phase: "phase1" } or ' +
        `{ phase: "phase2", parsed }), but got: ${getTypeName(request)}.`,
    );
  }
}

function replaceDefaultDescription(
  fragments: readonly DocFragment[],
  description: Message | undefined,
): readonly DocFragment[] {
  if (description == null) return fragments;
  return fragments.map((fragment): DocFragment => {
    if (fragment.type === "entry") {
      return { ...fragment, default: description };
    }
    return {
      ...fragment,
      entries: fragment.entries.map((entry) => ({
        ...entry,
        default: description,
      })),
    };
  });
}

function validateFallbackValue<M extends Mode, TValue>(
  mode: M,
  innerParser: Parser<M, TValue, unknown> | undefined,
  value: TValue,
): ModeValue<M, Result<TValue>> {
  if (
    innerParser == null || typeof innerParser.validateValue !== "function"
  ) {
    return wrapForMode(mode, {
      success: true as const,
      value,
    });
  }
  return wrapForMode(mode, innerParser.validateValue(value));
}

/**
 * Creates a derived-default context.
 *
 * @param resolvers Resolver map keyed by derived value name.
 * @returns A derived-default context bundle.
 * @throws {TypeError} If `resolvers` is not an object or contains a
 * non-function resolver.
 * @since 1.2.0
 */
export function createDerivedDefaults<const TResolvers extends object>(
  resolvers: TResolvers,
): DerivedDefaults<DerivedDefaultValues<TResolvers>> {
  if (resolvers == null || typeof resolvers !== "object") {
    throw new TypeError(
      `Expected resolvers to be an object, but got: ${getTypeName(resolvers)}.`,
    );
  }
  for (const key of Reflect.ownKeys(resolvers)) {
    const resolver = (resolvers as Record<PropertyKey, unknown>)[key];
    if (typeof resolver !== "function") {
      throw new TypeError(
        `Expected resolver ${String(key)} to be a function, but got: ${
          getTypeName(resolver)
        }.`,
      );
    }
  }

  type Values = DerivedDefaultValues<TResolvers>;
  const contextId = Symbol(`@optique/derived-defaults:${Math.random()}`);
  const context: DerivedDefaultsContext<Values> = {
    id: contextId,
    phase: "two-pass",
    getInternalAnnotations(request, annotations) {
      if (request.phase === "phase1") {
        return { [contextId]: phase1DerivedDefaultAnnotationMarker };
      }
      return contextId in annotations ? undefined : { [contextId]: undefined };
    },
    getAnnotations(
      request?: SourceContextRequest,
    ): Annotations | Promise<Annotations> {
      validateSourceContextRequest(request);
      if (request?.phase !== "phase2") return {};

      const values: Record<PropertyKey, unknown> = {};
      const pending: Promise<void>[] = [];
      for (const key of Reflect.ownKeys(resolvers)) {
        const resolver =
          (resolvers as Record<PropertyKey, (parsed: unknown) => unknown>)[
            key
          ];
        // Resolvers that declare a parsed-value parameter depend on a seed.
        // Zero-argument resolvers can still provide global defaults.
        if (request.parsed == null && resolver.length > 0) {
          continue;
        }
        const resolved = resolver(request.parsed ?? undefined);
        if (isPromiseLike(resolved)) {
          pending.push(
            Promise.resolve(resolved).then((value) => {
              if (value !== undefined) values[key] = value;
            }),
          );
        } else if (resolved !== undefined) {
          values[key] = resolved;
        }
      }

      const buildAnnotations = (): Annotations =>
        Reflect.ownKeys(values).length === 0 ? {} : {
          [contextId]: {
            values: values as Values,
          } satisfies DerivedDefaultAnnotationData<Values>,
        };
      return pending.length === 0
        ? buildAnnotations()
        : Promise.all(pending).then(buildAnnotations);
    },
    [Symbol.dispose]() {
      // No-op. Derived-default annotations are detached parse-time snapshots.
    },
  };

  return { context };
}

/**
 * Binds a parser to a derived default value.
 *
 * @param parser Parser that reads the CLI value.
 * @param options Derived default binding options.
 * @returns A parser with derived fallback behavior.
 * @throws {TypeError} If `options.key` is not a property key.
 * @since 1.2.0
 */
export function bindDerivedDefault<
  M extends Mode,
  TValue,
  TState,
  TValues extends object,
  TKey extends DerivedDefaultKey<TValues, TValue>,
>(
  parser: Parser<M, TValue, TState>,
  options: BindDerivedDefaultOptions<TValues, TValue, TKey>,
): FluentParser<M, TValue, TState> {
  const keyType = typeof options.key;
  if (
    keyType !== "string" && keyType !== "number" && keyType !== "symbol"
  ) {
    throw new TypeError(
      `Expected key to be a property key, but got: ${
        getTypeName(options.key)
      }.`,
    );
  }

  const bindStateKey: unique symbol = Symbol(
    "@optique/derived-defaults/bindState",
  );
  type BindState =
    & { readonly [K in typeof bindStateKey]: true }
    & { readonly hasCliValue: boolean; readonly cliState?: TState };

  function isBindState(value: unknown): value is BindState {
    return value != null &&
      typeof value === "object" &&
      bindStateKey in value;
  }

  function shouldDeferCompletion(
    state: unknown,
    exec?: ExecutionContext,
  ): boolean {
    const annotations = getAnnotations(state);
    if (
      annotations?.[options.context.id] === phase1DerivedDefaultAnnotationMarker
    ) {
      return true;
    }
    return parser.shouldDeferCompletion?.(
      getInnerState(state as TState),
      exec,
    ) === true;
  }

  function getInnerState(state: TState): TState {
    if (!isBindState(state)) return state;
    if (state.cliState !== undefined) return state.cliState as TState;
    const initialState = parser.initialState;
    if (initialState != null && typeof initialState !== "object") {
      return initialState;
    }
    const annotated = inheritAnnotations(state, initialState);
    if (
      annotated === initialState &&
      initialState != null &&
      typeof initialState === "object"
    ) {
      const annotations = getAnnotations(state);
      return annotations == null
        ? initialState
        : withAnnotationView(initialState, annotations);
    }
    return annotated;
  }

  function getDerivedValue(state: unknown): TValue | undefined {
    const annotations = getAnnotations(state);
    const annotationValue = annotations?.[options.context.id];
    if (
      annotationValue == null ||
      typeof annotationValue !== "object" ||
      !("values" in annotationValue)
    ) {
      return undefined;
    }
    return (annotationValue as DerivedDefaultAnnotationData<TValues>)
      .values[options.key] as TValue | undefined;
  }

  function hasDerivedFallback(state: TState): boolean {
    if (getDerivedValue(state) !== undefined) return true;
    return options.default !== undefined;
  }

  function getDerivedOrDefault(
    state: unknown,
    mode: M,
    exec: ExecutionContext | undefined,
    innerParser?: Parser<M, TValue, unknown>,
  ): ModeValue<M, Result<TValue>> {
    const annotations = getAnnotations(state);
    const contextId = options.context.id;
    const contextAbsent = annotations != null && !(contextId in annotations);
    const derivedValue = getDerivedValue(state);
    if (derivedValue !== undefined) {
      return validateFallbackValue(mode, innerParser, derivedValue);
    }
    if (options.default !== undefined) {
      return validateFallbackValue(mode, innerParser, options.default);
    }
    if (innerParser?.canSkip?.(getInnerState(state as TState), exec) === true) {
      return mapModeValue(
        mode,
        innerParser.complete(getInnerState(state as TState), exec),
        (result) => {
          if (result.success) return result;
          if (contextAbsent) {
            return {
              success: false as const,
              error:
                message`Derived default value could not be read: the derived default context was not passed to run()'s contexts option.`,
            };
          }
          return {
            success: false as const,
            error: message`Missing required derived default value.`,
          };
        },
      );
    }
    if (contextAbsent) {
      return wrapForMode(mode, {
        success: false as const,
        error:
          message`Derived default value could not be read: the derived default context was not passed to run()'s contexts option.`,
      });
    }
    return wrapForMode(mode, {
      success: false as const,
      error: message`Missing required derived default value.`,
    });
  }

  function getDerivedSourceValue(
    state: unknown,
    innerState: unknown,
    extractInnerSourceValue: (
      state: unknown,
    ) =>
      | ValueParserResult<unknown>
      | Promise<ValueParserResult<unknown> | undefined>
      | undefined,
    innerParser?: Parser<M, TValue, unknown>,
  ):
    | ValueParserResult<unknown>
    | Promise<ValueParserResult<unknown> | undefined>
    | undefined {
    const derivedValue = getDerivedValue(state);
    const validateFallback = (
      parsed: ValueParserResult<TValue>,
    ):
      | ValueParserResult<unknown>
      | Promise<ValueParserResult<unknown>> => {
      if (!parsed.success) return parsed;
      if (
        innerParser == null || typeof innerParser.validateValue !== "function"
      ) {
        return parsed;
      }
      return innerParser.validateValue(parsed.value) as
        | ValueParserResult<unknown>
        | Promise<ValueParserResult<unknown>>;
    };
    if (derivedValue !== undefined) {
      return validateFallback({ success: true as const, value: derivedValue });
    }
    if (options.default !== undefined) {
      return validateFallback({
        success: true as const,
        value: options.default,
      });
    }
    return extractInnerSourceValue(innerState);
  }

  const boundParser: Parser<M, TValue, TState> = {
    mode: parser.mode,
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    usage: options.default !== undefined
      ? [{ type: "optional", terms: parser.usage }]
      : parser.usage,
    leadingNames: parser.leadingNames,
    acceptingAnyToken: parser.acceptingAnyToken,
    initialState: parser.initialState,
    canSkip(state, exec) {
      if (isBindState(state)) {
        if (state.hasCliValue) {
          return parser.canSkip?.(state.cliState!, exec) === true;
        }
        if (hasDerivedFallback(state)) return true;
        return parser.canSkip?.(getInnerState(state), exec) === true;
      }
      if (hasDerivedFallback(state)) return true;
      return parser.canSkip?.(state, exec) === true;
    },
    getSuggestRuntimeNodes(state, path) {
      const innerState = getInnerState(state);
      return delegateSuggestNodes(
        parser,
        boundParser,
        state,
        path,
        innerState,
      );
    },
    parse(context) {
      const annotations = getAnnotations(context.state);
      const innerState = isBindState(context.state)
        ? (context.state.hasCliValue
          ? context.state.cliState as TState
          : parser.initialState)
        : context.state;
      const innerContext = innerState !== context.state
        ? { ...context, state: innerState }
        : context;
      const processResult = (
        result: ParserResult<TState>,
      ): ParserResult<TState> => {
        if (result.success) {
          const cliConsumed = result.consumed.length > 0;
          const nextState = injectAnnotations({
            [bindStateKey]: true as const,
            hasCliValue: cliConsumed,
            cliState: result.next.state,
          }, annotations);
          return {
            success: true,
            ...(result.provisional ? { provisional: true as const } : {}),
            next: { ...result.next, state: nextState as TState },
            consumed: result.consumed,
          };
        }
        if (result.consumed > 0) return result;
        const nextState = injectAnnotations({
          [bindStateKey]: true as const,
          hasCliValue: false,
        }, annotations);
        return {
          success: true,
          next: { ...innerContext, state: nextState as TState },
          consumed: [],
        };
      };
      return mapModeValue(
        parser.mode,
        parser.parse(innerContext),
        processResult,
      );
    },
    complete(state, exec) {
      if (isBindState(state) && state.hasCliValue) {
        return wrapForMode(
          parser.mode,
          parser.complete(state.cliState!, exec),
        );
      }
      return getDerivedOrDefault(state, parser.mode, exec, parser);
    },
    suggest(context, prefix) {
      const innerState = getInnerState(context.state);
      const innerContext = innerState !== context.state
        ? { ...context, state: innerState }
        : context;
      return parser.suggest(innerContext, prefix);
    },
    shouldDeferCompletion,
    getDocFragments(state, upperDefaultValue) {
      const defaultValue = upperDefaultValue ?? options.default;
      const fragments = parser.getDocFragments(state, defaultValue);
      if (
        upperDefaultValue !== undefined || options.defaultDescription == null
      ) {
        return fragments;
      }
      return {
        ...fragments,
        fragments: replaceDefaultDescription(
          fragments.fragments,
          options.defaultDescription,
        ),
      };
    },
  };
  Object.defineProperty(boundParser, extractPhase2SeedKey, {
    value(state: TState, exec?: ExecutionContext) {
      const annotations = getAnnotations(state);
      if (
        annotations?.[options.context.id] !==
          phase1DerivedDefaultAnnotationMarker
      ) {
        const extractInnerPhase2Seed = (parser as typeof parser & {
          readonly [extractPhase2SeedKey]?: (
            state: TState,
            exec?: ExecutionContext,
          ) => ModeValue<M, unknown>;
        })[extractPhase2SeedKey];
        return extractInnerPhase2Seed == null
          ? wrapForMode(parser.mode, null)
          : extractInnerPhase2Seed(getInnerState(state), exec);
      }
      return wrapForMode(parser.mode, {
        value: undefined as TValue,
        deferred: true as const,
      });
    },
    configurable: true,
  });
  defineTraits(boundParser, {
    inheritsAnnotations: true,
    completesFromSource: true,
  });
  if ("placeholder" in parser) {
    Object.defineProperty(boundParser, "placeholder", {
      get() {
        return parser.placeholder;
      },
      configurable: true,
      enumerable: false,
    });
  }
  if (typeof parser.normalizeValue === "function") {
    Object.defineProperty(boundParser, "normalizeValue", {
      value: parser.normalizeValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  if (typeof parser.validateValue === "function") {
    Object.defineProperty(boundParser, "validateValue", {
      value: parser.validateValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  const dependencyMetadata = mapSourceMetadata(
    parser,
    (sourceMetadata: ParserSourceMetadata<M, TValue, TState>) => ({
      ...sourceMetadata,
      getMissingSourceValue: sourceMetadata.preservesSourceValue !== false &&
          options.default !== undefined
        ? () => {
          if (typeof parser.validateValue === "function") {
            return parser.validateValue(options.default!) as
              | ValueParserResult<unknown>
              | Promise<ValueParserResult<unknown>>;
          }
          return { success: true as const, value: options.default };
        }
        : undefined,
      extractSourceValue: (state: unknown) => {
        if (!isBindState(state)) {
          if (sourceMetadata.preservesSourceValue) {
            return getDerivedSourceValue(
              state,
              state,
              sourceMetadata.extractSourceValue,
              parser,
            );
          }
          return sourceMetadata.extractSourceValue(state);
        }
        if (state.hasCliValue) {
          return sourceMetadata.extractSourceValue(state.cliState);
        }
        const fallbackState = state.cliState ?? state;
        if (!sourceMetadata.preservesSourceValue) {
          return sourceMetadata.extractSourceValue(fallbackState);
        }
        return getDerivedSourceValue(
          state,
          fallbackState,
          sourceMetadata.extractSourceValue,
          parser,
        );
      },
    }),
  );
  if (dependencyMetadata != null) {
    Object.defineProperty(boundParser, "dependencyMetadata", {
      value: dependencyMetadata,
      configurable: true,
      enumerable: false,
    });
  }
  return fluent(boundParser);
}
