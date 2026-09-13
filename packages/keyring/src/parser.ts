import { getAnnotations } from "@optique/core/annotations";
import {
  defineForwardedEffectfulSchedulingNodes,
  type EffectfulSchedulingNodesFn,
  effectfulSchedulingNodesKey,
  type RuntimeNode,
  serializeSchedulingPath,
} from "@optique/core/dependency-runtime";
import {
  defineTraits,
  delegateSuggestNodes,
  getTraits,
  injectAnnotations,
  mapSourceMetadata,
  type ParserSourceMetadata,
} from "@optique/core/extension";
import { fluent, type FluentParser } from "@optique/core/fluent";
import { message } from "@optique/core/message";
import type {
  ExecutionContext,
  Mode,
  Parser,
  ParserResult,
} from "@optique/core/parser";
import type { ValueParserResult } from "@optique/core/valueparser";
import type { KeyringContext, KeyringSource } from "./context.ts";
import { createRunLookup, withAnnotatedInnerState } from "./internal.ts";

const stateKey: unique symbol = Symbol("@optique/keyring/bindState");

interface BindState<TState> {
  readonly [stateKey]: symbol;
  readonly hasCliValue: boolean;
  readonly cliState: TState;
}

interface PreparedInner {
  readonly [stateKey]: symbol;
  readonly result: ValueParserResult<string>;
}

/**
 * Options for binding a string parser to an OS credential-store password.
 *
 * @since 1.3.0
 */
export interface BindKeyringOptions {
  /** Registered keyring context that supplies the password source. */
  readonly context: KeyringContext;

  /** Service name forwarded to the password source. */
  readonly service: string;

  /** Username forwarded to the password source. */
  readonly username: string;
}

function getTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isSourceData(
  value: unknown,
): value is { readonly source: KeyringSource } {
  return value != null && typeof value === "object" &&
    "source" in value && typeof value.source === "function";
}

/**
 * Adds an asynchronous keyring fallback to a string parser.
 *
 * Values resolve in CLI, keyring, then inner-parser fallback order. The
 * credential store is read only during demanded completion, and one lookup is
 * shared by the same wrapper occurrence across all passes of a run.
 * Stored-password validation failures use a generic message to keep the
 * credential out of error output.
 *
 * @param parser String parser whose CLI behavior and fallback are preserved.
 * @param options Keyring context and lookup identity.
 * @returns An always-async fluent parser with keyring fallback behavior.
 * @throws {TypeError} If `service` or `username` is not a string, or if stored
 * password validation throws. Validation exceptions are replaced with a
 * generic error without the original message or cause.
 * @throws Propagates password-source and inner completion errors unchanged.
 * @since 1.3.0
 */
export function bindKeyring<M extends Mode, TState>(
  parser: Parser<M, string, TState>,
  options: BindKeyringOptions,
): FluentParser<"async", string, BindState<TState>> {
  if (typeof options.service !== "string") {
    throw new TypeError(
      `Expected service to be a string, but got: ${
        getTypeName(options.service)
      }.`,
    );
  }
  if (typeof options.username !== "string") {
    throw new TypeError(
      `Expected username to be a string, but got: ${
        getTypeName(options.username)
      }.`,
    );
  }

  const stateId = Symbol("@optique/keyring/binding");
  const isBindState = (value: unknown): value is BindState<TState> =>
    value != null && typeof value === "object" &&
    stateKey in value && value[stateKey] === stateId;

  const parserInheritsAnnotations =
    getTraits(parser).inheritsAnnotations === true;
  const lookupOnce = createRunLookup<string | undefined>();

  // Optional/default wrappers can retry completion with an unwrapped missing
  // state. In that case, delegate using the inner parser's initial state.
  const innerState = (state: unknown): TState =>
    isBindState(state) ? state.cliState : parser.initialState;

  const withInnerState = <TResult>(
    state: unknown,
    run: (state: TState) => TResult,
  ): TResult =>
    withAnnotatedInnerState(
      state,
      innerState(state),
      run,
      parserInheritsAnnotations,
    );

  const innerNodes = (
    state: unknown,
    path: readonly PropertyKey[] = [],
  ): readonly RuntimeNode[] =>
    withInnerState(
      state,
      (annotatedState) =>
        parser.getSuggestRuntimeNodes?.(annotatedState, path) ?? [],
    );

  const isInnerDemanded = (state: unknown, exec?: ExecutionContext): boolean =>
    innerNodes(state, exec?.path).some((node) => {
      const id = node.parser.dependencyMetadata?.source?.sourceId;
      return id != null &&
        exec?.effectfulCompletionSession?.demanded.has(id) === true;
    });

  const preparedKey = (path: readonly PropertyKey[] = []): string =>
    serializeSchedulingPath([stateId, ...path]);

  const isPreparedInner = (value: unknown): value is PreparedInner =>
    value != null && typeof value === "object" &&
    stateKey in value && value[stateKey] === stateId;

  const completeInner = (
    state: BindState<TState>,
    exec?: ExecutionContext,
  ): Promise<ValueParserResult<string>> => {
    const prepared = exec?.effectfulCompletionSession?.preparedByPath.get(
      preparedKey(exec.path),
    );
    if (isPreparedInner(prepared)) return Promise.resolve(prepared.result);

    return Promise.resolve(withInnerState(
      state,
      (annotatedState) => parser.complete(annotatedState, exec),
    ));
  };

  const boundParser: Parser<"async", string, BindState<TState>> & {
    readonly [effectfulSchedulingNodesKey]?: EffectfulSchedulingNodesFn;
  } = {
    mode: "async",
    $valueType: parser.$valueType,
    $stateType: [],
    priority: parser.priority,
    usage: parser.usage,
    leadingNames: parser.leadingNames,
    acceptingAnyToken: parser.acceptingAnyToken,
    initialState: {
      [stateKey]: stateId,
      hasCliValue: false,
      cliState: parser.initialState,
    },

    canSkip(state, exec) {
      if (
        !(isBindState(state) && state.hasCliValue) &&
        isSourceData(getAnnotations(state)?.[options.context.id])
      ) {
        return true;
      }

      return withInnerState(
        state,
        (annotatedState) => parser.canSkip?.(annotatedState, exec) === true,
      );
    },

    getSuggestRuntimeNodes(state, path) {
      return delegateSuggestNodes(
        parser,
        boundParser,
        state,
        path,
        innerState(state),
        "prepend",
      );
    },

    async parse(context): Promise<ParserResult<BindState<TState>>> {
      const annotations = getAnnotations(context.state);
      const state = innerState(context.state);

      const result = await withInnerState(
        context.state,
        (annotatedState) => parser.parse({ ...context, state: annotatedState }),
      );
      if (!result.success && result.consumed > 0) return result;

      const consumedOnlyTerminator = result.success &&
        !context.optionsTerminated && result.next.optionsTerminated &&
        result.consumed.length === 1 && result.consumed[0] === "--";
      const nextState = injectAnnotations({
        [stateKey]: stateId,
        hasCliValue:
          (isBindState(context.state) && context.state.hasCliValue) ||
          (result.success && result.consumed.length > 0 &&
            !consumedOnlyTerminator),
        cliState: result.success ? result.next.state : state,
      }, annotations);

      return {
        success: true,
        ...(result.success && result.provisional
          ? { provisional: true as const }
          : {}),
        next: {
          ...(result.success ? result.next : context),
          state: nextState,
        },
        consumed: result.success ? result.consumed : [],
      };
    },

    async complete(state, exec): Promise<ValueParserResult<string>> {
      if (isBindState(state) && state.hasCliValue) {
        return await completeInner(state, exec);
      }

      const annotations = getAnnotations(state);
      const sourceData = annotations?.[options.context.id];
      if (exec != null && exec.phase !== "complete") {
        if (isSourceData(sourceData)) {
          return { success: true, value: "", deferred: true };
        }
        return await completeInner(state, exec);
      }

      if (!isSourceData(sourceData)) {
        const innerResult = await completeInner(state, exec);
        return annotations != null && !innerResult.success
          ? {
            success: false,
            error:
              message`Keyring password could not be read: the keyring context was not passed to run()'s contexts option.`,
          }
          : innerResult;
      }

      const session = exec?.effectfulCompletionSession;
      const sourceId = boundParser.dependencyMetadata?.source?.sourceId;

      // The seed pass only needs credentials demanded by dependencies.
      // A construct wrapper can also guard sources demanded by siblings.
      if (
        session?.policy === "demand-only" &&
        (sourceId == null
          ? !isInnerDemanded(state, exec)
          : !session.demanded.has(sourceId))
      ) {
        return { success: true, value: "", deferred: true };
      }

      const value = await lookupOnce(
        session?.results,
        exec?.path,
        () => sourceData.source(options.service, options.username),
      );
      if (value === undefined) return await completeInner(state, exec);

      let result: ValueParserResult<string>;
      try {
        result = typeof parser.validateValue === "function"
          ? await parser.validateValue(value)
          : { success: true, value };
      } catch {
        // Validators can include the password (or a transformed version of it)
        // in an exception. Do not retain its message or cause.
        throw new TypeError(
          "The password from the keyring could not be validated.",
        );
      }
      if (!result.success) {
        return {
          success: false,
          error: message`The password from the keyring failed validation.`,
        };
      }

      if (sourceId != null) {
        session?.effectfulSources.add(sourceId);
      }

      return result;
    },

    async *suggest(context, prefix) {
      const suggestions = withInnerState(
        context.state,
        (annotatedState) =>
          parser.suggest({ ...context, state: annotatedState }, prefix),
      );
      yield* suggestions;
    },

    getDocFragments(state, upperDefaultValue) {
      if (state.kind === "unavailable") {
        return parser.getDocFragments(state, upperDefaultValue);
      }

      return withInnerState(
        state.state,
        (annotatedState) =>
          parser.getDocFragments(
            { kind: "available", state: annotatedState },
            upperDefaultValue,
          ),
      );
    },

    ...(typeof parser.shouldDeferCompletion === "function"
      ? {
        shouldDeferCompletion: (
          state: BindState<TState>,
          exec?: ExecutionContext,
        ) =>
          withInnerState(
            state,
            (annotatedState) =>
              parser.shouldDeferCompletion?.(annotatedState, exec) === true,
          ),
      }
      : {}),
  };

  defineTraits(boundParser, {
    inheritsAnnotations: true,
    completesFromSource: true,
  });

  if ("placeholder" in parser) {
    Object.defineProperty(boundParser, "placeholder", {
      get: () => parser.placeholder,
      configurable: true,
      enumerable: false,
    });
  }

  for (const hook of ["normalizeValue", "validateValue"] as const) {
    if (typeof parser[hook] === "function") {
      Object.defineProperty(boundParser, hook, {
        value: parser[hook].bind(parser),
        configurable: true,
        enumerable: false,
      });
    }
  }

  const dependencyMetadata = mapSourceMetadata(
    parser,
    (source: ParserSourceMetadata<M, string, TState>) => ({
      ...source,
      extractSourceValue: (state: unknown) => {
        // Inner source extraction may read a lower-priority fallback, such
        // as bindEnv(). Leave missing CLI values to completion so the
        // keyring is tried before that fallback, including during seed passes.
        if (
          !(isBindState(state) && state.hasCliValue) &&
          isSourceData(getAnnotations(state)?.[options.context.id])
        ) {
          return undefined;
        }

        return source.extractSourceValue(
          isBindState(state) ? state.cliState : state,
        );
      },
      completeSource: source.preservesSourceValue === false
        ? undefined
        : async (state: unknown, exec?: ExecutionContext) =>
          await boundParser.complete(
            isBindState(state) ? state : injectAnnotations(
              boundParser.initialState,
              getAnnotations(state),
            ),
            exec,
          ),
    }),
  );
  if (dependencyMetadata != null) {
    Object.defineProperty(boundParser, "dependencyMetadata", {
      value: dependencyMetadata,
      configurable: true,
      enumerable: false,
    });
  }

  defineForwardedEffectfulSchedulingNodes(
    boundParser,
    parser,
    (state) => withInnerState(state, (annotatedState) => annotatedState),
  );
  const schedulingNodes = boundParser[effectfulSchedulingNodesKey];
  if (schedulingNodes != null) {
    Object.defineProperty(boundParser, effectfulSchedulingNodesKey, {
      value: ((state, path) => {
        const sourceData = getAnnotations(state)?.[options.context.id];
        if (
          (isBindState(state) && state.hasCliValue) ||
          !isSourceData(sourceData)
        ) {
          return schedulingNodes(state, path);
        }

        // Keep inner effects behind the outer lookup, but prepare a missing
        // fallback before the parent replays sibling dependency consumers.
        // Suggestion nodes describe the active sources without completing them;
        // completion itself stays with the inner parser and its own scheduler.
        const nodes = innerNodes(state, path);
        const providesSourceIds = new Set<symbol>();
        const dependencyIds = new Set<symbol>();

        for (const node of nodes) {
          const metadata = node.parser.dependencyMetadata;
          if (metadata?.source != null) {
            providesSourceIds.add(metadata.source.sourceId);
          }

          for (const id of metadata?.completion?.dependencyIds ?? []) {
            dependencyIds.add(id);
          }
        }
        if (providesSourceIds.size === 0) return [];

        return [{
          path: path ?? [],
          parser: {},
          state,
          providesSourceIds,
          barrierCompletionDependencies: {
            orderingDependencyIds: [...dependencyIds].filter((id) =>
              !providesSourceIds.has(id)
            ),
            demandEdges: [],
          },
          prepare: async ({ exec, runtime }) => {
            if (exec == null) return;
            if (
              exec.effectfulCompletionSession?.policy === "demand-only" &&
              !isInnerDemanded(state, exec)
            ) return;

            const value = await lookupOnce(
              exec.effectfulCompletionSession?.results,
              path,
              () => sourceData.source(options.service, options.username),
            );
            if (value !== undefined) return;

            const result = await completeInner(
              isBindState(state) ? state : injectAnnotations(
                boundParser.initialState,
                getAnnotations(state),
              ),
              {
                ...exec,
                path: path ?? [],
                dependencyRuntime: runtime,
                dependencyRegistry: runtime.registry,
              },
            );
            if (!result.success || !result.deferred) {
              exec.effectfulCompletionSession?.preparedByPath.set(
                preparedKey(path),
                { [stateKey]: stateId, result } satisfies PreparedInner,
              );
            }

            return result.success ? undefined : result;
          },
        }];
      }) satisfies EffectfulSchedulingNodesFn,
      configurable: true,
      enumerable: false,
    });
  }

  return fluent(boundParser);
}
