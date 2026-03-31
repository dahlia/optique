import {
  cloneDocEntry,
  type DocEntry,
  type DocFragments,
  type DocPage,
  type DocSection,
  isDocEntryHidden,
} from "./doc.ts";
import { cloneMessage, type Message, message } from "./message.ts";
import type { DependencyRegistryLike } from "./registry-types.ts";
import {
  cloneUsage,
  normalizeUsage,
  type Usage,
  type UsageTerm,
} from "./usage.ts";
import type { DeferredMap, ValueParserResult } from "./valueparser.ts";
import {
  injectAnnotations,
  isInjectedAnnotationWrapper,
  type ParseOptions,
  unwrapInjectedAnnotationWrapper,
} from "./annotations.ts";
import { dispatchByMode } from "./mode-dispatch.ts";
import type { ParserDependencyMetadata } from "./dependency-metadata.ts";
import {
  collectExplicitSourceValues,
  collectExplicitSourceValuesAsync,
  createDependencyRuntimeContext,
  type DependencyRuntimeContext,
} from "./dependency-runtime.ts";
import { createInputTrace, type InputTrace } from "./input-trace.ts";

export type { ParseOptions };

/**
 * Represents the execution mode for parsers.
 *
 * - `"sync"`: Synchronous execution where methods return values directly.
 * - `"async"`: Asynchronous execution where methods return Promises or
 *   AsyncIterables.
 *
 * @since 0.9.0
 */
export type Mode = "sync" | "async";

/**
 * Wraps a value type based on the execution mode.
 *
 * - In sync mode: Returns `T` directly.
 * - In async mode: Returns `Promise<T>`.
 *
 * @template M The execution mode.
 * @template T The value type to wrap.
 * @since 0.9.0
 */
export type ModeValue<M extends Mode, T> = M extends "async" ? Promise<T> : T;

/**
 * Wraps an iterable type based on the execution mode.
 *
 * - In sync mode: Returns `Iterable<T>`.
 * - In async mode: Returns `AsyncIterable<T>`.
 *
 * @template M The execution mode.
 * @template T The element type.
 * @since 0.9.0
 */
export type ModeIterable<M extends Mode, T> = M extends "async"
  ? AsyncIterable<T>
  : Iterable<T>;

/**
 * Combines multiple modes into a single mode.
 * If any mode is `"async"`, the result is `"async"`; otherwise `"sync"`.
 *
 * @template T A tuple of Mode types.
 * @since 0.9.0
 */
export type CombineModes<T extends readonly Mode[]> = "async" extends T[number]
  ? "async"
  : "sync";

/**
 * Represents the state passed to getDocFragments.
 * Can be either the actual parser state or an explicit indicator
 * that no state is available.
 * @template TState The type of the actual state when available.
 * @since 0.3.0
 */
export type DocState<TState> =
  | { readonly kind: "available"; readonly state: TState }
  | { readonly kind: "unavailable" };

/**
 * Parser interface for command-line argument parsing.
 * @template M The execution mode of the parser (`"sync"` or `"async"`).
 * @template TValue The type of the value returned by the parser.
 * @template TState The type of the state used during parsing.
 * @since 0.9.0 Added the `M` type parameter for sync/async mode support.
 */
export interface Parser<
  M extends Mode = "sync",
  TValue = unknown,
  TState = unknown,
> {
  /**
   * A type tag for the result value of this parser, used for type inference.
   * Usually this is an empty array at runtime, but it does not matter
   * what it contains.
   * @internal
   */
  readonly $valueType: readonly TValue[];

  /**
   * A type tag for the state of this parser, used for type inference.
   * Usually this is an empty array at runtime, but it does not matter
   * what it contains.
   * @internal
   */
  readonly $stateType: readonly TState[];

  /**
   * The execution mode of this parser.
   *
   * - `"sync"`: All methods return values directly.
   * - `"async"`: Methods return Promises or AsyncIterables.
   *
   * @since 0.9.0
   */
  readonly $mode: M;

  /**
   * The priority of this parser, which determines the order in which
   * parsers are applied when multiple parsers are available.  The greater
   * the number, the higher the priority.
   */
  readonly priority: number;

  /**
   * The usage information for this parser, which describes how
   * to use it in command-line interfaces.
   */
  readonly usage: Usage;

  /**
   * Names that this parser could match at the first buffer position.
   * Used by `runParser()` to detect collisions with built-in meta
   * features (help, version, completion).
   *
   * Each built-in combinator computes this from its structural semantics.
   * Custom parser implementations must include every fixed token that
   * the parser accepts at `argv[0]` — command names, option names, and
   * literal values alike.  For example, a parser whose usage declares
   * `{ type: "literal", value: "serve" }` should include `"serve"` in
   * this set.  Parsers that accept *any* token (like `argument()`) should
   * return an empty set and set {@link acceptingAnyToken} to `true`
   * instead.
   *
   * @since 1.0.0
   */
  readonly leadingNames: ReadonlySet<string>;

  /**
   * Whether this parser unconditionally consumes any positional token at
   * the first buffer position.  A parser with this flag accepts any
   * non-option token but may still reject option-like tokens (those
   * starting with `"-"`).
   *
   * In shared-buffer compositions (`tuple()`, `object()`, `merge()`,
   * `concat()`), a catch-all parser blocks positional names (command
   * names) from lower-priority siblings but does not block option-like
   * names.  In `conditional()`, option-like names from the default
   * branch remain reachable even when the discriminator is a catch-all.
   *
   * Only `argument()` is inherently accepting-any-token; combinators
   * like `or()` and `map()` propagate this from their children.
   * Wrappers that can succeed without consuming (`optional()`,
   * `withDefault()`, `multiple()` with `min = 0`) always set this
   * to `false`.
   *
   * @since 1.0.0
   */
  readonly acceptingAnyToken: boolean;

  /**
   * The initial state for this parser.  This is used to initialize the
   * state when parsing starts.
   */
  readonly initialState: TState;

  /**
   * Internal marker for wrappers whose `{ hasCliValue: false }` states should
   * be treated as unmatched dependency-source states during completion-time
   * Phase 1.
   *
   * @internal
   * @since 1.0.0
   */
  readonly [unmatchedNonCliDependencySourceStateMarker]?: true;

  /**
   * Parses the input context and returns a result indicating
   * whether the parsing was successful or not.
   * @param context The context of the parser, which includes the input buffer
   *                and the current state.
   * @returns A result object indicating success or failure.
   *          In async mode, returns a Promise that resolves to the result.
   */
  parse(context: ParserContext<TState>): ModeValue<M, ParserResult<TState>>;

  /**
   * Transforms a {@link TState} into a {@link TValue}, if applicable.
   * If the transformation is not applicable, it should return
   * a `ValueParserResult` with `success: false` and an appropriate error
   * message.
   * @param state The current state of the parser, which may contain accumulated
   *              data or context needed to produce the final value.
   * @param exec Optional shared execution context.  When provided, gives the
   *             parser access to cross-cutting runtime data such as the current
   *             execution phase and dependency registry.
   * @returns A result object indicating success or failure of
   *          the transformation.  If successful, it should contain
   *          the parsed value of type {@link TValue}.  If not applicable,
   *          it should return an error message.
   *          In async mode, returns a Promise that resolves to the result.
   * @since 1.0.0 Added optional `exec` parameter.
   */
  complete(
    state: TState,
    exec?: ExecutionContext,
  ): ModeValue<M, ValueParserResult<TValue>>;

  /**
   * Generates next-step suggestions based on the current context
   * and an optional prefix.  This can be used to provide shell completion
   * suggestions or to guide users in constructing valid commands.
   * @param context The context of the parser, which includes the input buffer
   *                and the current state.
   * @param prefix A prefix string that can be used to filter suggestions.
   *               Can be an empty string if no prefix is provided.
   * @returns An iterable of {@link Suggestion} objects, each containing
   *          a suggestion text and an optional description.
   *          In async mode, returns an AsyncIterable.
   * @since 0.6.0
   */
  suggest(
    context: ParserContext<TState>,
    prefix: string,
  ): ModeIterable<M, Suggestion>;

  /**
   * Generates a documentation fragment for this parser, which can be used
   * to describe the parser's usage, description, and default value.
   * @param state The current state of the parser, wrapped in a DocState
   *              to indicate whether the actual state is available or not.
   * @param defaultValue An optional default value that can be used
   *                     to provide a default value in the documentation.
   * @returns {@link DocFragments} object containing documentation
   *          fragments for this parser.
   */
  getDocFragments(state: DocState<TState>, defaultValue?: TValue): DocFragments;

  /**
   * A type-appropriate default value used as a stand-in during deferred
   * prompt resolution.  When present, combinators like `prompt()` use this
   * value instead of an internal sentinel during two-phase parsing, so that
   * `map()` transforms and dynamic contexts always receive a valid value
   * of type {@link TValue}.
   *
   * This property is set automatically by `option()` and `argument()` from
   * the underlying {@link ValueParser}'s `placeholder`, and propagated by
   * combinators like `map()`, `optional()`, and `withDefault()`.
   *
   * @since 1.0.0
   */
  readonly placeholder?: TValue;

  /**
   * Optional predicate that determines whether completion should be
   * deferred for the given parser state.
   *
   * When present, combinator wrappers ({@link optional}, {@link withDefault},
   * {@link group}) forward this field to the outer parser.  This enables
   * packages like *\@optique/inquirer* to detect when interactive prompting
   * should be deferred until an outer context (like a configuration file
   * source) has resolved.
   *
   * @param state The current parser state.
   * @param exec Optional shared execution context.
   * @returns `true` if completion should be deferred.
   * @since 1.0.0
   * @since 1.0.0 Added optional `exec` parameter.
   */
  shouldDeferCompletion?(state: TState, exec?: ExecutionContext): boolean;

  /**
   * Normalizes a parsed value according to the underlying value parser's
   * configuration.  When present, {@link withDefault} calls this method
   * on default values so that runtime defaults match the representation
   * that the value parser's `parse()` would produce.
   *
   * Primitive parsers ({@link option}, {@link argument}) implement this
   * by delegating to {@link ValueParser.normalize}.  Combinator wrappers
   * ({@link optional}, {@link withDefault}) forward it from inner parsers.
   *
   * Exclusive combinators ({@link or}, `longestMatch()`) and
   * multi-source combinators (`merge()`) intentionally do *not*
   * implement this method because the active branch or key ownership
   * is unknown at default time.
   *
   * @param value The value to normalize.
   * @returns The normalized value.
   * @since 1.0.0
   */
  normalizeValue?(value: TValue): TValue;

  /**
   * Internal dependency metadata describing this parser's dependency
   * capabilities.  Used by the dependency runtime to resolve dependencies
   * without relying on state-shape protocols.
   * @internal
   * @since 1.0.0
   */
  readonly dependencyMetadata?: ParserDependencyMetadata;
}

/**
 * Parser-local frame data containing the input buffer and parser state.
 * This represents the per-parser progress during parsing, separated from
 * cross-cutting execution context.
 * @template TState The type of the state used during parsing.
 * @since 1.0.0
 */
export interface ParseFrame<TState> {
  /**
   * The array of input strings that the parser is currently processing.
   */
  readonly buffer: readonly string[];

  /**
   * The current state of the parser, which is used to track
   * the progress of parsing and any accumulated data.
   */
  readonly state: TState;

  /**
   * A flag indicating whether no more options should be parsed and instead
   * the remaining input should be treated as positional arguments.
   */
  readonly optionsTerminated: boolean;
}

/**
 * The phase of the execution pipeline.
 * @since 1.0.0
 */
export type ExecutionPhase =
  | "parse"
  | "precomplete"
  | "resolve"
  | "complete"
  | "suggest";

/**
 * Shared execution context carrying cross-cutting runtime data.
 * This includes information that is shared across all parsers in a parse
 * tree, such as usage information, dependency registries, and the current
 * execution phase.
 * @since 1.0.0
 */
export interface ExecutionContext {
  /**
   * Usage information for the entire parser tree.
   */
  readonly usage: Usage;

  /**
   * The current phase of the execution pipeline.
   */
  readonly phase: ExecutionPhase;

  /**
   * The path from the root to the current parser in the parse tree.
   * Used by constructs to track the current position during dependency
   * resolution and completion.
   */
  readonly path: readonly PropertyKey[];

  /**
   * Immutable trace of raw primitive inputs recorded during parsing.
   *
   * Primitives append trace entries keyed by {@link path}, allowing later
   * completion phases to replay derived parsers with the resolved
   * dependency values.
   *
   * @internal
   * @since 1.0.0
   */
  readonly trace?: InputTrace;

  /**
   * A registry containing resolved dependency values from DependencySource
   * parsers.
   * @since 0.10.0
   */
  readonly dependencyRegistry?: DependencyRegistryLike;

  /**
   * The dependency runtime context for dependency resolution.
   * Coexists with `dependencyRegistry` during the transition period.
   * @internal
   * @since 1.0.0
   */
  readonly dependencyRuntime?: DependencyRuntimeContext;

  /**
   * Immutable map of pre-completed results from the parent construct's
   * Phase 1, keyed by field name.  Each construct passes its own
   * `preCompleteAndRegisterDependencies` results directly to children
   * in Phase 3.  Children read it in their own Phase 1 to avoid
   * re-evaluating non-idempotent default thunks, but never write to
   * it — this prevents sibling completions from leaking into each
   * other.
   *
   * Field-name keying naturally handles parser reuse across different
   * fields (e.g., `merge(object({a: shared}), object({b: shared}))`)
   * because each field maps to its own result regardless of whether
   * the underlying parser instance is the same.
   *
   * @see https://github.com/dahlia/optique/issues/762
   * @internal
   * @since 1.0.0
   */
  readonly preCompletedByParser?: ReadonlyMap<string | symbol, unknown>;

  /**
   * Field names that should be ignored when a construct seeds dependency
   * sources from child state during completion.
   *
   * Used by outer `merge()` completions to suppress ambiguous duplicate
   * keys while still allowing the child parser to finish its own value
   * completion.
   *
   * @internal
   */
  readonly excludedSourceFields?: ReadonlySet<string | symbol>;
}

/**
 * Internal marker for wrappers whose `{ hasCliValue: false }` states should
 * be treated as unmatched dependency-source states during completion-time
 * Phase 1.
 *
 * Wrappers like `bindEnv()` and `bindConfig()` opt in because their missing
 * CLI states still carry enough fallback context to pre-complete exactly
 * once. Wrappers like `prompt()` intentionally do not opt in because
 * prompted values are not yet registered as dependency sources.
 *
 * @internal
 * @since 1.0.0
 */
export const unmatchedNonCliDependencySourceStateMarker: unique symbol = Symbol
  .for(
    "@optique/core/parser/unmatchedNonCliDependencySourceStateMarker",
  );

/**
 * The context of the parser, which includes the input buffer and the state.
 *
 * `ParserContext` provides structured access to shared execution context
 * via {@link exec}, and flat access to all fields for backward
 * compatibility.
 *
 * @template TState The type of the state used during parsing.
 */
export interface ParserContext<TState> {
  /**
   * Shared execution context (usage, phase, path, dependencyRegistry).
   *
   * Present when the context was created via {@link createParserContext}.
   * Later runtime work will make this field required.
   *
   * @since 1.0.0
   */
  readonly exec?: ExecutionContext;

  /**
   * The array of input strings that the parser is currently processing.
   */
  readonly buffer: readonly string[];

  /**
   * The current state of the parser, which is used to track
   * the progress of parsing and any accumulated data.
   */
  readonly state: TState;

  /**
   * A flag indicating whether no more options should be parsed and instead
   * the remaining input should be treated as positional arguments.
   * This is typically set when the parser encounters a `--` in the input,
   * which is a common convention in command-line interfaces to indicate
   * that no further options should be processed.
   */
  readonly optionsTerminated: boolean;

  /**
   * Usage information for the entire parser tree.
   * Used to provide better error messages with suggestions for typos.
   * When a parser encounters an invalid option or command, it can use
   * this information to suggest similar valid options.
   * @since 0.7.0
   */
  readonly usage: Usage;

  /**
   * A registry containing resolved dependency values from DependencySource parsers.
   * This is used during shell completion to provide suggestions based on
   * the actual dependency values that have been parsed, rather than defaults.
   * @since 0.10.0
   */
  readonly dependencyRegistry?: DependencyRegistryLike;
}

/**
 * Creates a {@link ParserContext} from a {@link ParseFrame} and an
 * {@link ExecutionContext}.  The returned object provides both structured
 * access (`frame`, `exec`) and flat access (`buffer`, `state`, etc.)
 * for backward compatibility.
 *
 * @template TState The type of the state used during parsing.
 * @param frame Parser-local frame data.
 * @param exec Shared execution context.
 * @returns A {@link ParserContext} instance.
 * @since 1.0.0
 */
export function createParserContext<TState>(
  frame: ParseFrame<TState>,
  exec: ExecutionContext,
): ParserContext<TState> {
  return {
    exec,
    buffer: frame.buffer,
    state: frame.state,
    optionsTerminated: frame.optionsTerminated,
    usage: exec.usage,
    dependencyRegistry: exec.dependencyRegistry,
  };
}

/**
 * Represents a suggestion for command-line completion or guidance.
 * @since 0.6.0
 */
export type Suggestion =
  | {
    /**
     * A literal text suggestion.
     */
    readonly kind: "literal";
    /**
     * The suggestion text that can be used for completion or guidance.
     */
    readonly text: string;
    /**
     * An optional description providing additional context
     * or information about the suggestion.
     */
    readonly description?: Message;
  }
  | {
    /**
     * A file system completion suggestion that uses native shell completion.
     */
    readonly kind: "file";
    /**
     * The current prefix/pattern for fallback when native completion is unavailable.
     */
    readonly pattern?: string;
    /**
     * The type of file system entries to complete.
     */
    readonly type: "file" | "directory" | "any";
    /**
     * File extensions to filter by (e.g., [".ts", ".js"]).
     */
    readonly extensions?: readonly string[];
    /**
     * Whether to include hidden files (those starting with a dot).
     */
    readonly includeHidden?: boolean;
    /**
     * An optional description providing additional context
     * or information about the suggestion.
     */
    readonly description?: Message;
  };

/**
 * A discriminated union type representing the result of a parser operation.
 * It can either indicate a successful parse with the next state and context,
 * or a failure with an error message.
 * @template TState The type of the state after parsing.  It should match with
 *           the `TState` type of the {@link Parser} interface.
 */
export type ParserResult<TState> =
  | {
    /**
     * Indicates that the parsing operation was successful.
     */
    readonly success: true;

    /**
     * The next context after parsing, which includes the updated input buffer.
     */
    readonly next: ParserContext<TState>;

    /**
     * The input elements consumed by the parser during this operation.
     */
    readonly consumed: readonly string[];
  }
  | {
    /**
     * Indicates that the parsing operation failed.
     */
    readonly success: false;

    /**
     * The number of the consumed input elements.
     */
    readonly consumed: number;

    /**
     * The error message describing why the parsing failed.
     */
    readonly error: Message;
  };

/**
 * Infers the result value type of a {@link Parser}.
 * @template T The {@link Parser} to infer the result value type from.
 */
export type InferValue<T extends Parser<Mode, unknown, unknown>> =
  T["$valueType"][number];

/**
 * Infers the execution mode of a {@link Parser}.
 * @template T The {@link Parser} to infer the execution mode from.
 * @since 0.9.0
 */
export type InferMode<T extends Parser<Mode, unknown, unknown>> = T["$mode"];

/**
 * The result type of a whole parser operation, which can either be a successful
 * result with a value of type `T`, or a failure with an error message.
 * @template T The type of the value produced by the parser.
 */
export type Result<T> =
  | {
    /**
     * Indicates that the parsing operation was successful.
     */
    success: true;
    /**
     * The successfully parsed value of type {@link T}.
     * This is the final result of the parsing operation after all parsers
     * have been applied and completed.
     */
    value: T;
    /**
     * When `true`, indicates that the value contains deferred prompt
     * placeholders.  Propagated from {@link ValueParserResult.deferred}.
     * @since 1.0.0
     */
    deferred?: true;
    /**
     * Property keys (object field names or array indices) whose values are
     * deferred placeholders.
     * Propagated from {@link ValueParserResult.deferredKeys}.
     * @since 1.0.0
     */
    deferredKeys?: DeferredMap;
  }
  | {
    /**
     * Indicates that the parsing operation failed.
     */
    success: false;
    /**
     * The error message describing why the parsing failed.
     */
    error: Message;
  };

function injectAnnotationsIntoState<TState>(
  state: TState,
  options?: ParseOptions,
): TState {
  const annotations = options?.annotations;
  if (annotations == null) {
    return state;
  }
  return injectAnnotations(state, annotations);
}

/**
 * Parses an array of command-line arguments using the provided combined parser.
 * This function processes the input arguments, applying the parser to each
 * argument until all arguments are consumed or an error occurs.
 *
 * This function only accepts synchronous parsers. For asynchronous parsers,
 * use {@link parseAsync}.
 *
 * @template T The type of the value produced by the parser.
 * @param parser The combined {@link Parser} to use for parsing the input
 *               arguments.  Must be a synchronous parser.
 * @param args The array of command-line arguments to parse.  Usually this is
 *             `process.argv.slice(2)` in Node.js or `Deno.args` in Deno.
 * @param options Optional {@link ParseOptions} for customizing parsing behavior.
 * @returns A {@link Result} object indicating whether the parsing was
 *          successful or not.  If successful, it contains the parsed value of
 *          type `T`.  If not, it contains an error message describing the
 *          failure.
 * @since 0.9.0 Renamed from the original `parse` function which now delegates
 *              to this for sync parsers.
 * @since 0.10.0 Added optional `options` parameter for annotations support.
 */
export function parseSync<T>(
  parser: Parser<"sync", T, unknown>,
  args: readonly string[],
  options?: ParseOptions,
): Result<T> {
  const initialState = injectAnnotationsIntoState(parser.initialState, options);
  const shouldUnwrapAnnotatedValue = options?.annotations != null ||
    isInjectedAnnotationWrapper(parser.initialState);

  const exec: ExecutionContext = {
    usage: parser.usage,
    phase: "parse",
    path: [],
    trace: createInputTrace(),
  };
  let context: ParserContext<unknown> = createParserContext(
    { buffer: args, state: initialState, optionsTerminated: false },
    exec,
  );
  do {
    const result = parser.parse(context);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    const previousBuffer = context.buffer;
    context = result.next;
    if (isBufferUnchanged(previousBuffer, context.buffer)) {
      return {
        success: false,
        error: message`Unexpected option or argument: ${context.buffer[0]}.`,
      };
    }
  } while (context.buffer.length > 0);
  const runtime = createDependencyRuntimeContext();
  const completeExec: ExecutionContext = {
    ...exec,
    phase: "complete",
    dependencyRuntime: runtime,
    dependencyRegistry: runtime.registry,
    trace: context.exec?.trace ?? exec.trace,
  };
  const endResult = parser.complete(context.state, completeExec);
  return endResult.success
    ? {
      success: true,
      value: shouldUnwrapAnnotatedValue
        ? unwrapInjectedAnnotationWrapper(endResult.value)
        : endResult.value,
      ...(endResult.deferred ? { deferred: true as const } : {}),
      ...(endResult.deferredKeys
        ? { deferredKeys: endResult.deferredKeys }
        : {}),
    }
    : { success: false, error: endResult.error };
}

/**
 * Returns `true` when the buffer has not changed between iterations,
 * indicating a parser is stalling without consuming input.
 */
function isBufferUnchanged(
  previous: readonly string[],
  current: readonly string[],
): boolean {
  return (
    current.length > 0 &&
    current.length === previous.length &&
    current.every((item, i) => item === previous[i])
  );
}

/**
 * Parses an array of command-line arguments using the provided combined parser.
 * This function processes the input arguments, applying the parser to each
 * argument until all arguments are consumed or an error occurs.
 *
 * This function accepts any parser (sync or async) and always returns a Promise.
 * For synchronous parsing with sync parsers, use {@link parseSync} instead.
 *
 * @template T The type of the value produced by the parser.
 * @param parser The combined {@link Parser} to use for parsing the input
 *               arguments.
 * @param args The array of command-line arguments to parse.  Usually this is
 *             `process.argv.slice(2)` in Node.js or `Deno.args` in Deno.
 * @param options Optional {@link ParseOptions} for customizing parsing behavior.
 * @returns A Promise that resolves to a {@link Result} object indicating
 *          whether the parsing was successful or not.
 * @since 0.9.0
 * @since 0.10.0 Added optional `options` parameter for annotations support.
 */
export async function parseAsync<T>(
  parser: Parser<Mode, T, unknown>,
  args: readonly string[],
  options?: ParseOptions,
): Promise<Result<T>> {
  const initialState = injectAnnotationsIntoState(parser.initialState, options);
  const shouldUnwrapAnnotatedValue = options?.annotations != null ||
    isInjectedAnnotationWrapper(parser.initialState);

  const exec: ExecutionContext = {
    usage: parser.usage,
    phase: "parse",
    path: [],
    trace: createInputTrace(),
  };
  let context: ParserContext<unknown> = createParserContext(
    { buffer: args, state: initialState, optionsTerminated: false },
    exec,
  );
  do {
    const result = await parser.parse(context);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    const previousBuffer = context.buffer;
    context = result.next;
    if (isBufferUnchanged(previousBuffer, context.buffer)) {
      return {
        success: false,
        error: message`Unexpected option or argument: ${context.buffer[0]}.`,
      };
    }
  } while (context.buffer.length > 0);
  const runtime = createDependencyRuntimeContext();
  const completeExec: ExecutionContext = {
    ...exec,
    phase: "complete",
    dependencyRuntime: runtime,
    dependencyRegistry: runtime.registry,
    trace: context.exec?.trace ?? exec.trace,
  };
  const endResult = await parser.complete(context.state, completeExec);
  return endResult.success
    ? {
      success: true,
      value: shouldUnwrapAnnotatedValue
        ? unwrapInjectedAnnotationWrapper(endResult.value)
        : endResult.value,
      ...(endResult.deferred ? { deferred: true as const } : {}),
      ...(endResult.deferredKeys
        ? { deferredKeys: endResult.deferredKeys }
        : {}),
    }
    : { success: false, error: endResult.error };
}

/**
 * Parses an array of command-line arguments using the provided combined parser.
 * This function processes the input arguments, applying the parser to each
 * argument until all arguments are consumed or an error occurs.
 *
 * The return type depends on the parser's mode:
 * - Sync parsers return `Result<T>` directly.
 * - Async parsers return `Promise<Result<T>>`.
 *
 * For explicit control, use {@link parseSync} or {@link parseAsync}.
 *
 * @template M The execution mode of the parser.
 * @template T The type of the value produced by the parser.
 * @param parser The combined {@link Parser} to use for parsing the input
 *               arguments.
 * @param args The array of command-line arguments to parse.  Usually this is
 *             `process.argv.slice(2)` in Node.js or `Deno.args` in Deno.
 * @param options Optional {@link ParseOptions} for customizing parsing behavior.
 * @returns A {@link Result} object (for sync) or Promise thereof (for async)
 *          indicating whether the parsing was successful or not.
 * @since 0.10.0 Added optional `options` parameter for annotations support.
 */
export function parse<M extends Mode, T>(
  parser: Parser<M, T, unknown>,
  args: readonly string[],
  options?: ParseOptions,
): ModeValue<M, Result<T>> {
  return dispatchByMode(
    parser.$mode,
    () => parseSync(parser as Parser<"sync", T, unknown>, args, options),
    () => parseAsync(parser, args, options),
  );
}

/**
 * Generates command-line suggestions based on current parsing state.
 * This function processes the input arguments up to the last argument,
 * then calls the parser's suggest method with the remaining prefix.
 *
 * This function only accepts synchronous parsers. For asynchronous parsers,
 * use {@link suggestAsync}.
 *
 * @template T The type of the value produced by the parser.
 * @param parser The {@link Parser} to use for generating suggestions.
 *               Must be a synchronous parser.
 * @param args The array of command-line arguments including the partial
 *             argument to complete.  The last element is treated as
 *             the prefix for suggestions.
 * @param options Optional {@link ParseOptions} for customizing parsing behavior.
 * @returns An array of {@link Suggestion} objects containing completion
 *          candidates.
 * @example
 * ```typescript
 * const parser = object({
 *   verbose: option("-v", "--verbose"),
 *   format: option("-f", "--format", choice(["json", "yaml"]))
 * });
 *
 * // Get suggestions for options starting with "--"
 * const suggestions = suggestSync(parser, ["--"]);
 * // Returns: [{ text: "--verbose" }, { text: "--format" }]
 *
 * // Get suggestions after parsing some arguments
 * const suggestions2 = suggestSync(parser, ["-v", "--format="]);
 * // Returns: [{ text: "--format=json" }, { text: "--format=yaml" }]
 * ```
 * @since 0.6.0
 * @since 0.9.0 Renamed from the original `suggest` function.
 * @since 0.10.0 Added optional `options` parameter for annotations support.
 */
export function suggestSync<T>(
  parser: Parser<"sync", T, unknown>,
  args: readonly [string, ...readonly string[]],
  options?: ParseOptions,
): readonly Suggestion[] {
  const allButLast = args.slice(0, -1);
  const prefix = args[args.length - 1];

  const initialState = injectAnnotationsIntoState(parser.initialState, options);

  let context: ParserContext<unknown> = createParserContext(
    { buffer: allButLast, state: initialState, optionsTerminated: false },
    {
      usage: parser.usage,
      phase: "suggest",
      path: [],
      trace: createInputTrace(),
    },
  );

  // Parse up to the prefix
  while (context.buffer.length > 0) {
    const result = parser.parse(context);
    if (!result.success) {
      // If parsing fails, we might still be able to provide suggestions
      // based on the current state. Try to get suggestions from the parser.
      return Array.from(
        parser.suggest(withSuggestRuntime(parser, context), prefix),
      );
    }
    const previousBuffer = context.buffer;
    context = result.next;
    if (isBufferUnchanged(previousBuffer, context.buffer)) return [];
  }

  // Get suggestions from the parser with the prefix
  return Array.from(
    parser.suggest(withSuggestRuntime(parser, context), prefix),
  );
}

/**
 * Creates a dependency runtime from the current parser state and returns
 * a context with the populated registry.  Used by top-level suggest
 * functions to mirror the construct-owned model where suggest() receives
 * a context with a dependency registry.
 * @internal
 */
function withSuggestRuntime<TState>(
  parser: Parser<Mode, unknown, TState>,
  context: ParserContext<TState>,
): ParserContext<TState> {
  const runtime = createDependencyRuntimeContext();
  if (parser.dependencyMetadata?.source != null) {
    collectExplicitSourceValues([{
      path: context.exec?.path ?? [],
      parser,
      state: context.state,
    }], runtime);
  }
  return {
    ...context,
    dependencyRegistry: runtime.registry,
    exec: context.exec
      ? {
        ...context.exec,
        dependencyRuntime: runtime,
        dependencyRegistry: runtime.registry,
      }
      : undefined,
  };
}

async function withSuggestRuntimeAsync<TState>(
  parser: Parser<Mode, unknown, TState>,
  context: ParserContext<TState>,
): Promise<ParserContext<TState>> {
  const runtime = createDependencyRuntimeContext();
  if (parser.dependencyMetadata?.source != null) {
    await collectExplicitSourceValuesAsync([{
      path: context.exec?.path ?? [],
      parser,
      state: context.state,
    }], runtime);
  }
  return {
    ...context,
    dependencyRegistry: runtime.registry,
    exec: context.exec
      ? {
        ...context.exec,
        dependencyRuntime: runtime,
        dependencyRegistry: runtime.registry,
      }
      : undefined,
  };
}

/**
 * Generates command-line suggestions based on current parsing state.
 * This function processes the input arguments up to the last argument,
 * then calls the parser's suggest method with the remaining prefix.
 *
 * This function accepts any parser (sync or async) and always returns a Promise.
 * For synchronous suggestion generation with sync parsers, use
 * {@link suggestSync} instead.
 *
 * @template T The type of the value produced by the parser.
 * @param parser The {@link Parser} to use for generating suggestions.
 * @param args The array of command-line arguments including the partial
 *             argument to complete.  The last element is treated as
 *             the prefix for suggestions.
 * @param options Optional {@link ParseOptions} for customizing parsing behavior.
 * @returns A Promise that resolves to an array of {@link Suggestion} objects
 *          containing completion candidates.
 * @since 0.9.0
 * @since 0.10.0 Added optional `options` parameter for annotations support.
 */
export async function suggestAsync<T>(
  parser: Parser<Mode, T, unknown>,
  args: readonly [string, ...readonly string[]],
  options?: ParseOptions,
): Promise<readonly Suggestion[]> {
  const allButLast = args.slice(0, -1);
  const prefix = args[args.length - 1];

  const initialState = injectAnnotationsIntoState(parser.initialState, options);

  let context: ParserContext<unknown> = createParserContext(
    { buffer: allButLast, state: initialState, optionsTerminated: false },
    {
      usage: parser.usage,
      phase: "suggest",
      path: [],
      trace: createInputTrace(),
    },
  );

  // Parse up to the prefix
  while (context.buffer.length > 0) {
    const result = await parser.parse(context);
    if (!result.success) {
      // If parsing fails, we might still be able to provide suggestions
      // based on the current state. Try to get suggestions from the parser.
      const ctx = await withSuggestRuntimeAsync(parser, context);
      const suggestions: Suggestion[] = [];
      for await (const suggestion of parser.suggest(ctx, prefix)) {
        suggestions.push(suggestion);
      }
      return suggestions;
    }
    const previousBuffer = context.buffer;
    context = result.next;
    if (isBufferUnchanged(previousBuffer, context.buffer)) return [];
  }

  // Get suggestions from the parser with the prefix
  const ctx = await withSuggestRuntimeAsync(parser, context);
  const suggestions: Suggestion[] = [];
  for await (const suggestion of parser.suggest(ctx, prefix)) {
    suggestions.push(suggestion);
  }
  return suggestions;
}

/**
 * Generates command-line suggestions based on current parsing state.
 * This function processes the input arguments up to the last argument,
 * then calls the parser's suggest method with the remaining prefix.
 *
 * The return type depends on the parser's mode:
 * - Sync parsers return `readonly Suggestion[]` directly.
 * - Async parsers return `Promise<readonly Suggestion[]>`.
 *
 * For explicit control, use {@link suggestSync} or {@link suggestAsync}.
 *
 * @template M The execution mode of the parser.
 * @template T The type of the value produced by the parser.
 * @param parser The {@link Parser} to use for generating suggestions.
 * @param args The array of command-line arguments including the partial
 *             argument to complete.  The last element is treated as
 *             the prefix for suggestions.
 * @param options Optional {@link ParseOptions} for customizing parsing behavior.
 * @returns An array of {@link Suggestion} objects (for sync) or Promise thereof
 *          (for async) containing completion candidates.
 * @since 0.6.0
 * @since 0.10.0 Added optional `options` parameter for annotations support.
 */
export function suggest<M extends Mode, T>(
  parser: Parser<M, T, unknown>,
  args: readonly [string, ...readonly string[]],
  options?: ParseOptions,
): ModeValue<M, readonly Suggestion[]> {
  return dispatchByMode(
    parser.$mode,
    () => suggestSync(parser as Parser<"sync", T, unknown>, args, options),
    () => suggestAsync(parser, args, options),
  );
}

/**
 * Recursively searches for a command within nested exclusive usage terms.
 * When the command is found, returns the expanded usage terms for that command.
 *
 * @param term The usage term to search in
 * @param commandName The command name to find
 * @returns The expanded usage terms if found, null otherwise
 */
function findCommandInExclusive(
  term: UsageTerm,
  commandName: string,
): Usage | null {
  if (term.type !== "exclusive") return null;

  for (const termGroup of term.terms) {
    const firstTerm = termGroup[0];

    // Direct match: first term is the command we're looking for
    if (firstTerm?.type === "command" && firstTerm.name === commandName) {
      return termGroup;
    }

    // Recursive case: first term is another exclusive (nested structure)
    if (firstTerm?.type === "exclusive") {
      const found = findCommandInExclusive(firstTerm, commandName);
      if (found) {
        // Replace the nested exclusive with the found terms,
        // then append the rest of termGroup (e.g., global options)
        return [...found, ...termGroup.slice(1)];
      }
    }
  }

  return null;
}

/**
 * Generates a documentation page for a synchronous parser.
 *
 * This is the sync-specific version of {@link getDocPage}. It only accepts
 * sync parsers and returns the documentation page directly (not wrapped
 * in a Promise).
 *
 * @param parser The sync parser to generate documentation for.
 * @param argsOrOptions Optional array of command-line arguments for context,
 *        or a {@link ParseOptions} object for annotations.  When a
 *        `ParseOptions` is passed here, the `options` parameter is ignored.
 * @param options Optional {@link ParseOptions} for customizing parsing
 *        behavior.  Only used when `argsOrOptions` is an array or omitted.
 * @returns A {@link DocPage} or `undefined`.
 * @since 0.9.0
 * @since 0.10.0 Added optional `options` parameter for annotations support.
 * @since 1.0.0 The second parameter now also accepts a `ParseOptions` object
 *              directly.
 */
export function getDocPageSync(
  parser: Parser<"sync", unknown, unknown>,
  argsOrOptions?: readonly string[] | ParseOptions,
  options?: ParseOptions,
): DocPage | undefined {
  if (Array.isArray(argsOrOptions)) {
    return getDocPageSyncImpl(parser, argsOrOptions, options);
  }
  return getDocPageSyncImpl(
    parser,
    [],
    (argsOrOptions as ParseOptions | undefined) ?? options,
  );
}

/**
 * Generates a documentation page for any parser, returning a Promise.
 *
 * This function accepts parsers of any mode (sync or async) and always
 * returns a Promise. Use this when working with parsers that may contain
 * async value parsers.
 *
 * @param parser The parser to generate documentation for.
 * @param argsOrOptions Optional array of command-line arguments for context,
 *        or a {@link ParseOptions} object for annotations.  When a
 *        `ParseOptions` is passed here, the `options` parameter is ignored.
 * @param options Optional {@link ParseOptions} for customizing parsing
 *        behavior.  Only used when `argsOrOptions` is an array or omitted.
 * @returns A Promise of {@link DocPage} or `undefined`.
 * @since 0.9.0
 * @since 0.10.0 Added optional `options` parameter for annotations support.
 * @since 1.0.0 The second parameter now also accepts a `ParseOptions` object
 *              directly.
 */
export function getDocPageAsync(
  parser: Parser<Mode, unknown, unknown>,
  argsOrOptions?: readonly string[] | ParseOptions,
  options?: ParseOptions,
): Promise<DocPage | undefined> {
  const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
  const opts = Array.isArray(argsOrOptions)
    ? options
    : (argsOrOptions as ParseOptions | undefined) ?? options;
  if (parser.$mode === "sync") {
    return Promise.resolve(
      getDocPageSyncImpl(
        parser as Parser<"sync", unknown, unknown>,
        args,
        opts,
      ),
    );
  }
  return getDocPageAsyncImpl(parser, args, opts);
}

/**
 * Generates a documentation page for a parser based on its current state after
 * attempting to parse the provided arguments. This function is useful for
 * creating help documentation that reflects the current parsing context.
 *
 * The function works by:
 * 1. Attempting to parse the provided arguments to determine the current state
 * 2. Generating documentation fragments from the parser's current state
 * 3. Organizing fragments into entries and sections
 * 4. Resolving command usage terms based on parsed arguments
 *
 * For sync parsers, returns the documentation page directly.
 * For async parsers, returns a Promise of the documentation page.
 *
 * @param parser The parser to generate documentation for
 * @param argsOrOptions Optional array of command-line arguments that have been
 *        parsed so far, or a {@link ParseOptions} object for annotations.
 *        When a `ParseOptions` is passed here, the `options` parameter is
 *        ignored.  Defaults to an empty array when omitted.
 * @param options Optional {@link ParseOptions} for customizing parsing
 *        behavior.  Only used when `argsOrOptions` is an array or omitted.
 * @returns For sync parsers, returns a {@link DocPage} directly.
 *          For async parsers, returns a Promise of {@link DocPage}.
 *          Returns `undefined` if no documentation can be generated.
 *
 * @example
 * ```typescript
 * const parser = object({
 *   verbose: option("-v", "--verbose"),
 *   port: option("-p", "--port", integer())
 * });
 *
 * // Get documentation for sync parser
 * const rootDoc = getDocPage(parser);
 *
 * // Get documentation for async parser
 * const asyncDoc = await getDocPage(asyncParser);
 * ```
 * @since 0.9.0 Updated to support async parsers.
 * @since 0.10.0 Added optional `options` parameter for annotations support.
 * @since 1.0.0 The second parameter now also accepts a `ParseOptions` object
 *              directly.
 */
export function getDocPage(
  parser: Parser<"sync", unknown, unknown>,
  argsOrOptions?: readonly string[] | ParseOptions,
  options?: ParseOptions,
): DocPage | undefined;

export function getDocPage(
  parser: Parser<"async", unknown, unknown>,
  argsOrOptions?: readonly string[] | ParseOptions,
  options?: ParseOptions,
): Promise<DocPage | undefined>;

export function getDocPage<M extends Mode>(
  parser: Parser<M, unknown, unknown>,
  argsOrOptions?: readonly string[] | ParseOptions,
  options?: ParseOptions,
): ModeValue<M, DocPage | undefined>;

// Implementation
export function getDocPage(
  parser: Parser<Mode, unknown, unknown>,
  argsOrOptions?: readonly string[] | ParseOptions,
  options?: ParseOptions,
): DocPage | undefined | Promise<DocPage | undefined> {
  const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
  const opts = Array.isArray(argsOrOptions)
    ? options
    : (argsOrOptions as ParseOptions | undefined) ?? options;
  if (parser.$mode === "sync") {
    return getDocPageSyncImpl(
      parser as Parser<"sync", unknown, unknown>,
      args,
      opts,
    );
  }
  return getDocPageAsyncImpl(parser, args, opts);
}

/**
 * Internal sync implementation of getDocPage.
 */
function getDocPageSyncImpl(
  parser: Parser<"sync", unknown, unknown>,
  args: readonly string[],
  options?: ParseOptions,
): DocPage | undefined {
  const initialState = injectAnnotationsIntoState(parser.initialState, options);

  let context: ParserContext<unknown> = {
    buffer: args,
    optionsTerminated: false,
    state: initialState,
    usage: parser.usage,
  };
  while (context.buffer.length > 0) {
    const result = parser.parse(context);
    if (!result.success) break;
    const previousBuffer = context.buffer;
    context = result.next;
    if (isBufferUnchanged(previousBuffer, context.buffer)) break;
  }
  return buildDocPage(parser, context, args);
}

/**
 * Internal async implementation of getDocPage.
 */
async function getDocPageAsyncImpl(
  parser: Parser<Mode, unknown, unknown>,
  args: readonly string[],
  options?: ParseOptions,
): Promise<DocPage | undefined> {
  const initialState = injectAnnotationsIntoState(parser.initialState, options);

  let context: ParserContext<unknown> = {
    buffer: args,
    optionsTerminated: false,
    state: initialState,
    usage: parser.usage,
  };
  while (context.buffer.length > 0) {
    const result = await parser.parse(context);
    if (!result.success) break;
    const previousBuffer = context.buffer;
    context = result.next;
    if (isBufferUnchanged(previousBuffer, context.buffer)) break;
  }
  return buildDocPage(parser, context, args);
}

/**
 * Builds a DocPage from the parser and context.
 * Shared by both sync and async implementations.
 */
function buildDocPage(
  parser: Parser<Mode, unknown, unknown>,
  context: ParserContext<unknown>,
  args: readonly string[],
): DocPage | undefined {
  let effectiveArgs: readonly string[] = args;
  let { brief, description, fragments, footer } = parser.getDocFragments(
    { kind: "available", state: context.state },
    undefined,
  );
  // When the doc root is a bare command() parser and no args navigated into
  // it, the fragments contain only a single command entry instead of the
  // inner parser's options/arguments.  Detect this case and re-invoke
  // getDocFragments with the command's "matched" state so the inner docs are
  // exposed.  The Symbol.for brand check ensures we only synthesize state
  // for real command() parsers, not custom Parser implementations that happen
  // to emit a single command entry.
  // See: https://github.com/dahlia/optique/issues/200
  if (
    args.length === 0 &&
    Reflect.get(parser, Symbol.for("@optique/core/commandParser")) ===
      true &&
    fragments.length === 1 &&
    fragments[0].type === "entry" &&
    fragments[0].term.type === "command"
  ) {
    const cmdName = fragments[0].term.name;
    const matched = parser.getDocFragments(
      { kind: "available", state: ["matched", cmdName] },
      undefined,
    );
    ({ brief, description, fragments, footer } = matched);
    effectiveArgs = [cmdName];
  }
  // Build sections in the order that entries first appear in the fragment
  // stream, merging same-titled sections together.  This ensures that the
  // untitled (catch-all) section appears at its natural position in the
  // output rather than always being appended at the end.
  interface BuildingSection {
    title?: string;
    entries: DocEntry[];
  }
  const buildingSections: BuildingSection[] = [];
  let untitledSection: BuildingSection | null = null;
  const titledSectionMap = new Map<string, BuildingSection>();

  for (const fragment of fragments) {
    if (fragment.type === "entry") {
      if (isDocEntryHidden(fragment)) continue;
      if (untitledSection == null) {
        untitledSection = { entries: [] };
        buildingSections.push(untitledSection);
      }
      untitledSection.entries.push(cloneDocEntry(fragment));
    } else if (fragment.type === "section") {
      const visible = fragment.entries.filter((e) => !isDocEntryHidden(e));
      if (visible.length === 0) continue;
      if (fragment.title == null) {
        if (untitledSection == null) {
          untitledSection = { entries: [] };
          buildingSections.push(untitledSection);
        }
        untitledSection.entries.push(...visible.map(cloneDocEntry));
      } else {
        let section = titledSectionMap.get(fragment.title);
        if (section == null) {
          section = { title: fragment.title, entries: [] };
          titledSectionMap.set(fragment.title, section);
          buildingSections.push(section);
        }
        section.entries.push(...visible.map(cloneDocEntry));
      }
    }
  }
  const sections: DocSection[] = buildingSections;
  const usage = [...normalizeUsage(parser.usage)];
  const maybeApplyCommandUsageLine = (
    term: UsageTerm | undefined,
    arg: string,
    isLastArg: boolean,
    usageIndex: number,
  ): void => {
    if (
      term?.type !== "command" ||
      term.name !== arg ||
      !isLastArg ||
      term.usageLine == null
    ) {
      return;
    }
    const defaultUsageLine = cloneUsage(usage.slice(usageIndex + 1));
    const customUsageLine = typeof term.usageLine === "function"
      ? term.usageLine(defaultUsageLine)
      : term.usageLine;
    const normalizedCustomUsageLine = normalizeUsage(customUsageLine);
    usage.splice(
      usageIndex + 1,
      usage.length - (usageIndex + 1),
      ...normalizedCustomUsageLine,
    );
  };
  let i = 0;
  for (let argIndex = 0; argIndex < effectiveArgs.length; argIndex++) {
    const arg = effectiveArgs[argIndex];
    if (i >= usage.length) break;
    let term = usage[i];
    if (term.type === "exclusive") {
      const found = findCommandInExclusive(term, arg);
      if (found) {
        usage.splice(i, 1, ...found);
        term = usage[i];
      }
    }
    maybeApplyCommandUsageLine(
      term,
      arg,
      argIndex === effectiveArgs.length - 1,
      i,
    );
    i++;
  }
  // When no args navigate into a command, apply usageLine for the first
  // bare command term (not inside an exclusive) so the page's own usage
  // reflects the override.  This mirrors the navigated-command path above.
  if (effectiveArgs.length === 0 && usage.length > 0) {
    const first = usage[0];
    if (first.type === "command" && first.usageLine != null) {
      const defaultUsageLine = cloneUsage(usage.slice(1));
      const customUsageLine = typeof first.usageLine === "function"
        ? first.usageLine(defaultUsageLine)
        : first.usageLine;
      const normalizedCustomUsageLine = normalizeUsage(customUsageLine);
      usage.splice(1, usage.length - 1, ...normalizedCustomUsageLine);
    }
  }
  return {
    usage,
    sections,
    ...(brief != null && { brief: cloneMessage(brief) }),
    ...(description != null && { description: cloneMessage(description) }),
    ...(footer != null && { footer: cloneMessage(footer) }),
  };
}

// Re-export all parser modules for backward compatibility
export * from "./constructs.ts";
export * from "./modifiers.ts";
export * from "./primitives.ts";
